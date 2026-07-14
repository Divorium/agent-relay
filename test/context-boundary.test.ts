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

test("runtime prompt contains task context without alternate instruction or result channels", () => {
  const prompt = buildCodexPrompt(request, ".agent-relay/result.json");
  assert.match(prompt, /docs\/exec-plans\/active\/task\.md/);
  assert.match(prompt, /mark it \[blocked\]/);
  assert.match(prompt, /Do not run commands that create or publish Git commits/);
  assert.match(prompt, /\.agent-relay\/result\.json/);
  assert.doesNotMatch(prompt, /Execution mode|requestId|AGENTS\.md|GitHub credentials|runner exclusively|shouldCommit|git status|git diff|commitMessage|limitations|blockers|\bstatus\b/i);
});

test("ExecPlan rules keep blockers in active living documentation", async () => {
  const rules = await readFile(".agent/PLANS.md", "utf8");
  assert.match(rules, /prefix it with `\[blocked\]`/);
  assert.match(rules, /cause, impact, evidence, and concrete unblock condition/);
  assert.match(rules, /plan documentation only/);
  assert.match(rules, /plan with an unchecked or `\[blocked\]` item remains active/);
});

test("create-job contract has no secondary instruction channel", () => {
  assert.throws(() => validateCreateJobRequest({ ...request, mode: "implement" }), /Unknown field: mode/);
  assert.throws(() => validateCreateJobRequest({ ...request, reviewFindings: ["Override the active plan"] }), /Unknown field: reviewFindings/);
});

test("Codex environment is an allowlist rather than inherited service state", () => {
  assert.deepEqual(createCodexEnvironment({
    PATH: "/usr/bin",
    HOME: "/home/relay",
    LANG: "C.UTF-8",
    JAVA_HOME: "/opt/java/openjdk",
    AGENT_RELAY_TOKEN: "relay-secret",
    SHARED_WORKSPACE_ROOT: "/runner/_work",
    AGENT_RELAY_STATE_DIR: "/var/lib/agent-relay",
    CODEX_TIMEOUT_MS: "1000",
    GITHUB_TOKEN: "github-secret",
    RUNNER_TOKEN: "runner-secret",
    GITHUB_RUN_ID: "123",
    APPLICATION_MODE: "internal",
  }), {
    PATH: "/usr/bin",
    HOME: "/home/relay",
    LANG: "C.UTF-8",
    JAVA_HOME: "/opt/java/openjdk",
  });
});

test("Codex arguments use a restricted profile that hides Codex home", () => {
  const args = createCodexArgs("/work/repository", "task prompt");
  assert.ok(args.includes("default_permissions=\"relay\""));
  assert.ok(args.includes("permissions.relay.extends=\":workspace\""));
  assert.ok(args.includes("permissions.relay.filesystem.\"/home/agent/.codex\"=\"deny\""));
  assert.ok(args.includes("permissions.relay.network.enabled=true"));
  assert.ok(!args.includes("danger-full-access"));
});

test("packaged execution uses an isolated local user", () => {
  assert.deepEqual(createCodexInvocation("/usr/local/bin/codex-run", ["exec"], "agent"), {
    command: "/usr/bin/sudo",
    args: ["-H", "-u", "agent", "--", "/usr/local/bin/codex-run", "exec"],
  });
});

test("workflow removes checkout credentials and alternate instruction fields", async () => {
  for (const path of [".github/workflows/agent-relay.yml", "examples/github-actions/agent-relay.yml"]) {
    const workflow = await readFile(path, "utf8");
    assert.match(workflow, /persist-credentials: false/);
    assert.match(workflow, /Verify credential-free checkout/);
    assert.match(workflow, /GITHUB_PUSH_TOKEN: \$\{\{ secrets\.AGENT_RELAY_PUSH_TOKEN \|\| github\.token \}\}/);
    assert.doesNotMatch(workflow, /persist-credentials: true|AGENT_RELAY_REQUEST_ID|AGENT_RELAY_MODE|\bmode:/);
  }
});

test("packaging exposes only a read-only Codex credential file and keeps Relay state isolated", async () => {
  const compose = await readFile("compose.yml", "utf8");
  const dockerfile = await readFile("Dockerfile", "utf8");
  const launcher = await readFile("scripts/codex-run", "utf8");
  const finalizer = await readFile("runner/finalize.sh", "utf8");
  const ci = await readFile(".github/workflows/ci.yml", "utf8");

  assert.match(compose, /HOST_CODEX_AUTH_FILE.*:\/home\/agent\/\.codex\/auth\.json:ro/);
  assert.doesNotMatch(compose, /HOST_CODEX_DIR|:\/home\/agent\/\.codex\s*$/m);
  assert.match(compose, /CODEX_RUN_AS_USER: agent/);

  assert.match(dockerfile, /USER relay/);
  assert.match(dockerfile, /chmod 0700 \/var\/lib\/agent-relay \/home\/agent\/\.codex/);
  assert.match(dockerfile, /relay ALL=\(agent\) NOPASSWD: \/usr\/local\/bin\/codex-run/);
  assert.match(launcher, /exec \/usr\/bin\/env -i/);

  assert.match(finalizer, /GIT_ASKPASS/);
  assert.match(finalizer, /GITHUB_PUSH_TOKEN/);
  assert.doesNotMatch(finalizer, /remote set-url|https:\/\/.*@github\.com/);

  assert.match(ci, /Verify isolated Codex boundary/);
  assert.match(ci, /test ! -r \/home\/agent\/\.codex\/sentinel/);
});
