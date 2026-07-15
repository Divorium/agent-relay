import { dirname } from "node:path";
import type { JobRecord, JobStatus } from "../contracts/job.js";
import { RelayError } from "../contracts/errors.js";

const fs: any = await import("node:fs/promises");
type FileHandle = any;

interface OutputSnapshot {
  committedLength: number;
  version: number;
  terminal?: {
    kind: "clean";
    status: JobStatus;
  } | {
    kind: "error";
    error: RelayError;
  };
}

interface Waiter {
  observedVersion: number;
  resolve: (snapshot: OutputSnapshot) => void;
  reject: (error: RelayError) => void;
  cleanup: () => void;
}

interface OutputState {
  path: string;
  handle: FileHandle;
  committedLength: number;
  version: number;
  terminal?: OutputSnapshot["terminal"];
  waiters: Waiter[];
}

const READ_CHUNK_BYTES = 64 * 1024;

function isTerminalStatus(status: JobStatus): boolean {
  return status === "completed" || status === "failed" || status === "timed_out" || status === "interrupted";
}

function toRelayError(error: unknown, code: "OUTPUT_PREPARATION_FAILED" | "OUTPUT_WRITE_FAILED" | "OUTPUT_READ_FAILED", message: string): RelayError {
  if (error instanceof RelayError) return error;
  return new RelayError(code, message, 500);
}

async function writeFully(handle: FileHandle, buffer: Uint8Array, position: number): Promise<number> {
  let written = 0;
  while (written < buffer.length) {
    const result = await handle.write(buffer, written, buffer.length - written, position + written);
    if (result.bytesWritten <= 0) throw new Error("write returned no progress");
    written += result.bytesWritten;
  }
  return written;
}

async function readFully(handle: FileHandle, buffer: Uint8Array, position: number): Promise<number> {
  let readBytes = 0;
  while (readBytes < buffer.length) {
    const result = await handle.read(buffer, readBytes, buffer.length - readBytes, position + readBytes);
    if (result.bytesRead <= 0) break;
    readBytes += result.bytesRead;
  }
  return readBytes;
}

export class OutputStore {
  private readonly states = new Map<string, OutputState>();

  constructor(private readonly stateDir: string) {}

  private snapshot(state: OutputState): OutputSnapshot {
    return {
      committedLength: state.committedLength,
      version: state.version,
      ...(state.terminal === undefined ? {} : { terminal: state.terminal }),
    };
  }

  private state(jobId: string): OutputState {
    const state = this.states.get(jobId);
    if (!state) throw new RelayError("OUTPUT_READ_FAILED", "Output state is unavailable", 500);
    return state;
  }

  private wakeWaiters(state: OutputState): void {
    const pending = state.waiters.splice(0);
    for (const waiter of pending) {
      waiter.cleanup();
      if (state.terminal?.kind === "error") {
        waiter.reject(state.terminal.error);
        continue;
      }
      if (state.version !== waiter.observedVersion || state.terminal?.kind === "clean") {
        waiter.resolve(this.snapshot(state));
        continue;
      }
      state.waiters.push(waiter);
    }
  }

  async prepare(jobId: string, outputPath: string): Promise<void> {
    if (this.states.has(jobId)) throw new RelayError("OUTPUT_PREPARATION_FAILED", "Output state already exists", 500);
    await fs.mkdir(dirname(outputPath), { recursive: true });
    try {
      const handle = await fs.open(outputPath, "wx+", 0o600);
      this.states.set(jobId, {
        path: outputPath,
        handle,
        committedLength: 0,
        version: 0,
        waiters: [],
      });
    } catch (error) {
      throw toRelayError(error, "OUTPUT_PREPARATION_FAILED", "Failed to prepare job output");
    }
  }

