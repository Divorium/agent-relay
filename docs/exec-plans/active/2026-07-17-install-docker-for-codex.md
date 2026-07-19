# Provide direct Docker access to Codex

This ExecPlan follows `.agent/PLANS.md`. It is the only active plan for this pull request.

## Purpose

Make `./update.sh` ensure that `github-runner`, and therefore Codex, can use the ordinary rootful host Docker CLI and local Unix socket for Docker, Buildx, and Compose operations. Agent Relay must not become a Docker proxy, command parser, project registry, Compose lifecycle manager, or container supervisor.

The implementation must preserve existing Docker and containerd data, configuration, listeners, versions, images, containers, volumes, networks, and storage locations. It must not copy or move Docker state, use `rsync`, set `data-root`, set containerd `root`, or rewrite `/etc/docker/daemon.json` or `/etc/containerd/config.toml`.

## Current Review Baseline

The branch implementation removed the rejected storage-migration design, but the pull request is not ready to merge.

Current `main` is commit `7c148c242feb421b59647f144ab6b78fe691af28` and contains the completed normalized Codex output work from pull request #35. This branch is one commit behind and conflicts with that implementation. Reconcile the branch against current `main` without regressing its JSONL execution, normalized live output, transcript artifact, bounded queues, termination controller, workflow transcript environment, tests, or documentation. The Codex workspace does not permit modifying `.git`; use the fetched `origin/main` content as the baseline and edit working-tree files so the resulting tree preserves current `main` plus the Docker-specific changes.

The review also found these blocking defects:

1. `docker_host_validate` creates the runner-owned Docker client directory below a root-owned `0700` temporary parent. `github-runner` cannot traverse that parent, so the validation contract is not actually executable.
2. Docker signing-key validation requires exactly one `fpr` record from GnuPG. A valid OpenPGP key may contain subkey fingerprints. The implementation must identify exactly one primary public key and validate its immediate primary fingerprint while permitting subkey fingerprint records; multiple primary keys, missing fingerprints, and malformed output must fail.
3. Publishing the Agent Relay-managed apt key and source as two independent writes is not restartable. An interruption after either managed file is installed can leave a safe partial state that the next run rejects forever. Define and implement deterministic recovery for exact, secure Agent Relay-managed partial states without accepting unrelated or ambiguous files.
4. Repository-safe tests currently assert strings and helper outputs but do not reproduce the directory traversal failure, primary/subkey fingerprint parsing, or interrupted managed apt publication.
5. The pull request previously added a second active ExecPlan. The workflow requires exactly one added or modified active plan. Real-host acceptance remains recorded in this plan and `test-host/README.md`; do not recreate a second active plan.

## Binding Decisions

