import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { buildCodexPrompt } from "./prompt.js";
import { CodexExecutionError } from "./errors.js";
import { CodexEventNormalizer } from "./codex-normalizer.js";
import { DiagnosticLineParser, deriveJsonlRecordBytes, JsonlParser } from "./jsonl-parser.js";
import { BoundedOutputPump } from "./output-pump.js";
import { RedactedFanout, type TranscriptSink } from "./transcript.js";

export interface ExecutionOutcome { exitCode: number; }
export interface KillableProcess { pid?: number; kill(signal: "SIGTERM" | "SIGKILL"): unknown; }
export type ProcessGroupKiller = (pid: number, signal: "SIGTERM" | "SIGKILL") => unknown;

const discardingTranscript: TranscriptSink = {
  async write() {},
  async sync() {},
  async close() {},
};

function permission(path: string, access: "deny" | "read" | "write"): string {
  return `${JSON.stringify(path)}=${JSON.stringify(access)}`;
}

function trustedProject(path: string): string {
  return `projects={${JSON.stringify(path)}={trust_level="trusted"}}`;
}

export function createCodexEnvironment(home: string, runtimeRoot: string): Record<string, string> {
  return { HOME: home, CODEX_RUNTIME_ROOT: runtimeRoot, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
}

export function createCodexArgs(
  workspace: string,
  prompt: string,
  home: string,
  runtimeRoot: string,
  trustedRuntimeRoot: string,
): string[] {
  const resolvedWorkspace = resolve(workspace);
  const entries = [
    permission(resolve(home), "deny"),
    permission(resolve(trustedRuntimeRoot), "deny"),
    permission("/opt/rust", "read"),
    permission("/tmp", "deny"),
    permission("/var/tmp", "deny"),
    permission(resolve(runtimeRoot), "write"),
    permission(resolvedWorkspace, "write"),
    permission(join(resolvedWorkspace, ".git"), "read"),
  ];
  return [
    "--ask-for-approval", "never",
    "-c", "features.memories=false",
    "-c", trustedProject(resolvedWorkspace),
    "-c", "default_permissions=\"agent\"",
    "-c", "permissions.agent.extends=\":workspace\"",
    "-c", `permissions.agent.filesystem={${entries.join(",")}}`,
    "-c", "permissions.agent.network.enabled=true",
    "exec", "--json", "--cd", resolvedWorkspace, prompt,
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
    private readonly home: string,
    private readonly runtimeRoot: string,
    private readonly trustedRuntimeRoot: string,
    private readonly forceKillDelayMs = 5_000,
    private readonly maxJsonlRecordBytes = deriveJsonlRecordBytes(maxOutputBytes),
  ) {}

  async run(planPath: string, workspace: string, transcript: TranscriptSink = discardingTranscript): Promise<ExecutionOutcome> {
    const prompt = buildCodexPrompt(planPath);
    const child = spawn(
      this.command,
      createCodexArgs(workspace, prompt, this.home, this.runtimeRoot, this.trustedRuntimeRoot),
      {
        cwd: workspace,
        env: createCodexEnvironment(this.home, this.runtimeRoot),
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      },
    );
    const normalizer = new CodexEventNormalizer();
    const fanout = new RedactedFanout(process.stdout, transcript, this.maxOutputBytes);
    let firstFailure: unknown;
    let discardOutput = false;
    let drainOnly = false;
    const fail = (error: unknown): void => {
      firstFailure ??= error;
      discardOutput = true;
      drainOnly = true;
      pump.discard();
      terminateProcess(child, "SIGTERM");
    };
    const pump = new BoundedOutputPump(
      fanout,
      [child.stdout, child.stderr],
      fail,
      () => {
        discardOutput = true;
        normalizer.clearLifecycleState();
      },
    );
    const stdout = new JsonlParser((event) => {
      if (!discardOutput) for (const value of normalizer.normalize(event)) pump.enqueue([value]);
    }, this.maxJsonlRecordBytes);
    const stderr = new DiagnosticLineParser((diagnostic, continuation) => {
      if (!discardOutput) pump.enqueue([normalizer.diagnostic(diagnostic, continuation)]);
    });
    child.stdout.on("data", (chunk: Uint8Array) => {
      if (drainOnly) return;
      try { stdout.write(chunk); } catch (error) { fail(error); }
    });
    child.stderr.on("data", (chunk: Uint8Array) => {
      if (drainOnly) return;
      try { stderr.write(chunk); } catch (error) { fail(error); }
    });
    child.stdout.on("error", fail);
    child.stderr.on("error", fail);

    let timedOut = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    let startupError: CodexExecutionError | undefined;
    const exitCode = await new Promise<number>((resolvePromise) => {
      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        terminateProcess(child, "SIGTERM");
        forceKillTimer = setTimeout(() => terminateProcess(child, "SIGKILL"), this.forceKillDelayMs);
      }, this.timeoutMs);
      child.on("error", (error: Error) => {
        clearTimeout(timeoutTimer);
        clearTimeout(forceKillTimer);
        startupError = new CodexExecutionError("CODEX_FAILED", `Codex process could not be started: ${error.message}`);
        resolvePromise(1);
      });
      child.on("close", (code: number | null) => {
        clearTimeout(timeoutTimer);
        clearTimeout(forceKillTimer);
        resolvePromise(code ?? 1);
      });
    });

    if (firstFailure === undefined) {
      try {
        stdout.end();
        stderr.end();
      } catch (error) {
        fail(error);
      }
    }
    await pump.finish();
    try { await fanout.finish(); } catch (error) { firstFailure ??= error; }
    if (startupError) throw startupError;
    if (firstFailure !== undefined) throw firstFailure;
    if (timedOut) throw new CodexExecutionError("CODEX_TIMEOUT", "Codex execution timed out");
    if (exitCode !== 0) throw new CodexExecutionError("CODEX_FAILED", `Codex exited with code ${exitCode}`);
    return { exitCode };
  }
}
