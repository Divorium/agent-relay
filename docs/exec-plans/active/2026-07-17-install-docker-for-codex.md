# Provide direct Docker access to Codex

This ExecPlan follows `.agent/PLANS.md` and is the only active plan for this pull request.

## Purpose

Make `./update.sh` ensure that `github-runner`, and therefore Codex, can use the ordinary rootful host Docker CLI and local Unix socket for Engine, Buildx, and Compose operations. Agent Relay must not become a Docker proxy, command parser, project registry, Compose lifecycle manager, or container supervisor.

Preserve existing Docker and containerd data, configuration, listeners, versions, images, containers, volumes, networks, and storage locations. Do not copy or move Docker state, use `rsync`, set `data-root`, set containerd `root`, or rewrite `/etc/docker/daemon.json` or `/etc/containerd/config.toml`.

## Current Baseline

The branch is based on current `main` commit `7c148c242feb421b59647f144ab6b78fe691af28`, including the completed normalized Codex output work from pull request #35. Preserve its JSONL protocol handling, live normalized output, transcript artifact, bounded queues, termination controller, workflow behavior, tests, and documentation. Apply only the Docker-specific delta.

The checked-in Docker provisioner, Debian adapter, updater integration, and tests are incomplete implementation material. Do not treat their current presence as acceptance evidence.

Temporary hosted PR-26 diagnostic workflows were removed after collecting their traces. The canonical `.github/workflows/ci.yml` is restored exactly to `main`; no workflow change is required for this feature.

## Blocking Review Findings

1. The runner-owned validation client directory was below a root-owned `0700` parent. The current implementation changed the outer state container to traversable `0711`; retain this separation and add a behavioral traversal test proving `github-runner` can use only its own client directory while the private provisioner state remains inaccessible.
2. GnuPG parsing must require exactly one primary `pub` and its associated primary fingerprint while permitting valid subkey records. Reject malformed ordering, multiple primary keys, missing or duplicate primary fingerprints, and an unexpected primary fingerprint.
3. GnuPG inspection must run in an explicit clean environment with a private `GNUPGHOME` below the provisioner state root and must never depend on or create `/root/.gnupg`.
4. A root-owned key can still be unreadable by apt's unprivileged acquisition path. Validate canonical regular-file type, ownership, non-writability, file readability, and traversal permissions for every required ancestor directory.
5. Managed apt key and source publication is not restartable during the write itself. Writing directly to the fixed `.new` path can leave a secure but partial file after interruption, and the next run rejects it permanently. Use an interruption-safe same-directory temporary write followed by atomic promotion, or a deterministic safe recreation contract for a root-owned partial stage. Test interruption during the actual write, after complete staging, and after each final rename.
6. `docker version --client` is unsupported. Probe the CLI daemon-independently with `docker --version`, then validate the daemon separately through the explicit local socket.
7. Candidate validation must reject a selected requested-package version when any `apt-cache madison` row for that version is not Docker's official repository. Do not accept the version merely because at least one official row exists.
8. Fresh-host systemd preflight is incomplete. Before package mutation, inspect all future-active unit files and drop-in directories under `/etc/systemd/system`, `/run/systemd/system`, `/usr/lib/systemd/system`, and `/lib/systemd/system`, including package-path leftovers that can become active during post-install startup. Reject unsafe, unknown-owned, ambiguous, or unsupported content before apt runs.
9. Provisioner process-group startup must handle fast successful exit as an ordinary child result while rejecting an unidentifiable running group.
10. Signal termination is still not bounded or reliable. The current updater waits on launcher liveness rather than process-group liveness, can skip escalation when descendants survive a launcher exit, depends on a possibly expired sudo timestamp for root-group signals, and ends with an unbounded `wait`. Implement bounded TERM grace, bounded KILL grace, process-group liveness checks, reliable signaling, bounded reaping, and a final failure path that cannot hang. Runner restoration must still follow runtime-finalization state.
11. Refresh sudo credentials after waiting for `Runner.Worker` and before the first runtime mutation. A long-running job may outlive the initial sudo timestamp; preserve the corresponding current-`main` availability behavior.
12. Repository-safe tests must exercise production helpers or real temporary filesystem/process behavior. Static source assertions may guard architecture but cannot be the main evidence.
13. The Docker helper test currently expects `conflicting|` although the production parser intentionally retains the referenced key path in `conflicting|<path>`. Correct the assertion and test the semantic rejection through `docker_debian_repository_records_acceptable`.
14. The updater integration test does not intercept the absolute `/usr/bin/sudo` used by the launcher and redirects the useful child diagnostic away from the uploaded trace. Transform the exact command path, preserve stdout/stderr on failure, and make the test fail with a diagnostic that identifies the production step.
15. Existing tests do not yet prove managed publication recovery, apt-reader access, isolated GnuPG state, same-version multi-origin rejection, future-active unit/drop-in rejection, fast-child completion, process-group TERM/KILL escalation, or post-failure runner restoration. Add deterministic behavioral cases for all of them.
16. Keep exactly one active ExecPlan. Privileged real-host acceptance remains in this plan and `test-host/README.md`; do not create another active plan.

