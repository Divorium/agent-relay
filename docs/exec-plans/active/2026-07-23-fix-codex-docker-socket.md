# Fix the Codex Docker socket sandbox boundary

This ExecPlan is governed by `.agent/PLANS.md`. Keep it active until the corrected Agent Relay revision is deployed and a real Monify pull request proves command execution, Docker access, Token Minify helper access, and trusted finalization.

## Purpose / Big Picture

Agent Relay must let Codex execute repository and Docker commands on the dedicated GitHub Actions runner without giving Codex Git credentials.

The original runtime exposed `/run/docker.sock` and `/var/run/docker.sock` as writable filesystem roots. Codex treats every writable root as a directory and attempted to inspect `/run/docker.sock/.codex`, so execution failed before the first command.

The corrected design exposes a second real Docker socket at `/srv/github-runner/storage/docker-socket/docker.sock`. Codex receives write access to the containing directory, and `DOCKER_HOST` points Docker clients to the socket child. A zero process exit is accepted only after the runtime observes at least one `command_execution` or `file_change` lifecycle event.

The Ansible lifecycle has two disjoint entrypoints:

- `ansible/playbooks/host.yml` installs and updates the complete host and Agent Relay runtime without a GitHub PAT;
- `ansible/playbooks/github-connect.yml` runs after `host.yml` and performs only GitHub runner registration, listener activation, and managed label reconciliation with a PAT.

Neither playbook imports, includes, or reruns the other.

## Progress

- [x] (2026-07-23 19:35Z) Reproduced the Monify failure from PR 48, workflow run 30033072687, job 89296098924.
- [x] (2026-07-23 19:45Z) Traced the failure to socket files being declared as writable Codex roots.
- [x] (2026-07-23 20:00Z) Selected a second systemd-activated Docker socket beneath a dedicated runner-owned directory.
- [x] (2026-07-23 20:15Z) Added the socket contract, Ansible socket configuration, launcher validation, `DOCKER_HOST`, sandbox permissions, tests, and documentation.
- [x] (2026-07-23 20:22Z) Added the managed `agent-relay` runner label and changed Monify routing to `[self-hosted, agent-relay]` while retaining the exact runner-name check.
- [x] (2026-07-23 20:42Z) Corrected two P1 findings: Docker is stopped before socket listener reconfiguration, and semantic success is enforced inside `CodexExecutor` for every caller.
- [x] (2026-07-23 21:12Z) Removed the requirement to expose a PAT during recurring host updates.
- [x] (2026-07-23 21:22Z) Replaced the overlapping `install.yml -> host.yml` design with two disjoint roles and playbooks.
- [x] (2026-07-23 21:22Z) Made `install.sh` host-only: it installs runner binaries, the systemd unit, and Agent Relay runtime but never obtains a registration token or invokes `config.sh`.
- [x] (2026-07-23 21:22Z) Added `scripts/github-connect`, which validates the prepared host, registers the runner when absent, starts the listener, and leaves host installation untouched.
- [x] (2026-07-23 21:22Z) Moved runner-label reconciliation out of `agent_relay_host` into the separate `agent_relay_github_connection` role.
- [x] (2026-07-23 21:28Z) Added behavioral integration coverage proving: connection before host installation fails; host installation uses no PAT and performs no registration; connection registers and starts the listener; repeated connection does not duplicate registration; later host updates preserve registration and use no PAT.
- [x] (2026-07-23 21:29Z) Observed complete successful CI run 30046295586 on SHA `2ca79371a30a872d3318278573ad2f930cfdce18` after the lifecycle split. Typecheck, Node tests with 100 percent coverage, runtime build, shell checks, Node script checks, toolchain smoke, and behavioral system tests passed.
- [ ] Confirm the final plan-only SHA receives the same complete green CI.
- [ ] User merges PR 58.
- [ ] Run `host.yml` on the target to deploy the dedicated Docker socket and current runtime.
- [ ] Run `github-connect.yml` once with `AGENT_RELAY_GITHUB_CREDENTIAL` to reconcile registration and `agent-relay` label state.
- [ ] Verify both Docker sockets, GitHub label state, runner listener, dedicated Docker access, and deployed finalizer revision.
- [ ] Rerun Monify PR 48 and inspect command execution, Token Minify helpers, Docker access, transcript, and finalization.
- [ ] Prove a later release through PAT-free `host.yml` only.
- [ ] Move this plan to `completed/` after consumer acceptance.

