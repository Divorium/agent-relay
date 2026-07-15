import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const planPath = "docs/exec-plans/active/plan.md";

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

async function fixture(name: string) {
  const root = join(tmpdir(), `agent-relay-runner-${name}-${process.pid}-${Date.now()}-${Math.random()}`);
  const workspaceRoot = join(root, "workspaces");
  const workspace = join(workspaceRoot, "owner", "repo");
  const githubOutput = join(root, "github-output");
  await mkdir(join(workspace, "docs", "exec-plans", "active"), { recursive: true });
  await writeFile(join(workspace, planPath), "# Implement streaming output\n");
  await writeFile(githubOutput, "");
  return { root, workspaceRoot, workspace, githubOutput };
}

async function runClient(baseUrl: string, current: Awaited<ReturnType<typeof fixture>>, extraEnv: Record<string, string> = {}) {
  return runProcess(process.execPath, [join(process.cwd(), "runner", "client.mjs")], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AGENT_RELAY_URL: baseUrl,
      AGENT_RELAY_TOKEN: "relay-token",
      AGENT_RELAY_PLAN_PATH: planPath,
      AGENT_RELAY_REQUEST_ID: "request-1",
      AGENT_RELAY_WORKSPACE_ROOT: current.workspaceRoot,
      GITHUB_WORKSPACE: current.workspace,
      GITHUB_OUTPUT: current.githubOutput,
      AGENT_RELAY_REQUEST_TIMEOUT_MS: "5000",
      AGENT_RELAY_POLL_INTERVAL_MS: "10",
      AGENT_RELAY_POLL_TIMEOUT_MS: "5000",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function withServer(handler: (req: any, res: any) => Promise<void> | void, callback: (baseUrl: string) => Promise<void>) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try { await callback(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve())); }
}

function sendJson(res: any, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(value));
}

test("runner submits the result-free request and derives the commit subject from the active plan", async () => {
  const current = await fixture("result-free");
  let submitted: Record<string, unknown> | undefined;
  try {
    await withServer(async (req, res) => {
      assert.equal(req.method, "POST");
      let body = "";
      for await (const chunk of req) body += String(chunk);
      submitted = JSON.parse(body) as Record<string, unknown>;
      sendJson(res, 202, { id: "job-1", status: "completed" });
    }, async (baseUrl) => {
      const result = await runClient(baseUrl, current);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(submitted, { requestId: "request-1", workspace: "owner/repo", planPath });
      assert.equal(await readFile(current.githubOutput, "utf8"), "commit_message=Implement streaming output\n");
    });
  } finally { await rm(current.root, { recursive: true, force: true }); }
});

test("runner publishes a byte-identical archive only after a valid terminal output response", async () => {
  const current = await fixture("archive");
  const archive = join(current.root, "output", "agent-relay-output.log");
  const bytes = Buffer.from([0x00, 0x66, 0x6f, 0x80, 0xff, 0x0a]);
  try {
    await withServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/v1/jobs") {
        for await (const _chunk of req) { /* consume */ }
        sendJson(res, 202, { id: "job-1", status: "running" });
        return;
      }
      if (req.method === "GET" && req.url === "/v1/jobs/job-1/output?offset=0") {
        assert.equal(req.headers.accept, "application/octet-stream");
        assert.equal(req.headers["accept-encoding"], "identity");
        res.statusCode = 200;
        res.setHeader("content-type", "application/octet-stream");
        res.setHeader("x-agent-relay-output-offset", "0");
        res.end(bytes);
        return;
      }
      if (req.method === "GET" && req.url === "/v1/jobs/job-1") {
        sendJson(res, 200, { id: "job-1", status: "completed" });
        return;
      }
      throw new Error(`Unexpected request: ${req.method} ${req.url}`);
    }, async (baseUrl) => {
      const result = await runClient(baseUrl, current, { AGENT_RELAY_OUTPUT_ARCHIVE_PATH: archive });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(await readFile(archive, "binary"), bytes.toString("binary"));
      assert.ok((await stat(archive)).isFile());
      assert.equal(await readFile(current.githubOutput, "utf8"), "commit_message=Implement streaming output\n");
    });
  } finally { await rm(current.root, { recursive: true, force: true }); }
});

test("workflow template keeps the result contract removed and uploads both output artifacts", async () => {
  const workflow = await readFile(join(process.cwd(), "examples", "github-actions", "agent-relay.yml"), "utf8");
  assert.match(workflow, /pr_number:/);
  assert.match(workflow, /AGENT_RELAY_OUTPUT_ARCHIVE_PATH: \$\{\{ runner\.temp \}\}\/agent-relay-output\.log/);
  assert.match(workflow, /\$\{\{ runner\.temp \}\}\/agent-relay-output\.log/);
  assert.match(workflow, /\$\{\{ runner\.temp \}\}\/agent-relay-console\.log/);
  assert.doesNotMatch(workflow, /inputs\.branch|\bmode:|AGENT_RELAY_REQUEST_ID|AGENT_RELAY_MODE|\.agent-relay|result\.json/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /AGENT_RELAY_TOKEN: \$\{\{ secrets\.AGENT_RELAY_TOKEN \}\}/);
  assert.match(workflow, /GITHUB_PUSH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(workflow, /AGENT_RELAY_PUSH_TOKEN/);
  assert.match(workflow, /node \/runner\/client\.mjs 2>&1 \| tee/);
  assert.match(workflow, /run: \/runner\/finalize\.sh/);
});
