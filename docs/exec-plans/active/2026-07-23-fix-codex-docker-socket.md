# Fix the Codex Docker socket sandbox boundary

This ExecPlan is a living document governed by `.agent/PLANS.md`. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, `Outcomes & Retrospective`, and the validation evidence current until the corrected Agent Relay revision is deployed and a real Monify pull request completes command execution, Docker access, and finalization.

## Purpose / Big Picture

Agent Relay must let Codex execute repository commands and Docker commands on the dedicated GitHub Actions runner without giving Codex Git credentials. The previous runtime declared `/run/docker.sock` and `/var/run/docker.sock` as writable filesystem roots. Codex treats every writable root as a directory beneath which protected metadata paths may exist, so it tried to inspect `/run/docker.sock/.codex` and failed before even `pwd` could start.

After this change, the host exposes a second real Docker socket under a runner-owned directory, Codex receives write access to the directory rather than the socket file, and `DOCKER_HOST` points Docker clients at the socket child. Agent Relay also rejects a zero-exit Codex process when no command or file-change lifecycle event occurred. The organization runner receives a managed `agent-relay` label so consumer workflows cannot be allocated to another generic self-hosted runner.

The behavior is complete only when the merged revision is deployed through Ansible and Monify PR 48 proves `pwd`, Token Minify helpers, Docker CLI access, transcript upload, and trusted finalization through the production path.

## Progress

- [x] (2026-07-23 19:35Z) Reproduced the failure from `Divorium/monify` PR 48, workflow run 30033072687, job 89296098924.
- [x] (2026-07-23 19:45Z) Traced the failure to writable socket-file entries in `src/execution/codex-executor.ts` and verified the Codex writable-root behavior.
- [x] (2026-07-23 20:00Z) Selected a second systemd-activated Docker socket under `/srv/github-runner/storage/docker-socket/docker.sock` instead of broad `/run` access, a symlink, a second daemon, or a proxy.
- [x] (2026-07-23 20:15Z) Added the host contract, Ansible directory and socket configuration, launcher validation, `DOCKER_HOST`, directory-based sandbox permission, semantic activity gate, tests, and documentation.
- [x] (2026-07-23 20:13Z) Fixed the new integration test type failure by adding the minimal `node:net` declaration required by the repository's pinned Node type surface.
- [x] (2026-07-23 20:16Z) Observed successful complete CI run 30041216808 on SHA `cdc47f14a35c550b2a7388ed63d8dbf37af4288a`.
- [x] (2026-07-23 20:20Z) Found nondeterministic consumer scheduling caused by both `gh-runner` and `docker-runner-02` matching `self-hosted`.
- [x] (2026-07-23 20:22Z) Added the managed `agent-relay` runner-label contract, additive GitHub REST reconciliation, label verification, Monify `[self-hosted, agent-relay]` routing, and retained the exact runner-name check.
- [x] (2026-07-23 20:22Z) Observed successful complete CI run 30041653005 on SHA `10956c4adb837838e478db3246d0df5d4779d368` after the runner-label change.
- [x] (2026-07-23 20:42Z) Confirmed complete CI run 30042975561 on final reviewed SHA `ad15b6aca2fdb9da9605ad3046b203ecdb5c0aed`; typecheck, tests with 100 percent coverage, runtime build, shell, Node, toolchain, and system tests all passed.
- [x] (2026-07-23 20:42Z) Finished complete branch diff review. Two P1 findings were corrected: Docker is stopped before socket listener reconfiguration, and semantic success is enforced inside `CodexExecutor` rather than only by the CLI entrypoint. No unresolved P0 or P1 finding remains.
- [ ] User merges PR 58 after the pre-merge gate is reported ready.
- [ ] Deploy the merged revision through Ansible with `AGENT_RELAY_GITHUB_CREDENTIAL` available and record the deployed commit.
- [ ] Verify the `agent-relay` label, both Docker sockets, the dedicated Docker endpoint, and current finalizer revision on the host.
- [ ] Rerun `Divorium/monify` PR 48 and observe commands, Token Minify helpers, Docker CLI access, no-change or changed-worktree finalization, transcript and finalizer artifacts, and successful completion.
- [ ] Complete the retrospective and move this file to `docs/exec-plans/completed/` only after deployed consumer acceptance succeeds.

