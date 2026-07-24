import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

async function text(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await text(path)) as Record<string, unknown>;
}

test("host playbook performs PAT-free deployment directly through Ansible", async () => {
  const deploy = [
    await text("ansible/roles/agent_relay_host/tasks/deploy.yml"),
    await text("ansible/roles/agent_relay_host/tasks/deployment-prepare.yml"),
    await text("ansible/roles/agent_relay_host/tasks/runner-installation.yml"),
    await text("ansible/roles/agent_relay_host/tasks/runtime-deployment.yml"),
    await text("ansible/roles/agent_relay_host/tasks/listener-state.yml"),
  ].join("\n");
  const defaults = await text("ansible/roles/agent_relay_host/defaults/main.yml");
  const hostPlaybook = await text("ansible/playbooks/host.yml");
  const connectionPlaybook = await text("ansible/playbooks/github-connect.yml");
  const connectionTasks = await text("ansible/roles/agent_relay_github_connection/tasks/main.yml");

  assert.doesNotMatch(deploy, /install\.sh|AGENT_RELAY_GITHUB_CREDENTIAL|registration-token|config\.sh --unattended/u);
  assert.doesNotMatch(defaults, /AGENT_RELAY_GITHUB_CREDENTIAL|github_credential|runner_registration/u);
  assert.doesNotMatch(hostPlaybook, /github-connect|agent_relay_github_connection|AGENT_RELAY_GITHUB_CREDENTIAL/u);
  assert.match(connectionPlaybook, /role: agent_relay_github_connection/u);
  assert.doesNotMatch(connectionPlaybook, /import_playbook|role: agent_relay_host/u);
  assert.match(connectionTasks, /- bash\n\s+- "\{\{ agent_relay_source_root \}\}\/scripts\/github-connect"/u);
  assert.doesNotMatch(connectionTasks, /packages\.yml|users\.yml|filesystem\.yml|containers\.yml|toolchains\.yml|deploy\.yml/u);

  assert.match(deploy, /ansible\.builtin\.get_url:[\s\S]*actions-runner-linux-x64/u);
  assert.match(deploy, /ansible\.builtin\.unarchive:/u);
  assert.match(deploy, /src: actions-runner\.service\.j2/u);
  assert.match(deploy, /\/usr\/local\/bin\/tsc/u);
  assert.match(deploy, /await import\(process\.env\.STAGED_ENTRYPOINT\)/u);
  assert.match(deploy, /name: Activate staged runtime atomically/u);
  assert.match(deploy, /name: Restore preserved runtime after failed activation/u);
  assert.match(deploy, /name: Enable and restart registered runner listener/u);
  assert.match(deploy, /name: Keep unregistered runner listener disabled/u);
});

test("host lifecycle uses one credential-free mutual exclusion boundary", async () => {
  const vars = await text("ansible/roles/agent_relay_host/vars/main.yml");
  const main = await text("ansible/roles/agent_relay_host/tasks/main.yml");
  const filesystem = await text("ansible/roles/agent_relay_host/tasks/filesystem.yml");
  const connection = await text("scripts/github-connect");

  assert.match(vars, /agent_relay_lifecycle_root: \/var\/lib\/agent-relay\/lifecycle/u);
  assert.match(vars, /agent_relay_lifecycle_lock: "\{\{ agent_relay_lifecycle_root \}\}\/active"/u);
  assert.match(main, /name: Create Agent Relay lifecycle lock root[\s\S]*owner: root[\s\S]*group: root[\s\S]*mode: "0755"/u);
  assert.match(main, /name: Acquire Agent Relay lifecycle lock/u);
  assert.match(main, /name: Release Agent Relay lifecycle lock/u);
  const lock = main.indexOf("name: Acquire Agent Relay lifecycle lock");
  const packages = main.indexOf("name: Install repositories and host packages");
  const users = main.indexOf("name: Create administrator and service users");
  assert.ok(lock >= 0 && packages > lock && users > lock);
  assert.match(filesystem, /name: Reject unsafe obsolete installer lock/u);
  assert.match(filesystem, /name: Remove obsolete installer lock/u);
  assert.match(connection, /LIFECYCLE_ROOT=\/var\/lib\/agent-relay\/lifecycle/u);
  assert.match(connection, /sudo -n mkdir -- "\$\{LIFECYCLE_LOCK\}"/u);
  assert.match(connection, /sudo -n rmdir -- "\$\{LIFECYCLE_LOCK\}"/u);
  assert.match(connection, /Lifecycle lock root must be root-owned/u);
  assert.match(connection, /Lifecycle lock root must have mode 0755/u);
  assert.doesNotMatch(connection, /install\.lock|flock/u);
});

test("Docker data directories declare the daemon-owned final modes", async () => {
  const filesystem = await text("ansible/roles/agent_relay_host/tasks/filesystem.yml");

  assert.match(filesystem, /agent_relay_storage_root \}\}\/docker", mode: "0711"/u);
  assert.match(filesystem, /agent_relay_docker_root \}\}", mode: "0710"/u);
  assert.match(filesystem, /agent_relay_containerd_root \}\}", mode: "0711"/u);
});

