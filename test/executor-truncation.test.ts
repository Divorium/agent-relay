import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexExecutor } from "../src/execution/codex-executor.js";

async function captureStdout(run: () => Promise<void>): Promise<string> {
  const original = process.stdout.write;
  let output = "";
  process.stdout.write = ((value: unknown, callback?: (error?: Error | null) => void) => {
    output += String(value);
    callback?.();
    return true;
  }) as typeof process.stdout.write;
  try {
    await run();
    return output;
  } finally {
    process.stdout.write = original;
  }
}

test("CodexExecutor records completed activity after live output truncation", async () => {
  const root = join(tmpdir(), `agent-relay-truncated-activity-${process.pid}-${Date.now()}`);
  const workspace = join(root, "workspace");
  const home = join(root, "home");
  const runtimeRoot = join(home, ".cache", "runtime");
  const planPath = "docs/exec-plans/active/task.md";
  const executable = join(root, "fake-codex");

  await mkdir(join(workspace, "docs", "exec-plans", "active"), { recursive: true });
  await mkdir(join(workspace, ".git"), { recursive: true });
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(join(workspace, planPath), "# Truncated activity\n");
  await writeFile(executable, `#!/bin/sh
set -eu
printf '%s\n' '{"type":"item.completed","item":{"id":"message","type":"agent_message","text":"abcdefghijklmnopqrstuvwxyz"}}'
/bin/sleep 0.05
printf '%s\n' '{"type":"item.completed","item":{"id":"command","type":"command_execution","command":"true","aggregated_output":"","status":"completed","exit_code":0}}'
`, { mode: 0o700 });
  await chmod(executable, 0o700);

  try {
    const executor = new CodexExecutor(executable, 5_000, 8, home, runtimeRoot, "/srv/source");
    const output = await captureStdout(async () => {
      const outcome = await executor.run(planPath, workspace);
      assert.deepEqual(outcome, { exitCode: 0, executionActivityCount: 1 });
    });
    assert.equal(output, "[codex] [OUTPUT TRUNCATED]\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