## Surprises & Discoveries

- Observation: A Unix socket file cannot be used directly as a writable Codex filesystem root.
  Evidence: Monify reported `failed to inspect synthetic bubblewrap mount target /run/docker.sock/.codex: Not a directory`.

- Observation: A zero Codex exit does not prove execution occurred.
  Evidence: the original Monify workflow marked the Codex step successful despite no command or file-change lifecycle event.

- Observation: checking `runner.name` after allocation is fail-closed but not deterministic scheduling.
  Evidence: multiple runners matched `self-hosted`; requiring both `self-hosted` and `agent-relay` restricts eligibility before allocation.

- Observation: an existing runner label must be managed through the GitHub runner-label API.
  Evidence: `config.sh` cannot add a label to an existing registered runner without reconfiguration, while the additive REST endpoint preserves unrelated labels.

- Observation: host installation and GitHub connection are separate lifecycle concerns.
  Evidence: runner binaries, service unit, Docker, toolchains, and runtime can be installed without organization credentials; only registration and label API operations require the PAT.

- Observation: making a PAT optional inside one combined playbook still couples the lifecycles.
  Evidence: the rejected `install.yml` imported `host.yml` and repeated all host reconciliation during a connection-only operation.

- Observation: a fresh host must remain inactive until registration is complete.
  Evidence: `install.sh` now disables and stops the runner unit when registration files are absent; `github-connect` starts it only after successful registration.

- Observation: GitHub Contents writes do not reliably provide an executable bit for a new script.
  Evidence: the connection role invokes `scripts/github-connect` explicitly through `bash`, removing the filesystem-mode assumption.

- Observation: restarting `docker.socket` while the current daemon still owns inherited listeners is unsafe.
  Evidence: the corrected Ansible order stops Docker, restarts the socket unit, then starts Docker.

- Observation: reverting Git source does not remove an already deployed systemd drop-in.
  Evidence: rollback of the dedicated socket requires an explicit cleanup revision or documented emergency removal.

## Decision Log

- Decision: Use `/srv/github-runner/storage/docker-socket/docker.sock` as a second systemd-activated Docker endpoint.
  Rationale: it is a real socket beneath a directory Codex can safely treat as writable while preserving `/run/docker.sock` for host operators.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Keep the socket directory `github-runner`-owned mode `0700` and the socket `root:docker` mode `0660`.
  Rationale: Codex needs the directory boundary, while Docker access remains within the intentional Docker-group trust model.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Enforce semantic execution success inside `CodexExecutor.run`.
  Rationale: every caller must reject zero-exit sessions that performed no command or file change.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Route consumer jobs using `[self-hosted, agent-relay]` and retain `runner.name == gh-runner` as defense in depth.
  Rationale: labels provide deterministic scheduling; the name assertion protects against a wrongly labeled host.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Keep `host.yml` and `github-connect.yml` completely disjoint.
  Rationale: host provisioning is repeatable release state and requires no organization credential; GitHub connection is a narrow credentialed operation performed after host readiness.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Keep runner binary installation in the host lifecycle and registration in the connection lifecycle.
  Rationale: the official runner payload and systemd unit are host software; `.runner`, `.credentials`, and `.credentials_rsaparams` are external GitHub connection state.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Use the same installation lock for `install.sh` and `scripts/github-connect`.
  Rationale: host runtime mutation and runner registration must never execute concurrently against the same runner directory and service.
  Date/Author: 2026-07-23 / ChatGPT

## Outcomes & Retrospective

The branch now has four explicit boundaries:

1. the host role owns packages, users, filesystem, Docker, toolchains, runner binaries, service unit, checkout, and runtime;
2. the GitHub connection role owns PAT handling, runner registration, listener activation, and label reconciliation;
3. Codex owns implementation work but has no Git credentials and cannot mutate Git;
4. the trusted runner finalizer owns commit and push operations.

`host.yml` can run on a completely fresh machine without a PAT and leaves an unregistered listener disabled. `github-connect.yml` then performs only external GitHub connection. Every later release runs `host.yml` alone and preserves complete registration state.

