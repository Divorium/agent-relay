import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";

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

async function initializeRepository(workspace: string, plan = "# Plan\n"): Promise<void> {
  await mkdir(join(workspace, ".agent-relay"), { recursive: true });
  await writeFile(join(workspace, "plan.md"), plan);
  await writeFile(join(workspace, "tracked.txt"), "before\n");
  runGit(workspace, ["init"]);
  runGit(workspace, ["config", "user.name", "Test Runner"]);
  runGit(workspace, ["config", "user.email", "runner@example.invalid"]);
  await writeFile(join(workspace, ".git", "info", "exclude"), ".agent-relay/\n");
  runGit(workspace, ["add", "plan.md", "tracked.txt"]);
  runGit(workspace, ["commit", "-m", "Initial state"]);
}

function minimalResult(requestId: string, summary: string) {
  return {
    schemaVersion: 1,
    requestId,
    summary,
    validation: [{ command: "npm test", status: "passed", exitCode: 0, details: "Passed." }],
  };
}

async function runClient(workspaceRoot: string, workspace: string, githubOutput: string, requestId: string, serverUrl: string) {
  return await runProcess(process.execPath, [join(process.cwd(), "runner", "client.mjs")], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AGENT_RELAY_URL: serverUrl,
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
}

test("runner client derives the commit message from the active plan title", async () => {
  const root = join(tmpdir(), `agent-relay-runner-client-${process.pid}-${Date.now()}`);
  const workspaceRoot = join(root, "workspaces");
  const workspace = join(workspaceRoot, "repository", "repository");
  const githubOutput = join(root, "github-output");
  const requestId = "12345-67890-1";
  await mkdir(workspace, { recursive: true });
  await writeFile(githubOutput, "");
  await initializeRepository(workspace, "# Implement controlled change\n");
  await writeFile(join(workspace, "tracked.txt"), "after\n");
  await writeFile(join(workspace, ".agent-relay", "result.json"), `${JSON.stringify(minimalResult(requestId, "Completed the controlled integration test."))}\n`);

  let submitted: Record<string, unknown> | undefined;
  const server = createServer(async (req: any, res: any) => {
    let body = "";
    for await (const chunk of req) body += String(chunk);
    submitted = JSON.parse(body) as Record<string, unknown>;
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/jobs");
    assert.equal(req.headers.authorization, "Bearer relay-token");
    res.statusCode = 202;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: "job-1", status: "completed" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const result = await runClient(workspaceRoot, workspace, githubOutput, requestId, `http://127.0.0.1:${address.port}`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Agent Relay job job-1: completed/);
    assert.match(result.stdout, /Codex summary: Completed the controlled integration test\./);
    assert.match(result.stdout, /Validation passed: npm test - Passed\./);
    assert.equal(await readFile(githubOutput, "utf8"), "commit_message=Implement controlled change\n");
    assert.deepEqual(submitted, {
      requestId,
      workspace: "repository/repository",
      planPath: "plan.md",
      mode: "implement",
    });
    await assert.rejects(() => stat(join(workspace, ".agent-relay")));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("runner client uses a fixed commit-message fallback when the plan has no title", async () => {
  const root = join(tmpdir(), `agent-relay-runner-client-fallback-${process.pid}-${Date.now()}`);
  const workspaceRoot = join(root, "workspaces");
  const workspace = join(workspaceRoot, "repository", "repository");
  const githubOutput = join(root, "github-output");
  const requestId = "12345-67890-fallback";
  await mkdir(workspace, { recursive: true });
  await writeFile(githubOutput, "");
  await initializeRepository(workspace, "No heading\n");
  await writeFile(join(workspace, "tracked.txt"), "after\n");
  await writeFile(join(workspace, ".agent-relay", "result.json"), `${JSON.stringify(minimalResult(requestId, "Completed."))}\n`);

  const server = createServer((_req: any, res: any) => {
    res.statusCode = 202;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: "job-fallback", status: "completed" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const result = await runClient(workspaceRoot, workspace, githubOutput, requestId, `http://127.0.0.1:${address.port}`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(githubOutput, "utf8"), "commit_message=Apply active ExecPlan\n");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("runner client leaves GITHUB_OUTPUT empty when Git reports a clean worktree", async () => {
  const root = join(tmpdir(), `agent-relay-runner-client-clean-${process.pid}-${Date.now()}`);
  const workspaceRoot = join(root, "workspaces");
  const workspace = join(workspaceRoot, "repository", "repository");
  const githubOutput = join(root, "github-output");
  const requestId = "12345-67890-2";
  await mkdir(workspace, { recursive: true });
  await writeFile(githubOutput, "");
  await initializeRepository(workspace);
  await writeFile(join(workspace, ".agent-relay", "result.json"), `${JSON.stringify(minimalResult(requestId, "No repository files required changes."))}\n`);

  const server = createServer((_req: any, res: any) => {
    res.statusCode = 202;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: "job-2", status: "completed" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const result = await runClient(workspaceRoot, workspace, githubOutput, requestId, `http://127.0.0.1:${address.port}`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(githubOutput, "utf8"), "");
    await assert.rejects(() => stat(join(workspace, ".agent-relay")));
    assert.equal(spawnSync("git", ["status", "--porcelain"], { cwd: workspace, encoding: "utf8" }).stdout.trim(), "");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("workflow template keeps checkout credentials away from Codex and injects push credentials only into finalization", async () => {
  const workflow = await readFile(join(process.cwd(), "examples", "github-actions", "agent-relay.yml"), "utf8");
  assert.match(workflow, /pr_number:/);
  assert.doesNotMatch(workflow, /inputs\.branch/);
  assert.match(workflow, /run: node \/runner\/resolve-pr\.mjs/);
  assert.match(workflow, /ref: \$\{\{ steps\.pr\.outputs\.head_sha \}\}/);
  assert.match(workflow, /TARGET_BRANCH: \$\{\{ steps\.pr\.outputs\.head_ref \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /Verify credential-free checkout/);
  assert.match(workflow, /GITHUB_PUSH_TOKEN: \$\{\{ secrets\.AGENT_RELAY_PUSH_TOKEN \|\| github\.token \}\}/);
  assert.doesNotMatch(workflow, /AGENT_RELAY_REQUEST_ID/);
  assert.match(workflow, /node \/runner\/client\.mjs 2>&1 \| tee/);
  assert.doesNotMatch(workflow, /client\.mjs[^\n]*GITHUB_OUTPUT/);
  assert.match(workflow, /run: \/runner\/finalize\.sh/);
});
