# Install Docker for Codex with persistent host storage

This ExecPlan follows `.agent/PLANS.md` and is the only active plan for this pull request.

## Purpose

Make `./update.sh` install and maintain rootful Docker Engine, Buildx, and Compose v2 for `github-runner`, so Codex can use the ordinary `/usr/bin/docker` CLI and the local Unix socket.

Docker Engine and containerd must store their persistent state below `/srv/github-runner/storage/docker`:

- Docker Engine: `/srv/github-runner/storage/docker/engine`;
- containerd: `/srv/github-runner/storage/docker/containerd`.

This is a fresh-host installation contract. There is no previous Docker state to migrate. The first successful update configures the permanent storage locations before Docker or containerd starts for the first time. Later updates validate and reuse the exact managed installation created by this feature.

Agent Relay remains only the execution bridge. It does not parse Docker commands, proxy the Docker API, register Compose projects, or manage application-container lifecycle. Codex decides when to run `compose up`, `logs`, `exec`, `restart`, and `down`.

## Current Baseline

The branch is based on current `main` commit `7c148c242feb421b59647f144ab6b78fe691af28`. Preserve the current normalized Codex output, transcript, timeout, finalization, and workflow behavior.

The existing `.github/workflows/codex.yml` already supports manual execution through `workflow_dispatch`, validates the selected PR head, and runs Codex directly in the dedicated `codex` job. No workflow change is required to make this branch capable of running Codex.

The checked-in Docker implementation is not aligned with the target architecture. It preserves package-default storage locations and attempts to support arbitrary compatible existing installations. Replace that behavior with the fresh-or-exact-managed-state contract defined here.

## Binding Decisions

