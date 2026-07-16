import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { JobService } from "../src/application/job-service.js";
import { JobStore } from "../src/persistence/job-store.js";
import { RelayError } from "../src/contracts/errors.js";
import type { CreateJobRequest, JobRecord } from "../src/contracts/job.js";
import type { CodexExecutor } from "../src/execution/codex-executor.js";

function createSymlink(target: string, path: string): void {
  const result = spawnSync("ln", ["-s", target, path], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

const planPath = "docs/exec-plans/active/plan.md";

async function workspaceFixture(name: string) {
  const root = join(tmpdir(), `agent-relay-${name}-${process.pid}-${Date.now()}-${Math.random()}`);
  const workspaceRoot = join(root, "workspaces");
  const workspace = join(workspaceRoot, "owner", "repo");
  await mkdir(join(workspace, "docs", "exec-plans", "active"), { recursive: true });
  await writeFile(join(workspace, planPath), "# Plan\n");
  return { root, workspaceRoot, workspace };
}

function request(requestId: string, workspace = "owner/repo"): CreateJobRequest {
  return { requestId, workspace, planPath };
}

async function waitForTerminal(store: JobStore, id: string): Promise<JobRecord> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = await store.get(id);
    if (job && !["accepted", "running"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Job did not reach a terminal state");
}

test("job creation compensates a failed initial job save", async () => {
  const fixture = await workspaceFixture("job-save-failure");
  let indexCalls = 0;
  let removeCalls = 0;
  const store = {
    findByRequestId: async () => undefined,
    save: async () => { throw new Error("save failed"); },
    index: async () => { indexCalls += 1; },
    removeRequestId: async () => undefined,
    remove: async () => { removeCalls += 1; },
  } as unknown as JobStore;
  const executor = { run: async () => ({ exitCode: 0 }) } as unknown as CodexExecutor;
  const service = new JobService(fixture.workspaceRoot, join(fixture.root, "state"), store, executor);

  try {
    await assert.rejects(service.create(request("request-save-failure")), (error: any) => error?.code === "JOB_PREPARATION_FAILED");
    assert.equal(indexCalls, 0);
    assert.equal(removeCalls, 1);
    await assert.rejects(service.create(request("request-save-failure-2")), (error: any) => error?.code === "JOB_PREPARATION_FAILED");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("job creation removes a saved job when request indexing fails", async () => {
  const fixture = await workspaceFixture("job-index-failure");
  const persisted = new Map<string, JobRecord>();
  const removedRequestIds: string[] = [];
  const store = {
    findByRequestId: async () => undefined,
    save: async (job: JobRecord) => { persisted.set(job.id, job); },
    index: async () => { throw new Error("index failed"); },
    removeRequestId: async (requestId: string) => { removedRequestIds.push(requestId); },
    remove: async (id: string) => { persisted.delete(id); },
  } as unknown as JobStore;
  const executor = { run: async () => ({ exitCode: 0 }) } as unknown as CodexExecutor;
  const service = new JobService(fixture.workspaceRoot, join(fixture.root, "state"), store, executor);

  try {
    for (const requestId of ["request-1", "request-2"]) {
      await assert.rejects(service.create(request(requestId)), (error: any) => error?.code === "JOB_PREPARATION_FAILED");
      assert.equal(persisted.size, 0);
    }
    assert.deepEqual(removedRequestIds, ["request-1", "request-2"]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("job creation reports incomplete rollback without adding a lifecycle state", async () => {
  const fixture = await workspaceFixture("job-rollback-failure");
  const store = {
    findByRequestId: async () => undefined,
    save: async () => undefined,
    index: async () => { throw new Error("index failed"); },
    removeRequestId: async () => { throw new Error("request rollback failed"); },
    remove: async () => { throw new Error("job rollback failed"); },
  } as unknown as JobStore;
  const executor = { run: async () => ({ exitCode: 0 }) } as unknown as CodexExecutor;
  const service = new JobService(fixture.workspaceRoot, join(fixture.root, "state"), store, executor);

  try {
    await assert.rejects(
      service.create(request("request-rollback-failure")),
      (error: any) => error?.code === "JOB_PREPARATION_FAILED" && /rollback was incomplete/.test(error.message),
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("request-index compensation removes only the expected job mapping", async () => {
  const root = join(tmpdir(), `agent-relay-index-compensation-${process.pid}-${Date.now()}`);
  const store = new JobStore(root);
  const now = new Date().toISOString();
  const job: JobRecord = {
    id: "job-1",
    request: request("request-1"),
    status: "accepted",
    createdAt: now,
    updatedAt: now,
    outputPath: join(root, "logs", "job-1.log"),
  };

  try {
    await store.save(job);
    await store.index(job);
    await store.removeRequestId("request-1", "different-job");
    assert.equal((await store.findByRequestId("request-1"))?.id, "job-1");
    await store.removeRequestId("request-1", "job-1");
    assert.equal(await store.findByRequestId("request-1"), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reuse of one request ID with different fields is rejected", async () => {
  const fixture = await workspaceFixture("request-conflict");
  const store = new JobStore(join(fixture.root, "state"));
  const executor = { run: async () => ({ exitCode: 0 }) } as unknown as CodexExecutor;
  const service = new JobService(fixture.workspaceRoot, join(fixture.root, "state"), store, executor);
  await service.init();

  try {
    await service.create(request("same-request"));
    await assert.rejects(
      service.create(request("same-request", "different/workspace")),
      (error: any) => error?.code === "REQUEST_ID_CONFLICT",
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("invalid and symlinked plans are rejected before executor invocation", async (t: any) => {
  for (const kind of ["missing", "symlink"] as const) {
    await t.test(kind, async () => {
      const fixture = await workspaceFixture(`invalid-plan-${kind}`);
      let executions = 0;
      const executor = { run: async () => { executions += 1; return { exitCode: 0 }; } } as unknown as CodexExecutor;
      const service = new JobService(fixture.workspaceRoot, join(fixture.root, "state"), new JobStore(join(fixture.root, "state")), executor);
      await service.init();
      try {
        await rm(join(fixture.workspace, planPath));
        if (kind === "symlink") {
          await writeFile(join(fixture.workspace, "real-plan.md"), "# Plan\n");
          createSymlink(join(fixture.workspace, "real-plan.md"), join(fixture.workspace, planPath));
        }
        await assert.rejects(service.create(request(`invalid-${kind}`)), /does not exist|symbolic links/);
        assert.equal(executions, 0);
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    });
  }
});

test("failed execution is persisted and written to the Relay error stream", async () => {
  const fixture = await workspaceFixture("execution-failure-log");
  const stateDir = join(fixture.root, "state");
  const store = new JobStore(stateDir);
  const executor = {
    run: async () => { throw new RelayError("CODEX_FAILED", "Codex exited with code 17", 502); },
  } as unknown as CodexExecutor;
  const service = new JobService(fixture.workspaceRoot, stateDir, store, executor);
  await service.init();

  let stderr = "";
  const originalWrite = process.stderr.write;
  process.stderr.write = ((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  }) as any;

  try {
    const created = await service.create(request("execution-failure-log"));
    const terminal = await waitForTerminal(store, created.id);
    assert.equal(terminal.status, "failed");
    assert.equal(terminal.errorCode, "CODEX_FAILED");
    assert.equal(terminal.errorMessage, "Codex exited with code 17");
    assert.match(stderr, new RegExp(`Agent Relay job ${created.id} failed: CODEX_FAILED: Codex exited with code 17`));
  } finally {
    process.stderr.write = originalWrite;
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("request idempotency survives Relay restart without a second executor invocation", async () => {
  const fixture = await workspaceFixture("restart-idempotency");
  const stateDir = join(fixture.root, "state");
  const store = new JobStore(stateDir);
  let executions = 0;
  const executor = { run: async () => { executions += 1; return { exitCode: 0 }; } } as unknown as CodexExecutor;
  const firstService = new JobService(fixture.workspaceRoot, stateDir, store, executor);
  await firstService.init();

  try {
    const created = await firstService.create(request("restart-request"));
    assert.equal((await waitForTerminal(store, created.id)).status, "completed");

    const secondService = new JobService(fixture.workspaceRoot, stateDir, new JobStore(stateDir), executor);
    await secondService.init();
    const repeated = await secondService.create(request("restart-request"));
    assert.equal(repeated.id, created.id);
    assert.equal(repeated.status, "completed");
    assert.equal(executions, 1);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
