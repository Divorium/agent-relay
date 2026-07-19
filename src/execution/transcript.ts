import { lstat, open, realpath } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { StreamingRedactor } from "../security/redaction.js";
import { CodexExecutionError } from "./errors.js";

export const TRUNCATION_MARKER = "[codex] [OUTPUT TRUNCATED]\n";

export interface TranscriptSink {
  write(data: Uint8Array): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

class FileTranscriptSink implements TranscriptSink {
  constructor(private readonly handle: FileHandle) {}
  async write(data: Uint8Array): Promise<void> { await this.handle.writeFile(data); }
  async sync(): Promise<void> { await this.handle.sync(); }
  async close(): Promise<void> { await this.handle.close(); }
}

function contained(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== "" && path !== ".." && !path.startsWith("../");
}

export interface LiveSink {
  write(data: Uint8Array, callback: (error?: Error | null) => void): unknown;
  once(event: string, listener: (...args: any[]) => void): unknown;
  removeListener(event: string, listener: (...args: any[]) => void): unknown;
  destroyed?: boolean;
  writableEnded?: boolean;
}

export async function createTranscriptSink(runnerTemp: string, transcriptPath: string): Promise<TranscriptSink> {
  const lexicalRoot = resolve(runnerTemp);
  const canonicalRoot = await realpath(runnerTemp);
  const candidate = resolve(transcriptPath);
  if (!contained(lexicalRoot, candidate)) throw new CodexExecutionError("INVALID_CONFIGURATION", "CODEX_TRANSCRIPT_PATH must be below RUNNER_TEMP");
  const canonicalParent = await realpath(dirname(candidate));
  if (!contained(canonicalRoot, canonicalParent) && canonicalParent !== canonicalRoot) {
    throw new CodexExecutionError("INVALID_CONFIGURATION", "CODEX_TRANSCRIPT_PATH parent escapes RUNNER_TEMP");
  }
  try {
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink()) throw new CodexExecutionError("INVALID_CONFIGURATION", "CODEX_TRANSCRIPT_PATH must not be a symlink");
    throw new CodexExecutionError("INVALID_CONFIGURATION", "CODEX_TRANSCRIPT_PATH must not already exist");
  } catch (error) {
    if (error instanceof CodexExecutionError) throw error;
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  return new FileTranscriptSink(await open(candidate, "wx", 0o600));
}

export class RedactedFanout {
  private readonly redactor = new StreamingRedactor();
  private readonly liveWriter: AsyncLiveWriter;
  private acceptedBytes = 0;
  private truncated = false;
  private failure: unknown;
  private pendingLine = "";

  constructor(
    live: LiveSink,
    private readonly transcript: TranscriptSink,
    private readonly maxOutputBytes: number,
  ) { this.liveWriter = new AsyncLiveWriter(live); }

  get isTruncated(): boolean { return this.truncated; }

  async write(value: string): Promise<void> {
    if (this.failure) throw this.failure;
    if (this.truncated) return;
    await this.accept(this.redactor.write(Buffer.from(value)));
  }

  async finish(): Promise<void> {
    if (!this.failure && !this.truncated) {
      await this.accept(this.redactor.end());
      if (this.pendingLine) await this.acceptCompleteLine(`${this.pendingLine}\n`);
      this.pendingLine = "";
    }
    else this.redactor.discard();
    try { this.liveWriter.finish(); } catch (error) { this.failure ??= this.liveFailure(error); }
    try { await this.transcript.sync(); } catch (error) { this.failure ??= this.transcriptFailure(error); }
    try { await this.transcript.close(); } catch (error) { this.failure ??= this.transcriptFailure(error); }
    if (this.failure) {
      throw this.failure;
    }
  }

  private async accept(value: string): Promise<void> {
    if (!value) return;
    this.pendingLine += value;
    let newline = this.pendingLine.indexOf("\n");
    while (newline >= 0 && !this.truncated) {
      const completeLine = this.pendingLine.slice(0, newline + 1);
      this.pendingLine = this.pendingLine.slice(newline + 1);
      await this.acceptCompleteLine(completeLine);
      newline = this.pendingLine.indexOf("\n");
    }
  }

  private async acceptCompleteLine(value: string): Promise<void> {
    const bytes = Buffer.from(value);
    const remaining = this.maxOutputBytes - this.acceptedBytes;
    if (bytes.length <= remaining) {
      await this.emit(bytes);
      this.acceptedBytes += bytes.length;
      return;
    }
    this.truncated = true;
    this.pendingLine = "";
    await this.emit(Buffer.from(TRUNCATION_MARKER));
  }

  private async emit(bytes: Uint8Array): Promise<void> {
    try {
      await Promise.all([
        this.liveWriter.write(bytes).catch((error: unknown) => { throw this.liveFailure(error); }),
        this.transcript.write(bytes).catch((error: unknown) => { throw this.transcriptFailure(error); }),
      ]);
    } catch (error) {
      this.failure = error;
      throw error;
    }
  }

  private liveFailure(error: unknown): CodexExecutionError {
    const detail = error instanceof Error ? error.message : String(error);
    return new CodexExecutionError("CODEX_FAILED", `Codex live output failed: ${detail}`);
  }

  private transcriptFailure(error: unknown): CodexExecutionError {
    const detail = error instanceof Error ? error.message : String(error);
    return new CodexExecutionError("CODEX_FAILED", `Codex transcript failed: ${detail}`);
  }
}

class AsyncLiveWriter {
  private terminalFailure: unknown;
  private readonly onError = (error: unknown): void => { this.terminalFailure ??= error; };
  private readonly onClose = (): void => { this.terminalFailure ??= new Error("live output closed prematurely"); };

  constructor(private readonly live: LiveSink) {
    live.once("error", this.onError);
    live.once("close", this.onClose);
  }

  async write(bytes: Uint8Array): Promise<void> {
    this.assertOpen();
    await writeLive(this.live, bytes);
    this.assertOpen();
  }

  finish(): void {
    this.live.removeListener("error", this.onError);
    this.live.removeListener("close", this.onClose);
    this.assertOpen();
  }

  private assertOpen(): void {
    if (this.terminalFailure) throw this.terminalFailure;
    if (this.live.destroyed || this.live.writableEnded) throw new Error("live output closed before write");
  }
}

async function writeLive(live: LiveSink, bytes: Uint8Array): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    let callbackDone = false;
    let drainDone = true;
    let writeReturned = false;
    let settled = false;
    const cleanup = (): void => {
      live.removeListener("error", onError);
      live.removeListener("close", onClose);
      live.removeListener("drain", onDrain);
    };
    const finish = (): void => {
      if (!settled && writeReturned && callbackDone && drainDone) {
        settled = true;
        cleanup();
        resolvePromise();
      }
    };
    const fail = (error: unknown): void => {
      if (!settled) {
        settled = true;
        cleanup();
        rejectPromise(error);
      }
    };
    const onError = (error: unknown): void => fail(error);
    const onClose = (): void => fail(new Error("live output closed before the write completed"));
    const onDrain = (): void => { drainDone = true; finish(); };
    live.once("error", onError);
    live.once("close", onClose);
    try {
      const accepted = live.write(bytes, (error?: Error | null) => {
        if (error) fail(error);
        else { callbackDone = true; finish(); }
      });
      if (accepted === false) {
        drainDone = false;
        live.once("drain", onDrain);
      }
      writeReturned = true;
      finish();
    } catch (error) {
      fail(error);
    }
  });
}
