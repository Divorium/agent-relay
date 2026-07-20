# Provide direct Docker access to Codex

This ExecPlan follows `.agent/PLANS.md` and is the only active plan for this pull request.

## Purpose

Make `./update.sh` ensure that `github-runner`, and therefore Codex, can use the ordinary rootful host Docker CLI and local Unix socket for Engine, Buildx, and Compose operations. Agent Relay must not become a Docker proxy, command parser, project registry, Compose lifecycle manager, or container supervisor.

Preserve existing Docker and containerd data, configuration, listeners, versions, images, containers, volumes, networks, and storage locations. Do not copy or move Docker state, use `rsync` for Docker state, set `data-root`, set containerd `root`, or rewrite `/etc/docker/daemon.json` or `/etc/containerd/config.toml`.

## Current Baseline

The branch is based on current `main` commit `7c148c242feb421b59647f144ab6b78fe691af28`, including the completed normalized Codex output work from pull request #35. Preserve its JSONL protocol handling, live normalized output, transcript artifact, bounded queues, termination controller, workflow behavior, generic toolchain, tests, and documentation. Apply only the Docker-specific delta.

The checked-in Docker provisioner, Debian adapter, updater integration, and tests are incomplete implementation material. Do not treat their current presence as acceptance evidence.

Temporary hosted PR-26 diagnostic workflows were removed after collecting their traces. The canonical `.github/workflows/ci.yml` is restored exactly to `main`; no workflow change is required for this feature.

## Blocking Review Findings

