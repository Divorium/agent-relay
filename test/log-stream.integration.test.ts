import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexExecutor } from "../src/execution/codex-executor.js";

const planPath = "docs/exec-plans/active/plan.md";

async function fixture(name: string, executableSource: string) {
  const root = join(tmpdir(), `agent-relay-log-${name}-${process.pid}-${Date.now()}-${Math.random()}`);
  const workspaceRoot = join(root, "workspaces");
  const workspace = join(workspaceRoot, "workspace");
  const outputPath = join(root, "state", "job.log");
  const executable = join(root, "fake-codex");
  await mkdir(join(workspace, "docs", "exec-plans", "active"), { recursive: true });
  await mkdir(join(workspace, ".git"), { recursive: true });
  await writeFile(join(workspace, planPath), "# Plan\n");
  await writeFile(executable, executableSource, { mode: 0o700 });
  await chmod(executable, 0o700);
  return { root, workspaceRoot, workspace, outputPath, executable };
}

function request(requestId: string) {
  return { requestId, workspace: "workspace", planPath };
}

test("Codex output reaches Relay stdout and the job log before process completion", async () => {
  const current = await fixture("live", `#!/bin/sh
set -eu
printf 'first live line\n'
sleep 1
printf 'changed\n' > "$PWD/changed.txt"
`);

  let stdout = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as any;

  try {
    const execution = new CodexExecutor(current.executable, 5_000, 100_000, current.workspaceRoot).run(
      request("live-log-request"),
      current.workspace,
      current.outputPath,
    );

    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.match(stdout, /first live line/);
    assert.match(await readFile(current.outputPath, "utf8"), /first live line/);

    const outcome = await execution;
    assert.equal(outcome.exitCode, 0);
    assert.equal(await readFile(join(current.workspace, "changed.txt"), "utf8"), "changed\n");
  } finally {
    process.stdout.write = originalWrite;
    await rm(current.root, { recursive: true, force: true });
  }
});

test("Codex stdout and stderr remain visible and persisted when the process fails", async () => {
  const current = await fixture("failure", `#!/bin/sh
set -eu
printf 'failure stdout\n'
printf 'failure stderr\n' >&2
exit 17
`);

  let stdout = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as any;

  try {
    await assert.rejects(
      new CodexExecutor(current.executable, 5_000, 100_000, current.workspaceRoot).run(
        request("failed-log-request"),
        current.workspace,
        current.outputPath,
      ),
      /Codex exited with code 17/,
    );

    const log = await readFile(current.outputPath, "utf8");
    assert.match(stdout, /failure stdout/);
    assert.match(stdout, /failure stderr/);
    assert.match(log, /failure stdout/);
    assert.match(log, /failure stderr/);
  } finally {
    process.stdout.write = originalWrite;
    await rm(current.root, { recursive: true, force: true });
  }
});

test("Codex output redaction survives split UTF-8 and split secret chunks", async () => {
  const current = await fixture("split-secret", `#!/bin/sh
set -eu
printf 'zażółć authorization: Bearer abcdefgh'
sleep 0.1
printf 'ijklmnopqrstuvwxyz\n'
`);

  let stdout = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as any;

  try {
    await new CodexExecutor(current.executable, 5_000, 100_000, current.workspaceRoot).run(
      request("split-secret-request"),
      current.workspace,
      current.outputPath,
    );
    const log = await readFile(current.outputPath, "utf8");
    assert.match(stdout, /zażółć authorization: Bearer \[REDACTED\]/);
    assert.match(log, /zażółć authorization: Bearer \[REDACTED\]/);
    assert.doesNotMatch(`${stdout}\n${log}`, /abcdefghijklmnopqrstuvwxyz/);
  } finally {
    process.stdout.write = originalWrite;
    await rm(current.root, { recursive: true, force: true });
  }
});

test("truncated output discards an incomplete sensitive line", async () => {
  const current = await fixture("truncated-secret", `#!/bin/sh
set -eu
printf 'authorization: Bearer abcdefghijklmnopqrstuvwxyz'
`);

  let stdout = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as any;

  try {
    await new CodexExecutor(current.executable, 5_000, 24, current.workspaceRoot).run(
      request("truncated-secret-request"),
      current.workspace,
      current.outputPath,
    );
    const log = await readFile(current.outputPath, "utf8");
    assert.match(stdout, /OUTPUT TRUNCATED/);
    assert.match(log, /OUTPUT TRUNCATED/);
    assert.doesNotMatch(`${stdout}\n${log}`, /authorization|abcdefgh/);
  } finally {
    process.stdout.write = originalWrite;
    await rm(current.root, { recursive: true, force: true });
  }
});
