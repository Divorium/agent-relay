import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRelayServer } from "../src/api/server.js";
import { JobService } from "../src/application/job-service.js";
import { JobStore } from "../src/persistence/job-store.js";
import { RelayError } from "../src/contracts/errors.js";
import type { CodexExecutor, ExecutionOutcome } from "../src/execution/codex-executor.js";
import type { CreateJobRequest } from "../src/contracts/job.js";
import type { AppConfig } from "../src/config/config.js";

const token = "integration-relay-token";
const planPath = "docs/exec-plans/active/plan.md";

async function createFixture(run: (request: CreateJobRequest) => Promise<ExecutionOutcome>) {
  const root = join(tmpdir(), `agent-relay-integration-${process.pid}-${Date.now()}-${Math.random()}`);
  const workspaceRoot = join(root, "workspaces");
  const workspace = join(workspaceRoot, "owner", "repo");
  const stateDir = join(root, "state");
  await mkdir(join(workspace, "docs", "exec-plans", "active"), { recursive: true });
  await writeFile(join(workspace, planPath), "# Plan\n");

  const executor = { run } as unknown as CodexExecutor;
  const jobs = new JobService(workspaceRoot, stateDir, new JobStore(stateDir), executor);
  await jobs.init();

  const config: AppConfig = {
    host: "127.0.0.1",
    port: 0,
    relayToken: token,
    workspaceRoot,
    stateDir,
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
  return { requestId, workspace: "owner/repo", planPath };
}

async function postJob(baseUrl: string, body: CreateJobRequest) {
  return fetch(`${baseUrl}/v1/jobs`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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
  const fixture = await createFixture(async () => ({ exitCode: 0 }));
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

test("HTTP create and poll derives completed state and preserves idempotency", async () => {
  let executions = 0;
  const fixture = await createFixture(async () => {
    executions += 1;
    return { exitCode: 0 };
  });
  try {
    const body = request("integration-request-1");
    const first = await postJob(fixture.baseUrl, body);
    assert.equal(first.status, 202);
    const accepted = await first.json() as { id: string; outputPath?: string; errorMessage?: string };
    assert.equal(accepted.outputPath, undefined);
    assert.equal(accepted.errorMessage, undefined);
    const terminal = await waitForTerminal(fixture.baseUrl, accepted.id) as { status: string; exitCode?: number; outputPath?: string; errorMessage?: string };
    assert.equal(terminal.status, "completed");
    assert.equal(terminal.exitCode, 0);
    assert.equal(terminal.outputPath, undefined);
    assert.equal(terminal.errorMessage, undefined);

    const repeated = await postJob(fixture.baseUrl, body);
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
  const fixture = await createFixture(async () => {
    await gate;
    return { exitCode: 0 };
  });
  try {
    const first = await postJob(fixture.baseUrl, request("parallel-request-1"));
    assert.equal(first.status, 202);
    const second = await postJob(fixture.baseUrl, request("parallel-request-2"));
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

test("executor failure releases the active-job lock for the next request", async () => {
  let executions = 0;
  const fixture = await createFixture(async () => {
    executions += 1;
    if (executions === 1) throw new Error("synthetic executor failure");
    return { exitCode: 0 };
  });
  try {
    const first = await postJob(fixture.baseUrl, request("failing-request"));
    assert.equal(first.status, 202);
    const firstJob = await first.json() as { id: string };
    const failed = await waitForTerminal(fixture.baseUrl, firstJob.id) as { status: string; errorCode?: string };
    assert.equal(failed.status, "failed");
    assert.equal(failed.errorCode, "INTERNAL_ERROR");

    const second = await postJob(fixture.baseUrl, request("recovery-request"));
    assert.equal(second.status, 202);
    const secondJob = await second.json() as { id: string };
    assert.equal((await waitForTerminal(fixture.baseUrl, secondJob.id) as { status: string }).status, "completed");
    assert.equal(executions, 2);
  } finally {
    await fixture.close();
  }
});

test("public job responses expose neither internal paths nor stored executor details", async () => {
  const secret = "ghp_abcdefghijklmnopqrstuvwxyz123456";
  const fixture = await createFixture(async () => {
    throw new RelayError(
      "CODEX_FAILED",
      `authorization: Bearer ${secret} AGENT_RELAY_TOKEN=${secret} /home/agent/.codex/auth.json\n    at internal (/app/src/server.ts:1:1)`,
      502,
    );
  });
  try {
    const created = await postJob(fixture.baseUrl, request("redaction-request"));
    assert.equal(created.status, 202);
    const accepted = await created.json() as { id: string };
    const response = await waitForTerminal(fixture.baseUrl, accepted.id);
    const serialized = JSON.stringify(response);
    assert.match(serialized, /CODEX_FAILED/);
    assert.doesNotMatch(serialized, /outputPath|errorMessage|ghp_|AGENT_RELAY_TOKEN|auth\.json|\/app\/src|internal \(/);
  } finally {
    await fixture.close();
  }
});
