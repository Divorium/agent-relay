import { CodexExecutionError } from "./errors.js";
import type { JsonRecord } from "./jsonl-parser.js";
import { createHash } from "node:crypto";
import { renderRelayLines } from "./output-renderer.js";

interface CumulativeState {
  length: number;
  digest: string;
}

interface ItemState {
  type: string;
  commandOutput: CumulativeState;
  text: CumulativeState;
  changes: Map<string, CumulativeState>;
}

const MAX_TEXT = 16_384;
const MAX_ACTIVE_ITEMS = 1_024;
const MAX_FILE_CHANGES_PER_ITEM = 1_024;
const MAX_REPLAY_IDENTITIES = 4_096;

function record(value: unknown, name: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unsafe(`${name} must be an object`);
  return value as JsonRecord;
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string") throw unsafe(`${name} must be a string`);
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return string(value, name);
}

function bounded(value: string): string {
  if (value.length <= MAX_TEXT) return value;
  return `${value.slice(0, MAX_TEXT)}\n[EVENT CONTENT TRUNCATED]`;
}

function line(label: string, value = ""): string {
  const suffix = value ? ` ${bounded(value)}` : "";
  return renderRelayLines(`${label}${suffix}`);
}

function unsafe(detail: string): CodexExecutionError {
  return new CodexExecutionError("CODEX_FAILED", `Unsafe Codex event lifecycle: ${detail}`);
}

export class CodexEventNormalizer {
  private readonly items = new Map<string, ItemState>();
  private readonly completedItems = new BoundedIdentitySet(MAX_REPLAY_IDENTITIES);
  private readonly eventIds = new BoundedIdentitySet(MAX_REPLAY_IDENTITIES);
  private executionActivities = 0;

  clearLifecycleState(): void {
    this.items.clear();
    this.completedItems.clear();
    this.eventIds.clear();
  }

  executionActivityCount(): number {
    return this.executionActivities;
  }

  retainedState(): { activeItems: number; completedItems: number; eventIds: number; fileChanges: number } {
    let fileChanges = 0;
    for (const state of this.items.values()) fileChanges += state.changes.size;
    return { activeItems: this.items.size, completedItems: this.completedItems.size, eventIds: this.eventIds.size, fileChanges };
  }

  *normalize(event: JsonRecord): Generator<string> {
    const type = string(event.type, "event.type");
    switch (type) {
      case "thread.started":
        yield line("thread started"); return;
      case "turn.started":
        yield line("turn started"); return;
      case "turn.completed":
        yield this.turnCompleted(event); return;
      case "turn.failed":
        yield line("turn failed:", string(record(event.error, "turn.failed.error").message, "turn.failed.error.message")); return;
      case "error":
        yield* this.eventMessage(type, event, "fatal error:"); return;
      case "warning":
        yield* this.eventMessage(type, event, "warning:"); return;
      case "item.started":
      case "item.updated":
      case "item.completed":
        yield* this.item(type.slice("item.".length) as "started" | "updated" | "completed", record(event.item, `${type}.item`)); return;
      default:
        yield line("unknown event:", bounded(type.slice(0, 200)));
    }
  }

  diagnostic(value: string, continuation = false): string {
    return line(continuation ? "stderr continuation:" : "stderr:", value);
  }

  private turnCompleted(event: JsonRecord): string {
    const usage = record(event.usage, "turn.completed.usage");
    const input = this.number(usage.input_tokens, "usage.input_tokens");
    const cached = this.number(usage.cached_input_tokens, "usage.cached_input_tokens");
    const output = this.number(usage.output_tokens, "usage.output_tokens");
    const reasoning = this.number(usage.reasoning_output_tokens, "usage.reasoning_output_tokens");
    return line("turn completed; usage:", `input=${input} cached=${cached} output=${output} reasoning=${reasoning}`);
  }

  private number(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw unsafe(`${name} must be a finite number`);
    return value;
  }

  private *eventMessage(type: string, event: JsonRecord, label: string): Generator<string> {
    const message = string(event.message, `${type}.message`);
    const id = optionalString(event.id, `${type}.id`);
    if (id) {
      const identity = `${type}:${id}`;
      if (this.eventIds.has(identity)) return;
      this.eventIds.add(identity);
    }
    yield line(label, message);
  }

  private *item(stage: "started" | "updated" | "completed", item: JsonRecord): Generator<string> {
    const id = string(item.id, "item.id");
    const itemKey = digest(id);
    const type = string(item.type, "item.type");
    const existing = this.items.get(itemKey);
    if (existing && existing.type !== type) throw unsafe(`item ${id} changed type`);
    if (this.completedItems.has(id)) throw unsafe(`item ${id} received ${stage} after completion`);
    if (!existing && stage === "updated") throw unsafe(`item ${id} was updated before start`);
    if (!existing && this.items.size >= MAX_ACTIVE_ITEMS) throw unsafe(`active item limit of ${MAX_ACTIVE_ITEMS} exceeded`);
    const state = existing ?? { type, commandOutput: cumulative(""), text: cumulative(""), changes: new Map<string, CumulativeState>() };
    this.items.set(itemKey, state);
    switch (type) {
      case "command_execution": yield* this.command(stage, item, state); break;
      case "file_change": yield* this.fileChange(stage, item, state); break;
      case "agent_message": yield* this.textItem(stage, item, state, "assistant:", true); break;
      case "reasoning": yield* this.textItem(stage, item, state, "progress:", false); break;
      case "error": if (stage === "completed") yield this.itemError(id, item); break;
      case "todo_list": yield this.todo(stage, item); break;
      default: yield line("unknown item:", bounded(type.slice(0, 200)));
    }
    if (stage === "completed") {
      this.items.delete(itemKey);
      this.completedItems.add(id);
    }
  }

