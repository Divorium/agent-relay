# Fix the Codex Docker socket sandbox boundary

This ExecPlan is a living document governed by `.agent/PLANS.md`. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, `Outcomes & Retrospective`, and all implementation and validation instructions current until the corrected runtime is deployed and a real consumer repository completes command execution, Docker access, and finalization.

## Purpose / Big Picture

Agent Relay currently launches Codex with the host Docker socket file itself declared as a writable filesystem root. Codex 0.144.4 protects metadata names such as `.codex` beneath every writable root, so bubblewrap attempts to inspect `/run/docker.sock/.codex` and aborts before even `pwd` can run. A consumer pull request therefore appears to reach Codex but cannot execute commands, use Token Minify helpers, access Docker, test code, or edit files.

After this change, Ansible creates a second Docker socket in a dedicated runner-owned directory, Agent Relay exposes that directory rather than the socket file to the Codex sandbox, and the launcher directs Docker CLI traffic to the dedicated socket through `DOCKER_HOST`. Agent Relay also refuses to accept a zero-exit Codex session unless the JSONL lifecycle proves that at least one command or file change occurred. A real consumer ExecPlan must then execute ordinary commands, Token Minify helpers, Docker commands, and finalization through the same production path.

## Progress

- [x] (2026-07-23 19:35Z) Reproduced the failure from `Divorium/monify` PR 48, workflow run 30033072687, job 89296098924.
- [x] (2026-07-23 19:45Z) Traced the failure to writable socket-file entries in `src/execution/codex-executor.ts` and verified the Codex bubblewrap writable-root behavior in the checked-out OpenAI Codex 0.144.4 source.
- [x] (2026-07-23 20:00Z) Selected a dedicated systemd-activated Docker socket under `/srv/github-runner/storage/docker-socket` instead of granting write access to `/run`, bind-mounting the socket, or relying on a symlink.
- [x] (2026-07-23 20:15Z) Added the host contract, Ansible directory and socket configuration, launcher validation, `DOCKER_HOST`, sandbox directory permission, semantic activity gate, tests, and current documentation.
- [ ] (2026-07-23 20:20Z) Run the complete repository validation and fix every change-related failure.
- [ ] (2026-07-23 20:25Z) Review the complete diff for security, lifecycle, deployment, output, and rollback defects.
- [ ] (2026-07-23 20:30Z) Merge and deploy the corrected Agent Relay revision through the current Ansible flow, recording the deployed commit.
- [ ] (2026-07-23 20:35Z) Rerun `Divorium/monify` PR 48 and observe commands, Token Minify helpers, Docker CLI access, no-change or changed-worktree finalization, transcript and finalizer artifacts, and a successful Codex job.
- [ ] (2026-07-23 20:40Z) Complete the retrospective and move this file to `docs/exec-plans/completed/` only after the deployed consumer acceptance succeeds.

## Surprises & Discoveries

- Observation: Direct write permission for a Unix socket is incompatible with the current Codex filesystem permission model.
  Evidence: the Monify transcript reported `failed to inspect synthetic bubblewrap mount target /run/docker.sock/.codex: Not a directory`; OpenAI Codex registers protected metadata children beneath writable roots.

- Observation: A symlink inside a writable directory is not an acceptable unverified substitute.
  Evidence: the desired contract must survive Codex path validation and bubblewrap mount construction. The host must provide a real socket at the configured child path rather than relying on symlink traversal behavior.

- Observation: Docker already starts through systemd socket activation with `dockerd -H fd://`.
  Evidence: the existing Ansible role enables `docker.socket` before `docker.service`. A drop-in can reset `ListenStream` and declare both the standard and dedicated sockets so Docker receives both descriptors.

- Observation: Codex CLI can exit zero after producing only an assistant explanation that all tool execution is blocked.
  Evidence: Monify run 30033072687 marked `Run Codex through Agent Relay` successful although no `command_execution` or `file_change` item occurred.

