# Agent Relay host initialization

This directory prepares a fresh Debian 13 (Trixie) x86-64 host. It is run manually from an operator-controlled checkout. It does not install or register the GitHub Actions runner and it never calls `install.sh`.

## Control machine

Use `ansible-core >= 2.18`. The implementation uses only `ansible.builtin` modules. SSH host-key checking remains enabled.

## Target bootstrap state

The target needs only:

- Debian 13 x86-64 with systemd;
- network access;
- SSH access as `root`.

Python 3, sudo and the operational administrator are created by the playbook. The initial Python installation uses one bounded `raw` bootstrap task before fact gathering.

## Configure inventory

Copy the example variables and replace the public key:

```bash
cd ansible
cp inventory/group_vars/all.yml.example inventory/group_vars/all.yml
$EDITOR inventory/example.ini inventory/group_vars/all.yml
```

`agent_relay_admin_authorized_keys` must contain at least one public SSH key. Do not commit private keys, passwords, GitHub tokens, Codex credentials or Ansible Vault secrets.

Ordinary packages available from configured APT repositories can be added without modifying the role:

```yaml
agent_relay_extra_apt_packages:
  - ripgrep
  - shellcheck
```

Packages requiring a new repository or special configuration must be implemented as explicit reviewed role tasks.

## Run

```bash
cd ansible
ansible-playbook -i inventory/example.ini playbooks/host.yml
```

The role is idempotent and manages named paths only. It does not recursively change an existing repository checkout, runner payload, workspaces, homes, Docker data or Agent Relay runtime.

## Install the runner

After the playbook, connect as the administrator created by Ansible and clone the repository:

```bash
git clone <repository-url> /srv/github-runner/storage/agent-relay
```

Authenticate Codex manually as the runner account:

```bash
sudo -u github-runner -H /usr/local/bin/codex login
```

Then run:

```bash
cd /srv/github-runner/storage/agent-relay
./install.sh
```

`install.sh` does not install Ansible, run this playbook or install host packages.

## Version policy

- Go, TypeScript and Codex CLI use exact configured versions.
- Node.js and Java use configured major versions from signed APT repositories.
- Rust uses the configured `stable` channel.
- Docker Engine, containerd, Buildx and Compose use `state: present` from Docker's signed repository.

Membership in the `docker` group grants root-equivalent control of the host. The `github-runner` account is deliberately trusted with that capability.
