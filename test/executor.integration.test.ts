import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexExecutor, createCodexArgs, createCodexEnvironment } from "../src/execution/codex-executor.js";
import { RelayError } from "../src/contracts/errors.js";

const planPath = "docs/exec-plans/active/plan.md";

async function createRoot(name: string) {
  const root = join(tmpdir(), `agent-relay-${name}-${process.pid}-${Date.now()}`);
  const workspaceRoot = join(root, "workspaces");
  const workspace = join(workspaceRoot, "workspace");
  const outputPath = join(root, "state", "job.log");
  await mkdir(join(workspace, "docs", "exec-plans", "active"), { recursive: true });
  await mkdir(join(workspace, ".git"), { recursive: true });
  await writeFile(join(workspace, planPath), "# Plan\n");
  return { root, workspaceRoot, workspace, outputPath };
}

test("executor passes only fixed locale to the launcher", () => {
  assert.deepEqual(createCodexEnvironment(), {
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
  });
});

test("Codex arguments isolate the selected repository from its shared root", () => {
  const args = createCodexArgs("/work/root/repository", "prompt", "/work/root");
  assert.deepEqual(args.slice(0, 2), ["--ask-for-approval", "never"]);
  assert.ok(args.includes("default_permissions=\"relay\""));
  assert.ok(args.includes("permissions.relay.extends=\":workspace\""));
  const filesystem = args.find((value) => value.startsWith("permissions.relay.filesystem="));
  assert.ok(filesystem);
  for (const expected of [
    '"/home/agent/.codex"="deny"',
    '"/app"="deny"',
    '"/runner"="deny"',
    '"/tmp"="deny"',
    '"/var/tmp"="deny"',
    '"/tmp/agent-relay-runtime"="write"',
    '"/work/root"="deny"',
    '"/work/root/repository"="write"',
    '"/work/root/repository/.git"="read"',
  ]) assert.match(filesystem, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(filesystem, /home\/relay/);
  assert.ok(args.includes("permissions.relay.network.enabled=true"));
  assert.notDeepEqual(args.slice(args.indexOf("exec") + 1, args.indexOf("exec") + 3), ["--sandbox", "danger-full-access"]);
});

test("CodexExecutor runs a real child process directly with filtered context and no result artifact", async () => {
  const { root, workspaceRoot, workspace, outputPath } = await createRoot("executor");
  const executable = join(root, "fake-codex");
  await writeFile(executable, `#!/bin/sh
set -eu
args="$*"
case "$args" in *'default_permissions="relay"'*) ;; *) exit 21 ;; esac
case "$args" in *'permissions.relay.extends=":workspace"'*) ;; *) exit 22 ;; esac
case "$args" in *'"/home/agent/.codex"="deny"'*) ;; *) exit 23 ;; esac
case "$args" in *'"/app"="deny"'*) ;; *) exit 24 ;; esac
case "$args" in *'"/runner"="deny"'*) ;; *) exit 26 ;; esac
case "$args" in *'"/tmp"="deny"'*) ;; *) exit 27 ;; esac
case "$args" in *'"/var/tmp"="deny"'*) ;; *) exit 28 ;; esac
case "$args" in *'"/tmp/agent-relay-runtime"="write"'*) ;; *) exit 29 ;; esac
case "$args" in *'"${workspaceRoot}"="deny"'*) ;; *) exit 30 ;; esac
case "$args" in *'"${workspace}"="write"'*) ;; *) exit 31 ;; esac
case "$args" in *'"${workspace}/.git"="read"'*) ;; *) exit 32 ;; esac
case "$args" in *'danger-full-access'*) exit 33 ;; esac
case "$args" in *'result.json'*) exit 34 ;; esac
case "$args" in *'.agent/PLANS.md'*) ;; *) exit 35 ;; esac
while [ "$1" != "--cd" ]; do shift; done
workspace="$2"
[ "$workspace" = "${workspace}" ]
[ -z "\${AGENT_RELAY_TOKEN:-}" ]
[ "\${LANG:-}" = "C.UTF-8" ]
printf '%s\n' 'authorization: Bearer abcdefghijklmnopqrstuvwxyz'
printf 'changed\n' > "$workspace/changed.txt"
`, { mode: 0o700 });
  await chmod(executable, 0o700);

  const previousRelayToken = process.env.AGENT_RELAY_TOKEN;
  process.env.AGENT_RELAY_TOKEN = "relay-secret";
  const executor = new CodexExecutor(executable, 5_000, 100_000, workspaceRoot);
  try {
    const outcome = await executor.run({ requestId: "executor-request", workspace: "workspace", planPath }, workspace, outputPath);
    assert.equal(outcome.exitCode, 0);
    assert.equal(await readFile(join(workspace, "changed.txt"), "utf8"), "changed\n");
    const log = await readFile(outputPath, "utf8");
    assert.doesNotMatch(log, /abcdefghijklmnopqrstuvwxyz/);
    assert.match(log, /\[REDACTED\]/);
  } finally {
    if (previousRelayToken === undefined) delete process.env.AGENT_RELAY_TOKEN;
    else process.env.AGENT_RELAY_TOKEN = previousRelayToken;
    await rm(root, { recursive: true, force: true });
  }
});

test("CodexExecutor reports timeout only after the child process closes", async () => {
  const { root, workspaceRoot, workspace, outputPath } = await createRoot("timeout");
  const executable = join(root, "slow-codex");
  const marker = join(root, "terminated");
  await writeFile(executable, `#!/bin/sh
set -eu
trap 'printf terminated > "${marker}"; exit 0' TERM
while true; do sleep 1; done
`, { mode: 0o700 });
  await chmod(executable, 0o700);

  const executor = new CodexExecutor(executable, 50, 100_000, workspaceRoot);
  try {
    await assert.rejects(
      () => executor.run({ requestId: "timeout-request", workspace: "workspace", planPath }, workspace, outputPath),
      (error: unknown) => error instanceof RelayError && error.code === "CODEX_TIMEOUT",
    );
    assert.equal(await readFile(marker, "utf8"), "terminated");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