## Surprises & Discoveries

- Observation: Direct write permission for a Unix socket is incompatible with the current Codex filesystem permission model.
  Evidence: the Monify transcript reported `failed to inspect synthetic bubblewrap mount target /run/docker.sock/.codex: Not a directory` before any command started.

- Observation: A symlink inside a writable directory is not an acceptable substitute for a real socket child.
  Evidence: the sandbox path and socket type must survive Codex validation and bubblewrap mount construction without relying on symlink traversal.

- Observation: Docker already starts through systemd socket activation with `dockerd -H fd://`.
  Evidence: the host enables `docker.socket` before `docker.service`, so one drop-in can declare both the standard and dedicated listeners.

- Observation: Codex CLI can exit zero after producing only an explanation that all tool execution is blocked.
  Evidence: Monify run 30033072687 marked the Codex step successful although no `command_execution` or `file_change` item occurred.

- Observation: the deployed finalizer did not behave like current Agent Relay source.
  Evidence: no-change finalization failed and no `agent-relay-finalize.log` was uploaded, while current `runner/finalize.sh` creates diagnostics before validation and exits zero for an unchanged worktree.

- Observation: a post-allocation runner-name check is safe but not deterministic scheduling.
  Evidence: both `gh-runner` and `docker-runner-02` matched `[self-hosted]`; the wrong runner could consume the job and only then fail. GitHub requires all `runs-on` labels to match, so `[self-hosted, agent-relay]` removes the competing runner from the eligible set.

- Observation: an existing self-hosted runner cannot gain a custom label through `config.sh`.
  Evidence: GitHub requires the runner labels REST API for existing registrations. The additive `POST` endpoint preserves unrelated custom labels, unlike replacing the full custom-label set.

- Observation: restarting `docker.socket` while `docker.service` still owns inherited listeners can fail or leave inconsistent listener state.
  Evidence: final review found the role restarted the socket unit before stopping Docker. The corrected order stops `docker.service` only when the socket drop-in changes, restarts `docker.socket`, then starts Docker.

- Observation: semantic success must be enforced at the executor boundary, not only by one CLI caller.
  Evidence: direct callers of `CodexExecutor.run` previously received a zero-exit outcome before the CLI entrypoint applied the activity check. The executor now validates exit code and observed command/file activity before returning.

- Observation: reverting source alone does not remove an already installed systemd drop-in.
  Evidence: Ansible creates `/etc/systemd/system/docker.socket.d/agent-relay.conf`; an older revision that does not know this file cannot delete it. Rollback must explicitly remove the managed file and restart both Docker units, or deploy a cleanup revision before returning to an older source revision.

## Decision Log

