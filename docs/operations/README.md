# Native GitHub Runner Operations

## Supported host

Agent Relay supports a fresh Debian 13 (Trixie) x86-64 systemd host. Before Ansible, the host needs network access and root SSH only. Ansible bootstraps Python 3, installs sudo and creates the operational administrator.

## Initialize the host

On the control machine:

```bash
cd ansible
cp inventory/group_vars/all.yml.example inventory/group_vars/all.yml
$EDITOR inventory/example.ini inventory/group_vars/all.yml
```

Run the playbook from the repository `ansible` directory:

```bash
ansible-playbook \
  --inventory "$PWD/inventory/example.ini" \
  "$PWD/playbooks/host.yml"
```

### If Ansible cannot find `agent_relay_host`

An error such as `the role 'agent_relay_host' was not found` means that Ansible did not load the repository role path. This can happen when `ansible.cfg` is not discovered, is ignored, or the command is run from a different directory. A world-writable checkout, including some mounted filesystems, is one possible cause but not the only one.

From the repository `ansible` directory, verify that the role exists:

```bash
test -f "$PWD/roles/agent_relay_host/tasks/main.yml" && echo "role exists"
```

Check whether Ansible loaded the configured role path:

```bash
ansible-config dump --only-changed | grep DEFAULT_ROLES_PATH
```

If the role path is missing or incorrect, pass the configuration and role path explicitly in the same command:

```bash
ANSIBLE_CONFIG="$PWD/ansible.cfg" \
ANSIBLE_ROLES_PATH="$PWD/roles" \
ansible-playbook \
  --inventory "$PWD/inventory/runners.ini" \
  "$PWD/playbooks/host.yml"
```

Replace `inventory/runners.ini` with the configured inventory filename when different.

Alternatively, export both variables before running Ansible:

```bash
export ANSIBLE_CONFIG="$PWD/ansible.cfg"
export ANSIBLE_ROLES_PATH="$PWD/roles"

ansible-playbook \
  --inventory "$PWD/inventory/runners.ini" \
  "$PWD/playbooks/host.yml"
```

Assigning `ANSIBLE_CONFIG` or `ANSIBLE_ROLES_PATH` on separate lines without `export` does not pass them to the `ansible-playbook` process.

Use `ansible-core >= 2.18`. SSH host-key checking remains enabled. Do not commit private keys, passwords, GitHub tokens or Codex credentials.

The created administrator receives configured public keys and passwordless sudo. `github-runner` is deliberately added to the Docker group, which is root-equivalent host access.

Add ordinary packages by extending:

```yaml
agent_relay_extra_apt_packages:
  - ripgrep
```

Rerun the playbook after changing desired host state. The role manages named paths only and must not recursively alter an installed checkout, runner payload, workspace, home or Docker data tree.

## Initial runner installation

Connect as the administrator created by Ansible:

```bash
git clone <repository-url> /srv/github-runner/storage/agent-relay
sudo -u github-runner -H /usr/local/bin/codex login
cd /srv/github-runner/storage/agent-relay
./install.sh
```

Codex login is manual. `install.sh` neither performs nor verifies authentication.

On the first run, provide a GitHub credential that may create an organization runner registration token. A fine-grained token needs the organization `Self-hosted runners: write` permission. A classic PAT needs `admin:org` and, for a private repository, `repo`. The credential is exchanged for a short-lived registration token and is not stored by the installer.

The installer validates Python 3, passwordless sudo, users, directories, toolchains, Docker, checkout ownership and the current runtime before mutation. It installs runner binaries and registration only when absent. It never calls Ansible, `apt`, `dpkg`, `useradd`, Docker provisioning, `installdependencies.sh` or Codex login.

## Release update

The source checkout is trusted runtime input. Stop intake and drain the active worker before changing it:

```bash
sudo systemctl stop actions.runner.Divorium.gh-runner.service
runner_uid="$(id -u github-runner)"
while ps -e -o euid=,comm= | awk -v uid="$runner_uid" '$1 == uid && $2 == "Runner.Worker" { found=1 } END { exit !found }'; do
  sleep 2
done
```

When host desired state changed, run the current playbook from the operator checkout before updating the target checkout. Then:

```bash
cd /srv/github-runner/storage/agent-relay
git pull --ff-only
./install.sh
```

`install.sh` builds and dynamically imports a staged production runtime as `agent-relay-builder` before stopping the listener itself. The stage is adjacent to `dist`, finalized as root-owned read-only content, and activated by same-filesystem rename. The service is then enabled, restarted and checked for an active `Runner.Listener`.

## Interrupted runtime swap

Normally `dist.previous` exists only between the two rename operations and is deleted immediately after a successful swap.

If an interrupted run leaves `dist.previous`:

1. keep the runner stopped;
2. inspect `dist` and `dist.previous` as root-owned regular directory trees;
3. when `dist` is absent, restore the validated previous tree:

   ```bash
   sudo mv /srv/github-runner/storage/agent-relay/dist.previous \
     /srv/github-runner/storage/agent-relay/dist
   ```

4. when a valid `dist` exists, deliberately remove the stale previous tree;
5. rebuild the host when the state cannot be established safely.

Listener startup failure does not trigger runtime rollback because the listener starts the GitHub runner and does not load Agent Relay `dist`.

## Status

```bash
sudo systemctl status actions.runner.Divorium.gh-runner.service
sudo -u github-runner -H docker info
```

## Filesystem layout

```text
/srv/github-runner/storage/agent-relay
/srv/github-runner/storage/work
/srv/github-runner/storage/runner
/srv/github-runner/storage/home
/srv/github-runner/storage/build-home
/srv/github-runner/storage/docker/engine
/srv/github-runner/storage/docker/containerd
```

The old `/srv/github-runner/storage/build`, `update.sh`, WSL path and shell Docker provisioner no longer exist.

## Codex output

Codex output is normalized, redacted and streamed live with a fixed `[codex] ` prefix. The same accepted bytes are written to the uploaded `agent-relay-output` transcript. Raw Codex JSONL is internal. `${GITHUB_OUTPUT}` contains workflow values only.