- Observation: the deployed finalizer on the runner did not behave like current source.
  Evidence: no-change finalization failed and no `agent-relay-finalize.log` was uploaded, while current `runner/finalize.sh` redirects diagnostics before validation and exits zero when the worktree is unchanged. Deployment revision visibility and reconciliation are required before acceptance.

## Decision Log

- Decision: Add a second systemd-activated Docker socket at `/srv/github-runner/storage/docker-socket/docker.sock`.
  Rationale: it provides a real Unix socket below a dedicated directory that Codex may treat as a writable root, preserves `/run/docker.sock` for operators, avoids broad `/run` write access, and uses the existing Docker socket-activation mechanism.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Keep the dedicated directory owned by `github-runner` mode `0700`, while the socket remains `root:docker` mode `0660`.
  Rationale: bubblewrap may create protected synthetic metadata below the writable directory, while Docker access remains governed by the already intentional Docker-group trust boundary.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Store the socket path in `config/runner-host.json` and load it through `scripts/host-config.sh`.
  Rationale: host, Ansible, launcher, tests, and documentation need one explicit value; hidden duplicated paths would recreate deployment drift.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Set `DOCKER_HOST` only inside the clean Codex child environment.
  Rationale: host operators keep standard Docker behavior, while commands and Token Minify helpers invoked by Codex consistently target the dedicated socket.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Require at least one first-seen `command_execution` or `file_change` lifecycle item before accepting a zero process exit.
  Rationale: every valid ExecPlan requires repository inspection or implementation activity. Assistant prose, reasoning, warnings, todos, or a completed turn alone do not prove that the sandbox could operate. The activity counter survives output-truncation lifecycle clearing so transport limits cannot erase semantic evidence.
  Date/Author: 2026-07-23 / ChatGPT

- Decision: Keep runtime deployment and consumer smoke as required acceptance evidence.
  Rationale: static Ansible assertions cannot prove systemd descriptor handoff, bubblewrap compatibility, Docker CLI access, or the deployed finalizer revision.
  Date/Author: 2026-07-23 / ChatGPT

## Outcomes & Retrospective

Implementation is present on the branch but validation, deployment, and consumer evidence remain pending. The intended result is one explicit Docker socket contract shared by configuration, Ansible, launcher, sandbox, tests, and documentation, plus a semantic execution gate that rejects the observed false success. This section must be rewritten after the real Monify run confirms the outcome.

## Context and Orientation

`config/runner-host.json` is the shared host contract. `ansible/roles/agent_relay_host/vars/main.yml` derives host paths from it. `tasks/filesystem.yml` creates secure paths and `tasks/containers.yml` configures Docker and containerd. The new `templates/docker-socket.conf.j2` is a systemd drop-in for the existing `docker.socket` unit.

`scripts/codex-run` is the trusted launcher used by `CodexExecutor`. It creates per-run state, builds a clean environment, and invokes `/usr/local/bin/codex`. The launcher now reads the configured socket path, verifies the directory and Unix socket without following symlinks, and passes `DOCKER_HOST=unix://...` to the Codex child.

`src/execution/codex-executor.ts` constructs Codex permission arguments and processes the child lifecycle. The sandbox receives write access to the dedicated directory, not to `/run`, `/var/run`, or either socket file. `src/execution/codex-normalizer.ts` validates JSONL lifecycle events and now counts first-seen command and file-change items.

`test/context-boundary.test.ts` covers the general permission boundary. `test/docker-socket-boundary.test.ts` covers the complete cross-file socket contract and semantic activity gate. The repository enforces strict TypeScript and 100 percent line, branch, and function coverage through `npm run check`.

The external reproducer is `Divorium/monify` PR 48. Run 30033072687 reached the installed runtime on runner `gh-runner`, but the Docker socket permission prevented every command. Issue `Divorium/agent-relay#57` records the blocker and acceptance criteria.

## Plan of Work

