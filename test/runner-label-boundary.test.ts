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
  const deployment = [
    await text("ansible/roles/agent_relay_host/tasks/deploy.yml"),
    await text("ansible/roles/agent_relay_host/tasks/deployment-prepare.yml"),
    await text("ansible/roles/agent_relay_host/tasks/runner-installation.yml"),
    await text("ansible/roles/agent_relay_host/tasks/runtime-deployment.yml"),
    await text("ansible/roles/agent_relay_host/tasks/listener-state.yml"),
  ].join("\n");
  const hostPlaybook = await text("ansible/playbooks/host.yml");
  const connectionPlaybook = await text("ansible/playbooks/github-connect.yml");
  const connectionDefaults = await text("ansible/roles/agent_relay_github_connection/defaults/main.yml");
  const connectionTasks = await text("ansible/roles/agent_relay_github_connection/tasks/main.yml");
  const reconciliation = await text("ansible/roles/agent_relay_github_connection/tasks/runner-label.yml");

  assert.doesNotMatch(hostDefaults, /AGENT_RELAY_GITHUB_CREDENTIAL|agent_relay_manage_runner_lifecycle/u);
  assert.doesNotMatch(hostTasks, /runner-label|GitHub credential|github_connection/u);
  assert.doesNotMatch(hostPlaybook, /github-connect|agent_relay_github_connection|AGENT_RELAY_GITHUB_CREDENTIAL/u);
  assert.doesNotMatch(deployment, /install\.sh|agent_relay_github_credential|registration-token|config\.sh --unattended|playbooks\/github-connect\.yml/u);
  assert.match(deployment, /ansible\.builtin\.get_url:/u);

  assert.match(connectionPlaybook, /role: agent_relay_github_connection/u);
  assert.doesNotMatch(connectionPlaybook, /import_playbook|role: agent_relay_host/u);
  assert.match(connectionDefaults, /AGENT_RELAY_GITHUB_CREDENTIAL/u);
  assert.match(connectionTasks, /- \.\/config\.sh/u);
  assert.doesNotMatch(connectionTasks, /scripts\/github-connect/u);
  assert.match(connectionTasks, /import_tasks: runner-label\.yml/u);
  assert.doesNotMatch(connectionTasks, /packages\.yml|users\.yml|filesystem\.yml|containers\.yml|toolchains\.yml|deploy\.yml/u);

  assert.match(reconciliation, /actions\/runners\?name=\{\{ agent_relay_host_contract\.runner_name \| urlencode \}\}&per_page=100/u);
  assert.match(reconciliation, /agent_relay_runner_inventory\.json\.total_count == 1/u);
  assert.match(reconciliation, /agent_relay_runner_inventory\.json\.runners \| length == 1/u);
  assert.match(reconciliation, /agent_relay_runner_inventory\.json\.runners\[0\]\.id/u);
  assert.match(reconciliation, /method: POST/u);
  assert.match(reconciliation, /labels:\n\s+- "\{\{ agent_relay_runner_label \}\}"/u);
  assert.match(reconciliation, /agent_relay_runner_label \| lower not in/u);
  assert.doesNotMatch(reconciliation, /method: PUT|selectattr/u);
});
