import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertActivePlanFile, resolveWorkspace } from "../src/security/workspace.js";
import { redactSensitiveText, StreamingRedactor } from "../src/security/redaction.js";
import { CodexExecutionError } from "../src/execution/errors.js";

test("redacts common token formats from process output", () => {
  const output = redactSensitiveText(
    "authorization: Bearer abcdefghijklmnopqrstuvwxyz token=super-secret-value github_pat_abcdefghijklmnopqrstuv",
  );
  assert.doesNotMatch(output, /abcdefghijklmnopqrstuvwxyz|super-secret-value|github_pat_/);
  assert.match(output, /\[REDACTED\]/);
});

test("streaming redaction preserves split UTF-8 and redacts split secrets", () => {
  const redactor = new StreamingRedactor();
  const text = Buffer.from("zażółć authorization: Bearer abcdefghijklmnopqrstuvwxyz\n", "utf8");
  const splitInsideUnicode = text.indexOf(Buffer.from("ż", "utf8")) + 1;
  const splitInsideSecret = text.indexOf(Buffer.from("abcdefghijklmnopqrstuvwxyz", "utf8")) + 8;
  const output = [
    redactor.write(text.subarray(0, splitInsideUnicode)),
    redactor.write(text.subarray(splitInsideUnicode, splitInsideSecret)),
    redactor.write(text.subarray(splitInsideSecret)),
    redactor.end(),
  ].join("");
  assert.match(output, /zażółć authorization: Bearer \[REDACTED\]/);
  assert.doesNotMatch(output, /abcdefghijklmnopqrstuvwxyz/);
});

test("resolves only a directory below the real workspace root", async () => {
  const root = join(tmpdir(), `agent-relay-workspace-${process.pid}-${Date.now()}`);
  const workspaceRoot = join(root, "_work");
  const workspace = join(workspaceRoot, "repo", "repo");
  const external = join(root, "external");
  await mkdir(workspace, { recursive: true });
  await mkdir(external, { recursive: true });
  try {
    assert.equal(await resolveWorkspace(workspaceRoot, workspace), workspace);
    await assert.rejects(
      () => resolveWorkspace(workspaceRoot, workspaceRoot),
      (error: unknown) => error instanceof CodexExecutionError && error.code === "WORKSPACE_OUTSIDE_ROOT",
    );
    await assert.rejects(
      () => resolveWorkspace(workspaceRoot, external),
      (error: unknown) => error instanceof CodexExecutionError && error.code === "WORKSPACE_OUTSIDE_ROOT",
    );
    await symlink(external, join(workspaceRoot, "linked"));
    await assert.rejects(
      () => resolveWorkspace(workspaceRoot, join(workspaceRoot, "linked")),
      (error: unknown) => error instanceof CodexExecutionError && error.code === "WORKSPACE_OUTSIDE_ROOT",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("accepts only a direct regular non-symlink active plan", async () => {
  const workspace = join(tmpdir(), `agent-relay-plan-${process.pid}-${Date.now()}`);
  const activeDir = join(workspace, "docs", "exec-plans", "active");
  await mkdir(activeDir, { recursive: true });
  await writeFile(join(activeDir, "plan.md"), "# Plan\n");
  try {
    assert.equal(
      await assertActivePlanFile(workspace, "docs/exec-plans/active/plan.md"),
      join(activeDir, "plan.md"),
    );
    await symlink("plan.md", join(activeDir, "link.md"));
    await assert.rejects(
      () => assertActivePlanFile(workspace, "docs/exec-plans/active/link.md"),
      (error: unknown) => error instanceof CodexExecutionError && error.code === "INVALID_PLAN",
    );
    await mkdir(join(activeDir, "directory.md"));
    await assert.rejects(
      () => assertActivePlanFile(workspace, "docs/exec-plans/active/directory.md"),
      (error: unknown) => error instanceof CodexExecutionError && error.code === "INVALID_PLAN",
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
