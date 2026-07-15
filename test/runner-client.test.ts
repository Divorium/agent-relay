import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
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

async function workspaceFixture(name: string, plan = "# Plan\n") {
  const root = join(tmpdir(), `agent-relay-runner-client-${name}-${process.pid}-${Date.now()}-${Math.random()}`);
  const workspaceRoot = join(root, "workspaces");
  const workspace = join(workspaceRoot, "repository", "repository");
  const githubOutput = join(root, "github-output");
  await mkdir(join(workspace, "docs", "exec-plans", "active"), { recursive: true });
  await writeFile(join(workspace, planPath), plan);
  await writeFile(githubOutput, "");
  return { root, workspaceRoot, workspace, githubOutput };
}

async function runClient(
  workspaceRoot: string,
  workspace: string,
  githubOutput: string,
  serverUrl: string,
  extraEnv: Record<string, string> = {},
) {
  return runProcess(process.execPath, [join(process.cwd(), "runner", "client.mjs")], {
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

async function withServer(
  handler: (req: any, res: any) => Promise<void> | void,
  callback: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve()));
  }
}

function sendJson(res: any, status: number, value: unknown, contentType = "application/json") {
  res.statusCode = status;
  res.setHeader("content-type", contentType);
  res.end(JSON.stringify(value));
}

async function readBody(req: any): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of req) body += String(chunk);
  return JSON.parse(body) as Record<string, unknown>;
}

