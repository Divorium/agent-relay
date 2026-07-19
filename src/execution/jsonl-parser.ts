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

export class JsonlParser {
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private pending = "";

  constructor(
    private readonly onRecord: (record: JsonRecord) => void,
    private readonly maxRecordBytes = 16 * 1024 * 1024,
  ) {
    if (!Number.isSafeInteger(maxRecordBytes) || maxRecordBytes < 1 || maxRecordBytes > MAX_JSONL_RECORD_BYTES_HARD_LIMIT) {
      throw new CodexExecutionError("INVALID_CONFIGURATION", `MAX_JSONL_RECORD_BYTES must be between 1 and ${MAX_JSONL_RECORD_BYTES_HARD_LIMIT}`);
    }
  }

  write(chunk: Uint8Array): void {
    try {
      this.pending += this.decoder.decode(chunk, { stream: true });
    } catch (error) {
      throw this.failure(`invalid UTF-8: ${this.message(error)}`);
    }
    this.consumeLines();
    if (Buffer.byteLength(this.pending) > this.maxRecordBytes) {
      throw this.failure(`unfinished record exceeds ${this.maxRecordBytes} bytes`);
    }
  }

  end(): void {
    try {
      this.pending += this.decoder.decode();
    } catch (error) {
      throw this.failure(`invalid UTF-8: ${this.message(error)}`);
    }
    this.consumeLines();
    if (this.pending.trim()) this.parse(this.pending);
    this.pending = "";
  }

  private consumeLines(): void {
    let newline = this.pending.indexOf("\n");
    while (newline >= 0) {
      const line = this.pending.slice(0, newline).replace(/\r$/u, "");
      this.pending = this.pending.slice(newline + 1);
      if (line.trim()) this.parse(line);
      newline = this.pending.indexOf("\n");
    }
  }

  private parse(line: string): void {
    if (Buffer.byteLength(line) > this.maxRecordBytes) {
      throw this.failure(`record exceeds ${this.maxRecordBytes} bytes`);
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw this.failure(`malformed record: ${this.message(error)}`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw this.failure("record must be a JSON object");
    }
    this.onRecord(value as JsonRecord);
  }

  private failure(detail: string): CodexExecutionError {
    return new CodexExecutionError("CODEX_FAILED", `Invalid Codex JSONL: ${detail}`);
  }

  private message(error: unknown): string {
    return String(error);
  }
}

export class DiagnosticLineParser {
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private pending = "";
  private _maximumPendingBytes = 0;

  constructor(
    private readonly onLine: (line: string, continuation: boolean) => void,
    private readonly maxLineBytes = DEFAULT_DIAGNOSTIC_LINE_BYTES,
  ) {
    if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes < 4) throw new RangeError("maxLineBytes must be an integer of at least 4");
  }

  get pendingBytes(): number { return Buffer.byteLength(this.pending); }
  get maximumPendingBytes(): number { return this._maximumPendingBytes; }

  write(chunk: Uint8Array): void {
    for (let offset = 0; offset < chunk.length; offset += this.maxLineBytes) {
      try {
        this.pending += this.decoder.decode(chunk.subarray(offset, offset + this.maxLineBytes), { stream: true });
        this._maximumPendingBytes = Math.max(this._maximumPendingBytes, Buffer.byteLength(this.pending));
      } catch (error) {
        throw new CodexExecutionError("CODEX_FAILED", `Invalid Codex stderr UTF-8: ${String(error)}`);
      }
      this.consume(false);
    }
  }

  end(): void {
    try {
      this.pending += this.decoder.decode();
    } catch (error) {
      throw new CodexExecutionError("CODEX_FAILED", `Invalid Codex stderr UTF-8: ${String(error)}`);
    }
    this.consume(true);
  }

  private consume(final: boolean): void {
    let newline = this.pending.indexOf("\n");
    while (newline >= 0) {
      this.emitBounded(this.pending.slice(0, newline).replace(/\r$/u, ""));
      this.pending = this.pending.slice(newline + 1);
      newline = this.pending.indexOf("\n");
    }
    while (Buffer.byteLength(this.pending) > this.maxLineBytes) {
      const prefix = utf8StringPrefix(this.pending, this.maxLineBytes);
      this.onLine(prefix, true);
      this.pending = this.pending.slice(prefix.length);
    }
    if (final && this.pending) {
      this.emitBounded(this.pending);
      this.pending = "";
    }
  }

  private emitBounded(value: string): void {
    this.onLine(value, false);
  }
}

function utf8StringPrefix(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value);
  let end = Math.min(bytes.length, maxBytes);
  while (end > 0 && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}