  private *command(stage: "started" | "updated" | "completed", item: JsonRecord, state: ItemState): Generator<string> {
    const command = string(item.command, "command.command");
    const aggregate = optionalString(item.aggregated_output, "command.aggregated_output") ?? "";
    if (stage === "started") yield line("command started:", command);
    verifyCumulative(aggregate, state.commandOutput, `command ${string(item.id, "item.id")} output`);
    const delta = aggregate.slice(state.commandOutput.length, state.commandOutput.length + MAX_TEXT + 1);
    if (delta) yield line("command output:", delta);
    state.commandOutput = cumulative(aggregate);
    if (stage === "completed") {
      const status = string(item.status, "command.status");
      const exitCode = item.exit_code === null || item.exit_code === undefined ? "none" : String(this.number(item.exit_code, "command.exit_code"));
      this.executionActivities += 1;
      yield line("command completed:", `status=${status} exit=${exitCode}`);
    }
  }

  private *fileChange(stage: "started" | "updated" | "completed", item: JsonRecord, state: ItemState): Generator<string> {
    if (!Array.isArray(item.changes)) throw unsafe("file_change.changes must be an array");
    for (const value of item.changes) {
      const change = record(value, "file_change.change");
      const path = string(change.path, "file_change.path");
      const kind = string(change.kind, "file_change.kind");
      const key = digest(`${kind}\u0000${path}`);
      const patch = optionalString(change.patch ?? change.diff, "file_change.patch") ?? "";
      const previous = state.changes.get(key);
      if (previous === undefined) {
        if (state.changes.size >= MAX_FILE_CHANGES_PER_ITEM) throw unsafe(`file change limit of ${MAX_FILE_CHANGES_PER_ITEM} exceeded`);
        yield line(`file ${kind}:`, path);
      } else verifyCumulative(patch, previous, `file change ${path} patch`);
      const deltaStart = previous?.length ?? 0;
      const delta = patch.slice(deltaStart, deltaStart + MAX_TEXT + 1);
      if (delta) yield line("patch:", delta);
      state.changes.set(key, cumulative(patch));
    }
    if (stage === "completed") {
      const status = string(item.status, "file_change.status");
      if (state.changes.size > 0) this.executionActivities += 1;
      yield line("file changes completed:", status);
    }
  }

  private *textItem(stage: "started" | "updated" | "completed", item: JsonRecord, state: ItemState, label: string, finalOnly: boolean): Generator<string> {
    const text = string(item.text, `${item.type}.text`);
    verifyCumulative(text, state.text, `item ${string(item.id, "item.id")} text`);
    const delta = text.slice(state.text.length, state.text.length + MAX_TEXT + 1);
    state.text = cumulative(text);
    if (finalOnly) {
      if (stage === "completed" && text) yield line(label, text);
      return;
    }
    if (delta) yield line(label, delta);
  }

  private itemError(id: string, item: JsonRecord): string {
    this.eventIds.add(`item.error:${id}`);
    return line("warning:", string(item.message, "error.message"));
  }

  private todo(stage: "started" | "updated" | "completed", item: JsonRecord): string {
    if (!Array.isArray(item.items)) throw unsafe("todo_list.items must be an array");
    let summary = "";
    for (const value of item.items) {
      const todo = record(value, "todo_list.item");
      const text = string(todo.text, "todo_list.text");
      if (summary.length <= MAX_TEXT) {
        const prefix = `${summary ? "; " : ""}${todo.completed === true ? "[x]" : "[ ]"} `;
        summary += prefix.slice(0, MAX_TEXT + 1 - summary.length);
        summary += text.slice(0, MAX_TEXT + 1 - summary.length);
      }
    }
    return line(`todo ${stage}:`, summary);
  }
}

function cumulative(value: string): CumulativeState {
  return { length: value.length, digest: digest(value) };
}

function digest(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }

function verifyCumulative(value: string, previous: CumulativeState, name: string): void {
  if (value.length < previous.length || cumulative(value.slice(0, previous.length)).digest !== previous.digest) {
    throw unsafe(`${name} was not cumulative`);
  }
}

class BoundedIdentitySet {
  private readonly values = new Set<string>();
  constructor(private readonly limit: number) {}
  get size(): number { return this.values.size; }
  has(value: string): boolean { return this.values.has(digest(value)); }
  add(value: string): void {
    const key = digest(value);
    this.values.add(key);
    if (this.values.size > this.limit) this.values.delete(this.values.values().next().value as string);
  }
  clear(): void { this.values.clear(); }
}
