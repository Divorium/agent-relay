import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path: string): Promise<string> => readFile(path, "utf8");

test("Antigravity opt-in builds image, verifies CLI, and only then advertises capability", async () => {
  const [defaults, deploy, tasks, compose, dockerfile] = await Promise.all([
    read("ansible/roles/agent_relay_host/defaults/main.yml"),
    read("ansible/roles/agent_relay_host/tasks/deploy.yml"),
    read("ansible/roles/agent_relay_host/tasks/antigravity.yml"),
    read("antigravity/docker-compose.yml"),
    read("antigravity/Dockerfile"),
  ]);
  assert.match(defaults, /agent_relay_antigravity_enabled: false/u);
  assert.match(deploy, /import_tasks: antigravity\.yml[\s\S]*import_tasks: listener-state\.yml/u);
  assert.match(tasks, /Build Antigravity sandbox for runner account/u);
  assert.match(tasks, /Verify Antigravity CLI was built into image/u);
  assert.match(tasks, /Mark Antigravity ready only after image validation/u);
  assert.match(tasks, /Remove Antigravity readiness marker/u);
  assert.match(tasks, /Remove Antigravity launcher/u);
  assert.match(compose, /ANTIGRAVITY_SSH_KEY/u);
  assert.match(compose, /ACCOUNT_STATE_DIR/u);
  assert.match(compose, /antigravity-cli\/skills/u);
  assert.doesNotMatch(compose, /docker\.sock|\/home\/divo/u);
  assert.match(dockerfile, /antigravity\.google\/cli\/install\.sh/u);
  assert.match(dockerfile, /SANDBOX_UID/u);
});

test("Runner advertises Antigravity only for a root-owned ready marker and Docker image", async () => {
  const [vars, label] = await Promise.all([
    read("ansible/roles/agent_relay_github_connection/vars/main.yml"),
    read("ansible/roles/agent_relay_github_connection/tasks/runner-label.yml"),
  ]);
  assert.match(vars, /agent_relay_antigravity_root/u);
  assert.match(label, /agent_relay_antigravity_ready\.stat\.isreg/u);
  assert.match(label, /agent_relay_antigravity_image\.rc/u);
  assert.match(label, /reject\('equalto', 'antigravity'\)/u);
  assert.match(label, /labels: "\{\{ agent_relay_effective_runner_labels \}\}"/u);
});

test("Host no longer installs or requires preinstalled Codex", async () => {
  const [toolchains, smoke] = await Promise.all([
    read("ansible/roles/agent_relay_host/tasks/toolchains.yml"),
    read("scripts/toolchain-smoke.sh"),
  ]);
  assert.doesNotMatch(toolchains, /@openai\/codex@latest/u);
  assert.match(toolchains, /npm, uninstall, --global/u);
  assert.doesNotMatch(smoke, /codex/u);
});
