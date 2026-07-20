# Install Docker for Codex with persistent host storage

Completed ExecPlan for PR #26.

## Purpose

Make `./update.sh` install and maintain rootful Docker Engine, Buildx, and Compose v2 for `github-runner`, using the ordinary `/usr/bin/docker` CLI and local Unix socket.

Permanent state is created before first activation:

- Engine: `/srv/github-runner/storage/docker/engine`
- containerd: `/srv/github-runner/storage/docker/containerd`

No Docker data migration or copying path was added.

## Final scope and decisions

- Docker is provisioned only through `update.sh` on Debian x86-64.
- Docker's official apt repository supplies Engine, CLI, containerd, Buildx, and Compose.
- Exact related dpkg `rc` records are cleanable compatibility state rather than an automatic rejection.
- Allowlisted Docker/containerd remnants can be cleaned only after full safety classification.
- Cleanup runs as classify -> one mutation stage -> classify.
- Unrelated shared apt and systemd content is preserved.
- Populated data, active or partial installations, foreign commands, processes, units, and mounted cleanup content are rejected rather than adopted or removed.
- Recursive cleanup targets and shared plugin, systemd, and apt roots are checked through `/proc/self/mountinfo` before inventory and again before mutation.
- `github-runner` belongs to the Docker group; `agent-relay-builder` remains outside it.
- Codex controls application-container lifecycle through the ordinary Docker CLI.
- Existing workflows, API, routing, output, finalization, and sandbox contracts remain unchanged.
- Operational work after merge is outside this plan and is not a required PR action item.

## Implementation evidence

The final implementation revision is `af383c9fbc915e45f907f0b4b6ac23a1840ae71c`.

It includes:

- exact package, repository, dependency, phase, storage, service, socket, process-group, plugin, unit, alias, and activation-link validation;
- bounded and restartable cleanup of exact residual-package state and allowlisted non-package-owned remnants;
- complete reclassification between destructive cleanup stages;
- atomic preservation of unrelated shared apt content;
- cleanup of all supported direct plugin entry types;
- mounted recursive-tree and shared-root rejection with pre-mutation rechecks;
- validation-only behavior for an already completed managed installation.

Codex workflow run `29756594484` completed successfully. Both its validation and implementation jobs passed.

`npm run check` passed with:

- 137 passing tests;
- 100% measured TypeScript source coverage;
- successful runtime, shell, Node-script, toolchain, installer, updater, and repository-safe system checks.

Independent implementation review found no unresolved correctness, data-safety, restartability, maintainability, scope, or current-main regression issue.

## Normal CI and log review

Connector-authored head `6ad04b2dce0e5151ea97534575eb7ac6f9ca5b70` triggered normal CI run `29763709695` (#847).

The run completed successfully. The required job steps passed:

- dependency installation;
- TypeScript typecheck;
- tests and coverage;
- production runtime build validation;
- shell-script validation;
- Node-script validation;
- toolchain validation;
- system-script validation.

The test-failure artifact step was skipped because the test step succeeded. The log contained only an informational GitHub Actions message about Node 20 deprecation; the runner used Node 24. No hidden failure or skipped required validation was found.

## Progress

- [x] Architecture and permanent storage roots established.
- [x] No-migration decision implemented.
- [x] Package, repository, phase, service, process, storage, plugin, systemd, cleanup, and mount contracts implemented.
- [x] Exact `rc` and non-package-owned remnant cleanup implemented.
- [x] Complete reclassification between destructive stages implemented.
- [x] Atomic shared-source preservation and interrupted-stage recovery implemented.
- [x] Recursive-tree and shared-root mount protection implemented.
- [x] Codex workflow run `29756594484` passed.
- [x] `npm run check` passed with 137 tests and 100% measured TypeScript source coverage.
- [x] Independent implementation review found no remaining code issue.
- [x] Normal CI passed on connector-authored head `6ad04b2d` through run `29763709695` (#847).
- [x] Exact-head normal-CI job log was reviewed; no hidden failure or skipped required validation remained.

## Outcome

Implementation and repository acceptance are complete. All plan items are checked and supported by automated evidence. PR #26 is ready to merge.