test("runner systemd unit is declarative and contains no credential handling", async () => {
  const unit = await text("ansible/roles/agent_relay_host/templates/actions-runner.service.j2");

  assert.match(unit, /^\[Unit\]/u);
  assert.match(unit, /User=\{\{ agent_relay_runner_user \}\}/u);
  assert.match(unit, /WorkingDirectory=\{\{ agent_relay_runner_root \}\}/u);
  assert.match(unit, /ExecStart=\{\{ agent_relay_runner_root \}\}\/runsvc\.sh/u);
  assert.match(unit, /Restart=always/u);
  assert.doesNotMatch(unit, /token|credential|PAT|Environment=/iu);
});

test("runtime is built in a clean environment and validated before atomic activation", async () => {
  const runtime = await text("ansible/roles/agent_relay_host/tasks/runtime-deployment.yml");
  const deploymentState = await text("ansible/roles/agent_relay_host/tasks/deploy.yml");
  const deploymentPrepare = await text("ansible/roles/agent_relay_host/tasks/deployment-prepare.yml");
  const listener = await text("ansible/roles/agent_relay_host/tasks/listener-state.yml");
  const deploy = `${runtime}\n${listener}`;
  const compile = deploy.indexOf("name: Compile staged Agent Relay runtime");
  const recordRevision = deploy.indexOf("name: Record staged runtime source revision", compile);
  const inspect = deploy.indexOf("name: Inspect staged runtime entrypoint", recordRevision);
  const importStage = deploy.indexOf("name: Import staged runtime entrypoint", inspect);
  const unsafe = deploy.indexOf("name: Detect unsafe staged runtime entries", importStage);
  const finalize = deploy.indexOf("name: Finalize staged runtime ownership", unsafe);
  const verifyFinal = deploy.indexOf("name: Verify finalized runtime tree", finalize);
  const activate = deploy.indexOf("name: Activate staged runtime atomically", verifyFinal);
  const start = deploy.indexOf("name: Enable and restart registered runner listener", activate);

  assert.ok(compile >= 0);
  assert.ok(recordRevision > compile);
  assert.ok(inspect > recordRevision);
  assert.ok(importStage > inspect);
  assert.ok(unsafe > importStage);
  assert.ok(finalize > unsafe);
  assert.ok(verifyFinal > finalize);
  assert.ok(activate > verifyFinal);
  assert.ok(start > activate);
  assert.equal((runtime.match(/- \/usr\/bin\/env\n\s+- -i/gu) ?? []).length, 2);
  assert.match(runtime, /Finalize staged runtime ownership without following links or crossing filesystems[\s\S]*- \/usr\/bin\/find[\s\S]*- -P[\s\S]*- -xdev[\s\S]*- \/usr\/bin\/chown[\s\S]*- -h/u);
  assert.doesNotMatch(runtime, /name: Finalize staged runtime ownership[\s\S]*recurse: true/u);
  assert.match(runtime, /name: Detect unsafe finalized runtime entries/u);
  assert.match(runtime, /content: "\{\{ agent_relay_checkout_result\.after \}\}\\n"/u);
  assert.match(deploymentPrepare, /register: agent_relay_checkout_result/u);
  assert.match(deploymentState, /name: Inspect deployed runtime revision marker/u);
  assert.match(deploymentState, /agent_relay_runtime_revision_matches:/u);
  assert.match(deploymentState, /or not agent_relay_runtime_revision_matches/u);
  assert.match(runtime, /name: Remove safe stale runtime stage without crossing filesystems/u);
  assert.match(runtime, /- --one-file-system/u);
  assert.match(runtime, /name: Remove preserved runtime after successful activation without crossing filesystems/u);
});

test("host contract supplies runner and toolchain versions", async () => {
  const contract = await json("config/runner-host.json");
  const vars = await text("ansible/roles/agent_relay_host/vars/main.yml");
  const runner = await text("ansible/roles/agent_relay_host/tasks/runner-installation.yml");

  assert.equal(contract.runner_version, "2.335.1");
  assert.equal(contract.go_version, "1.24.5");
  assert.equal(contract.typescript_version, "5.8.3");
  assert.equal(contract.codex_version, "0.144.4");
  assert.match(vars, /agent_relay_host_contract:/u);
  assert.match(runner, /agent_relay_host_contract\.runner_version/u);
  assert.match(runner, /agent_relay_host_contract\.runner_sha256/u);
});

test("legacy host installer entrypoints are absent from validation", async () => {
  const pkg = await text("package.json");
  const systemTest = await text("test-system/github-connect.integration.sh");
  const connection = await text("scripts/github-connect");
  const connectionTasks = await text("ansible/roles/agent_relay_github_connection/tasks/main.yml");
  const toolchainMetadata = await stat("scripts/host-toolchain-check.sh");

  assert.doesNotMatch(pkg, /install\.sh|install-script\.integration/u);
  assert.match(pkg, /test-system\/github-connect\.integration\.sh/u);
  assert.match(systemTest, /GitHub connection integration checks passed/u);
  assert.match(connection, /^#!\/usr\/bin\/env bash\n/u);
  assert.match(connectionTasks, /argv:\n\s+- bash\n\s+- "\{\{ agent_relay_source_root \}\}\/scripts\/github-connect"/u);
  assert.notEqual(toolchainMetadata.mode & 0o111, 0);
});
