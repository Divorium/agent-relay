import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { createRelayServer } from "../src/api/server.js";
import { JobService } from "../src/application/job-service.js";
import { CodexExecutor } from "../src/execution/codex-executor.js";
import { JobStore } from "../src/persistence/job-store.js";
import { OutputStore } from "../src/persistence/output-store.js";
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

test("controlled full flow runs runner client through Relay and Codex executor", async () => {
  const root = join(tmpdir(), `agent-relay-full-flow-${process.pid}-${Date.now()}`);
  const workspaceRoot = join(root, "workspaces");
  const workspace = join(workspaceRoot, "repository", "repository");
  const stateDir = join(root, "state");
  const fakeCodex = join(root, "fake-codex");
  const githubOutput = join(root, "github-output");
  const requestId = "repository-100-1";

  await mkdir(workspace, { recursive: true });
  await writeFile(githubOutput, "");
  await writeFile(join(workspace, "plan.md"), "# Active plan\n");
  await writeFile(join(workspace, "tracked.txt"), "before\n");
  runGit(workspace, ["init"]);
  runGit(workspace, ["config", "user.name", "Test Runner"]);
  runGit(workspace, ["config", "user.email", "runner@example.invalid"]);
  runGit(workspace, ["add", "plan.md", "tracked.txt"]);
  runGit(workspace, ["commit", "-m", "Initial state"]);

  await writeFile(fakeCodex, `#!/bin/sh
set -eu
[ "$1" = "--ask-for-approval" ]
[ "$2" = "never" ]
[ "$3" = "-c" ]
[ "$4" = "features.memories=false" ]
[ "$5" = "exec" ]
[ "$6" = "--sandbox" ]
[ "$7" = "danger-full-access" ]
[ "$8" = "--cd" ]
workspace="$9"
printf 'after\\n' > "$workspace/tracked.txt"
cat > "$workspace/.agent-relay/result.json" <<'JSON'
{
  "schemaVersion": 1,
  "requestId": "${requestId}",
  "status": "completed",
  "commitMessage": "Apply controlled full flow",
  "summary": "The controlled executor changed the checked-out worktree.",
  "validation": [{
    "command": "controlled-flow",
    "status": "passed",
    "exitCode": 0,
    "details": "Runner, HTTP API, job lifecycle, process execution and result handoff completed."
  }],
  "blockers": [],
  "limitations": ["Codex authentication and GitHub push are replaced by controlled boundaries."]
}
JSON
`, { mode: 0o700 });
  await chmod(fakeCodex, 0o700);

  const config: AppConfig = {
    host: "127.0.0.1",
    port: 0,
    relayToken: "relay-token",
    workspaceRoot,
    stateDir,
    codexCommand: fakeCodex,
    codexTimeoutMs: 5_000,
  };
  const store = new JobStore(stateDir);
  const outputStore = new OutputStore(stateDir);
  const executor = new CodexExecutor(fakeCodex, config.codexTimeoutMs, outputStore);
  const jobs = new JobService(workspaceRoot, stateDir, store, outputStore, executor);
  await jobs.init();
  const server = createRelayServer(config, jobs, outputStore);
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
        AGENT_RELAY_PLAN_PATH: "plan.md",
        AGENT_RELAY_MODE: "implement",
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
    assert.match(result.stdout, /Agent Relay job .*: accepted/);
    assert.match(result.stdout, /Agent Relay job .*: completed/);
    assert.match(result.stdout, /Codex summary: The controlled executor changed the checked-out worktree\./);
    assert.equal(await readFile(githubOutput, "utf8"), "commit_message=Apply controlled full flow\n");
    assert.equal(await readFile(join(workspace, "tracked.txt"), "utf8"), "after\n");
    await assert.rejects(() => stat(join(workspace, ".agent-relay")));

    const persistedJobs = await readFile(join(stateDir, "request-index.json"), "utf8");
    const requestIndex = JSON.parse(persistedJobs) as Record<string, string>;
    const job = await jobs.get(requestIndex[requestId]!);
    assert.equal(job.status, "completed");
    assert.equal(job.exitCode, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve()));
    await outputStore.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
