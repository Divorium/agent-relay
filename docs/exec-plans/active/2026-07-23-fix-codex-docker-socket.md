# Fix the Codex Docker socket sandbox boundary

This ExecPlan is a living document governed by `.agent/PLANS.md`. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, `Outcomes & Retrospective`, and validation evidence current until the corrected Agent Relay revision is deployed and a real Monify pull request completes command execution, Docker access, and finalization.

## Purpose / Big Picture

Agent Relay must let Codex execute repository and Docker commands on the dedicated GitHub Actions runner without giving Codex Git credentials. The previous runtime declared `/run/docker.sock` and `/var/run/docker.sock` as writable filesystem roots. Codex treats every writable root as a directory beneath which protected metadata paths may exist, so it tried to inspect `/run/docker.sock/.codex` and failed before even `pwd` could start.

After this change, the host exposes a second real Docker socket under a runner-owned directory, Codex receives write access to the directory rather than the socket file, and `DOCKER_HOST` points Docker clients at the socket child. Agent Relay rejects a zero-exit Codex process when no command or file-change lifecycle event occurred. The organization runner receives a managed `agent-relay` label so consumer workflows cannot be allocated to another generic self-hosted runner.

Ansible now has separate entrypoints. `ansible/playbooks/install.yml` performs the complete host play with runner registration and label management enabled and requires a GitHub organization PAT. `ansible/playbooks/host.yml` performs recurring host and Agent Relay updates for an already registered runner without a PAT.

The behavior is complete only when the merged revision is deployed through Ansible and Monify PR 48 proves `pwd`, Token Minify helpers, Docker CLI access, transcript upload, and trusted finalization through the production path.

## Progress

- [x] (2026-07-23 19:35Z) Reproduced the failure from `Divorium/monify` PR 48, workflow run 30033072687, job 89296098924.
- [x] (2026-07-23 19:45Z) Traced the failure to writable socket-file entries in `src/execution/codex-executor.ts` and verified the Codex writable-root behavior.
- [x] (2026-07-23 20:00Z) Selected a second systemd-activated Docker socket under `/srv/github-runner/storage/docker-socket/docker.sock` instead of broad `/run` access, a symlink, a second daemon, or a proxy.
- [x] (2026-07-23 20:15Z) Added the host contract, Ansible socket configuration, launcher validation, `DOCKER_HOST`, directory-based sandbox permission, semantic activity gate, tests, and documentation.
- [x] (2026-07-23 20:16Z) Fixed the integration test type failure with the minimal `node:net` declaration required by the pinned Node type surface and observed successful CI run 30041216808.
- [x] (2026-07-23 20:22Z) Added the managed `agent-relay` runner label, additive GitHub REST reconciliation, label verification, Monify `[self-hosted, agent-relay]` routing, and retained the exact runner-name check. CI run 30041653005 passed.
- [x] (2026-07-23 20:42Z) Completed full branch review. Corrected two P1 findings: Docker is stopped before socket listener reconfiguration, and semantic success is enforced inside `CodexExecutor`. No unresolved P0 or P1 finding remained.
- [x] (2026-07-23 20:56Z) Revalidated all 129 Node tests with 100 percent line, branch, and function coverage plus runtime, shell, Node, toolchain, Ansible syntax, and installer behavioral checks.
- [x] (2026-07-23 21:12Z) Split Ansible runner lifecycle from recurring deployment. Added PAT-gated `playbooks/install.yml`, made `playbooks/host.yml` PAT-free for complete existing registrations, and made the update path reject first registration even when a PAT remains in the environment.
- [x] (2026-07-23 21:14Z) Observed successful complete CI run 30045090177 on SHA `74178851acd00b18fd35c03bc2fa495201653c17`; typecheck, 129 tests with 100 percent coverage, runtime build, shell, Node, toolchain, and system tests passed.
- [ ] User merges PR 58 after the final plan-only commit receives the same complete green CI.
- [ ] Deploy the merged revision once with `playbooks/install.yml` and `AGENT_RELAY_GITHUB_CREDENTIAL`, because the current host still needs the managed runner label and dedicated Docker socket.
- [ ] Verify the `agent-relay` label, both Docker sockets, the dedicated Docker endpoint, and current finalizer revision on the host.
- [ ] Rerun `Divorium/monify` PR 48 and observe commands, Token Minify helpers, Docker CLI access, no-change or changed-worktree finalization, transcript and finalizer artifacts, and successful completion.
- [ ] Use PAT-free `playbooks/host.yml` for later Agent Relay releases and host configuration changes.
- [ ] Complete the retrospective and move this file to `docs/exec-plans/completed/` only after deployed consumer acceptance succeeds.