## Binding Decisions

- Docker provisioning runs only from `update.sh`. `install.sh` remains Docker-free apart from securing checked-in scripts and generic prerequisites already required by the host.
- The architecture remains portable across systemd-capable Linux hosts. The current package adapter supports Debian x86-64 through Docker's official apt repository.
- A fresh supported host may receive exactly `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, and `docker-compose-plugin` plus approved dependency closure.
- Reuse a complete compatible official installation. Install only a missing Buildx or Compose plugin when the core installation is compatible.
- Preserve working component versions. Do not upgrade an installed package merely because a newer candidate exists.
- Fail before Docker package mutation on conflicting packages, partial state, broken executables, unknown command ownership, ambiguous or insecure repositories, unreadable keys, unsafe units or drop-ins, or globally non-clean dpkg state.
- Do not repair unrelated dpkg state or build a general transaction framework.
- Ensure `github-runner` belongs to `docker`; ensure `agent-relay-builder` does not.
- Enable and start required services when needed.
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
3. Remove obsolete migration, package-journal, automatic dpkg-recovery, custom-root, `rsync`, and Agent Relay-managed application-lifecycle code or documentation.
4. Implement reachable private client state while keeping unrelated provisioner state inaccessible. Cleanup must be deterministic after success, failure, and signals.
5. Use one production primary-fingerprint parser and one isolated GnuPG execution path for both existing and downloaded keys.
6. Validate apt-reader permissions for the selected key and all required ancestor directories.
7. Make managed repository publication restartable from observed state across the actual write and rename boundaries. Reject symlinks, unrelated occupation, unsafe metadata, unexpected final content, and ambiguity.
8. Require an unambiguous official origin for each selected requested-package candidate. Keep simulation limited to explicit candidate versions, requested packages, and dependency closure; reject removal, purge, downgrade, unauthenticated packages, unrelated packages, or changes to installed packages.
9. Inspect every future-active unit and drop-in location before package installation and reinspect effective units after package work before explicit service operations.
10. Preserve updater ordering: acquire the stable update lock; stop the listener and wait for its worker; refresh sudo; compile and fully finalize the runtime; run the provisioner in a separately terminable process group; restore and verify the runner; then return the original Docker status. An incomplete replacement runtime leaves the runner stopped.
11. Make provisioner process-group startup and termination race-safe and fully bounded for HUP, INT, and TERM.
12. Retain direct `/usr/bin/docker` use, private per-run `DOCKER_CONFIG`, and exact socket permissions in the current-main executor.
13. Fix the failing system tests and add the missing behavioral coverage. Do not add or modify workflows to run them on an incompatible host.
14. Update current documentation and PR-facing state only after behavior is implemented; do not claim privileged acceptance.
15. Run one complete `npm run check` after the last production edit, then review the final diff against current `main` and this plan.

## Repository-Safe Tests

Required coverage includes:

- all current-main output, transcript, termination, workflow, executor, finalizer, and sandbox regressions;
- fresh, complete-compatible, Buildx-missing, and Compose-missing classifications with isolated mutable state;
- conflicting, partial, broken, unknown-owner, dirty-dpkg, unreadable-key, unsafe-unit, and pre-existing unit/drop-in rejection before package mutation;
- supported daemon-independent CLI probe separated from daemon validation;
- compatible repository preservation and duplicate, disabled, ambiguous, insecure, unrelated, and same-version multi-origin rejection;
- primary-key parsing with valid subkeys plus all malformed, duplicate, and unexpected-fingerprint cases;
- isolated GnuPG home with no ambient root-state access;
- apt-reader file and ancestor traversal permissions;
- interruption and rerun during staging writes, after complete staging, and after key/source final publication;
- runner traversal to private Docker client state while private provisioner state remains inaccessible;
- no Docker/containerd configuration or data relocation and no production `rsync` use;
- runner group inclusion, builder exclusion, explicit socket use, clean environment, and no registry access on repeated compatible update;
- updater fast-child completion, unidentifiable running PGID failure, descendant-survival handling, graceful signal exit, forced escalation, bounded reaping, sudo-refresh ordering, finalization ordering, and runner restoration semantics;
- exactly one active ExecPlan and canonical workflows unchanged from `main`.

## Real-Host Acceptance Blocker

Privileged acceptance is separate from ordinary repository CI. No manual command execution or human interpretation is an acceptance step.

The eventual automated disposable or explicitly designated Debian 13 x86-64 systemd harness must create isolated starting states, run the exact checked-out `install.sh` and `update.sh`, capture machine-readable before/after evidence, and fail its own job on any unsatisfied assertion. It must cover fresh installation and `hello-world`; preservation of a compatible installation; missing-plugin cases; repository, package, key, unit, and dpkg rejection; interruption and rerun; service and group state; registry-disabled repeated update; runtime and Docker failure ordering; bounded signal escalation; and a real Agent Relay request where Codex starts Compose, reads logs, executes a command, and shuts the project down.

Current blocker: no automated disposable or designated Debian systemd host lifecycle is available to this repository task. Impact: privileged apt, dpkg, systemd, group, socket, daemon, registry, signal, and end-to-end acceptance cannot execute. Unblock: provide an automated host lifecycle and job interface that creates or resets required states and returns captured evidence to the agent or CI.

## Acceptance Criteria

- The branch remains based on current `main` and preserves its output and workflow behavior.
- `update.sh` provides ordinary Docker CLI, Buildx, Compose, and local daemon access to Codex on the supported host.
- Existing or package-default Docker/containerd configuration, listeners, versions, data, and storage roots are preserved.
- Only missing supported components and approved dependencies are installed.
- Package, repository, key, unit, process, and signal handling satisfies the requirements above.
- `github-runner` can use private client state and the local socket; `agent-relay-builder` remains excluded.
- The runner is never restored against an incomplete replacement runtime.
- Docker/Compose lifecycle remains Codex's responsibility.
- `npm run check` and normal CI pass on the exact final commit.
- Independent final review finds no unresolved correctness, security, restartability, maintainability, or current-main regression issue.
- Privileged real-host acceptance remains explicitly blocked until automated evidence exists.

## Progress

- [x] Rejected storage migration, custom roots, `rsync`, global dpkg repair, and Agent Relay-managed Compose lifecycle.
- [x] Rebuilt the branch on current `main` and consolidated to one active plan.
- [x] Completed independent review of the current provisioner/updater implementation and recorded blocking findings.
- [x] Collected hosted diagnostic traces showing all three system scripts failing; restored canonical CI and removed the temporary PR-26 workflow.
- [ ] Implement the corrected Docker delta and behavioral tests.
- [ ] Run final repository validation and exact-head CI.
- [ ] Complete independent final diff and job-log review.
- [blocked] Run privileged real-host acceptance; cause, impact, and unblock condition are recorded above.

## Decision Log

- Preserve Docker's existing or package-default state because direct socket access requires no relocation.
- Fail on unrelated non-clean dpkg state rather than owning global repair.
- Isolate GnuPG state, require apt-reader access, and require unambiguous requested-package origin.
- Inspect future-active systemd content before package post-install scripts can start services.
- Use bounded process-group termination so an interrupted update cannot hang indefinitely.
- Keep canonical workflows unchanged; host-incompatible temporary diagnostics are not product validation.
- Leave application container lifecycle to Codex.

## Outcomes & Retrospective

Not complete. Do not move this plan to `completed/` or claim merge readiness until all non-privileged criteria, independent review, and exact-head CI are satisfied.
