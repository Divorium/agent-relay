# Fix the Codex Docker socket sandbox boundary

This ExecPlan is governed by `.agent/PLANS.md`. Keep it active until the corrected Agent Relay revision is deployed and a real Monify pull request proves command execution, Docker access, Token Minify helper access, and trusted finalization.

## Purpose / Big Picture

Agent Relay must let Codex execute repository and Docker commands on the dedicated GitHub Actions runner without giving Codex Git credentials.

The original runtime exposed `/run/docker.sock` and `/var/run/docker.sock` as writable filesystem roots. Codex treats every writable root as a directory and attempted to inspect `/run/docker.sock/.codex`, so execution failed before the first command.

The corrected design exposes a second real Docker socket at `/srv/github-runner/storage/docker-socket/docker.sock`. Codex receives write access to the containing directory, and `DOCKER_HOST` points Docker clients to the socket child. A zero process exit is accepted only after the runtime observes a completed command execution or a completed file-change item containing at least one change.

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
- [x] Counted only completed commands and completed non-empty file changes as semantic execution activity.
- [x] Continued JSONL lifecycle processing after live transcript truncation while discarding additional rendered output.
- [x] Split host deployment and GitHub connection into disjoint playbooks and roles.
- [x] Routed `worker-run` logs into each Codex execution's private runtime.
- [x] Reproduced the first real host deployment failure caused by Docker canonicalizing its data-root mode to `0710`.
- [x] Corrected the declared Docker data-root mode while retaining `0711` for the parent and containerd root.
- [x] Rejected the host-role-to-`install.sh` design after operator review.
- [x] Replaced host installer execution with direct Ansible tasks for runner payload, service unit, runtime staging, validation, atomic activation, rollback, and listener state.
- [x] Built and imported the staged runtime through a clean environment.
- [x] Finalized and revalidated the staged runtime without following links or crossing filesystems.
- [x] Added an active-runtime source revision marker so a failed build is retried instead of becoming a false no-op.
- [x] Replaced the installer lock with one lifecycle lock shared by host deployment and GitHub connection.
- [x] Moved public pull-request validation to an ephemeral GitHub-hosted runner while retaining exact production toolchain checks in `host.yml` and the self-hosted Codex workflow.
- [x] Removed obsolete installer tests and corrected integration mocks to model root ownership explicitly.
- [x] Completed full repository CI run `30055241859` with typecheck, 100 percent coverage, runtime build, shell checks, Node checks, and system integration passing.
- [ ] User merges PR 58.
- [ ] Run `host.yml` on the target without a PAT.
- [ ] Run `github-connect.yml` with `AGENT_RELAY_GITHUB_CREDENTIAL` when runner connection is required.
- [ ] Verify both Docker sockets, registration, label state, dedicated Docker access, runtime revision marker, and deployed finalizer revision.
- [ ] Rerun Monify PR 48 and inspect commands, helpers, Docker, transcript, and finalization.
- [ ] Prove a later release through PAT-free `host.yml` only.
- [ ] Move this plan to `completed/` after consumer acceptance.

## Surprises & Discoveries

- A Unix socket file cannot be a writable Codex filesystem root; the writable root must be its containing directory.
- A zero Codex exit does not prove command or file execution occurred.
- A started command is not sufficient evidence of execution completion, and an empty file-change item is not a substantive change.
- Reaching the transcript byte limit must stop rendering, not JSONL lifecycle processing or semantic activity tracking.
- A checkout commit alone cannot identify the active compiled runtime after a failed build; the activated runtime needs its own source revision marker.
- Runner labels must constrain scheduling before allocation; a later runner-name assertion is only defense in depth.
- Persistent self-hosted runners are not an appropriate default for public pull-request validation; ordinary CI can use an ephemeral hosted runner while privileged Codex execution remains separately controlled.
- Host installation and GitHub connection are separate lifecycle concerns.
- Making a PAT optional in one combined lifecycle still couples host updates to external credentials.
- Docker changes its data-root mode after startup; Ansible must declare the final daemon-owned mode instead of fighting it.
- A host role that invokes a monolithic installer hides lifecycle ownership and duplicates state validation. The host role must own each mutation directly through Ansible tasks and templates.
- GitHub connection and host deployment still require mutual exclusion even after the installer is removed. An atomic directory lock provides the shared boundary without passing a PAT to host deployment.
- Token Minify helpers require a writable per-execution log directory inside the Codex sandbox.
- Integration tests for privileged paths must model expected ownership explicitly instead of inheriting the account that runs CI.

## Decision Log

