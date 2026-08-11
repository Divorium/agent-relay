import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await text(path)) as Record<string, unknown>;
}

test("host provisioning and GitHub connection remain separate Ansible boundaries", async () => {
  const host = [
    await text("ansible/playbooks/host.yml"),
    await text("ansible/roles/agent_relay_host/tasks/deploy.yml"),
    await text("ansible/roles/agent_relay_host/tasks/runner-installation.yml"),
    await text("ansible/roles/agent_relay_host/tasks/runtime-deployment.yml"),
  ].join("\n");
  const connectionPlaybook = await text("ansible/playbooks/github-connect.yml");
  const connection = await text("ansible/roles/agent_relay_github_connection/tasks/main.yml");

  assert.doesNotMatch(host, /AGENT_RELAY_GITHUB_CREDENTIAL|registration-token|- \.\/config\.sh/u);
  assert.doesNotMatch(connectionPlaybook, /import_playbook|role: agent_relay_host/u);
  assert.match(connection, /ansible\.builtin\.uri:[\s\S]*registration-token/u);
  assert.match(connection, /ansible\.builtin\.command:[\s\S]*- \.\/config\.sh/u);
  assert.doesNotMatch(connection, /scripts\/github-connect/u);
});

test("runner workspace is a real directory inside the runner installation", async () => {
  const vars = await text("ansible/roles/agent_relay_host/vars/main.yml");
  const filesystem = await text("ansible/roles/agent_relay_host/tasks/filesystem.yml");
  const runner = await text("ansible/roles/agent_relay_host/tasks/runner-installation.yml");

  assert.match(vars, /agent_relay_work_root: "\{\{ agent_relay_runner_root \}\}\/_work"/u);
  assert.match(filesystem, /name: Create runner workspace[\s\S]*state: directory[\s\S]*mode: "0700"/u);
  assert.doesNotMatch(runner, /state: link|src: \.\.\/work/u);
});

test("Ansible installs latest Codex without a second host validator", async () => {
  const contract = await json("config/runner-host.json");
  const vars = await text("ansible/roles/agent_relay_host/vars/main.yml");
  const toolchains = await text("ansible/roles/agent_relay_host/tasks/toolchains.yml");
  const deployment = [
    await text("ansible/roles/agent_relay_host/tasks/deploy.yml"),
    await text("ansible/roles/agent_relay_host/tasks/deployment-prepare.yml"),
  ].join("\n");

  assert.equal(contract.codex_version, undefined);
  assert.doesNotMatch(vars, /agent_relay_codex_version/u);
  assert.equal((toolchains.match(/"@openai\/codex@latest"/gu) ?? []).length, 1);
  assert.doesNotMatch(`${toolchains}\n${deployment}`, /host-toolchain-check|EXPECTED_CODEX_VERSION|codex --version|command -v codex/u);
});
