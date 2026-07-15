#!/usr/bin/env node
import { appendFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const baseUrl = process.env.AGENT_RELAY_URL ?? "http://agent-relay:8080";
const token = process.env.AGENT_RELAY_TOKEN;
if (!token) throw new Error("AGENT_RELAY_TOKEN is required");
const workspace = process.env.GITHUB_WORKSPACE;
const workspaceRoot = process.env.AGENT_RELAY_WORKSPACE_ROOT ?? "/runner/_work";
const planPath = process.env.AGENT_RELAY_PLAN_PATH;
const githubOutput = process.env.GITHUB_OUTPUT;
const requestId = process.env.AGENT_RELAY_REQUEST_ID ?? randomUUID();
if (!workspace || !planPath || !githubOutput) {
  throw new Error("GITHUB_WORKSPACE, AGENT_RELAY_PLAN_PATH and GITHUB_OUTPUT are required");
}

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

function requiredString(value, name, maxLength) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || CONTROL_CHARACTERS.test(value)) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
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

const commitMessage = deriveCommitMessage(await readFile(`${workspace}/${planPath}`, "utf8"));
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
let job = await fetchJson(`${baseUrl}/v1/jobs`, {
  method: "POST",
  headers,
  body: JSON.stringify({ requestId, workspace: relativeWorkspace, planPath }),
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

const diff = spawnSync("git", ["status", "--porcelain"], { cwd: workspace, encoding: "utf8" });
if (diff.status !== 0) throw new Error(diff.stderr || "git status failed");
if (diff.stdout.trim().length === 0) process.exit(0);

await appendFile(githubOutput, `commit_message=${commitMessage}\n`, "utf8");