- Docker provisioning runs only from `update.sh`. `install.sh` only protects the checked-in provisioner scripts and installs generic host prerequisites.
- The current package adapter supports Debian x86-64 and Docker's official apt repository.
- The initial supported state is a host without Docker Engine, Docker CLI, containerd, Buildx, Compose, Docker configuration, or Docker data.
- A later update may reuse only the exact managed installation and storage configuration produced by this feature.
- Unknown pre-existing Docker packages, commands, configuration, units, sockets, or non-empty managed storage directories fail before package mutation with a clear diagnostic.
- Install `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, and `docker-compose-plugin` from the official repository.
- Configure Docker `data-root` as `/srv/github-runner/storage/docker/engine`.
- Configure containerd top-level `root` as `/srv/github-runner/storage/docker/containerd`.
- Package installation must not allow Docker or containerd to start before both configurations and managed directories are complete and validated.
- After configuration, enable and start the required service and socket units explicitly.
- Ensure `github-runner` belongs to `docker`; ensure `agent-relay-builder` does not.
- Validate Docker, Buildx, Compose, daemon access, storage roots, group membership, and the local socket as `github-runner` with a clean environment and private `DOCKER_CONFIG`.
- Run `hello-world` only on the first successful installation or an explicit host-acceptance run. Repeated managed updates must not depend on registry access.
- Docker group membership is intentionally root-equivalent access on the dedicated runner VM.
- Add the conventional `/var/run/docker.sock` and `/run/docker.sock` write permissions to the existing Codex filesystem policy.
- Preserve the existing public API, request contract, routing, result semantics, commit decision, finalization decision, and GitHub Actions workflows.

## Blocking Review Findings

1. `scripts/docker-host.sh` currently leaves Docker and containerd on package-default storage. It must create, configure, and validate the required `/srv/github-runner/storage/docker` layout before first service startup.
2. The current classification model accepts arbitrary complete installations and missing-plugin states. Limit reuse to an exact managed state created by this feature; reject unrelated existing installations instead of expanding compatibility logic.
3. Docker packages can start services from package post-install scripts. Add a bounded installation phase that prevents service activation until the managed directories and both configuration files are atomically installed and validated.
4. Define an exact managed-state marker or equivalent deterministic evidence binding the installed package set, storage configuration, and managed directory layout. A second `update.sh` run must distinguish the feature's own installation from an unrelated pre-existing installation.
5. Managed apt key and source files are written through fixed staging paths. An interruption during the write can leave a partial file that blocks every later run. Write complete content to a unique same-directory temporary file, validate it, then publish it atomically. Add rerun tests for interruption before and after each publication boundary.
6. The updater obtains sudo credentials before waiting for `Runner.Worker`. Refresh credentials after that wait and ensure remaining privileged operations, signal handling, cleanup, and runner restoration cannot prompt interactively.
7. Provisioner termination currently checks launcher liveness rather than the process-group state and ends with an unbounded `wait`. Implement bounded TERM, bounded KILL, process-group liveness checks, and bounded reaping without leaving the runner permanently stopped after a finalized runtime.
8. The system test harness must intercept the exact production command paths and retain child stdout/stderr on failure. Tests must exercise production helpers and real temporary filesystem/process behavior rather than proving behavior through source-string assertions alone.
9. Direct Docker bind mounts can create files not owned by `github-runner`, while `runner/finalize.sh` correctly rejects foreign-owned workspace content. Update the Codex instruction and tests so Docker-based work leaves the repository fully owned by the runner before finalization.
10. Earlier exact-head CI runs failed in `npm run check:system` because the updater harness did not model absolute privileged command paths and one package test marked `unrelated-agent` as allowed while expecting rejection. Those harness defects are corrected; preserve the complete system gate and do not weaken production assertions.
11. `docker_debian_install_components` derives `allowed.txt` from recursive apt dependency output, which may contain dependency alternatives that the resolver did not select. Bind every newly installed dependency to the exact requested candidate versions and the resolver-selected dependency path. Reject unselected alternatives or unrelated packages even when they appear in a broad dependency listing, and retain acceptance of genuinely selected dependencies.

## Implementation Work

1. Re-read the current branch, current `main`, and this plan before editing.
2. Simplify the provisioner state model to:
   - fresh supported host;
   - exact managed installation produced by this feature;
   - unsupported or ambiguous state that fails before mutation.
3. Create `/srv/github-runner/storage/docker`, `engine`, and `containerd` with root ownership and restrictive modes suitable for daemon-managed data.
4. Install the official Docker packages while preventing premature service and socket activation.
5. Atomically publish and validate:
   - Docker's official apt key and source definition;
   - `/etc/docker/daemon.json` with the managed `data-root`;
   - `/etc/containerd/config.toml` with the managed top-level `root`;
   - the managed-state evidence needed for safe repeated updates.
6. Resolve one exact package transaction from one repository snapshot. Prove each new dependency belongs to the resolver-selected closure for the exact requested candidate versions before installation.
7. Start services only after package, configuration, directory, and unit validation succeeds.
8. Verify the effective Docker and containerd roots after startup, not only the configuration-file text.
9. Enforce runner/builder group membership and validate the ordinary CLI through the local socket and private client state.
10. Correct updater sudo lifetime, process-group termination, bounded reaping, runtime-finalization, and runner-restoration behavior.
11. Keep Docker and Compose lifecycle decisions in Codex. Add only the ownership guidance needed for successful repository finalization.
12. Replace obsolete tests for arbitrary existing installations with tests for fresh installation, exact managed reuse, unsupported-state rejection, and selected dependency closure.
13. Run one final `npm run check` and review every plan item against the final diff.
14. Update PR-facing documentation only after the implementation and repository-safe validation are complete.

## Repository-Safe Tests

Required coverage includes:

- fresh-host classification and exact official package request;
- rejection of pre-existing packages, commands, configuration, units, sockets, or populated managed directories that were not created by this feature;
- creation and metadata of the managed `/srv/github-runner/storage/docker` directory tree;
- prevention of Docker, containerd, and socket activation before managed configuration publication;
- atomic apt key/source and daemon/containerd configuration publication with deterministic rerun after interruption;
- exact managed-state recognition on the second update without package reinstall or registry access;
- effective Docker root `/srv/github-runner/storage/docker/engine` and effective containerd root `/srv/github-runner/storage/docker/containerd`;
- exact candidate versions and resolver-selected dependency closure, including rejection of an unselected alternative and an unrelated package;
- official package ownership, service/socket state, local socket access, Buildx, Compose, and first-install `hello-world` policy;
- `github-runner` Docker membership and `agent-relay-builder` exclusion;
- private per-run `DOCKER_CONFIG` and exact socket filesystem permissions;
- sudo refresh after the runner-worker wait;
- fast provisioner completion, unidentifiable process-group failure, descendant survival, TERM/KILL escalation, bounded reaping, and runner restoration;
- Docker workspace operations leaving every repository path owned by `github-runner` before finalization;
- all current-main output, transcript, executor, finalizer, workflow, and sandbox regressions;
- exactly one active ExecPlan and no workflow change.

## Real-Host Acceptance

Repository-safe tests cannot prove privileged apt, systemd, daemon, socket, group, storage-root, or end-to-end Docker behavior.

The automated disposable or designated Debian 13 x86-64 systemd host acceptance must cover:

- a clean host with no Docker state;
- first installation without premature service startup;
- effective Engine and containerd roots below `/srv/github-runner/storage/docker`;
- first-install `hello-world`;
- a second update with registry access disabled;
- service, socket, package, configuration, ownership, and group evidence;
- interruption and rerun during repository/configuration publication and package installation;
- runtime failure and Docker failure restoration behavior;
- TERM, INT, and HUP handling;
- a real Agent Relay request where Codex starts Compose, reads logs, executes a command, leaves the workspace runner-owned, and shuts the project down.

If this automated host lifecycle is unavailable, keep this acceptance item blocked with the exact cause and unblock condition. Do not claim real-host success.

## Acceptance Criteria

- The existing GitHub Action remains able to validate the PR and run Codex directly.
- `update.sh` installs Docker Engine, Buildx, and Compose on the supported fresh host.
- Docker Engine uses `/srv/github-runner/storage/docker/engine` from its first start.
- containerd uses `/srv/github-runner/storage/docker/containerd` from its first start.
- A repeated update recognizes and reuses the exact managed installation without registry access or unnecessary package mutation.
- The exact package transaction cannot install an unselected dependency alternative or unrelated package.
- Unknown pre-existing Docker state fails before mutation.
- `github-runner` can use Docker through the ordinary CLI and local socket; `agent-relay-builder` cannot.
- The runner is never started against an incomplete replacement runtime.
- Docker application lifecycle remains Codex's responsibility.
- `npm run check` and normal CI pass on the exact final head.
- Independent final review finds no unresolved correctness, restartability, security, maintainability, or current-main regression issue.

## Progress

- [x] Confirmed that the current Codex workflow already supports manual dispatch and direct Codex execution; no workflow change is required.
- [x] Re-reviewed the current implementation against the corrected fresh-host persistent-storage requirement.
- [x] Replaced the previous no-storage-change plan with the required permanent `/srv` storage design.
- [x] Corrected the system-test harness command interception, canonical-path simulation, contradictory repository assertion, and restored the complete system validation gate.
- [x] Implemented the corrected provisioner, persistent storage, fresh-or-managed state marker, controlled package transaction and recovery, updater behavior, socket permissions, ownership guidance, and repository-safe tests.
- [x] Ran final repository validation: `npm run check` passed on the working tree on 2026-07-20, including 135 Node tests with 100% source coverage, runtime compilation, shell and Node syntax checks, toolchain smoke, and all three system harnesses.
- [blocked] Run exact-head GitHub CI. Cause: this execution environment has no readable GitHub workflow skill and no `gh` executable or other authenticated job interface. Impact: no exact-head remote job logs can be captured here. Unblock condition: an automated authenticated GitHub CI interface becomes available for this checkout.
- [x] Completed a final local diff review covering fresh-state rejection, marker phases, interrupted dpkg recovery, atomic publication, configuration and storage validation, effective roots, package/unit/socket ownership, sudo lifetime, process-group cleanup, documentation, and absence of workflow changes; `git diff --check` passed.
- [blocked] Obtain an independent final review. Cause: no independent automated reviewer was authorized or available in this execution. Impact: the local review is not independent acceptance evidence. Unblock condition: make an independent agent or automated review job available to review the exact final diff and validation evidence.
- [blocked] Run automated privileged real-host acceptance. Cause: no disposable or explicitly designated Debian 13 x86-64 systemd host lifecycle is available to this execution environment. Impact: privileged apt, systemd, daemon, socket, storage-root, interruption, signal, and real Compose behavior are not accepted. Unblock condition: provide an automated disposable or designated host lifecycle with permission to install packages and exercise the required failure matrix.

## Surprises & Discoveries

- The current implementation solves a broader existing-installation compatibility problem, while the requested host is a fresh installation with fixed persistent storage.
- Package post-install service activation must be controlled, otherwise Docker can create state in package-default locations before the permanent roots are configured.
- The Codex workflow is present and executable; an individual failed validation run is not evidence that the branch lacks a Codex execution path.
- A recursive apt dependency listing is not equivalent to the resolver-selected dependency closure when alternatives exist.
- A durable transaction-phase marker is required before apt mutation; otherwise an interrupted dpkg operation cannot be safely distinguished from unrelated dirty global package state on rerun.
- The local validation environment denies `/tmp`; CI helper scripts now honor the trusted `TMPDIR` fallback when `RUNNER_TEMP` is absent.
- The checkout has no `gh` executable, so local validation cannot be supplemented with exact-head GitHub job-log evidence.

## Decision Log

- Use one permanent managed storage tree below `/srv/github-runner/storage/docker`.
- Configure both roots before the first daemon start because the target host has no prior Docker state to migrate.
- Reuse only the exact managed installation created by this feature; fail on unrelated existing Docker state.
- Bind package mutation to exact candidates and the selected dependency closure.
- Record the resolver-selected package/version transaction before apt mutation, retain the exact service-start suppression policy across an interrupted transaction, and permit recovery only when every non-clean dpkg package belongs to that marker.
- Use `preparing`, `transaction`, `installed`, and `complete` marker phases so `hello-world` runs on the first successful installation, including a retry after a post-install validation failure, while completed updates remain registry-independent.
- Keep the existing Codex workflow and direct Docker CLI model.
- Keep application-container lifecycle under Codex control.

## Outcomes & Retrospective

Implementation and repository-safe validation are complete. The final working-tree gate passed on 2026-07-20 and no GitHub Actions workflow changed. The plan remains active because exact-head GitHub CI, independent final review, and the automated privileged real-host acceptance matrix are blocked by unavailable execution interfaces. Do not treat the Docker host contract as deployment-accepted until all three blockers are resolved.
