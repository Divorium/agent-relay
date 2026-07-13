import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRelayServer } from "../src/api/server.js";
import { JobService } from "../src/application/job-service.js";
import { JobStore } from "../src/persistence/job-store.js";
import type { CodexExecutor, ExecutionOutcome } from "../src/execution/codex-executor.js";
import type { CreateJobRequest } from "../src/contracts/job.js";
import type { AppConfig } from "../src/config/config.js";

const token = "integration-relay-token";

async function createFixture(run: (request: CreateJobRequest) => Promise<ExecutionOutcome>) {
  const root = join(tmpdir(), `agent-relay-integration-${process.pid}-${Date.now()}`);
  const workspaceRoot = join(root, "workspaces");
  const workspace = join(workspaceRoot, "owner", "repo");
  const stateDir = join(root, "state");
  await mkdir(join(workspace, "docs"), { recursive: true });
  await writeFile(join(workspace, "docs", "plan.md"), "# Plan\n");

  const executor = { run } as unknown as CodexExecutor;
  const jobs = new JobService(workspaceRoot, stateDir, new JobStore(stateDir), executor);
  await jobs.init();

  const config: AppConfig = {
    host: "127.0.0.1",
    port: 0,
    relayToken: token,
    workspaceRoot,
    stateDir,
    codexCommand: "codex",
    codexTimeoutMs: 10_000,
    maxOutputBytes: 100_000,
  };
  const server = createRelayServer(config, jobs);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    },
  };
}

function request(requestId: string): CreateJobRequest {
  return {
    requestId,
    workspace: "owner/repo",
    planPath: "docs/plan.md",
    mode: "implement",
  };
}

async function waitForTerminal(baseUrl: string, id: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${baseUrl}/v1/jobs/${id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const job = await response.json() as { status: string };
    if (!["accepted", "running"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Job did not reach a terminal state");
}

test("health is public while job endpoints require authentication", async () => {
  const fixture = await createFixture(async (jobRequest) => ({
    exitCode: 0,
    result: {
      schemaVersion: 1,
      requestId: jobRequest.requestId,
      status: "completed",
      shouldCommit: false,
      summary: "No changes required.",
      validation: [],
      blockers: [],
      limitations: [],
    },
  }));
  try {
    const health = await fetch(`${fixture.baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });

    const unauthorized = await fetch(`${fixture.baseUrl}/v1/jobs/missing`);
    assert.equal(unauthorized.status, 401);
    assert.equal((await unauthorized.json() as any).error.code, "UNAUTHORIZED");
  } finally {
    await fixture.close();
  }
});

test("HTTP create and poll executes the job and preserves idempotency", async () => {
  let executions = 0;
  const fixture = await createFixture(async (jobRequest) => {
    executions += 1;
    return {
      exitCode: 0,
      result: {
        schemaVersion: 1,
        requestId: jobRequest.requestId,
        status: "completed",
        shouldCommit: true,
        commitMessage: "Implement integration coverage",
        summary: "Completed through the integration executor.",
        validation: [{ command: "npm test", status: "passed", exitCode: 0, details: "Passed." }],
        blockers: [],
        limitations: [],
      },
    };
  });
  try {
    const body = request("integration-request-1");
    const first = await fetch(`${fixture.baseUrl}/v1/jobs`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(first.status, 202);
    const accepted = await first.json() as { id: string };
    const terminal = await waitForTerminal(fixture.baseUrl, accepted.id) as { status: string };
    assert.equal(terminal.status, "completed");

    const repeated = await fetch(`${fixture.baseUrl}/v1/jobs`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(repeated.status, 202);
    assert.equal((await repeated.json() as { id: string }).id, accepted.id);
    assert.equal(executions, 1);
  } finally {
    await fixture.close();
  }
});

test("parallel job submission allows only one active job", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fixture = await createFixture(async (jobRequest) => {
    await gate;
    return {
      exitCode: 0,
      result: {
        schemaVersion: 1,
        requestId: jobRequest.requestId,
        status: "completed",
        shouldCommit: false,
        summary: "Completed.",
        validation: [],
        blockers: [],
        limitations: [],
      },
    };
  });
  try {
    const post = (body: CreateJobRequest) => fetch(`${fixture.baseUrl}/v1/jobs`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const first = await post(request("parallel-request-1"));
    assert.equal(first.status, 202);
    const second = await post(request("parallel-request-2"));
    assert.equal(second.status, 409);
    assert.equal((await second.json() as any).error.code, "JOB_ALREADY_RUNNING");
    release();
    const accepted = await first.json() as { id: string };
    assert.equal((await waitForTerminal(fixture.baseUrl, accepted.id) as { status: string }).status, "completed");
  } finally {
    release();
    await fixture.close();
  }
});
