import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";

const planPath = "docs/exec-plans/active/plan.md";

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
  await mkdir(join(workspace, "docs", "exec-plans", "active"), { recursive: true });
  await writeFile(join(workspace, planPath), plan);
  await writeFile(join(workspace, "tracked.txt"), "before\n");
  runGit(workspace, ["init"]);
  runGit(workspace, ["config", "user.name", "Test Runner"]);
  runGit(workspace, ["config", "user.email", "runner@example.invalid"]);
  runGit(workspace, ["add", "."]);
  runGit(workspace, ["commit", "-m", "Initial state"]);
}

async function runClient(
  workspaceRoot: string,
  workspace: string,
  githubOutput: string,
  serverUrl: string,
  extraEnv: Record<string, string> = {},
) {
  return await runProcess(process.execPath, [join(process.cwd(), "runner", "client.mjs")], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AGENT_RELAY_URL: serverUrl,
      AGENT_RELAY_TOKEN: "relay-token",
      AGENT_RELAY_PLAN_PATH: planPath,
      AGENT_RELAY_WORKSPACE_ROOT: workspaceRoot,
      GITHUB_WORKSPACE: workspace,
      GITHUB_OUTPUT: githubOutput,
      AGENT_RELAY_REQUEST_TIMEOUT_MS: "5000",
      AGENT_RELAY_POLL_INTERVAL_MS: "10",
      AGENT_RELAY_POLL_TIMEOUT_MS: "5000",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function withCompletedServer(callback: (baseUrl: string, submitted: () => Record<string, unknown> | undefined) => Promise<void>): Promise<void> {
  let requestBody: Record<string, unknown> | undefined;
  const server = createServer(async (req: any, res: any) => {
    let body = "";
    for await (const chunk of req) body += String(chunk);
    requestBody = JSON.parse(body) as Record<string, unknown>;
    res.statusCode = 202;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: "job-1", status: "completed" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await callback(`http://127.0.0.1:${address.port}`, () => requestBody);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve()));
  }
}

test("runner client derives the commit message from the active plan title", async () => {
  const root = join(tmpdir(), `agent-relay-runner-client-${process.pid}-${Date.now()}`);
  const workspaceRoot = join(root, "workspaces");
  const workspace = join(workspaceRoot, "repository", "repository");
  const githubOutput = join(root, "github-output");
  await mkdir(root, { recursive: true });
  await writeFile(githubOutput, "");
  await initializeRepository(workspace, "# Implement controlled change\n");
  await writeFile(join(workspace, "tracked.txt"), "after\n");

  try {
    await withCompletedServer(async (baseUrl, submitted) => {
      const result = await runClient(workspaceRoot, workspace, githubOutput, baseUrl, { AGENT_RELAY_REQUEST_ID: "request-1" });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Agent Relay job job-1: completed/);
      assert.doesNotMatch(result.stdout, /Codex summary|Validation/);
      assert.equal(await readFile(githubOutput, "utf8"), "commit_message=Implement controlled change\n");
      assert.deepEqual(submitted(), {
        requestId: "request-1",
        workspace: "repository/repository",
        planPath,
      });
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runner client derives a stable request ID from the workflow run", async () => {
  const root = join(tmpdir(), `agent-relay-runner-client-id-${process.pid}-${Date.now()}`);
  const workspaceRoot = join(root, "workspaces");
  const workspace = join(workspaceRoot, "repository", "repository");
  const githubOutput = join(root, "github-output");
  await mkdir(root, { recursive: true });
  await writeFile(githubOutput, "");
  await initializeRepository(workspace);
  await writeFile(join(workspace, "tracked.txt"), "after\n");

  try {
    await withCompletedServer(async (baseUrl, submitted) => {
      const result = await runClient(workspaceRoot, workspace, githubOutput, baseUrl, {
        GITHUB_REPOSITORY_ID: "123",
        GITHUB_RUN_ID: "456",
        GITHUB_RUN_ATTEMPT: "2",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(submitted()?.requestId, "gha-123-456-2");
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runner client uses a fixed commit-message fallback when the plan has no title", async () => {
  const root = join(tmpdir(), `agent-relay-runner-client-fallback-${process.pid}-${Date.now()}`);
  const workspaceRoot = join(root, "workspaces");
  const workspace = join(workspaceRoot, "repository", "repository");
  const githubOutput = join(root, "github-output");
  await mkdir(root, { recursive: true });
  await writeFile(githubOutput, "");
  await initializeRepository(workspace, "No heading\n");
  await writeFile(join(workspace, "tracked.txt"), "after\n");

  try {
    await withCompletedServer(async (baseUrl) => {
      const result = await runClient(workspaceRoot, workspace, githubOutput, baseUrl, { AGENT_RELAY_REQUEST_ID: "request-2" });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(await readFile(githubOutput, "utf8"), "commit_message=Apply active ExecPlan\n");
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runner client fails when Relay completes without repository changes", async () => {
  const root = join(tmpdir(), `agent-relay-runner-client-clean-${process.pid}-${Date.now()}`);
  const workspaceRoot = join(root, "workspaces");
  const workspace = join(workspaceRoot, "repository", "repository");
  const githubOutput = join(root, "github-output");
  await mkdir(root, { recursive: true });
  await writeFile(githubOutput, "");
  await initializeRepository(workspace);

  try {
    await withCompletedServer(async (baseUrl) => {
      const result = await runClient(workspaceRoot, workspace, githubOutput, baseUrl, { AGENT_RELAY_REQUEST_ID: "request-3" });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /completed without repository changes/);
      assert.equal(await readFile(githubOutput, "utf8"), "");
      assert.equal(spawnSync("git", ["status", "--porcelain"], { cwd: workspace, encoding: "utf8" }).stdout.trim(), "");
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runner client rejects a non-active plan before contacting Relay", async () => {
  const root = join(tmpdir(), `agent-relay-runner-client-invalid-${process.pid}-${Date.now()}`);
  const workspaceRoot = join(root, "workspaces");
  const workspace = join(workspaceRoot, "repository", "repository");
  const githubOutput = join(root, "github-output");
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "plan.md"), "# Invalid\n");
  await writeFile(githubOutput, "");
  try {
    const result = await runClient(workspaceRoot, workspace, githubOutput, "http://127.0.0.1:1", {
      AGENT_RELAY_PLAN_PATH: "plan.md",
      AGENT_RELAY_REQUEST_ID: "request-invalid",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /directly under docs\/exec-plans\/active/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workflow template contains no model result-artifact contract", async () => {
  const workflow = await readFile(join(process.cwd(), "examples", "github-actions", "agent-relay.yml"), "utf8");
  assert.match(workflow, /pr_number:/);
  assert.doesNotMatch(workflow, /inputs\.branch|\bmode:|AGENT_RELAY_REQUEST_ID|AGENT_RELAY_MODE|AGENT_RELAY_OUTPUT_ARCHIVE_PATH|\.agent-relay|result\.json/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /AGENT_RELAY_TOKEN: \$\{\{ secrets\.AGENT_RELAY_TOKEN \}\}/);
  assert.match(workflow, /GITHUB_PUSH_TOKEN: \$\{\{ secrets\.AGENT_RELAY_PUSH_TOKEN \|\| github\.token \}\}/);
  assert.match(workflow, /node \/runner\/client\.mjs 2>&1 \| tee/);
  assert.match(workflow, /run: \/runner\/finalize\.sh/);
});
