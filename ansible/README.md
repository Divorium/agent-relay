# Agent Relay host deployment

This directory has two disjoint Ansible entrypoints:

- `playbooks/host.yml` prepares and updates the complete Debian host and Agent Relay runtime;
- `playbooks/github-connect.yml` connects that prepared runner to GitHub.

The GitHub connection playbook does not import, include, or rerun the host playbook. Manual clone, pull, runner registration, or PAT use during host deployment is not part of the supported flow. Codex CLI installation and authentication belong to consumer workflows, not either playbook; see [the native job contract](../docs/job-managed-codex.md).

## Control machine

Use `ansible-core >= 2.18`. Both roles use only `ansible.builtin` modules, and SSH host-key checking remains enabled.

## Configure inventory

```bash
cd ansible
cp inventory/group_vars/all.yml.example inventory/group_vars/all.yml
$EDITOR inventory/example.ini inventory/group_vars/all.yml
```

`agent_relay_admin_authorized_keys` must contain at least one public SSH key. Do not commit private keys, passwords, GitHub tokens, Codex credentials, or Vault secrets.

Runner labels belong to inventory. Define labels for the `agent_relay` group in `inventory/group_vars/agent_relay.yml`:

```yaml
agent_relay_runner_labels:
  - agent-relay
  - linux-x64
```

Override per runner with a host variable, for example `inventory/host_vars/gh-runner-02.yml`:

```yaml
agent_relay_runner_labels:
  - agent-relay
  - heavy-runner
  - docker
```

Set `agent_relay_runner_labels: []` to remove all custom labels. The host deployment tracks `main` from `https://github.com/Divorium/agent-relay.git` by default. Override when required:

```yaml
agent_relay_repository_url: https://github.com/Divorium/agent-relay.git
agent_relay_repository_version: main
```

The checkout is managed state. Local target changes are discarded when Ansible reconciles the configured revision.

## Step 1: install or update the host

Run `host.yml` on a fresh host and for later Agent Relay or host updates:

```bash
cd ansible
ANSIBLE_CONFIG="$PWD/ansible.cfg" \
ANSIBLE_ROLES_PATH="$PWD/roles" \
ansible-playbook \
  --inventory "$PWD/inventory/example.ini" \
  --ask-become-pass \
  "$PWD/playbooks/host.yml"
```

The playbook connects as `runneradmin` and uses sudo only for host provisioning. `--ask-become-pass` (`-K`) prompts for the sudo password; `-k` prompts for SSH password. No GitHub PAT is required. Host reconciliation directly bootstraps Python, installs packages and pinned host toolchains, creates administrator/runner/builder accounts, configures Docker/containerd and both sockets, drains active workers, stages verified runner binaries and runtime, preserves rollback state, installs systemd, builds as the unprivileged builder and restarts only a registered listener.

Codex is not installed, updated, authenticated or removed by host provisioning. Existing global installations left by an older release are unused by the new workflow contract. CLI upgrades are made by changing the workflow's exact version, without another host deployment.

Every host run creates one maintenance window on a registered runner: stop the listener, wait for active `Runner.Worker`, reconcile and restart. Handled activation failure restores prior valid state; an interrupted activation is recovered by the next run. `host.yml` does not invoke `install.sh`, read `AGENT_RELAY_GITHUB_CREDENTIAL`, request a registration token, call `config.sh` or reconcile GitHub labels.

Docker keeps `/run/docker.sock` and also receives `/srv/github-runner/storage/docker-socket/docker.sock`. The directory is runner-owned, the socket is `root:docker` mode `0660`; the Codex sandbox allows the dedicated directory but does not turn daemon access into an unprivileged boundary. Docker/containerd storage modes remain unchanged.

## Step 2: connect the prepared runner to GitHub

Run after first host preparation or for connection/label recovery:

```bash
export AGENT_RELAY_GITHUB_CREDENTIAL='github_pat_...'
cd ansible
ANSIBLE_CONFIG="$PWD/ansible.cfg" \
ANSIBLE_ROLES_PATH="$PWD/roles" \
ansible-playbook \
  --inventory "$PWD/inventory/example.ini" \
  --ask-become-pass \
  "$PWD/playbooks/github-connect.yml"
unset AGENT_RELAY_GITHUB_CREDENTIAL
```

A fine-grained token needs organization `Self-hosted runners: Read and write`; a classic PAT needs `admin:org`. The connection role verifies prepared state, validates public inputs, obtains a registration token, invokes the official runner configuration as `github-runner`, starts its listener and reconciles the inventory-owned custom-label set while preserving GitHub-managed labels. API calls use `no_log` and execute on the control machine; no PAT is stored on the target.

This playbook does not install host components, source, toolchains or runtime and never invokes `host.yml`. Later releases run only `host.yml` without a PAT. Existing registration is preserved.

## Codex authentication

Supply the existing `CODEX_TOKEN` as a step-scoped GitHub Actions secret to `scripts/run-job-codex`. Its private per-job login replaces persistent operator `codex login`. Cache only the selected CLI, never credentials. Full invocation, cache and cleanup ownership are documented in [job-managed-codex.md](../docs/job-managed-codex.md). Host constants remain in `config/runner-host.json`; the Codex version belongs to the consumer workflow.
