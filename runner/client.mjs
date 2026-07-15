#!/usr/bin/env node
import { appendFile, lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";
import { once } from "node:events";

const baseUrl = process.env.AGENT_RELAY_URL ?? "http://agent-relay:8080";
const token = process.env.AGENT_RELAY_TOKEN;
const workspace = process.env.GITHUB_WORKSPACE;
const workspaceRoot = process.env.AGENT_RELAY_WORKSPACE_ROOT ?? "/runner/_work";
const planPath = process.env.AGENT_RELAY_PLAN_PATH;
const githubOutput = process.env.GITHUB_OUTPUT;
const archivePath = process.env.AGENT_RELAY_OUTPUT_ARCHIVE_PATH;
if (!token) throw new Error("AGENT_RELAY_TOKEN is required");
if (!workspace || !planPath || !githubOutput) throw new Error("GITHUB_WORKSPACE, AGENT_RELAY_PLAN_PATH and GITHUB_OUTPUT are required");

const ACTIVE_PLAN_PATH = /^docs\/exec-plans\/active\/[A-Za-z0-9._-]+\.md$/;
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
const JOB_STATUSES = new Set(["accepted", "running", "completed", "failed", "timed_out", "interrupted"]);
const ACTIVE_JOB_STATUSES = new Set(["accepted", "running"]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const CONTROL_CHARACTERS_GLOBAL = /[\u0000-\u001f\u007f]/g;
const MAX_RESPONSE_BYTES = 64_000;
const MAX_REMOTE_ERROR_BODY_BYTES = 8192;

function positiveInteger(name, fallback) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

const requestTimeoutMs = positiveInteger("AGENT_RELAY_REQUEST_TIMEOUT_MS", 30_000);
const pollIntervalMs = positiveInteger("AGENT_RELAY_POLL_INTERVAL_MS", 5_000);
const pollTimeoutMs = positiveInteger("AGENT_RELAY_POLL_TIMEOUT_MS", 21_900_000);

function requestId() {
  if (process.env.AGENT_RELAY_REQUEST_ID) return process.env.AGENT_RELAY_REQUEST_ID;
  const parts = [process.env.GITHUB_REPOSITORY_ID, process.env.GITHUB_RUN_ID, process.env.GITHUB_RUN_ATTEMPT];
  return parts.every((part) => typeof part === "string" && /^[1-9][0-9]*$/.test(part))
    ? `gha-${parts.join("-")}`
    : randomUUID();
}

function requiredString(value, name, maxLength) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || CONTROL_CHARACTERS.test(value)) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

function deriveCommitMessage(plan) {
  const heading = plan.split(/\r?\n/u).find((line) => /^#[ \t]+\S/u.test(line));
  const source = heading ? heading.replace(/^#[ \t]+/u, "") : "";
  const normalized = source.replace(CONTROL_CHARACTERS_GLOBAL, " ").replace(/\s+/gu, " ").trim();
  return requiredString(Array.from(normalized).slice(0, 120).join("").trim() || "Apply active ExecPlan", "commitMessage", 120);
}

function isOutside(root, candidate) {
  const path = relative(root, candidate);
  return path === ".." || path.startsWith(`..${sep}`) || resolve(root, path) !== candidate;
}

async function resolvePlanFile(resolvedWorkspace, requestedPlanPath) {
  if (!ACTIVE_PLAN_PATH.test(requestedPlanPath)) throw new Error("AGENT_RELAY_PLAN_PATH must identify a file directly under docs/exec-plans/active");
  const activeRoot = resolve(resolvedWorkspace, "docs", "exec-plans", "active");
  const candidate = resolve(resolvedWorkspace, requestedPlanPath);
  const relativePath = relative(activeRoot, candidate);
  if (!relativePath || relativePath.includes(sep) || isOutside(activeRoot, candidate)) throw new Error("Invalid active ExecPlan path");
  const info = await lstat(candidate);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Active ExecPlan must be a regular file");
  if (await realpath(candidate) !== candidate) throw new Error("Active ExecPlan must not traverse symbolic links");
  return candidate;
}

async function readBoundedText(response, limit = MAX_RESPONSE_BYTES) {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > limit) throw new Error(`Agent Relay response exceeded ${limit} bytes`);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    bytes += chunk.length;
    if (bytes > limit) {
      await reader.cancel();
      throw new Error(`Agent Relay response exceeded ${limit} bytes`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

function matchesContentType(response, mediaType) {
  return new RegExp(`^${mediaType.replace("/", "\\/")}(?:\\s*;|$)`, "i").test(response.headers.get("content-type") ?? "");
}

async function fetchJson(url, expectedStatus, options = {}) {
  const response = await fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(requestTimeoutMs) });
  const text = await readBoundedText(response);
  if (response.status !== expectedStatus) throw new Error(`Agent Relay request failed with HTTP ${response.status}`);
  if (!matchesContentType(response, "application/json") && !/\+json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
    throw new Error("Agent Relay returned a non-JSON content type");
  }
  if (!text.trim()) throw new Error("Agent Relay returned an empty JSON response");
  try { return JSON.parse(text); } catch { throw new Error("Agent Relay returned invalid JSON"); }
}

function validateJob(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Agent Relay returned an invalid job object");
  if (typeof value.id !== "string" || !JOB_ID.test(value.id)) throw new Error("Agent Relay returned an invalid job id");
  if (typeof value.status !== "string" || !JOB_STATUSES.has(value.status)) throw new Error("Agent Relay returned an invalid job status");
  if (value.errorCode !== undefined) requiredString(value.errorCode, "job.errorCode", 256);
  if (value.errorMessage !== undefined) requiredString(value.errorMessage, "job.errorMessage", 2048);
  return value;
}

function logJobStatus(job) { console.log(`Agent Relay job ${job.id}: ${job.status}`); }

async function writeFully(handle, chunk) {
  let offset = 0;
  while (offset < chunk.length) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset, null);
    if (bytesWritten <= 0) throw new Error("Archive write made no progress");
    offset += bytesWritten;
  }
}

async function writeStdout(chunk) {
  if (process.stdout.destroyed || process.stdout.writableEnded) throw new Error("stdout is unavailable");
  if (process.stdout.write(chunk)) return;
  await Promise.race([
    once(process.stdout, "drain"),
    once(process.stdout, "error").then(([error]) => Promise.reject(error)),
    once(process.stdout, "close").then(() => Promise.reject(new Error("stdout closed"))),
  ]);
}

async function streamOutput(jobId, finalPath) {
  const final = resolve(finalPath);
  const temporary = `${final}.tmp-${process.pid}-${randomUUID()}`;
  await mkdir(dirname(final), { recursive: true });
  await rm(final, { force: true });
  const handle = await open(temporary, "wx", 0o600);
  let closed = false;
  try {
    const response = await fetch(`${baseUrl}/v1/jobs/${jobId}/output?offset=0`, {
      redirect: "error",
      headers: { authorization: `Bearer ${token}`, accept: "application/octet-stream", "accept-encoding": "identity" },
      signal: AbortSignal.timeout(pollTimeoutMs),
    });
    if (response.status !== 200) {
      await readBoundedText(response, MAX_REMOTE_ERROR_BODY_BYTES).catch(() => "");
      throw new Error(`Agent Relay output request failed with HTTP ${response.status}`);
    }
    if (!matchesContentType(response, "application/octet-stream")) throw new Error("Agent Relay returned a non-octet-stream output content type");
    const encoding = response.headers.get("content-encoding");
    if (encoding && encoding.toLowerCase() !== "identity") throw new Error("Agent Relay returned transformed output");
    if (response.headers.get("x-agent-relay-output-offset") !== "0") throw new Error("Agent Relay returned an invalid output offset acknowledgement");
    if (!response.body) throw new Error("Agent Relay returned an empty output body");
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      await writeFully(handle, chunk);
      await writeStdout(chunk);
    }
    await handle.sync();
    await handle.close();
    closed = true;
    await rename(temporary, final);
  } catch (error) {
    if (!closed) await handle.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    await rm(final, { force: true }).catch(() => undefined);
    throw error;
  }
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
const outputPromise = archivePath ? streamOutput(job.id, archivePath) : undefined;
const deadline = Date.now() + pollTimeoutMs;
while (ACTIVE_JOB_STATUSES.has(job.status)) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(`Agent Relay polling timed out after ${pollTimeoutMs}ms`);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(pollIntervalMs, remaining)));
  if (Date.now() >= deadline) throw new Error(`Agent Relay polling timed out after ${pollTimeoutMs}ms`);
  job = validateJob(await fetchJson(`${baseUrl}/v1/jobs/${job.id}`, 200, { headers: { authorization: `Bearer ${token}` } }));
  if (job.status !== previousStatus) {
    logJobStatus(job);
    previousStatus = job.status;
  }
}
if (outputPromise) await outputPromise;
if (job.status !== "completed") throw new Error(`Agent Relay job failed: ${job.status} ${job.errorCode ?? ""} ${job.errorMessage ?? ""}`);
await appendFile(githubOutput, `commit_message=${commitMessage}\n`, "utf8");
