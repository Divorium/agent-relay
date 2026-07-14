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
  mode: "implement" as const,
};

function completedResult(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    requestId: validRequest.requestId,
    status: "completed",
    commitMessage: "Implement contract validators",
    summary: "Implemented validation.",
    validation: [{ command: "npm test", status: "passed", exitCode: 0, details: "Passed." }],
    blockers: [],
    limitations: [],
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
test("rejects absolute and traversing workspace paths", () => {
  assert.throws(() => validateCreateJobRequest({ ...validRequest, workspace: "/tmp/repo" }), /safe relative path/);
  assert.throws(() => validateCreateJobRequest({ ...validRequest, workspace: "../repo" }), /safe relative path/);
});
test("rejects non-Markdown plan paths", () => assert.throws(() => validateCreateJobRequest({ ...validRequest, planPath: "plan.json" }), /Markdown/));
test("accepts a valid completed result", () => {
  const result = validateCodexResult(completedResult(), validRequest.requestId);
  assert.equal(result.commitMessage, "Implement contract validators");
});
test("rejects mismatched result requestId", () => assert.throws(() => validateCodexResult({ schemaVersion: 1, requestId: "other", status: "blocked", summary: "Blocked.", validation: [], blockers: ["Reason"], limitations: [] }, validRequest.requestId), /does not match/));
test("rejects completed results without a commit message", () => assert.throws(() => validateCodexResult(completedResult({ commitMessage: undefined }), validRequest.requestId), /commitMessage/));
test("rejects multiline commit messages", () => assert.throws(() => validateCodexResult(completedResult({ commitMessage: "Line one\nLine two" }), validRequest.requestId)));
test("rejects blocked results that include a commit message", () => assert.throws(() => validateCodexResult({ schemaVersion: 1, requestId: validRequest.requestId, status: "blocked", commitMessage: "Do not use", summary: "Blocked.", validation: [], blockers: ["Reason"], limitations: [] }, validRequest.requestId), /not allowed/));
test("uses RESULT_INVALID and 422 for malformed result strings", () => {
  expectRelayError(() => validateCodexResult(completedResult({ summary: "" }), validRequest.requestId), "RESULT_INVALID", 422);
});
test("rejects unknown fields inside validation records", () => {
  expectRelayError(() => validateCodexResult(completedResult({ validation: [{ command: "npm test", status: "passed", details: "Passed.", output: "unexpected" }] }), validRequest.requestId), "RESULT_INVALID", 422);
});
test("rejects the legacy shouldCommit field", () => {
  expectRelayError(() => validateCodexResult(completedResult({ shouldCommit: true }), validRequest.requestId), "RESULT_INVALID", 422);
});
test("rejects unknown top-level result fields", () => {
  expectRelayError(() => validateCodexResult(completedResult({ filesChanged: ["src/index.ts"] }), validRequest.requestId), "RESULT_INVALID", 422);
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
});
test("rejects missing configuration", () => assert.throws(() => loadConfig({ SHARED_WORKSPACE_ROOT: "/work" }), /AGENT_RELAY_TOKEN/));
test("prompt includes plan, mode, result contract, and runner-owned Git rules", () => {
  const prompt = buildCodexPrompt({ ...validRequest, mode: "revise", reviewFindings: ["Fix validation"] }, ".agent-relay/result.json");
  assert.match(prompt, /docs\/exec-plans/);
  assert.match(prompt, /Never run git commit, git push/);
  assert.match(prompt, /runner exclusively owns commit and push/);
  assert.match(prompt, /Do not include shouldCommit/);
  assert.match(prompt, /result\.json/);
});
test("redacts common token formats", () => {
  const output = redactSensitiveText("authorization: Bearer abcdefghijklmnopqrstuvwxyz token=super-secret-value");
  assert.doesNotMatch(output, /abcdefghijklmnopqrstuvwxyz|super-secret-value/);
});
test("rejects sensitive result content", () => assert.throws(() => validateCodexResult({ schemaVersion: 1, requestId: "req-1", status: "blocked", summary: "Found github_pat_abcdefghijklmnopqrstuvwxyz1234567890", validation: [], blockers: ["Blocked"], limitations: [] }, "req-1"), /sensitive data/));

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
  return { id: "job-1", request: { requestId: "request-1", workspace: "repo/repo", planPath: "docs/plan.md", mode: "implement" }, status, createdAt: "2026-07-13T00:00:00.000Z", updatedAt: "2026-07-13T00:00:00.000Z", resultPath: "/work/result.json", outputPath: "/state/job.log" };
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