- Decision: Add a second systemd-activated Docker socket at `/srv/github-runner/storage/docker-socket/docker.sock`.
  Rationale: it provides a real Unix socket below a dedicated directory that Codex may treat as a writable root, preserves `/run/docker.sock`, and uses the existing Docker daemon and socket-activation mechanism.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Keep the dedicated directory owned by `github-runner` mode `0700`, while the socket remains `root:docker` mode `0660`.
  Rationale: bubblewrap may create protected metadata below the writable directory, while Docker access remains within the already intentional Docker-group trust boundary.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Store the socket path in `config/runner-host.json` and load it through `scripts/host-config.sh`.
  Rationale: Ansible, launcher validation, Docker client routing, tests, and documentation need one explicit host contract.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Set `DOCKER_HOST` only inside the clean Codex child environment.
  Rationale: host operators retain ordinary Docker behavior, while every Docker client launched by Codex uses the dedicated endpoint.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Require at least one first-seen `command_execution` or `file_change` lifecycle item before accepting exit zero.
  Rationale: assistant prose, reasoning, warnings, todos, or turn completion do not prove that the sandbox operated. The activity count survives output lifecycle clearing.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Define `runner_label` as `agent-relay` in `config/runner-host.json` and reconcile it through Ansible.
  Rationale: consumer workflows need deterministic allocation to the prepared host. The role queries by exact configured runner name, requires one match, adds the label with the additive endpoint, and reads labels back for verification.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Require `AGENT_RELAY_GITHUB_CREDENTIAL` for every playbook run.
  Rationale: the role cannot verify or repair an existing organization-runner label without authenticated organization runner access. A fine-grained token needs `Self-hosted runners: Read and write`; a classic token needs `admin:org`.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Keep runtime deployment and consumer smoke as mandatory acceptance evidence.
  Rationale: static tests cannot prove systemd descriptor handoff, bubblewrap compatibility, Docker CLI access, GitHub label visibility, or the deployed finalizer revision.
  Date/Author: 2026-07-23 / ChatGPT

## Outcomes & Retrospective

The branch now has a coherent socket boundary, semantic success gate, deterministic runner-routing contract, and safe Docker listener lifecycle. Complete CI run 30042975561 passed on reviewed SHA `ad15b6aca2fdb9da9605ad3046b203ecdb5c0aed` after all P1 corrections. The remaining uncertainty is environmental by definition: the code has not yet been merged and deployed, so the real systemd socket, GitHub runner label, Codex sandbox, Token Minify helpers, and finalizer must still be exercised together.

The main lesson is that orchestration success is not execution success. The first consumer run reached the correct workflow but revealed both a sandbox type mismatch and a false semantic success. Subsequent review also showed that fail-closed identity validation does not replace deterministic scheduling. The final gate therefore remains a production-path consumer run, not static configuration alone.

## Context and Orientation

`config/runner-host.json` is the host contract. It now defines `docker_socket_path` and `runner_label`. `ansible/roles/agent_relay_host/vars/main.yml` derives role variables from that contract. `tasks/filesystem.yml` creates secure paths, `tasks/containers.yml` configures Docker and its socket drop-in, and `tasks/runner-label.yml` reconciles the organization-runner label through GitHub's API.

`scripts/codex-run` is the trusted launcher used by `src/execution/codex-executor.ts`. It validates the configured socket root and socket type, creates isolated per-run state, builds a clean environment, sets `DOCKER_HOST`, and invokes `/usr/local/bin/codex`.

`src/execution/codex-executor.ts` constructs Codex permissions and processes the child lifecycle. The sandbox receives write access to `/srv/github-runner/storage/docker-socket`, not to `/run`, `/var/run`, or either socket file. `src/execution/codex-normalizer.ts` validates JSONL events and counts first-seen command and file-change items.

`test/docker-socket-boundary.test.ts` covers the socket contract and semantic activity gate. `test/runner-label-boundary.test.ts` covers deterministic runner-label ownership. `test/runtime-scripts.integration.test.ts` exercises the launcher against a real temporary Unix socket. The repository enforces TypeScript strictness and 100 percent line, branch, and function coverage through `npm run check`.

The external consumer is `Divorium/monify` PR 48. Its `.github/workflows/codex.yml` targets `[self-hosted, agent-relay]`, still verifies `runner.name == gh-runner`, calls installed Agent Relay scripts, and delegates commits and pushes only to `runner/finalize.sh`.

## Plan of Work

The implementation phase is complete. The remaining work is validation and deployment. First, keep the latest Agent Relay CI green and review every changed file for privilege expansion, credential exposure, service lifecycle errors, label replacement, false success, and rollback drift. No merge occurs from this plan executor.

Second, the user merges PR 58. On the Ansible control machine, export a GitHub organization credential with runner write permission and deploy the merged revision through the documented playbook. Ansible must configure both Docker listeners, update the runtime, locate `gh-runner`, add `agent-relay` without replacing other labels, and verify the resulting labels.

