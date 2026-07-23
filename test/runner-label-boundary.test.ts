import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path: string): Promise<string> {
  return readFile(path, "utf8");
}

test("Ansible keeps host provisioning disjoint from GitHub connection", async () => {
  const hostContract = JSON.parse(await text("config/runner-host.json")) as { runner_label: string };
  assert.equal(hostContract.runner_label, "agent-relay");

  const hostDefaults = await text("ansible/roles/agent_relay_host/defaults/main.yml");
  const hostTasks = await text("ansible/roles/agent_relay_host/tasks/main.yml");
  const deployment = await text("ansible/roles/agent_relay_host/tasks/deploy.yml");
  const hostPlaybook = await text("ansible/playbooks/host.yml");
  const connectionPlaybook = await text("ansible/playbooks/github-connect.yml");
  const connectionDefaults = await text("ansible/roles/agent_relay_github_connection/defaults/main.yml");
  const connectionTasks = await text("ansible/roles/agent_relay_github_connection/tasks/main.yml");
  const reconciliation = await text("ansible/roles/agent_relay_github_connection/tasks/runner-label.yml");

  assert.doesNotMatch(hostDefaults, /AGENT_RELAY_GITHUB_CREDENTIAL|agent_relay_manage_runner_lifecycle/u);
  assert.doesNotMatch(hostTasks, /runner-label|GitHub credential|github_connection/u);
  assert.doesNotMatch(hostPlaybook, /github-connect|agent_relay_github_connection|AGENT_RELAY_GITHUB_CREDENTIAL/u);
  assert.doesNotMatch(deployment, /agent_relay_github_credential|registration-token|playbooks\/github-connect\.yml/u);
  assert.match(deployment, /Install or update the complete Agent Relay host runtime/u);

  assert.match(connectionPlaybook, /role: agent_relay_github_connection/u);
  assert.doesNotMatch(connectionPlaybook, /import_playbook|role: agent_relay_host/u);
  assert.match(connectionDefaults, /AGENT_RELAY_GITHUB_CREDENTIAL/u);
  assert.match(connectionTasks, /Require GitHub credential for runner connection/u);
  assert.match(connectionTasks, /scripts\/github-connect/u);
  assert.match(connectionTasks, /import_tasks: runner-label\.yml/u);
  assert.doesNotMatch(connectionTasks, /packages\.yml|users\.yml|filesystem\.yml|containers\.yml|toolchains\.yml|deploy\.yml/u);

  assert.match(reconciliation, /actions\/runners\?name=\{\{ agent_relay_host_contract\.runner_name \| urlencode \}\}&per_page=100/u);
  assert.match(reconciliation, /selectattr\('name', 'equalto', agent_relay_host_contract\.runner_name\)/u);
  assert.match(reconciliation, /method: POST/u);
  assert.match(reconciliation, /labels:\n\s+- "\{\{ agent_relay_runner_label \}\}"/u);
  assert.match(reconciliation, /agent_relay_runner_label \| lower in/u);
  assert.doesNotMatch(reconciliation, /method: PUT/u);
});
