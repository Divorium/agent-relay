import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexExecutor, createCodexArgs, createCodexEnvironment, terminateProcess } from "../src/execution/codex-executor.js";
import { CodexExecutionError } from "../src/execution/errors.js";

const planPath = "docs/exec-plans/active/plan.md";

async function createRoot(name: string) {
  const root = join(tmpdir(), `agent-relay-${name}-${process.pid}-${Date.now()}`);
  const workspaceRoot = join(root, "workspaces");
  const workspace = join(workspaceRoot, "workspace");
  const home = join(root, "home");
  const runtimeRoot = join(home, ".cache", "agent-relay-runtime");
  await mkdir(join(workspace, "docs", "exec-plans", "active"), { recursive: true });
  await mkdir(join(workspace, ".git"), { recursive: true });
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(join(workspace, planPath), "# Plan\n");
  return { root, workspace, home, runtimeRoot };
}

async function captureStdout(run: () => Promise<void>): Promise<string> {
  const original = process.stdout.write;
  let output = "";
  process.stdout.write = ((value: unknown) => {
    output += String(value);
    return true;
  }) as typeof process.stdout.write;
  try {
    await run();
    return output;
  } finally {
    process.stdout.write = original;
  }
}

test("executor passes only the required launcher environment", () => {
  assert.deepEqual(createCodexEnvironment("/home/user", "/home/user/.cache/runtime"), {
    HOME: "/home/user",
    CODEX_RUNTIME_ROOT: "/home/user/.cache/runtime",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
  });
});

