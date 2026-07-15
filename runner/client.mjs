#!/usr/bin/env node
import { appendFile, lstat, readFile, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { relative, resolve, sep } from "node:path";

const baseUrl = process.env.AGENT_RELAY_URL ?? "http://agent-relay:8080";
const token = process.env.AGENT_RELAY_TOKEN;
if (!token) throw new Error("AGENT_RELAY_TOKEN is required");
const workspace = process.env.GITHUB_WORKSPACE;
const workspaceRoot = process.env.AGENT_RELAY_WORKSPACE_ROOT ?? "/runner/_work";
const planPath = process.env.AGENT_RELAY_PLAN_PATH;
const githubOutput = process.env.GITHUB_OUTPUT;
if (!workspace || !planPath || !githubOutput) {
  throw new Error("GITHUB_WORKSPACE, AGENT_RELAY_PLAN_PATH and GITHUB_OUTPUT are required");
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const CONTROL_CHARACTERS_GLOBAL = /[\u0000-\u001f\u007f]/g;
const ACTIVE_PLAN_PATH = /^docs\/exec-plans\/active\/[A-Za-z0-9._-]+\.md$/;
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
const JOB_STATUSES = new Set(["accepted", "running", "completed", "failed", "timed_out", "interrupted"]);
const ACTIVE_JOB_STATUSES = new Set(["accepted", "running"]);
const MAX_RESPONSE_BYTES = 64_000;

function positiveInteger(name, fallback) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function requestId() {
  if (process.env.AGENT_RELAY_REQUEST_ID) return process.env.AGENT_RELAY_REQUEST_ID;
  const parts = [process.env.GITHUB_REPOSITORY_ID, process.env.GITHUB_RUN_ID, process.env.GITHUB_RUN_ATTEMPT];
  if (parts.every((part) => typeof part === "string" && /^[1-9][0-9]*$/.test(part))) {
    return `gha-${parts.join("-")}`;
  }
  return randomUUID();
}

const requestTimeoutMs = positiveInteger("AGENT_RELAY_REQUEST_TIMEOUT_MS", 30_000);
const pollIntervalMs = positiveInteger("AGENT_RELAY_POLL_INTERVAL_MS", 5_000);
const pollTimeoutMs = positiveInteger("AGENT_RELAY_POLL_TIMEOUT_MS", 21_900_000);

function requiredString(value, name, maxLength) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || CONTROL_CHARACTERS.test(value)) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

function normalizedCommitSubject(value) {
  const normalized = value.replace(CONTROL_CHARACTERS_GLOBAL, " ").replace(/\s+/gu, " ").trim();
  return Array.from(normalized).slice(0, 120).join("").trim();
}

function deriveCommitMessage(plan) {
  const heading = plan.split(/\r?\n/u).find((line) => /^#[ \t]+\S/u.test(line));
  const source = heading ? heading.replace(/^#[ \t]+/u, "") : "";
  return requiredString(normalizedCommitSubject(source) || "Apply active ExecPlan", "commitMessage", 120);
}

function isOutside(root, candidate) {
  const path = relative(root, candidate);
  return path === ".." || path.startsWith(`..${sep}`) || resolve(root, path) !== candidate;
}

async function resolvePlanFile(resolvedWorkspace, requestedPlanPath) {
  if (!ACTIVE_PLAN_PATH.test(requestedPlanPath)) {
    throw new Error("AGENT_RELAY_PLAN_PATH must identify a file directly under docs/exec-plans/active");
  }
  const activeRoot = resolve(resolvedWorkspace, "docs", "exec-plans", "active");
  const candidate = resolve(resolvedWorkspace, requestedPlanPath);
  const path = relative(activeRoot, candidate);
  if (!path || path.includes(sep) || isOutside(activeRoot, candidate)) throw new Error("Invalid active ExecPlan path");
  const info = await lstat(candidate);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Active ExecPlan must be a regular file");
  if (await realpath(candidate) !== candidate) throw new Error("Active ExecPlan must not traverse symbolic links");
  return candidate;
}

async function readBoundedText(response) {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (Number.isFinite(parsed) && parsed > MAX_RESPONSE_BYTES) {
      throw new Error(`Agent Relay response exceeded ${MAX_RESPONSE_BYTES} bytes`);
    }
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    bytes += chunk.length;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`Agent Relay response exceeded ${MAX_RESPONSE_BYTES} bytes`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

function hasJsonContentType(response) {
  const contentType = response.headers.get("content-type") ?? "";
  return /^application\/(?:[A-Za-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(contentType);
}

async function fetchJson(url, expectedStatus, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(requestTimeoutMs) });
  const text = await readBoundedText(response);
  if (response.status !== expectedStatus) {
    throw new Error(`Agent Relay request failed with HTTP ${response.status}`);
  }
  if (!hasJsonContentType(response)) throw new Error("Agent Relay returned a non-JSON content type");
  if (!text.trim()) throw new Error("Agent Relay returned an empty JSON response");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Agent Relay returned invalid JSON");
  }
}

function validateJob(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Agent Relay returned an invalid job object");
  }
  const job = value;
  if (typeof job.id !== "string" || !JOB_ID.test(job.id)) throw new Error("Agent Relay returned an invalid job id");
  if (typeof job.status !== "string" || !JOB_STATUSES.has(job.status)) {
    throw new Error("Agent Relay returned an invalid job status");
  }
  if (job.errorCode !== undefined) requiredString(job.errorCode, "job.errorCode", 256);
  if (job.errorMessage !== undefined) requiredString(job.errorMessage, "job.errorMessage", 2048);
  return job;
}

function logJobStatus(job) {
  console.log(`Agent Relay job ${job.id}: ${job.status}`);
}

const resolvedRoot = await realpath(workspaceRoot);
const resolvedWorkspace = await realpath(workspace);
if (isOutside(resolvedRoot, resolvedWorkspace)) throw new Error("GITHUB_WORKSPACE must be below AGENT_RELAY_WORKSPACE_ROOT");
const relativeWorkspace = relative(resolvedRoot, resolvedWorkspace).split(sep).join("/");
if (!relativeWorkspace) throw new Error("GITHUB_WORKSPACE does not identify a repository workspace");

const planFile = await resolvePlanFile(resolvedWorkspace, planPath);
const commitMessage = deriveCommitMessage(await readFile(planFile, "utf8"));
await appendFile(githubOutput, "", "utf8");

const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
let job = validateJob(await fetchJson(`${baseUrl}/v1/jobs`, 202, {
  method: "POST",
  headers,
  body: JSON.stringify({ requestId: requestId(), workspace: relativeWorkspace, planPath }),
}));
logJobStatus(job);
let previousStatus = job.status;

const pollDeadline = Date.now() + pollTimeoutMs;
while (ACTIVE_JOB_STATUSES.has(job.status)) {
  const remaining = pollDeadline - Date.now();
  if (remaining <= 0) throw new Error(`Agent Relay polling timed out after ${pollTimeoutMs}ms`);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(pollIntervalMs, remaining)));
  if (Date.now() >= pollDeadline) throw new Error(`Agent Relay polling timed out after ${pollTimeoutMs}ms`);
  job = validateJob(await fetchJson(`${baseUrl}/v1/jobs/${job.id}`, 200, {
    headers: { authorization: `Bearer ${token}` },
  }));
  if (job.status !== previousStatus) {
    logJobStatus(job);
    previousStatus = job.status;
  }
}

if (job.status !== "completed") {
  throw new Error(`Agent Relay job failed: ${job.status} ${job.errorCode ?? ""} ${job.errorMessage ?? ""}`);
}

await appendFile(githubOutput, `commit_message=${commitMessage}\n`, "utf8");
