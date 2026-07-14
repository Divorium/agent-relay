import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexExecutor } from "../src/execution/codex-executor.js";
import { OutputStore } from "../src/persistence/output-store.js";
import type { JobRecord } from "../src/contracts/job.js";

const requestId = "live-log-request";

test("Codex output reaches Docker stdout and the job log before process completion", async () => {
  const root = join(tmpdir(), `agent-relay-live-log-${process.pid}-${Date.now()}`);
  const workspace = join(root, "workspace");
  const stateDir = join(root, "state");
  const outputPath = join(stateDir, "job.log");
  const executable = join(root, "fake-codex");
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "plan.md"), "# Plan\n");
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
printf 'first live line\\n'
sleep 1
cat > "$9/.agent-relay/result.json" <<'JSON'
{
  "schemaVersion": 1,
  "requestId": "${requestId}",
  "status": "completed",
  "commitMessage": "Complete live log test",
  "summary": "Completed.",
  "validation": [],
  "blockers": [],
  "limitations": []
}
JSON
`, { mode: 0o700 });
  await chmod(executable, 0o700);

  const job: JobRecord = {
    id: "job-1",
    request: { requestId, workspace: "workspace", planPath: "plan.md", mode: "implement" },
    status: "accepted",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
    resultPath: join(workspace, ".agent-relay", "result.json"),
    outputPath,
  };
  const outputStore = new OutputStore(stateDir);
  await outputStore.prepare(job.id, outputPath);

  let stdout = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as any;

  try {
    const execution = new CodexExecutor(executable, 5_000, outputStore).run(job, workspace);

    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.match(stdout, /first live line/);
    assert.match(await readFile(outputPath, "utf8"), /first live line/);

    const outcome = await execution;
    assert.equal(outcome.result.status, "completed");
    assert.equal(outcome.result.commitMessage, "Complete live log test");
  } finally {
    process.stdout.write = originalWrite;
    await outputStore.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