  async attach(record: JobRecord): Promise<void> {
    if (this.states.has(record.id)) return;
    await fs.mkdir(dirname(record.outputPath), { recursive: true });
    const terminal = isTerminalStatus(record.status);
    let handle: FileHandle;
    try {
      if (terminal) {
        try {
          handle = await fs.open(record.outputPath, "r+", 0o600);
        } catch (error: any) {
          if (error?.code !== "ENOENT") throw error;
          await fs.writeFile(record.outputPath, "", { mode: 0o600 });
          handle = await fs.open(record.outputPath, "r+", 0o600);
        }
      } else {
        handle = await fs.open(record.outputPath, "r+", 0o600);
      }
      const fileStat = await handle.stat();
      this.states.set(record.id, {
        path: record.outputPath,
        handle,
        committedLength: fileStat.size,
        version: 0,
        ...(terminal ? { terminal: { kind: "clean", status: record.status } as const } : {}),
        waiters: [],
      });
    } catch (error) {
      throw toRelayError(error, "OUTPUT_READ_FAILED", "Failed to attach job output");
    }
  }

  peek(jobId: string): OutputSnapshot {
    return this.snapshot(this.state(jobId));
  }

  async append(jobId: string, chunk: Uint8Array): Promise<void> {
    const state = this.state(jobId);
    if (state.terminal?.kind === "error") throw state.terminal.error;
    if (state.terminal?.kind === "clean") throw new RelayError("OUTPUT_WRITE_FAILED", "Output is already closed", 500);
    try {
      const written = await writeFully(state.handle, chunk, state.committedLength);
      state.committedLength += written;
      state.version += 1;
      this.wakeWaiters(state);
    } catch (error) {
      throw toRelayError(error, "OUTPUT_WRITE_FAILED", "Failed to persist job output");
    }
  }

  async read(jobId: string, offset: number, maxBytes = READ_CHUNK_BYTES): Promise<Uint8Array> {
    const state = this.state(jobId);
    if (offset > state.committedLength) throw new RelayError("OUTPUT_READ_FAILED", "Requested offset is beyond committed output", 416);
    const available = Math.min(maxBytes, state.committedLength - offset);
    if (available <= 0) return Buffer.alloc(0);
    try {
      const buffer = Buffer.allocUnsafe(available);
      const readBytes = await readFully(state.handle, buffer, offset);
      return buffer.subarray(0, readBytes);
    } catch (error) {
      throw toRelayError(error, "OUTPUT_READ_FAILED", "Failed to read job output");
    }
  }

  async waitForChange(jobId: string, observedVersion: number, signal?: AbortSignal): Promise<OutputSnapshot> {
    const state = this.state(jobId);
    if (state.terminal?.kind === "error") throw state.terminal.error;
    if (state.version !== observedVersion || state.terminal?.kind === "clean") return this.snapshot(state);
    return await new Promise<OutputSnapshot>((resolve, reject) => {
      const cleanup = (): void => signal?.removeEventListener("abort", onAbort);
      const onAbort = (): void => {
        const index = state.waiters.findIndex((waiter) => waiter.resolve === resolve && waiter.reject === reject);
        if (index >= 0) state.waiters.splice(index, 1);
        cleanup();
        reject(new RelayError("OUTPUT_READ_FAILED", "Output reader was cancelled", 500));
      };
      if (signal?.aborted) {
        reject(new RelayError("OUTPUT_READ_FAILED", "Output reader was cancelled", 500));
        return;
      }
      state.waiters.push({ observedVersion, resolve, reject, cleanup });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  async complete(jobId: string, status: JobStatus): Promise<void> {
    const state = this.state(jobId);
    state.terminal = { kind: "clean", status };
    state.version += 1;
    this.wakeWaiters(state);
  }

  async fail(jobId: string, error: RelayError): Promise<void> {
    const state = this.state(jobId);
    state.terminal = { kind: "error", error };
    state.version += 1;
    this.wakeWaiters(state);
  }

  async discard(jobId: string): Promise<void> {
    const state = this.states.get(jobId);
    if (!state) return;
    this.states.delete(jobId);
    state.waiters.splice(0).forEach((waiter) => {
      waiter.cleanup();
      waiter.reject(new RelayError("OUTPUT_WRITE_FAILED", "Output state was discarded", 500));
    });
    await state.handle.close().catch(() => undefined);
    await fs.rm(state.path, { force: true }).catch(() => undefined);
  }

  async close(): Promise<void> {
    const states = [...this.states.values()];
    this.states.clear();
    for (const state of states) {
      state.waiters.splice(0).forEach((waiter) => {
        waiter.cleanup();
        waiter.reject(new RelayError("OUTPUT_READ_FAILED", "Output store is closed", 500));
      });
      await state.handle.close().catch(() => undefined);
    }
  }
}
