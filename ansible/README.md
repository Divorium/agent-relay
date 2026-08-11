# Agent Relay host deployment

This directory has two disjoint Ansible entrypoints:

- `playbooks/host.yml` prepares and updates the complete Debian host and Agent Relay runtime;
- `playbooks/github-connect.yml` connects that prepared runner to GitHub.

The GitHub connection playbook does not import, include, or rerun the host playbook. Manual clone, pull, runner registration, direct lifecycle script invocation, or PAT use during host deployment is not part of the supported flow.

## Control machine

Use `ansible-core >= 2.18`. Both roles use only `ansible.builtin` modules, and SSH host-key checking remains enabled.

## Configure inventory

```bash
cd ansible
cp inventory/group_vars/all.yml.example inventory/group_vars/all.yml
$EDITOR inventory/example.ini inventory/group_vars/all.yml
```

`agent_relay_admin_authorized_keys` must contain at least one public SSH key. Do not commit private keys, passwords, GitHub tokens, Codex credentials, or Vault secrets.

The host deployment tracks `main` from `https://github.com/Divorium/agent-relay.git` by default. Override it when required:

```yaml
agent_relay_repository_url: https://github.com/Divorium/agent-relay.git
agent_relay_repository_version: main
```

The checkout is managed state. Local target changes are discarded when Ansible reconciles the configured revision.

## Step 1: install or update the host

Run `host.yml` on a fresh host and for every later Agent Relay or host update:

```bash
cd ansible
ANSIBLE_CONFIG="$PWD/ansible.cfg" \
ANSIBLE_ROLES_PATH="$PWD/roles" \
ansible-playbook \
  --inventory "$PWD/inventory/example.ini" \
  "$PWD/playbooks/host.yml"
```

This playbook requires no GitHub PAT and performs the complete idempotent host reconciliation directly through Ansible:

- bootstraps Python 3;
- installs packages and pinned language toolchains, then updates Codex CLI to the latest available release;
- creates the administrator, runner, and builder accounts;
- configures Docker and containerd;
- creates the ordinary and dedicated Docker sockets;
- downloads and verifies the official GitHub Runner payload;
- installs the runner systemd unit from an Ansible template;
- checks out the configured Agent Relay revision;
- builds the runtime as `agent-relay-builder` in a private stage;
- validates and atomically activates the runtime;
- restarts a completely registered runner or leaves an unregistered runner disabled.

`host.yml` does not invoke `install.sh`, read `AGENT_RELAY_GITHUB_CREDENTIAL`, obtain a runner registration token, invoke `config.sh`, or call a GitHub runner-label API.

The host role and `scripts/github-connect` share `/var/lib/agent-relay/lifecycle/active` as an atomic lifecycle lock. Concurrent host deployment and GitHub connection fail closed. An interrupted Ansible operation may leave the lock directory; remove it only after confirming no host or connection operation is active.

Docker keeps `/run/docker.sock` and also receives `/srv/github-runner/storage/docker-socket/docker.sock`. The dedicated directory is owned by `github-runner`, the socket is `root:docker` mode `0660`, and Codex receives only that directory as a writable sandbox root.

The parent Docker storage directory and the containerd root are `root:root` mode `0711`. The Docker daemon data root at `/srv/github-runner/storage/docker/engine` is `root:root` mode `0710`, matching the final mode enforced by Docker after startup.

## Step 2: connect the prepared runner to GitHub

Run this operation after the first successful `host.yml` execution or when repairing registration or the managed label:

```bash
export AGENT_RELAY_GITHUB_CREDENTIAL='github_pat_...'

cd ansible
ANSIBLE_CONFIG="$PWD/ansible.cfg" \
ANSIBLE_ROLES_PATH="$PWD/roles" \
ansible-playbook \
  --inventory "$PWD/inventory/example.ini" \
  "$PWD/playbooks/github-connect.yml"

unset AGENT_RELAY_GITHUB_CREDENTIAL
```

A fine-grained token needs the organization permission `Self-hosted runners: Read and write`. A classic PAT needs `admin:org`.

`github-connect.yml` performs only GitHub connection work:

- verifies that `host.yml` already installed runner binaries, runtime, and the service unit;
- creates organization runner registration when absent;
- starts the registered runner service;
- locates exactly one runner named `gh-runner`;
- adds the custom `agent-relay` label without replacing unrelated labels;
- verifies the resulting label set.

It does not install packages, users, Docker, toolchains, source code, runner binaries, systemd units, or the Agent Relay runtime. It does not call `host.yml` or the host role.

The PAT is passed through standard input to the dedicated connection script and through authenticated GitHub API requests. It is hidden from Ansible output and is not stored on the target.

## Later releases

For every later release, run only `playbooks/host.yml` without exporting a PAT. Existing GitHub registration files are preserved, and the host role performs no credentialed GitHub operation.

## Codex authentication

Codex authentication remains a separate explicit operation after the host exists:

```bash
ssh agent-relay-admin@HOST
sudo -u github-runner -H /usr/local/bin/codex login
```

Pinned runner, language-toolchain, and host constants come from `../config/runner-host.json`; Codex CLI intentionally has no version pin. Operational recovery procedures are documented in [`../docs/operations/README.md`](../docs/operations/README.md).
