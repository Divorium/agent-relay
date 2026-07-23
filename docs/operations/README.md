# Native GitHub Runner Operations

## Supported host

Agent Relay supports a fresh Debian 13 (Trixie) x86-64 systemd host. Before Ansible, the host needs network access and root SSH only.

## Configure the control machine

```bash
cd ansible
cp inventory/group_vars/all.yml.example inventory/group_vars/all.yml
$EDITOR inventory/example.ini inventory/group_vars/all.yml
```

Replace `inventory/runners.ini` in the commands below with the configured inventory filename when different.

## First installation

Before first runner registration, export a GitHub organization credential on the control machine:

```bash
export AGENT_RELAY_GITHUB_CREDENTIAL='github_pat_...'
```

A fine-grained token needs `Self-hosted runners: Read and write`. A classic PAT needs `admin:org`. The credential is passed to `install.sh` through standard input only when registration is absent. Ansible also uses it to add and verify the managed `agent-relay` organization-runner label. The credential is not stored on the target.

Run the installation playbook from the repository `ansible` directory:

```bash
ANSIBLE_CONFIG="$PWD/ansible.cfg" \
ANSIBLE_ROLES_PATH="$PWD/roles" \
ansible-playbook \
  --inventory "$PWD/inventory/runners.ini" \
  "$PWD/playbooks/install.yml"
```

The installation playbook imports the complete host playbook with runner lifecycle management enabled. It may be rerun, but every run requires the PAT because GitHub runner identity and labels are reconciled through the organization API.

## Update an installed host

After `.runner`, `.credentials`, and `.credentials_rsaparams` exist and the runner has the `agent-relay` label, use the PAT-free host playbook for releases and host configuration changes:

```bash
ANSIBLE_CONFIG="$PWD/ansible.cfg" \
ANSIBLE_ROLES_PATH="$PWD/roles" \
ansible-playbook \
  --inventory "$PWD/inventory/runners.ini" \
  "$PWD/playbooks/host.yml"
```

`playbooks/host.yml` reconciles all recurring host state. It updates the repository and invokes `install.sh` only when deployment is required. The installer detects the complete registration and does not request or consume a PAT. If registration is absent or partial, the host playbook fails and directs the operator to `playbooks/install.yml`; it never creates an unlabeled runner.

Ansible owns the deployment lifecycle. It provisions the host, clones or updates the configured repository revision with `umask 0022`, reconciles checkout permissions, restores managed directory modes, configures both Docker sockets, drains active jobs when deployment is required, and runs `install.sh`. Do not manually clone, pull, edit Docker systemd drop-ins, or invoke the installer on the target.

The checkout is managed state. Local target changes are discarded when Ansible reconciles the configured revision.

### If Ansible cannot find `agent_relay_host`

An error such as `the role 'agent_relay_host' was not found` means that Ansible did not load the repository role path. This can happen when `ansible.cfg` is not discovered, is ignored, or the command is run from a different directory.

From the repository `ansible` directory, verify that the role exists:

```bash
test -f "$PWD/roles/agent_relay_host/tasks/main.yml" && echo "role exists"
```

Check whether Ansible loaded the configured role path:

```bash
ansible-config dump --only-changed | grep DEFAULT_ROLES_PATH
```

If required, pass the configuration and role path explicitly as shown in the playbook commands above. Assigning `ANSIBLE_CONFIG` or `ANSIBLE_ROLES_PATH` on separate lines without `export` does not pass them to `ansible-playbook`.

Use `ansible-core >= 2.18`. SSH host-key checking remains enabled. Do not commit private keys, passwords, GitHub tokens, or Codex credentials.

## Codex authentication

Codex authentication remains an explicit credential operation after the host exists:

```bash
ssh agent-relay-admin@HOST
sudo -u github-runner -H /usr/local/bin/codex login
```

`install.sh` neither performs nor verifies Codex authentication.

## Deployment behavior

The role previews repository reconciliation before changing the target. When deployment is required, it stops the runner listener, waits for active `Runner.Worker` processes, updates the checkout, and runs `install.sh` as `agent-relay-admin`.

The role configures `docker.socket` with the ordinary `/run/docker.sock` listener and the Codex listener defined by `config/runner-host.json`, currently `/srv/github-runner/storage/docker-socket/docker.sock`. When the socket configuration changes, the role stops `docker.service`, restarts `docker.socket`, and then starts Docker so `dockerd -H fd://` receives both descriptors.

The installer validates users, directories, toolchains, Docker, checkout ownership, and runtime state. It preserves the Ansible-managed runner directory mode while extracting the GitHub Runner archive, builds a staged runtime, and activates it by same-filesystem rename.

Use `playbooks/host.yml` for recurring releases. Use `playbooks/install.yml` only when runner registration or managed-label reconciliation is required.

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
sudo systemctl status docker.socket docker.service
sudo test -S /srv/github-runner/storage/docker-socket/docker.sock
sudo -u github-runner -H env \
  DOCKER_HOST=unix:///srv/github-runner/storage/docker-socket/docker.sock \
  docker info
```

Both Docker sockets must exist. The dedicated directory must be owned by `github-runner`, the socket must be `root:docker` mode `0660`, and the runner account must be a member of `docker`.

If the dedicated socket is missing or stale, rerun Ansible. Do not create a symlink to `/run/docker.sock`, grant write access to `/run`, or manually edit the systemd unit.

## Filesystem layout

```text
/srv/github-runner/storage/agent-relay
/srv/github-runner/storage/work
/srv/github-runner/storage/runner
/srv/github-runner/storage/home
/srv/github-runner/storage/build-home
/srv/github-runner/storage/docker/engine
/srv/github-runner/storage/docker/containerd
/srv/github-runner/storage/docker-socket/docker.sock
```

## Codex output

Codex output is normalized, redacted, and streamed live with a fixed `[codex] ` prefix. The same accepted bytes are written to the uploaded `agent-relay-output` transcript. Raw Codex JSONL is internal. `${GITHUB_OUTPUT}` contains workflow outputs only.

A zero process exit is not sufficient for success. Agent Relay requires at least one Codex `command_execution` or `file_change` lifecycle item. A session that only reports inability to operate fails and does not proceed to finalization.
