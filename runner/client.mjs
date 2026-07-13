#!/usr/bin/env node
import { readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const baseUrl = process.env.AGENT_RELAY_URL ?? "http://agent-relay:8080";
const token = process.env.AGENT_RELAY_TOKEN;
if (!token) throw new Error("AGENT_RELAY_TOKEN is required");
const workspace = process.env.GITHUB_WORKSPACE;
const planPath = process.env.AGENT_RELAY_PLAN_PATH;
const mode = process.env.AGENT_RELAY_MODE ?? "implement";
const requestId = process.env.AGENT_RELAY_REQUEST_ID ?? `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
if (!workspace || !planPath) throw new Error("GITHUB_WORKSPACE and AGENT_RELAY_PLAN_PATH are required");

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SECRET_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi,
  /("?(?:token|password|secret|apiKey|api_key)"?\s*[:=]\s*(?:["']?))[^\s,"']+((?:["']?))/gi,
];

function positiveInteger(name, fallback) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

const requestTimeoutMs = positiveInteger("AGENT_RELAY_REQUEST_TIMEOUT_MS", 30_000);
const pollIntervalMs = positiveInteger("AGENT_RELAY_POLL_INTERVAL_MS", 5_000);
const pollTimeoutMs = positiveInteger("AGENT_RELAY_POLL_TIMEOUT_MS", 21_900_000);

function asObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value;
}

function strictKeys(value, allowed, name) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`Unknown ${name} field: ${key}`);
}

function requiredString(value, name, maxLength) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || CONTROL_CHARACTERS.test(value)) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

function stringArray(value, name, maxItems, maxLength) {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`Invalid ${name}`);
  return value.map((item, index) => requiredString(item, `${name}[${index}]`, maxLength));
}

function validateValidation(value, index) {
  const record = asObject(value, `validation[${index}]`);
  strictKeys(record, new Set(["command", "status", "exitCode", "details"]), `validation[${index}]`);
  const command = requiredString(record.command, `validation[${index}].command`, 500);
  if (!["passed", "failed", "skipped"].includes(record.status)) throw new Error(`Invalid validation[${index}].status`);
  const details = requiredString(record.details, `validation[${index}].details`, 2000);
  if (record.exitCode !== undefined && (!Number.isInteger(record.exitCode) || record.exitCode < 0 || record.exitCode > 255)) {
    throw new Error(`Invalid validation[${index}].exitCode`);
  }
  return { command, status: record.status, ...(record.exitCode === undefined ? {} : { exitCode: record.exitCode }), details };
}

function assertNoSensitiveData(value) {
  const serialized = JSON.stringify(value);
  if (/auth\.json|\.ssh\/|BEGIN [A-Z ]*PRIVATE KEY/i.test(serialized)) throw new Error("Result contains sensitive data");
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(serialized)) throw new Error("Result contains sensitive data");
  }
}

function validateResult(value) {
  assertNoSensitiveData(value);
  const result = asObject(value, "result");
  strictKeys(result, new Set(["schemaVersion", "requestId", "status", "shouldCommit", "commitMessage", "summary", "validation", "blockers", "limitations"]), "result");
  if (result.schemaVersion !== 1 || result.requestId !== requestId) throw new Error("Result contract mismatch");
  if (result.status !== "completed" && result.status !== "blocked") throw new Error("Invalid result status");
  if (typeof result.shouldCommit !== "boolean") throw new Error("Invalid shouldCommit");

  const summary = requiredString(result.summary, "summary", 4000);
  if (!Array.isArray(result.validation) || result.validation.length > 100) throw new Error("Invalid validation");
  const validation = result.validation.map(validateValidation);
  const blockers = stringArray(result.blockers, "blockers", 50, 2000);
  const limitations = stringArray(result.limitations, "limitations", 50, 2000);

  if (result.status === "blocked" && result.shouldCommit) throw new Error("Blocked result cannot request a commit");
  let commitMessage;
  if (result.status === "completed" && result.shouldCommit) {
    commitMessage = requiredString(result.commitMessage, "commitMessage", 120);
    if (commitMessage.includes("\n") || commitMessage.includes("\r")) throw new Error("Invalid commitMessage");
  } else if (result.commitMessage !== undefined) {
    throw new Error("Unexpected commitMessage");
  }

  return {
    schemaVersion: 1,
    requestId,
    status: result.status,
    shouldCommit: result.shouldCommit,
    ...(commitMessage === undefined ? {} : { commitMessage }),
    summary,
    validation,
    blockers,
    limitations,
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(requestTimeoutMs) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Agent Relay request failed: ${response.status} ${text}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Agent Relay returned invalid JSON");
  }
}

const workspacePrefix = "/runner/_work/";
if (!workspace.startsWith(workspacePrefix)) throw new Error(`GITHUB_WORKSPACE must be below ${workspacePrefix}`);
const relativeWorkspace = workspace.slice(workspacePrefix.length);
if (!relativeWorkspace) throw new Error("GITHUB_WORKSPACE does not identify a repository workspace");

const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
let job = await fetchJson(`${baseUrl}/v1/jobs`, {
  method: "POST",
  headers,
  body: JSON.stringify({ requestId, workspace: relativeWorkspace, planPath, mode }),
});

const pollDeadline = Date.now() + pollTimeoutMs;
while (["accepted", "running"].includes(job.status)) {
  if (Date.now() >= pollDeadline) throw new Error(`Agent Relay polling timed out after ${pollTimeoutMs}ms`);
  await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  job = await fetchJson(`${baseUrl}/v1/jobs/${job.id}`, { headers: { authorization: `Bearer ${token}` } });
}

if (job.status !== "completed" && job.status !== "blocked") {
  throw new Error(`Agent Relay job failed: ${job.status} ${job.errorCode ?? ""} ${job.errorMessage ?? ""}`);
}

const result = validateResult(JSON.parse(await readFile(`${workspace}/.agent-relay/result.json`, "utf8")));
if (result.status === "blocked") throw new Error(`Codex blocked: ${result.blockers.join("; ")}`);
const diff = spawnSync("git", ["status", "--porcelain"], { cwd: workspace, encoding: "utf8" });
if (diff.status !== 0) throw new Error(diff.stderr || "git status failed");
const hasChanges = diff.stdout.trim().length > 0;
if (result.shouldCommit !== hasChanges) throw new Error("Result shouldCommit does not match actual worktree");
await rm(`${workspace}/.agent-relay`, { recursive: true, force: true });
if (!hasChanges) process.exit(0);
process.stdout.write(`commit_message=${result.commitMessage}\n`);
