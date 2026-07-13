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

const relativeWorkspace = workspace.replace(/^\/runner\/_work\/?/, "");
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const create = await fetch(`${baseUrl}/v1/jobs`, {
  method: "POST",
  headers,
  body: JSON.stringify({ requestId, workspace: relativeWorkspace, planPath, mode }),
});
if (!create.ok) throw new Error(`Job creation failed: ${create.status} ${await create.text()}`);
let job = await create.json();
while (["accepted", "running"].includes(job.status)) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const response = await fetch(`${baseUrl}/v1/jobs/${job.id}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Job polling failed: ${response.status} ${await response.text()}`);
  job = await response.json();
}
if (job.status !== "completed" && job.status !== "blocked") throw new Error(`Agent Relay job failed: ${job.status} ${job.errorCode ?? ""} ${job.errorMessage ?? ""}`);
const resultPath = `${workspace}/.agent-relay/result.json`;
const result = JSON.parse(await readFile(resultPath, "utf8"));
if (result.requestId !== requestId || result.schemaVersion !== 1) throw new Error("Result contract mismatch");
if (result.status === "blocked") throw new Error(`Codex blocked: ${result.blockers.join("; ")}`);
const diff = spawnSync("git", ["status", "--porcelain"], { cwd: workspace, encoding: "utf8" });
if (diff.status !== 0) throw new Error(diff.stderr || "git status failed");
const hasChanges = diff.stdout.trim().length > 0;
if (result.shouldCommit !== hasChanges) throw new Error("Result shouldCommit does not match actual worktree");
await rm(`${workspace}/.agent-relay`, { recursive: true, force: true });
if (!hasChanges) process.exit(0);
if (typeof result.commitMessage !== "string" || !result.commitMessage.trim()) throw new Error("Missing commitMessage");
process.stdout.write(`commit_message=${result.commitMessage}\n`);