First, establish one configured socket path. Add `docker_socket_path` to `config/runner-host.json`, expose it through `scripts/host-config.sh`, and derive Ansible root and child variables from the same contract.

Second, provision the host endpoint. Create the dedicated directory as `github-runner` mode `0700`. Install a root-owned Docker socket drop-in that clears inherited listeners, restores `/run/docker.sock`, adds the configured dedicated listener, sets `root:docker` mode `0660`, and removes stale sockets on stop. Restart `docker.socket` and `docker.service` when the drop-in changes.

Third, connect the launcher and sandbox. `scripts/codex-run` must reject a missing, symlinked, or wrong-type directory/socket, then put `DOCKER_HOST` into the clean child environment. `createCodexArgs` must expose only the dedicated directory as writable and must contain no socket-file write entries.

Fourth, reject false success. `CodexEventNormalizer` records first-seen command and file-change activities. `CodexExecutor` accepts exit zero only when that count is positive, while preserving existing timeout, startup, parser, transcript, and nonzero-exit behavior.

Fifth, update tests and documentation. The tests must connect configuration, Ansible, systemd, launcher, sandbox, normalizer, and outcome validation. Current architecture and operations documents must describe the implemented endpoint, ownership, recovery, and post-deployment acceptance without presenting unverified deployment as complete.

Finally, run the complete repository check, review the full diff, merge, deploy through Ansible, record the deployed SHA, and rerun the Monify consumer workflow.

## Concrete Steps

Work from the Agent Relay repository root.

Run the complete repository validation:

    npm ci
    npm run check

Expect TypeScript typechecking, 100 percent-covered Node tests, runtime build, shell and Node syntax, toolchain smoke, installer integration simulation, and static Ansible contracts to pass. Do not weaken coverage or skip a failing test.

Inspect the complete branch diff and whitespace:

    git diff --check main...HEAD
    git diff --stat main...HEAD
    git diff main...HEAD -- config/runner-host.json scripts/host-config.sh scripts/codex-run src/execution/codex-executor.ts src/execution/codex-normalizer.ts ansible/roles/agent_relay_host test README.md ansible/README.md docs/operations/README.md docs/native-github-runner-specification.md docs/exec-plans/active/2026-07-23-fix-codex-docker-socket.md

After merge, deploy only through the current Ansible procedure. Configure the inventory to the merged revision, then run the documented playbook. Record the exact deployed commit and verify:

    sudo systemctl status docker.socket docker.service
    sudo test -S /run/docker.sock
    sudo test -S /srv/github-runner/storage/docker-socket/docker.sock
    sudo -u github-runner -H env DOCKER_HOST=unix:///srv/github-runner/storage/docker-socket/docker.sock docker version
    sudo -u github-runner -H env DOCKER_HOST=unix:///srv/github-runner/storage/docker-socket/docker.sock docker compose version

Then return Monify PR 48 to ready-for-review and observe the production workflow. Codex must run `pwd`, locate all Token Minify helpers, run `docker version`, run `docker compose version`, execute the active plan, and produce both transcript and finalizer logs.

## Validation and Acceptance

1. **The sandbox receives a directory Docker boundary.** Scenario: `createCodexArgs` constructs agent filesystem permissions. Proof: unit and cross-file contract tests. Expected result: `/srv/github-runner/storage/docker-socket` is writable; neither Docker socket file nor `/run` is writable. Result: PENDING CI.

2. **Ansible creates a real dedicated socket.** Scenario: the role runs on the supported Debian host. Proof: systemd status, socket type and ownership checks, and Docker CLI through the configured endpoint. Expected result: both sockets exist and reach the same Docker daemon; rerunning Ansible is idempotent. Result: PENDING deployment.

3. **Codex receives the dedicated endpoint.** Scenario: `scripts/codex-run` starts Codex. Proof: launcher tests and real consumer commands. Expected result: invalid paths fail before Codex; valid path yields `DOCKER_HOST=unix:///srv/github-runner/storage/docker-socket/docker.sock` inside tool processes. Result: PENDING CI and deployment.

