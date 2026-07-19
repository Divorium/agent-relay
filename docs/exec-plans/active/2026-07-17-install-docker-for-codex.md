# Provide direct Docker access to Codex

This ExecPlan follows `.agent/PLANS.md` and is the only active plan for this pull request.

## Purpose

Make `./update.sh` ensure that `github-runner`, and therefore Codex, can use the ordinary rootful host Docker CLI and local Unix socket for Engine, Buildx, and Compose operations. Agent Relay must not become a Docker proxy, command parser, project registry, Compose lifecycle manager, or container supervisor.

Preserve existing Docker and containerd data, configuration, listeners, versions, images, containers, volumes, networks, and storage locations. Do not copy or move Docker state, use `rsync`, set `data-root`, set containerd `root`, or rewrite `/etc/docker/daemon.json` or `/etc/containerd/config.toml`.

## Current Baseline

The branch is cleanly based on current `main` commit `7c148c242feb421b59647f144ab6b78fe691af28`, including the completed normalized Codex output work from pull request #35. Preserve its JSONL protocol handling, live normalized output, transcript artifact, bounded queues, termination controller, workflow behavior, tests, and documentation. Apply only the Docker-specific delta.

The checked-in `scripts/docker-host.sh` and `scripts/docker-host-debian.sh` are incomplete review material. Do not integrate them unchanged.

## Blocking Review Findings

1. The runner-owned validation client directory is below a root-owned `0700` parent, so `github-runner` cannot traverse to it.
2. GnuPG parsing counts every `fpr` record and therefore rejects valid keys with subkeys. Require exactly one primary `pub` and its immediately associated primary fingerprint while permitting valid subkey records. Reject malformed ordering, multiple primary keys, missing or duplicate primary fingerprints, and an unexpected primary fingerprint.
3. Managed apt key and source publication is not restartable. An interruption after either write can leave a safe state that the next run rejects. Recognize and complete only exact secure managed partial states.
4. `docker version --client` is not a supported Docker CLI invocation. Probe the CLI daemon-independently with a supported command such as `docker --version`, then validate the daemon separately through the explicit local socket.
5. A root-readable key can still be unreadable by apt's unprivileged acquisition path. Validate canonical path, regular-file type, root ownership, non-writability, file readability, and directory traversal permissions.
6. GnuPG inspection uses ambient root state. Run it with an explicit clean environment and private `GNUPGHOME` below the provisioner state root; never create or depend on `/root/.gnupg`.
7. Candidate validation accepts a version when at least one `apt-cache madison` row is official, even if the same candidate version is also supplied by another source. Every source row capable of satisfying the selected requested-package candidate must be unambiguously Docker's official repository.
8. A drop-in may exist before the package unit exists. `LoadState=not-found` must not bypass inspection of pre-existing Docker or containerd unit files and drop-in directories, because package installation may start the service immediately.
9. The previous updater obtains the provisioner PGID after launch and treats a fast successful exit as an inspection failure. Handle the already-exited race as a normal completed child result while rejecting an unidentifiable running process group.
10. Signal handling sends one `TERM` and waits forever. Use bounded graceful termination followed by process-group `KILL` escalation, then restore the runner according to runtime-finalization state.
11. Repository-safe tests are mostly source assertions and helper-string checks. Add behavioral coverage for every defect above and isolate mutable test state between cases.
12. Keep exactly one active ExecPlan. Real-host acceptance belongs in this plan and `test-host/README.md`; do not create another active plan.

## Binding Decisions

