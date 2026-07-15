import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { createRelayServer } from "../src/api/server.js";
import { JobService } from "../src/application/job-service.js";
import { CodexExecutor } from "../src/execution/codex-executor.js";
import { JobStore } from "../src/persistence/job-store.js";
import type { AppConfig } from "../src/config/config.js";

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function runProcess(command: string, args: string[], options: Record<string, unknown>): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: unknown) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk: unknown) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code: number | null) => resolve({ status: code ?? 1, stdout, stderr }));
  });
}

test("controlled full flow preserves work and an active-plan blocker without a result artifact", async () => {
  const root = join(tmpdir(), `agent-relay-full-flow-${process.pid}-${Date.now()}`);
  const workspaceRoot = join(root, "workspaces");
  const workspace = join(workspaceRoot, "repository", "repository");
  const stateDir = join(root, "state");
  const fakeCodex = join(root, "fake-codex");
  const githubOutput = join(root, "github-output");
  const requestId = "controlled-request-id";
  const planPath = "docs/exec-plans/active/plan.md";

  await mkdir(join(workspace, "docs", "exec-plans", "active"), { recursive: true });
  await writeFile(githubOutput, "");
  await writeFile(join(workspace, planPath), "# Active plan\n\n- [ ] [blocked] External image validation — Cause: Docker unavailable. Impact: image validation deferred. Evidence: command missing. Unblock condition: run on CI.\n");
  await writeFile(join(workspace, "tracked.txt"), "before\n");
  runGit(workspace, ["init"]);
  runGit(workspace, ["config", "user.name", "Test Runner"]);
  runGit(workspace, ["config", "user.email", "runner@example.invalid"]);
  runGit(workspace, ["add", "."]);
  runGit(workspace, ["commit", "-m", "Initial state"]);

  await writeFile(fakeCodex, `#!/bin/sh
set -eu
args="$*"
case "$args" in *'default_permissions="relay"'*) ;; *) exit 31 ;; esac
case "$args" in *'"/home/agent/.codex"="deny"'*) ;; *) exit 32 ;; esac
case "$args" in *'"${workspaceRoot}"="deny"'*) ;; *) exit 33 ;; esac
case "$args" in *'"${workspace}"="write"'*) ;; *) exit 34 ;; esac
case "$args" in *'"${workspace}/.git"="read"'*) ;; *) exit 35 ;; esac
case "$args" in *'danger-full-access'*) exit 36 ;; esac
case "$args" in *'result.json'*) exit 37 ;; esac
case "$args" in *'.agent/PLANS.md'*) ;; *) exit 38 ;; esac
while [ "$1" != "--cd" ]; do shift; done
workspace="$2"
printf 'after\n' > "$workspace/tracked.txt"
`, { mode: 0o700 });
  await chmod(fakeCodex, 0o700);

  const config: AppConfig = {
    host: "127.0.0.1",
    port: 0,
    relayToken: "relay-token",
    workspaceRoot,
    stateDir,
    codexTimeoutMs: 5_000,
    maxOutputBytes: 100_000,
  };
  const store = new JobStore(stateDir);
  const executor = new CodexExecutor(fakeCodex, config.codexTimeoutMs, config.maxOutputBytes, undefined, workspaceRoot);
  const jobs = new JobService(workspaceRoot, stateDir, store, executor);
  await jobs.init();
  const server = createRelayServer(config, jobs);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const result = await runProcess(process.execPath, [join(process.cwd(), "runner", "client.mjs")], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGENT_RELAY_URL: `http://127.0.0.1:${address.port}`,
        AGENT_RELAY_TOKEN: "relay-token",
        AGENT_RELAY_PLAN_PATH: planPath,
        AGENT_RELAY_REQUEST_ID: requestId,
        AGENT_RELAY_WORKSPACE_ROOT: workspaceRoot,
        GITHUB_WORKSPACE: workspace,
        GITHUB_OUTPUT: githubOutput,
        AGENT_RELAY_REQUEST_TIMEOUT_MS: "5000",
        AGENT_RELAY_POLL_INTERVAL_MS: "10",
        AGENT_RELAY_POLL_TIMEOUT_MS: "5000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Agent Relay job .*: completed/);
    assert.doesNotMatch(result.stdout, /Codex summary|Validation passed/);
    assert.equal(await readFile(githubOutput, "utf8"), "commit_message=Active plan\n");
    assert.equal(await readFile(join(workspace, "tracked.txt"), "utf8"), "after\n");
    assert.match(await readFile(join(workspace, planPath), "utf8"), /\[blocked\]/);

    const persistedJobs = await readFile(join(stateDir, "request-index.json"), "utf8");
    const requestIndex = JSON.parse(persistedJobs) as Record<string, string>;
    const job = await jobs.get(requestIndex[requestId]!);
    assert.equal(job.status, "completed");
    assert.equal(job.exitCode, 0);
    assert.equal(job.outputPath, join(stateDir, "logs", `${job.id}.log`));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
