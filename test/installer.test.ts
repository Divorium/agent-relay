import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

async function text(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await text(path)) as Record<string, unknown>;
}

test("host and GitHub connection scripts are executable", async () => {
  for (const path of ["scripts/host-toolchain-check.sh", "scripts/github-connect"]) {
    const metadata = await stat(path);
    assert.notEqual(metadata.mode & 0o111, 0);
  }
});

test("installer validates protected directories through sudo", async () => {
  const install = await text("install.sh");
  const start = install.indexOf("require_directory() {");
  const end = install.indexOf("\n}\n\nrequire_locked_account()", start);
  assert.ok(start >= 0 && end > start);
  const implementation = install.slice(start, end);

  assert.match(implementation, /sudo -n test -d "\$\{path\}"/);
  assert.match(implementation, /sudo -n test -L "\$\{path\}"/);
  assert.match(implementation, /sudo_stat_uid/);
  assert.match(implementation, /sudo_stat_gid/);
  assert.match(implementation, /sudo_stat_mode/);
  assert.doesNotMatch(implementation, /\[\[ -d "\$\{path\}"/);
});

test("Ansible owns host installation without GitHub lifecycle overlap", async () => {
  const users = await text("ansible/roles/agent_relay_host/tasks/users.yml");
  const filesystem = await text("ansible/roles/agent_relay_host/tasks/filesystem.yml");
  const deploy = await text("ansible/roles/agent_relay_host/tasks/deploy.yml");
  const main = await text("ansible/roles/agent_relay_host/tasks/main.yml");
  const defaults = await text("ansible/roles/agent_relay_host/defaults/main.yml");
  const hostPlaybook = await text("ansible/playbooks/host.yml");
  const connectionPlaybook = await text("ansible/playbooks/github-connect.yml");
  const connectionTasks = await text("ansible/roles/agent_relay_github_connection/tasks/main.yml");
  const ansibleReadme = await text("ansible/README.md");
  const operations = await text("docs/operations/README.md");
  const pkg = await text("package.json");

  assert.doesNotMatch(users, /\.profile|umask/);
  assert.match(main, /import_tasks: deploy\.yml/);
  assert.match(defaults, /agent_relay_repository_url:/);
  assert.match(defaults, /agent_relay_repository_version: main/);
  assert.doesNotMatch(defaults, /AGENT_RELAY_GITHUB_CREDENTIAL|agent_relay_manage_runner_lifecycle/u);
  assert.doesNotMatch(hostPlaybook, /github-connect|agent_relay_github_connection|AGENT_RELAY_GITHUB_CREDENTIAL/u);
  assert.match(connectionPlaybook, /role: agent_relay_github_connection/u);
  assert.doesNotMatch(connectionPlaybook, /import_playbook|role: agent_relay_host/u);
  assert.match(connectionTasks, /scripts\/github-connect/u);
  assert.doesNotMatch(connectionTasks, /packages\.yml|users\.yml|filesystem\.yml|containers\.yml|toolchains\.yml|deploy\.yml/u);

  assert.match(deploy, /name: Preview Agent Relay checkout reconciliation/);
  assert.match(deploy, /ansible\.builtin\.git:/);
  assert.match(deploy, /check_mode: true/);
  assert.match(deploy, /force: true/);
  assert.match(deploy, /umask: "0022"/);
  assert.match(deploy, /name: Stop runner listener before deployment/);
  assert.match(deploy, /Runner\.Worker/);
  assert.match(deploy, /name: Checkout Agent Relay source/);
  assert.match(deploy, /- -perm\n\s+- \/022/);
  assert.match(deploy, /- chmod\n\s+- go-w/);
  assert.match(deploy, /name: Install or update the complete Agent Relay host runtime/);
  assert.match(deploy, /agent_relay_source_root \}\}\/install\.sh/);
  assert.doesNotMatch(deploy, /stdin:|no_log:|agent_relay_github_credential|registration-token/u);

  assert.match(filesystem, /register: agent_relay_runner_paths/);
  assert.doesNotMatch(operations, /^\s*(git clone|git pull|\.\/install\.sh)/mu);
  assert.doesNotMatch(ansibleReadme, /^\s*(git clone|git pull|\.\/install\.sh)/mu);
  assert.doesNotMatch(operations, /secure-checkout-permissions\.sh/);
  assert.doesNotMatch(pkg, /secure-checkout-permissions/);
});