## Surprises & Discoveries

- Observation: Direct write permission for a Unix socket is incompatible with the current Codex filesystem permission model.
  Evidence: the Monify transcript reported `failed to inspect synthetic bubblewrap mount target /run/docker.sock/.codex: Not a directory` before any command started.

- Observation: A symlink inside a writable directory is not an acceptable substitute for a real socket child.
  Evidence: the sandbox path and socket type must survive Codex validation and bubblewrap mount construction without relying on symlink traversal.

- Observation: Codex CLI can exit zero after producing only an explanation that all tool execution is blocked.
  Evidence: Monify run 30033072687 marked the Codex step successful although no `command_execution` or `file_change` item occurred.

- Observation: a post-allocation runner-name check is safe but does not provide deterministic scheduling.
  Evidence: both `gh-runner` and `docker-runner-02` matched `[self-hosted]`; `[self-hosted, agent-relay]` removes the competing runner from the eligible set.

- Observation: an existing self-hosted runner cannot gain a custom label through `config.sh`.
  Evidence: GitHub requires the runner labels REST API for existing registrations. The additive `POST` endpoint preserves unrelated custom labels.

- Observation: restarting `docker.socket` while `docker.service` still owns inherited listeners can fail or leave inconsistent listener state.
  Evidence: final review found the role restarted the socket unit before stopping Docker. The corrected order stops `docker.service`, restarts `docker.socket`, then starts Docker.

- Observation: semantic success must be enforced at the executor boundary, not only by one CLI caller.
  Evidence: direct callers previously received a zero-exit outcome before the CLI entrypoint applied the activity check. `CodexExecutor.run` now validates exit code and observed activity before returning.

- Observation: requiring a PAT for every host update is unnecessary and increases credential exposure.
  Evidence: `install.sh` requests the credential only when `.runner`, `.credentials`, and `.credentials_rsaparams` are absent. Label reconciliation was the only recurring task requiring the organization API.

- Observation: an update playbook must not register a runner merely because a PAT happens to remain exported.
  Evidence: registration without subsequent label reconciliation would create a runner unable to accept `[self-hosted, agent-relay]` jobs. `deploy.yml` now requires runner lifecycle mode as well as the credential before first registration.

- Observation: reverting source alone does not remove an already installed systemd drop-in.
  Evidence: an older revision that does not know `/etc/systemd/system/docker.socket.d/agent-relay.conf` cannot delete it. Rollback requires an explicit cleanup revision or documented emergency removal.

## Decision Log

