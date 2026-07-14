import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateCodexResult, validateCreateJobRequest } from "../src/contracts/validators.js";
import { RelayError } from "../src/contracts/errors.js";
import { requireBearerToken } from "../src/security/auth.js";
import { resolveWorkspace } from "../src/security/workspace.js";
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

function validResult(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    summary: "Implemented validation.",
    validation: [{ command: "npm test", status: "passed", exitCode: 0, details: "Passed." }],
    ...overrides,
  };
}

function expectRelayError(action: () => unknown, code: string, statusCode: number): void {
  assert.throws(action, (error: unknown) => {
    if (!(error instanceof RelayError)) return false;
    assert.equal(error.code, code);
    assert.equal(error.statusCode, statusCode);
    return true;
  });
}

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
test("rejects non-Markdown plan paths", () => assert.throws(() => validateCreateJobRequest({ ...validRequest, planPath: "plan.json" }), /Markdown/));
test("accepts a minimal valid result", () => {
  const result = validateCodexResult(validResult());
  assert.deepEqual(result, validResult());
});
for (const field of ["requestId", "status", "blockers", "limitations", "commitMessage", "shouldCommit"]) {
  test(`rejects removed result field ${field}`, () => {
    expectRelayError(() => validateCodexResult(validResult({ [field]: field === "status" ? "completed" : "unused" })), "RESULT_INVALID", 422);
  });
}
test("uses RESULT_INVALID and 422 for malformed result strings", () => {
  expectRelayError(() => validateCodexResult(validResult({ summary: "" })), "RESULT_INVALID", 422);
});
test("rejects unknown fields inside validation records", () => {
  expectRelayError(() => validateCodexResult(validResult({ validation: [{ command: "npm test", status: "passed", details: "Passed.", output: "unexpected" }] })), "RESULT_INVALID", 422);
});
test("rejects unknown top-level result fields", () => {
  expectRelayError(() => validateCodexResult(validResult({ filesChanged: ["src/index.ts"] })), "RESULT_INVALID", 422);
});
test("accepts exact bearer token", () => assert.doesNotThrow(() => requireBearerToken("Bearer secret", "secret")));
test("rejects missing or incorrect bearer token", () => {
  assert.throws(() => requireBearerToken(undefined, "secret"));
  assert.throws(() => requireBearerToken("Bearer wrong", "secret"));
});
test("loads required configuration and defaults", () => {
  const config = loadConfig({ AGENT_RELAY_TOKEN: "secret", SHARED_WORKSPACE_ROOT: "/work" });
  assert.equal(config.port, 8080);
  assert.equal(config.codexTimeoutMs, 21_600_000);
  assert.equal(config.codexRunAsUser, undefined);
});
test("loads the isolated Codex user", () => {
  const config = loadConfig({ AGENT_RELAY_TOKEN: "secret", SHARED_WORKSPACE_ROOT: "/work", CODEX_RUN_AS_USER: "agent" });
  assert.equal(config.codexRunAsUser, "agent");
});
test("rejects invalid Codex user names", () => assert.throws(() => loadConfig({ AGENT_RELAY_TOKEN: "secret", SHARED_WORKSPACE_ROOT: "/work", CODEX_RUN_AS_USER: "../root" }), /valid local user/));
test("rejects missing configuration", () => assert.throws(() => loadConfig({ SHARED_WORKSPACE_ROOT: "/work" }), /AGENT_RELAY_TOKEN/));
test("prompt includes only task context and the minimal result contract", () => {
  const prompt = buildCodexPrompt(validRequest, ".agent-relay/result.json");
  assert.match(prompt, /docs\/exec-plans/);
  assert.match(prompt, /mark it \[blocked\]/);
  assert.match(prompt, /Do not run commands that create or publish Git commits/);
  assert.match(prompt, /result\.json/);
  assert.doesNotMatch(prompt, /Execution mode|requestId|GitHub credentials|runner exclusively|shouldCommit/i);
});
test("redacts common token formats", () => {
  const output = redactSensitiveText("authorization: Bearer abcdefghijklmnopqrstuvwxyz token=super-secret-value");
  assert.doesNotMatch(output, /abcdefghijklmnopqrstuvwxyz|super-secret-value/);
});
test("rejects sensitive result content", () => assert.throws(() => validateCodexResult(validResult({ summary: "Found github_pat_abcdefghijklmnopqrstuvwxyz1234567890" })), /sensitive data/));

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

function job(status: JobRecord["status"]): JobRecord {
  return { id: "job-1", request: { requestId: "request-1", workspace: "repo/repo", planPath: "docs/plan.md" }, status, createdAt: "2026-07-13T00:00:00.000Z", updatedAt: "2026-07-13T00:00:00.000Z", resultPath: "/work/result.json", outputPath: "/state/job.log" };
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
