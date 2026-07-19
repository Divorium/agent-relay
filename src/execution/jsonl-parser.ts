import { CodexExecutionError } from "./errors.js";

export type JsonRecord = Record<string, unknown>;
export const MIN_JSONL_RECORD_BYTES = 1_048_576;
export const MAX_JSONL_RECORD_BYTES_HARD_LIMIT = 256 * 1024 * 1024;
export const DEFAULT_DIAGNOSTIC_LINE_BYTES = 16 * 1024;

export function deriveJsonlRecordBytes(maxOutputBytes: number): number {
  const derived = Math.max(16 * 1024 * 1024, 8 * maxOutputBytes + 1024 * 1024);
  if (!Number.isSafeInteger(derived) || derived > MAX_JSONL_RECORD_BYTES_HARD_LIMIT) {
    throw new CodexExecutionError("INVALID_CONFIGURATION", `MAX_OUTPUT_BYTES requires a JSONL budget above ${MAX_JSONL_RECORD_BYTES_HARD_LIMIT} bytes`);
  }
  return derived;
}

/** A byte-oriented JSONL framer. Each input byte is examined exactly once. */
export class JsonlParser {
  private chunks: Uint8Array[] = [];
  private _pendingBytes = 0;
  private _maximumPendingBytes = 0;
  private _scannedBytes = 0;

  constructor(private readonly maxRecordBytes = 16 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxRecordBytes) || maxRecordBytes < 1 || maxRecordBytes > MAX_JSONL_RECORD_BYTES_HARD_LIMIT) {
      throw new CodexExecutionError("INVALID_CONFIGURATION", `MAX_JSONL_RECORD_BYTES must be between 1 and ${MAX_JSONL_RECORD_BYTES_HARD_LIMIT}`);
    }
  }

  get pendingBytes(): number { return this._pendingBytes; }
  get pendingChunks(): number { return this.chunks.length; }
  get maximumPendingBytes(): number { return this._maximumPendingBytes; }
  get scannedBytes(): number { return this._scannedBytes; }

  *write(input: Uint8Array): Generator<JsonRecord> {
    let start = 0;
    try {
      for (let index = 0; index < input.length; index += 1) {
        this._scannedBytes += 1;
        const pendingRecordBytes = this._pendingBytes + index - start + (input[index] === 0x0a ? 0 : 1);
        if (pendingRecordBytes > this.maxRecordBytes) {
          throw this.failure(`unfinished record exceeds ${this.maxRecordBytes} bytes`);
        }
        if (input[index] !== 0x0a) continue;
        this.append(input.subarray(start, index));
        const record = this.takeRecord(true);
        if (record) yield record;
        start = index + 1;
      }
      this.append(input.subarray(start));
    } catch (error) {
      this.release();
      throw error;
    }
  }

  *end(): Generator<JsonRecord> {
    try {
      if (this._pendingBytes > 0) {
        const record = this.takeRecord(false);
        if (record) yield record;
      }
    } catch (error) {
      this.release();
      throw error;
    }
    this.release();
  }

  private append(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    this.chunks.push(chunk);
    this._pendingBytes += chunk.length;
    this._maximumPendingBytes = Math.max(this._maximumPendingBytes, this._pendingBytes);
  }

  private takeRecord(stripCarriageReturn: boolean): JsonRecord | undefined {
    let bytes = Buffer.concat(this.chunks, this._pendingBytes);
    this.release();
    if (stripCarriageReturn && bytes.at(-1) === 0x0d) bytes = bytes.subarray(0, -1);
    let line: string;
    try {
      line = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      throw this.failure(`invalid UTF-8: ${String(error)}`);
    }
    if (!line.trim()) return undefined;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw this.failure(`malformed record: ${String(error)}`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw this.failure("record must be a JSON object");
    }
    return value as JsonRecord;
  }

  private release(): void {
    this.chunks = [];
    this._pendingBytes = 0;
  }

  private failure(detail: string): CodexExecutionError {
    return new CodexExecutionError("CODEX_FAILED", `Invalid Codex JSONL: ${detail}`);
  }
}

export interface DiagnosticChunk { value: string; continuation: boolean; }

export class DiagnosticLineParser {
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private pending = "";
  private _maximumPendingBytes = 0;

  constructor(private readonly maxLineBytes = DEFAULT_DIAGNOSTIC_LINE_BYTES) {
    if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes < 4) throw new RangeError("maxLineBytes must be an integer of at least 4");
  }

  get pendingBytes(): number { return Buffer.byteLength(this.pending); }
  get maximumPendingBytes(): number { return this._maximumPendingBytes; }

  *write(chunk: Uint8Array): Generator<DiagnosticChunk> {
    for (let offset = 0; offset < chunk.length; offset += this.maxLineBytes) {
      try {
        this.pending += this.decoder.decode(chunk.subarray(offset, offset + this.maxLineBytes), { stream: true });
        this._maximumPendingBytes = Math.max(this._maximumPendingBytes, Buffer.byteLength(this.pending));
      } catch (error) {
        this.pending = "";
        throw new CodexExecutionError("CODEX_FAILED", `Invalid Codex stderr UTF-8: ${String(error)}`);
      }
      yield* this.consume(false);
    }
  }

  *end(): Generator<DiagnosticChunk> {
    try {
      this.pending += this.decoder.decode();
    } catch (error) {
      this.pending = "";
      throw new CodexExecutionError("CODEX_FAILED", `Invalid Codex stderr UTF-8: ${String(error)}`);
    }
    yield* this.consume(true);
  }

  private *consume(final: boolean): Generator<DiagnosticChunk> {
    let newline = this.pending.indexOf("\n");
    while (newline >= 0) {
      yield { value: this.pending.slice(0, newline).replace(/\r$/u, ""), continuation: false };
      this.pending = this.pending.slice(newline + 1);
      newline = this.pending.indexOf("\n");
    }
    while (Buffer.byteLength(this.pending) > this.maxLineBytes) {
      const prefix = utf8StringPrefix(this.pending, this.maxLineBytes);
      yield { value: prefix, continuation: true };
      this.pending = this.pending.slice(prefix.length);
    }
    if (final && this.pending) {
      yield { value: this.pending, continuation: false };
      this.pending = "";
    }
  }
}

function utf8StringPrefix(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value);
  let end = Math.min(bytes.length, maxBytes);
  while (end > 0 && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}