- Docker provisioning runs only from `update.sh`. `install.sh` remains Docker-free apart from securing checked-in scripts and installing generic prerequisites already required by the host.
- The architecture remains portable across systemd-capable Linux hosts. The current package adapter supports Debian x86-64 through Docker's official apt repository.
- A fresh supported host may receive exactly `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, and `docker-compose-plugin` plus approved dependency closure.
- Reuse a complete compatible official installation. Install only a missing Buildx or Compose plugin when the core installation is compatible.
- Preserve working component versions. Do not upgrade an installed package merely because a newer candidate exists.
- Fail before Docker package mutation on conflicting packages, partial state, broken executables, unknown command ownership, ambiguous or insecure repositories, unreadable keys, unsafe units or drop-ins, or globally non-clean dpkg state.
- Do not repair unrelated dpkg state or build a general transaction framework.
- Ensure `github-runner` belongs to `docker`; ensure `agent-relay-builder` does not.
- Enable and start required services when needed.
- Validate CLI, daemon access, Buildx, and Compose as `github-runner` with reachable private `DOCKER_CONFIG`, a clean environment, and explicit local Unix endpoint.
- A fresh installation or privileged acceptance may run `hello-world`. A repeated compatible update must not require registry access.
- Docker group access is intentionally root-equivalent access on the dedicated runner host.
- Add only the conventional `/var/run/docker.sock` and `/run/docker.sock` write permissions to the existing Codex filesystem policy.
- Docker and Compose application lifecycle remains Codex's responsibility.
- Make no public API, request schema, routing, result-semantic, finalization-decision, or commit-decision change.
- Preserve current workflow behavior, including `CODEX_TRANSCRIPT_PATH` and direct `run-codex.mjs` invocation.

## Implementation Work

1. Integrate only the required Docker delta into `install.sh`, `update.sh`, toolchain environment, prompt/executor, repository validation, tests, and current documentation.
2. Remove obsolete migration, package-journal, automatic dpkg-recovery, custom-root, `rsync`, and Agent Relay-managed application-lifecycle code or documentation.
3. Implement reachable private client state while keeping unrelated provisioner state inaccessible. Cleanup must be deterministic after success, failure, and signals.
4. Implement one production primary-fingerprint parser and one isolated GnuPG execution path used for both existing and downloaded keys.
5. Validate apt-reader permissions for the selected key and all required ancestor directories.
6. Implement restartable managed repository publication from observed state. Supported final-path states are neither file, valid key only, exact valid source only, or both valid. Use atomic same-filesystem publication so interruption never exposes partially copied final content. Handle only exact secure managed temporary state; reject symlinks, unexpected content, unsafe metadata, unrelated occupation, and ambiguity.
7. Require an unambiguous official origin for each selected requested-package candidate. Keep simulation limited to explicit candidate versions, requested packages, and dependency closure; reject removal, purge, downgrade, unauthenticated packages, unrelated packages, or changes to installed packages.
8. Inspect potential unit files and drop-ins before package installation even when the package unit is currently absent. Reinspect after package work before explicit service operations.
9. Preserve updater ordering: acquire the stable update lock before mutation; stop the listener and wait for its worker; compile and fully finalize the runtime; run the provisioner in a separately terminable process group; restore and verify the runner; then return the original Docker status. Incomplete runtime leaves the runner stopped.
10. Make provisioner process-group startup race-safe. On HUP, INT, or TERM, forward graceful termination, wait for a bounded interval, escalate to `KILL` if required, reap the child, and then execute the normal restoration contract.
11. Retain direct `/usr/bin/docker` use, private per-run `DOCKER_CONFIG`, and exact socket permissions in the current-main executor.
12. Update documentation without claiming privileged acceptance.
13. Run one complete `npm run check` after the last production edit, then review the final diff against current `main` and this plan.

## Repository-Safe Tests

Tests must exercise production helpers or real temporary filesystem/process behavior. Static assertions may guard architecture but cannot replace behavioral evidence.

Required coverage includes:

- all current-main output, transcript, termination, workflow, executor, finalizer, and sandbox regressions;
- fresh, complete-compatible, Buildx-missing, and Compose-missing classifications with isolated state;
- conflicting, partial, broken, unknown-owner, dirty-dpkg, unreadable-key, unsafe-unit, and pre-existing-drop-in rejection before package mutation;
- supported daemon-independent CLI probe separated from daemon validation;
- compatible repository preservation and duplicate, disabled, ambiguous, insecure, unrelated, and same-version multi-origin rejection;
- primary-key parsing with valid subkeys plus all malformed and duplicate cases;
- isolated GnuPG home with no ambient root-state access;
- interruption and rerun after each managed key, source, and atomic temporary publication boundary;
- runner traversal to private Docker client state while unrelated state remains inaccessible;
- no Docker/containerd configuration or data relocation and no production `rsync` use;
- runner group inclusion, builder exclusion, explicit socket use, clean environment, and no registry access on repeated compatible update;
- updater fast-child completion, unidentifiable running PGID failure, graceful signal exit, forced escalation, finalization ordering, and runner restoration semantics;
- exactly one active ExecPlan.

## Real-Host Acceptance Blocker

Privileged acceptance is separate from ordinary repository CI. No manual command execution or human interpretation is an acceptance step.

The eventual automated disposable or explicitly designated Debian 13 x86-64 systemd harness must create isolated starting states, run the exact checked-out `install.sh` and `update.sh`, capture machine-readable before/after evidence, and fail its own job on any unsatisfied assertion. It must cover fresh installation and `hello-world`; preservation of a compatible installation; missing-plugin cases; repository, package, key, unit, and dpkg rejection; interruption and rerun; service and group state; registry-disabled repeated update; runtime and Docker failure ordering; bounded signal escalation; and a real Agent Relay request where Codex starts Compose, reads logs, executes a command, and shuts the project down.

Current blocker: no automated disposable or designated Debian systemd host lifecycle is available to this repository task. Impact: privileged apt, dpkg, systemd, group, socket, daemon, registry, signal, and end-to-end acceptance cannot execute. Unblock: provide an automated host lifecycle and job interface that creates or resets required states and returns captured evidence to the agent or CI.

## Acceptance Criteria

- The branch remains based on current `main` and preserves its output/workflow behavior.
- `update.sh` provides ordinary Docker CLI, Buildx, Compose, and local daemon access to Codex on the supported host.
- Existing or package-default Docker/containerd configuration, listeners, versions, data, and storage roots are preserved.
- Only missing supported components and approved dependencies are installed.
- Package, repository, key, unit, process, and signal handling satisfies the requirements above.
- `github-runner` can use the private client state and local socket; `agent-relay-builder` remains excluded.
- The runner is never restored against an incomplete runtime.
- Docker/Compose lifecycle remains Codex's responsibility.
- `npm run check` and normal CI pass on the exact final commit.
- Privileged real-host acceptance remains explicitly blocked until automated evidence exists.

## Progress

- [x] Rejected storage migration, custom roots, `rsync`, global dpkg repair, and Agent Relay-managed Compose lifecycle.
- [x] Rebuilt the branch cleanly on current `main` and consolidated to one active plan.
- [x] Completed independent review of the initial provisioner and updater design; blocking findings are recorded above.
- [ ] Implement the Docker delta and behavioral tests.
- [ ] Run final repository validation and exact-head CI.
- [ ] Complete independent final diff and log review.
- [blocked] Run privileged real-host acceptance; cause, impact, and unblock condition are recorded above.

## Decision Log

- Preserve Docker's existing or package-default state because direct socket access requires no relocation.
- Fail on unrelated non-clean dpkg state rather than owning global repair.
- Isolate GnuPG state, require apt-reader access, and require unambiguous requested-package origin.
- Inspect future-active systemd overrides before package post-install scripts can start services.
- Use bounded process-group termination so an interrupted update cannot hang indefinitely.
- Leave application container lifecycle to Codex.

## Outcomes & Retrospective

Not complete. Do not move this plan to `completed/` or claim merge readiness until all non-privileged criteria, independent review, and exact-head CI are satisfied.
