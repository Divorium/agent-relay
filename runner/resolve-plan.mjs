#!/usr/bin/env node
import { appendFile, lstat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const ACTIVE_PLAN_PATH = /^docs\/exec-plans\/active\/[A-Za-z0-9._-]+\.md$/u;
const COMMIT_SHA = /^[0-9a-f]{40}$/u;

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value || CONTROL_CHARACTERS.test(value)) throw new Error(`${name} is required and must not contain control characters`);
  return value;
}

function resolvePullRequestPlan(workspace, baseSha, headSha) {
  if (!COMMIT_SHA.test(baseSha)) throw new Error("Pull request base SHA is invalid");
  if (!COMMIT_SHA.test(headSha)) throw new Error("Pull request head SHA is invalid");
  const result = spawnSync(
    "git",
    ["diff", "--name-only", "--diff-filter=AM", `${baseSha}...${headSha}`, "--", ":(glob)docs/exec-plans/active/*.md"],
    { cwd: workspace, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr.trim() || "Could not resolve the active ExecPlan diff");
  const candidates = result.stdout.split(/\r?\n/u).filter(Boolean).sort();
  const unique = [...new Set(candidates)];
  if (unique.length !== 1) throw new Error(`Expected exactly one added or modified active ExecPlan, found ${unique.length}`);
  return unique[0];
}

async function validatePlan(workspace, planPath) {
  if (!ACTIVE_PLAN_PATH.test(planPath)) throw new Error("ExecPlan must be a safe file directly under docs/exec-plans/active");
  const candidate = resolve(workspace, planPath);
  let info;
  try {
    info = await lstat(candidate);
  } catch {
    throw new Error(`ExecPlan does not exist: ${planPath}`);
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`ExecPlan must be a regular, non-symlink file: ${planPath}`);
  return planPath;
}

export async function main() {
  const eventName = requiredEnvironment("EVENT_NAME");
  const workspace = requiredEnvironment("GITHUB_WORKSPACE");
  const outputPath = requiredEnvironment("GITHUB_OUTPUT");
  let planPath;
  if (eventName === "pull_request") {
    planPath = resolvePullRequestPlan(workspace, requiredEnvironment("BASE_SHA"), requiredEnvironment("HEAD_SHA"));
  } else if (eventName === "workflow_dispatch") {
    planPath = requiredEnvironment("INPUT_PLAN_PATH");
  } else {
    throw new Error(`Unsupported event: ${eventName}`);
  }
  await appendFile(outputPath, `plan_path=${await validatePlan(workspace, planPath)}\n`, "utf8");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