Third, verify the host directly. Both socket files must be real Unix sockets. Docker commands executed as `github-runner` with the dedicated `DOCKER_HOST` must succeed. GitHub must report the `agent-relay` label on `gh-runner`.

Finally, return Monify PR 48 to ready-for-review and inspect the real workflow. Codex must execute ordinary commands, locate all Token Minify helpers, access Docker, perform the active plan without Git mutation, and let the trusted finalizer either make exactly one commit or report a successful no-change outcome.

## Milestones

Milestone 1 is the pre-merge implementation gate. It ends when Agent Relay CI is green on the final SHA and complete diff review finds no unresolved P0 or P1 defect. The observable proof is one successful CI run covering typecheck, 100 percent coverage, runtime build, shell and Node syntax, toolchain smoke, and installer system tests.

Milestone 2 is host deployment. It ends when Ansible deploys the merged commit, GitHub reports the `agent-relay` label on `gh-runner`, both Docker sockets exist, and the dedicated endpoint responds to Docker CLI commands as `github-runner`.

Milestone 3 is consumer execution. It ends when Monify PR 48 runs Codex through Agent Relay, the transcript proves helper and Docker command execution, the old `docker.sock/.codex` error is absent, and finalization behaves exactly as current source specifies.

## Concrete Steps

From the Agent Relay repository root, run:

    npm ci
    npm run check
    git diff --check main...HEAD
    git diff --stat main...HEAD

Expect all checks to pass. The check command must report 100 percent line, branch, and function coverage. Do not weaken tests or skip a failing check.

After the user merges PR 58, configure the Ansible inventory to the merged revision and run from `ansible/`:

    export AGENT_RELAY_GITHUB_CREDENTIAL='github_pat_...'
    ANSIBLE_CONFIG="$PWD/ansible.cfg" \
    ANSIBLE_ROLES_PATH="$PWD/roles" \
    ansible-playbook \
      --inventory "$PWD/inventory/example.ini" \
      "$PWD/playbooks/host.yml"

Record the exact merged commit and verify on the target:

    sudo systemctl status docker.socket docker.service
    sudo test -S /run/docker.sock
    sudo test -S /srv/github-runner/storage/docker-socket/docker.sock
    sudo -u github-runner -H env \
      DOCKER_HOST=unix:///srv/github-runner/storage/docker-socket/docker.sock \
      docker version
    sudo -u github-runner -H env \
      DOCKER_HOST=unix:///srv/github-runner/storage/docker-socket/docker.sock \
      docker compose version

In GitHub organization runner settings, verify `gh-runner` has `self-hosted`, `linux`, `x64`, and `agent-relay`. Do not remove unrelated custom labels.

Then mark Monify PR 48 ready for review. Its active plan must cause Codex to run:

    worker-run -- pwd
    worker-run -- command -v worker-read worker-run worker-write worker-extract-chat
    worker-run -- docker version
    worker-run -- docker compose version

Inspect `agent-relay-output`. It must contain command lifecycle output and no `docker.sock/.codex` error. Inspect `agent-relay-finalize.log`. An unchanged worktree must exit zero without a commit; a changed worktree must produce exactly one trusted finalizer commit and one push.

## Validation and Acceptance

1. The final Agent Relay SHA passes the complete repository CI with no skipped required check and 100 percent line, branch, and function coverage.

2. `createCodexArgs` exposes `/srv/github-runner/storage/docker-socket` as writable and exposes neither socket file nor `/run` as a writable root.

3. `scripts/codex-run` rejects a missing, symlinked, or non-socket endpoint and sets `DOCKER_HOST=unix:///srv/github-runner/storage/docker-socket/docker.sock` for the Codex child.

4. A controlled zero-exit Codex process without a command or file change fails with `CODEX_FAILED`; a process with observed execution activity may continue to finalization.

5. Ansible locates exactly one `gh-runner`, adds `agent-relay` through the additive labels endpoint, preserves other custom labels, and verifies the returned label set.

