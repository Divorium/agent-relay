import { CodexExecutionError } from "./errors.js";

export type JsonRecord = Record<string, unknown>;

export class JsonlParser {
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private pending = "";

  constructor(
    private readonly onRecord: (record: JsonRecord) => void,
    private readonly maxRecordBytes = 1_048_576,
  ) {}

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

  constructor(private readonly onLine: (line: string) => void) {}

  write(chunk: Uint8Array): void {
    try {
      this.pending += this.decoder.decode(chunk, { stream: true });
    } catch (error) {
      throw new CodexExecutionError("CODEX_FAILED", `Invalid Codex stderr UTF-8: ${String(error)}`);
    }
    this.consume(false);
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
      this.onLine(this.pending.slice(0, newline).replace(/\r$/u, ""));
      this.pending = this.pending.slice(newline + 1);
      newline = this.pending.indexOf("\n");
    }
    if (final && this.pending) {
      this.onLine(this.pending);
      this.pending = "";
    }
  }
}
