import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexEventNormalizer } from "../src/execution/codex-normalizer.js";
import { DiagnosticLineParser, JsonlParser, type JsonRecord } from "../src/execution/jsonl-parser.js";
import { createTranscriptSink, RedactedFanout, TRUNCATION_MARKER, type TranscriptSink } from "../src/execution/transcript.js";
import { CodexExecutionError } from "../src/execution/errors.js";

function parseChunks(chunks: Uint8Array[], max?: number): JsonRecord[] {
  const records: JsonRecord[] = [];
  const parser = new JsonlParser((value) => records.push(value), max);
  for (const chunk of chunks) parser.write(chunk);
  parser.end();
  return records;
}

function bytes(...values: string[]): Uint8Array[] { return values.map((value) => Buffer.from(value)); }

test("installed Codex 0.144.4 fixture frames multiple records and split UTF-8", async () => {
  const fixture = await readFile(join(process.cwd(), "test", "fixtures", "codex-0.144.4.jsonl"), "utf8");
  const encoded = Buffer.from(fixture.replace("Sample complete.", "Sample 🧪 complete."));
  const split = encoded.indexOf(Buffer.from("🧪")) + 2;
  const records = parseChunks([encoded.subarray(0, 40), encoded.subarray(40, split), encoded.subarray(split)]);
  assert.equal(records.length, 8);
  assert.equal(records[7]?.type, "turn.completed");
});

test("JSONL parser validates final records, sizes, objects and UTF-8", () => {
  assert.deepEqual(parseChunks(bytes("\n{\"type\":\"one\"}\r\n{\"type\":\"two\"}")), [{ type: "one" }, { type: "two" }]);
  for (const input of ["{", "42", "[]"]) {
    assert.throws(() => parseChunks(bytes(input)), (error: unknown) => error instanceof CodexExecutionError && /Invalid Codex JSONL/u.test(error.message));
  }
  assert.throws(() => parseChunks(bytes("{\"long\":\"12345\n"), 4), /exceeds 4 bytes/u);
  assert.throws(() => parseChunks(bytes("12345"), 4), /unfinished record exceeds 4 bytes/u);
  assert.throws(() => parseChunks([Uint8Array.from([0xff])]), /invalid UTF-8/u);
  const parser = new JsonlParser(() => undefined);
  parser.write(Buffer.from("{"));
  assert.throws(() => parser.end(), /malformed record/u);
  const invalidEnd = new JsonlParser(() => undefined);
  invalidEnd.write(Uint8Array.from([0xe2]));
  assert.throws(() => invalidEnd.end(), /invalid UTF-8/u);
});

test("stderr diagnostics preserve line framing and reject invalid UTF-8", () => {
  const lines: string[] = [];
  const parser = new DiagnosticLineParser((line) => lines.push(line));
  parser.write(Buffer.from("first\r\nsec"));
  parser.write(Buffer.from("ond"));
  parser.end();
  assert.deepEqual(lines, ["first", "second"]);
  assert.throws(() => new DiagnosticLineParser(() => undefined).write(Uint8Array.from([0xff])), /stderr UTF-8/u);
  const invalidEnd = new DiagnosticLineParser(() => undefined);
  invalidEnd.write(Uint8Array.from([0xe2]));
  assert.throws(() => invalidEnd.end(), /stderr UTF-8/u);
});

test("normalizer renders installed event lifecycles incrementally", async () => {
  const fixture = await readFile(join(process.cwd(), "test", "fixtures", "codex-0.144.4.jsonl"), "utf8");
  const events = parseChunks(bytes(fixture));
  const normalizer = new CodexEventNormalizer();
  const output = events.flatMap((event) => normalizer.normalize(event)).join("");
  assert.match(output, /thread started[\s\S]*turn started/u);
  assert.equal(output.match(/command started/g)?.length, 1);
  assert.equal(output.match(/sample-output/g)?.length, 2);
  assert.equal(output.match(/file add: sample\.txt/g)?.length, 1);
  assert.equal(output.match(/assistant: Sample complete\./g)?.length, 1);
  assert.match(output, /usage: input=100 cached=25 output=20 reasoning=5/u);
});

test("normalizer does not replay cumulative command, patch or message content", () => {
  const normalizer = new CodexEventNormalizer();
  const event = (stage: string, item: JsonRecord): JsonRecord => ({ type: `item.${stage}`, item });
  const command = (id: string, aggregate: string, status = "in_progress", exit: number | null = null): JsonRecord => ({ id, type: "command_execution", command: "echo same", aggregated_output: aggregate, exit_code: exit, status });
  const output = [
    event("started", command("a", "")), event("updated", command("a", "same")), event("completed", command("a", "same text", "completed", 0)),
    event("started", command("b", "")), event("completed", command("b", "same text", "completed", 0)),
    event("started", { id: "f", type: "file_change", changes: [{ path: "a.txt", kind: "update", patch: "one" }], status: "in_progress" }),
    event("updated", { id: "f", type: "file_change", changes: [{ path: "a.txt", kind: "update", patch: "one two" }, { path: "b.txt", kind: "add" }], status: "in_progress" }),
    event("completed", { id: "f", type: "file_change", changes: [{ path: "a.txt", kind: "update", patch: "one two" }, { path: "b.txt", kind: "add" }], status: "completed" }),
    event("started", { id: "m", type: "agent_message", text: "same" }),
    event("updated", { id: "m", type: "agent_message", text: "same text" }),
    event("completed", { id: "m", type: "agent_message", text: "same text" }),
  ].flatMap((value) => normalizer.normalize(value)).join("");
  assert.equal(output.match(/command started/g)?.length, 2);
  assert.equal(output.match(/file update: a\.txt/g)?.length, 1);
  assert.equal(output.match(/file add: b\.txt/g)?.length, 1);
  assert.equal(output.match(/assistant: same text/g)?.length, 1);
  assert.match(output, /command output: same/u);
  assert.match(output, /command output:  text/u);
});

