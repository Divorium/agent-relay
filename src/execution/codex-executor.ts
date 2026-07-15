import { spawn } from "node:child_process";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { RelayError } from "../contracts/errors.js";
import type { CreateJobRequest } from "../contracts/job.js";
import type { OutputStore } from "../persistence/output-store.js";
import { StreamingRedactor } from "../security/redaction.js";
import { buildCodexPrompt } from "./prompt.js";

export interface ExecutionOutcome { exitCode: number; }

const ISOLATED_CODEX_HOME = "/home/agent/.codex";
const RELAY_APPLICATION_ROOT = "/app";
const RELAY_HOME = "/home/relay";
const RUNNER_ROOT = "/runner";
const SYSTEM_TEMP_ROOT = "/tmp";
const SYSTEM_VAR_TEMP_ROOT = "/var/tmp";
const AGENT_TEMP_ROOT = "/tmp/agent-relay-runtime";

export function createCodexEnvironment(): Record<string, string> {
  return {
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
  };
}

function permission(path: string, access: "deny" | "read" | "write"): string {
  return `${JSON.stringify(path)}=${JSON.stringify(access)}`;
}

export function createCodexArgs(workspace: string, prompt: string, workspaceRoot = workspace): string[] {
  const resolvedWorkspace = resolve(workspace);
  const resolvedRoot = resolve(workspaceRoot);
  const entries = [
    permission(ISOLATED_CODEX_HOME, "deny"),
    permission(RELAY_APPLICATION_ROOT, "deny"),
    permission(RELAY_HOME, "deny"),
    permission(RUNNER_ROOT, "deny"),
    permission(SYSTEM_TEMP_ROOT, "deny"),
    permission(SYSTEM_VAR_TEMP_ROOT, "deny"),
    permission(AGENT_TEMP_ROOT, "write"),
  ];
  if (resolvedRoot !== resolvedWorkspace) entries.push(permission(resolvedRoot, "deny"));
  entries.push(permission(resolvedWorkspace, "write"));
  entries.push(permission(join(resolvedWorkspace, ".git"), "read"));

  return [
    "--ask-for-approval",
    "never",
    "-c",
    "features.memories=false",
    "-c",
    "default_permissions=\"relay\"",
    "-c",
    "permissions.relay.extends=\":workspace\"",
    "-c",
    `permissions.relay.filesystem={${entries.join(",")}}`,
    "-c",
    "permissions.relay.network.enabled=true",
    "exec",
    "--cd",
    resolvedWorkspace,
    prompt,
  ];
}

export function createCodexInvocation(command: string, args: string[], runAsUser?: string): { command: string; args: string[] } {
  return runAsUser
    ? { command: "/usr/bin/sudo", args: ["-H", "-u", runAsUser, "--", command, ...args] }
    : { command, args };
}

export class CodexExecutor {
  private readonly maxOutputBytes: number;
  private readonly outputStore: OutputStore | undefined;

  constructor(
    private readonly command: string,
    private readonly timeoutMs: number,
    maxOutputBytesOrStore: number | OutputStore,
    private readonly runAsUser?: string,
    private readonly workspaceRoot?: string,
    outputStore?: OutputStore,
  ) {
    if (typeof maxOutputBytesOrStore === "number") {
      this.maxOutputBytes = maxOutputBytesOrStore;
      this.outputStore = outputStore;
    } else {
      this.maxOutputBytes = 10_000_000;
      this.outputStore = maxOutputBytesOrStore;
    }
  }

  async run(request: CreateJobRequest, workspace: string, outputPath: string, jobId?: string): Promise<ExecutionOutcome> {
    const rawStreaming = this.outputStore !== undefined && jobId !== undefined;
    if (!rawStreaming) {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, "", { mode: 0o600 });
    }

    const prompt = buildCodexPrompt(request);
    const invocation = createCodexInvocation(
      this.command,
      createCodexArgs(workspace, prompt, this.workspaceRoot ?? workspace),
      this.runAsUser,
    );
    const child = spawn(invocation.command, invocation.args, {
      cwd: workspace,
      env: createCodexEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let outputBytes = 0;
    let outputTruncated = false;
    let outputFailure: RelayError | undefined;
    let pendingWrite = Promise.resolve();
    const stdoutRedactor = new StreamingRedactor();
    const stderrRedactor = new StreamingRedactor();

    const terminateForOutputFailure = (): void => {
      child.stdout?.pause();
      child.stderr?.pause();
      child.kill("SIGTERM");
    };

    const writeRedacted = (value: string): void => {
      if (!value) return;
      process.stdout.write(value);
      pendingWrite = pendingWrite.then(() => appendFile(outputPath, value, { mode: 0o600 }));
    };

    const collectRedacted = (redactor: StreamingRedactor) => (chunk: unknown): void => {
      if (outputBytes >= this.maxOutputBytes) {
        outputTruncated = true;
        return;
      }
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      const remaining = this.maxOutputBytes - outputBytes;
      const accepted = buffer.length > remaining ? buffer.subarray(0, remaining) : buffer;
      outputBytes += accepted.length;
      if (accepted.length < buffer.length) outputTruncated = true;
      writeRedacted(redactor.write(accepted));
    };

    const collectRaw = (chunk: unknown): void => {
      if (outputFailure) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      if (outputBytes + buffer.length > this.maxOutputBytes) {
        outputFailure = new RelayError("OUTPUT_LIMIT_EXCEEDED", "Codex output exceeded MAX_OUTPUT_BYTES", 413);
        terminateForOutputFailure();
        return;
      }
      outputBytes += buffer.length;
      pendingWrite = pendingWrite
        .then(async () => {
          await this.outputStore!.append(jobId!, buffer);
          process.stdout.write(buffer);
        })
        .catch((error: unknown) => {
          outputFailure = error instanceof RelayError
            ? error
            : new RelayError("OUTPUT_WRITE_FAILED", "Failed to persist Codex output", 500);
          terminateForOutputFailure();
        });
    };

    if (rawStreaming) {
      child.stdout?.on("data", collectRaw);
      child.stderr?.on("data", collectRaw);
    } else {
      child.stdout?.on("data", collectRedacted(stdoutRedactor));
      child.stderr?.on("data", collectRedacted(stderrRedactor));
    }

    let timedOut = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    const exitCode = await new Promise<number>((resolvePromise, reject) => {
      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
      }, this.timeoutMs);

      child.on("error", () => {
        clearTimeout(timeoutTimer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        reject(new RelayError("CODEX_FAILED", "Codex process could not be started", 502));
      });
      child.on("close", (code: number | null) => {
        clearTimeout(timeoutTimer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        resolvePromise(code ?? 1);
      });
    });

    if (!rawStreaming) {
      if (outputTruncated) {
        stdoutRedactor.discard();
        stderrRedactor.discard();
        writeRedacted("\n[OUTPUT TRUNCATED]\n");
      } else {
        writeRedacted(stdoutRedactor.end());
        writeRedacted(stderrRedactor.end());
      }
    }
    await pendingWrite;

    if (outputFailure) throw outputFailure;
    if (timedOut) throw new RelayError("CODEX_TIMEOUT", "Codex execution timed out", 504);
    if (exitCode !== 0) throw new RelayError("CODEX_FAILED", `Codex exited with code ${exitCode}`, 502);
    return { exitCode };
  }
}
