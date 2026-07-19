import { lstat, open, realpath } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { StreamingRedactor } from "../security/redaction.js";
import { CodexExecutionError } from "./errors.js";

export const TRUNCATION_MARKER = "\n[OUTPUT TRUNCATED]\n";

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

export interface LiveSink { write(data: Uint8Array): unknown; }

function utf8Prefix(bytes: Uint8Array, limit: number): Uint8Array {
  let end = Math.min(Math.max(limit, 0), bytes.length);
  if (end === bytes.length) return bytes;
  while (end > 0) {
    // The early return above guarantees end is a valid index here.
    const next = bytes[end]!;
    if ((next & 0xc0) !== 0x80) break;
    end -= 1;
  }
  return bytes.subarray(0, end);
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
  private acceptedBytes = 0;
  private truncated = false;
  private failure: unknown;

  constructor(
    private readonly live: LiveSink,
    private readonly transcript: TranscriptSink,
    private readonly maxOutputBytes: number,
  ) {}

  async write(value: string): Promise<void> {
    if (this.failure || this.truncated) return;
    await this.accept(this.redactor.write(Buffer.from(value)));
  }

  async finish(): Promise<void> {
    if (!this.failure && !this.truncated) await this.accept(this.redactor.end());
    else this.redactor.discard();
    try { await this.transcript.sync(); } catch (error) { this.failure ??= error; }
    try { await this.transcript.close(); } catch (error) { this.failure ??= error; }
    if (this.failure) {
      const detail = this.failure instanceof Error ? this.failure.message : String(this.failure);
      throw new CodexExecutionError("CODEX_FAILED", `Codex transcript failed: ${detail}`);
    }
  }

  private async accept(value: string): Promise<void> {
    if (!value || this.failure || this.truncated) return;
    const bytes = Buffer.from(value);
    const remaining = this.maxOutputBytes - this.acceptedBytes;
    if (bytes.length <= remaining) {
      await this.emit(bytes);
      this.acceptedBytes += bytes.length;
      return;
    }
    const accepted = utf8Prefix(bytes, remaining);
    if (accepted.length > 0) await this.emit(accepted);
    this.acceptedBytes += accepted.length;
    this.truncated = true;
    await this.emit(Buffer.from(TRUNCATION_MARKER));
  }

  private async emit(bytes: Uint8Array): Promise<void> {
    if (this.failure) return;
    try {
      this.live.write(bytes);
      await this.transcript.write(bytes);
    } catch (error) {
      this.failure = error;
    }
  }
}
