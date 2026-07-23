import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path: string): Promise<string> {
  return readFile(path, "utf8");
}

test("Ansible owns one deterministic Agent Relay runner label", async () => {
  const hostContract = JSON.parse(await text("config/runner-host.json")) as { runner_label: string };
  assert.equal(hostContract.runner_label, "agent-relay");

  const vars = await text("ansible/roles/agent_relay_host/vars/main.yml");
  const tasks = await text("ansible/roles/agent_relay_host/tasks/main.yml");
  const reconciliation = await text("ansible/roles/agent_relay_host/tasks/runner-label.yml");

  assert.match(vars, /agent_relay_runner_label: "\{\{ agent_relay_host_contract\.runner_label \}\}"/u);
  assert.match(tasks, /Require GitHub credential for runner lifecycle/u);
  assert.match(tasks, /Self-hosted runners: write permission/u);
  assert.match(tasks, /import_tasks: runner-label\.yml/u);
  assert.match(reconciliation, /actions\/runners\?per_page=100/u);
  assert.match(reconciliation, /selectattr\('name', 'equalto', agent_relay_host_contract\.runner_name\)/u);
  assert.match(reconciliation, /method: POST/u);
  assert.match(reconciliation, /labels:\n\s+- "\{\{ agent_relay_runner_label \}\}"/u);
  assert.match(reconciliation, /agent_relay_runner_label \| lower in/u);
  assert.doesNotMatch(reconciliation, /method: PUT/u);
});
