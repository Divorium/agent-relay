import { CodexExecutionError } from "./errors.js";
import type { JsonRecord } from "./jsonl-parser.js";

interface ItemState {
  type: string;
  commandOutput: string;
  text: string;
  changes: Map<string, string>;
  completed: boolean;
}

const MAX_TEXT = 16_384;

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
  return `[codex] ${label}${suffix}\n`;
}

function unsafe(detail: string): CodexExecutionError {
  return new CodexExecutionError("CODEX_FAILED", `Unsafe Codex event lifecycle: ${detail}`);
}

export class CodexEventNormalizer {
  private readonly items = new Map<string, ItemState>();
  private readonly eventIds = new Set<string>();

  normalize(event: JsonRecord): string[] {
    const type = string(event.type, "event.type");
    switch (type) {
      case "thread.started":
        return [line("thread started")];
      case "turn.started":
        return [line("turn started")];
      case "turn.completed":
        return [this.turnCompleted(event)];
      case "turn.failed":
        return [line("turn failed:", string(record(event.error, "turn.failed.error").message, "turn.failed.error.message"))];
      case "error":
        return this.eventMessage(type, event, "fatal error:");
      case "warning":
        return this.eventMessage(type, event, "warning:");
      case "item.started":
      case "item.updated":
      case "item.completed":
        return this.item(type.slice("item.".length) as "started" | "updated" | "completed", record(event.item, `${type}.item`));
      default:
        return [line("unknown event:", bounded(type.slice(0, 200)))];
    }
  }

  diagnostic(value: string): string {
    return line("stderr:", value);
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

  private eventMessage(type: string, event: JsonRecord, label: string): string[] {
    const message = string(event.message, `${type}.message`);
    const id = optionalString(event.id, `${type}.id`);
    if (id) {
      const identity = `${type}:${id}`;
      if (this.eventIds.has(identity)) return [];
      this.eventIds.add(identity);
    }
    return [line(label, message)];
  }

  private item(stage: "started" | "updated" | "completed", item: JsonRecord): string[] {
    const id = string(item.id, "item.id");
    const type = string(item.type, "item.type");
    const existing = this.items.get(id);
    if (existing && existing.type !== type) throw unsafe(`item ${id} changed type`);
    if (existing?.completed) throw unsafe(`item ${id} received ${stage} after completion`);
    if (!existing && stage === "updated") throw unsafe(`item ${id} was updated before start`);
    const state = existing ?? { type, commandOutput: "", text: "", changes: new Map<string, string>(), completed: false };
    this.items.set(id, state);
    let output: string[];
    switch (type) {
      case "command_execution": output = this.command(stage, item, state); break;
      case "file_change": output = this.fileChange(stage, item, state); break;
      case "agent_message": output = this.textItem(stage, item, state, "assistant:", true); break;
      case "reasoning": output = this.textItem(stage, item, state, "progress:", false); break;
      case "error": output = stage === "completed" ? this.itemError(id, item) : []; break;
      case "todo_list": output = this.todo(stage, item); break;
      default: output = [line("unknown item:", bounded(type.slice(0, 200)))];
    }
    if (stage === "completed") state.completed = true;
    return output;
  }

  private command(stage: "started" | "updated" | "completed", item: JsonRecord, state: ItemState): string[] {
    const command = string(item.command, "command.command");
    const aggregate = optionalString(item.aggregated_output, "command.aggregated_output") ?? "";
    const output: string[] = [];
    if (stage === "started") output.push(line("command started:", command));
    if (!aggregate.startsWith(state.commandOutput)) throw unsafe(`command ${string(item.id, "item.id")} output was not cumulative`);
    const delta = aggregate.slice(state.commandOutput.length);
    if (delta) output.push(line("command output:", delta));
    state.commandOutput = aggregate;
    if (stage === "completed") {
      const status = string(item.status, "command.status");
      const exitCode = item.exit_code === null || item.exit_code === undefined ? "none" : String(this.number(item.exit_code, "command.exit_code"));
      output.push(line("command completed:", `status=${status} exit=${exitCode}`));
    }
    return output;
  }

  private fileChange(stage: "started" | "updated" | "completed", item: JsonRecord, state: ItemState): string[] {
    if (!Array.isArray(item.changes)) throw unsafe("file_change.changes must be an array");
    const output: string[] = [];
    for (const value of item.changes) {
      const change = record(value, "file_change.change");
      const path = string(change.path, "file_change.path");
      const kind = string(change.kind, "file_change.kind");
      const key = `${kind}\u0000${path}`;
      const patch = optionalString(change.patch ?? change.diff, "file_change.patch") ?? "";
      const previous = state.changes.get(key);
      if (previous === undefined) output.push(line(`file ${kind}:`, path));
      else if (!patch.startsWith(previous)) throw unsafe(`file change ${path} patch was not cumulative`);
      const delta = patch.slice(previous?.length ?? 0);
      if (delta) output.push(line("patch:", delta));
      state.changes.set(key, patch);
    }
    if (stage === "completed") output.push(line("file changes completed:", string(item.status, "file_change.status")));
    return output;
  }

  private textItem(stage: "started" | "updated" | "completed", item: JsonRecord, state: ItemState, label: string, finalOnly: boolean): string[] {
    const text = string(item.text, `${item.type}.text`);
    if (!text.startsWith(state.text)) throw unsafe(`item ${string(item.id, "item.id")} text was not cumulative`);
    const delta = text.slice(state.text.length);
    state.text = text;
    if (finalOnly) return stage === "completed" && text ? [line(label, text)] : [];
    return delta ? [line(label, delta)] : [];
  }

  private itemError(id: string, item: JsonRecord): string[] {
    this.eventIds.add(`item.error:${id}`);
    return [line("warning:", string(item.message, "error.message"))];
  }

  private todo(stage: "started" | "updated" | "completed", item: JsonRecord): string[] {
    if (!Array.isArray(item.items)) throw unsafe("todo_list.items must be an array");
    const summary = item.items.map((value) => {
      const todo = record(value, "todo_list.item");
      return `${todo.completed === true ? "[x]" : "[ ]"} ${string(todo.text, "todo_list.text")}`;
    }).join("; ");
    return [line(`todo ${stage}:`, summary)];
  }
}
