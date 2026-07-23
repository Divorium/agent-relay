import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path: string): Promise<string> {
  return readFile(path, "utf8");
}

test("Ansible separates PAT-free host updates from PAT-gated runner installation", async () => {
  const hostContract = JSON.parse(await text("config/runner-host.json")) as { runner_label: string };
  assert.equal(hostContract.runner_label, "agent-relay");

  const defaults = await text("ansible/roles/agent_relay_host/defaults/main.yml");
  const vars = await text("ansible/roles/agent_relay_host/vars/main.yml");
  const tasks = await text("ansible/roles/agent_relay_host/tasks/main.yml");
  const deployment = await text("ansible/roles/agent_relay_host/tasks/deploy.yml");
  const reconciliation = await text("ansible/roles/agent_relay_host/tasks/runner-label.yml");
  const hostPlaybook = await text("ansible/playbooks/host.yml");
  const installPlaybook = await text("ansible/playbooks/install.yml");

  assert.match(defaults, /agent_relay_manage_runner_lifecycle: false/u);
  assert.match(vars, /agent_relay_runner_label: "\{\{ agent_relay_host_contract\.runner_label \}\}"/u);
  assert.doesNotMatch(hostPlaybook, /AGENT_RELAY_GITHUB_CREDENTIAL|agent_relay_manage_runner_lifecycle:\s*true/u);
  assert.match(
    installPlaybook,
    /ansible\.builtin\.import_playbook: host\.yml[\s\S]*agent_relay_manage_runner_lifecycle: true/u,
  );

  assert.match(tasks, /Require GitHub credential for runner installation lifecycle/u);
  assert.match(tasks, /when: agent_relay_manage_runner_lifecycle \| bool/u);
  assert.match(
    tasks,
    /import_tasks: runner-label\.yml\n\s+when: agent_relay_manage_runner_lifecycle \| bool/u,
  );
  assert.match(deployment, /Require installation playbook for first runner registration/u);
  assert.match(deployment, /First runner registration requires playbooks\/install\.yml/u);
  assert.match(deployment, /agent_relay_manage_runner_lifecycle \| bool/u);
  assert.match(
    deployment,
    /if \(agent_relay_manage_runner_lifecycle \| bool and not agent_relay_registration_complete\)/u,
  );

  assert.match(reconciliation, /actions\/runners\?name=\{\{ agent_relay_host_contract\.runner_name \| urlencode \}\}&per_page=100/u);
  assert.match(reconciliation, /selectattr\('name', 'equalto', agent_relay_host_contract\.runner_name\)/u);
  assert.match(reconciliation, /method: POST/u);
  assert.match(reconciliation, /labels:\n\s+- "\{\{ agent_relay_runner_label \}\}"/u);
  assert.match(reconciliation, /agent_relay_runner_label \| lower in/u);
  assert.doesNotMatch(reconciliation, /method: PUT/u);
});
