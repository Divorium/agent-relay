# Agent Relay host deployment

This directory provisions a fresh Debian 13 (Trixie) x86-64 systemd host, checks out Agent Relay and runs `install.sh`. No manual clone, pull or installer invocation is part of the supported deployment flow.

## Control machine

Use `ansible-core >= 2.18`. The role uses only `ansible.builtin` modules and keeps SSH host-key checking enabled.

## Target bootstrap state

The target needs only network access and root SSH. The playbook bootstraps Python 3, installs the host dependencies, creates the operational users, configures Docker, installs toolchains, deploys the repository and starts the GitHub runner.

## Configure inventory

```bash
cd ansible
cp inventory/group_vars/all.yml.example inventory/group_vars/all.yml
$EDITOR inventory/example.ini inventory/group_vars/all.yml
```

`agent_relay_admin_authorized_keys` must contain at least one public SSH key. Do not commit private keys, passwords, GitHub tokens, Codex credentials or Vault secrets.

The default deployment tracks `main` from `https://github.com/Divorium/agent-relay.git`. Override it when required:

```yaml
agent_relay_repository_url: https://github.com/Divorium/agent-relay.git
agent_relay_repository_version: main
```

The checkout is managed state. Local changes on the target are discarded when Ansible reconciles the configured revision.

## First runner registration

Export a GitHub organization credential only on the control machine before the first run:

```bash
export AGENT_RELAY_GITHUB_CREDENTIAL='github_pat_...'
```

A fine-grained token needs the organization permission `Self-hosted runners: Read and write`. A classic PAT needs `admin:org`. The credential is sent to `install.sh` through standard input, is hidden from Ansible output and is not stored on the target.

## Run

```bash
cd ansible
ANSIBLE_CONFIG="$PWD/ansible.cfg" \
ANSIBLE_ROLES_PATH="$PWD/roles" \
ansible-playbook \
  --inventory "$PWD/inventory/example.ini" \
  "$PWD/playbooks/host.yml"
```

Rerun the same playbook to update the host and deployment. Ansible performs clone, checkout, pull-equivalent reconciliation and installation.

Codex authentication remains an explicit credential operation after the host exists:

```bash
ssh agent-relay-admin@HOST
sudo -u github-runner -H /usr/local/bin/codex login
```

Runner, toolchain and host constants come from `../config/runner-host.json`. Operational recovery procedures are documented in [`../docs/operations/README.md`](../docs/operations/README.md).
