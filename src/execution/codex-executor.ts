import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { buildCodexPrompt } from "./prompt.js";
import { CodexExecutionError } from "./errors.js";
import { CodexEventNormalizer } from "./codex-normalizer.js";
import { DiagnosticLineParser, deriveJsonlRecordBytes, JsonlParser } from "./jsonl-parser.js";
import { BoundedOutputPump, OrderedInputPump } from "./output-pump.js";
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
    permission("/var/run/docker.sock", "write"),
    permission("/run/docker.sock", "write"),
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

class TerminationController {
  private closed = false;
  private gracefulSent = false;
  private forceKillTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly child: KillableProcess,
    private readonly forceKillDelayMs: number,
  ) {}

  request(): void {
    if (this.closed || this.gracefulSent) return;
    this.gracefulSent = true;
    this.forceKillTimer = setTimeout(() => {
      this.forceKillTimer = undefined;
      if (!this.closed) this.signal("SIGKILL");
    }, this.forceKillDelayMs);
    this.signal("SIGTERM");
  }

  childClosed(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.forceKillTimer);
    this.forceKillTimer = undefined;
  }

  private signal(signal: "SIGTERM" | "SIGKILL"): void {
    try { terminateProcess(this.child, signal); } catch { /* Termination cannot replace the semantic failure. */ }
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
    const termination = new TerminationController(child, this.forceKillDelayMs);
    let firstFailure: unknown;
    let discardOutput = false;
    let drainOnly = false;
    let input: OrderedInputPump | undefined;
    const fail = (error: unknown): void => {
      firstFailure ??= error;
      discardOutput = true;
      drainOnly = true;
      pump.discard();
      input?.discard();
      termination.request();
    };
    const pump = new BoundedOutputPump(
      fanout,
      fail,
      () => {
        discardOutput = true;
        normalizer.clearLifecycleState();
      },
    );
    const stdout = new JsonlParser(this.maxJsonlRecordBytes);
    const stderr = new DiagnosticLineParser();
    input = new OrderedInputPump(pump, async (source, chunk) => {
      if (source === child.stdout) {
        for (const event of stdout.write(chunk)) {
          if (!discardOutput) await pump.enqueue(normalizer.normalize(event));
        }
      } else {
        for (const diagnostic of stderr.write(chunk)) {
          if (!discardOutput) await pump.enqueue([normalizer.diagnostic(diagnostic.value, diagnostic.continuation)]);
        }
      }
    }, fail);
    child.stdout.on("data", (chunk: Uint8Array) => {
      if (drainOnly) return;
      input?.accept(child.stdout, chunk);
    });
    child.stderr.on("data", (chunk: Uint8Array) => {
      if (drainOnly) return;
      input?.accept(child.stderr, chunk);
    });
    child.stdout.on("error", fail);
    child.stderr.on("error", fail);

    let spawned = false;
    let startupError: CodexExecutionError | undefined;
    const exitCode = await new Promise<number>((resolvePromise) => {
      const timeoutTimer = setTimeout(() => {
        fail(new CodexExecutionError("CODEX_TIMEOUT", "Codex execution timed out"));
      }, this.timeoutMs);
      child.on("spawn", () => { spawned = true; });
      child.on("error", (error: Error) => {
        if (spawned) {
          fail(error);
        } else {
          clearTimeout(timeoutTimer);
          termination.childClosed();
          startupError = new CodexExecutionError("CODEX_FAILED", `Codex process could not be started: ${error.message}`);
          resolvePromise(1);
        }
      });
      child.on("close", (code: number | null) => {
        clearTimeout(timeoutTimer);
        termination.childClosed();
        resolvePromise(code ?? 1);
      });
    });

    await input.finish();
    if (firstFailure === undefined) {
      try {
        for (const event of stdout.end()) {
          if (!discardOutput) await pump.enqueue(normalizer.normalize(event));
        }
        for (const diagnostic of stderr.end()) {
          if (!discardOutput) await pump.enqueue([normalizer.diagnostic(diagnostic.value, diagnostic.continuation)]);
        }
      } catch (error) {
        fail(error);
      }
    }
    await pump.finish();
    try { await fanout.finish(); } catch (error) { firstFailure ??= error; }
    if (startupError) throw startupError;
    if (firstFailure !== undefined) throw firstFailure;
    if (exitCode !== 0) throw new CodexExecutionError("CODEX_FAILED", `Codex exited with code ${exitCode}`);
    return { exitCode };
  }
}
