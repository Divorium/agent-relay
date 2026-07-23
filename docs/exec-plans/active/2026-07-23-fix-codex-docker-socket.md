# Fix the Codex Docker socket sandbox boundary

This ExecPlan is governed by `.agent/PLANS.md`. Keep it active until the corrected Agent Relay revision is deployed and a real Monify pull request proves command execution, Docker access, Token Minify helper access, and trusted finalization.

## Purpose / Big Picture

Agent Relay must let Codex execute repository and Docker commands on the dedicated GitHub Actions runner without giving Codex Git credentials.

The original runtime exposed `/run/docker.sock` and `/var/run/docker.sock` as writable filesystem roots. Codex treats every writable root as a directory and attempted to inspect `/run/docker.sock/.codex`, so execution failed before the first command.

The corrected design exposes a second real Docker socket at `/srv/github-runner/storage/docker-socket/docker.sock`. Codex receives write access to the containing directory, and `DOCKER_HOST` points Docker clients to the socket child. A zero process exit is accepted only after the runtime observes at least one `command_execution` or `file_change` lifecycle event.

The Ansible lifecycle has two disjoint entrypoints:

- `ansible/playbooks/host.yml` directly installs and updates the complete host and Agent Relay runtime without a GitHub PAT and without executing an installer script;
- `ansible/playbooks/github-connect.yml` performs only GitHub runner registration, listener activation, and managed label reconciliation with a PAT.

Neither playbook imports, includes, or reruns the other.

## Progress

- [x] Reproduced the Monify PR 48 socket-file sandbox failure.
- [x] Selected a second systemd-activated Docker socket beneath a dedicated runner-owned directory.
- [x] Added the socket contract, launcher validation, `DOCKER_HOST`, sandbox permissions, tests, and documentation.
- [x] Added the managed `agent-relay` label and deterministic `[self-hosted, agent-relay]` routing.
- [x] Moved semantic success validation into `CodexExecutor`.
- [x] Split host deployment and GitHub connection into disjoint playbooks and roles.
- [x] Routed `worker-run` logs into each Codex execution's private runtime.
- [x] Reproduced the first real host deployment failure caused by Docker canonicalizing its data-root mode to `0710`.
- [x] Corrected the declared Docker data-root mode while retaining `0711` for the parent and containerd root.
- [x] Rejected the host-role-to-`install.sh` design after operator review.
- [x] Replaced host installer execution with direct Ansible tasks for runner payload, service unit, runtime staging, validation, atomic activation, rollback, and listener state.
- [x] Replaced the installer lock with one lifecycle lock shared by host deployment and GitHub connection.
- [x] Restored CI to `contents: read` with `persist-credentials: false` and removed the temporary self-patching workflow.
- [ ] Run complete CI on the final direct-Ansible implementation.
- [ ] User merges PR 58.
- [ ] Run `host.yml` on the target without a PAT.
- [ ] Run `github-connect.yml` with `AGENT_RELAY_GITHUB_CREDENTIAL` when runner connection is required.
- [ ] Verify both Docker sockets, registration, label state, dedicated Docker access, and deployed finalizer revision.
- [ ] Rerun Monify PR 48 and inspect commands, helpers, Docker, transcript, and finalization.
- [ ] Prove a later release through PAT-free `host.yml` only.
- [ ] Move this plan to `completed/` after consumer acceptance.

## Surprises & Discoveries

- A Unix socket file cannot be a writable Codex filesystem root; the writable root must be its containing directory.
- A zero Codex exit does not prove command or file execution occurred.
- Runner labels must constrain scheduling before allocation; a later runner-name assertion is only defense in depth.
- Host installation and GitHub connection are separate lifecycle concerns.
- Making a PAT optional in one combined lifecycle still couples host updates to external credentials.
- Docker changes its data-root mode after startup; Ansible must declare the final daemon-owned mode instead of fighting it.
- A host role that invokes a monolithic installer hides lifecycle ownership and duplicates state validation. The host role must own each mutation directly through Ansible tasks and templates.
- GitHub connection and host deployment still require mutual exclusion even after the installer is removed. An atomic directory lock provides the shared boundary without passing a PAT to host deployment.
- Token Minify helpers require a writable per-execution log directory inside the Codex sandbox.

## Decision Log

- Use `/srv/github-runner/storage/docker-socket/docker.sock` as a second real Docker endpoint.
- Keep its directory `github-runner`-owned mode `0700` and its socket `root:docker` mode `0660`.
- Route consumers with `[self-hosted, agent-relay]` and retain the exact runner-name assertion.
- Keep runner binary installation in the host lifecycle and registration in the connection lifecycle.
- Implement host deployment directly in `agent_relay_host`; do not execute `install.sh` or any equivalent monolithic installer.
- Keep `host.yml` completely PAT-free. Only `agent_relay_github_connection` may consume `AGENT_RELAY_GITHUB_CREDENTIAL`.
- Use `/var/lib/agent-relay/lifecycle/active` as the shared atomic lock.
- Build runtime as `agent-relay-builder`, validate before activation, finalize as `root:root`, and activate by same-filesystem rename with rollback.
- Set `TOKEN_MINIFY_RUN_LOG_DIR` beneath the launcher-created private runtime.

