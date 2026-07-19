import test from "node:test";
import assert from "node:assert/strict";
import { RedactedFanout, TRUNCATION_MARKER, type TranscriptSink } from "../src/execution/transcript.js";

class MemoryTranscript implements TranscriptSink {
  readonly chunks: Uint8Array[] = [];
  async write(data: Uint8Array): Promise<void> { this.chunks.push(Buffer.from(data)); }
  async sync(): Promise<void> {}
  async close(): Promise<void> {}
  text(): string { return Buffer.concat(this.chunks).toString("utf8"); }
}

test("normalized truncation never splits a UTF-8 code point", async () => {
  const live: Uint8Array[] = [];
  const transcript = new MemoryTranscript();
  const fanout = new RedactedFanout({ write: (data) => live.push(Buffer.from(data)) }, transcript, 2);

  await fanout.write("A🧪B\n");
  await fanout.finish();

  const liveText = Buffer.concat(live).toString("utf8");
  assert.equal(liveText, `A${TRUNCATION_MARKER}`);
  assert.equal(transcript.text(), liveText);
  assert.doesNotMatch(liveText, /�/u);
});
