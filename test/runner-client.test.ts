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

test("runner client submits a job, validates the result and emits a commit message", async () => {
  const root = join(tmpdir(), `agent-relay-runner-client-${process.pid}-${Date.now()}`);
  const workspaceRoot = join(root, "workspaces");
  const workspace = join(workspaceRoot, "repository", "repository");
  const requestId = "12345-67890-1";
  await mkdir(join(workspace, ".agent-relay"), { recursive: true });
  await writeFile(join(workspace, "plan.md"), "# Plan\n");
  await writeFile(join(workspace, "tracked.txt"), "before\n");
  runGit(workspace, ["init"]);
  runGit(workspace, ["config", "user.name", "Test Runner"]);
  runGit(workspace, ["config", "user.email", "runner@example.invalid"]);
  runGit(workspace, ["add", "plan.md", "tracked.txt"]);
  runGit(workspace, ["commit", "-m", "Initial state"]);
  await writeFile(join(workspace, "tracked.txt"), "after\n");
  await writeFile(join(workspace, ".agent-relay", "result.json"), `${JSON.stringify({
    schemaVersion: 1,
    requestId,
    status: "completed",
    shouldCommit: true,
    commitMessage: "Apply the active plan",
    summary: "Completed the controlled integration test.",
    validation: [{ command: "npm test", status: "passed", exitCode: 0, details: "Passed." }],
    blockers: [],
    limitations: [],
  })}\n`);

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
        AGENT_RELAY_REQUEST_TIMEOUT_MS: "5000",
        AGENT_RELAY_POLL_INTERVAL_MS: "10",
        AGENT_RELAY_POLL_TIMEOUT_MS: "5000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "commit_message=Apply the active plan\n");
    assert.deepEqual(submitted, {
      requestId,
      workspace: "repository/repository",
      planPath: "plan.md",
      mode: "implement",
    });
    await assert.rejects(() => stat(join(workspace, ".agent-relay")));
    assert.equal(await readFile(join(workspace, "tracked.txt"), "utf8"), "after\n");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("workflow template uses a valid request ID and environment-safe branch handling", async () => {
  const workflow = await readFile(join(process.cwd(), "examples", "github-actions", "agent-relay.yml"), "utf8");
  assert.match(workflow, /AGENT_RELAY_REQUEST_ID: \$\{\{ github\.repository_id \}\}-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /TARGET_BRANCH: \$\{\{ inputs\.branch \}\}/);
  assert.match(workflow, /git push origin "HEAD:\$\{TARGET_BRANCH\}"/);
  assert.doesNotMatch(workflow, /git push[^\n]*\$\{\{ inputs\.branch \}\}/);
});
