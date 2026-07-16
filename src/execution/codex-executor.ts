import { spawn } from "node:child_process";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { RelayError } from "../contracts/errors.js";
import type { CreateJobRequest } from "../contracts/job.js";
import { buildCodexPrompt } from "./prompt.js";
import { StreamingRedactor } from "../security/redaction.js";

export interface ExecutionOutcome { exitCode: number; }

const ISOLATED_CODEX_HOME = "/home/agent/.codex";
const RELAY_APPLICATION_ROOT = "/app";
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

export class CodexExecutor {
  constructor(
    private readonly command: string,
    private readonly timeoutMs: number,
    private readonly maxOutputBytes: number,
    private readonly workspaceRoot?: string,
  ) {}

  async run(request: CreateJobRequest, workspace: string, outputPath: string): Promise<ExecutionOutcome> {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, "", { mode: 0o600 });

    const prompt = buildCodexPrompt(request);
    const child = spawn(
      this.command,
      createCodexArgs(workspace, prompt, this.workspaceRoot ?? workspace),
      {
        cwd: workspace,
        env: createCodexEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let outputBytes = 0;
    let outputTruncated = false;
    let pendingWrite = Promise.resolve();
    const stdoutRedactor = new StreamingRedactor();
    const stderrRedactor = new StreamingRedactor();
    const writeRedacted = (value: string): void => {
      if (!value) return;
      process.stdout.write(value);
      pendingWrite = pendingWrite.then(() => appendFile(outputPath, value, { mode: 0o600 }));
    };
    const collect = (redactor: StreamingRedactor) => (chunk: unknown): void => {
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
    child.stdout?.on("data", collect(stdoutRedactor));
    child.stderr?.on("data", collect(stderrRedactor));

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

    if (outputTruncated) {
      stdoutRedactor.discard();
      stderrRedactor.discard();
      writeRedacted("\n[OUTPUT TRUNCATED]\n");
    } else {
      writeRedacted(stdoutRedactor.end());
      writeRedacted(stderrRedactor.end());
    }
    await pendingWrite;

    if (timedOut) throw new RelayError("CODEX_TIMEOUT", "Codex execution timed out", 504);
    if (exitCode !== 0) throw new RelayError("CODEX_FAILED", `Codex exited with code ${exitCode}`, 502);
    return { exitCode };
  }
}
