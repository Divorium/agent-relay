import { splitNormalizedSegments, MAX_NORMALIZED_SEGMENT_BYTES } from "./output-renderer.js";
import type { RedactedFanout } from "./transcript.js";

export const DEFAULT_QUEUE_HIGH_WATERMARK = 256 * 1024;
export const DEFAULT_QUEUE_LOW_WATERMARK = 128 * 1024;

export interface PausableSource {
  pause(): unknown;
  resume(): unknown;
}

interface QueuedSegment { value: string; bytes: number; }

/** A single consumer with byte-based flow control for normalized output. */
export class BoundedOutputPump {
  private readonly queue: QueuedSegment[] = [];
  private queuedBytes = 0;
  private consuming = false;
  private paused = false;
  private stopped = false;
  private waiters: Array<() => void> = [];
  private _maximumQueuedBytes = 0;

  constructor(
    private readonly fanout: RedactedFanout,
    private readonly sources: PausableSource[],
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

  enqueue(values: string[]): void {
    if (this.stopped) return;
    for (const value of values) {
      for (const segment of splitNormalizedSegments(value, this.maxSegmentBytes)) {
        const bytes = Buffer.byteLength(segment);
        this.queue.push({ value: segment, bytes });
        this.queuedBytes += bytes;
        this._maximumQueuedBytes = Math.max(this._maximumQueuedBytes, this.queuedBytes);
        if (!this.paused && this.queuedBytes >= this.highWatermark) this.pause();
      }
    }
    this.startConsumer();
  }

  discard(): void {
    this.stopped = true;
    this.queue.length = 0;
    this.queuedBytes = 0;
    this.resume();
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
        const segment = this.queue.shift();
        if (!segment) break;
        this.queuedBytes -= segment.bytes;
        if (this.paused && this.queuedBytes < this.lowWatermark) this.resume();
        await this.fanout.write(segment.value);
        if (this.fanout.isTruncated) {
          this.onTruncated();
          this.stopped = true;
          this.queue.length = 0;
          this.queuedBytes = 0;
          this.resume();
          break;
        }
      }
    } catch (error) {
      this.stopped = true;
      this.queue.length = 0;
      this.queuedBytes = 0;
      this.resume();
      this.onFailure(error);
    } finally {
      this.consuming = false;
      this.resolveIfIdle();
    }
  }

  private pause(): void {
    this.paused = true;
    for (const source of this.sources) source.pause();
  }

  private resume(): void {
    if (!this.paused) return;
    this.paused = false;
    for (const source of this.sources) source.resume();
  }

  private resolveIfIdle(): void {
    if (this.consuming) return;
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolvePromise of waiters) resolvePromise();
  }
}
