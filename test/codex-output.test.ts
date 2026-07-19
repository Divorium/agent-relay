import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexEventNormalizer } from "../src/execution/codex-normalizer.js";
import { DiagnosticLineParser, deriveJsonlRecordBytes, JsonlParser, type JsonRecord } from "../src/execution/jsonl-parser.js";
import { createTranscriptSink, RedactedFanout, TRUNCATION_MARKER, type LiveSink, type TranscriptSink } from "../src/execution/transcript.js";
import { CodexExecutionError } from "../src/execution/errors.js";
import { renderRelayLines, splitNormalizedSegments } from "../src/execution/output-renderer.js";
import { BoundedOutputPump, OrderedInputPump } from "../src/execution/output-pump.js";

function parseChunks(chunks: Uint8Array[], max?: number): JsonRecord[] {
  const records: JsonRecord[] = [];
  const parser = new JsonlParser(max);
  for (const chunk of chunks) records.push(...parser.write(chunk));
  records.push(...parser.end());
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
  const parser = new JsonlParser();
  [...parser.write(Buffer.from("{"))];
  assert.throws(() => [...parser.end()], /malformed record/u);
  const invalidEnd = new JsonlParser();
  [...invalidEnd.write(Uint8Array.from([0xe2]))];
  assert.throws(() => [...invalidEnd.end()], /invalid UTF-8/u);
});

test("JSONL protocol budget accepts installed-version cumulative records above 1 MiB", () => {
  const aggregate = "x".repeat(1_200_000);
  const record = `${JSON.stringify({ type: "item.updated", item: { id: "large", type: "command_execution", command: "large", aggregated_output: aggregate, status: "in_progress", exit_code: null } })}\n`;
  assert.equal(parseChunks(bytes(record))[0]?.type, "item.updated");
  assert.ok(deriveJsonlRecordBytes(10_000_000) > Buffer.byteLength(record));
  assert.throws(() => parseChunks(bytes(record), 1_100_000), /record exceeds 1100000 bytes/u);
  assert.throws(() => deriveJsonlRecordBytes(40_000_000), /JSONL budget/u);
  for (const invalid of [0, Number.NaN, 268_435_457]) assert.throws(() => new JsonlParser(invalid), /MAX_JSONL_RECORD_BYTES/u);
});

test("JSONL framing counts a multi-megabyte record once across small chunks", () => {
  const payload = "x".repeat(2_200_000);
  const encoded = Buffer.from(`${JSON.stringify({ type: "warning", message: payload })}\n`);
  const parser = new JsonlParser(encoded.length);
  const records: JsonRecord[] = [];
  for (let offset = 0; offset < encoded.length; offset += 31) records.push(...parser.write(encoded.subarray(offset, offset + 31)));
  records.push(...parser.end());
  assert.equal(records.length, 1);
  assert.equal(records[0]?.message, payload);
  assert.equal(parser.scannedBytes, encoded.length);
  assert.ok(parser.maximumPendingBytes <= encoded.length - 1);
  assert.equal(parser.pendingBytes, 0);
  assert.equal(parser.pendingChunks, 0);
});

test("JSONL framing rejects over-limit input at the first excess byte and releases slices", () => {
  const parser = new JsonlParser(1024);
  [...parser.write(Buffer.alloc(512, 0x20))];
  assert.throws(() => [...parser.write(Buffer.alloc(4096, 0x20))], /exceeds 1024 bytes/u);
  assert.equal(parser.scannedBytes, 1025);
  assert.equal(parser.pendingBytes, 0);
  assert.equal(parser.pendingChunks, 0);
});

