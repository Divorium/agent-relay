import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexExecutor } from "../src/execution/codex-executor.js";

const requestId = "executor-integration-request";

test("CodexExecutor runs a real child process, validates its result and redacts output", async () => {
  const root = join(tmpdir(), `agent-relay-executor-${process.pid}-${Date.now()}`);
  const workspace = join(root, "workspace");
  const outputPath = join(root, "state", "job.log");
  const executable = join(root, "fake-codex");
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "plan.md"), "# Plan\n");
  await writeFile(executable, `#!/bin/sh
set -eu
[ "$1" = "exec" ]
[ "$2" = "--cd" ]
[ "$3" = "${workspace}" ]
printf '%s\n' 'authorization: Bearer abcdefghijklmnopqrstuvwxyz'
cat > "$3/.agent-relay/result.json" <<'JSON'
{
  "schemaVersion": 1,
  "requestId": "${requestId}",
  "status": "completed",
  "shouldCommit": false,
  "summary": "Controlled child process completed.",
  "validation": [],
  "blockers": [],
  "limitations": []
}
JSON
`, { mode: 0o700 });
  await chmod(executable, 0o700);

  const executor = new CodexExecutor(executable, 5_000, 100_000);
  try {
    const outcome = await executor.run({
      requestId,
      workspace: "workspace",
      planPath: "plan.md",
      mode: "implement",
    }, workspace, outputPath);

    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.result.requestId, requestId);
    assert.equal(outcome.result.status, "completed");
    const log = await readFile(outputPath, "utf8");
    assert.doesNotMatch(log, /abcdefghijklmnopqrstuvwxyz/);
    assert.match(log, /\[REDACTED\]/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
