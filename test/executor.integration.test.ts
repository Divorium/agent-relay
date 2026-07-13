import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexExecutor, createCodexEnvironment } from "../src/execution/codex-executor.js";
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

test("CodexExecutor runs a real child process without the Relay token, validates its result and redacts output", async () => {
  const { root, workspace, outputPath } = await createRoot("executor");
  const executable = join(root, "fake-codex");
  await writeFile(executable, `#!/bin/sh
set -eu
[ "$1" = "--ask-for-approval" ]
[ "$2" = "never" ]
[ "$3" = "exec" ]
[ "$4" = "--sandbox" ]
[ "$5" = "danger-full-access" ]
[ "$6" = "--cd" ]
[ "$7" = "${workspace}" ]
[ -z "\${AGENT_RELAY_TOKEN:-}" ]
[ "\${APPLICATION_MODE:-}" = "test" ]
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

  const previousRelayToken = process.env.AGENT_RELAY_TOKEN;
  const previousApplicationMode = process.env.APPLICATION_MODE;
  process.env.AGENT_RELAY_TOKEN = "relay-secret";
  process.env.APPLICATION_MODE = "test";
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
    if (previousRelayToken === undefined) delete process.env.AGENT_RELAY_TOKEN;
    else process.env.AGENT_RELAY_TOKEN = previousRelayToken;
    if (previousApplicationMode === undefined) delete process.env.APPLICATION_MODE;
    else process.env.APPLICATION_MODE = previousApplicationMode;
    await rm(root, { recursive: true, force: true });
  }
});

test("CodexExecutor returns a bounded redacted diagnostic tail when Codex exits unsuccessfully", async () => {
  const { root, workspace, outputPath } = await createRoot("failed-executor");
  const executable = join(root, "failed-codex");
  await writeFile(executable, `#!/bin/sh
set -eu
printf '%s\n' 'sk-abcdefghijklmnopqrstuvwxyz123456'
i=0
while [ "$i" -lt 5000 ]; do
  printf x
  i=$((i + 1))
done
printf '%s\n' 'FINAL_CODEX_ERROR' >&2
exit 1
`, { mode: 0o700 });
  await chmod(executable, 0o700);

  const executor = new CodexExecutor(executable, 5_000, 100_000);
  try {
    await assert.rejects(
      () => executor.run({ requestId: "failed-request", workspace: "workspace", planPath: "plan.md", mode: "implement" }, workspace, outputPath),
      (error: unknown) => {
        assert.ok(error instanceof RelayError);
        assert.equal(error.code, "CODEX_FAILED");
        assert.match(error.message, /Codex exited with code 1/);
        assert.match(error.message, /Codex diagnostic tail:/);
        assert.match(error.message, /FINAL_CODEX_ERROR/);
        assert.doesNotMatch(error.message, /sk-abcdefghijklmnopqrstuvwxyz123456/);
        assert.ok(error.message.length <= 4_100);
        return true;
      },
    );

    const log = await readFile(outputPath, "utf8");
    assert.match(log, /\[REDACTED\]/);
    assert.match(log, /FINAL_CODEX_ERROR/);
    assert.doesNotMatch(log, /sk-abcdefghijklmnopqrstuvwxyz123456/);
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
