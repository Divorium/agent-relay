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
- pinned language toolchains and the latest available Codex CLI on every run;
- official GitHub Runner binaries;
- the runner systemd unit;
- managed source checkout;
- staged Agent Relay runtime build, source-revision marker, and atomic activation;
- registered-listener restart or unregistered-listener shutdown.

All host deployment behavior is expressed as Ansible tasks and templates. The host role does not execute an installer script, perform runner registration, call the GitHub runner API, reconcile GitHub labels, or consume a PAT.

Ansible owns the checkout and deployment lifecycle. Do not manually clone, pull, edit Docker systemd drop-ins, replace runner binaries, register the runner, or mutate runtime directories on the target.

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

1. verifies that runner binaries, runtime, and service unit exist;
2. creates runner registration when absent;
3. enables and starts the listener;
4. finds the organization runner named `gh-runner`;
5. adds `agent-relay` through the additive labels endpoint when absent.

Ansible uses the PAT only in authenticated GitHub API calls delegated to the control machine. Tasks handling the PAT and short-lived registration token use `no_log`; the PAT is never sent to the target, and neither credential is stored there.

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

Neither host deployment nor GitHub connection authenticates Codex.

## Deployment behavior

The host role reconciles the configured repository revision and compares its commit with `dist/.agent-relay-source-revision`; a missing, unsafe, or mismatched marker requires a rebuild.

When runner files, the pinned runner version, the service unit, or the runtime revision require reconciliation, the role stops an active listener, drains `Runner.Worker` processes, applies the required tasks, and restores the listener for complete registration. Runtime activation remains an atomic directory swap.

The host role declares `runner/_work` as a real `github-runner:github-runner` mode `0700` directory. It does not contain compatibility cleanup for the previous symlink layout.

A host reconciliation stops the registered listener before changing packages, container services, toolchains, runner files, or runtime files, then waits for the active `Runner.Worker` process to exit. A build or import failure leaves the active runtime unchanged. A runtime activation failure restores `dist.previous` when possible. A runner update is extracted and validated in a private staging directory; activation preserves `_work` and registration files and restores the previous payload when validation fails. When reconciliation fails, Ansible restarts the preserved listener only when the old runtime remains valid. A later run retries the failed reconciliation.

The Docker role keeps `/run/docker.sock` and adds `/srv/github-runner/storage/docker-socket/docker.sock`. When container configuration changes, handlers stop Docker, restart containerd and `docker.socket`, and then start Docker so `dockerd -H fd://` receives both descriptors.

Ansible declares the final daemon-owned filesystem modes: `/srv/github-runner/storage/docker` and the containerd root are `root:root` mode `0711`, while Docker data root `/srv/github-runner/storage/docker/engine` is `root:root` mode `0710`.

For each Codex execution, `scripts/codex-run` routes `worker-run` command logs into that execution's private writable runtime through `TOKEN_MINIFY_RUN_LOG_DIR`. The runtime is removed when the launcher exits; `/var/lib/codex-token-minify` does not need to be writable inside the Codex sandbox.

## Interrupted runtime swap

Normally `dist.previous` exists only between two rename operations and is deleted after successful activation. A later `host.yml` run restores it when `dist` is absent or removes it when `dist` already exists. Ansible stops only when either path is not a regular directory.

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
/srv/github-runner/storage/agent-relay/dist/.agent-relay-source-revision
/srv/github-runner/storage/runner
/srv/github-runner/storage/runner/_work
/srv/github-runner/storage/home
/srv/github-runner/storage/build-home
/srv/github-runner/storage/docker/engine
/srv/github-runner/storage/docker/containerd
/srv/github-runner/storage/docker-socket/docker.sock
/srv/github-runner/storage/.agent-relay-dist-stage
```

## Codex output

Codex output is normalized, redacted, and streamed with a fixed `[codex] ` prefix. The same accepted bytes are written to `agent-relay-output`. Raw JSONL remains internal, and `${GITHUB_OUTPUT}` contains workflow outputs only.

A zero process exit is insufficient for success. Agent Relay requires at least one completed command execution or one completed file-change item containing at least one change. Empty file-change items and commands that only started do not satisfy the gate. After live output reaches its byte limit, JSONL parsing and semantic activity tracking continue while further normalized output is discarded.