test("runner client derives the commit message and submits the bounded job request", async () => {
  const fixture = await workspaceFixture("basic", "# Implement controlled change\n");
  let submitted: Record<string, unknown> | undefined;
  try {
    await withServer(async (req, res) => {
      submitted = await readBody(req);
      sendJson(res, 202, { id: "job-1", status: "completed" });
    }, async (baseUrl) => {
      const result = await runClient(fixture.workspaceRoot, fixture.workspace, fixture.githubOutput, baseUrl, {
        AGENT_RELAY_REQUEST_ID: "request-1",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Agent Relay job job-1: completed/);
      assert.equal(await readFile(fixture.githubOutput, "utf8"), "commit_message=Implement controlled change\n");
      assert.deepEqual(submitted, {
        requestId: "request-1",
        workspace: "repository/repository",
        planPath,
      });
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("runner client derives a stable request ID from the workflow run", async () => {
  const fixture = await workspaceFixture("request-id");
  let submitted: Record<string, unknown> | undefined;
  try {
    await withServer(async (req, res) => {
      submitted = await readBody(req);
      sendJson(res, 202, { id: "job-1", status: "completed" });
    }, async (baseUrl) => {
      const result = await runClient(fixture.workspaceRoot, fixture.workspace, fixture.githubOutput, baseUrl, {
        GITHUB_REPOSITORY_ID: "123",
        GITHUB_RUN_ID: "456",
        GITHUB_RUN_ATTEMPT: "2",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(submitted?.requestId, "gha-123-456-2");
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("runner client treats a completed no-op as success", async () => {
  const fixture = await workspaceFixture("no-op");
  try {
    await withServer((_req, res) => sendJson(res, 202, { id: "job-1", status: "completed" }), async (baseUrl) => {
      const result = await runClient(fixture.workspaceRoot, fixture.workspace, fixture.githubOutput, baseUrl, {
        AGENT_RELAY_REQUEST_ID: "request-no-op",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(await readFile(fixture.githubOutput, "utf8"), "commit_message=Plan\n");
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("runner client polls accepted and running jobs until completion", async () => {
  const fixture = await workspaceFixture("polling");
  const statuses = ["running", "completed"];
  let polls = 0;
  try {
    await withServer((_req, res) => {
      if (_req.method === "POST") {
        sendJson(res, 202, { id: "job-1", status: "accepted" });
        return;
      }
      sendJson(res, 200, { id: "job-1", status: statuses[polls++] ?? "completed" });
    }, async (baseUrl) => {
      const result = await runClient(fixture.workspaceRoot, fixture.workspace, fixture.githubOutput, baseUrl, {
        AGENT_RELAY_REQUEST_ID: "request-polling",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /job-1: accepted[\s\S]*job-1: running[\s\S]*job-1: completed/);
      assert.equal(polls, 2);
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("runner client stops at the configured polling deadline", async () => {
  const fixture = await workspaceFixture("poll-timeout");
  try {
    await withServer((req, res) => sendJson(res, req.method === "POST" ? 202 : 200, { id: "job-1", status: "accepted" }), async (baseUrl) => {
      const result = await runClient(fixture.workspaceRoot, fixture.workspace, fixture.githubOutput, baseUrl, {
        AGENT_RELAY_REQUEST_ID: "request-timeout",
        AGENT_RELAY_POLL_INTERVAL_MS: "10",
        AGENT_RELAY_POLL_TIMEOUT_MS: "25",
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /polling timed out after 25ms/);
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("runner client reports an HTTP failure during polling without echoing its body", async () => {
  const fixture = await workspaceFixture("poll-http-failure");
  try {
    await withServer((req, res) => {
      if (req.method === "POST") sendJson(res, 202, { id: "job-1", status: "accepted" });
      else sendJson(res, 503, { token: "super-secret-value", message: "unavailable" });
    }, async (baseUrl) => {
      const result = await runClient(fixture.workspaceRoot, fixture.workspace, fixture.githubOutput, baseUrl, {
        AGENT_RELAY_REQUEST_ID: "request-http-failure",
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /HTTP 503/);
      assert.doesNotMatch(result.stderr, /super-secret-value/);
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("runner client rejects malformed create-job success responses", async (t: any) => {
  const cases: Array<{ name: string; status: number; contentType?: string; body: string; expected: RegExp }> = [
    { name: "unexpected status", status: 200, body: JSON.stringify({ id: "job-1", status: "completed" }), expected: /HTTP 200/ },
    { name: "missing id", status: 202, body: JSON.stringify({ status: "completed" }), expected: /invalid job id/ },
    { name: "unknown status", status: 202, body: JSON.stringify({ id: "job-1", status: "unknown" }), expected: /invalid job status/ },
    { name: "invalid JSON", status: 202, body: "{", expected: /invalid JSON/ },
    { name: "empty JSON", status: 202, body: "", expected: /empty JSON response/ },
    { name: "incorrect content type", status: 202, contentType: "text/plain", body: JSON.stringify({ id: "job-1", status: "completed" }), expected: /non-JSON content type/ },
    { name: "oversized body", status: 202, body: JSON.stringify({ id: "job-1", status: "completed", padding: "x".repeat(70_000) }), expected: /exceeded 64000 bytes/ },
  ];

  for (const current of cases) {
    await t.test(current.name, async () => {
      const fixture = await workspaceFixture(`malformed-${current.name}`);
      try {
        await withServer((_req, res) => {
          res.statusCode = current.status;
          res.setHeader("content-type", current.contentType ?? "application/json");
          res.end(current.body);
        }, async (baseUrl) => {
          const result = await runClient(fixture.workspaceRoot, fixture.workspace, fixture.githubOutput, baseUrl, {
            AGENT_RELAY_REQUEST_ID: `request-${current.name.replaceAll(" ", "-")}`,
          });
          assert.notEqual(result.status, 0);
          assert.match(result.stderr, current.expected);
        });
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    });
  }
});

test("runner client normalizes commit-message edge cases", async (t: any) => {
  const longHeading = `# ${"a".repeat(130)}\n`;
  const cases = [
    { name: "length", plan: longHeading, expected: "a".repeat(120) },
    { name: "controls", plan: "# Safe\u0007 title\n", expected: "Safe title" },
    { name: "CRLF", plan: "# Safe title\r\nInjected\r\n", expected: "Safe title" },
    { name: "Unicode", plan: "# Zażółć 🚀\n", expected: "Zażółć 🚀" },
    { name: "multiple headings", plan: "# First\n# Second\n", expected: "First" },
    { name: "empty heading", plan: "#   \nNo title\n", expected: "Apply active ExecPlan" },
  ];

  for (const current of cases) {
    await t.test(current.name, async () => {
      const fixture = await workspaceFixture(`commit-${current.name}`, current.plan);
      try {
        await withServer((_req, res) => sendJson(res, 202, { id: "job-1", status: "completed" }), async (baseUrl) => {
          const result = await runClient(fixture.workspaceRoot, fixture.workspace, fixture.githubOutput, baseUrl, {
            AGENT_RELAY_REQUEST_ID: `request-commit-${current.name}`,
          });
          assert.equal(result.status, 0, result.stderr);
          assert.equal(await readFile(fixture.githubOutput, "utf8"), `commit_message=${current.expected}\n`);
        });
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    });
  }
});

test("runner client validates active-plan and workspace boundaries before Relay", async (t: any) => {
  const invalidPaths = [
    "docs/exec-plans/active/nested/plan.md",
    "docs/exec-plans/active/../plan.md",
    "docs\\exec-plans\\active\\plan.md",
    "docs/exec-plans/active/plan.txt",
  ];
  for (const invalidPath of invalidPaths) {
    await t.test(invalidPath, async () => {
      const fixture = await workspaceFixture(`invalid-${invalidPath.replaceAll("/", "-").replaceAll("\\", "-")}`);
      try {
        const result = await runClient(fixture.workspaceRoot, fixture.workspace, fixture.githubOutput, "http://127.0.0.1:1", {
          AGENT_RELAY_PLAN_PATH: invalidPath,
          AGENT_RELAY_REQUEST_ID: "request-invalid-path",
        });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /directly under docs\/exec-plans\/active/);
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    });
  }

  await t.test("directory plan", async () => {
    const fixture = await workspaceFixture("directory-plan");
    try {
      await rm(join(fixture.workspace, planPath));
      await mkdir(join(fixture.workspace, planPath));
      const result = await runClient(fixture.workspaceRoot, fixture.workspace, fixture.githubOutput, "http://127.0.0.1:1", {
        AGENT_RELAY_REQUEST_ID: "request-directory-plan",
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /regular file/);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  await t.test("symlink plan", async () => {
    const fixture = await workspaceFixture("symlink-plan");
    try {
      await rename(join(fixture.workspace, planPath), join(fixture.workspace, "real-plan.md"));
      await symlink(join(fixture.workspace, "real-plan.md"), join(fixture.workspace, planPath));
      const result = await runClient(fixture.workspaceRoot, fixture.workspace, fixture.githubOutput, "http://127.0.0.1:1", {
        AGENT_RELAY_REQUEST_ID: "request-symlink-plan",
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /regular file|symbolic links/);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  await t.test("workspace symlink escaping root", async () => {
    const fixture = await workspaceFixture("workspace-symlink");
    const external = join(fixture.root, "external");
    const linked = join(fixture.workspaceRoot, "linked");
    try {
      await mkdir(join(external, "docs", "exec-plans", "active"), { recursive: true });
      await writeFile(join(external, planPath), "# Outside\n");
      await symlink(external, linked);
      const result = await runClient(fixture.workspaceRoot, linked, fixture.githubOutput, "http://127.0.0.1:1", {
        AGENT_RELAY_REQUEST_ID: "request-outside-workspace",
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /must be below AGENT_RELAY_WORKSPACE_ROOT/);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

test("runner finalization metadata survives moving the selected plan to completed", async () => {
  const fixture = await workspaceFixture("move-plan", "# Move plan\n");
  const completed = join(fixture.workspace, "docs", "exec-plans", "completed", "plan.md");
  try {
    await withServer(async (req, res) => {
      await readBody(req);
      await mkdir(join(fixture.workspace, "docs", "exec-plans", "completed"), { recursive: true });
      await rename(join(fixture.workspace, planPath), completed);
      sendJson(res, 202, { id: "job-1", status: "completed" });
    }, async (baseUrl) => {
      const result = await runClient(fixture.workspaceRoot, fixture.workspace, fixture.githubOutput, baseUrl, {
        AGENT_RELAY_REQUEST_ID: "request-move-plan",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(await readFile(fixture.githubOutput, "utf8"), "commit_message=Move plan\n");
      assert.equal(await readFile(completed, "utf8"), "# Move plan\n");
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
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