test("stderr diagnostics preserve line framing and reject invalid UTF-8", () => {
  const lines: string[] = [];
  const parser = new DiagnosticLineParser();
  lines.push(...[...parser.write(Buffer.from("first\r\nsec")), ...parser.write(Buffer.from("ond")), ...parser.end()].map(({ value }) => value));
  assert.deepEqual(lines, ["first", "second"]);
  assert.throws(() => [...new DiagnosticLineParser().write(Uint8Array.from([0xff]))], /stderr UTF-8/u);
  const invalidEnd = new DiagnosticLineParser();
  [...invalidEnd.write(Uint8Array.from([0xe2]))];
  assert.throws(() => [...invalidEnd.end()], /stderr UTF-8/u);
  for (const invalid of [-1, 3, Number.NaN]) assert.throws(() => new DiagnosticLineParser(invalid), /maxLineBytes/u);
});

test("stderr diagnostics incrementally frame a multi-megabyte unfinished UTF-8 line", () => {
  const chunks: Array<{ value: string; continuation: boolean }> = [];
  const parser = new DiagnosticLineParser(1024);
  const input = Buffer.from(`start-${"🧪".repeat(600_000)}-end`);
  for (let offset = 0; offset < input.length; offset += 997) chunks.push(...parser.write(input.subarray(offset, offset + 997)));
  chunks.push(...parser.end());
  assert.equal(chunks.map(({ value }) => value).join(""), input.toString("utf8"));
  assert.ok(chunks.some(({ continuation }) => continuation));
  assert.ok(chunks.every(({ value }) => Buffer.byteLength(value) <= 1024));
  assert.ok(parser.maximumPendingBytes <= 2048);
  assert.equal(parser.pendingBytes, 0);
});

test("renderer structurally neutralizes workflow commands on every physical line", () => {
  const rendered = renderRelayLines("first\r\n::add-mask::secret\r::warning::bad\n\n::error::bad\n::stop-commands::token\u0000\t\u007f");
  const lines = rendered.split("\n");
  assert.equal(lines.pop(), "");
  assert.ok(lines.every((line) => line.startsWith("[codex] ")));
  assert.ok(lines.every((line) => !line.startsWith("::")));
  assert.match(rendered, /\\u0000\\u0009\\u007f/u);
  assert.doesNotMatch(rendered, /\r/u);
  assert.ok([...splitNormalizedSegments(`[codex] ${"🧪".repeat(20_000)}`)].every((segment) => Buffer.byteLength(segment) <= 32 * 1024));
  assert.deepEqual([...splitNormalizedSegments("")], []);
  assert.deepEqual([...splitNormalizedSegments("ascii", 5)], ["ascii"]);
  assert.deepEqual([...splitNormalizedSegments("A🧪", 4)], ["A", "🧪"]);
  assert.throws(() => [...splitNormalizedSegments("value", 3)], /at least 4/u);
  assert.throws(() => [...splitNormalizedSegments("value", Number.NaN)], /at least 4/u);
  for (const boundary of ["\n", "\r", "\r\n"]) assert.equal(renderRelayLines(`trailing${boundary}`), "[codex] trailing\n[codex] \n");
});

test("normalizer renders installed event lifecycles incrementally", async () => {
  const fixture = await readFile(join(process.cwd(), "test", "fixtures", "codex-0.144.4.jsonl"), "utf8");
  const events = parseChunks(bytes(fixture));
  const normalizer = new CodexEventNormalizer();
  const output = events.flatMap((event) => [...normalizer.normalize(event)]).join("");
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
  ].flatMap((value) => [...normalizer.normalize(value)]).join("");
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
  ].flatMap((event) => [...normalizer.normalize(event)]).join("");
  assert.equal(output.match(/warning: careful/g)?.length, 1);
  assert.match(output, /fatal error: fatal/u);
  assert.match(output, /warning: recoverable/u);
  assert.match(output, /todo started: \[ \] first/u);
  assert.match(output, /todo updated: \[x\] first/u);
  assert.match(output, /turn failed: stopped/u);
  assert.match(output, /unknown event:/u);
  assert.doesNotMatch(output, /payload|not dumped/u);
  assert.ok(output.length < 1_000);
  const bounded = [...new CodexEventNormalizer().normalize({ type: "item.completed", item: { id: "long", type: "agent_message", text: "x".repeat(20_000) } })].join("");
  assert.match(bounded, /EVENT CONTENT TRUNCATED/u);
});

