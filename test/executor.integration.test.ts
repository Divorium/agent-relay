import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexExecutor } from "../src/execution/codex-executor.js";
import { RelayError } from "../src/contracts/errors.js";

const requestId = "executor-integration-request";

async function createRoot(name: string) {
  const root = join(tmpdir(), `agent-relay-${name}-${process.pid}-${Date.now()}`);
  const workspace = join(root, "workspace");
  const outputPath = join(root, "state", "job.log");
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "plan.md"), "# Plan\n");
  return { root, workspace, outputPath };
}

test("CodexExecutor runs a real child process with explicit permissions, validates its result and redacts output", async () => {
  const { root, workspace, outputPath } = await createRoot("executor");
  const executable = join(root, "fake-codex");
  await writeFile(executable, `#!/bin/sh
set -eu
[ "$1" = "exec" ]
[ "$2" = "--sandbox" ]
[ "$3" = "danger-full-access" ]
[ "$4" = "--ask-for-approval" ]
[ "$5" = "never" ]
[ "$6" = "--cd" ]
[ "$7" = "${workspace}" ]
printf '%s\n' 'authorization: Bearer abcdefghijklmnopqrstuvwxyz'
cat > "$7/.agent-relay/result.json" <<'JSON'
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

  const executor = new CodexExecutor(executable, 50, 100_000);
  try {
    await assert.rejects(
      () => executor.run({ requestId: "timeout-request", workspace: "workspace", planPath: "plan.md", mode: "implement" }, workspace, outputPath),
      (error: unknown) => error instanceof RelayError && error.code === "CODEX_TIMEOUT",
    );
    assert.equal(await readFile(marker, "utf8"), "terminated");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
