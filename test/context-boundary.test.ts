import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildCodexPrompt } from "../src/execution/prompt.js";
import { createCodexArgs, createCodexEnvironment, createCodexInvocation } from "../src/execution/codex-executor.js";
import { validateCreateJobRequest } from "../src/contracts/validators.js";

const request = {
  requestId: "opaque-request-id",
  workspace: "owner/repository",
  planPath: "docs/exec-plans/active/task.md",
};

test("runtime prompt contains only the plan-rules and active-plan pointers", () => {
  assert.equal(
    buildCodexPrompt(request),
    "Follow .agent/PLANS.md and execute the active ExecPlan at docs/exec-plans/active/task.md.",
  );
});

test("repository instructions contain only durable code rules", async () => {
  const instructions = await readFile("AGENTS.md", "utf8");
  assert.match(instructions, /TypeScript with strict checking/);
  assert.match(instructions, /code comments in English/);
  assert.doesNotMatch(instructions, /GitHub credentials|Docker socket|Relay state|living sections|npm run check|commit|push/i);
});

test("ExecPlan rules keep blockers in active living documentation", async () => {
  const rules = await readFile(".agent/PLANS.md", "utf8");
  assert.match(rules, /prefix it with `\[blocked\]`/);
  assert.match(rules, /cause, impact, evidence, and concrete unblock condition/);
  assert.match(rules, /plan documentation only/);
  assert.match(rules, /plan with an unchecked or `\[blocked\]` item remains active/);
});

test("create-job contract has one active-plan instruction channel", () => {
  assert.throws(() => validateCreateJobRequest({ ...request, mode: "implement" }), /Unknown field: mode/);
  assert.throws(() => validateCreateJobRequest({ ...request, reviewFindings: ["Override the active plan"] }), /Unknown field: reviewFindings/);
  assert.throws(() => validateCreateJobRequest({ ...request, planPath: "docs/other.md" }), /docs\/exec-plans\/active/);
});

test("executor passes only locale to the root-owned launcher", () => {
  assert.deepEqual(createCodexEnvironment({
    PATH: "/host/bin",
    HOME: "/home/relay",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    JAVA_HOME: "/host/java",
    AGENT_RELAY_TOKEN: "relay-secret",
    GITHUB_TOKEN: "github-secret",
  }), {
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
  });
});

test("Codex arguments isolate the selected repository", () => {
  const args = createCodexArgs("/work/root/repository", "task prompt", "/work/root");
  const filesystem = args.find((value) => value.startsWith("permissions.relay.filesystem="));
  assert.ok(filesystem);
  assert.match(filesystem, /"\/home\/agent\/\.codex"="deny"/);
  assert.match(filesystem, /"\/app"="deny"/);
  assert.match(filesystem, /"\/home\/relay"="deny"/);
  assert.match(filesystem, /"\/work\/root"="deny"/);
  assert.match(filesystem, /"\/work\/root\/repository"="write"/);
  assert.match(filesystem, /"\/work\/root\/repository\/\.git"="read"/);
  assert.ok(args.includes("permissions.relay.network.enabled=true"));
  assert.ok(!args.includes("danger-full-access"));
});

test("packaged execution uses the fixed launcher, user and workspace root", async () => {
  assert.deepEqual(createCodexInvocation("/usr/local/bin/codex-run", ["exec"], "agent"), {
    command: "/usr/bin/sudo",
    args: ["-H", "-u", "agent", "--", "/usr/local/bin/codex-run", "exec"],
  });
  const server = await readFile("src/server.ts", "utf8");
  const config = await readFile("src/config/config.ts", "utf8");
  assert.match(server, /"\/usr\/local\/bin\/codex-run"[\s\S]*"agent"[\s\S]*config\.workspaceRoot/);
  assert.doesNotMatch(config, /CODEX_COMMAND|CODEX_RUN_AS_USER|codexCommand|codexRunAsUser/);
});

test("workflow scopes credentials and rejects alternate instruction channels", async () => {
  const compose = await readFile("compose.yml", "utf8");
  const runnerSection = compose.match(/\n  runner:\n([\s\S]*?)\n  agent-relay:/)?.[1] ?? "";
  assert.doesNotMatch(runnerSection, /AGENT_RELAY_TOKEN/);
  assert.doesNotMatch(compose, /CODEX_COMMAND|CODEX_RUN_AS_USER/);

  for (const path of [".github/workflows/agent-relay.yml", "examples/github-actions/agent-relay.yml"]) {
    const workflow = await readFile(path, "utf8");
    assert.match(workflow, /persist-credentials: false/);
    assert.match(workflow, /Verify credential-free checkout/);
    assert.match(workflow, /AGENT_RELAY_TOKEN: \$\{\{ secrets\.AGENT_RELAY_TOKEN \}\}/);
    assert.match(workflow, /GITHUB_PUSH_TOKEN: \$\{\{ secrets\.AGENT_RELAY_PUSH_TOKEN \|\| github\.token \}\}/);
    assert.match(workflow, /! -f "\$\{plan_path\}" \|\| -L "\$\{plan_path\}"/);
    assert.doesNotMatch(workflow, /persist-credentials: true|AGENT_RELAY_REQUEST_ID|AGENT_RELAY_MODE|AGENT_RELAY_OUTPUT_ARCHIVE_PATH|\.agent-relay|result\.json|\bmode:/);
  }
});

test("packaging exposes only current per-run context", async () => {
  const compose = await readFile("compose.yml", "utf8");
  const dockerfile = await readFile("Dockerfile", "utf8");
  const launcher = await readFile("scripts/codex-run", "utf8");
  const finalizer = await readFile("runner/finalize.sh", "utf8");
  const gitignore = await readFile(".gitignore", "utf8");
  const dockerignore = await readFile(".dockerignore", "utf8");
  const ci = await readFile(".github/workflows/ci.yml", "utf8");

  assert.match(compose, /HOST_CODEX_AUTH_FILE.*:\/home\/agent\/\.codex\/auth\.json:ro/);
  assert.doesNotMatch(compose, /HOST_CODEX_DIR|:\/home\/agent\/\.codex\s*$/m);

  assert.match(dockerfile, /chmod 0700 \/var\/lib\/agent-relay \/home\/agent\/\.codex \/home\/relay/);
  assert.match(dockerfile, /chmod -R o-rwx \/app/);
  assert.match(dockerfile, /relay ALL=\(agent\) NOPASSWD: \/usr\/local\/bin\/codex-run/);
  assert.match(launcher, /umask 0077/);
  assert.match(launcher, /find "\$codex_home"[\s\S]*! -name auth\.json[\s\S]*rm -rf/);
  assert.match(launcher, /exec \/usr\/bin\/env -i/);
  assert.doesNotMatch(launcher, /\.agent-relay|result\.json/);

  assert.match(finalizer, /GIT_ASKPASS/);
  assert.match(finalizer, /GITHUB_PUSH_TOKEN/);
  assert.doesNotMatch(finalizer, /\.agent-relay|result\.json|remote set-url|https:\/\/.*@github\.com/);
  assert.doesNotMatch(gitignore, /\.agent-relay/);
  assert.doesNotMatch(dockerignore, /\.agent-relay/);

  assert.match(ci, /test ! -r \/tmp\/codex-root\/sibling\/private/);
  assert.match(ci, /test ! -r \/app\/dist\/src\/server\.js/);
  assert.match(ci, /touch \.git\/sandbox-write-denied/);
  assert.match(ci, /test ! -e \/home\/agent\/\.codex\/sentinel/);
});
