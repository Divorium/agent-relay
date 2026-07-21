#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "${ROOT}"

bash -n install.sh

for removed in \
  update.sh \
  scripts/docker-host.sh \
  scripts/docker-host-debian.sh \
  scripts/docker-host-debian-core.sh \
  test-system/update-script.integration.sh \
  test-system/docker-host.repository-safe.sh \
  test-system/docker-conffile-recovery.integration.sh \
  test/update-regression.test.ts; do
  if [[ -e "${removed}" ]]; then
    printf 'obsolete file still exists: %s\n' "${removed}" >&2
    exit 1
  fi
done

for required in \
  ansible/ansible.cfg \
  ansible/README.md \
  ansible/inventory/example.ini \
  ansible/inventory/group_vars/all.yml.example \
  ansible/playbooks/host.yml \
  ansible/roles/agent_relay_host/defaults/main.yml \
  ansible/roles/agent_relay_host/tasks/main.yml \
  ansible/roles/agent_relay_host/tasks/packages.yml \
  ansible/roles/agent_relay_host/tasks/users.yml \
  ansible/roles/agent_relay_host/tasks/filesystem.yml \
  ansible/roles/agent_relay_host/tasks/containers.yml \
  ansible/roles/agent_relay_host/tasks/toolchains.yml \
  ansible/roles/agent_relay_host/handlers/main.yml \
  ansible/roles/agent_relay_host/templates/daemon.json.j2 \
  ansible/roles/agent_relay_host/templates/containerd-config.toml.j2; do
  test -f "${required}"
done

if grep -Eq 'ansible-playbook|apt-get|\bdpkg\b|useradd|groupadd|usermod|installdependencies\.sh|codex login|wsl\.conf|DOCKER_PROVISIONING_ENABLED' install.sh; then
  echo 'install.sh still contains host provisioning, Ansible, dependency-helper, WSL, or Codex-login behavior' >&2
  exit 1
fi

grep -q 'require_command python3' install.sh
grep -q 'sudo -n true' install.sh
grep -q 'sudo -n test -f "${RUNNER_DIR}/${path}"' install.sh
grep -q 'tar -C "${RUNNER_DIR}" -xzf - < "${runner_archive}"' install.sh
grep -q 'Runner archive extraction did not produce a complete runner payload' install.sh
grep -q 'Runner registration did not produce the complete protected state' install.sh
grep -q 'umask 0077' install.sh
grep -q 'chmod 0600' install.sh
grep -q 'X-GitHub-Api-Version: 2026-03-10' install.sh
grep -q 'go version go1.24.5 linux/amd64' install.sh
grep -q 'create_home: false' ansible/roles/agent_relay_host/tasks/users.yml
grep -q 'Create runner-owned paths' ansible/roles/agent_relay_host/tasks/filesystem.yml
grep -q 'Create builder home' ansible/roles/agent_relay_host/tasks/filesystem.yml
grep -q 'agent_relay_extra_apt_packages' ansible/roles/agent_relay_host/defaults/main.yml
grep -q 'agent_relay_docker_conflicting_packages' ansible/roles/agent_relay_host/defaults/main.yml
grep -q 'Remove packages conflicting with Docker Engine' ansible/roles/agent_relay_host/tasks/packages.yml
grep -q 'apt-get install -y --no-install-recommends python3 python3-apt' ansible/playbooks/host.yml
grep -q 'validate: /usr/sbin/visudo -cf %s' ansible/roles/agent_relay_host/tasks/users.yml
grep -q 'checksum: sha256:https://static.rust-lang.org' ansible/roles/agent_relay_host/tasks/toolchains.yml
grep -q 'Self-hosted runners: write' docs/operations/README.md

python3 - <<'PY'
from pathlib import Path
source = Path('install.sh').read_text()
checks = {
    'extract': 'tar -C "${RUNNER_DIR}"',
    'extract_verify': 'Runner archive extraction did not produce a complete runner payload',
    'register': './config.sh --unattended',
    'register_verify': 'Runner registration did not produce the complete protected state',
    'stage': 'stage_dir="$(mktemp -d',
    'compile': '/usr/local/bin/tsc -p',
    'import': 'await import(process.env.STAGED_ENTRYPOINT)',
    'stop': 'systemctl stop "${SERVICE_NAME}"',
    'swap': 'mv -- "${stage_dir}" "${SOURCE_ROOT}/dist"',
    'restart': 'systemctl restart "${SERVICE_NAME}"',
}
pos = {name: source.index(fragment) for name, fragment in checks.items()}
pos['wait'] = source.index('wait_for_workers', pos['stop'])
assert pos['extract'] < pos['extract_verify']
assert pos['register'] < pos['register_verify']
assert pos['stage'] < pos['compile'] < pos['import'] < pos['stop'] < pos['wait'] < pos['swap'] < pos['restart'], pos
assert 'After=network-online.target\nWants=network-online.target' in source
assert 'if ! find -P "${root}" -xdev -print0' in source

toolchains = Path('ansible/roles/agent_relay_host/tasks/toolchains.yml').read_text()
assert toolchains.index('Download configured Go archive') < toolchains.index('Remove a different Go installation')
assert "'go version go' ~ agent_relay_go_version ~ ' linux/amd64'" in toolchains
PY

python3 -m json.tool package.json >/dev/null

printf 'install.sh and Ansible contract checks passed\n'
