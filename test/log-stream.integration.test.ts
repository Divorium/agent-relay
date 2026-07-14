import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexExecutor } from "../src/execution/codex-executor.js";

test("Codex output reaches Docker stdout and the job log before process completion", async () => {
  const root = join(tmpdir(), `agent-relay-live-log-${process.pid}-${Date.now()}`);
  const workspace = join(root, "workspace");
  const outputPath = join(root, "state", "job.log");
  const executable = join(root, "fake-codex");
  await mkdir(join(workspace, ".git"), { recursive: true });
  await writeFile(join(workspace, "plan.md"), "# Plan\n");
  await writeFile(executable, `#!/bin/sh
set -eu
args="$*"
case "$args" in *'default_permissions="relay"'*) ;; *) exit 41 ;; esac
case "$args" in *'"/home/agent/.codex"="deny"'*) ;; *) exit 42 ;; esac
case "$args" in *'"${workspace}/.git"="read"'*) ;; *) exit 43 ;; esac
case "$args" in *'danger-full-access'*) exit 44 ;; esac
case "$args" in *'result.json'*) exit 45 ;; esac
while [ "$1" != "--cd" ]; do shift; done
workspace="$2"
printf 'first live line\n'
sleep 1
printf 'changed\n' > "$workspace/changed.txt"
`, { mode: 0o700 });
  await chmod(executable, 0o700);

  let stdout = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as any;

  try {
    const execution = new CodexExecutor(executable, 5_000, 100_000).run({
      requestId: "live-log-request",
      workspace: "workspace",
      planPath: "plan.md",
    }, workspace, outputPath);

    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.match(stdout, /first live line/);
    assert.match(await readFile(outputPath, "utf8"), /first live line/);

    const outcome = await execution;
    assert.equal(outcome.exitCode, 0);
    assert.equal(await readFile(join(workspace, "changed.txt"), "utf8"), "changed\n");
  } finally {
    process.stdout.write = originalWrite;
    await rm(root, { recursive: true, force: true });
  }
});
