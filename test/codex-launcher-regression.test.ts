import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexExecutor } from "../src/execution/codex-executor.js";
import { CodexExecutionError } from "../src/execution/errors.js";
import { CODEX_RUN_COMMAND } from "../src/run-codex.js";

const planPath = "docs/exec-plans/active/plan.md";

test("direct execution uses the managed repository launcher", () => {
  assert.equal(CODEX_RUN_COMMAND, "/srv/github-runner/storage/agent-relay/scripts/codex-run");
});

test("spawn failures retain the operating-system diagnostic", async () => {
  const root = join(tmpdir(), `agent-relay-spawn-diagnostic-${process.pid}-${Date.now()}`);
  const workspaceRoot = join(root, "workspaces");
  const workspace = join(workspaceRoot, "workspace");
  const home = join(root, "home");
  const runtimeRoot = join(home, ".cache", "agent-relay-runtime");
  const missingCommand = join(root, "missing-codex-run");
  await mkdir(join(workspace, "docs", "exec-plans", "active"), { recursive: true });
  await mkdir(join(workspace, ".git"), { recursive: true });
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(join(workspace, planPath), "# Plan\n");

  const executor = new CodexExecutor(
    missingCommand,
    5_000,
    100_000,
    workspaceRoot,
    home,
    runtimeRoot,
    "/srv/github-runner/storage/agent-relay",
  );

  try {
    await assert.rejects(
      () => executor.run(planPath, workspace),
      (error: unknown) => error instanceof CodexExecutionError
        && error.code === "CODEX_FAILED"
        && error.message.includes("Codex process could not be started:")
        && error.message.includes(missingCommand)
        && error.message.includes("ENOENT"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
