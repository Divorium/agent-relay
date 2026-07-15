import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JobStore } from "../src/persistence/job-store.js";
import type { JobRecord, JobStatus } from "../src/contracts/job.js";

function job(id: string, requestId: string, status: JobStatus): JobRecord {
  const now = new Date().toISOString();
  return {
    id,
    request: {
      requestId,
      workspace: "owner/repository",
      planPath: "docs/exec-plans/active/plan.md",
    },
    status,
    createdAt: now,
    updatedAt: now,
    outputPath: `/state/logs/${id}.log`,
  };
}

async function fixture() {
  const root = join(tmpdir(), `agent-relay-job-store-${process.pid}-${Date.now()}-${Math.random()}`);
  const stateDir = join(root, "state");
  await mkdir(stateDir, { recursive: true });
  const store = new JobStore(stateDir);
  await store.init();
  return {
    root,
    stateDir,
    store,
    close: () => rm(root, { recursive: true, force: true }),
  };
}

test("restart recovery interrupts only non-terminal jobs", async () => {
  const current = await fixture();
  try {
    await current.store.save(job("accepted-job", "accepted-request", "accepted"));
    await current.store.save(job("running-job", "running-request", "running"));
    await current.store.save(job("completed-job", "completed-request", "completed"));

    assert.equal(await current.store.markRunningJobsInterrupted(), 2);

    for (const id of ["accepted-job", "running-job"]) {
      const recovered = await current.store.get(id);
      assert.equal(recovered?.status, "interrupted");
      assert.equal(recovered?.errorCode, "INTERRUPTED");
      assert.ok(recovered?.finishedAt);
    }
    assert.equal((await current.store.get("completed-job"))?.status, "completed");
  } finally {
    await current.close();
  }
});

test("request-index compensation never removes a newer mapping", async () => {
  const current = await fixture();
  try {
    await writeFile(
      join(current.stateDir, "request-index.json"),
      `${JSON.stringify({ request: "new-job" }, null, 2)}\n`,
      { mode: 0o600 },
    );

    await current.store.removeRequestId("request", "old-job");
    assert.deepEqual(
      JSON.parse(await readFile(join(current.stateDir, "request-index.json"), "utf8")),
      { request: "new-job" },
    );

    await current.store.removeRequestId("request", "new-job");
    assert.deepEqual(
      JSON.parse(await readFile(join(current.stateDir, "request-index.json"), "utf8")),
      {},
    );
  } finally {
    await current.close();
  }
});