CI run 30046295586 proved both static boundaries and the behavioral sequence. Environmental acceptance remains after merge because static and simulated tests cannot prove the real systemd descriptor handoff, GitHub organization label state, Codex bubblewrap behavior, installed Token Minify helpers, and real finalizer execution together.

## Context and Orientation

`ansible/playbooks/host.yml` applies only `agent_relay_host`.

`ansible/roles/agent_relay_host` contains no PAT variable, registration-token call, label API task, or GitHub connection role dependency.

`install.sh` installs runner binaries and runtime. It inspects registration state only to decide whether to restart an existing listener or leave an unregistered listener disabled.

`ansible/playbooks/github-connect.yml` applies only `agent_relay_github_connection` and does not import `host.yml`.

`ansible/roles/agent_relay_github_connection` requires the PAT, invokes `bash scripts/github-connect`, and imports its own runner-label reconciliation task.

`scripts/github-connect` verifies host prerequisites, obtains a short-lived registration token when required, invokes `config.sh`, protects registration files, enables the service, and waits for `Runner.Listener`.

`config/runner-host.json` remains the single host contract for runner identity, versions, paths, Docker socket, and managed label.

`test/runner-label-boundary.test.ts` statically enforces role and playbook isolation. `test/installer.test.ts` enforces script responsibility boundaries. `test-system/install-script.integration.sh` executes the full two-stage lifecycle in a controlled environment.

The external consumer remains Monify PR 48. Its workflow targets `[self-hosted, agent-relay]`, checks the exact runner name, invokes installed Agent Relay scripts, and delegates Git mutation only to `runner/finalize.sh`.

## Plan of Work

The implementation is complete pending final CI on this plan update.

After merge, deploy in this order:

1. run `host.yml` without a PAT;
2. run `github-connect.yml` with the PAT;
3. verify host, Docker, service, and GitHub label state;
4. rerun Monify PR 48;
5. after consumer acceptance, run a later `host.yml` update without a PAT to prove the recurring path.

No merge is performed by this plan executor.

## Milestones

Milestone 1: pre-merge code gate. Complete when final CI is green and no unresolved P0 or P1 finding remains.

Milestone 2: host deployment. Complete when `host.yml` deploys the merged runtime and dedicated Docker endpoint without a PAT.

Milestone 3: GitHub connection. Complete when `github-connect.yml` verifies or creates registration, starts the listener, and GitHub reports `agent-relay` on `gh-runner`.

Milestone 4: Monify consumer acceptance. Complete when Codex runs commands, Token Minify helpers, and Docker through the real sandbox and the trusted finalizer behaves correctly.

Milestone 5: recurring release proof. Complete when a later `host.yml` run succeeds without a PAT and without registration or label API activity.

## Concrete Steps

From the Agent Relay repository root:

    npm ci
    npm run check
    git diff --check main...HEAD
    git diff --stat main...HEAD

After merge, from `ansible/`:

    ANSIBLE_CONFIG="$PWD/ansible.cfg" \
    ANSIBLE_ROLES_PATH="$PWD/roles" \
    ansible-playbook \
      --inventory "$PWD/inventory/example.ini" \
      "$PWD/playbooks/host.yml"

Then connect GitHub:

    export AGENT_RELAY_GITHUB_CREDENTIAL='github_pat_...'
    ANSIBLE_CONFIG="$PWD/ansible.cfg" \
    ANSIBLE_ROLES_PATH="$PWD/roles" \
    ansible-playbook \
      --inventory "$PWD/inventory/example.ini" \
      "$PWD/playbooks/github-connect.yml"
    unset AGENT_RELAY_GITHUB_CREDENTIAL

Verify:

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

Verify in GitHub that `gh-runner` has `self-hosted`, `linux`, `x64`, and `agent-relay` without losing unrelated custom labels.

Then rerun Monify PR 48. Its active plan must execute:

    worker-run -- pwd
    worker-run -- command -v worker-read worker-run worker-write worker-extract-chat
    worker-run -- docker version
    worker-run -- docker compose version

Inspect `agent-relay-output` and `agent-relay-finalize.log`. An unchanged worktree must complete without a commit; a changed worktree must produce exactly one trusted commit and one push. Codex must receive no push token and perform no Git mutation.