test("all untrusted normalizer categories use Actions-safe physical lines", () => {
  const injection = "safe\n::add-mask::x\r::warning::x\r\n::error::x\n::stop-commands::x";
  const events: JsonRecord[] = [
    { type: "warning", message: injection },
    { type: "error", message: injection },
    { type: "turn.failed", error: { message: injection } },
    { type: "item.completed", item: { id: "command", type: "command_execution", command: injection, aggregated_output: injection, status: injection, exit_code: 0 } },
    { type: "item.completed", item: { id: "file", type: "file_change", changes: [{ path: injection, kind: "update", patch: injection }], status: injection } },
    { type: "item.completed", item: { id: "message", type: "agent_message", text: injection } },
    { type: "item.completed", item: { id: "reasoning", type: "reasoning", text: injection } },
    { type: "item.completed", item: { id: "todo", type: "todo_list", items: [{ text: injection, completed: false }] } },
    { type: `unknown-${injection}` },
  ];
  const normalizer = new CodexEventNormalizer();
  const output = [...events.flatMap((event) => [...normalizer.normalize(event)]), normalizer.diagnostic(injection), normalizer.diagnostic(injection, true)].join("");
  const physicalLines = output.split("\n");
  assert.equal(physicalLines.pop(), "");
  assert.ok(physicalLines.every((line) => line.startsWith("[codex] ")));
  assert.ok(output.split("\n").every((line) => !line.startsWith("::")));
});

test("every normalizer category owns trailing and empty physical lines", () => {
  const value = "one\n\n";
  const events: JsonRecord[] = [
    { type: "warning", message: value },
    { type: "error", message: value },
    { type: `future-${value}` },
    { type: "item.completed", item: { id: "command-lines", type: "command_execution", command: value, aggregated_output: value, status: "completed", exit_code: 0 } },
    { type: "item.completed", item: { id: "file-lines", type: "file_change", changes: [{ path: value, kind: "update", patch: value }], status: "completed" } },
    { type: "item.completed", item: { id: "assistant-lines", type: "agent_message", text: value } },
    { type: "item.completed", item: { id: "reasoning-lines", type: "reasoning", text: value } },
    { type: "item.completed", item: { id: "todo-lines", type: "todo_list", items: [{ text: value, completed: false }] } },
  ];
  const normalizer = new CodexEventNormalizer();
  const output = `${events.flatMap((event) => [...normalizer.normalize(event)]).join("")}${normalizer.diagnostic(value)}${normalizer.diagnostic(value, true)}`;
  const lines = output.split("\n");
  assert.equal(lines.pop(), "");
  assert.ok(lines.length > events.length);
  assert.ok(lines.every((line) => line.startsWith("[codex] ")));
});

test("large todo and file-change events normalize without record-sized output arrays", () => {
  const normalizer = new CodexEventNormalizer();
  const todos = Array.from({ length: 20_000 }, (_, index) => ({ text: `todo-${index}`, completed: false }));
  const todoOutput = normalizer.normalize({ type: "item.completed", item: { id: "many-todos", type: "todo_list", items: todos } });
  assert.equal(Array.isArray(todoOutput), false);
  const todoSegments = [...todoOutput];
  assert.equal(todoSegments.length, 1);
  assert.ok(Buffer.byteLength(todoSegments[0]) < 20_000);
  assert.match(todoSegments[0]!, /EVENT CONTENT TRUNCATED/u);

  let secondRead = false;
  const changes = [{ path: "first", kind: "add", patch: "one" }, { path: "second", kind: "add", patch: "two" }];
  Object.defineProperty(changes, 1, { configurable: true, enumerable: true, get() { secondRead = true; return { path: "second", kind: "add", patch: "two" }; } });
  const fileOutput = normalizer.normalize({ type: "item.completed", item: { id: "lazy-files", type: "file_change", changes, status: "completed" } });
  assert.equal(fileOutput.next().done, false);
  assert.equal(secondRead, false);
  assert.ok([...fileOutput].length >= 3);
  assert.equal(secondRead, true);
});

