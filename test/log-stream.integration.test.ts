import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRelayServer } from "../src/api/server.js";
import type { AppConfig } from "../src/config/config.js";
import type { JobRecord } from "../src/contracts/job.js";
import type { JobService } from "../src/application/job-service.js";

const token = "stream-test-token";

test("job log endpoint streams output before the job completes", async () => {
  const root = join(tmpdir(), `agent-relay-log-stream-${process.pid}-${Date.now()}`);
  const outputPath = join(root, "job.log");
  await mkdir(root, { recursive: true });
  await writeFile(outputPath, "");

  let status: JobRecord["status"] = "running";
  const job: JobRecord = {
    id: "job-1",
    request: { requestId: "request-1", workspace: "owner/repo", planPath: "plan.md", mode: "implement" },
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resultPath: join(root, "result.json"),
    outputPath,
  };
  const jobs = {
    get: async () => ({ ...job, status }),
  } as unknown as JobService;
  const config: AppConfig = {
    host: "127.0.0.1",
    port: 0,
    relayToken: token,
    workspaceRoot: root,
    stateDir: root,
    codexCommand: "codex",
    codexTimeoutMs: 10_000,
    maxOutputBytes: 100_000,
  };
  const server = createRelayServer(config, jobs);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const responsePromise = fetch(`http://127.0.0.1:${address.port}/v1/jobs/job-1/logs`, {
      headers: { authorization: `Bearer ${token}` },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await appendFile(outputPath, "first line\n");

    const response = await responsePromise;
    assert.equal(response.status, 200);
    const reader = response.body?.getReader();
    assert.ok(reader);
    const first = await reader.read();
    assert.equal(new TextDecoder().decode(first.value), "first line\n");

    await appendFile(outputPath, "second line\n");
    status = "completed";
    let remaining = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      remaining += new TextDecoder().decode(chunk.value);
    }
    assert.equal(remaining, "second line\n");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("job log endpoint requires the relay token", async () => {
  const jobs = { get: async () => { throw new Error("must not be called"); } } as unknown as JobService;
  const config = {
    host: "127.0.0.1",
    port: 0,
    relayToken: token,
    workspaceRoot: "/tmp",
    stateDir: "/tmp",
    codexCommand: "codex",
    codexTimeoutMs: 10_000,
    maxOutputBytes: 100_000,
  };
  const server = createRelayServer(config, jobs);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/jobs/job-1/logs`);
    assert.equal(response.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve()));
  }
});