- Docker provisioning runs only from `update.sh`. `install.sh` remains Docker-free apart from securing checked-in scripts under its existing contract.
- Keep architecture contracts portable across systemd-capable Linux hosts. The current package adapter supports Debian x86-64 through Docker's official Debian repository.
- A fresh supported host may receive `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, and `docker-compose-plugin`.
- Reuse a complete compatible official installation. Install only a missing Buildx or Compose plugin when the core installation is compatible.
- Preserve working component versions. Do not upgrade existing Docker core packages merely because newer candidates exist.
- Fail before Docker package mutation on conflicting distribution packages, partial package state, broken executables, unknown command ownership, ambiguous or insecure apt definitions, unsafe unit files, or globally non-clean dpkg state.
- Do not implement global dpkg repair or a general package transaction framework.
- Preserve existing Docker/containerd configuration and data byte-for-byte.
- Ensure `github-runner` belongs to `docker`; ensure `agent-relay-builder` does not.
- Enable and start the required services when needed.
- Validate the ordinary `/usr/bin/docker` CLI, local daemon connection, Buildx, and Compose as `github-runner` with an actually reachable private temporary `DOCKER_CONFIG` and an explicit local Unix endpoint.
- A fresh installation or privileged acceptance may run `hello-world`. Repeated compatible updates must not require registry access.
- Docker group access is intentionally root-equivalent host access on the dedicated runner host.
- Preserve the Codex workspace filesystem boundary and add only the two conventional local Docker socket paths required by the current permission model.
- Docker/Compose application lifecycle remains Codex's responsibility.
- Make no public API, request schema, routing, result-semantic, or commit-decision change.
- Do not redesign Codex output capture. Merge the current `main` output implementation unchanged except for the minimal Docker socket permissions and Docker-specific prompt/environment additions.
- Do not change the workflow merely to expose Docker. Preserve the current `main` workflow behavior, including `CODEX_TRANSCRIPT_PATH` and direct `run-codex.mjs` invocation.

## Implementation Work

1. Reconcile every conflicting file with current `main`. At minimum inspect `.github/workflows/codex.yml`, `README.md`, `docs/native-github-runner-specification.md`, `docs/operations/README.md`, `src/execution/codex-executor.ts`, execution tests, workflow tests, and runtime documentation. Preserve all current-main output-hardening behavior and apply only the Docker-specific delta.
2. Review the complete pull-request diff after reconciliation. Remove stale migration, package-journal, automatic dpkg-recovery, custom-root, `rsync`, and obsolete output-rendering code or documentation.
3. Fix Docker client validation so the runner can traverse to and use the private client directory while no broader root-owned temporary state becomes readable. Cleanup must remain deterministic on success and failure.
4. Extract a production helper for parsing GnuPG `--with-colons` output. Require one primary `pub` record with one associated primary `fpr`; ignore valid subkey fingerprints for primary-key matching; reject multiple primary keys, missing/duplicate primary fingerprints, malformed ordering, or an unexpected primary fingerprint. Use the same helper for existing and newly downloaded keys.
5. Make Agent Relay-managed apt repository publication restartable from observed filesystem state. Recognize only exact secure managed states: neither file present, both valid files present, or an exact valid partial managed state that can be completed safely. Reject symlinks, unsafe ownership or mode, unexpected content, conflicting definitions, unrelated occupation, and ambiguous keys before package mutation. Add interruption tests after each publication step.
6. Keep package simulation conservative: explicit candidate versions from the official Docker repository, requested packages plus dependency closure only, no removal, purge, downgrade, unauthenticated package, or modification of an already installed package.
7. Preserve updater semantics: compile and fully finalize the new runtime before Docker provisioning; leave the runner stopped for incomplete runtime; after a Docker failure restore and verify the finalized runtime and runner, then return the Docker failure.
8. Retain direct Docker access through `/usr/bin/docker`, private per-run `DOCKER_CONFIG`, and write permission for `/var/run/docker.sock` and `/run/docker.sock` in the current-main executor implementation.
9. Update documentation to the final implemented state without claiming privileged acceptance.
10. Run one complete repository validation only after the last production edit, then review the final diff against current `main` and this plan.

## Repository-Safe Tests

Tests must exercise production helpers or real temporary filesystem/process behavior. Static assertions may guard architectural boundaries but do not substitute for behavioral evidence.

Required coverage:

- current-main normalized output, transcript, termination, workflow, and executor tests remain passing;
- fresh host classification requests exactly the five official packages;
- a complete compatible installation performs no package, configuration, or data mutation;
- missing Buildx or Compose selects only that plugin;
- conflicts, partial packages, broken commands, unknown ownership, unsafe units, and dirty dpkg fail before package mutation;
- compatible apt definitions are preserved and duplicate, ambiguous, insecure, or unrelated definitions fail;
- GnuPG parsing accepts one primary key with subkeys and rejects multiple primary keys, missing primary fingerprints, duplicate primary fingerprints, malformed ordering, and an unexpected fingerprint;
- exact managed apt publication can resume after interruption following key publication or source publication, while unsafe or unrelated partial states fail;
- an unprivileged identity can traverse to and use the private Docker client directory created by the production helper, while sibling/root-private state remains inaccessible;
- existing Docker and containerd configuration files remain unchanged;
- no production source invokes `rsync` or contains Docker storage-migration logic;
- `github-runner` gains Docker group membership and `agent-relay-builder` is excluded;
- validation uses a clean environment, explicit local Unix socket, and private client state;
- repeated compatible updates do not require Docker Hub;
- runner restoration occurs only after runtime finalization;
- finalizer ownership and existing sandbox regressions remain passing;
- exactly one active ExecPlan is changed by this pull request.

## Real-Host Acceptance Blocker

Privileged acceptance remains separate from ordinary repository CI and is not a reason to mutate the current runner during this task. No manual execution or human interpretation is an acceptance step.

The eventual automated disposable or explicitly designated Debian 13 x86-64 systemd harness must provision isolated starting states, run the exact checked-out `install.sh` and `update.sh`, capture machine-readable before/after evidence, and fail its own job when an assertion is not satisfied. It must cover:

- fresh official installation and `hello-world`;
- compatible existing official installation with images, containers, volumes, networks, configuration, listeners, versions, and storage locations preserved;
- Buildx-only and Compose-only missing-plugin installation;
- conflicting packages, unknown command ownership, ambiguous/insecure apt definitions, unsafe units, and non-clean dpkg rejection before mutation;
- interruption and rerun across managed repository publication and package installation;
- service startup, group membership, socket access, Buildx, Compose, and repeated update with registry egress disabled;
- runtime compile/finalization failure leaving the runner stopped;
- Docker provisioning failure restoring the finalized runtime and runner;
- TERM, INT, and HUP forwarding and bounded provisioner shutdown;
- a real Agent Relay request in which Codex starts a Compose project, reads logs, executes a command, and shuts the project down.

The harness must compare package versions, unit definitions/state, configuration digests, Docker inventory, storage paths, identities, command output, runner runtime identity, and process results, with sensitive host-specific values redacted before evidence publication.

Current blocker: no automated disposable/designated Debian systemd host lifecycle is available to this repository task. Impact: privileged apt, dpkg, systemd, group, socket, daemon, registry, signal, and end-to-end acceptance cannot yet execute. Unblock: provide an automated host lifecycle and job interface that creates or resets required initial states and returns captured evidence to the agent or CI.

## Acceptance Criteria

- The branch tree preserves current `main` output/workflow behavior and applies the Docker delta without merge conflicts.
- `update.sh` makes the ordinary Docker CLI, Buildx, Compose, and local daemon available to Codex on the supported host.
- Docker and containerd keep existing/default configuration, listeners, versions, data, and storage roots.
- No Docker/containerd data is copied, moved, staged, checksummed, or migrated.
- A compatible existing installation is reused and only missing supported components are installed.
- Conflicting or globally non-clean package state fails before Docker package mutation.
- Managed repository setup is secure and restartable from exact supported partial states.
- `github-runner` can actually use the private Docker client state and local socket; `agent-relay-builder` remains excluded.
- The runner is never restored against an incomplete runtime.
- Docker/Compose lifecycle decisions remain Codex's responsibility.
- Exactly one active ExecPlan belongs to this pull request.
- `npm run check` passes after the final edit.
- normal CI passes on the exact final commit.
- privileged real-host acceptance remains explicitly blocked until automated evidence exists.

## Progress

- [x] Rejected custom Docker/containerd roots, state migration, `rsync`, automatic global dpkg recovery, and Agent Relay-managed Compose lifecycle.
- [x] Reduced the intended architecture to direct host CLI/socket access with update-only provisioning.
- [x] Identified current-main integration conflict after pull request #35.
- [x] Identified the inaccessible private Docker client directory.
- [x] Identified ambiguous primary/subkey fingerprint parsing.
- [x] Identified non-restartable two-file managed apt publication.
- [x] Consolidated real-host acceptance into this single active plan.
- [ ] Reconcile the implementation and documentation with current `main` without output/workflow regressions.
- [ ] Correct client-directory traversal and add behavioral coverage.
- [ ] Correct primary-key fingerprint parsing and add adversarial fixtures.
- [ ] Make managed apt publication restartable and add interruption coverage.
- [ ] Complete an independent final diff review against this plan.
- [ ] Run final repository validation on the final working tree.
- [blocked] Obtain successful normal CI on the exact finalized commit. Cause: the exact commit does not exist until workflow finalization commits and pushes the Codex result. Impact: no final-head CI evidence exists yet. Unblock: finalize and push the implementation, then require normal CI success on that exact head.
- [blocked] Execute privileged real-host acceptance. Cause, impact, and unblock condition are recorded above.

## Surprises & Discoveries

- The original branch solved an unrequested storage-relocation problem; direct Docker access does not require it.
- Repository-safe validation cannot establish privileged host acceptance.
- Current `main` replaced the branch's older executor output implementation, so a content-level integration is required before Docker review can be meaningful.
- A runner-owned leaf directory is unusable when its root-owned parent lacks execute permission for the runner.
- OpenPGP subkey fingerprints must not be confused with multiple primary keys.
- Secure setup also requires deterministic re-entry after interruption between managed apt file publications.

## Decision Log

- Decision: preserve Docker's existing/default configuration, state, and storage.
  Rationale: direct CLI/socket access does not require data relocation or daemon configuration changes.
- Decision: use one active plan and keep privileged acceptance as a blocker section rather than a second workflow-selectable plan.
  Rationale: the workflow intentionally requires exactly one changed active ExecPlan.
- Decision: preserve current-main Codex output and workflow architecture.
  Rationale: output normalization was completed independently in pull request #35 and is outside this Docker feature.
- Decision: fail on non-clean global dpkg state rather than repair unrelated administrator package work.
  Rationale: Docker provisioning must not own arbitrary global package recovery.
- Decision: leave Docker and Compose application lifecycle to Codex.
  Rationale: Agent Relay only exposes the ordinary host capability.

## Outcomes & Retrospective

Not complete. The implementation requires current-main reconciliation and correction of the validation, key-parsing, and managed-repository restartability defects. Do not move this plan to `completed/` or claim merge readiness until all non-privileged acceptance criteria, final review, and exact-head CI are satisfied.