test("runner extraction preserves the Ansible-managed directory mode", async () => {
  const install = await text("install.sh");
  const systemTest = await text("test-system/install-script.integration.sh");
  const extraction = install.indexOf('tar -C "${RUNNER_DIR}" --no-overwrite-dir -xzf -');
  const postcondition = install.indexOf('require_directory "${RUNNER_DIR}" "${runner_uid}" "${runner_gid}" 700', extraction);

  assert.ok(extraction >= 0 && postcondition > extraction);
  assert.match(systemTest, /tar -C "\$\{archive_root\}" -czf "\$\{state_root\}\/runner\.tar\.gz" \./);
  assert.match(systemTest, /stat -c '%a' -- "\$\{runner_root\}"\)" == 700/);
  assert.match(systemTest, /sudo_stat_gid\(\) \{ stat_gid "\$1"; \}/);
});

test("one host contract supplies installer, connection, Ansible, and smoke versions", async () => {
  const contract = await json("config/runner-host.json");
  const install = await text("install.sh");
  const connection = await text("scripts/github-connect");
  const ciSmoke = await text("scripts/ci-toolchain-smoke.sh");
  const roleVars = await text("ansible/roles/agent_relay_host/vars/main.yml");
  const defaults = await text("ansible/roles/agent_relay_host/defaults/main.yml");

  assert.equal(contract.runner_version, "2.335.1");
  assert.equal(contract.go_version, "1.24.5");
  assert.equal(contract.typescript_version, "5.8.3");
  assert.equal(contract.codex_version, "0.144.4");
  assert.match(install, /host_config_load "\$\{HOST_CONFIG_FILE\}"/);
  assert.match(connection, /host_config_load "\$\{HOST_CONFIG_FILE\}"/);
  assert.match(ciSmoke, /host_config_load "\$\{repository_root\}\/config\/runner-host\.json"/);
  assert.match(roleVars, /config\/runner-host\.json.*from_json/);
  assert.match(roleVars, /agent_relay_service_name:/);
  assert.doesNotMatch(defaults, /runner_version|go_version|typescript_version|codex_version|storage_root/);
  assert.doesNotMatch(install, /^RUNNER_VERSION=|^TYPESCRIPT_VERSION=|^CODEX_VERSION=/mu);
  assert.doesNotMatch(ciSmoke, /EXPECTED_GO_VERSION=1\.24\.5|EXPECTED_CODEX_VERSION=0\.144\.4/);
});

test("host installer and GitHub connector have non-overlapping responsibilities", async () => {
  const install = await text("install.sh");
  const connection = await text("scripts/github-connect");

  assert.match(install, /runner_binary_state/);
  assert.match(install, /Runner archive extraction did not produce a complete runner payload/);
  assert.match(install, /HOST_TOOLCHAIN_CHECK/);
  assert.match(install, /Agent Relay host installation is complete; run ansible\/playbooks\/github-connect\.yml once/u);
  assert.doesNotMatch(install, /registration-token|Authorization: Bearer|\.\/config\.sh --unattended/u);

  assert.match(connection, /registration_state/);
  assert.match(connection, /registration-token/u);
  assert.match(connection, /Authorization: Bearer/u);
  assert.match(connection, /\.\/config\.sh --unattended --replace/u);
  assert.match(connection, /systemctl restart/u);
  assert.doesNotMatch(connection, /tsc -p|runner\/releases\/download|daemon\.json|containerd\/config\.toml/u);

  assert.doesNotMatch(install, /apt-get|\bdpkg\b|useradd|groupadd|usermod|ansible-playbook|installdependencies\.sh|codex login|wsl\.conf|DOCKER_PROVISIONING_ENABLED/u);
});