6. GitHub schedules Monify's Agent Relay jobs only to a runner matching both `self-hosted` and `agent-relay`; the retained runner-name check still rejects any incorrectly labeled host.

7. After deployment, both Docker sockets are real and usable, and Docker commands work as `github-runner` through the dedicated endpoint.

8. Monify PR 48 executes `pwd`, all four Token Minify helper lookups, `docker version`, and `docker compose version` through the real Codex sandbox with no `docker.sock/.codex` failure.

9. No-change finalization exits zero and uploads diagnostics. Changed-worktree finalization creates one commit and pushes once. Codex never receives the push token and performs no Git mutation.

## Idempotence and Recovery

The Ansible directory, template, service, and label tasks are repeatable. The label task skips the additive API call when `agent-relay` is already present and always reads labels back. The Docker socket drop-in restarts `docker.socket` and `docker.service` only when its content changes.

If deployment fails before the runtime swap, the existing runtime remains active under the installer contract. Correct the repository or inventory and rerun the same playbook with the credential exported.

If Docker fails after the socket drop-in changes, stop the runner, inspect `systemctl status` and `journalctl` for `docker.socket` and `docker.service`, correct the managed template or role, and rerun Ansible. Do not create a socket symlink or grant broad write access to `/run`.

Source rollback alone does not remove `/etc/systemd/system/docker.socket.d/agent-relay.conf`. A rollback must first deploy an explicit cleanup revision that removes the managed drop-in, reloads systemd, and restarts `docker.socket` and `docker.service`, or perform that exact cleanup under a documented emergency procedure before deploying an older source revision. Do not claim that merely reverting Git automatically removes managed host state.

Removing the `agent-relay` label makes Monify jobs remain queued rather than falling back to `docker-runner-02`. Restore the label through the same Ansible role before retrying.

## Artifacts and Notes

Original consumer failure:

    repository: Divorium/monify
    pull request: 48
    workflow run: 30033072687
    job: 89296098924
    message: failed to inspect synthetic bubblewrap mount target /run/docker.sock/.codex: Not a directory

Successful pre-merge evidence already observed:

    Agent Relay run 30041216808
    SHA cdc47f14a35c550b2a7388ed63d8dbf37af4288a
    conclusion success

    Agent Relay run 30041653005
    SHA 10956c4adb837838e478db3246d0df5d4779d368
    conclusion success

Final pre-merge evidence before this plan-only status update:

    Agent Relay run 30042975561
    SHA ad15b6aca2fdb9da9605ad3046b203ecdb5c0aed
    conclusion success

The plan-only status commit must receive the same complete green CI before the PR is reported ready.

## Interfaces and Dependencies

`config/runner-host.json` defines:

    docker_socket_path: /srv/github-runner/storage/docker-socket/docker.sock
    runner_label: agent-relay

`scripts/host-config.sh` exports `DOCKER_SOCKET_PATH` for `scripts/codex-run`.

`src/execution/codex-executor.ts` exports:

    DOCKER_SOCKET_DIRECTORY: string
    validateExecutionOutcome(exitCode: number, executionActivityCount: number): ExecutionOutcome

`src/execution/codex-normalizer.ts` provides:

    executionActivityCount(): number

`ansible/roles/agent_relay_host/tasks/runner-label.yml` uses GitHub's organization self-hosted runner list, additive label, and label-list endpoints. It requires a control-machine credential with organization runner read/write permission. The implementation adds no runtime package dependency.

## Plan Revision Notes

2026-07-23 / ChatGPT: Created the plan from the real Monify consumer failure and the dedicated systemd socket plus semantic activity-gate design.

2026-07-23 / ChatGPT: Updated the plan after complete CI exposed a missing `node:net` declaration and review exposed nondeterministic generic self-hosted scheduling. Added the managed `agent-relay` label, control credential requirement, consumer label routing, current CI evidence, and an explicit rollback caveat for persistent systemd host state.
