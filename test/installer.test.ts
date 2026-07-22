import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

async function text(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await text(path)) as Record<string, unknown>;
}

test("host toolchain check is executable", async () => {
  const metadata = await stat("scripts/host-toolchain-check.sh");
  assert.notEqual(metadata.mode & 0o111, 0);
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

test("one host contract supplies installer, Ansible, and smoke versions", async () => {
  const contract = await json("config/runner-host.json");
  const install = await text("install.sh");
  const ciSmoke = await text("scripts/ci-toolchain-smoke.sh");
  const roleVars = await text("ansible/roles/agent_relay_host/vars/main.yml");
  const defaults = await text("ansible/roles/agent_relay_host/defaults/main.yml");

  assert.equal(contract.runner_version, "2.335.1");
  assert.equal(contract.go_version, "1.24.5");
  assert.equal(contract.typescript_version, "5.8.3");
  assert.equal(contract.codex_version, "0.144.4");
  assert.match(install, /host_config_load "\$\{HOST_CONFIG_FILE\}"/);
  assert.match(ciSmoke, /host_config_load "\$\{repository_root\}\/config\/runner-host\.json"/);
  assert.match(roleVars, /config\/runner-host\.json.*from_json/);
  assert.doesNotMatch(defaults, /runner_version|go_version|typescript_version|codex_version|storage_root/);
  assert.doesNotMatch(install, /^RUNNER_VERSION=|^TYPESCRIPT_VERSION=|^CODEX_VERSION=/mu);
  assert.doesNotMatch(ciSmoke, /EXPECTED_GO_VERSION=1\.24\.5|EXPECTED_CODEX_VERSION=0\.144\.4/);
});

test("installer contains runner and runtime responsibilities only", async () => {
  const install = await text("install.sh");
  assert.match(install, /runner_binary_state/);
  assert.match(install, /registration_state/);
  assert.match(install, /Runner archive extraction did not produce a complete runner payload/);
  assert.match(install, /Runner registration did not produce the complete protected state/);
  assert.match(install, /X-GitHub-Api-Version: \$\{GITHUB_API_VERSION\}/);
  assert.match(install, /HOST_TOOLCHAIN_CHECK/);
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

test("system test executes installer behavior instead of only matching source", async () => {
  const systemTest = await text("test-system/install-script.integration.sh");
  const pkg = await text("package.json");
  const readme = await text("README.md");
  const ansibleReadme = await text("ansible/README.md");

  assert.match(systemTest, /bash "\$\{source_root\}\/install\.sh"/);
  assert.match(systemTest, /installer behavioral integration checks passed/);
  assert.match(systemTest, /complete runner binaries were downloaded again/);
  assert.match(systemTest, /installer unexpectedly succeeded after build failure/);
  assert.match(systemTest, /installer unexpectedly succeeded after activation failure/);
  assert.match(pkg, /scripts\/host-config\.sh scripts\/host-toolchain-check\.sh/);
  assert.match(readme, /ansible\/README\.md/);
  assert.match(readme, /docs\/operations\/README\.md/);
  assert.doesNotMatch(readme, /ansible-playbook|git pull --ff-only/);
  assert.doesNotMatch(ansibleReadme, /sudo -u github-runner|\.\/install\.sh/);
});
