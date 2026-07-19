import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { main as runCodex } from "../src/run-codex.js";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function run(command: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function runAsync(command: string, args: string[], cwd: string, env: Record<string, string>) {
  return new Promise<{ status: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: unknown) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk: unknown) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code: number | null) => resolve({ status: code ?? 1, stdout, stderr }));
  });
}

function outputs(value: string): Record<string, string> {
  return Object.fromEntries(value.trim().split("\n").filter(Boolean).map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

async function withEnvironment(values: Record<string, string>, action: () => Promise<void>): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }
  try {
    await action();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("a ready GitHub pull request traverses the complete runtime and invokes mock Codex", async () => {
  const root = join(tmpdir(), `agent-relay-full-flow-${process.pid}-${Date.now()}`);
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  const workRoot = join(root, "storage", "work");
  const workspace = join(workRoot, "repository", "repository");
  const runnerHome = join(root, "runner-home");
  const verification = join(root, "verification");
  const requestOutput = join(root, "request-output");
  const pullOutput = join(root, "pull-output");
  const planOutput = join(root, "plan-output");
  const codexOutput = join(root, "codex-output");
  const codexLog = join(root, "codex-invocation");
  const fakeCodex = join(root, "mock-codex");
  const repository = "owner/repository";
  const branch = "agent/full-flow";

  await mkdir(root, { recursive: true });
  git(root, ["init", "--bare", remote]);
  git(root, ["init", "-b", "main", seed]);
  git(seed, ["config", "user.name", "Seed"]);
  git(seed, ["config", "user.email", "seed@example.invalid"]);
  await writeFile(join(seed, "tracked.txt"), "before\n");
  git(seed, ["add", "."]);
  git(seed, ["commit", "-m", "Base"]);
  const baseSha = git(seed, ["rev-parse", "HEAD"]);
  git(seed, ["remote", "add", "origin", remote]);
  git(seed, ["push", "-u", "origin", "main"]);
  git(seed, ["checkout", "-b", branch]);
  await mkdir(join(seed, "docs", "exec-plans", "active"), { recursive: true });
  await writeFile(join(seed, "docs", "exec-plans", "active", "task.md"), "# Apply full flow\n\nChange tracked state.\n");
  git(seed, ["add", "."]);
  git(seed, ["commit", "-m", "Add active plan"]);
  const headSha = git(seed, ["rev-parse", "HEAD"]);
  git(seed, ["push", "-u", "origin", branch]);

  for (const path of [requestOutput, pullOutput, planOutput, codexOutput]) await writeFile(path, "");

  const server = createServer((req: any, res: any) => {
    assert.equal(req.url, "/repos/owner/repository/pulls/42");
    assert.equal(req.headers.authorization, "Bearer github-token");
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      number: 42,
      state: "open",
      draft: false,
      head: { ref: branch, sha: headSha, repo: { full_name: repository } },
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    run(process.execPath, [join(process.cwd(), "runner", "resolve-request.mjs")], process.cwd(), {
      EVENT_NAME: "pull_request",
      EVENT_PR_NUMBER: "42",
      INPUT_PR_NUMBER: "",
      GITHUB_OUTPUT: requestOutput,
    });
    const request = outputs(await readFile(requestOutput, "utf8"));
    assert.equal(request.pr_number, "42");

    const pullResult = await runAsync(process.execPath, [join(process.cwd(), "runner", "resolve-pr.mjs")], process.cwd(), {
      GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
      GITHUB_TOKEN: "github-token",
      GITHUB_REPOSITORY: repository,
      GITHUB_OUTPUT: pullOutput,
      PR_NUMBER: request.pr_number ?? "",
    });
    assert.equal(pullResult.status, 0, pullResult.stderr);
    const pull = outputs(await readFile(pullOutput, "utf8"));
    assert.equal(pull.head_ref, branch);
    assert.equal(pull.head_sha, headSha);

    await mkdir(join(workRoot, "repository"), { recursive: true });
    run("git", ["clone", "--branch", branch, remote, workspace], root);
    assert.equal(git(workspace, ["rev-parse", "HEAD"]), headSha);

    run(process.execPath, [join(process.cwd(), "runner", "resolve-plan.mjs")], workspace, {
      EVENT_NAME: "pull_request",
      GITHUB_WORKSPACE: workspace,
      GITHUB_OUTPUT: planOutput,
      BASE_SHA: baseSha,
      HEAD_SHA: headSha,
      INPUT_PLAN_PATH: "",
    });
    const plan = outputs(await readFile(planOutput, "utf8"));
    assert.equal(plan.plan_path, "docs/exec-plans/active/task.md");

    await mkdir(runnerHome, { recursive: true });
    await writeFile(fakeCodex, `#!/bin/bash
set -euo pipefail
printf '%s\n' "$*" > "${codexLog}"
printf 'after\n' > "${join(workspace, "tracked.txt")}"
printf '%s\n' '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"mock codex completed"}}'
`, { mode: 0o700 });
    await chmod(fakeCodex, 0o700);

    await withEnvironment({
      GITHUB_WORKSPACE: workspace,
      GITHUB_OUTPUT: codexOutput,
      CODEX_PLAN_PATH: plan.plan_path ?? "",
      CODEX_WORKSPACE_ROOT: workRoot,
      HOME: runnerHome,
      CODEX_TIMEOUT_MS: "5000",
      MAX_OUTPUT_BYTES: "100000",
      RUNNER_TEMP: root,
      CODEX_TRANSCRIPT_PATH: join(root, "agent-relay-console.log"),
    }, async () => runCodex(fakeCodex));

    const codex = outputs(await readFile(codexOutput, "utf8"));
    assert.equal(codex.commit_message, "Apply full flow");
    const invocation = await readFile(codexLog, "utf8");
    assert.match(invocation, /execute the active ExecPlan at docs\/exec-plans\/active\/task\.md/u);

    run("bash", [join(process.cwd(), "runner", "finalize.sh")], workspace, {
      GITHUB_WORKSPACE: workspace,
      TARGET_BRANCH: pull.head_ref ?? "",
      COMMIT_MESSAGE: codex.commit_message ?? "",
      GITHUB_PUSH_TOKEN: "unused-for-local-remote",
    });

    run("git", ["clone", "--branch", branch, remote, verification], root);
    assert.equal(await readFile(join(verification, "tracked.txt"), "utf8"), "after\n");
    assert.equal(git(verification, ["log", "-1", "--pretty=%s"]), "Apply full flow");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