- Decision: Add a second systemd-activated Docker socket at `/srv/github-runner/storage/docker-socket/docker.sock`.
  Rationale: it provides a real Unix socket below a dedicated directory that Codex may treat as a writable root, preserves `/run/docker.sock`, and uses the existing daemon and socket activation.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Keep the dedicated directory owned by `github-runner` mode `0700`, while the socket remains `root:docker` mode `0660`.
  Rationale: bubblewrap may create protected metadata below the writable directory, while Docker access remains within the intentional Docker-group trust boundary.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Store the socket path and runner label in `config/runner-host.json`.
  Rationale: Ansible, launcher validation, Docker routing, tests, consumer scheduling, and documentation need one explicit host contract.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Require at least one first-seen `command_execution` or `file_change` lifecycle item before accepting exit zero.
  Rationale: assistant prose, reasoning, warnings, todos, or turn completion do not prove that the sandbox operated.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Reconcile the `agent-relay` label through the additive organization runner-label endpoint.
  Rationale: consumer workflows require deterministic allocation, and additive reconciliation does not replace unrelated custom labels.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Separate first installation from recurring updates.
  Rationale: first registration and label reconciliation require `AGENT_RELAY_GITHUB_CREDENTIAL`, but an already registered runner can be updated without the credential. `playbooks/install.yml` imports the complete `host.yml` play with `agent_relay_manage_runner_lifecycle=true`; the default remains false.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Make the PAT-free host playbook reject absent registration.
  Rationale: silently registering without label reconciliation would leave an unusable runner and violate the explicit lifecycle boundary.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Keep runtime deployment and consumer smoke as mandatory acceptance evidence.
  Rationale: static tests cannot prove systemd descriptor handoff, bubblewrap compatibility, Docker CLI access, GitHub label visibility, or the deployed finalizer revision.
  Date/Author: 2026-07-23 / ChatGPT

## Outcomes & Retrospective

The branch now has a coherent Docker socket boundary, semantic success gate, deterministic runner routing, safe Docker listener lifecycle, and a least-credential Ansible operating model. First installation is explicit and PAT-gated. Later updates reconcile packages, users, filesystems, Docker, toolchains, checkout, runtime, and service state without calling the GitHub runner API or passing a credential to `install.sh`.

Complete CI run 30045090177 passed on SHA `74178851acd00b18fd35c03bc2fa495201653c17` after the playbook split. The current host still uses the old socket layout and has not received the managed label. The first deployment of this PR therefore still requires `playbooks/install.yml` once. After that deployment succeeds, later releases use `playbooks/host.yml` without PAT.

The main lesson is that orchestration success is not execution success, and credential minimization must follow actual lifecycle requirements. Runner registration and organization label management are installation concerns; runtime rebuilds and host reconciliation are recurring deployment concerns.

## Context and Orientation

`config/runner-host.json` defines `docker_socket_path` and `runner_label`. `ansible/roles/agent_relay_host/vars/main.yml` derives fixed role values from that contract.

`ansible/playbooks/host.yml` contains the complete host play and uses the role default `agent_relay_manage_runner_lifecycle=false`. It is the recurring update entrypoint.

`ansible/playbooks/install.yml` statically imports `host.yml` with `agent_relay_manage_runner_lifecycle=true`. It is the only supported entrypoint for first registration and label reconciliation.

`ansible/roles/agent_relay_host/tasks/deploy.yml` detects registration state. It passes the PAT to `install.sh` only when lifecycle management is enabled and registration is absent. Otherwise it passes an empty standard input value.

`ansible/roles/agent_relay_host/tasks/runner-label.yml` locates exactly one organization runner named `gh-runner`, adds `agent-relay` through the additive endpoint when absent, and reads labels back for verification. `tasks/main.yml` imports it only in installation lifecycle mode.

`tasks/filesystem.yml` creates secure paths. `tasks/containers.yml` configures Docker and the second socket. `scripts/codex-run` validates the socket and sets `DOCKER_HOST`. `src/execution/codex-executor.ts` exposes the dedicated socket directory and enforces semantic success.

`test/runner-label-boundary.test.ts` and `test/installer.test.ts` enforce the split playbook contract, PAT boundary, registration guard, label API behavior, and documentation. The repository requires 100 percent line, branch, and function coverage through `npm run check`.

The external consumer is `Divorium/monify` PR 48. Its workflow targets `[self-hosted, agent-relay]`, verifies `runner.name == gh-runner`, calls installed Agent Relay scripts, and delegates commits and pushes only to `runner/finalize.sh`.

## Plan of Work

The implementation and pre-merge review are complete. The final plan-only commit must pass the same complete CI before the PR is returned to ready-for-review.

