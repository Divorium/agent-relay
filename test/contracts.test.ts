import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateCreateJobRequest } from "../src/contracts/validators.js";
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
test("prompt contains only the active-plan execution contract", () => {
  const prompt = buildCodexPrompt(validRequest);
  assert.match(prompt, /docs\/exec-plans/);
  assert.match(prompt, /Maintain it according to \.agent\/PLANS\.md/);
  assert.match(prompt, /Do not run commands that create or publish Git commits/);
  assert.doesNotMatch(prompt, /result\.json|requestId|Execution mode|GitHub credentials|runner exclusively|shouldCommit|summary|validation.*JSON/i);
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

function job(status: JobRecord["status"]): JobRecord {
  return { id: "job-1", request: { requestId: "request-1", workspace: "repo/repo", planPath: "docs/plan.md" }, status, createdAt: "2026-07-13T00:00:00.000Z", updatedAt: "2026-07-13T00:00:00.000Z", outputPath: "/state/job.log" };
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
