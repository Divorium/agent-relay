import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JobService } from "../src/application/job-service.js";
import { JobStore } from "../src/persistence/job-store.js";
import type { JobRecord } from "../src/contracts/job.js";
import type { CodexExecutor } from "../src/execution/codex-executor.js";

const planPath = "docs/exec-plans/active/plan.md";

async function workspaceFixture(name: string) {
  const root = join(tmpdir(), `agent-relay-${name}-${process.pid}-${Date.now()}`);
  const workspaceRoot = join(root, "workspaces");
  const workspace = join(workspaceRoot, "owner", "repo");
  await mkdir(join(workspace, "docs", "exec-plans", "active"), { recursive: true });
  await writeFile(join(workspace, planPath), "# Plan\n");
  return { root, workspaceRoot };
}

test("job creation removes a saved job when request indexing fails", async () => {
  const fixture = await workspaceFixture("job-compensation");
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
      await assert.rejects(
        service.create({ requestId, workspace: "owner/repo", planPath }),
        (error: any) => error?.code === "JOB_PREPARATION_FAILED",
      );
      assert.equal(persisted.size, 0);
    }
    assert.deepEqual(removedRequestIds, ["request-1", "request-2"]);
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
    request: { requestId: "request-1", workspace: "owner/repo", planPath },
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
