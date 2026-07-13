import { resolve } from "node:path";
import { RelayError } from "../contracts/errors.js";

export interface AppConfig {
  host: string;
  port: number;
  relayToken: string;
  workspaceRoot: string;
  stateDir: string;
  codexCommand: string;
  codexTimeoutMs: number;
  maxOutputBytes: number;
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new RelayError("INTERNAL_ERROR", `${name} is required`, 500);
  return value;
}

function positiveInteger(name: string, value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new RelayError("INTERNAL_ERROR", `${name} must be a positive integer`, 500);
  return parsed;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  return {
    host: env.AGENT_RELAY_HOST ?? "0.0.0.0",
    port: positiveInteger("AGENT_RELAY_PORT", env.AGENT_RELAY_PORT, 8080),
    relayToken: required("AGENT_RELAY_TOKEN", env.AGENT_RELAY_TOKEN),
    workspaceRoot: resolve(required("SHARED_WORKSPACE_ROOT", env.SHARED_WORKSPACE_ROOT)),
    stateDir: resolve(env.AGENT_RELAY_STATE_DIR ?? "/var/lib/agent-relay"),
    codexCommand: env.CODEX_COMMAND ?? "codex",
    codexTimeoutMs: positiveInteger("CODEX_TIMEOUT_MS", env.CODEX_TIMEOUT_MS, 21_600_000),
    maxOutputBytes: positiveInteger("MAX_OUTPUT_BYTES", env.MAX_OUTPUT_BYTES, 10_000_000),
  };
}
