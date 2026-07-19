# Provide direct Docker access to Codex

This ExecPlan follows `.agent/PLANS.md`. It is the only active plan for this pull request.

## Purpose

Make `./update.sh` ensure that `github-runner`, and therefore Codex, can use the ordinary rootful host Docker CLI and local Unix socket for Docker, Buildx, and Compose operations. Agent Relay must not become a Docker proxy, command parser, project registry, Compose lifecycle manager, or container supervisor.

The implementation must preserve existing Docker and containerd data, configuration, listeners, versions, images, containers, volumes, networks, and storage locations. It must not copy or move Docker state, use `rsync`, set `data-root`, set containerd `root`, or rewrite `/etc/docker/daemon.json` or `/etc/containerd/config.toml`.

## Current Review Baseline

The branch is now cleanly based on current `main` commit `7c148c242feb421b59647f144ab6b78fe691af28`, including the completed normalized Codex output work from pull request #35. Preserve its JSONL execution, normalized live output, transcript artifact, bounded queues, termination controller, workflow transcript environment, tests, and documentation. Apply only the Docker-specific delta.

The branch contains the earlier `scripts/docker-host.sh` and `scripts/docker-host-debian.sh` implementation as review material. It is incomplete and must not be integrated unchanged. Independent review found these blocking defects:

1. `docker_host_validate` creates the runner-owned Docker client directory below a root-owned `0700` temporary parent. `github-runner` cannot traverse that parent, so the validation contract is not executable.
2. Docker signing-key validation requires exactly one `fpr` record from GnuPG. A valid OpenPGP key may contain subkey fingerprints. Identify exactly one primary `pub` record and its immediate primary fingerprint while permitting subkey records. Reject multiple primary keys, missing or duplicate primary fingerprints, malformed ordering, and an unexpected primary fingerprint.
3. Publishing the Agent Relay-managed apt key and source as two independent writes is not restartable. An interruption after either write can leave a safe partial state that the next run rejects forever. Recover only exact, secure Agent Relay-managed partial states; reject unrelated, ambiguous, or unsafe occupation.
4. The CLI compatibility probe uses `docker version --client`, which is not a supported Docker CLI form. Use a daemon-independent supported probe such as `docker --version`, then validate the daemon separately through the explicit local socket.
5. Existing key validation runs as root and accepts any non-writable mode. An apt keyring must also be readable by apt's unprivileged acquisition path. Validate suitable read permissions instead of accepting a root-only key.
6. GnuPG inspection must use an isolated private `GNUPGHOME` below the provisioner state root and a clean explicit environment. It must not create or depend on `/root/.gnupg` or ambient GnuPG configuration.
7. Repository-safe tests currently do not reproduce the directory traversal failure, primary/subkey fingerprint parsing, interrupted managed apt publication, invalid CLI probe, key readability, or isolated GnuPG state.
8. The pull request must keep exactly one active ExecPlan. Real-host acceptance remains recorded in this plan and `test-host/README.md`; do not create another active plan.

## Binding Decisions

