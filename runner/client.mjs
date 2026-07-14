#!/usr/bin/env node
import { appendFile, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const baseUrl = process.env.AGENT_RELAY_URL ?? "http://agent-relay:8080";
const token = process.env.AGENT_RELAY_TOKEN;
if (!token) throw new Error("AGENT_RELAY_TOKEN is required");
const workspace = process.env.GITHUB_WORKSPACE;
const workspaceRoot = process.env.AGENT_RELAY_WORKSPACE_ROOT ?? "/runner/_work";
const planPath = process.env.AGENT_RELAY_PLAN_PATH;
const mode = process.env.AGENT_RELAY_MODE ?? "implement";
const requestId = process.env.AGENT_RELAY_REQUEST_ID ?? randomUUID();
if (!workspace || !planPath) throw new Error("GITHUB_WORKSPACE and AGENT_RELAY_PLAN_PATH are required");

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

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

function validateResult(value) {
  const result = asObject(value, "result");
  strictKeys(result, new Set(["schemaVersion", "requestId", "summary", "validation"]), "result");
  if (result.schemaVersion !== 1 || result.requestId !== requestId) throw new Error("Result contract mismatch");

  const summary = requiredString(result.summary, "summary", 4000);
  if (!Array.isArray(result.validation) || result.validation.length > 100) throw new Error("Invalid validation");
  const validation = result.validation.map(validateValidation);

  return { schemaVersion: 1, requestId, summary, validation };
}

function deriveCommitMessage(plan) {
  const heading = plan.split(/\r?\n/).find((line) => /^#\s+\S/.test(line));
  const source = heading ? heading.replace(/^#\s+/, "") : "Apply active ExecPlan";
  const normalized = source.replace(/\s+/g, " ").trim().slice(0, 120).trim();
  return requiredString(normalized || "Apply active ExecPlan", "commitMessage", 120);
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

function logJobStatus(job) {
  console.log(`Agent Relay job ${String(job.id ?? "unknown")}: ${String(job.status ?? "unknown")}`);
}

const normalizedRoot = workspaceRoot.replace(/\/$/, "");
const workspacePrefix = `${normalizedRoot}/`;
if (!workspace.startsWith(workspacePrefix)) throw new Error(`GITHUB_WORKSPACE must be below ${workspacePrefix}`);
const relativeWorkspace = workspace.slice(workspacePrefix.length);
if (!relativeWorkspace) throw new Error("GITHUB_WORKSPACE does not identify a repository workspace");

const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
let job = await fetchJson(`${baseUrl}/v1/jobs`, {
  method: "POST",
  headers,
  body: JSON.stringify({ requestId, workspace: relativeWorkspace, planPath, mode }),
});
logJobStatus(job);
let previousStatus = job.status;

const pollDeadline = Date.now() + pollTimeoutMs;
while (["accepted", "running"].includes(job.status)) {
  if (Date.now() >= pollDeadline) throw new Error(`Agent Relay polling timed out after ${pollTimeoutMs}ms`);
  await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  job = await fetchJson(`${baseUrl}/v1/jobs/${job.id}`, { headers: { authorization: `Bearer ${token}` } });
  if (job.status !== previousStatus) {
    logJobStatus(job);
    previousStatus = job.status;
  }
}

if (job.status !== "completed") {
  throw new Error(`Agent Relay job failed: ${job.status} ${job.errorCode ?? ""} ${job.errorMessage ?? ""}`);
}

const result = validateResult(JSON.parse(await readFile(`${workspace}/.agent-relay/result.json`, "utf8")));
const diff = spawnSync("git", ["status", "--porcelain"], { cwd: workspace, encoding: "utf8" });
if (diff.status !== 0) throw new Error(diff.stderr || "git status failed");
const hasChanges = diff.stdout.trim().length > 0;

console.log(`Codex summary: ${result.summary}`);
for (const validation of result.validation) {
  console.log(`Validation ${validation.status}: ${validation.command} - ${validation.details}`);
}

if (!hasChanges) {
  await rm(`${workspace}/.agent-relay`, { recursive: true, force: true });
  process.exit(0);
}

const commitMessage = deriveCommitMessage(await readFile(`${workspace}/${planPath}`, "utf8"));
await rm(`${workspace}/.agent-relay`, { recursive: true, force: true });
const githubOutput = process.env.GITHUB_OUTPUT;
if (!githubOutput) throw new Error("GITHUB_OUTPUT is required when the worktree changed");
await appendFile(githubOutput, `commit_message=${commitMessage}\n`, "utf8");
