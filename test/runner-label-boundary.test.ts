import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path: string): Promise<string> {
  return readFile(path, "utf8");
}

test("Ansible keeps host provisioning disjoint from GitHub connection", async () => {
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

  assert.match(reconciliation, /\/actions\/runners\?name=/u);
  assert.match(reconciliation, /agent_relay_runner_name \| urlencode/u);
  assert.doesNotMatch(reconciliation, /agent_relay_host_contract\.runner_name \| urlencode/u);
  assert.match(reconciliation, /&per_page=100/u);
  assert.match(reconciliation, /agent_relay_runner_inventory\.json\.total_count == 1/u);
  assert.match(reconciliation, /agent_relay_runner_inventory\.json\.runners \| length == 1/u);
  assert.match(reconciliation, /agent_relay_runner_inventory\.json\.runners\[0\]\.name == agent_relay_runner_name/u);
  assert.match(reconciliation, /agent_relay_runner_inventory\.json\.runners\[0\]\.id/u);
  assert.match(reconciliation, /method: PUT/u);
  assert.doesNotMatch(reconciliation, /method: POST/u);
  assert.match(reconciliation, /selectattr\('type', 'equalto', 'custom'\)/u);
  assert.match(reconciliation, /unique\(case_sensitive=false\)/u);
  assert.match(reconciliation, /labels: "\{\{ agent_relay_runner_effective_labels \}\}"/u);
  assert.match(reconciliation, /agent_relay_runner_current_custom_labels != agent_relay_runner_desired_custom_labels/u);
});

test("Ansible validates public role inputs through argument specifications", async () => {
  const hostContract = JSON.parse(await text("config/runner-host.json")) as Record<string, unknown>;
  const connectionSpec = await text("ansible/roles/agent_relay_github_connection/meta/argument_specs.yml");
  const hostSpec = await text("ansible/roles/agent_relay_host/meta/argument_specs.yml");
  const connectionVars = await text("ansible/roles/agent_relay_github_connection/vars/main.yml");
  const connectionTasks = await text("ansible/roles/agent_relay_github_connection/tasks/main.yml");
  const hostTasks = await text("ansible/roles/agent_relay_host/tasks/main.yml");

  assert.equal(hostContract.runner_label, undefined);
  assert.match(connectionSpec, /agent_relay_github_credential:\n\s+type: str/u);
  assert.match(connectionSpec, /agent_relay_runner_labels:\n\s+type: list\n\s+elements: str\n\s+required: true/u);
  assert.doesNotMatch(connectionVars, /agent_relay_runner_labels/u);
  assert.doesNotMatch(connectionTasks, /Require valid runner labels|agent_relay_runner_labels \| length > 0|map\('trim'\)/u);

  assert.match(hostSpec, /agent_relay_admin_user:\n\s+type: str/u);
  assert.match(hostSpec, /agent_relay_admin_authorized_keys:\n\s+type: list\n\s+elements: str/u);
  assert.match(hostSpec, /agent_relay_extra_apt_packages:\n\s+type: list\n\s+elements: str/u);
  assert.match(hostSpec, /agent_relay_repository_url:\n\s+type: str/u);
  assert.match(hostSpec, /agent_relay_repository_version:\n\s+type: str/u);
  assert.doesNotMatch(hostTasks, /agent_relay_admin_authorized_keys is sequence|agent_relay_extra_apt_packages is sequence|item is string/u);
});

test("Ansible registers each host with its inventory hostname", async () => {
  const hostVars = await text("ansible/roles/agent_relay_host/vars/main.yml");
  const connectionVars = await text("ansible/roles/agent_relay_github_connection/vars/main.yml");
  const connectionTasks = await text("ansible/roles/agent_relay_github_connection/tasks/main.yml");
  const service = await text("ansible/roles/agent_relay_host/templates/actions-runner.service.j2");

  for (const vars of [hostVars, connectionVars]) {
    assert.match(vars, /agent_relay_runner_name: "\{\{ inventory_hostname \}\}"/u);
  }

  assert.match(
    hostVars,
    /agent_relay_service_name: "actions\.runner\.\{\{ agent_relay_host_contract\.organization \}\}\.\{\{ agent_relay_host_contract\.runner_name \}\}\.service"/u,
  );
  assert.match(service, /Description=GitHub Actions Runner \(\{\{ agent_relay_host_contract\.organization \}\}\.\{\{ agent_relay_runner_name \}\}\)/u);
  assert.match(connectionTasks, /- --name\n\s+- "\{\{ agent_relay_runner_name \}\}"/u);
  assert.match(connectionTasks, /creates: "\{\{ agent_relay_runner_root \}\}\/\.runner"/u);
  assert.doesNotMatch(connectionTasks, /ansible\.builtin\.slurp|agentName|legacy shared|mismatched runner|method: DELETE/u);
});
