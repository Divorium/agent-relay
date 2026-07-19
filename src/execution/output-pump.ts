import { splitNormalizedSegments, MAX_NORMALIZED_SEGMENT_BYTES } from "./output-renderer.js";
import type { RedactedFanout } from "./transcript.js";

export const DEFAULT_QUEUE_HIGH_WATERMARK = 256 * 1024;
export const DEFAULT_QUEUE_LOW_WATERMARK = 128 * 1024;

export interface PausableSource {
  pause(): unknown;
  resume(): unknown;
}

interface QueuedSegment { value: string; bytes: number; }

/** A single consumer with asynchronous, byte-bounded admission. */
export class BoundedOutputPump {
  private readonly queue: QueuedSegment[] = [];
  private queuedBytes = 0;
  private consuming = false;
  private stopped = false;
  private idleWaiters: Array<() => void> = [];
  private capacityWaiters: Array<() => void> = [];
  private lowWaiters: Array<() => void> = [];
  private _maximumQueuedBytes = 0;

  constructor(
    private readonly fanout: RedactedFanout,
    private readonly onFailure: (error: unknown) => void,
    private readonly onTruncated: () => void,
    private readonly highWatermark = DEFAULT_QUEUE_HIGH_WATERMARK,
    private readonly lowWatermark = DEFAULT_QUEUE_LOW_WATERMARK,
    private readonly maxSegmentBytes = MAX_NORMALIZED_SEGMENT_BYTES,
  ) {
    if (lowWatermark < 0 || highWatermark <= lowWatermark) throw new RangeError("queue watermarks are invalid");
  }

  get maximumQueuedBytes(): number { return this._maximumQueuedBytes; }
  get pendingBytes(): number { return this.queuedBytes; }
  async enqueue(values: Iterable<string>): Promise<void> {
    for (const value of values) {
      for (const segment of splitNormalizedSegments(value, this.maxSegmentBytes)) {
        await this.waitForCapacity();
        if (this.stopped) return;
        const bytes = Buffer.byteLength(segment);
        this.queue.push({ value: segment, bytes });
        this.queuedBytes += bytes;
        this._maximumQueuedBytes = Math.max(this._maximumQueuedBytes, this.queuedBytes);
        this.startConsumer();
      }
    }
  }

  async waitUntilLow(): Promise<void> {
    if (this.stopped || this.queuedBytes < this.lowWatermark) return;
    await new Promise<void>((resolvePromise) => this.lowWaiters.push(resolvePromise));
  }

  discard(): void {
    this.stopped = true;
    this.queue.length = 0;
    this.queuedBytes = 0;
    this.releaseCapacity();
    this.resolveLowWaiters();
    this.resolveIfIdle();
  }

  async finish(): Promise<void> {
    if (!this.consuming && this.queue.length === 0) return;
    await new Promise<void>((resolvePromise) => this.idleWaiters.push(resolvePromise));
  }

  private async waitForCapacity(): Promise<void> {
    while (!this.stopped && this.queuedBytes >= this.highWatermark) {
      await new Promise<void>((resolvePromise) => this.capacityWaiters.push(resolvePromise));
    }
  }

  private startConsumer(): void {
    if (this.consuming || this.stopped) return;
    this.consuming = true;
    void this.consume();
  }

  private async consume(): Promise<void> {
    try {
      while (!this.stopped) {
        const segment = this.queue.shift();
        if (!segment) break;
        this.queuedBytes -= segment.bytes;
        this.releaseCapacity();
        if (this.queuedBytes < this.lowWatermark) this.resolveLowWaiters();
        await this.fanout.write(segment.value);
        if (this.fanout.isTruncated) {
          this.onTruncated();
          this.discard();
          break;
        }
      }
    } catch (error) {
      this.discard();
      this.onFailure(error);
    } finally {
      this.consuming = false;
      this.resolveIfIdle();
    }
  }

  private releaseCapacity(): void {
    const waiters = this.capacityWaiters;
    this.capacityWaiters = [];
    for (const resolvePromise of waiters) resolvePromise();
  }

  private resolveLowWaiters(): void {
    const waiters = this.lowWaiters;
    this.lowWaiters = [];
    for (const resolvePromise of waiters) resolvePromise();
  }

  private resolveIfIdle(): void {
    if (this.consuming) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolvePromise of waiters) resolvePromise();
  }
}

interface RawInput { source: PausableSource; chunk: Uint8Array; released: boolean; }

/** Serializes stdout/stderr callback arrival while retaining at most one chunk per paused source. */
export class OrderedInputPump {
  private readonly queue: RawInput[] = [];
  private current: RawInput | undefined;
  private consuming = false;
  private stopped = false;
  private waiters: Array<() => void> = [];

  constructor(
    private readonly output: BoundedOutputPump,
    private readonly processChunk: (source: PausableSource, chunk: Uint8Array) => Promise<void>,
    private readonly onFailure: (error: unknown) => void,
  ) {}

  accept(source: PausableSource, chunk: Uint8Array): void {
    if (this.stopped) return;
    source.pause();
    this.queue.push({ source, chunk, released: false });
    this.startConsumer();
  }

  discard(): void {
    this.stopped = true;
    if (this.current) this.release(this.current);
    for (const input of this.queue) this.release(input);
    this.queue.length = 0;
    this.resolveIfIdle();
  }

  async finish(): Promise<void> {
    if (!this.consuming && this.queue.length === 0) return;
    await new Promise<void>((resolvePromise) => this.waiters.push(resolvePromise));
  }

  private startConsumer(): void {
    if (this.consuming || this.stopped) return;
    this.consuming = true;
    void this.consume();
  }

  private async consume(): Promise<void> {
    try {
      while (!this.stopped) {
        const input = this.queue.shift();
        if (!input) break;
        this.current = input;
        await this.processChunk(input.source, input.chunk);
        await this.output.waitUntilLow();
        this.release(input);
        this.current = undefined;
      }
    } catch (error) {
      this.discard();
      this.onFailure(error);
    } finally {
      this.current = undefined;
      this.consuming = false;
      this.resolveIfIdle();
    }
  }

  private release(input: RawInput): void {
    if (input.released) return;
    input.released = true;
    input.source.resume();
  }

  private resolveIfIdle(): void {
    if (this.consuming) return;
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolvePromise of waiters) resolvePromise();
  }
}