For later releases, run only:

    ANSIBLE_CONFIG="$PWD/ansible.cfg" \
    ANSIBLE_ROLES_PATH="$PWD/roles" \
    ansible-playbook \
      --inventory "$PWD/inventory/example.ini" \
      "$PWD/playbooks/host.yml"

## Validation and Acceptance

1. Final CI passes typecheck, tests with 100 percent line, branch, and function coverage, runtime build, shell checks, Node script checks, toolchain smoke, and behavioral system tests.
2. `host.yml` and `agent_relay_host` contain no PAT handling, registration-token request, runner-label API, or connection-role invocation.
3. `github-connect.yml` and `agent_relay_github_connection` contain no host provisioning task, host-role invocation, or `install.sh` invocation.
4. A fresh host installation succeeds without registration and leaves the listener disabled.
5. GitHub connection fails before host prerequisites exist.
6. GitHub connection registers an absent runner, starts it, and reconciles the managed label.
7. Repeated GitHub connection does not duplicate registration.
8. A later host update preserves registration and starts the existing listener without a PAT.
9. Codex sees only the dedicated Docker directory as writable and uses its socket through `DOCKER_HOST`.
10. A zero-exit Codex process without command or file-change activity fails.
11. Monify runs the required helper and Docker commands through the deployed production path.
12. Finalization commits and pushes only through the trusted runner script.

## Idempotence and Recovery

`host.yml` is the repeatable installation and release operation. It installs missing runner binaries, rebuilds runtime when required, preserves complete registration, and leaves absent registration inactive.

`github-connect.yml` is a narrow idempotent connection and recovery operation. It creates registration only when absent and always verifies the managed label.

Partial or unsafe runner binary or registration state is a hard failure. Neither lifecycle deletes ambiguous state automatically.

If runtime build or import fails, the active runtime and listener remain unchanged. If activation rename fails, the validated previous runtime is restored.

If GitHub connection fails before registration completes, correct the PAT or organization access and rerun only `github-connect.yml`; do not rerun host provisioning unless host validation reports a missing prerequisite.

If the dedicated Docker socket is missing or stale, rerun `host.yml`; do not create a symlink or grant broad access to `/run`.

Source rollback alone does not remove `/etc/systemd/system/docker.socket.d/agent-relay.conf`. Removing this managed host state requires an explicit cleanup revision or the documented emergency procedure.

Removing `agent-relay` causes consumer jobs to remain queued rather than fall back to another self-hosted runner. Restore the label with `github-connect.yml`.

## Artifacts and Notes

Original consumer failure:

    repository: Divorium/monify
    pull request: 48
    workflow run: 30033072687
    job: 89296098924
    message: failed to inspect synthetic bubblewrap mount target /run/docker.sock/.codex: Not a directory

Latest successful implementation evidence before this plan-only commit:

    repository: Divorium/agent-relay
    pull request: 58
    workflow run: 30046295586
    SHA: 2ca79371a30a872d3318278573ad2f930cfdce18
    conclusion: success

The plan-only commit must receive the same complete green CI before PR 58 is reported ready.

## Interfaces and Dependencies

`config/runner-host.json` defines the shared host contract, including:

    docker_socket_path: /srv/github-runner/storage/docker-socket/docker.sock
    runner_label: agent-relay

`ansible/playbooks/host.yml` depends only on:

    role: agent_relay_host

`ansible/playbooks/github-connect.yml` depends only on:

    role: agent_relay_github_connection

`agent_relay_github_connection` consumes:

    AGENT_RELAY_GITHUB_CREDENTIAL

`scripts/codex-run` exports the dedicated Docker endpoint to the Codex child. `CodexExecutor.run` validates semantic execution activity. `runner/finalize.sh` remains the sole Git commit and push boundary.

## Plan Revision Notes

2026-07-23 / ChatGPT: Created the plan from the real Monify consumer failure.

2026-07-23 / ChatGPT: Added the dedicated Docker socket, semantic execution gate, deterministic runner label, and rollback requirements.

2026-07-23 / ChatGPT: Corrected Docker service ordering and moved semantic success into the executor boundary.

2026-07-23 / ChatGPT: Rejected the overlapping playbook design and implemented fully disjoint `host.yml` and `github-connect.yml` lifecycles with separate roles, scripts, behavioral tests, documentation, and PAT boundaries.
