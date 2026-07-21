# Agent Relay

Agent Relay runs on a dedicated Debian 13 (Trixie) x86-64 host with systemd and one organization-level GitHub Actions runner.

Host initialization and runner installation are intentionally separate:

- `ansible/` prepares the operating system, users, packages, toolchains, directories and Docker;
- `install.sh` validates that host state, installs or reuses the GitHub runner, builds Agent Relay and activates the runner service.

`install.sh` never installs or invokes Ansible and does not install host packages. Codex authentication is a separate manual operator action.

## Filesystem layout

```text
/srv/github-runner/storage/agent-relay  administrator-owned source; root-owned dist
/srv/github-runner/storage/work         github-runner-owned workflow workspaces
/srv/github-runner/storage/runner       official GitHub Actions runner
/srv/github-runner/storage/home         github-runner home and Codex authentication
/srv/github-runner/storage/build-home   agent-relay-builder home and build state
/srv/github-runner/storage/docker/engine
/srv/github-runner/storage/docker/containerd
```

`/srv/github-runner/storage/runner/_work` is a managed symlink to `../work`.

The administrator account is created by Ansible with configured SSH public keys and passwordless sudo. `github-runner` and `agent-relay-builder` have locked passwords and no sudo access. Docker group membership gives `github-runner` root-equivalent control of the host and is an explicit trust decision.

## Host initialization

From an operator-controlled checkout with `ansible-core >= 2.18`:

```bash
cd ansible
cp inventory/group_vars/all.yml.example inventory/group_vars/all.yml
# edit inventory/example.ini and inventory/group_vars/all.yml
ansible-playbook -i inventory/example.ini playbooks/host.yml
```

The fresh target initially needs only Debian 13, network access and root SSH. The playbook bootstraps Python 3, installs sudo, creates the administrator and service users, installs packages and toolchains, and configures Docker.

Additional ordinary Debian packages can be declared through `agent_relay_extra_apt_packages`.

## Runner installation

After Ansible completes, connect as the created administrator and clone the repository:

```bash
git clone <repository-url> /srv/github-runner/storage/agent-relay
sudo -u github-runner -H /usr/local/bin/codex login
cd /srv/github-runner/storage/agent-relay
./install.sh
```

The installer is reusable. Complete runner binaries and registration are detected and reused; partial or unsafe state fails without destructive repair. Every successful invocation rebuilds Agent Relay in an adjacent private stage, validates the compiled module graph, atomically replaces `dist`, and starts or restarts the runner.

## Later releases

Do not modify the trusted checkout while a workflow is running:

```bash
sudo systemctl stop actions.runner.Divorium.gh-runner.service
# wait until no Runner.Worker owned by github-runner remains
cd /srv/github-runner/storage/agent-relay
git pull --ff-only
./install.sh
```

Run the Ansible playbook before the pull when host desired state or package requirements changed. Exact operational commands and interrupted-swap recovery are documented in `docs/operations/README.md`.

## Codex output

Codex progress is normalized into Actions-safe `[codex] ` physical lines, redacted once, streamed live through a bounded queue and written to the later `agent-relay-output` artifact transcript. `${GITHUB_OUTPUT}` is reserved for workflow outputs rather than execution logs.

## Documentation authority

Current behavior is defined by source, this README, `docs/operations/README.md`, and `docs/native-github-runner-specification.md`. The selected active ExecPlan is the implementation instruction while work is in progress. Completed ExecPlans are historical records.
