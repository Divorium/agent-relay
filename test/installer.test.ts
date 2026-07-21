import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function text(path: string): Promise<string> {
  return readFile(path, "utf8");
}

test("installer contains only runner and runtime responsibilities", async () => {
  const install = await text("install.sh");
  assert.match(install, /^RUNNER_VERSION=2\.335\.1$/mu);
  assert.match(install, /^RUNNER_SHA256=4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf$/mu);
  assert.match(install, /require_command python3/);
  assert.match(install, /sudo -n true \|\| fail "The administrator requires passwordless sudo"/);
  assert.match(install, /runner_binary_state/);
  assert.match(install, /registration_state/);
  assert.match(install, /Runner archive extraction did not produce a complete runner payload/);
  assert.match(install, /chmod 0600[\s\S]*\.credentials_rsaparams/);
  assert.match(install, /Runner registration did not produce the complete protected state/);
  assert.match(install, /complete binaries plus absent registration|Complete binaries plus absent registration|binary_state/u);
  assert.match(install, /--url "\$2" --token "\$3" --name "\$4" --work _work/);
  assert.match(install, /After=network-online\.target/);
  assert.match(install, /Wants=network-online\.target/);
  assert.match(install, /KillMode=process/);
  assert.match(install, /TimeoutStopSec=5min/);
  assert.match(install, /Restart=always/);
  assert.match(install, /RestartSec=5s/);
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
  const previous = install.indexOf('"${SOURCE_ROOT}/dist.previous"', wait);
  const activate = install.indexOf('mv -- "${stage_dir}" "${SOURCE_ROOT}/dist"', previous);
  assert.ok(stage >= 0 && compile > stage && importSmoke > compile && finalize > importSmoke);
  assert.ok(stop > finalize && wait > stop && previous > wait && activate > previous);
  assert.match(install, /sudo -n -u "\$\{BUILD_USER\}" \/usr\/bin\/env -i/);
  assert.match(install, /if ! sudo -n mv -- "\$\{stage_dir\}" "\$\{SOURCE_ROOT\}\/dist"/);
  assert.match(install, /Runner\.Listener/);
  assert.doesNotMatch(install, /listener.*rollback|rollback.*listener/iu);
});

test("installer protects checkout and does not recursively repair it", async () => {
  const install = await text("install.sh");
  assert.match(install, /validate_checkout/);
  assert.match(install, /Checkout entry is not administrator-owned/);
  assert.match(install, /Checkout entry is writable by group or others/);
  assert.match(install, /remote get-url origin/);
  assert.match(install, /\^https\?:\/\/\[\^\/\]\*@/);
  assert.match(install, /must not contain embedded credentials/);
  assert.match(install, /root:root-owned/);
  assert.doesNotMatch(install, /chown -R|chmod -R|find -P "\$\{SOURCE_ROOT\}"[^\n]*-exec chown/);
});

test("Ansible bootstraps host state and creates the administrator", async () => {
  const playbook = await text("ansible/playbooks/host.yml");
  const defaults = await text("ansible/roles/agent_relay_host/defaults/main.yml");
  const tasks = (await Promise.all([
    "packages.yml", "users.yml", "filesystem.yml", "containers.yml", "toolchains.yml",
  ].map((name) => text(`ansible/roles/agent_relay_host/tasks/${name}`)))).join("\n");
  const handlers = await text("ansible/roles/agent_relay_host/handlers/main.yml");
  const config = await text("ansible/ansible.cfg");

  assert.match(playbook, /gather_facts: false/);
  assert.match(playbook, /ansible\.builtin\.raw/);
  assert.match(playbook, /apt-get install -y --no-install-recommends python3 python3-apt/);
  assert.match(playbook, /ansible\.builtin\.setup/);
  assert.match(playbook, /distribution_major_version == '13'/);
  assert.match(config, /roles_path = \.\/roles/);
  assert.doesNotMatch(config, /host_key_checking\s*=\s*False/i);

  assert.match(defaults, /agent_relay_admin_authorized_keys: \[\]/);
  assert.match(defaults, /agent_relay_extra_apt_packages: \[\]/);
  assert.match(defaults, /agent_relay_rust_toolchain: stable/);
  assert.match(tasks, /Grant administrator passwordless sudo/);
  assert.match(tasks, /validate: \/usr\/sbin\/visudo -cf %s/);
  assert.match(tasks, /authorized_keys/);
  assert.match(tasks, /groups: sudo/);
  assert.match(tasks, /Create GitHub runner account[\s\S]*create_home: false/);
  assert.match(tasks, /Create runtime builder account[\s\S]*create_home: false/);
  assert.match(tasks, /Create runner-owned paths/);
  assert.match(tasks, /Create builder home/);
  assert.match(tasks, /Install Docker packages without premature service start/);
  assert.match(tasks, /state: present/);
  assert.match(tasks, /policy_rc_d: 101/);
  assert.match(tasks, /Remove packages conflicting with Docker Engine/);
  assert.match(tasks, /agent_relay_extra_apt_packages/);
  assert.match(defaults, /liblttng-ust1t64/);
  assert.match(defaults, /libssl3t64/);
  assert.match(defaults, /libicu76/);
  assert.match(tasks, /checksum: sha256:https:\/\/static\.rust-lang\.org/);
  assert.match(handlers, /Restart containerd[\s\S]*Restart Docker/);
  assert.doesNotMatch(tasks, /install\.sh|config\.sh --unattended|codex login/);
});

test("package scripts and docs describe the single-installer model", async () => {
  const pkg = await text("package.json");
  const readme = await text("README.md");
  const operations = await text("docs/operations/README.md");
  const specification = await text("docs/native-github-runner-specification.md");
  const ignore = await text(".gitignore");

  for (const content of [pkg, readme, operations, specification]) {
    assert.doesNotMatch(content, /\.\/update\.sh|scripts\/docker-host\.sh/);
  }
  assert.match(readme, /agent_relay_extra_apt_packages/);
  assert.match(readme, /sudo -u github-runner -H \/usr\/local\/bin\/codex login/);
  assert.match(operations, /systemctl stop actions\.runner\.Divorium\.gh-runner\.service/);
  assert.match(operations, /dist\.previous/);
  assert.match(specification, /Python 3 and administrator passwordless sudo/);
  assert.match(ignore, /^\.dist\.stage\.\*$/mu);
  assert.match(ignore, /^dist\.previous$/mu);
  assert.doesNotMatch(pkg, /update-script|docker-host|docker-conffile/);
});