After the user merges PR 58, run `playbooks/install.yml` once with a GitHub organization PAT. This first deployment must configure both Docker listeners, update the runtime, locate `gh-runner`, add `agent-relay` without replacing other labels, and verify the resulting labels.

Verify both socket files, Docker access as `github-runner`, and the GitHub label. Then return Monify PR 48 to ready-for-review and inspect the real workflow. Codex must execute ordinary commands, locate all Token Minify helpers, access Docker, perform the active plan without Git mutation, and let the trusted finalizer make exactly one commit or report a successful no-change outcome.

After this installation deployment, future Agent Relay revisions and ordinary host configuration changes use `playbooks/host.yml` without exporting a PAT.

## Milestones

Milestone 1 is the pre-merge implementation gate. It ends when CI is green on the final SHA and complete diff review finds no unresolved P0 or P1 defect.

Milestone 2 is host installation deployment. It ends when `playbooks/install.yml` deploys the merged commit, GitHub reports `agent-relay` on `gh-runner`, both Docker sockets exist, and the dedicated endpoint responds as `github-runner`.

Milestone 3 is consumer execution. It ends when Monify PR 48 runs Codex through Agent Relay, the transcript proves helper and Docker execution, the old `docker.sock/.codex` error is absent, and finalization matches current source.

Milestone 4 is recurring update proof. It ends when a later no-op or revision update through `playbooks/host.yml` succeeds without `AGENT_RELAY_GITHUB_CREDENTIAL` and does not attempt registration or label API access.

## Concrete Steps

From the Agent Relay repository root, run:

    npm ci
    npm run check
    git diff --check main...HEAD
    git diff --stat main...HEAD

Expect all checks to pass. The check command must report 100 percent line, branch, and function coverage.

After the user merges PR 58, configure the Ansible inventory to the merged revision and run from `ansible/`:

    export AGENT_RELAY_GITHUB_CREDENTIAL='github_pat_...'
    ANSIBLE_CONFIG="$PWD/ansible.cfg" \
    ANSIBLE_ROLES_PATH="$PWD/roles" \
    ansible-playbook \
      --inventory "$PWD/inventory/example.ini" \
      "$PWD/playbooks/install.yml"

Record the merged commit and verify on the target:

    sudo systemctl status docker.socket docker.service
    sudo test -S /run/docker.sock
    sudo test -S /srv/github-runner/storage/docker-socket/docker.sock
    sudo -u github-runner -H env \
      DOCKER_HOST=unix:///srv/github-runner/storage/docker-socket/docker.sock \
      docker version
    sudo -u github-runner -H env \
      DOCKER_HOST=unix:///srv/github-runner/storage/docker-socket/docker.sock \
      docker compose version

Verify `gh-runner` has `self-hosted`, `linux`, `x64`, and `agent-relay`. Do not remove unrelated custom labels.

Then mark Monify PR 48 ready for review. Its active plan must cause Codex to run:

    worker-run -- pwd
    worker-run -- command -v worker-read worker-run worker-write worker-extract-chat
    worker-run -- docker version
    worker-run -- docker compose version

Inspect `agent-relay-output` and `agent-relay-finalize.log`. An unchanged worktree must exit zero without a commit; a changed worktree must produce exactly one trusted finalizer commit and one push.

For every later Agent Relay release, do not export a PAT and run:

    ANSIBLE_CONFIG="$PWD/ansible.cfg" \
    ANSIBLE_ROLES_PATH="$PWD/roles" \
    ansible-playbook \
      --inventory "$PWD/inventory/example.ini" \
      "$PWD/playbooks/host.yml"

The host playbook must succeed only when runner registration is already complete.

## Validation and Acceptance

