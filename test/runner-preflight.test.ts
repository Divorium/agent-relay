import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function runClient(env: Record<string, string>): Promise<{ status: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), "runner", "client.mjs")], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: unknown) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code: number | null) => resolve({ status: code ?? 1, stderr }));
  });
}

test("runner preserves the preflight commit message when Codex moves the active plan", async () => {
  const root = join(tmpdir(), `agent-relay-preflight-${process.pid}-${Date.now()}`);
  const workspaceRoot = join(root, "workspaces");
  const workspace = join(workspaceRoot, "owner", "repo");
  const active = join(workspace, "docs", "exec-plans", "active", "task.md");
  const completed = join(workspace, "docs", "exec-plans", "completed", "task.md");
  const githubOutput = join(root, "github-output");
  await mkdir(join(workspace, "docs", "exec-plans", "active"), { recursive: true });
  await mkdir(join(workspace, "docs", "exec-plans", "completed"), { recursive: true });
  await writeFile(active, "# Finish context audit\n");
  await writeFile(githubOutput, "");
  git(workspace, ["init"]);
  git(workspace, ["config", "user.name", "Test"]);
  git(workspace, ["config", "user.email", "test@example.invalid"]);
  git(workspace, ["add", "."]);
  git(workspace, ["commit", "-m", "Initial"]);

  const server = createServer(async (req: any, res: any) => {
    if (req.method !== "POST") throw new Error("Unexpected request");
    for await (const _chunk of req) {
      // Drain request body.
    }
    await rename(active, completed);
    res.statusCode = 202;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: "job-1", status: "completed" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const result = await runClient({
      AGENT_RELAY_URL: `http://127.0.0.1:${address.port}`,
      AGENT_RELAY_TOKEN: "relay-token",
      AGENT_RELAY_PLAN_PATH: "docs/exec-plans/active/task.md",
      AGENT_RELAY_WORKSPACE_ROOT: workspaceRoot,
      GITHUB_WORKSPACE: workspace,
      GITHUB_OUTPUT: githubOutput,
      AGENT_RELAY_REQUEST_TIMEOUT_MS: "5000",
      AGENT_RELAY_POLL_INTERVAL_MS: "10",
      AGENT_RELAY_POLL_TIMEOUT_MS: "5000",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(githubOutput, "utf8"), "commit_message=Finish context audit\n");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
