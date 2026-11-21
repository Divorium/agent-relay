import test from "node:test";
import assert from "node:assert/strict";
import { CodexEventNormalizer } from "../src/execution/codex-normalizer.js";
import { validateExecutionOutcome } from "../src/execution/codex-executor.js";

test("normalizer records only completed command or substantive file-change activity", () => {
  const normalizer = new CodexEventNormalizer();
  assert.equal(normalizer.executionActivityCount(), 0);

  [...normalizer.normalize({
    type: "item.started",
    item: { id: "reasoning-1", type: "reasoning", text: "Inspecting the repository" },
  })];
  assert.equal(normalizer.executionActivityCount(), 0);

  [...normalizer.normalize({
    type: "item.started",
    item: { id: "command-1", type: "command_execution", command: "pwd", aggregated_output: "" },
  })];
  assert.equal(normalizer.executionActivityCount(), 0);

  [...normalizer.normalize({
    type: "item.updated",
    item: { id: "command-1", type: "command_execution", command: "pwd", aggregated_output: "/repo\n" },
  })];
  assert.equal(normalizer.executionActivityCount(), 0);

  [...normalizer.normalize({
    type: "item.completed",
    item: {
      id: "command-1",
      type: "command_execution",
      command: "pwd",
      aggregated_output: "/repo\n",
      status: "completed",
      exit_code: 0,
    },
  })];
  assert.equal(normalizer.executionActivityCount(), 1);

  normalizer.clearLifecycleState();
  assert.equal(normalizer.executionActivityCount(), 1);

  const fileNormalizer = new CodexEventNormalizer();
  [...fileNormalizer.normalize({
    type: "item.completed",
    item: { id: "file-empty", type: "file_change", changes: [], status: "completed" },
  })];
  assert.equal(fileNormalizer.executionActivityCount(), 0);

  [...fileNormalizer.normalize({
    type: "item.completed",
    item: {
      id: "file-real",
      type: "file_change",
      changes: [{ path: "src/index.ts", kind: "update", patch: "+export {};\n" }],
      status: "completed",
    },
  })];
  assert.equal(fileNormalizer.executionActivityCount(), 1);
});

test("successful Codex exit requires observable execution activity", () => {
  assert.deepEqual(validateExecutionOutcome(0, 1), { exitCode: 0, executionActivityCount: 1 });
  assert.throws(
    () => validateExecutionOutcome(1, 1),
    /Codex exited with code 1/u,
  );
  assert.throws(
    () => validateExecutionOutcome(0, 0),
    /Codex completed without executing any command or file change/u,
  );
});