test("runtime is staged and validated before listener shutdown", async () => {
  const install = await text("install.sh");
  const stage = install.indexOf('stage_dir="$(mktemp -d');
  const compile = install.indexOf('/usr/local/bin/tsc -p', stage);
  const importSmoke = install.indexOf("await import(process.env.STAGED_ENTRYPOINT)", compile);
  const finalize = install.indexOf('find -P "${stage_dir}" -xdev -exec chown', importSmoke);
  const stop = install.indexOf('systemctl stop "${SERVICE_NAME}"', finalize);
  const wait = install.indexOf("wait_for_workers", stop);
  const activate = install.indexOf('mv -- "${stage_dir}" "${SOURCE_ROOT}/dist"', wait);
  assert.ok(stage >= 0 && compile > stage && importSmoke > compile && finalize > importSmoke);
  assert.ok(stop > finalize && wait > stop && activate > wait);
  assert.match(install, /build_environment=\([\s\S]*TMPDIR=\$\{BUILD_HOME\}\/tmp[\s\S]*PATH=\$\{TOOLCHAIN_PATH\}/);
  assert.doesNotMatch(install, /toolchain_environment_build "\$\{BUILD_USER\}"/);
});

test("Ansible has no duplicated bootstrap packages or container handlers", async () => {
  const defaults = await text("ansible/roles/agent_relay_host/defaults/main.yml");
  const roleVars = await text("ansible/roles/agent_relay_host/vars/main.yml");
  const packages = await text("ansible/roles/agent_relay_host/tasks/packages.yml");
  const containers = await text("ansible/roles/agent_relay_host/tasks/containers.yml");
  const filesystem = await text("ansible/roles/agent_relay_host/tasks/filesystem.yml");
  const toolchains = await text("ansible/roles/agent_relay_host/tasks/toolchains.yml");
  const config = await text("ansible/ansible.cfg");

  assert.match(defaults, /agent_relay_extra_apt_packages: \[\]/);
  assert.match(roleVars, /agent_relay_required_apt_packages:/);
  assert.doesNotMatch(roleVars, /apt-transport-https/);
  for (const packageName of ["ca-certificates", "curl", "gnupg", "python3", "sudo"]) {
    assert.equal((packages.match(new RegExp(`- ${packageName}(?:\\n|$)`, "g")) ?? []).length, 1);
  }
  assert.match(containers, /register: agent_relay_docker_config/);
  assert.match(containers, /restarted.*agent_relay_containerd_config\.changed/);
  assert.doesNotMatch(containers, /flush_handlers|notify:/);
  assert.match(filesystem, /Create builder temporary directory/);
  assert.doesNotMatch(filesystem, /- cargo|- go-cache|- gradle|- pip|- docker/);
  assert.equal((toolchains.match(/\/usr\/local\/libexec\/agent-relay\/rustup-init/g) ?? []).length, 2);
  assert.match(toolchains, /path: \/usr\/local\/sbin\/agent-relay-rustup-init\n    state: absent/);
  assert.doesNotMatch(toolchains, /dest: \/usr\/local\/sbin\/agent-relay-rustup-init/);
  assert.doesNotMatch(toolchains, /- \/usr\/local\/sbin\/agent-relay-rustup-init/);
  assert.doesNotMatch(config, /^inventory\s*=/mu);
});

test("system test executes the separated host and connection behavior", async () => {
  const systemTest = await text("test-system/install-script.integration.sh");
  const pkg = await text("package.json");
  const readme = await text("README.md");
  const ansibleReadme = await text("ansible/README.md");

  assert.match(systemTest, /bash "\$\{source_root\}\/install\.sh"/);
  assert.match(systemTest, /bash "\$\{source_root\}\/scripts\/github-connect"/);
  assert.match(systemTest, /host and GitHub connection integration checks passed/);
  assert.match(systemTest, /complete runner binaries were downloaded again/);
  assert.match(systemTest, /host installer unexpectedly succeeded after build failure/);
  assert.match(systemTest, /host installer unexpectedly succeeded after activation failure/);
  assert.match(pkg, /scripts\/codex-run scripts\/github-connect scripts\/host-config\.sh/u);
  assert.match(readme, /ansible\/README\.md/);
  assert.match(readme, /docs\/operations\/README\.md/);
  assert.match(ansibleReadme, /playbooks\/github-connect\.yml/);
  assert.match(ansibleReadme, /playbooks\/host\.yml/);
  assert.match(ansibleReadme, /does not rerun host provisioning/u);
});