test("normalizer renders errors, todos, terminal failure and bounded unknown variants", () => {
  const normalizer = new CodexEventNormalizer();
  const output = [
    { type: "warning", id: "w", message: "careful" },
    { type: "warning", id: "w", message: "careful" },
    { type: "warning", id: null, message: "anonymous" },
    { type: "error", message: "fatal" },
    { type: "item.started", item: { id: "running-error", type: "error", message: "pending" } },
    { type: "item.completed", item: { id: "running-error", type: "error", message: "now visible" } },
    { type: "item.completed", item: { id: "e", type: "error", message: "recoverable" } },
    { type: "item.completed", item: { id: "empty-reasoning", type: "reasoning", text: "" } },
    { type: "item.completed", item: { id: "no-output", type: "command_execution", command: "true", status: "completed" } },
    { type: "item.started", item: { id: "t", type: "todo_list", items: [{ text: "first", completed: false }] } },
    { type: "item.updated", item: { id: "t", type: "todo_list", items: [{ text: "first", completed: true }] } },
    { type: "item.completed", item: { id: "t", type: "todo_list", items: [{ text: "first", completed: true }] } },
    { type: "turn.failed", error: { message: "stopped" } },
    { type: "future." + "x".repeat(300) },
    { type: "item.completed", item: { id: "u", type: "future_item", payload: "not dumped" } },
  ].flatMap((event) => normalizer.normalize(event)).join("");
  assert.equal(output.match(/warning: careful/g)?.length, 1);
  assert.match(output, /fatal error: fatal/u);
  assert.match(output, /warning: recoverable/u);
  assert.match(output, /todo started: \[ \] first/u);
  assert.match(output, /todo updated: \[x\] first/u);
  assert.match(output, /turn failed: stopped/u);
  assert.match(output, /unknown event:/u);
  assert.doesNotMatch(output, /payload|not dumped/u);
  assert.ok(output.length < 1_000);
  const bounded = new CodexEventNormalizer().normalize({ type: "item.completed", item: { id: "long", type: "agent_message", text: "x".repeat(20_000) } }).join("");
  assert.match(bounded, /EVENT CONTENT TRUNCATED/u);
});

test("normalizer rejects unsafe lifecycle and malformed known events", () => {
  const normalize = (events: JsonRecord[]): void => { const n = new CodexEventNormalizer(); for (const event of events) n.normalize(event); };
  const item = (stage: string, value: JsonRecord): JsonRecord => ({ type: `item.${stage}`, item: value });
  const command = (aggregate: string): JsonRecord => ({ id: "c", type: "command_execution", command: "cmd", aggregated_output: aggregate, status: "in_progress", exit_code: null });
  for (const events of [
    [item("updated", command("x"))],
    [item("started", command("x")), item("updated", command("different"))],
    [item("completed", command("")), item("completed", command(""))],
    [item("started", command("")), item("updated", { ...command(""), type: "reasoning", text: "" })],
    [item("started", { id: "f", type: "file_change", changes: [{ path: "x", kind: "update", patch: "abc" }], status: "in_progress" }), item("updated", { id: "f", type: "file_change", changes: [{ path: "x", kind: "update", patch: "zzz" }], status: "in_progress" })],
    [item("started", { id: "r", type: "reasoning", text: "abc" }), item("updated", { id: "r", type: "reasoning", text: "zzz" })],
  ]) assert.throws(() => normalize(events), /Unsafe Codex event lifecycle/u);
  for (const event of [
    {}, { type: "turn.failed", error: [] }, { type: "turn.completed", usage: { input_tokens: "bad", cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 } },
    { type: "turn.completed", usage: { input_tokens: Number.NaN, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 } },
    { type: "warning", id: 1, message: "bad id" },
    item("completed", { id: "f", type: "file_change", changes: "bad", status: "failed" }),
    item("completed", { id: "t", type: "todo_list", items: "bad" }),
  ]) assert.throws(() => normalize([event]), /Unsafe Codex event lifecycle/u);
});

