import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { buildCodexPrompt } from "./prompt.js";
import { CodexExecutionError } from "./errors.js";
import { StreamingRedactor } from "../security/redaction.js";

export interface ExecutionOutcome {
  exitCode: number;
}

function permission(path: string, access: "deny" | "read" | "write"): string {
  return `${JSON.stringify(path)}=${JSON.stringify(access)}`;
}

export function createCodexEnvironment(home: string, runtimeRoot: string): Record<string, string> {
  return {
    HOME: home,
    CODEX_RUNTIME_ROOT: runtimeRoot,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
  };
}

export function createCodexArgs(
  workspace: string,
  prompt: string,
  workspaceRoot: string,
  home: string,
  runtimeRoot: string,
): string[] {
  const resolvedWorkspace = resolve(workspace);
  const resolvedRoot = resolve(workspaceRoot);
  const entries = [
    permission(resolve(home), "deny"),
    permission("/opt/agent-relay", "deny"),
    permission("/opt/rust", "deny"),
    permission("/tmp", "deny"),
    permission("/var/tmp", "deny"),
    permission(resolvedRoot, "deny"),
    permission(resolve(runtimeRoot), "write"),
    permission(resolvedWorkspace, "write"),
    permission(join(resolvedWorkspace, ".git"), "read"),
  ];

  return [
    "--ask-for-approval",
    "never",
    "-c",
    "features.memories=false",
    "-c",
    "default_permissions=\"agent\"",
    "-c",
    "permissions.agent.extends=\":workspace\"",
    "-c",
    `permissions.agent.filesystem={${entries.join(",")}}`,
    "-c",
    "permissions.agent.network.enabled=true",
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
    private readonly workspaceRoot: string,
    private readonly home: string,
    private readonly runtimeRoot: string,
  ) {}

  async run(planPath: string, workspace: string): Promise<ExecutionOutcome> {
    const prompt = buildCodexPrompt(planPath);
    const child = spawn(
      this.command,
      createCodexArgs(workspace, prompt, this.workspaceRoot, this.home, this.runtimeRoot),
      {
        cwd: workspace,
        env: createCodexEnvironment(this.home, this.runtimeRoot),
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      },
    );

    let outputBytes = 0;
    let outputTruncated = false;
    const stdoutRedactor = new StreamingRedactor();
    const stderrRedactor = new StreamingRedactor();
    const writeRedacted = (value: string): void => {
      if (value) process.stdout.write(value);
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

    const signalProcessGroup = (signal: "SIGTERM" | "SIGKILL"): void => {
      try {
        if (typeof child.pid === "number") process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        child.kill(signal);
      }
    };

    let timedOut = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    const exitCode = await new Promise<number>((resolvePromise, reject) => {
      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        signalProcessGroup("SIGTERM");
        forceKillTimer = setTimeout(() => signalProcessGroup("SIGKILL"), 5_000);
      }, this.timeoutMs);

      child.on("error", () => {
        clearTimeout(timeoutTimer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        reject(new CodexExecutionError("CODEX_FAILED", "Codex process could not be started"));
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

    if (timedOut) throw new CodexExecutionError("CODEX_TIMEOUT", "Codex execution timed out");
    if (exitCode !== 0) throw new CodexExecutionError("CODEX_FAILED", `Codex exited with code ${exitCode}`);
    return { exitCode };
  }
}
