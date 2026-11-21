import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexExecutor } from "../src/execution/codex-executor.js";

test("executor handles cancellation and removes its signal listeners", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-signal-"));
  const command = join(root, "fixture");
  await writeFile(command, '#!/bin/sh\nsleep 1\nprintf \'%s\\n\' \'{"type":"item.completed","item":{"id":"signal","type":"command_execution","command":"fixture","aggregated_output":"","status":"completed","exit_code":0}}\'\n', { mode: 0o700 });
  await chmod(command, 0o700);
  const previous = process.listeners("SIGTERM");
  const running = new CodexExecutor(command, 5000, 10000, root, root, root, 50).run("plan.md", root);
  try {
    const registered = process.listeners("SIGTERM").filter((listener: unknown) => !previous.includes(listener));
    assert.equal(registered.length, 1, "detached executor must handle parent cancellation");
    const rejection = assert.rejects(running, /interrupted/);
    registered[0]();
    await rejection;
    assert.deepEqual(process.listeners("SIGTERM"), previous);
  } finally {
    await running.catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