class MemoryTranscript implements TranscriptSink {
  readonly chunks: Uint8Array[] = [];
  synced = false;
  closed = false;
  constructor(private readonly fail?: "write" | "sync" | "close") {}
  async write(data: Uint8Array): Promise<void> { if (this.fail === "write") throw new Error("write failed"); this.chunks.push(Buffer.from(data)); }
  async sync(): Promise<void> { if (this.fail === "sync") throw new Error("sync failed"); this.synced = true; }
  async close(): Promise<void> { if (this.fail === "close") throw new Error("close failed"); this.closed = true; }
  text(): string { return Buffer.concat(this.chunks).toString("utf8"); }
}

test("fanout redacts once and writes byte-identical live and transcript bytes", async () => {
  const live: Uint8Array[] = [];
  const transcript = new MemoryTranscript();
  const fanout = new RedactedFanout({ write: (data) => live.push(Buffer.from(data)) }, transcript, 100_000);
  await fanout.write("authorization: Bearer github_pat_abcdefghijk");
  await fanout.write("lmnopqrstuvwxyz1234567890\n");
  await fanout.finish();
  const liveText = Buffer.concat(live).toString("utf8");
  assert.equal(liveText, transcript.text());
  assert.doesNotMatch(liveText, /github_pat_/u);
  assert.match(liveText, /\[REDACTED\]/u);
  assert.equal(transcript.synced, true);
  assert.equal(transcript.closed, true);
});

test("fanout emits one identical truncation marker and still closes", async () => {
  const live: Uint8Array[] = [];
  const transcript = new MemoryTranscript();
  const fanout = new RedactedFanout({ write: (data) => live.push(Buffer.from(data)) }, transcript, 4);
  await fanout.write("abcdef\n");
  await fanout.write("ignored\n");
  await fanout.finish();
  assert.equal(transcript.text(), `abcd${TRUNCATION_MARKER}`);
  assert.equal(Buffer.concat(live).toString("utf8"), transcript.text());
  assert.equal(transcript.text().match(/OUTPUT TRUNCATED/g)?.length, 1);
  const zero = new MemoryTranscript();
  const zeroFanout = new RedactedFanout({ write: () => true }, zero, 0);
  await zeroFanout.write("");
  await zeroFanout.write("x\n");
  await zeroFanout.finish();
  assert.equal(zero.text(), TRUNCATION_MARKER);
});

test("fanout reports transcript write, flush and close failures", async () => {
  for (const failure of ["write", "sync", "close"] as const) {
    const transcript = new MemoryTranscript(failure);
    const fanout = new RedactedFanout({ write: () => true }, transcript, 100);
    await fanout.write("value\n");
    await assert.rejects(() => fanout.finish(), (error: unknown) => error instanceof CodexExecutionError && /transcript failed/u.test(error.message));
    assert.equal(transcript.closed, failure !== "close");
  }
  const allFailures: TranscriptSink = {
    async write() { throw "write string"; },
    async sync() { throw new Error("sync failed"); },
    async close() { throw new Error("close failed"); },
  };
  const fanout = new RedactedFanout({ write: () => true }, allFailures, 100);
  await fanout.write("value\n");
  await fanout.write("ignored\n");
  await assert.rejects(() => fanout.finish(), /write string/u);
  const partialFailure = new RedactedFanout({ write: () => true }, new MemoryTranscript("write"), 2);
  await partialFailure.write("long\n");
  await assert.rejects(() => partialFailure.finish(), /write failed/u);
});

test("transcript path is contained, exclusive and rejects symlinks", async () => {
  const root = join(tmpdir(), `agent-relay-transcript-${process.pid}-${Date.now()}`);
  const outside = join(tmpdir(), `agent-relay-transcript-outside-${process.pid}-${Date.now()}`);
  const nested = join(root, "nested");
  await mkdir(nested, { recursive: true });
  await mkdir(outside, { recursive: true });
  try {
    const path = join(root, "output.log");
    const sink = await createTranscriptSink(root, path);
    await sink.write(Buffer.from("ok")); await sink.sync(); await sink.close();
    assert.equal(await readFile(path, "utf8"), "ok");
    await assert.rejects(() => createTranscriptSink(root, path), /must not already exist/u);
    await assert.rejects(() => createTranscriptSink(root, join(root, "..", "escape.log")), /below RUNNER_TEMP/u);
    await assert.rejects(() => createTranscriptSink(root, root), /below RUNNER_TEMP/u);
    await assert.rejects(() => createTranscriptSink(root, join(root, "missing", "output.log")), /ENOENT/u);
    const inaccessible = join(root, "inaccessible");
    await mkdir(inaccessible);
    await chmod(inaccessible, 0o000);
    await assert.rejects(() => createTranscriptSink(root, join(inaccessible, "output.log")), /EACCES/u);
    await chmod(inaccessible, 0o700);
    await symlink(join(root, "target"), join(root, "link.log"));
    await assert.rejects(() => createTranscriptSink(root, join(root, "link.log")), /must not be a symlink/u);
    await symlink(outside, join(nested, "escape"));
    await assert.rejects(() => createTranscriptSink(root, join(nested, "escape", "out.log")), /parent escapes RUNNER_TEMP/u);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
