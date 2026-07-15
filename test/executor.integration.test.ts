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
  const workspace = join(root, "workspace");
  const outputPath = join(root, "state", "job.log");
  await mkdir(join(workspace, "docs", "exec-plans", "active"), { recursive: true });
  await mkdir(join(workspace, ".git"), { recursive: true });
  await writeFile(join(workspace, planPath), "# Plan\n");
  return { root, workspace, outputPath };
}

test("Codex environment contains only approved tool runtime variables", () => {
  assert.deepEqual(createCodexEnvironment({
    PATH: "/usr/bin",
    HOME: "/home/relay",
    JAVA_HOME: "/opt/java/openjdk",
    AGENT_RELAY_TOKEN: "relay-secret",
    APPLICATION_MODE: "test",
    GITHUB_TOKEN: "github-secret",
  }), {
    PATH: "/usr/bin",
    HOME: "/home/relay",
    JAVA_HOME: "/opt/java/openjdk",
  });
});

test("Codex arguments select the restricted Relay permission profile", () => {
  const args = createCodexArgs("/work/repository", "prompt");
  assert.deepEqual(args.slice(0, 2), ["--ask-for-approval", "never"]);
  assert.ok(args.includes("default_permissions=\"relay\""));
  assert.ok(args.includes("permissions.relay.extends=\":workspace\""));
  assert.ok(args.includes("permissions.relay.filesystem={\"/home/agent/.codex\"=\"deny\",\"/work/repository/.git\"=\"read\"}"));
  assert.ok(args.includes("permissions.relay.network.enabled=true"));
  assert.notDeepEqual(args.slice(args.indexOf("exec") + 1, args.indexOf("exec") + 3), ["--sandbox", "danger-full-access"]);
});

test("CodexExecutor runs a real child process with filtered context and no result artifact", async () => {
  const { root, workspace, outputPath } = await createRoot("executor");
  const executable = join(root, "fake-codex");
  await writeFile(executable, `#!/bin/sh
set -eu
args="$*"
case "$args" in *'default_permissions="relay"'*) ;; *) exit 21 ;; esac
case "$args" in *'permissions.relay.extends=":workspace"'*) ;; *) exit 22 ;; esac
case "$args" in *'"/home/agent/.codex"="deny"'*) ;; *) exit 23 ;; esac
case "$args" in *'"${workspace}/.git"="read"'*) ;; *) exit 24 ;; esac
case "$args" in *'danger-full-access'*) exit 25 ;; esac
case "$args" in *'result.json'*) exit 26 ;; esac
case "$args" in *'.agent/PLANS.md'*) ;; *) exit 27 ;; esac
while [ "$1" != "--cd" ]; do shift; done
workspace="$2"
[ "$workspace" = "${workspace}" ]
[ -z "\${AGENT_RELAY_TOKEN:-}" ]
[ -z "\${APPLICATION_MODE:-}" ]
printf '%s\n' 'authorization: Bearer abcdefghijklmnopqrstuvwxyz'
printf 'changed\n' > "$workspace/changed.txt"
`, { mode: 0o700 });
  await chmod(executable, 0o700);

  const previousRelayToken = process.env.AGENT_RELAY_TOKEN;
  const previousApplicationMode = process.env.APPLICATION_MODE;
  process.env.AGENT_RELAY_TOKEN = "relay-secret";
  process.env.APPLICATION_MODE = "test";
  const executor = new CodexExecutor(executable, 5_000, 100_000);
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

  const executor = new CodexExecutor(executable, 50, 100_000);
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
