import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const repository = "owner/repository";
const pullRequestNumber = 42;
const headSha = "0123456789abcdef0123456789abcdef01234567";

function runProcess(command: string, args: string[], options: Record<string, unknown>): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: unknown) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk: unknown) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code: number | null) => resolve({ status: code ?? 1, stdout, stderr }));
  });
}

async function runResolver(statusCode: number, responseBody: Record<string, unknown>): Promise<{ status: number; stdout: string; stderr: string; output: string }> {
  const root = join(tmpdir(), `agent-relay-pr-resolver-${process.pid}-${Date.now()}-${Math.random()}`);
  const outputPath = join(root, "github-output");
  await mkdir(root, { recursive: true });
  await writeFile(outputPath, "");

  const server = createServer((req: any, res: any) => {
    assert.equal(req.method, "GET");
    assert.equal(req.url, `/repos/${repository}/pulls/${pullRequestNumber}`);
    assert.equal(req.headers.authorization, "Bearer github-token");
    res.statusCode = statusCode;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(responseBody));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const result = await runProcess(process.execPath, [join(process.cwd(), "runner", "resolve-pr.mjs")], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
        GITHUB_TOKEN: "github-token",
        GITHUB_REPOSITORY: repository,
        GITHUB_OUTPUT: outputPath,
        PR_NUMBER: String(pullRequestNumber),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ...result, output: await readFile(outputPath, "utf8") };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
}

function pullRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: pullRequestNumber,
    state: "open",
    draft: false,
    head: {
      ref: "agent/change",
      sha: headSha,
      repo: { full_name: repository },
    },
    ...overrides,
  };
}

function assertApprovalWorkflow(workflow: string): void {
  const requestIndex = workflow.indexOf("Resolve execution request");
  const resolverIndex = workflow.indexOf("node /opt/agent-relay/runner/resolve-pr.mjs");
  const checkoutIndex = workflow.indexOf("actions/checkout@v4");
  const planIndex = workflow.indexOf("Resolve active ExecPlan");
  const codexIndex = workflow.indexOf("node /opt/agent-relay/dist/src/run-codex.js");
  const finalizerIndex = workflow.indexOf("run: /opt/agent-relay/runner/finalize.sh");

  assert.match(workflow, /pull_request:\s*\n\s*types:\s*\n\s*- ready_for_review/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s*-\s+(?:synchronize|opened|reopened)\s*$/m);
  assert.match(workflow, /github\.event\.pull_request\.number \|\| inputs\.pr_number \|\| github\.run_id/);
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(workflow, /EVENT_PR_NUMBER: \$\{\{ github\.event\.pull_request\.number \}\}/);
  assert.match(workflow, /pr_number="\$\{EVENT_PR_NUMBER\}"/);
  assert.match(workflow, /PR_NUMBER: \$\{\{ steps\.request\.outputs\.pr_number \}\}/);
  assert.match(workflow, /--diff-filter=AM/);
  assert.match(workflow, /\$\{BASE_SHA\}\.\.\.\$\{HEAD_SHA\}/);
  assert.match(workflow, /Expected exactly one added or modified active ExecPlan/);
  assert.match(workflow, /CODEX_PLAN_PATH: \$\{\{ steps\.plan\.outputs\.plan_path \}\}/);
  assert.match(workflow, /CODEX_WORKSPACE_ROOT: \$\{\{ runner\.workspace \}\}/);
  assert.match(workflow, /tee "\$\{RUNNER_TEMP\}\/agent-relay-console\.log"/);
  assert.match(workflow, /\$\{\{ runner\.temp \}\}\/agent-relay-console\.log/);
  assert.match(workflow, /token: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /GITHUB_PUSH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(workflow, /AGENT_RELAY_TOKEN|AGENT_RELAY_URL|AGENT_RELAY_PUSH_TOKEN|runner\/client\.mjs/);
  assert.doesNotMatch(workflow, /\bmode:|AGENT_RELAY_MODE|AGENT_RELAY_OUTPUT_ARCHIVE_PATH|agent-relay-output\.log/);
  assert.ok(requestIndex >= 0);
  assert.ok(resolverIndex > requestIndex);
  assert.ok(checkoutIndex > resolverIndex);
  assert.ok(planIndex > checkoutIndex);
  assert.ok(codexIndex > planIndex);
  assert.ok(finalizerIndex > codexIndex);
  assert.doesNotMatch(workflow, /inputs\.branch/);
}

test("ready open pull request is accepted and produces API-derived checkout outputs", async () => {
  const result = await runResolver(200, pullRequest());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Resolved ready pull request #42/);
  assert.equal(result.output, `head_ref=agent/change\nhead_sha=${headSha}\n`);
});

test("draft pull request is rejected before checkout or Codex invocation", async () => {
  const result = await runResolver(200, pullRequest({ draft: true }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not ready for review/);
  assert.equal(result.output, "");
});

test("closed pull request is rejected", async () => {
  const result = await runResolver(200, pullRequest({ state: "closed" }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /is not open/);
  assert.equal(result.output, "");
});

test("missing pull request is rejected", async () => {
  const result = await runResolver(404, { message: "Not Found" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /was not found/);
  assert.equal(result.output, "");
});

test("foreign head repository is rejected", async () => {
  const result = await runResolver(200, pullRequest({
    head: {
      ref: "agent/change",
      sha: headSha,
      repo: { full_name: "fork/repository" },
    },
  }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /head must belong to the target repository/);
  assert.equal(result.output, "");
});

test("production and example workflows enforce the approval contract", async () => {
  const production = await readFile(join(process.cwd(), ".github", "workflows", "agent-relay.yml"), "utf8");
  const example = await readFile(join(process.cwd(), "examples", "github-actions", "agent-relay.yml"), "utf8");

  assertApprovalWorkflow(production);
  assertApprovalWorkflow(example);
  assert.equal(example, production);
});
