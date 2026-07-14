import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexExecutor, createCodexEnvironment } from "../src/execution/codex-executor.js";
import { RelayError } from "../src/contracts/errors.js";
import { OutputStore } from "../src/persistence/output-store.js";
import type { JobRecord } from "../src/contracts/job.js";

const requestId = "executor-integration-request";

async function createRoot(name: string) {
  const root = join(tmpdir(), `agent-relay-${name}-${process.pid}-${Date.now()}`);
  const workspace = join(root, "workspace");
  const outputPath = join(root, "state", "job.log");
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "plan.md"), "# Plan\n");
  return { root, workspace, outputPath };
}

function job(outputPath: string): JobRecord {
  return {
    id: "job-1",
    request: {
      requestId,
      workspace: "workspace",
      planPath: "plan.md",
      mode: "implement",
    },
    status: "accepted",
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    resultPath: "/workspace/.agent-relay/result.json",
    outputPath,
  };
}

test("Codex environment removes only the Agent Relay API token", () => {
  assert.deepEqual(createCodexEnvironment({
    PATH: "/usr/bin",
    HOME: "/home/agent",
    AGENT_RELAY_TOKEN: "relay-secret",
    APPLICATION_MODE: "test",
  }), {
    PATH: "/usr/bin",
    HOME: "/home/agent",
    APPLICATION_MODE: "test",
  });
});

test("CodexExecutor streams raw bytes into the shared output store", async () => {
  const { root, workspace, outputPath } = await createRoot("executor");
  const executable = join(root, "fake-codex");
  await writeFile(executable, `#!/bin/sh
set -eu
[ "$1" = "--ask-for-approval" ]
[ "$2" = "never" ]
[ "$3" = "-c" ]
[ "$4" = "features.memories=false" ]
[ "$5" = "exec" ]
[ "$6" = "--sandbox" ]
[ "$7" = "danger-full-access" ]
[ "$8" = "--cd" ]
[ "$9" = "${workspace}" ]
printf '%s\\n' 'authorization: Bearer abcdefghijklmnopqrstuvwxyz'
printf '%s\\n' 'raw stdout'
cat > "$9/.agent-relay/result.json" <<'JSON'
{
  "schemaVersion": 1,
  "requestId": "${requestId}",
  "status": "completed",
  "commitMessage": "Complete controlled child process",
  "summary": "Controlled child process completed.",
  "validation": [],
  "blockers": [],
  "limitations": []
}
JSON
`, { mode: 0o700 });
  await chmod(executable, 0o700);

  const previousApplicationMode = process.env.APPLICATION_MODE;
  process.env.APPLICATION_MODE = "test";
  const outputStore = new OutputStore(join(root, "state"));
  await outputStore.prepare("job-1", outputPath);
  const executor = new CodexExecutor(executable, 5_000, outputStore);
  try {
    const outcome = await executor.run(job(outputPath), workspace);

    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.result.requestId, requestId);
    assert.equal(outcome.result.status, "completed");
    assert.equal(outcome.result.commitMessage, "Complete controlled child process");
    const log = await readFile(outputPath, "utf8");
    assert.match(log, /abcdefghijklmnopqrstuvwxyz/);
    assert.match(log, /raw stdout/);
  } finally {
    await outputStore.close().catch(() => undefined);
    if (previousApplicationMode === undefined) delete process.env.APPLICATION_MODE;
    else process.env.APPLICATION_MODE = previousApplicationMode;
    await rm(root, { recursive: true, force: true });
  }
});

test("CodexExecutor reports timeout only after the child process closes", async () => {
  const { root, workspace, outputPath } = await createRoot("timeout");
  const executable = join(root, "slow-codex");
  const marker = join(root, "terminated");
  await writeFile(executable, `#!/bin/sh
set -eu
trap 'printf terminated > "${marker}"; exit 0' TERM
while true; do sleep 1; done
`, { mode: 0o700 });
  await chmod(executable, 0o700);

  const outputStore = new OutputStore(join(root, "state"));
  await outputStore.prepare("job-1", outputPath);
  const executor = new CodexExecutor(executable, 50, outputStore);
  try {
    await assert.rejects(
      () => executor.run(job(outputPath), workspace),
      (error: unknown) => error instanceof RelayError && error.code === "CODEX_TIMEOUT",
    );
    assert.equal(await readFile(marker, "utf8"), "terminated");
  } finally {
    await outputStore.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