## Responsibility Boundaries

`agent_relay_host` owns:

- packages, users, filesystem, Docker, containerd, sockets, and toolchains;
- verified GitHub Runner payload and service unit;
- source checkout and permissions;
- runtime build, validation, atomic activation, rollback, and listener reconciliation.

It owns no PAT variable, registration-token call, `config.sh` invocation, or runner-label API request.

`agent_relay_github_connection` owns:

- PAT intake;
- absent runner registration;
- listener activation after registration;
- exact runner lookup and additive label reconciliation.

It owns no package, Docker, toolchain, source, runner payload, service unit, or runtime deployment task.

## Concrete Steps

From the Agent Relay repository root:

```bash
npm ci
npm run check
git diff --check main...HEAD
git diff --stat main...HEAD
```

After merge, from `ansible/`:

```bash
ANSIBLE_CONFIG="$PWD/ansible.cfg" \
ANSIBLE_ROLES_PATH="$PWD/roles" \
ansible-playbook \
  --inventory "$PWD/inventory/example.ini" \
  "$PWD/playbooks/host.yml"
```

Connect GitHub only when required:

```bash
export AGENT_RELAY_GITHUB_CREDENTIAL='github_pat_...'
ANSIBLE_CONFIG="$PWD/ansible.cfg" \
ANSIBLE_ROLES_PATH="$PWD/roles" \
ansible-playbook \
  --inventory "$PWD/inventory/example.ini" \
  "$PWD/playbooks/github-connect.yml"
unset AGENT_RELAY_GITHUB_CREDENTIAL
```

Verify:

```bash
sudo systemctl status actions.runner.Divorium.gh-runner.service
sudo systemctl status docker.socket docker.service
sudo test -S /run/docker.sock
sudo test -S /srv/github-runner/storage/docker-socket/docker.sock
sudo -u github-runner -H env \
  DOCKER_HOST=unix:///srv/github-runner/storage/docker-socket/docker.sock \
  docker version
sudo -u github-runner -H env \
  DOCKER_HOST=unix:///srv/github-runner/storage/docker-socket/docker.sock \
  docker compose version
```

Then rerun Monify PR 48 with:

```bash
worker-run -- pwd
worker-run -- bash -lc 'command -v worker-read worker-run worker-write worker-extract-chat'
worker-run -- docker version
worker-run -- docker compose version
```

## Validation and Acceptance

1. CI passes typecheck, tests with 100 percent line, branch, and function coverage, runtime build, shell checks, Node script checks, toolchain smoke, static deployment tests, and GitHub connection integration tests.
2. `host.yml` and `agent_relay_host` contain no PAT handling, registration-token request, runner-label API, `config.sh` registration invocation, or installer execution.
3. The host role directly reconciles runner payload, systemd unit, runtime stage, activation, rollback, and service state.
4. `github-connect.yml` and its role contain no host provisioning task or host-role invocation.
5. A fresh host installation succeeds without registration and leaves the listener disabled.
6. GitHub connection fails before host prerequisites exist.
7. GitHub connection registers an absent runner, starts it, and reconciles the managed label.
8. Repeated GitHub connection does not duplicate registration.
9. A later host update preserves registration and starts the existing listener without a PAT.
10. Concurrent host and connection operations fail through the shared lifecycle lock.
11. Codex sees only the dedicated Docker directory as writable and uses its socket through `DOCKER_HOST`.
12. A zero-exit Codex process without command or file-change activity fails.
13. Finalization commits and pushes only through the trusted runner script.
14. `worker-run` writes command logs beneath the launcher-created private runtime.

## Idempotence and Recovery

`host.yml` is the repeatable installation and release operation. It installs runner binaries when absent, validates existing runner payloads without fighting supported runner self-update, rebuilds runtime when deployment state requires reconciliation, preserves complete registration, and leaves absent registration inactive.

`github-connect.yml` is a narrow idempotent connection and recovery operation. It creates registration only when absent and always verifies the managed label.

Partial or unsafe runner binary or registration state is a hard failure. Neither lifecycle deletes ambiguous state automatically.

If runtime build or import fails, the active runtime remains unchanged. If activation fails, the validated previous runtime is restored when safe. A previously active registered listener is restarted after failure when the preserved runtime remains valid.

If the lifecycle lock remains after interruption, confirm no Ansible or GitHub connection process is active, then remove only `/var/lib/agent-relay/lifecycle/active`.

If the dedicated Docker socket is missing or stale, rerun `host.yml`; do not create a symlink or grant broad access to `/run`.

## Artifacts and Notes

Original consumer failure:

```text
repository: Divorium/monify
pull request: 48
workflow run: 30033072687
job: 89296098924
message: failed to inspect synthetic bubblewrap mount target /run/docker.sock/.codex: Not a directory
```

First real host deployment failure:

```text
Unexpected mode for /srv/github-runner/storage/docker/engine; expected 711
```

The final contract uses `0710` for Docker's daemon-owned data root and `0711` for its parent and the containerd root.

No merge is performed by this plan executor.