test("normalizer bounds lifecycle replay state and releases cumulative payloads", () => {
  const normalizer = new CodexEventNormalizer();
  for (let index = 0; index < 5_000; index += 1) {
    const id = String(index);
    [...normalizer.normalize({ type: "item.completed", item: { id: `c-${id}`, type: "command_execution", command: "cmd", aggregated_output: `payload-${id}`, status: "completed", exit_code: 0 } })];
    [...normalizer.normalize({ type: "item.completed", item: { id: `m-${id}`, type: "agent_message", text: `same-${id}` } })];
    [...normalizer.normalize({ type: "item.completed", item: { id: `r-${id}`, type: "reasoning", text: `reason-${id}` } })];
    [...normalizer.normalize({ type: "item.completed", item: { id: `f-${id}`, type: "file_change", changes: [{ path: `${id}.txt`, kind: "add", patch: `patch-${id}` }], status: "completed" } })];
    [...normalizer.normalize({ type: "warning", id: `w-${id}`, message: "warning" })];
  }
  assert.deepEqual(normalizer.retainedState(), { activeItems: 0, completedItems: 4096, eventIds: 4096, fileChanges: 0 });
  [...normalizer.normalize({ type: "item.started", item: { id: "active", type: "file_change", changes: [{ path: "active.txt", kind: "add", patch: "x" }], status: "in_progress" } })];
  assert.deepEqual(normalizer.retainedState(), { activeItems: 1, completedItems: 4096, eventIds: 4096, fileChanges: 1 });
  normalizer.clearLifecycleState();
  assert.deepEqual(normalizer.retainedState(), { activeItems: 0, completedItems: 0, eventIds: 0, fileChanges: 0 });
});