test("Codex arguments keep the selected repository reachable while isolating native host paths", () => {
  const args = createCodexArgs(
    "/work/root/repository",
    "prompt",
    "/home/user",
    "/home/user/.cache/runtime",
    "/srv/github-runner/storage/agent-relay",
  );
  assert.deepEqual(args.slice(0, 2), ["--ask-for-approval", "never"]);
  assert.ok(args.includes("default_permissions=\"agent\""));
  assert.ok(args.includes("permissions.agent.extends=\":workspace\""));
  const filesystem = args.find((value) => value.startsWith("permissions.agent.filesystem="));
  assert.ok(filesystem);
  for (const expected of [
    '"/home/user"="deny"',
    '"/srv/github-runner/storage/agent-relay"="deny"',
    '"/opt/rust"="read"',
    '"/tmp"="deny"',
    '"/var/tmp"="deny"',
    '"/home/user/.cache/runtime"="write"',
    '"/work/root/repository"="write"',
    '"/work/root/repository/.git"="read"',
  ]) assert.match(filesystem, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(filesystem, /"\/work\/root"="deny"/);
  assert.ok(args.includes("permissions.agent.network.enabled=true"));
  assert.ok(!args.includes("danger-full-access"));
});

test("CodexExecutor streams redacted output and edits the workspace", async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("executor");
  const executable = join(root, "fake-codex");
  await writeFile(executable, `#!/bin/sh
set -eu
[ "\${HOME}" = "${home}" ]
[ "\${CODEX_RUNTIME_ROOT}" = "${runtimeRoot}" ]
printf '%s' 'authorization: Bearer github_pat_abcdefghijkl'
printf '%s\n' 'mnopqrstuvwxyz1234567890'
printf 'warning\n' >&2
printf 'changed\n' > "${workspace}/changed.txt"
`, { mode: 0o700 });
  await chmod(executable, 0o700);

  const executor = new CodexExecutor(executable, 5_000, 100_000, home, runtimeRoot, "/srv/github-runner/storage/agent-relay");
  try {
    const output = await captureStdout(async () => {
      const outcome = await executor.run(planPath, workspace);
      assert.equal(outcome.exitCode, 0);
    });
    assert.equal(await readFile(join(workspace, "changed.txt"), "utf8"), "changed\n");
    assert.doesNotMatch(output, /github_pat_/);
    assert.match(output, /\[REDACTED\]/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CodexExecutor reports spawn failures", async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("spawn");
  const executor = new CodexExecutor(join(root, "missing"), 5_000, 100_000, home, runtimeRoot, "/srv/github-runner/storage/agent-relay");
  try {
    await assert.rejects(
      () => executor.run(planPath, workspace),
      (error: unknown) => error instanceof CodexExecutionError && error.code === "CODEX_FAILED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CodexExecutor reports timeout after terminating the process group", async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("timeout");
  const executable = join(root, "slow-codex");
  const marker = join(root, "terminated");
  await writeFile(executable, `#!/bin/sh
set -eu
trap 'printf terminated > "${marker}"; exit 0' TERM
while true; do /bin/sleep 1; done
`, { mode: 0o700 });
  await chmod(executable, 0o700);

  const executor = new CodexExecutor(executable, 50, 100_000, home, runtimeRoot, "/srv/github-runner/storage/agent-relay");
  try {
    await assert.rejects(
      () => executor.run(planPath, workspace),
      (error: unknown) => error instanceof CodexExecutionError && error.code === "CODEX_TIMEOUT",
    );
    assert.equal(await readFile(marker, "utf8"), "terminated");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CodexExecutor caps output and emits one truncation marker", async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("truncate");
  const executable = join(root, "verbose-codex");
  await writeFile(executable, "#!/bin/sh\nprintf 'abcdefghijklmnopqrstuvwxyz\\n'\n", { mode: 0o700 });
  await chmod(executable, 0o700);

  const executor = new CodexExecutor(executable, 5_000, 8, home, runtimeRoot, "/srv/github-runner/storage/agent-relay");
  try {
    const output = await captureStdout(async () => {
      await executor.run(planPath, workspace);
    });
    assert.equal(output, "\n[OUTPUT TRUNCATED]\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("terminateProcess handles direct, grouped and fallback termination", () => {
  const directSignals: string[] = [];
  terminateProcess({ kill: (signal) => directSignals.push(signal) }, "SIGTERM", () => assert.fail("group kill must not run"));
  assert.deepEqual(directSignals, ["SIGTERM"]);

  const grouped: Array<[number, string]> = [];
  terminateProcess({ pid: 42, kill: () => assert.fail("direct kill must not run") }, "SIGKILL", (pid, signal) => grouped.push([pid, signal]));
  assert.deepEqual(grouped, [[42, "SIGKILL"]]);

  const fallbackSignals: string[] = [];
  terminateProcess({ pid: 7, kill: (signal) => fallbackSignals.push(signal) }, "SIGTERM", () => { throw new Error("missing group"); });
  assert.deepEqual(fallbackSignals, ["SIGTERM"]);
});

test("CodexExecutor force-kills a process that ignores termination", async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("force-kill");
  const executable = join(root, "stubborn-codex");
  await writeFile(executable, "#!/bin/sh\ntrap '' TERM\nwhile true; do /bin/sleep 1; done\n", { mode: 0o700 });
  await chmod(executable, 0o700);

  const executor = new CodexExecutor(
    executable,
    30,
    100_000,
    home,
    runtimeRoot,
    "/srv/github-runner/storage/agent-relay",
    30,
  );
  try {
    await assert.rejects(
      () => executor.run(planPath, workspace),
      (error: unknown) => error instanceof CodexExecutionError && error.code === "CODEX_TIMEOUT",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CodexExecutor discards chunks received after the output limit", async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("limit-reached");
  const executable = join(root, "chunked-codex");
  await writeFile(executable, "#!/bin/sh\nprintf 12345678\n/bin/sleep 0.05\nprintf overflow >&2\n", { mode: 0o700 });
  await chmod(executable, 0o700);

  const executor = new CodexExecutor(executable, 5_000, 8, home, runtimeRoot, "/srv/github-runner/storage/agent-relay");
  try {
    const output = await captureStdout(async () => executor.run(planPath, workspace).then(() => undefined));
    assert.equal(output, "\n[OUTPUT TRUNCATED]\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
