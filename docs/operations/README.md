# Native GitHub Runner Operations

## Supported host

Agent Relay supports Debian 13 (Trixie) x86-64 with systemd as PID 1. A target needs network access and an SSH-capable `runneradmin` account with sudo access.

## Configure the control machine

```bash
cd ansible
cp inventory/group_vars/all.yml.example inventory/group_vars/all.yml
$EDITOR inventory/example.ini inventory/group_vars/all.yml
```

Replace `inventory/runners.ini` below with the configured inventory filename when different. Use `ansible-core >= 2.18`; SSH host-key checking remains enabled. The host playbook connects as `runneradmin` and asks for the sudo password with `-K`.

## Host lifecycle

`playbooks/host.yml` is the complete host installation and update entrypoint. Run it first on a fresh machine and for every later release:

```bash
ANSIBLE_CONFIG="$PWD/ansible.cfg" \
ANSIBLE_ROLES_PATH="$PWD/roles" \
ansible-playbook \
  --inventory "$PWD/inventory/runners.ini" \
  --ask-become-pass \
  "$PWD/playbooks/host.yml"
```

The host playbook does not require or read `AGENT_RELAY_GITHUB_CREDENTIAL`. It owns Python bootstrap, system packages/repositories, administrator/runner/builder accounts, secure filesystem roots, Docker/containerd and both sockets, pinned host toolchains, official runner binaries, systemd, managed source checkout, staged runtime compilation/revision marker/atomic activation, and listener lifecycle. It does not install, update, authenticate or uninstall Codex CLI.

All host deployment behavior is expressed as Ansible tasks and templates. The host role does not execute an installer script, perform runner registration, call the GitHub runner API, reconcile GitHub labels, or consume a PAT. Ansible owns the checkout and deployment lifecycle; do not manually change managed host paths or Docker systemd drop-ins.

## One-time GitHub connection

After `host.yml` succeeds, export an organization credential on the control machine:

```bash
export AGENT_RELAY_GITHUB_CREDENTIAL='github_pat_...'
ANSIBLE_CONFIG="$PWD/ansible.cfg" \
ANSIBLE_ROLES_PATH="$PWD/roles" \
ansible-playbook \
  --inventory "$PWD/inventory/runners.ini" \
  --ask-become-pass \
  "$PWD/playbooks/github-connect.yml"
unset AGENT_RELAY_GITHUB_CREDENTIAL
```

A fine-grained PAT needs `Self-hosted runners: Read and write`; a classic PAT needs `admin:org`. This separate playbook verifies prepared host state, obtains a short-lived registration token, registers an absent runner, enables its listener and reconciles inventory-owned labels. It does not install host/runtime components or invoke `host.yml`. API calls are delegated to the control machine and use `no_log`; the PAT and registration token are not stored on the target. Rerun only for connection or label recovery.

## Later release sequence

Run only `host.yml`, without exporting a PAT. Ansible reconciles its configured repository revision and compares `dist/.agent-relay-source-revision`; missing or mismatched active state requires a rebuild. This does not control the Codex version chosen by a consumer workflow.

## If Ansible cannot find a role

From the repository `ansible` directory:

```bash
test -f "$PWD/roles/agent_relay_host/tasks/main.yml"
test -f "$PWD/roles/agent_relay_github_connection/tasks/main.yml"
ansible-config dump --only-changed | grep DEFAULT_ROLES_PATH
```

Pass `ANSIBLE_CONFIG` and `ANSIBLE_ROLES_PATH` inline as shown. Do not commit private keys, passwords, GitHub tokens or Codex credentials.

## Codex installation and authentication

Consumer workflows use [the native job contract](../job-managed-codex.md). Select an exact `CODEX_VERSION`, a reviewed runtime revision and `${RUNNER_TOOL_CACHE}/codex-cli`; pass the existing `CODEX_TOKEN` only to the setup step. No operator `codex login` or global `/usr/local/bin/codex` is needed. A global CLI left by an older deployment is not used and is not destructively removed by a PR test.

The setup helper installs missing versions atomically, reuses warm versions and retains active-version leases. Job authentication lives in a private temporary `CODEX_HOME`. The restricted launcher receives the selected executable and home without inheriting raw GitHub credentials. Normal failure and handled interruption remove the job's login/tool state. CLI cache remains intentionally; machine loss or SIGKILL may require trusted cleanup of confirmed abandoned state.

The existing dedicated Docker socket remains privileged access to the host daemon. Do not represent the sandbox as full protection against daemon-mediated access. Test scripts must address and clean only their own resources. No global Docker prune is part of CLI setup.

## Deployment behavior

A host reconciliation stops the registered listener before changing packages, container services, toolchains, runner files or runtime files, then waits for `Runner.Worker` to exit. Build/import failure leaves the active runtime unchanged. Activation failure restores `dist.previous` when safe. Runner updates use a checksum-verified stage and temporary backup, preserving `_work` and registration. A handled failure restarts a previously valid listener; a later run retries failed reconciliation. An unregistered host remains stopped.

The host role declares `runner/_work` as a real `github-runner:github-runner` mode `0700` directory. It does not contain compatibility cleanup for the previous symlink layout. Docker keeps `/run/docker.sock` and `/srv/github-runner/storage/docker-socket/docker.sock`; socket changes stop Docker, restart containerd/socket listeners and then restart Docker so `dockerd -H fd://` receives both descriptors.

The Docker storage parent and containerd root remain `root:root` mode `0711`; Docker's data root remains mode `0710`. Per-execution `worker-run` logs live inside the launcher's private runtime, so `/var/lib/codex-token-minify` need not become writable in the model sandbox.

## Interrupted runtime swap

Normally `dist.previous` exists only between rename operations and is deleted after successful activation. A later `host.yml` restores it when `dist` is absent or removes it when `dist` exists. Unsafe file types stop recovery rather than widening cleanup.

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

Both sockets must exist. The dedicated directory is runner-owned, the socket is `root:docker` mode `0660`, and the runner account belongs to `docker`. When missing or stale, reconcile through `host.yml`; do not symlink `/run/docker.sock`, grant write access to `/run` or edit systemd manually.

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

Output is normalized, redacted and streamed with a fixed `[codex]` prefix. Raw JSONL remains internal; `${GITHUB_OUTPUT}` contains workflow outputs only. A zero exit requires completed command execution or a completed non-empty file change. Parsing/activity checks continue after the live byte limit. Current workflows keep diagnostics in Actions logs and do not add public artifact uploads. Missing application test evidence remains a blocker even after native acceptance passes.