- Docker provisioning runs only from `update.sh`. `install.sh` remains Docker-free apart from securing checked-in scripts under its existing contract.
- Keep architecture contracts portable across systemd-capable Linux hosts. The current package adapter supports Debian x86-64 through Docker's official Debian repository.
- A fresh supported host may receive `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, and `docker-compose-plugin`.
- Reuse a complete compatible official installation. Install only a missing Buildx or Compose plugin when the core installation is compatible.
- Preserve working component versions. Do not upgrade existing Docker core packages merely because newer candidates exist.
- Fail before Docker package mutation on conflicting distribution packages, partial package state, broken executables, unknown command ownership, ambiguous or insecure apt definitions, unsafe unit files, unreadable keyrings, or globally non-clean dpkg state.
- Do not implement global dpkg repair or a general package transaction framework.
- Preserve existing Docker/containerd configuration and data byte-for-byte.
- Ensure `github-runner` belongs to `docker`; ensure `agent-relay-builder` does not.
- Enable and start the required services when needed.
- Validate the ordinary `/usr/bin/docker` CLI without requiring the daemon, then validate local daemon connection, Buildx, and Compose as `github-runner` with an actually reachable private temporary `DOCKER_CONFIG` and an explicit local Unix endpoint.
- A fresh installation or privileged acceptance may run `hello-world`. Repeated compatible updates must not require registry access.
- Docker group access is intentionally root-equivalent host access on the dedicated runner host.
- Preserve the Codex workspace filesystem boundary and add only the two conventional local Docker socket paths required by the current permission model.
- Docker and Compose application lifecycle remains Codex's responsibility.
- Make no public API, request schema, routing, result-semantic, or commit-decision change.
- Do not redesign Codex output capture. Preserve current `main` unchanged except for the minimal Docker socket permissions and Docker-specific prompt/environment additions.
- Do not change the workflow merely to expose Docker. Preserve the current workflow behavior, including `CODEX_TRANSCRIPT_PATH` and direct `run-codex.mjs` invocation.

## Implementation Work

1. Starting from current `main`, integrate only the required Docker changes into `install.sh`, `update.sh`, toolchain environment, executor/prompt, repository validation, tests, and current documentation. Do not copy obsolete output or workflow code from earlier branch history.
2. Review the complete final diff. Remove migration, package-journal, automatic dpkg-recovery, custom-root, `rsync`, and Agent Relay-managed application lifecycle code or documentation.
3. Fix Docker client validation so the runner can traverse to and use the private client directory while unrelated provisioner state remains inaccessible. Cleanup must be deterministic on success, failure, and signals.
4. Implement one production helper for parsing GnuPG `--with-colons` output. Use it for existing and downloaded keys. Run GnuPG under an isolated private `GNUPGHOME` and explicit environment.
5. Require the selected apt keyring to be a canonical, regular, root-owned, non-writable file with permissions that allow apt's unprivileged reader to read it.
6. Make Agent Relay-managed apt repository publication restartable from observed filesystem state. Recognize only exact secure managed states: neither file present, both valid files present, valid managed key only, or valid managed source only. Complete safe partial states deterministically. Reject symlinks, unsafe ownership or mode, unexpected content, conflicting definitions, unrelated occupation, and ambiguous keys before package mutation.
7. Keep package simulation conservative: explicit candidate versions from Docker's official repository, requested packages plus dependency closure only, no removal, purge, downgrade, unauthenticated package, or modification of an already installed package.
8. Preserve updater semantics: compile and fully finalize the new runtime before Docker provisioning; leave the runner stopped for incomplete runtime; after Docker failure restore and verify the finalized runtime and runner, then return the Docker failure. Forward TERM, INT, and HUP to the active provisioner process group and wait for it before restoration.
9. Retain direct Docker access through `/usr/bin/docker`, private per-run `DOCKER_CONFIG`, and write permission for `/var/run/docker.sock` and `/run/docker.sock` in the current-main executor implementation.
10. Update documentation to the final implemented state without claiming privileged acceptance.
11. Run one complete `npm run check` only after the last production edit, then review the final diff against current `main` and this plan.

## Repository-Safe Tests

Tests must exercise production helpers or real temporary filesystem/process behavior. Static source assertions may guard architecture but do not substitute for behavioral evidence.

Required coverage:

- all current-main normalized output, transcript, termination, workflow, executor, finalizer, and sandbox tests remain passing;
- fresh host classification requests exactly the five official packages;
- a complete compatible installation performs no package, configuration, or data mutation;
- missing Buildx or Compose selects only that plugin;
- conflicts, partial packages, broken commands, unknown ownership, unsafe units, unreadable keyrings, and dirty dpkg fail before package mutation;
- the CLI probe uses a supported daemon-independent invocation, and daemon validation remains separate;
- compatible apt definitions are preserved and duplicate, ambiguous, insecure, disabled-managed, or unrelated definitions fail safely;
- GnuPG parsing accepts one primary key with subkeys and rejects multiple primary keys, missing or duplicate primary fingerprints, malformed ordering, and an unexpected fingerprint;
- GnuPG inspection uses only the isolated provisioner home and does not touch ambient root state;
- exact managed apt publication resumes after interruption following either publication step, while unsafe or unrelated partial states fail;
- an unprivileged identity can traverse to and use the private Docker client directory created by the production helper while unrelated private state remains inaccessible;
- existing Docker and containerd configuration files remain unchanged;
- no production source invokes `rsync` or contains Docker storage-migration logic;
- `github-runner` gains Docker group membership and `agent-relay-builder` is excluded;
- validation uses a clean environment, explicit local Unix socket, and private client state;
- repeated compatible updates do not require Docker Hub;
- runner restoration occurs only after runtime finalization;
- exactly one active ExecPlan belongs to this pull request.

## Real-Host Acceptance Blocker

Privileged acceptance remains separate from ordinary repository CI and is not a reason to mutate the current runner during this task. No manual execution or human interpretation is an acceptance step.

The eventual automated disposable or explicitly designated Debian 13 x86-64 systemd harness must provision isolated starting states, run the exact checked-out `install.sh` and `update.sh`, capture machine-readable before/after evidence, and fail its own job when an assertion is not satisfied. It must cover:

- fresh official installation and `hello-world`;
- compatible existing official installation with images, containers, volumes, networks, configuration, listeners, versions, and storage locations preserved;
- Buildx-only and Compose-only missing-plugin installation;
- conflicting packages, unknown command ownership, ambiguous or insecure apt definitions, unsafe units, unreadable keyrings, and non-clean dpkg rejection before mutation;
- interruption and rerun across managed repository publication and package installation;
- service startup, group membership, socket access, Buildx, Compose, and repeated update with registry egress disabled;
- runtime compile or finalization failure leaving the runner stopped;
- Docker provisioning failure restoring the finalized runtime and runner;
- TERM, INT, and HUP forwarding and bounded provisioner shutdown;
- a real Agent Relay request in which Codex starts a Compose project, reads logs, executes a command, and shuts the project down.

The harness must compare package versions, unit definitions and state, configuration digests, Docker inventory, storage paths, identities, command output, runner runtime identity, and process results, with sensitive host-specific values redacted before evidence publication.

Current blocker: no automated disposable or designated Debian systemd host lifecycle is available to this repository task. Impact: privileged apt, dpkg, systemd, group, socket, daemon, registry, signal, and end-to-end acceptance cannot execute. Unblock: provide an automated host lifecycle and job interface that creates or resets required initial states and returns captured evidence to the agent or CI.

## Acceptance Criteria

- The branch remains cleanly based on current `main` and preserves its output and workflow behavior.
- `update.sh` makes the ordinary Docker CLI, Buildx, Compose, and local daemon available to Codex on the supported host.
- Docker and containerd keep existing or package-default configuration, listeners, versions, data, and storage roots.
- No Docker or containerd data is copied, moved, staged, checksummed, or migrated.
- A compatible existing installation is reused and only missing supported components are installed.
- Conflicting or globally non-clean package state fails before Docker package mutation.
- Managed repository setup is secure and restartable from exact supported partial states.
- Key parsing, permissions, and GnuPG state isolation are correct.
- `github-runner` can use private Docker client state and the local socket; `agent-relay-builder` remains excluded.
- The runner is never restored against an incomplete runtime.
- Docker and Compose lifecycle decisions remain Codex's responsibility.
- Exactly one active ExecPlan belongs to this pull request.
- `npm run check` passes after the final edit.
- normal CI passes on the exact final commit.
- privileged real-host acceptance remains explicitly blocked until automated evidence exists.

## Progress

- [x] Rejected custom Docker/containerd roots, state migration, `rsync`, automatic global dpkg recovery, and Agent Relay-managed Compose lifecycle.
- [x] Reduced the architecture to direct host CLI and socket access with update-only provisioning.
- [x] Rebuilt the branch cleanly on current `main` without output or workflow regressions.
- [x] Consolidated real-host acceptance into this single active plan.
- [x] Identified inaccessible private Docker client state.
- [x] Identified ambiguous primary and subkey fingerprint parsing.
- [x] Identified non-restartable managed apt publication.
- [x] Identified unsupported CLI compatibility probe.
- [x] Identified apt-key readability and ambient GnuPG-state defects.
- [ ] Integrate the Docker feature into the current-main runtime and updater.
- [ ] Correct all blocking defects and add behavioral coverage.
- [ ] Complete an independent final diff review against this plan.
- [ ] Run final repository validation on the final working tree.
- [blocked] Obtain successful normal CI on the exact finalized commit. Cause: Codex has not yet finalized and pushed the implementation. Impact: no final-head CI evidence exists. Unblock: finalize and push the implementation, then require normal CI success on that exact head.
- [blocked] Execute privileged real-host acceptance. Cause, impact, and unblock condition are recorded above.

## Surprises & Discoveries

- Direct Docker access does not require storage relocation or a Docker command broker.
- Repository-safe validation cannot establish privileged host acceptance.
- A runner-owned leaf directory is unusable when its root-owned parent lacks execute permission for the runner.
- OpenPGP subkey fingerprints must not be confused with multiple primary keys.
- Secure setup requires deterministic re-entry after interruption between managed apt file publications.
- A root-readable key is not necessarily readable by apt's unprivileged acquisition path.
- Docker CLI presence and Docker daemon reachability are separate checks.

## Decision Log

- Decision: preserve Docker's existing or package-default configuration, state, and storage.
  Rationale: direct CLI and socket access does not require data relocation or daemon configuration changes.
- Decision: use one active plan and keep privileged acceptance as a blocker section.
  Rationale: the workflow intentionally requires exactly one changed active ExecPlan.
- Decision: preserve current-main Codex output and workflow architecture.
  Rationale: output normalization is complete and outside this Docker feature.
- Decision: fail on non-clean global dpkg state rather than repair unrelated administrator package work.
  Rationale: Docker provisioning must not own arbitrary global package recovery.
- Decision: isolate GnuPG state and validate apt-reader permissions.
  Rationale: provisioning must not mutate root's ambient state or publish a key apt cannot read.
- Decision: leave Docker and Compose application lifecycle to Codex.
  Rationale: Agent Relay exposes the ordinary host capability only.

## Outcomes & Retrospective

Not complete. Do not move this plan to `completed/` or claim merge readiness until all non-privileged acceptance criteria, independent review, and exact-head CI are satisfied.
