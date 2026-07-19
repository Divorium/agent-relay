import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildCodexPrompt } from "../src/execution/prompt.js";
import { createCodexArgs, createCodexEnvironment } from "../src/execution/codex-executor.js";

const workflowPaths = [
  ".github/workflows/codex.yml",
  "examples/github-actions/codex.yml",
];

test("runtime prompt contains only plan-rules and active-plan pointers", () => {
  assert.equal(
    buildCodexPrompt("docs/exec-plans/active/task.md"),
    "Follow .agent/PLANS.md and execute the active ExecPlan at docs/exec-plans/active/task.md.",
  );
});

test("repository instructions remain durable and plan-driven", async () => {
  const instructions = await readFile("AGENTS.md", "utf8");
  const rules = await readFile(".agent/PLANS.md", "utf8");
  assert.match(instructions, /TypeScript with strict checking/);
  assert.match(instructions, /code comments in English/);
  assert.doesNotMatch(instructions, /GitHub credentials|Docker socket|Relay state/i);
  assert.match(rules, /explicitly selected file under `docs\/exec-plans\/active\/` is a task instruction/);
  assert.match(rules, /completed\/` are historical records; do not follow them as instructions/);
  assert.match(rules, /prefix it with `\[blocked\]`/);
  assert.match(rules, /cause, impact, evidence, and concrete unblock condition/);
});

test("executor exposes only native launcher context without denying the workspace ancestor", () => {
  assert.deepEqual(createCodexEnvironment("/home/user", "/home/user/.cache/runtime"), {
    HOME: "/home/user",
    CODEX_RUNTIME_ROOT: "/home/user/.cache/runtime",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
  });
  const args = createCodexArgs(
    "/runner/_work/repository/repository",
    "task prompt",
    "/runner/_work",
    "/home/user",
    "/home/user/.cache/runtime",
    "/srv/github-runner/storage/agent-relay",
  );
  const filesystem = args.find((value) => value.startsWith("permissions.agent.filesystem="));
  assert.ok(filesystem);
  assert.match(filesystem, /"\/home\/user"="deny"/);
  assert.match(filesystem, /"\/srv\/github-runner\/storage\/agent-relay"="deny"/);
  assert.match(filesystem, /"\/opt\/rust"="read"/);
  assert.doesNotMatch(filesystem, /"\/runner\/_work"="deny"/);
  assert.match(filesystem, /"\/runner\/_work\/repository\/repository"="write"/);
  assert.match(filesystem, /"\/runner\/_work\/repository\/repository\/\.git"="read"/);
  assert.ok(args.includes("permissions.agent.network.enabled=true"));
  assert.ok(!args.includes("danger-full-access"));
});

test("workflows use installed direct execution and strict token scoping", async () => {
  for (const path of workflowPaths) {
    const workflow = await readFile(path, "utf8");
    assert.match(workflow, /runs-on: \[self-hosted\]/);
    assert.doesNotMatch(workflow, /runs-on: \[self-hosted,\s*agent-relay\]/);
    assert.match(workflow, /node \/srv\/github-runner\/storage\/agent-relay\/runner\/resolve-request\.mjs/);
    assert.match(workflow, /node \/srv\/github-runner\/storage\/agent-relay\/runner\/resolve-pr\.mjs/);
    assert.match(workflow, /node \/srv\/github-runner\/storage\/agent-relay\/runner\/resolve-plan\.mjs/);
    assert.match(workflow, /node \/srv\/github-runner\/storage\/agent-relay\/runner\/run-codex\.mjs/);
    assert.match(workflow, /run: \/srv\/github-runner\/storage\/agent-relay\/runner\/finalize\.sh/);
    assert.match(workflow, /CODEX_WORKSPACE_ROOT: \$\{\{ runner\.workspace \}\}/);
    assert.match(workflow, /persist-credentials: false/);
    assert.match(workflow, /GITHUB_PUSH_TOKEN: \$\{\{ github\.token \}\}/);
    assert.match(workflow, /if: always\(\)[\s\S]*actions\/upload-artifact@v4/);
    assert.doesNotMatch(workflow, /AGENT_RELAY_TOKEN|AGENT_RELAY_URL|runner\/client\.mjs/);
    assert.doesNotMatch(workflow, /(?:node|run:)\s+\/runner\//);

    const codexStep = workflow.match(/- name: Run Codex directly([\s\S]*?)(?=\n      - name:)/)?.[1] ?? "";
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
  assert.match(workflow, /run: npm run check/);
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
  assert.doesNotMatch(packageJson, /dist\/src\/server\.js|runner-entrypoint/);
  assert.match(packageJson, /bash -n install\.sh update\.sh/);
});
