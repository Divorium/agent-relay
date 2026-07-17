import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

function runScript(script: string, env: Record<string, string>, cwd = process.cwd()) {
  return spawnSync(process.execPath, [join(process.cwd(), "runner", script)], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test("request resolver accepts pull_request and workflow_dispatch", async () => {
  const root = join(tmpdir(), `agent-relay-request-${process.pid}-${Date.now()}`);
  const output = join(root, "output");
  await mkdir(root, { recursive: true });
  try {
    await writeFile(output, "");
    const pullRequest = runScript("resolve-request.mjs", {
      EVENT_NAME: "pull_request",
      EVENT_PR_NUMBER: "42",
      INPUT_PR_NUMBER: "",
      GITHUB_OUTPUT: output,
    });
    assert.equal(pullRequest.status, 0, pullRequest.stderr);
    assert.equal(await readFile(output, "utf8"), "pr_number=42\n");

    await writeFile(output, "");
    const dispatch = runScript("resolve-request.mjs", {
      EVENT_NAME: "workflow_dispatch",
      EVENT_PR_NUMBER: "",
      INPUT_PR_NUMBER: "7",
      GITHUB_OUTPUT: output,
    });
    assert.equal(dispatch.status, 0, dispatch.stderr);
    assert.equal(await readFile(output, "utf8"), "pr_number=7\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("request resolver rejects unsupported events and invalid numbers", async () => {
  const root = join(tmpdir(), `agent-relay-request-invalid-${process.pid}-${Date.now()}`);
  const output = join(root, "output");
  await mkdir(root, { recursive: true });
  await writeFile(output, "");
  try {
    const unsupported = runScript("resolve-request.mjs", { EVENT_NAME: "push", GITHUB_OUTPUT: output });
    assert.notEqual(unsupported.status, 0);
    assert.match(unsupported.stderr, /Unsupported event/u);
    const invalid = runScript("resolve-request.mjs", {
      EVENT_NAME: "pull_request",
      EVENT_PR_NUMBER: "0",
      GITHUB_OUTPUT: output,
    });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /positive integer/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plan resolver selects the single active plan changed by a pull request", async () => {
  const root = join(tmpdir(), `agent-relay-plan-resolver-${process.pid}-${Date.now()}`);
  const output = join(root, "output");
  await mkdir(join(root, "docs", "exec-plans", "active"), { recursive: true });
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.name", "Test"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  await writeFile(join(root, "tracked.txt"), "base\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "base"]);
  const baseSha = git(root, ["rev-parse", "HEAD"]);
  await writeFile(join(root, "docs", "exec-plans", "active", "task.md"), "# Task\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "plan"]);
  const headSha = git(root, ["rev-parse", "HEAD"]);
  await writeFile(output, "");
  try {
    const result = runScript("resolve-plan.mjs", {
      EVENT_NAME: "pull_request",
      GITHUB_WORKSPACE: root,
      GITHUB_OUTPUT: output,
      BASE_SHA: baseSha,
      HEAD_SHA: headSha,
      INPUT_PLAN_PATH: "",
    }, root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(output, "utf8"), "plan_path=docs/exec-plans/active/task.md\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plan resolver validates dispatch paths and rejects symlinks", async () => {
  const root = join(tmpdir(), `agent-relay-plan-dispatch-${process.pid}-${Date.now()}`);
  const active = join(root, "docs", "exec-plans", "active");
  const output = join(root, "output");
  await mkdir(active, { recursive: true });
  await writeFile(join(active, "task.md"), "# Task\n");
  await writeFile(output, "");
  try {
    const accepted = runScript("resolve-plan.mjs", {
      EVENT_NAME: "workflow_dispatch",
      GITHUB_WORKSPACE: root,
      GITHUB_OUTPUT: output,
      INPUT_PLAN_PATH: "docs/exec-plans/active/task.md",
    }, root);
    assert.equal(accepted.status, 0, accepted.stderr);
    await symlink("task.md", join(active, "link.md"));
    const rejected = runScript("resolve-plan.mjs", {
      EVENT_NAME: "workflow_dispatch",
      GITHUB_WORKSPACE: root,
      GITHUB_OUTPUT: output,
      INPUT_PLAN_PATH: "docs/exec-plans/active/link.md",
    }, root);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /regular, non-symlink/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