4. **The original bubblewrap failure is removed.** Scenario: Monify PR 48 executes through the deployed runtime. Proof: Agent Relay transcript. Expected result: `pwd` and helper commands start, and no `docker.sock/.codex` error appears. Result: PENDING deployment.

5. **Semantic blockage cannot be reported as success.** Scenario: a controlled Codex process exits zero without any command or file-change lifecycle item. Proof: `validateExecutionOutcome` and normalizer tests. Expected result: Agent Relay throws `CODEX_FAILED` and skips finalization. Result: PENDING CI.

6. **Valid read-only work can succeed.** Scenario: Codex executes at least one command but produces no repository changes. Proof: controlled tests and real no-change finalization. Expected result: Agent Relay accepts the execution, finalizer exits zero with a log, and no commit is created. Result: PENDING CI and deployment.

7. **Changed work finalizes once.** Scenario: Codex executes commands and changes a consumer branch. Proof: Monify or an equivalent controlled consumer run. Expected result: finalizer uploads diagnostics, creates one commit, and pushes once without exposing the token to Codex. Result: PENDING deployment.

8. **The deployed revision is current and observable.** Scenario: the Ansible deployment completes. Proof: recorded source and activated runtime revision plus behavior of current finalizer. Expected result: runtime behavior matches the merged source, including no-change success and `FINALIZE_LOG`. Result: PENDING deployment.

## Idempotence and Recovery

The Ansible directory and template tasks are declarative. Repeated runs preserve the same directory ownership, socket listeners, modes, and service state. A socket drop-in change restarts `docker.socket` before Docker so descriptors are refreshed.

If Docker fails after the drop-in change, keep the runner stopped, inspect `systemctl status` and `journalctl` for `docker.socket` and `docker.service`, correct the repository template or role, and rerun Ansible. Do not manually create socket files, add a symlink, grant write access to `/run`, or leave an unmanaged drop-in.

The standard `/run/docker.sock` remains declared, so rollback is performed by reverting the merged change and rerunning Ansible. The reverted role must remove the managed drop-in if rollback support is needed before merge; review must confirm whether the current Ansible state removes obsolete templates or requires an explicit absent-state task.

A failed runtime build leaves the active runtime untouched under the existing installer contract. A failed consumer execution uploads the transcript and skips finalization. A failed finalization must upload its log and leave the branch recoverable under `runner/finalize.sh`.

## Artifacts and Notes

Consumer failure evidence:

    repository: Divorium/monify
    pull request: 48
    workflow run: 30033072687
    job: 89296098924
    message: failed to inspect synthetic bubblewrap mount target /run/docker.sock/.codex: Not a directory

No command, helper, Docker operation, test, or file edit occurred in that run. The Codex step still concluded successfully because the process exited zero, and finalization failed without its expected log.

The dedicated endpoint is intentionally not a symlink. Its directory is the sandbox root, its child is the real socket created by systemd, and `DOCKER_HOST` selects it for all Docker clients launched by Codex.

## Interfaces and Dependencies

`config/runner-host.json` defines:

    docker_socket_path: /srv/github-runner/storage/docker-socket/docker.sock

`scripts/host-config.sh` exports:

    DOCKER_SOCKET_PATH

`src/execution/codex-executor.ts` exports:

    DOCKER_SOCKET_DIRECTORY: string
    validateExecutionOutcome(exitCode: number, executionActivityCount: number): ExecutionOutcome

`src/execution/codex-normalizer.ts` provides:

    executionActivityCount(): number

The implementation adds no runtime package dependency. It relies on the existing systemd `docker.socket`, Docker Engine `fd://` socket activation, Node.js built-ins, and the existing Codex JSONL lifecycle.

## Plan Revision Notes

2026-07-23 / ChatGPT: Created this plan from the real Monify consumer failure, current Agent Relay and OpenAI Codex source, and the implemented dedicated systemd socket plus semantic activity-gate design.