test("normalizer rejects unsafe lifecycle and malformed known events", () => {
  const normalize = (events: JsonRecord[]): void => { const n = new CodexEventNormalizer(); for (const event of events) [...n.normalize(event)]; };
  const item = (stage: string, value: JsonRecord): JsonRecord => ({ type: `item.${stage}`, item: value });
  const command = (aggregate: string): JsonRecord => ({ id: "c", type: "command_execution", command: "cmd", aggregated_output: aggregate, status: "in_progress", exit_code: null });
  for (const events of [
    [item("updated", command("x"))],
    [item("started", command("x")), item("updated", command("different"))],
    [item("started", command("longer")), item("updated", command("x"))],
    [item("completed", command("")), item("completed", command(""))],
    [item("started", command("")), item("updated", { ...command(""), type: "reasoning", text: "" })],
    [item("started", { id: "f", type: "file_change", changes: [{ path: "x", kind: "update", patch: "abc" }], status: "in_progress" }), item("updated", { id: "f", type: "file_change", changes: [{ path: "x", kind: "update", patch: "zzz" }], status: "in_progress" })],
    [item("started", { id: "r", type: "reasoning", text: "abc" }), item("updated", { id: "r", type: "reasoning", text: "zzz" })],
  ]) assert.throws(() => normalize(events), /Unsafe Codex event lifecycle/u);
  const diffNormalizer = new CodexEventNormalizer();
  assert.match([...diffNormalizer.normalize(item("completed", { id: "diff", type: "file_change", changes: [{ path: "x", kind: "update", diff: "diff text" }], status: "completed" }))].join(""), /diff text/u);
  assert.deepEqual([...new CodexEventNormalizer().normalize(item("completed", { id: "empty", type: "agent_message", text: "" }))], []);
  const tooManyActive = new CodexEventNormalizer();
  for (let index = 0; index < 1_024; index += 1) [...tooManyActive.normalize(item("started", { id: String(index), type: "reasoning", text: "" }))];
  assert.throws(() => [...tooManyActive.normalize(item("started", { id: "overflow", type: "reasoning", text: "" }))], /active item limit/u);
  const tooManyFiles = new CodexEventNormalizer();
  const changes = Array.from({ length: 1_025 }, (_, index) => ({ path: `${index}.txt`, kind: "add", patch: "" }));
  assert.throws(() => [...tooManyFiles.normalize(item("started", { id: "files", type: "file_change", changes, status: "in_progress" }))], /file change limit/u);
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

function immediateLive(onWrite: (data: Uint8Array) => void = () => undefined): LiveSink {
  return eventfulLive((data, callback) => {
    onWrite(Buffer.from(data));
    callback();
    return true;
  });
}

function eventfulLive(write: LiveSink["write"], state: Pick<LiveSink, "destroyed" | "writableEnded"> = {}): LiveSink {
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  return {
    ...state,
    write,
    once(event, listener) { listeners.set(event, [...(listeners.get(event) ?? []), listener]); },
    removeListener(event, listener) { listeners.set(event, (listeners.get(event) ?? []).filter((candidate) => candidate !== listener)); },
  };
}

class ControlledWritable {
  readonly chunks: Uint8Array[] = [];
  private readonly listeners = new Map<string, Array<(...args: any[]) => void>>();
  private callbacks: Array<(error?: Error | null) => void> = [];
  queuedBytes = 0;
  maximumQueuedBytes = 0;
  write(data: Uint8Array, callback: (error?: Error | null) => void): boolean {
    const copy = Buffer.from(data);
    this.chunks.push(copy);
    this.queuedBytes += copy.length;
    this.maximumQueuedBytes = Math.max(this.maximumQueuedBytes, this.queuedBytes);
    this.callbacks.push(callback);
    return false;
  }
  once(event: string, listener: (...args: any[]) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
  removeListener(event: string, listener: (...args: any[]) => void): void {
    this.listeners.set(event, (this.listeners.get(event) ?? []).filter((candidate) => candidate !== listener));
  }
  release(): void {
    const callbacks = this.callbacks;
    this.callbacks = [];
    this.queuedBytes = 0;
    for (const callback of callbacks) callback();
    this.emit("drain");
  }
  emit(event: string, ...args: any[]): void {
    const listeners = this.listeners.get(event) ?? [];
    this.listeners.delete(event);
    for (const listener of listeners) listener(...args);
  }
}

class VariadicWritable {
  readonly chunks: Uint8Array[] = [];
  private readonly listeners = new Map<string, Array<(...args: any[]) => void>>();
  private callback: ((error?: Error | null) => void) | undefined;
  write = (...args: any[]): boolean => {
    this.chunks.push(Buffer.from(args[0] as Uint8Array));
    this.callback = args[1] as (error?: Error | null) => void;
    return false;
  };
  once(event: string, listener: (...args: any[]) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
  removeListener(event: string, listener: (...args: any[]) => void): void {
    this.listeners.set(event, (this.listeners.get(event) ?? []).filter((candidate) => candidate !== listener));
  }
  completeCallback(): void { const callback = this.callback; this.callback = undefined; callback?.(); }
  drain(): void {
    const listeners = this.listeners.get("drain") ?? [];
    this.listeners.delete("drain");
    for (const listener of listeners) listener();
  }
}

test("fanout redacts once and writes byte-identical live and transcript bytes", async () => {
  const live: Uint8Array[] = [];
  const transcript = new MemoryTranscript();
  const fanout = new RedactedFanout(immediateLive((data) => { live.push(Buffer.from(data)); }), transcript, 100_000);
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

test("bounded pump pauses fast sources and waits for Writable callback and drain", async () => {
  const live = new ControlledWritable();
  const transcript = new MemoryTranscript();
  const fanout = new RedactedFanout(live, transcript, 100_000);
  const failures: unknown[] = [];
  const pump = new BoundedOutputPump(fanout, (error) => failures.push(error), () => undefined, 1024, 512, 256);
  const producing = pump.enqueue(Array.from({ length: 20 }, () => `${"x".repeat(250)}\n`));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(pump.maximumQueuedBytes <= 1024 + 256);
  assert.equal(transcript.text().length, 251, "transcript write starts, but the segment is not consumed");
  while (live.queuedBytes > 0 || pump.pendingBytes > 0) {
    live.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await producing;
  await pump.finish();
  await fanout.finish();
  assert.deepEqual(failures, []);
  assert.equal(Buffer.concat(live.chunks).toString("utf8"), transcript.text());
  assert.ok(live.maximumQueuedBytes <= 256);
});

test("one large normalized value cannot synchronously overfill the bounded queue", async () => {
  const live = new ControlledWritable();
  const transcript = new MemoryTranscript();
  const fanout = new RedactedFanout(live, transcript, 100_000);
  const pump = new BoundedOutputPump(fanout, assert.fail, () => undefined, 1024, 512, 256);
  let settled = false;
  const normalizedValue = Array.from({ length: 200 }, () => `[codex] ${"x".repeat(120)}\n`).join("");
  const producing = pump.enqueue([normalizedValue]).finally(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(settled, false);
  assert.ok(pump.maximumQueuedBytes <= 1024 + 256);
  while (!settled || live.queuedBytes > 0 || pump.pendingBytes > 0) {
    live.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await producing;
  await pump.finish();
  await fanout.finish();
  assert.ok(pump.maximumQueuedBytes <= 1024 + 256);
  assert.equal(Buffer.concat(live.chunks).toString("utf8"), transcript.text());
});

test("tagged raw admission pauses a parser burst and preserves ordered identical output", async () => {
  const live = new ControlledWritable();
  const transcript = new MemoryTranscript();
  const fanout = new RedactedFanout(live, transcript, 1_000_000);
  const output = new BoundedOutputPump(fanout, assert.fail, () => undefined, 512, 256, 128);
  const parser = new JsonlParser(1_000_000);
  const normalizer = new CodexEventNormalizer();
  let pauses = 0;
  let resumes = 0;
  const source = { pause() { pauses += 1; }, resume() { resumes += 1; } };
  const input = new OrderedInputPump(output, async (_source, chunk) => {
    for (const event of parser.write(chunk)) await output.enqueue(normalizer.normalize(event));
  }, assert.fail);
  const records = Array.from({ length: 40 }, (_, index) => JSON.stringify({
    type: "item.completed",
    item: { id: `burst-${index}`, type: "agent_message", text: `${index}:${"x".repeat(600)}` },
  })).join("\n") + "\n";
  input.accept(source, Buffer.from(records));
  let settled = false;
  const finishing = input.finish().finally(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(pauses, 1);
  assert.equal(settled, false);
  while (!settled || live.queuedBytes > 0 || output.pendingBytes > 0) {
    live.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await finishing;
  for (const event of parser.end()) await output.enqueue(normalizer.normalize(event));
  await output.finish();
  await fanout.finish();
  const text = transcript.text();
  assert.equal(Buffer.concat(live.chunks).toString("utf8"), text);
  assert.ok(output.maximumQueuedBytes <= 512 + 128);
  assert.equal(resumes, 1);
  for (let index = 1; index < 40; index += 1) assert.ok(text.indexOf(`${index - 1}:`) < text.indexOf(`${index}:`));
  await input.finish();
});

test("tagged raw admission releases queued sources and retains its processing failure", async () => {
  const fanout = new RedactedFanout(immediateLive(), new MemoryTranscript(), 1000);
  const output = new BoundedOutputPump(fanout, () => undefined, () => undefined, 128, 64, 32);
  const failures: unknown[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolvePromise) => { release = resolvePromise; });
  const first = { pauses: 0, resumes: 0, pause() { this.pauses += 1; }, resume() { this.resumes += 1; } };
  const second = { pauses: 0, resumes: 0, pause() { this.pauses += 1; }, resume() { this.resumes += 1; } };
  const input = new OrderedInputPump(output, async () => { await blocked; throw new Error("raw processing failed"); }, (error) => failures.push(error));
  input.accept(first, Buffer.from("first"));
  input.accept(second, Buffer.from("second"));
  const finishing = input.finish();
  release();
  await finishing;
  assert.equal(first.resumes, 1);
  assert.equal(second.resumes, 1);
  assert.match(String(failures[0]), /raw processing failed/u);
  input.accept(first, Buffer.from("ignored"));
  assert.equal(first.pauses, 1);
  await input.finish();
  output.discard();
  await output.waitUntilLow();
  await fanout.finish();
});

test("tagged raw admission releases its current source exactly once after processing fails", async () => {
  const fanout = new RedactedFanout(immediateLive(), new MemoryTranscript(), 1000);
  const output = new BoundedOutputPump(fanout, () => undefined, () => undefined, 128, 64, 32);
  const failures: unknown[] = [];
  const source = { pauses: 0, resumes: 0, pause() { this.pauses += 1; }, resume() { this.resumes += 1; } };
  const input = new OrderedInputPump(output, async () => { throw new Error("current processing failed"); }, (error) => failures.push(error));
  input.accept(source, Buffer.from("current"));
  await input.finish();
  input.discard();
  assert.equal(source.pauses, 1);
  assert.equal(source.resumes, 1);
  assert.match(String(failures[0]), /current processing failed/u);
  output.discard();
  await fanout.finish();
});

test("variadic zero-arity Writable completion awaits both callback and drain", async () => {
  const live = new VariadicWritable();
  assert.equal(live.write.length, 0);
  const fanout = new RedactedFanout(live, new MemoryTranscript(), 1000);
  let settled = false;
  const writing = fanout.write("[codex] value\n").finally(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(settled, false);
  live.completeCallback();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(settled, false);
  live.drain();
  await writing;
  assert.equal(settled, true);
  await fanout.finish();
});

test("live Writable error and premature close fail fan-out", async () => {
  for (const event of ["error", "close"] as const) {
    const live = new ControlledWritable();
    const fanout = new RedactedFanout(live, new MemoryTranscript(), 1000);
    const writing = fanout.write("value\n");
    live.emit(event, ...(event === "error" ? [new Error("live failed")] : []));
    await assert.rejects(() => writing, event === "error" ? /live failed/u : /closed/u);
    live.release();
    await assert.rejects(() => fanout.finish(), /live output failed/u);
  }
});

test("live Writable close after a completed write still fails finish", async () => {
  const live = new ControlledWritable();
  const fanout = new RedactedFanout(live, new MemoryTranscript(), 1000);
  const writing = fanout.write("value\n");
  live.release();
  await writing;
  live.emit("close");
  await assert.rejects(() => fanout.finish(), /closed prematurely/u);
});

test("live Writable synchronous, callback and unsupported-backpressure failures are retained", async () => {
  const liveSinks = [
    eventfulLive(() => { throw new Error("sync live failure"); }),
    eventfulLive(() => { throw "sync live string"; }),
    eventfulLive((_data, callback) => { callback(new Error("callback live failure")); return true; }),
    eventfulLive((_data, callback) => { callback(); return true; }, { destroyed: true }),
    eventfulLive((_data, callback) => { callback(); return true; }, { writableEnded: true }),
  ];
  for (const live of liveSinks) {
    const fanout = new RedactedFanout(live, new MemoryTranscript(), 1000);
    await assert.rejects(() => fanout.write("value\n"));
    await assert.rejects(() => fanout.finish(), /live output failed/u);
  }
});

test("bounded pump retains its first sink failure and discards queued output", async () => {
  const failures: unknown[] = [];
  const fanout = new RedactedFanout(immediateLive(), new MemoryTranscript("write"), 1000);
  const pump = new BoundedOutputPump(fanout, (error) => failures.push(error), () => undefined, 128, 64, 32);
  await pump.enqueue(["first\n", "second\n"]);
  await pump.finish();
  assert.equal(failures.length, 1);
  assert.equal(pump.pendingBytes, 0);
  await pump.enqueue(["ignored\n"]);
  pump.discard();
  await assert.rejects(() => fanout.finish(), /write failed/u);
});

test("bounded pump validates both watermarks and splits queued values", async () => {
  const fanout = new RedactedFanout(immediateLive(), new MemoryTranscript(), 1000);
  for (const watermarks of [[128, -1], [64, 64]] as const) {
    assert.throws(() => new BoundedOutputPump(fanout, () => undefined, () => undefined, watermarks[0], watermarks[1], 32), /watermarks/u);
  }
  const pump = new BoundedOutputPump(fanout, () => undefined, () => undefined, 40, 20, 16);
  await pump.enqueue(["x".repeat(100) + "\n"]);
  await pump.finish();
  await fanout.finish();
});

test("fanout emits one identical truncation marker and still closes", async () => {
  const live: Uint8Array[] = [];
  const transcript = new MemoryTranscript();
  const fanout = new RedactedFanout(immediateLive((data) => { live.push(Buffer.from(data)); }), transcript, 4);
  await fanout.write("abcdef\n");
  await fanout.write("ignored\n");
  await fanout.finish();
  assert.equal(transcript.text(), TRUNCATION_MARKER);
  assert.equal(Buffer.concat(live).toString("utf8"), transcript.text());
  assert.equal(transcript.text().match(/OUTPUT TRUNCATED/g)?.length, 1);
  const zero = new MemoryTranscript();
  const zeroFanout = new RedactedFanout(immediateLive(), zero, 0);
  await zeroFanout.write("");
  await zeroFanout.write("x\n");
  await zeroFanout.finish();
  assert.equal(zero.text(), TRUNCATION_MARKER);
});

test("fanout safely terminates a final unterminated Relay line", async () => {
  const transcript = new MemoryTranscript();
  const fanout = new RedactedFanout(immediateLive(), transcript, 100);
  await fanout.write("[codex] final");
  await fanout.finish();
  assert.equal(transcript.text(), "[codex] final\n");
});

test("fanout reports transcript write, flush and close failures", async () => {
  for (const failure of ["write", "sync", "close"] as const) {
    const transcript = new MemoryTranscript(failure);
    const fanout = new RedactedFanout(immediateLive(), transcript, 100);
    if (failure === "write") await assert.rejects(() => fanout.write("value\n"), /write failed/u);
    else await fanout.write("value\n");
    await assert.rejects(() => fanout.finish(), (error: unknown) => error instanceof CodexExecutionError && /transcript failed/u.test(error.message));
    assert.equal(transcript.closed, failure !== "close");
  }
  const allFailures: TranscriptSink = {
    async write() { throw "write string"; },
    async sync() { throw new Error("sync failed"); },
    async close() { throw new Error("close failed"); },
  };
  const fanout = new RedactedFanout(immediateLive(), allFailures, 100);
  await assert.rejects(() => fanout.write("value\n"), /write string/u);
  await assert.rejects(() => fanout.write("ignored\n"), /write string/u);
  await assert.rejects(() => fanout.finish(), /write string/u);
  const partialFailure = new RedactedFanout(immediateLive(), new MemoryTranscript("write"), 2);
  await assert.rejects(() => partialFailure.write("long\n"), /write failed/u);
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