1. The runner-owned validation client directory was below a root-owned `0700` parent. The current implementation changed the outer state container to traversable `0711`; retain this separation and add a behavioral traversal test proving `github-runner` can use only its own client directory while the private provisioner state remains inaccessible.
2. GnuPG parsing must require exactly one primary `pub` and its associated primary fingerprint while permitting valid subkey records. Reject malformed ordering, multiple primary keys, missing or duplicate primary fingerprints, and an unexpected primary fingerprint.
3. GnuPG inspection must run in an explicit clean environment with a private `GNUPGHOME` below the provisioner state root and must never depend on or create `/root/.gnupg`.
4. A root-owned key can still be unreadable by apt's unprivileged acquisition path. Validate canonical regular-file type, ownership, non-writability, file readability, and traversal permissions for every required ancestor directory.
5. Managed apt key and source publication is not restartable during the write itself. Writing directly to the fixed `.new` path can leave a secure but partial file after interruption, and the next run rejects it permanently. Write to a unique same-directory temporary regular file, validate complete bytes and metadata, atomically promote it to the recoverable stage, then atomically promote the stage to the final path. Define deterministic recovery for interruption after every write and rename boundary and reject symlinks or unrelated occupation.
6. `docker version --client` is unsupported. Probe the CLI daemon-independently with `docker --version`, then validate the daemon separately through the explicit local socket.
7. Candidate validation must reject a selected requested-package version when any `apt-cache madison` row for that version is not Docker's official repository. Do not accept the version merely because at least one official row exists.
8. Fresh-host systemd preflight is incomplete. Before package mutation, inspect `docker.service`, `docker.socket`, `containerd.service`, every future-active unit file, and every drop-in directory under `/etc/systemd/system`, `/run/systemd/system`, `/usr/lib/systemd/system`, and `/lib/systemd/system`, including package-path leftovers that can become active during post-install startup. Validate effective semantics, not only root ownership and mode: reject masks, aliases or links outside approved package/admin locations, unsupported `ExecStart` or socket listener overrides, TCP endpoints, unsafe environment directives, unknown-owned package files, ambiguous duplicate definitions, and unsupported drop-in content before apt runs. Reinspect the effective units and actual local socket after package work.
9. Provisioner process-group startup must handle fast successful exit as an ordinary child result while rejecting an unidentifiable running group.
10. Signal termination is still not bounded or reliable. The current updater waits on launcher liveness rather than process-group liveness, can skip escalation when descendants survive a launcher exit, ignores whether signaling succeeded, and ends with an unbounded `wait`. Implement bounded TERM grace, bounded KILL grace, process-group liveness checks, reliable signaling, bounded reaping, and a final failure path that cannot hang. Runner restoration must still follow runtime-finalization state.
11. Refresh sudo credentials after waiting for `Runner.Worker` and before the first runtime mutation. Keep noninteractive root authority valid for the entire remaining update, including long package work, process-group signaling, EXIT/signal cleanup, and runner restoration. No failure or interrupt path may prompt for sudo or hang because the timestamp expired.
12. Repository-safe tests must exercise production helpers or real temporary filesystem/process behavior. Static source assertions may guard architecture but cannot be the main evidence or claim atomicity, restartability, provenance, process control, or access behavior.
13. The Docker helper test currently expects `conflicting|` although the production parser intentionally retains the referenced key path in `conflicting|<path>`. Correct the assertion and test the semantic rejection through `docker_debian_repository_records_acceptable`.
14. The updater integration test does not intercept the absolute `/usr/bin/sudo` used by the launcher and redirects the useful child diagnostic away from the uploaded trace. Transform every exact production sudo path, preserve stdout/stderr on failure, and make the test fail with a diagnostic that identifies the production step.
15. Existing tests do not yet prove managed publication recovery, apt-reader access, isolated GnuPG state, same-version multi-origin rejection, future-active unit/drop-in rejection, fast-child completion, process-group TERM/KILL escalation, or post-failure runner restoration. Add deterministic behavioral cases for all of them.
16. Keep exactly one active ExecPlan. Privileged real-host acceptance remains in this plan and `test-host/README.md`; do not create another active plan.
17. The PR removes `rsync` from the generic installer and toolchain smoke even though current `main` guarantees it. The Docker design forbids using `rsync` to move Docker/containerd state; it does not authorize deleting an unrelated host tool. Restore the current-main `rsync` installation and smoke validation while keeping Docker production scripts free of `rsync`.
18. Package-name and command-owner checks do not prove that an existing installation is the supported official Docker stack. Before reusing installed core or plugin packages, validate package origin/provenance and a coherent supported version set. Reject locally rebuilt, foreign-origin, mixed-origin, incompatible, or ambiguous installed packages before any mutation; preserve compatible versions rather than upgrading them.
19. Absence checks are incomplete. A dangling symlink at `/usr/bin/docker`, `/usr/bin/dockerd`, or `/usr/bin/containerd` is currently treated as absent, and an installed-but-broken or unknown-owned Compose/Buildx plugin can evade detection when the subcommand merely fails. Inspect canonical command and plugin paths independently of successful execution and reject stale files, symlinks, unexpected owners, duplicate plugin locations, and unknown command provenance before apt runs.
20. Candidate selection must use one explicit apt metadata snapshot. Refresh metadata once when installation is required, then resolve all exact requested versions, origin rows, dependency closure, simulation, and installation from that same observed snapshot. Do not select some candidates, run `apt-get update` in the middle of the package loop, and continue with a different repository state.
21. The interruption contract conflicts with dpkg safety. The updater may force-kill the provisioner while `apt-get` or dpkg is mutating state, while the next run intentionally refuses dirty global dpkg state and cannot self-recover. Define a safe critical-section protocol: either defer external termination until apt/dpkg exits within a separately bounded policy, or terminate in a way that leaves a deterministically resumable clean state. Add signal tests during update, simulation, package download, unpack, configure, and post-install service activation; a rerun must not require an undocumented human repair step.
22. Provisioner temporary state cleanup is only an EXIT trap. SIGKILL or host interruption can leave traversable state containers and runner-owned client directories in `/tmp`; later runs neither identify nor remove their own stale state. Use a dedicated protected state parent with ownership/metadata validation and deterministic stale-run recovery, or another design that proves no persistent readable client state remains after hard interruption.
23. Direct Docker access can create root-owned or foreign-owned files in the workspace through container bind mounts, while `runner/finalize.sh` correctly rejects any foreign-owned path before Git inspection. Add this invariant to the Codex prompt and behavioral tests: Codex must run containers with an appropriate UID/GID or repair workspace ownership through Docker before completion. Do not weaken the finalizer ownership check.
24. Current exact-head CI and the Codex validation job fail in `npm run check:system`, so Codex never starts. Fix the system harness defects without weakening production assertions, then preserve full `npm run check` as the gate before requesting another Codex run.

