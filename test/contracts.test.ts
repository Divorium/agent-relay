import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateCreateJobRequest } from "../src/contracts/validators.js";
import { requireBearerToken } from "../src/security/auth.js";
import { assertActivePlanFile, resolveWorkspace } from "../src/security/workspace.js";
import { loadConfig } from "../src/config/config.js";
import { buildCodexPrompt } from "../src/execution/prompt.js";
import { redactSensitiveText } from "../src/security/redaction.js";
import { JobStore } from "../src/persistence/job-store.js";
import type { JobRecord } from "../src/contracts/job.js";

const validRequest = {
  requestId: "repo-pr-1-attempt-1",
  workspace: "repo/repo",
  planPath: "docs/exec-plans/active/plan.md",
};

test("accepts a valid create-job request", () => assert.deepEqual(validateCreateJobRequest(validRequest), validRequest));
test("rejects unknown request fields", () => assert.throws(() => validateCreateJobRequest({ ...validRequest, command: "rm -rf /" }), /Unknown field/));
test("rejects alternate instruction fields", () => {
  assert.throws(() => validateCreateJobRequest({ ...validRequest, mode: "implement" }), /Unknown field: mode/);
  assert.throws(() => validateCreateJobRequest({ ...validRequest, reviewFindings: [] }), /Unknown field: reviewFindings/);
});
test("rejects absolute and traversing workspace paths", () => {
  assert.throws(() => validateCreateJobRequest({ ...validRequest, workspace: "/tmp/repo" }), /safe relative path/);
  assert.throws(() => validateCreateJobRequest({ ...validRequest, workspace: "../repo" }), /safe relative path/);
});
test("accepts only a direct active ExecPlan path", () => {
  for (const planPath of ["plan.md", "docs/plan.md", "docs/exec-plans/completed/plan.md", "docs/exec-plans/active/nested/plan.md"]) {
    assert.throws(() => validateCreateJobRequest({ ...validRequest, planPath }), /directly under docs\/exec-plans\/active/);
  }
});
test("accepts exact bearer token", () => assert.doesNotThrow(() => requireBearerToken("Bearer secret", "secret")));
test("rejects missing or incorrect bearer token", () => {
  assert.throws(() => requireBearerToken(undefined, "secret"));
  assert.throws(() => requireBearerToken("Bearer wrong", "secret"));
});
test("loads required configuration and defaults without launcher overrides", () => {
  const config = loadConfig({
    AGENT_RELAY_TOKEN: "secret",
    SHARED_WORKSPACE_ROOT: "/work",
    CODEX_COMMAND: "/tmp/untrusted",
    CODEX_RUN_AS_USER: "root",
  });
  assert.deepEqual(config, {
    host: "0.0.0.0",
    port: 8080,
    relayToken: "secret",
    workspaceRoot: "/work",
    stateDir: "/var/lib/agent-relay",
    codexTimeoutMs: 21_600_000,
    maxOutputBytes: 10_000_000,
  });
});
test("rejects missing configuration", () => assert.throws(() => loadConfig({ SHARED_WORKSPACE_ROOT: "/work" }), /AGENT_RELAY_TOKEN/));
test("prompt contains only the plan rules and active plan pointer", () => {
  assert.equal(buildCodexPrompt(validRequest), "Follow .agent/PLANS.md and execute the active ExecPlan at docs/exec-plans/active/plan.md.");
});
test("redacts common token formats from process output", () => {
  const output = redactSensitiveText("authorization: Bearer abcdefghijklmnopqrstuvwxyz token=super-secret-value");
  assert.doesNotMatch(output, /abcdefghijklmnopqrstuvwxyz|super-secret-value/);
});

test("resolves a workspace below the shared root", async () => {
  const root = join(tmpdir(), `agent-relay-workspace-${process.pid}`);
  await mkdir(join(root, "repo"), { recursive: true });
  assert.equal(await resolveWorkspace(root, "repo"), join(root, "repo"));
  await rm(root, { recursive: true, force: true });
});
test("rejects files as workspaces", async () => {
  const root = join(tmpdir(), `agent-relay-file-${process.pid}`);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "file"), "x");
  await assert.rejects(() => resolveWorkspace(root, "file"), /not a directory/);
  await rm(root, { recursive: true, force: true });
});
test("accepts only a regular non-symlink active plan file", async () => {
  const workspace = join(tmpdir(), `agent-relay-plan-${process.pid}-${Date.now()}`);
  const activeDir = join(workspace, "docs", "exec-plans", "active");
  await mkdir(activeDir, { recursive: true });
  await writeFile(join(activeDir, "plan.md"), "# Plan\n");
  await assert.doesNotReject(() => assertActivePlanFile(workspace, "docs/exec-plans/active/plan.md"));
  const linked = spawnSync("ln", ["-s", "plan.md", join(activeDir, "link.md")], { encoding: "utf8" });
  assert.equal(linked.status, 0, linked.stderr);
  await assert.rejects(() => assertActivePlanFile(workspace, "docs/exec-plans/active/link.md"), /symbolic links/);
  await rm(workspace, { recursive: true, force: true });
});

function job(status: JobRecord["status"]): JobRecord {
  return {
    id: "job-1",
    request: { requestId: "request-1", workspace: "repo/repo", planPath: "docs/exec-plans/active/plan.md" },
    status,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    outputPath: "/state/job.log",
  };
}
test("persists, indexes and recovers job state", async () => {
  const stateDir = join(tmpdir(), `agent-relay-state-${process.pid}`);
  const store = new JobStore(stateDir);
  const record = job("running");
  await store.save(record);
  await store.index(record);
  assert.equal((await store.findByRequestId("request-1"))?.id, "job-1");
  assert.equal(await store.markRunningJobsInterrupted(), 1);
  assert.equal((await store.get("job-1"))?.status, "interrupted");
  await rm(stateDir, { recursive: true, force: true });
});
