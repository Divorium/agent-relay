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

function validateResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Result must be an object");
  const allowed = new Set(["schemaVersion", "requestId", "status", "shouldCommit", "commitMessage", "summary", "validation", "blockers", "limitations"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`Unknown result field: ${key}`);
  if (value.schemaVersion !== 1 || value.requestId !== requestId) throw new Error("Result contract mismatch");
  if (!["completed", "blocked"].includes(value.status)) throw new Error("Invalid result status");
  if (typeof value.shouldCommit !== "boolean") throw new Error("Invalid shouldCommit");
  if (typeof value.summary !== "string" || !value.summary.trim() || value.summary.length > 4000) throw new Error("Invalid summary");
  for (const field of ["validation", "blockers", "limitations"]) if (!Array.isArray(value[field])) throw new Error(`Invalid ${field}`);
  if (value.status === "blocked" && value.shouldCommit) throw new Error("Blocked result cannot request a commit");
  if (value.status === "completed" && value.shouldCommit) {
    if (typeof value.commitMessage !== "string" || !value.commitMessage.trim() || value.commitMessage.length > 120 || /[\r\n\u0000-\u001f\u007f]/.test(value.commitMessage)) throw new Error("Invalid commitMessage");
  } else if (value.commitMessage !== undefined) {
    throw new Error("Unexpected commitMessage");
  }
  return value;
}

const relativeWorkspace = workspace.replace(/^\/runner\/_work\/?/, "");
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const create = await fetch(`${baseUrl}/v1/jobs`, { method: "POST", headers, body: JSON.stringify({ requestId, workspace: relativeWorkspace, planPath, mode }) });
if (!create.ok) throw new Error(`Job creation failed: ${create.status} ${await create.text()}`);
let job = await create.json();
while (["accepted", "running"].includes(job.status)) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const response = await fetch(`${baseUrl}/v1/jobs/${job.id}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Job polling failed: ${response.status} ${await response.text()}`);
  job = await response.json();
}
if (job.status !== "completed" && job.status !== "blocked") throw new Error(`Agent Relay job failed: ${job.status} ${job.errorCode ?? ""} ${job.errorMessage ?? ""}`);
const result = validateResult(JSON.parse(await readFile(`${workspace}/.agent-relay/result.json`, "utf8")));
if (result.status === "blocked") throw new Error(`Codex blocked: ${result.blockers.join("; ")}`);
const diff = spawnSync("git", ["status", "--porcelain"], { cwd: workspace, encoding: "utf8" });
if (diff.status !== 0) throw new Error(diff.stderr || "git status failed");
const hasChanges = diff.stdout.trim().length > 0;
if (result.shouldCommit !== hasChanges) throw new Error("Result shouldCommit does not match actual worktree");
await rm(`${workspace}/.agent-relay`, { recursive: true, force: true });
if (!hasChanges) process.exit(0);
process.stdout.write(`commit_message=${result.commitMessage}\n`);
