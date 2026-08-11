import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

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
  await assert.rejects(stat("scripts/github-connect"), { code: "ENOENT" });
});

test("playbooks contain no repository-specific concurrency framework", async () => {
  const host = await text("ansible/roles/agent_relay_host/tasks/main.yml");
  const connection = await text("ansible/roles/agent_relay_github_connection/tasks/main.yml");

  for (const tasks of [host, connection]) {
    assert.doesNotMatch(tasks, /lifecycle lock|agent_relay_lifecycle|\/usr\/bin\/mkdir/u);
  }
});

test("runner workspace is a real directory inside the runner installation", async () => {
  const vars = await text("ansible/roles/agent_relay_host/vars/main.yml");
  const filesystem = await text("ansible/roles/agent_relay_host/tasks/filesystem.yml");
  const runner = await text("ansible/roles/agent_relay_host/tasks/runner-installation.yml");

  assert.match(vars, /agent_relay_work_root: "\{\{ agent_relay_runner_root \}\}\/_work"/u);
  assert.match(filesystem, /name: Create runner workspace[\s\S]*state: directory[\s\S]*mode: "0700"/u);
  assert.doesNotMatch(runner, /state: link|src: \.\.\/work/u);
});

test("container configuration uses handlers instead of manual changed-state branching", async () => {
  const containers = await text("ansible/roles/agent_relay_host/tasks/containers.yml");
  const handlers = await text("ansible/roles/agent_relay_host/handlers/main.yml");

  assert.equal((containers.match(/notify: Reconfigure container services/gu) ?? []).length, 3);
  assert.match(containers, /ansible\.builtin\.meta: flush_handlers/u);
  assert.doesNotMatch(containers, /register: agent_relay_(docker|containerd)/u);
  assert.doesNotMatch(containers, /'restarted' if/u);
  assert.equal((handlers.match(/listen: Reconfigure container services/gu) ?? []).length, 4);
});

test("deployment uses module results and task-local conditions", async () => {
  const deploy = await text("ansible/roles/agent_relay_host/tasks/deploy.yml");
  const prepare = await text("ansible/roles/agent_relay_host/tasks/deployment-prepare.yml");
  const filesystem = await text("ansible/roles/agent_relay_host/tasks/filesystem.yml");

  assert.match(deploy, /register: agent_relay_checkout_result/u);
  assert.match(deploy, /agent_relay_runner_install_required:/u);
  assert.match(deploy, /agent_relay_runtime_deployment_required:/u);
  assert.doesNotMatch(deploy, /check_mode: true|checkout_preview|agent_relay_deployment_required:/u);
  assert.doesNotMatch(prepare, /host-toolchain-check|docker info|EXPECTED_/u);
  assert.doesNotMatch(filesystem, /obsolete installer lock|install\.lock|flock/u);
});

test("runtime remains cleanly built and atomically activated", async () => {
  const runtime = await text("ansible/roles/agent_relay_host/tasks/runtime-deployment.yml");

  assert.match(runtime, /- \/usr\/bin\/env\n\s+- -i/u);
  assert.match(runtime, /name: Import staged runtime entrypoint/u);
  assert.match(runtime, /name: Activate staged runtime/u);
  assert.match(runtime, /name: Restore preserved runtime after failed activation/u);
  assert.match(runtime, /agent_relay_checkout_result\.after/u);
});

test("Ansible installs latest Codex without a second host validator", async () => {
  const contract = await json("config/runner-host.json");
  const vars = await text("ansible/roles/agent_relay_host/vars/main.yml");
  const toolchains = await text("ansible/roles/agent_relay_host/tasks/toolchains.yml");

  assert.equal(contract.codex_version, undefined);
  assert.doesNotMatch(vars, /agent_relay_codex_version/u);
  assert.match(toolchains, /name: Install latest Codex CLI[\s\S]*"@openai\/codex@latest"/u);
  await assert.rejects(stat("scripts/host-toolchain-check.sh"), { code: "ENOENT" });
});

test("host contract pins runner and build toolchains", async () => {
  const contract = await json("config/runner-host.json") as {
    runner_version: string;
    rust_toolchain: string;
    rust_targets: string[];
  };
  const deploy = await text("ansible/roles/agent_relay_host/tasks/deploy.yml");
  const toolchains = await text("ansible/roles/agent_relay_host/tasks/toolchains.yml");

  assert.match(contract.runner_version, /^\d+\.\d+\.\d+$/u);
  assert.match(contract.rust_toolchain, /^\d+\.\d+\.\d+$/u);
  assert.ok(contract.rust_targets.includes("wasm32-unknown-unknown"));
  assert.match(deploy, /name: Read installed runner version[\s\S]*Runner\.Listener[\s\S]*--version/u);
  assert.match(toolchains, /rustup", "target", "list", "--installed"/u);
  assert.match(toolchains, /when: item not in agent_relay_rust_targets_installed\.stdout_lines/u);
});