## Binding Decisions

- Docker provisioning runs only from `update.sh`. `install.sh` remains Docker-free apart from securing checked-in scripts and retaining generic prerequisites already required by the host.
- The architecture remains portable across systemd-capable Linux hosts. The current package adapter supports Debian x86-64 through Docker's official apt repository.
- A fresh supported host may receive exactly `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, and `docker-compose-plugin` plus approved dependency closure.
- Reuse only a complete compatible official installation. Install only a missing Buildx or Compose plugin when the core installation is compatible.
- Preserve working compatible component versions. Do not upgrade an installed package merely because a newer candidate exists.
- Fail before Docker package mutation on conflicting packages, partial state, broken or stale executables, unknown command ownership, unsupported installed provenance, ambiguous or insecure repositories, unreadable keys, unsafe units or drop-ins, or globally non-clean dpkg state.
- Do not repair unrelated dpkg state or build a general transaction framework. The update's own interruption behavior must nevertheless not create an undocumented manual-repair requirement.
- Ensure `github-runner` belongs to `docker`; ensure `agent-relay-builder` does not.
- Enable and start required services and socket units when needed, while preserving supported existing enablement and configuration.
- Validate CLI, daemon access, Buildx, and Compose as `github-runner` with reachable private `DOCKER_CONFIG`, a clean environment, and the explicit local Unix endpoint.
- A fresh installation or privileged acceptance may run `hello-world`. A repeated compatible update must not require registry access.
- Docker group access is intentionally root-equivalent access on the dedicated runner host.
- Add only the conventional `/var/run/docker.sock` and `/run/docker.sock` write permissions to the existing Codex filesystem policy.
- Docker and Compose application lifecycle remains Codex's responsibility.
- Make no public API, request schema, routing, result-semantic, finalization-decision, commit-decision, or GitHub Actions workflow change.
- Preserve current workflow behavior, including `CODEX_TRANSCRIPT_PATH` and direct `run-codex.mjs` invocation.

## Implementation Work

1. Re-read the complete current branch and current `main`; do not rely on earlier plan versions or completed plans.
2. Implement only the required Docker delta in `install.sh`, `update.sh`, toolchain environment, prompt/executor, provisioner/adapter, tests, and current documentation.
3. Restore unrelated current-main behavior such as the generic `rsync` prerequisite. Remove only obsolete Docker migration, package-journal, automatic global dpkg-recovery, custom-root, Docker-state `rsync`, and Agent Relay-managed application-lifecycle code or documentation.
4. Implement reachable private client state while keeping unrelated provisioner state inaccessible. Cleanup and stale-state recovery must be deterministic after success, failure, catchable signals, and hard interruption.
5. Use one production primary-fingerprint parser and one isolated GnuPG execution path for both existing and downloaded keys.
6. Validate apt-reader permissions for the selected key and all required ancestor directories.
7. Make managed repository publication restartable from observed state across unique writes, stage promotion, and final promotion. Reject symlinks, unrelated occupation, unsafe metadata, unexpected final content, and ambiguity.
8. Validate installed package provenance and coherent compatibility. For missing components, refresh apt metadata once, require an unambiguous official origin for every selected requested-package candidate, and keep simulation limited to explicit candidate versions, requested packages, and dependency closure; reject removal, purge, downgrade, unauthenticated packages, unrelated packages, or changes to installed packages.
9. Inspect every future-active service/socket unit and drop-in location, including effective content, before package installation and reinspect effective units and socket behavior after package work before explicit service operations.
10. Preserve updater ordering: acquire the stable update lock; stop the listener and wait for its worker; refresh and maintain noninteractive sudo authority; compile and fully finalize the runtime; run the provisioner in a separately terminable process group with an apt/dpkg-safe signal protocol; restore and verify the runner; then return the original Docker status. An incomplete replacement runtime leaves the runner stopped.
11. Make provisioner process-group startup, liveness, termination, and reaping race-safe and fully bounded for HUP, INT, and TERM.
12. Retain direct `/usr/bin/docker` use, private per-run `DOCKER_CONFIG`, exact socket permissions, and the workspace ownership invariant in the current-main executor and prompt.
13. Fix the failing system tests and add the missing behavioral coverage. Do not add or modify workflows to run privileged host tests on an incompatible host.
14. Update current documentation and PR-facing state only after behavior is implemented; do not claim privileged acceptance.
15. Run one complete `npm run check` after the last production edit, then review the final diff against current `main` and this plan point by point.

## Repository-Safe Tests

Required coverage includes:

- all current-main output, transcript, termination, workflow, executor, finalizer, generic toolchain including `rsync`, and sandbox regressions;
- fresh, complete-compatible, Buildx-missing, and Compose-missing classifications with isolated mutable state;
- conflicting, partial, broken, dangling-link, duplicate-plugin, unknown-owner, unsupported-installed-origin, mixed-version, dirty-dpkg, unreadable-key, unsafe-unit, and pre-existing service/socket/drop-in rejection before package mutation;
- supported daemon-independent CLI probe separated from daemon validation;
- compatible repository preservation and duplicate, disabled, ambiguous, insecure, unrelated, and same-version multi-origin rejection;
- one apt metadata refresh and one coherent candidate snapshot for multi-package selection;
- primary-key parsing with valid subkeys plus all malformed, duplicate, and unexpected-fingerprint cases;
- isolated GnuPG home with no ambient root-state access;
- apt-reader file and ancestor traversal permissions;
- interruption and rerun during unique staging writes, after complete staging, after stage promotion, and after each final publication;
- runner traversal to private Docker client state while private provisioner state remains inaccessible, plus stale-state recovery after hard interruption;
- no Docker/containerd configuration or data relocation and no production Docker-state `rsync` use;
- runner group inclusion, builder exclusion, explicit socket use, clean environment, and no registry access on repeated compatible update;
- effective `docker.service`, `docker.socket`, and `containerd.service` validation, including unsafe override, TCP listener, mask, alias, package-path leftover, and socket endpoint cases;
- updater fast-child completion, unidentifiable running PGID failure, descendant-survival handling, graceful signal exit, forced escalation, bounded reaping, full-lifetime sudo behavior, finalization ordering, runner restoration, and apt/dpkg critical-section semantics;
- a Docker bind-mount case that creates files and proves Codex leaves the workspace fully runner-owned before finalization;
- exact system-test harness interception and diagnostics without replacing production semantics with static assertions;
- exactly one active ExecPlan and canonical workflows unchanged from `main`.

## Real-Host Acceptance Blocker

Privileged acceptance is separate from ordinary repository CI. No manual command execution or human interpretation is an acceptance step.

The eventual automated disposable or explicitly designated Debian 13 x86-64 systemd harness must create isolated starting states, run the exact checked-out `install.sh` and `update.sh`, capture machine-readable before/after evidence, and fail its own job on any unsatisfied assertion. It must cover fresh installation and `hello-world`; preservation of a compatible official installation; missing-plugin cases; repository, installed-package provenance, candidate snapshot, key, service/socket unit, and dpkg rejection; interruption and rerun through repository publication and package phases; stale-state recovery; service, socket, and group state; registry-disabled repeated update; runtime and Docker failure ordering; bounded signal escalation; and a real Agent Relay request where Codex starts Compose, reads logs, executes a command, leaves the workspace runner-owned, and shuts the project down.

Current blocker: no automated disposable or designated Debian systemd host lifecycle is available to this repository task. Impact: privileged apt, dpkg, systemd, group, socket, daemon, registry, signal, and end-to-end acceptance cannot execute. Unblock: provide an automated host lifecycle and job interface that creates or resets required states and returns captured evidence to the agent or CI.

## Acceptance Criteria

- The branch remains based on current `main` and preserves its output, workflow, and generic toolchain behavior.
- `update.sh` provides ordinary Docker CLI, Buildx, Compose, and local daemon access to Codex on the supported host.
- Existing compatible official Docker/containerd configuration, listeners, versions, data, and storage roots are preserved.
- Only missing supported components and approved dependencies are installed from one verified repository snapshot.
- Package provenance, repository, key, service/socket unit, process, signal, sudo, and interruption handling satisfies the requirements above.
- `github-runner` can use private client state and the local socket; `agent-relay-builder` remains excluded; no stale client state remains after recovery.
- The runner is never restored against an incomplete replacement runtime.
- Docker/Compose lifecycle remains Codex's responsibility and the workspace remains runner-owned for finalization.
- `npm run check` and normal CI pass on the exact final commit.
- Independent final review finds no unresolved correctness, security, restartability, maintainability, or current-main regression issue.
- Privileged real-host acceptance remains explicitly blocked until automated evidence exists.

## Progress

- [x] Rejected storage migration, custom roots, Docker-state `rsync`, global dpkg repair, and Agent Relay-managed Compose lifecycle.
- [x] Rebuilt the branch on current `main` and consolidated to one active plan.
- [x] Completed independent review of the current provisioner/updater implementation and recorded the initial blocking findings.
- [x] Collected hosted diagnostic traces showing system-test failure; restored canonical CI and removed temporary PR-26 workflows.
- [x] Re-reviewed the complete PR against current `main` and expanded this plan with current-main regression, package provenance, apt snapshot, unit/socket, command residue, sudo lifetime, interruption, stale-state, and ownership findings.
- [ ] Implement the corrected Docker delta and behavioral tests.
- [ ] Run final repository validation and exact-head CI.
- [ ] Complete independent final diff and job-log review.
- [blocked] Run privileged real-host acceptance; cause, impact, and unblock condition are recorded above.

## Surprises & Discoveries

- The no-`rsync` Docker decision was applied to the whole generic toolchain, creating an unrelated regression from `main`.
- Static tests currently describe fixed-name publication as atomic even though interruption during the write leaves an unrecoverable partial stage.
- Exact-head CI passes TypeScript, coverage, runtime build, shell syntax, Node syntax, and toolchain checks, but fails `check:system`; the Codex workflow therefore stops in validation before the Codex job.
- The package adapter validates new candidate origins but does not validate the provenance of an existing installation it intends to reuse.
- The updater's generic process-group kill policy and the adapter's fail-closed dirty-dpkg policy are individually reasonable but contradictory when a signal arrives during package mutation.

## Decision Log

- Preserve Docker's existing compatible official or package-default state because direct socket access requires no relocation.
- Fail on unrelated non-clean dpkg state rather than owning global repair, while ensuring this update does not itself create an undocumented repair requirement.
- Isolate GnuPG state, require apt-reader access, and require unambiguous installed and candidate package origin.
- Use one refreshed apt metadata snapshot per package transaction.
- Inspect effective future-active systemd service and socket content before package post-install scripts can start services.
- Use bounded process-group termination with an apt/dpkg-safe critical-section protocol so an interrupted update cannot hang or corrupt package state.
- Preserve the generic current-main toolchain; the `rsync` prohibition applies only to Docker/containerd state handling.
- Keep canonical workflows unchanged; host-incompatible temporary diagnostics are not product validation.
- Leave application container lifecycle to Codex and retain the strict workspace ownership finalizer.

## Outcomes & Retrospective

Not complete. Do not move this plan to `completed/` or claim merge readiness until all non-privileged criteria, independent review, and exact-head CI are satisfied.