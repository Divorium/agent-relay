import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildCodexPrompt } from "../src/execution/prompt.js";
import { DOCKER_SOCKET_DIRECTORY, createCodexArgs, createCodexEnvironment } from "../src/execution/codex-executor.js";

const workflowPaths = [
  ".github/workflows/codex.yml",
  "examples/github-actions/codex.yml",
];

test("runtime prompt includes plan pointers and context-driven ordinary Docker use", () => {
  const prompt = buildCodexPrompt("docs/exec-plans/active/task.md");
  assert.match(prompt, /^Follow \.agent\/PLANS\.md and execute the active ExecPlan at docs\/exec-plans\/active\/task\.md\./u);
  assert.match(prompt, /Docker and Docker Compose are available as ordinary host CLI tools/u);
  assert.match(prompt, /Decide whether existing services should be reused, restarted, rebuilt, or removed/u);
  assert.match(prompt, /including logs and cleanup when appropriate/u);
  assert.match(prompt, /Do not assume Agent Relay manages container lifecycle/u);
});

test("repository instructions remain durable and plan-driven", async () => {
  const instructions = await readFile("AGENTS.md", "utf8");
  const rules = await readFile(".agent/PLANS.md", "utf8");
  assert.match(instructions, /TypeScript with strict checking/);
  assert.match(instructions, /code comments in English/);
  assert.doesNotMatch(instructions, /GitHub credentials|Docker socket|Relay state/i);
  assert.match(rules, /Treat the reader as a complete beginner to this repository/);
  assert.match(rules, /ExecPlans are living documents/);
  assert.match(rules, /## Progress/);
  assert.match(rules, /## Decision Log/);
});

test("executor exposes the dedicated Docker socket directory without denying the workspace ancestor", () => {
  assert.deepEqual(createCodexEnvironment("/home/user", "/home/user/.cache/runtime"), {
    HOME: "/home/user",
    CODEX_RUNTIME_ROOT: "/home/user/.cache/runtime",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
  });
  assert.equal(DOCKER_SOCKET_DIRECTORY, "/srv/github-runner/storage/docker-socket");
  const args = createCodexArgs(
    "/runner/_work/repository/repository",
    "task prompt",
    "/home/user",
    "/home/user/.cache/runtime",
    "/srv/github-runner/storage/agent-relay",
  );
  const filesystem = args.find((value) => value.startsWith("permissions.agent.filesystem="));
  assert.ok(filesystem);
  assert.match(filesystem, /"\/home\/user"="deny"/);
  assert.match(filesystem, /"\/srv\/github-runner\/storage\/agent-relay"="deny"/);
  assert.match(filesystem, /"\/opt\/rust"="read"/);
  assert.match(filesystem, /"\/srv\/github-runner\/storage\/docker-socket"="write"/);
  assert.doesNotMatch(filesystem, /docker\.sock"="write"/);
  assert.doesNotMatch(filesystem, /"\/runner\/_work"="deny"/);
  assert.match(filesystem, /"\/runner\/_work\/repository\/repository"="write"/);
  assert.match(filesystem, /"\/runner\/_work\/repository\/repository\/\.git"="read"/);
  assert.ok(args.includes("permissions.agent.network.enabled=true"));
  assert.ok(args.includes("--json"));
  assert.ok(!args.includes("danger-full-access"));
});

test("workflows validate and execute the pull request runtime with strict token scoping", async () => {
  for (const path of workflowPaths) {
    const workflow = await readFile(path, "utf8");
    assert.match(workflow, /runs-on: \[self-hosted\]/);
    assert.doesNotMatch(workflow, /runs-on: \[self-hosted,\s*agent-relay\]/);
    assert.match(workflow, /node \/srv\/github-runner\/storage\/agent-relay\/runner\/resolve-request\.mjs/);
    assert.match(workflow, /node \/srv\/github-runner\/storage\/agent-relay\/runner\/resolve-pr\.mjs/);
    assert.match(workflow, /node \/srv\/github-runner\/storage\/agent-relay\/runner\/resolve-plan\.mjs/);
    assert.match(workflow, /- name: Install pull-request runtime dependencies[\s\S]*run: npm ci/);
    assert.match(workflow, /- name: Build pull-request runtime[\s\S]*run: npm run build/);
    assert.match(workflow, /run: node runner\/run-codex\.mjs/);
    assert.doesNotMatch(workflow, /node \/srv\/github-runner\/storage\/agent-relay\/runner\/run-codex\.mjs/);
    assert.match(workflow, /run: bash runner\/finalize\.sh/);
    assert.doesNotMatch(workflow, /run: \/srv\/github-runner\/storage\/agent-relay\/runner\/finalize\.sh/);
    assert.match(workflow, /CODEX_WORKSPACE_ROOT: \$\{\{ runner\.workspace \}\}/);
    assert.match(workflow, /CODEX_TRANSCRIPT_PATH: \$\{\{ runner\.temp \}\}\/agent-relay-console\.log/);
    assert.doesNotMatch(workflow, /\btee\b/);
    assert.match(workflow, /persist-credentials: false/);
    assert.match(workflow, /GITHUB_PUSH_TOKEN: \$\{\{ github\.token \}\}/);
    assert.match(workflow, /No active ExecPlan was found in this pull request\. Codex execution was skipped\./);
    assert.match(workflow, /- name: Detect missing pull-request ExecPlan[\s\S]*git diff --name-only --diff-filter=AM/);
    assert.match(
      workflow,
      /if: steps\.plan_diff\.outputs\.plan_found == 'false' \|\| steps\.plan\.outputs\.plan_found == 'false'/,
    );
    assert.match(
      workflow,
      /if: \$\{\{ always\(\) && steps\.plan_diff\.outputs\.plan_found != 'false' && steps\.plan\.outputs\.plan_found != 'false' && steps\.plan\.outputs\.plan_path != '' \}\}[\s\S]*actions\/upload-artifact@v4/,
    );
    assert.match(
      workflow,
      /if: \$\{\{ steps\.plan_diff\.outputs\.plan_found != 'false' && steps\.plan\.outputs\.plan_found != 'false' && steps\.plan\.outputs\.plan_path != '' && steps\.codex\.outcome == 'success' \}\}[\s\S]*runner\/finalize\.sh/,
    );
    assert.doesNotMatch(workflow, /AGENT_RELAY_TOKEN|AGENT_RELAY_URL|runner\/client\.mjs/);
    assert.doesNotMatch(workflow, /(?:node|run:)\s+\/runner\//);

    const codexStep = workflow.match(/- name: Run Codex directly([\s\S]*?)(?=\n      - name:)/)?.[1] ?? "";
    assert.match(
      codexStep,
      /plan_diff\.outputs\.plan_found != 'false' && steps\.plan\.outputs\.plan_found != 'false' && steps\.plan\.outputs\.plan_path != ''/,
    );
    assert.doesNotMatch(codexStep, /GITHUB_TOKEN|github\.token/);
  }
});

test("CI uses the organization runner and executes the complete validation", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  assert.match(workflow, /runs-on: \[self-hosted\]/);
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.doesNotMatch(workflow, /agent-relay\]/);
  assert.match(workflow, /actions\/checkout@v4/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /run: npm ci/);
  for (const command of [
    "npm run typecheck",
    "npm test",
    "npm run check:runtime",
    "npm run check:shell",
    "npm run check:node-scripts",
    "npm run check:toolchain",
    "npm run check:system",
  ]) {
    assert.match(workflow, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  }
});

test("active packaging contains no Docker or Relay transport entrypoints", async () => {
  for (const path of [
    "Dockerfile",
    "Dockerfile.runner",
    "compose.yml",
    ".dockerignore",
    ".env.example",
    "runner/client.mjs",
    "runner/entrypoint.sh",
    "src/server.ts",
    "src/api/server.ts",
    "src/application/job-service.ts",
    "src/persistence/job-store.ts",
  ]) {
    await assert.rejects(readFile(path, "utf8"), /ENOENT/);
  }

  const packageJson = await readFile("package.json", "utf8");
  assert.doesNotMatch(packageJson, /install\.sh|install-script\.integration/u);
  assert.match(packageJson, /test-system\/github-connect\.integration\.sh/u);
  assert.match(packageJson, /bash -n runner\/finalize\.sh[\s\S]*scripts\/github-connect/u);
  assert.doesNotMatch(packageJson, /update\.sh|docker-host/u);
});
