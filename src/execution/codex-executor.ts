import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { buildCodexPrompt } from "./prompt.js";
import { CodexExecutionError } from "./errors.js";
import { StreamingRedactor } from "../security/redaction.js";

export interface ExecutionOutcome { exitCode: number; }
export interface KillableProcess { pid?: number; kill(signal: "SIGTERM" | "SIGKILL"): unknown; }
export type ProcessGroupKiller = (pid: number, signal: "SIGTERM" | "SIGKILL") => unknown;

function permission(path: string, access: "deny" | "read" | "write"): string {
  return `${JSON.stringify(path)}=${JSON.stringify(access)}`;
}

export function createCodexEnvironment(home: string, runtimeRoot: string): Record<string, string> {
  return { HOME: home, CODEX_RUNTIME_ROOT: runtimeRoot, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
}

export function createCodexArgs(
  workspace: string,
  prompt: string,
  workspaceRoot: string,
  home: string,
  runtimeRoot: string,
  trustedSourceRoot: string,
): string[] {
  const resolvedWorkspace = resolve(workspace);
  const resolvedRoot = resolve(workspaceRoot);
  const entries = [
    permission(resolve(home), "deny"),
    permission(resolve(trustedSourceRoot), "deny"),
    permission("/opt/rust", "read"),
    permission("/tmp", "deny"),
    permission("/var/tmp", "deny"),
    permission(resolvedRoot, "deny"),
    permission(resolve(runtimeRoot), "write"),
    permission(resolvedWorkspace, "write"),
    permission(join(resolvedWorkspace, ".git"), "read"),
  ];
  return [
    "--ask-for-approval", "never",
    "-c", "features.memories=false",
    "-c", "default_permissions=\"agent\"",
    "-c", "permissions.agent.extends=\":workspace\"",
    "-c", `permissions.agent.filesystem={${entries.join(",")}}`,
    "-c", "permissions.agent.network.enabled=true",
    "exec", "--cd", resolvedWorkspace, prompt,
  ];
}

export function terminateProcess(
  child: KillableProcess,
  signal: "SIGTERM" | "SIGKILL",
  killProcessGroup: ProcessGroupKiller = (pid, requestedSignal) => process.kill(-pid, requestedSignal),
): void {
  if (typeof child.pid !== "number") {
    child.kill(signal);
    return;
  }
  try {
    killProcessGroup(child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

export class CodexExecutor {
  constructor(
    private readonly command: string,
    private readonly timeoutMs: number,
    private readonly maxOutputBytes: number,
    private readonly workspaceRoot: string,
    private readonly home: string,
    private readonly runtimeRoot: string,
    private readonly trustedSourceRoot: string,
    private readonly forceKillDelayMs = 5_000,
  ) {}

  async run(planPath: string, workspace: string): Promise<ExecutionOutcome> {
    const prompt = buildCodexPrompt(planPath);
    const child = spawn(
      this.command,
      createCodexArgs(workspace, prompt, this.workspaceRoot, this.home, this.runtimeRoot, this.trustedSourceRoot),
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
    const collect = (redactor: StreamingRedactor) => (chunk: any): void => {
      if (outputBytes >= this.maxOutputBytes) {
        outputTruncated = true;
        return;
      }
      const remaining = this.maxOutputBytes - outputBytes;
      const accepted = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      outputBytes += accepted.length;
      if (accepted.length < chunk.length) outputTruncated = true;
      writeRedacted(redactor.write(accepted));
    };
    child.stdout.on("data", collect(stdoutRedactor));
    child.stderr.on("data", collect(stderrRedactor));

    let timedOut = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    const exitCode = await new Promise<number>((resolvePromise, reject) => {
      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        terminateProcess(child, "SIGTERM");
        forceKillTimer = setTimeout(() => terminateProcess(child, "SIGKILL"), this.forceKillDelayMs);
      }, this.timeoutMs);
      child.on("error", () => {
        clearTimeout(timeoutTimer);
        clearTimeout(forceKillTimer);
        reject(new CodexExecutionError("CODEX_FAILED", "Codex process could not be started"));
      });
      child.on("close", (code: number | null) => {
        clearTimeout(timeoutTimer);
        clearTimeout(forceKillTimer);
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
