import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { RelayError } from "../contracts/errors.js";
import type { JobRecord } from "../contracts/job.js";
import { validateCodexResult } from "../contracts/validators.js";
import type { CodexResult } from "../contracts/result.js";
import { buildCodexPrompt } from "./prompt.js";
import { OutputStore } from "../persistence/output-store.js";

export interface ExecutionOutcome { exitCode: number; result: CodexResult; }

const CODEX_BLOCKED_ENVIRONMENT_VARIABLES = new Set(["AGENT_RELAY_TOKEN"]);

export function createCodexEnvironment(source: Record<string, string | undefined> = process.env): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && !CODEX_BLOCKED_ENVIRONMENT_VARIABLES.has(name)) environment[name] = value;
  }
  return environment;
}

export class CodexExecutor {
  constructor(
    private readonly command: string,
    private readonly timeoutMs: number,
    private readonly outputStore: OutputStore,
  ) {}

  async run(job: JobRecord, workspace: string): Promise<ExecutionOutcome> {
    const resultPath = join(workspace, ".agent-relay", "result.json");
    await mkdir(dirname(resultPath), { recursive: true });
    await rm(resultPath, { force: true });

    const prompt = buildCodexPrompt(job.request, ".agent-relay/result.json");
    const child = spawn(this.command, [
      "--ask-for-approval",
      "never",
      "-c",
      "features.memories=false",
      "exec",
      "--sandbox",
      "danger-full-access",
      "--cd",
      workspace,
      prompt,
    ], {
      cwd: workspace,
      env: createCodexEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    const pending: Uint8Array[] = [];
    let writing = false;
    let streamsPaused = false;
    let childClosed = false;
    let childExitCode = 1;
    let timedOut = false;
    let writeError: RelayError | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

    let closeResolve!: () => void;
    const closePromise = new Promise<void>((resolve) => {
      closeResolve = resolve;
    });
    let writerIdleResolve!: () => void;
    const writerIdle = new Promise<void>((resolve) => {
      writerIdleResolve = resolve;
    });

    const maybeResolveWriterIdle = (): void => {
      if (childClosed && !writing && pending.length === 0) writerIdleResolve();
    };

    const resumeStreams = (): void => {
      if (!streamsPaused) return;
      child.stdout?.resume();
      child.stderr?.resume();
      streamsPaused = false;
    };

    const pauseStreams = (): void => {
      if (streamsPaused) return;
      child.stdout?.pause();
      child.stderr?.pause();
      streamsPaused = true;
    };

    const flushPending = async (): Promise<void> => {
      if (writing) return;
      writing = true;
      try {
        while (pending.length > 0) {
          const chunk = pending.shift();
          if (!chunk) continue;
          await this.outputStore.append(job.id, chunk);
        }
      } catch (error) {
        writeError = error instanceof RelayError ? error : new RelayError("OUTPUT_WRITE_FAILED", "Failed to persist job output", 500);
        pending.length = 0;
        child.kill("SIGTERM");
        forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      } finally {
        writing = false;
        if (pending.length === 0) resumeStreams();
        maybeResolveWriterIdle();
      }
    };

    const enqueue = (chunk: Uint8Array): void => {
      if (writeError) return;
      process.stdout.write(chunk);
      pending.push(chunk);
      pauseStreams();
      void flushPending();
    };

    child.stdout?.on("data", (chunk: unknown) => {
      enqueue(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.stderr?.on("data", (chunk: unknown) => {
      enqueue(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });

    child.on("error", (error: Error) => {
      writeError = new RelayError("CODEX_FAILED", error.message, 502);
      childClosed = true;
      closeResolve();
      maybeResolveWriterIdle();
    });

    child.on("close", (code: number | null) => {
      childExitCode = code ?? 1;
      childClosed = true;
      closeResolve();
      maybeResolveWriterIdle();
    });

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    }, this.timeoutMs);

    await closePromise;
    clearTimeout(timeoutTimer);
    await writerIdle;
    if (forceKillTimer) clearTimeout(forceKillTimer);

    if (writeError) throw writeError;
    if (timedOut) throw new RelayError("CODEX_TIMEOUT", "Codex execution timed out", 504);
    if (childExitCode !== 0) throw new RelayError("CODEX_FAILED", `Codex exited with code ${childExitCode}`, 502);

    let raw: string;
    try { raw = await readFile(resultPath, "utf8"); }
    catch { throw new RelayError("RESULT_MISSING", "Codex did not write the required result file", 422); }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { throw new RelayError("RESULT_INVALID", "Codex result is not valid JSON", 422); }
    return { exitCode: childExitCode, result: validateCodexResult(parsed, job.request.requestId) };
  }
}
