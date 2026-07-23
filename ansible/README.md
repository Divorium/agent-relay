# Agent Relay host deployment

This directory provisions and updates a Debian 13 (Trixie) x86-64 systemd host. Ansible owns repository checkout and invokes `install.sh`; manual clone, pull, runner registration, or installer invocation is not part of the supported flow.

## Control machine

Use `ansible-core >= 2.18`. The role uses only `ansible.builtin` modules and keeps SSH host-key checking enabled.

## Target bootstrap state

A fresh target needs only network access and root SSH. The installation playbook bootstraps Python 3, installs host dependencies, creates operational users, configures Docker, installs toolchains, deploys Agent Relay, registers the GitHub runner, reconciles the dedicated `agent-relay` organization-runner label, and starts the runner.

Docker keeps its standard `/run/docker.sock` endpoint and also receives an Ansible-managed systemd socket at `/srv/github-runner/storage/docker-socket/docker.sock`. The dedicated directory is owned by `github-runner`, the socket is `root:docker` mode `0660`, and Codex receives only that directory as a writable sandbox root. Do not replace this with write access to `/run` or with a socket-file permission entry.

## Configure inventory

```bash
cd ansible
cp inventory/group_vars/all.yml.example inventory/group_vars/all.yml
$EDITOR inventory/example.ini inventory/group_vars/all.yml
```

`agent_relay_admin_authorized_keys` must contain at least one public SSH key. Do not commit private keys, passwords, GitHub tokens, Codex credentials, or Vault secrets.

The default deployment tracks `main` from `https://github.com/Divorium/agent-relay.git`. Override it when required:

```yaml
agent_relay_repository_url: https://github.com/Divorium/agent-relay.git
agent_relay_repository_version: main
```

The checkout is managed state. Local changes on the target are discarded when Ansible reconciles the configured revision.

## First installation

Export a GitHub organization credential on the control machine:

```bash
export AGENT_RELAY_GITHUB_CREDENTIAL='github_pat_...'
```

A fine-grained token needs the organization permission `Self-hosted runners: Read and write`. A classic PAT needs `admin:org`. The installation playbook uses the credential to register an absent runner, locate `gh-runner`, add the custom `agent-relay` label without removing other labels, and verify the resulting label set. The credential is hidden from Ansible output and is not stored on the target.

Run:

```bash
cd ansible
ANSIBLE_CONFIG="$PWD/ansible.cfg" \
ANSIBLE_ROLES_PATH="$PWD/roles" \
ansible-playbook \
  --inventory "$PWD/inventory/example.ini" \
  "$PWD/playbooks/install.yml"
```

`playbooks/install.yml` imports the complete host playbook with runner lifecycle management enabled. It is safe to rerun, but every invocation requires the PAT because it verifies the organization runner and its managed label.

## Subsequent updates

After the runner is registered and labeled, releases and host configuration changes use the PAT-free host playbook:

```bash
cd ansible
ANSIBLE_CONFIG="$PWD/ansible.cfg" \
ANSIBLE_ROLES_PATH="$PWD/roles" \
ansible-playbook \
  --inventory "$PWD/inventory/example.ini" \
  "$PWD/playbooks/host.yml"
```

`playbooks/host.yml` provisions and reconciles all recurring host state, updates the managed repository revision, and invokes `install.sh` only when deployment is required. A complete existing runner registration does not require a PAT. The playbook refuses first registration and directs the operator to `playbooks/install.yml` instead of creating an unlabeled runner.

Codex authentication remains an explicit credential operation after the host exists:

```bash
ssh agent-relay-admin@HOST
sudo -u github-runner -H /usr/local/bin/codex login
```

Runner, toolchain, and host constants come from `../config/runner-host.json`. Operational recovery procedures are documented in [`../docs/operations/README.md`](../docs/operations/README.md).
