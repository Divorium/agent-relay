# Native GitHub Runner Operations

## Supported host

Agent Relay supports Debian 13 (Trixie) x86-64 with systemd as PID 1. A fresh target needs network access and root SSH only.

## Configure the control machine

```bash
cd ansible
cp inventory/group_vars/all.yml.example inventory/group_vars/all.yml
$EDITOR inventory/example.ini inventory/group_vars/all.yml
```

Replace `inventory/runners.ini` below with the configured inventory filename when different. Use `ansible-core >= 2.18`; SSH host-key checking remains enabled.

## Host lifecycle

`playbooks/host.yml` is the complete host installation and update entrypoint. Run it first on a fresh machine and for every later release:

```bash
ANSIBLE_CONFIG="$PWD/ansible.cfg" \
ANSIBLE_ROLES_PATH="$PWD/roles" \
ansible-playbook \
  --inventory "$PWD/inventory/runners.ini" \
  "$PWD/playbooks/host.yml"
```

The host playbook does not require or read `AGENT_RELAY_GITHUB_CREDENTIAL`. It owns:

- Python bootstrap;
- system packages and repositories;
- administrator, runner, and builder accounts;
- secure filesystem roots;
- Docker and containerd configuration;
- both Docker socket listeners;
- language toolchains and Codex CLI;
- official GitHub Runner binaries;
- the runner systemd unit;
- managed source checkout;
- staged Agent Relay runtime build and activation.

On an unconnected host, the runner unit remains disabled and stopped. On an already connected host, runtime updates restart the existing listener after active jobs drain.

Ansible owns the checkout and deployment lifecycle. Do not manually clone, pull, edit Docker systemd drop-ins, register the runner, or invoke installation scripts on the target.

## One-time GitHub connection

After `host.yml` succeeds, export an organization credential:

```bash
export AGENT_RELAY_GITHUB_CREDENTIAL='github_pat_...'
```

A fine-grained PAT needs `Self-hosted runners: Read and write`. A classic PAT needs `admin:org`.

Run the separate connection playbook:

```bash
ANSIBLE_CONFIG="$PWD/ansible.cfg" \
ANSIBLE_ROLES_PATH="$PWD/roles" \
ansible-playbook \
  --inventory "$PWD/inventory/runners.ini" \
  "$PWD/playbooks/github-connect.yml"
```

This playbook does not rerun host provisioning and does not import `host.yml`. It only:

1. verifies that runner binaries, the runtime, and the service unit already exist;
2. creates runner registration when absent;
3. enables and starts the listener;
4. finds the organization runner named `gh-runner`;
5. adds `agent-relay` through the additive labels endpoint;
6. verifies the final label set.

The PAT is passed through standard input to `scripts/github-connect` and through authenticated GitHub API calls. It is hidden from Ansible output and is not stored on the target.

Rerun `github-connect.yml` only to repair registration service state or the managed label. Ordinary releases use only `host.yml` without a PAT.

## Expected first deployment sequence

```bash
cd ansible

ANSIBLE_CONFIG="$PWD/ansible.cfg" \
ANSIBLE_ROLES_PATH="$PWD/roles" \
ansible-playbook \
  --inventory "$PWD/inventory/runners.ini" \
  "$PWD/playbooks/host.yml"

export AGENT_RELAY_GITHUB_CREDENTIAL='github_pat_...'
ANSIBLE_CONFIG="$PWD/ansible.cfg" \
ANSIBLE_ROLES_PATH="$PWD/roles" \
ansible-playbook \
  --inventory "$PWD/inventory/runners.ini" \
  "$PWD/playbooks/github-connect.yml"
unset AGENT_RELAY_GITHUB_CREDENTIAL
```

## Later release sequence

```bash
cd ansible
ANSIBLE_CONFIG="$PWD/ansible.cfg" \
ANSIBLE_ROLES_PATH="$PWD/roles" \
ansible-playbook \
  --inventory "$PWD/inventory/runners.ini" \
  "$PWD/playbooks/host.yml"
```

## If Ansible cannot find a role

From the repository `ansible` directory, verify both roles:

```bash
test -f "$PWD/roles/agent_relay_host/tasks/main.yml"
test -f "$PWD/roles/agent_relay_github_connection/tasks/main.yml"
```

Check the active role path:

```bash
ansible-config dump --only-changed | grep DEFAULT_ROLES_PATH
```

Pass `ANSIBLE_CONFIG` and `ANSIBLE_ROLES_PATH` inline as shown above. Assigning them on separate lines without `export` does not pass them to `ansible-playbook`.

Do not commit private keys, passwords, GitHub tokens, or Codex credentials.

## Codex authentication

Codex authentication remains a separate explicit operation:

```bash
ssh agent-relay-admin@HOST
sudo -u github-runner -H /usr/local/bin/codex login
```

Neither `install.sh` nor `scripts/github-connect` authenticates Codex.

## Deployment behavior

The host role previews repository reconciliation before changing the target. When deployment is required, it stops an active listener, waits for `Runner.Worker` processes, updates the checkout, and runs `install.sh` as `agent-relay-admin`.

The installer validates host state, installs runner binaries when absent, installs the systemd unit, builds a staged runtime, and activates it by same-filesystem rename. It never calls the GitHub registration API. Registration state is only inspected to decide whether the listener should be restarted or remain disabled.

The Docker role keeps `/run/docker.sock` and adds `/srv/github-runner/storage/docker-socket/docker.sock`. When listener configuration changes, it stops `docker.service`, restarts `docker.socket`, and then starts Docker so `dockerd -H fd://` receives both descriptors.

## Interrupted runtime swap

Normally `dist.previous` exists only between two rename operations and is deleted after successful activation.

If an interrupted run leaves `dist.previous`:

1. keep the runner stopped;
2. inspect `dist` and `dist.previous` as root-owned regular directory trees;
3. when `dist` is absent, restore the validated previous tree:

   ```bash
   sudo mv /srv/github-runner/storage/agent-relay/dist.previous \
     /srv/github-runner/storage/agent-relay/dist
   ```

4. when a valid `dist` exists, deliberately remove the stale previous tree;
5. rebuild the host when state cannot be established safely.

Listener startup failure does not trigger runtime rollback because the listener does not load the runtime during build validation.

## Status

```bash
sudo systemctl status actions.runner.Divorium.gh-runner.service
sudo systemctl status docker.socket docker.service
sudo test -S /run/docker.sock
sudo test -S /srv/github-runner/storage/docker-socket/docker.sock
sudo -u github-runner -H env \
  DOCKER_HOST=unix:///srv/github-runner/storage/docker-socket/docker.sock \
  docker info
```

Both Docker sockets must exist. The dedicated directory must be owned by `github-runner`, the socket must be `root:docker` mode `0660`, and the runner account must belong to `docker`.

When the dedicated socket is missing or stale, rerun `host.yml`. Do not create a symlink to `/run/docker.sock`, grant write access to `/run`, or edit the systemd unit manually.

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

Codex output is normalized, redacted, and streamed with a fixed `[codex] ` prefix. The same accepted bytes are written to `agent-relay-output`. Raw JSONL remains internal, and `${GITHUB_OUTPUT}` contains workflow outputs only.

A zero process exit is insufficient for success. Agent Relay requires at least one `command_execution` or `file_change` lifecycle item; a session that only reports inability to operate fails before finalization.