- Use `/srv/github-runner/storage/docker-socket/docker.sock` as a second real Docker endpoint.
- Keep its directory `github-runner`-owned mode `0700` and its socket `root:docker` mode `0660`.
- Route consumers with `[self-hosted, agent-relay]` and retain the exact runner-name assertion.
- Keep runner binary installation in the host lifecycle and registration in the connection lifecycle.
- Implement host deployment directly in `agent_relay_host`; do not execute `install.sh` or any equivalent monolithic installer.
- Keep `host.yml` completely PAT-free. Only `agent_relay_github_connection` may consume `AGENT_RELAY_GITHUB_CREDENTIAL`.
- Use `/var/lib/agent-relay/lifecycle/active` as the shared atomic lock.
- Build runtime as `agent-relay-builder`, validate before activation, finalize as `root:root`, and activate by same-filesystem rename with rollback.
- Store the exact checked-out source commit in `dist/.agent-relay-source-revision` and rebuild when the marker is absent, unsafe, or different from the desired revision.
- Keep parsing Codex JSONL after rendered output truncation so semantic completion remains accurate.
- Set `TOKEN_MINIFY_RUN_LOG_DIR` beneath the launcher-created private runtime.
- Run public pull-request repository validation on `ubuntu-24.04`; validate the exact managed host toolchain during `host.yml` and the self-hosted Codex validation workflow.

## Responsibility Boundaries

`agent_relay_host` owns:

- packages, users, filesystem, Docker, containerd, sockets, and toolchains;
- verified GitHub Runner payload and service unit;
- source checkout and permissions;
- runtime build, source revision marker, validation, atomic activation, rollback, and listener reconciliation.

It owns no PAT variable, registration-token call, `config.sh` invocation, or runner-label API request.

`agent_relay_github_connection` owns:

- PAT intake;
- absent runner registration;
- listener activation after registration;
- exact runner lookup and additive label reconciliation.

It owns no package, Docker, toolchain, source, runner payload, service unit, or runtime deployment task.

Public pull-request CI owns repository validation only. It does not reproduce the privileged Debian host or validate the exact installed Java, Go, Rust, Codex, Docker, and runner environment.

## Concrete Steps

From the Agent Relay repository root:

```bash
npm ci
npm run typecheck
npm test
npm run check:runtime
npm run check:shell
npm run check:node-scripts
npm run check:system
git diff --check main...HEAD
git diff --stat main...HEAD
```

The exact production toolchain is validated on the managed host by `host.yml` and on the self-hosted Codex validation workflow through `npm run check:toolchain`.

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
sudo test -f /srv/github-runner/storage/agent-relay/dist/.agent-relay-source-revision
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

1. Public pull-request CI passes typecheck, tests with 100 percent line, branch, and function coverage, runtime build, shell checks, Node script checks, static deployment tests, and GitHub connection integration tests.
2. `host.yml` validates the exact managed production toolchain before runtime activation; the self-hosted Codex workflow also runs `npm run check:toolchain`.
3. `host.yml` and `agent_relay_host` contain no PAT handling, registration-token request, runner-label API, `config.sh` registration invocation, or installer execution.
4. The host role directly reconciles runner payload, systemd unit, runtime stage, source revision marker, activation, rollback, and service state.
5. `github-connect.yml` and its role contain no host provisioning task or host-role invocation.
6. A fresh host installation succeeds without registration and leaves the listener disabled.
7. GitHub connection fails before host prerequisites exist.
8. GitHub connection registers an absent runner, starts it, and reconciles the managed label.
9. Repeated GitHub connection does not duplicate registration.
10. A later host update preserves registration and starts the existing listener without a PAT.
11. Concurrent host and connection operations fail through the shared lifecycle lock.
12. Codex sees only the dedicated Docker directory as writable and uses its socket through `DOCKER_HOST`.
13. A zero-exit Codex process without a completed command or completed non-empty file change fails, including when transcript rendering has already been truncated.
14. Finalization commits and pushes only through the trusted runner script.
15. `worker-run` writes command logs beneath the launcher-created private runtime.
16. A failed runtime build followed by a repeated `host.yml` run rebuilds because the active revision marker does not match the desired checkout.

## Idempotence and Recovery

`host.yml` is the repeatable installation and release operation. It installs runner binaries when absent, validates existing runner payloads without fighting supported runner self-update, rebuilds runtime when deployment state requires reconciliation, preserves complete registration, and leaves absent registration inactive.

Deployment preview compares the desired checkout commit with the root-owned mode `0644` runtime revision marker. Missing, unsafe, or mismatched marker state forces a runtime rebuild even when the checkout itself is already at the desired commit.

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

Review validation run:

```text
repository: Divorium/agent-relay
pull request: 58
workflow run: 30055241859
result: success
```

No merge is performed by this plan executor.