1. The final Agent Relay SHA passes complete CI with 100 percent line, branch, and function coverage.
2. `createCodexArgs` exposes `/srv/github-runner/storage/docker-socket` as writable and exposes neither socket file nor `/run` as a writable root.
3. `scripts/codex-run` validates the endpoint and sets the dedicated `DOCKER_HOST`.
4. Zero-exit Codex without command or file activity fails with `CODEX_FAILED`.
5. `playbooks/install.yml` imports the complete host play with runner lifecycle management enabled and requires the organization PAT.
6. `playbooks/host.yml` requires no PAT for a complete existing registration and refuses first registration.
7. Label reconciliation is additive, preserves unrelated labels, and executes only through the installation path.
8. After deployment, both Docker sockets are real and usable through the dedicated endpoint.
9. Monify PR 48 executes ordinary commands, Token Minify helpers, Docker commands, and trusted finalization through the real sandbox.
10. A later `host.yml` update succeeds without a PAT and without runner API access.

## Idempotence and Recovery

Both playbooks use the same declarative role. `install.yml` may be rerun with a PAT to verify or restore registration label state. `host.yml` may be rerun without a PAT for ordinary updates and no-op reconciliation.

If `host.yml` finds absent registration, it fails before invoking registration and instructs the operator to run `install.yml`. Partial registration remains a hard failure under the installer contract.

If deployment fails before runtime swap, the existing runtime remains active. Correct the repository or inventory and rerun the same entrypoint.

If Docker fails after socket configuration changes, inspect `docker.socket` and `docker.service`, correct the managed template or role, and rerun Ansible. Do not create a socket symlink or grant broad write access to `/run`.

Source rollback alone does not remove `/etc/systemd/system/docker.socket.d/agent-relay.conf`. Rollback requires an explicit cleanup revision or the exact documented emergency cleanup before deploying older source.

Removing the `agent-relay` label makes Monify jobs remain queued rather than falling back to another runner. Restore it with `install.yml` and the organization PAT.

## Artifacts and Notes

Original consumer failure:

    repository: Divorium/monify
    pull request: 48
    workflow run: 30033072687
    job: 89296098924
    message: failed to inspect synthetic bubblewrap mount target /run/docker.sock/.codex: Not a directory

Relevant successful pre-merge evidence:

    Agent Relay run 30041216808
    conclusion success

    Agent Relay run 30041653005
    conclusion success

    Agent Relay run 30042975561
    conclusion success

    Agent Relay run 30045090177
    SHA 74178851acd00b18fd35c03bc2fa495201653c17
    conclusion success

The plan-only status commit must receive the same complete green CI before the PR is reported ready.

## Interfaces and Dependencies

`config/runner-host.json` defines:

    docker_socket_path: /srv/github-runner/storage/docker-socket/docker.sock
    runner_label: agent-relay

`ansible/roles/agent_relay_host/defaults/main.yml` defines:

    agent_relay_manage_runner_lifecycle: false

`ansible/playbooks/install.yml` statically imports `host.yml` with:

    agent_relay_manage_runner_lifecycle: true

`ansible/roles/agent_relay_host/tasks/runner-label.yml` uses GitHub organization self-hosted runner list, additive label, and label-list endpoints. It requires organization runner read/write permission only in installation lifecycle mode.

`scripts/host-config.sh` exports `DOCKER_SOCKET_PATH`. `src/execution/codex-executor.ts` exports `DOCKER_SOCKET_DIRECTORY` and enforces execution activity. `src/execution/codex-normalizer.ts` provides `executionActivityCount()`.

The implementation adds no runtime package dependency.

## Plan Revision Notes

2026-07-23 / ChatGPT: Created the plan from the real Monify consumer failure and the dedicated systemd socket plus semantic activity-gate design.

2026-07-23 / ChatGPT: Added deterministic runner labeling, corrected Docker listener lifecycle and executor-level semantic success, and recorded complete validation evidence.

2026-07-23 / Codex: Recorded fresh local validation and the environmental blockers preventing host deployment and Monify acceptance from that session.

2026-07-23 / ChatGPT: Split Ansible into a PAT-gated installation entrypoint and a PAT-free recurring update entrypoint. Updated registration guards, tests, operations, architecture, and deployment instructions so the first post-merge deployment uses `install.yml` once and later updates use `host.yml` without a PAT.
