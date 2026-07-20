# Install Docker for Codex with persistent host storage

This ExecPlan follows `.agent/PLANS.md` and is the only active plan for this pull request.

## Purpose

Make `./update.sh` install and maintain rootful Docker Engine, Buildx, and Compose v2 for `github-runner`, so Codex can use the ordinary `/usr/bin/docker` CLI and the local Unix socket.

Docker Engine and containerd must use permanent state below `/srv/github-runner/storage/docker` from their first start:

- Docker Engine: `/srv/github-runner/storage/docker/engine`;
- containerd: `/srv/github-runner/storage/docker/containerd`.

The supported initial state is a fresh host without an existing Docker installation or Docker data. The provisioner creates the final storage directories directly and configures both daemons before their first activation. Package-created default directories are valid only when empty and are removed before startup. Later updates may reuse only the exact managed installation created by this feature.

Agent Relay exposes the ordinary host CLI and socket. Codex owns application-container lifecycle decisions.

## Current Baseline

The branch is based on `main` commit `7c148c242feb421b59647f144ab6b78fe691af28`. Preserve its normalized Codex output, transcript, timeout, finalization, workflow, API, and routing behavior.

The existing `.github/workflows/codex.yml` supports manual dispatch and direct Codex execution. No workflow change is required.

Codex revision `87ef6f2c2f7645190bfe2cb75dfd85dae6b39be6` implemented the previous phase, sudo, service-recovery, path, and containerd fixes and passed a complete repository-safe validation in workflow run `29744669708`. Independent review found the remaining blockers below. Treat the implementation as incomplete.

## Binding Decisions

- Provision Docker only from `update.sh`.
- Support Debian x86-64 through Docker's official apt repository.
- Install `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, and `docker-compose-plugin` with the resolver-selected dependency closure.
- Create the final Engine and containerd roots before first activation.
- Recognize only a fresh supported state, an interrupted transaction created by this feature, or the exact completed managed state.
- Reject every unrecognized Docker, containerd, runc, CLI plugin, configuration, unit, alias, activation link, socket, policy, package, or data state before package or recovery mutation.
- Ensure `github-runner` belongs to `docker`; ensure `agent-relay-builder` does not.
- Validate the effective official CLI and plugins, local socket, service enablement and activity, storage roots, package ownership, unit ownership, and group boundaries.
- Run `hello-world` on the first successful installation or explicit host acceptance. A completed repeated update must not require registry access.
- Docker group membership is intentionally root-equivalent on the dedicated runner VM.
- Keep application-container lifecycle under Codex control.
- Keep current GitHub Actions workflows unchanged.

## Current Independent Review Findings

1. **Unknown Docker-related packages are not included in the state boundary.** Fresh and interrupted-phase checks enumerate only the five managed packages and a fixed conflict list. Other installed Docker, containerd, runc, rootless, or CLI-plugin packages can survive when they do not own one of the four checked command paths. Inspect the installed package database for Docker/containerd/runc-related package names and ownership. Permit only the exact package set allowed by the current phase marker; reject every additional related package before repository, dpkg, apt, configuration, service, or recovery mutation.

2. **Docker CLI plugin directories are not exact.** The code checks only entries named `docker-buildx` and `docker-compose`. Additional files, executables, directories, devices, or symlinks in Docker's user, local, and system CLI-plugin search directories are ignored. Inspect every direct directory entry. Fresh and preparing state must contain no plugin entries. Interrupted installed state may contain only the exact package-owned Buildx and Compose paths expected for the recorded packages. Completed state must contain exactly the package-owned expected plugin entries and no others.

3. **Systemd aliases can bypass unit and activation-link validation.** The current scanners match only entries whose basename is `docker.service`, `docker.socket`, or `containerd.service`. A differently named unit alias or a differently named `*.wants` or `*.requires` link that resolves or textually points to one of the managed units is ignored but can activate the daemon. Inspect every unit alias and every activation entry in supported roots. Reject every alias targeting a managed unit and every activation link targeting a managed unit except the exact three managed enablement links.

4. **Systemd root directory metadata is not validated.** Supported unit roots are checked only as non-symlink directories. A non-root-owned or group/world-writable root makes the exact unit and activation-link checks non-durable. Validate each existing supported unit root and each relevant `*.wants` or `*.requires` directory as canonical, root-owned, and not writable by group or others before package mutation and in completed state.

5. **Interrupted socket and service state can be inconsistent.** An exact-looking Docker socket can pass while all managed units are inactive, and service recovery treats only `systemctl is-active --quiet` success as active. Activating, deactivating, reloading, failed, maintenance, or rogue-socket states can therefore reach package recovery. Inspect exact `LoadState`, `ActiveState`, `SubState`, fragment, and socket presence. Before dpkg or apt mutation, either normalize a provably owned partial activation by stopping all managed units and verifying the socket and processes are gone, or reject the state. A socket may be accepted only when it is produced by an exact active managed socket or service state.

6. **The final production head needs normal CI evidence.** A Codex-token push does not start a usable normal CI run and run `29746468422` ended as `action_required` with zero jobs. After the final production revision and independent review, publish a connector-authored plan/status commit and require normal CI to pass on that exact head.

## Implementation Work

1. Add one phase-aware inventory of installed Docker/containerd/runc-related packages and reject every package outside the marker-authorized state.
2. Replace named plugin checks with exact directory-entry inventories for every Docker CLI plugin search directory.
3. Replace basename-only systemd checks with target-aware unit-alias and activation-link inspection.
4. Validate canonical ownership and modes for all supported systemd roots and activation directories.
5. Add an exact service/socket state model and normalize only provably owned interrupted activation before any package recovery mutation.
6. Add deterministic behavioral tests for every current finding. Static source assertions may supplement but not replace production-helper or temporary filesystem/process tests.
7. Preserve direct Docker access, Codex-owned application lifecycle, current documentation boundaries, and unchanged workflows.
8. Run one complete `npm run check` after the last production edit.
9. Review the final diff point by point against this plan, then obtain normal CI evidence on a connector-authored exact final head.

## Repository-Safe Tests

Required coverage includes:

- fresh-state rejection of an installed related package outside the five managed packages and fixed conflict list;
- interrupted-phase rejection of a newly introduced related package not present in the marker;
- exact phase-owned dependency and managed-package acceptance without matching unrelated package names accidentally;
- every Docker CLI plugin search directory containing an extra regular file, directory, executable, device-equivalent fixture, or dangling symlink;
- exact package-owned Buildx and Compose plugin acceptance in interrupted and completed states;
- differently named systemd unit aliases targeting each managed unit;
- differently named `*.wants` and `*.requires` links targeting each managed unit, including dangling textual targets that become valid after package installation;
- non-root-owned, group-writable, and world-writable unit roots and activation directories;
- exact managed enablement links and package unit files continuing to pass;
- socket present with all units inactive, socket present with a failed or activating unit, and partial activation in each nonterminal `ActiveState`;
- owned partial activation stopping all managed units and proving socket/process removal before package recovery;
- all previously implemented repository, key, package, dependency, phase, policy, storage, sudo, process-group, service, executor, finalizer, workflow, and sandbox regressions;
- exactly one active ExecPlan and no workflow changes.

## Real-Host Acceptance

Repository-safe tests cannot prove privileged apt, dpkg, systemd, daemon, socket, group, storage-root, registry, or real Compose behavior.

The automated disposable or explicitly designated Debian 13 x86-64 systemd host lifecycle must cover:

- a clean host with no Docker installation or data;
- first installation without premature activation;
- effective Engine and containerd roots below `/srv/github-runner/storage/docker`;
- absence of data written to default roots;
- first-install `hello-world`;
- a repeated update with registry access disabled;
- exact package, plugin, repository, configuration, unit, alias, activation-link, socket, ownership, and group evidence;
- interruption and rerun at repository, configuration, marker, policy, apt, dpkg-trigger, service-start, validation, and completion-marker boundaries;
- non-TTY sudo timestamp behavior plus TERM, INT, HUP, timeout, and failed-signal behavior;
- a real Agent Relay request where Codex starts Compose, reads logs, executes a command, leaves the workspace runner-owned, and shuts the project down.

If this lifecycle is unavailable, keep the item blocked with its exact cause and unblock condition. Do not claim host acceptance.

## Acceptance Criteria

- `update.sh` installs the exact managed Docker stack on the supported fresh host.
- Engine and containerd use the required permanent roots from their first start.
- Interrupted owned phases resume without an undocumented manual repair step.
- Completed updates validate rather than repair package, plugin, repository, configuration, unit, service, socket, group, and storage state.
- A repeated update performs no unnecessary package mutation or registry access.
- Every unrecognized related package, plugin entry, systemd alias, activation link, unsafe unit root, or inconsistent socket/service state fails before package or recovery mutation.
- Package selection uses one apt snapshot and cannot admit an unselected alternative or unrelated dependency.
- The updater cannot restore the runner while a root provisioner process may still be alive.
- `github-runner` can use the effective official Docker CLI, Buildx, Compose, and socket; `agent-relay-builder` cannot.
- Current documentation does not claim the feature before acceptance is complete.
- `npm run check`, the Codex validation gate, and normal CI pass on the exact final head.
- Independent final review finds no unresolved correctness, security, restartability, maintainability, scope, or current-main regression issue.

## Progress

- [x] Established the fresh-host permanent-storage architecture and direct final storage roots.
- [x] Implemented and reviewed the first three provisioner revisions.
- [x] Codex revision `87ef6f2c2f7645190bfe2cb75dfd85dae6b39be6` passed its complete repository-safe validation in run `29744669708`.
- [x] Completed independent review of `87ef6f2c2f7645190bfe2cb75dfd85dae6b39be6` and recorded the current blockers above.
- [x] Implemented the current package, plugin, systemd alias/activation/metadata, and service-state boundary fixes with deterministic behavioral tests.
- [x] Ran the complete repository-safe validation after the last production edit: `npm run check` passed on 2026-07-20 with 135 Node tests, 100% line/branch/function coverage, runtime and toolchain validation, shell and Node syntax validation, and all system integration suites.
- [blocked] Run Codex validation and normal CI on the exact final head. Cause: PR #26 and remote head `4e9a59d4df28ce2060283b669ebe5ded24fe7811` were resolved through the GitHub connector, but every connector blob-creation request for the validated final tree returned `user cancelled MCP tool call`; `gh` is not installed, and a non-connector push would not satisfy the required normal-CI trigger. Impact: no connector-authored final commit or exact-head workflow run exists. Unblock condition: permit the GitHub connector to create and publish the final commit, then run the Codex validation gate and normal CI on that exact SHA.
- [blocked] Complete independent final diff and job-log review. Cause: the current run completed a point-by-point self-review and corrected the dpkg-trigger unit-load restartability edge it found, but no independent-review execution interface or exact-head job log is available before connector publication. Impact: independence and CI-log acceptance are not proven. Unblock condition: run an independent automated review against the published final diff and exact-head workflow logs.
- [blocked] Run automated privileged real-host acceptance. Cause: no approved disposable or designated Debian 13 x86-64 systemd host lifecycle is available. Impact: repository-safe tests cannot prove privileged host behavior. Unblock condition: provide the automated lifecycle and captured evidence described above.

## Decision Log

- Use one permanent managed storage tree below `/srv/github-runner/storage/docker`.
- Create both final roots before first activation.
- Permit mutation only while completing an exact owned initial transaction; completed state is validation-only.
- Treat package, plugin, unit, alias, activation-link, socket, and directory inventories as exact state rather than checking only known filenames.
- Inventory installed Docker/containerd/runc/rootless/plugin-related package names once per boundary check and permit a present related package only when the phase marker records its exact version.
- Inspect all standard Debian system unit load roots, including transient, attached, control, and generator roots; treat only `/usr/lib/systemd/system` as a package-unit root.
- Accept a Docker socket during interrupted recovery only with an exact active managed Docker socket or service, and prove all managed units, socket paths, and Docker/containerd processes are gone after normalization.
- Confirm the full provisioner process group is gone before runner restoration.
- Keep current-state documentation unchanged until exact-head CI, independent review, and privileged host acceptance are complete.

No public API, request contract, installation argument, routing, or GitHub Actions workflow change is required for these state-boundary fixes.

## Surprises & Discoveries

- The original three-root systemd contract test encoded the incomplete scanner. Expanding production coverage to Debian's transient, attached, control, and generator unit roots required updating that static assertion; the subsequent complete validation passed.
- Repository-safe socket tests cannot create the production root-owned Unix socket. Small runtime-state and stop-operation seams keep production commands fixed while allowing deterministic tests to prove socket/process cleanup and every supported nonterminal `ActiveState`.
- Point-by-point restartability review found that an interrupted transaction can have package-owned unit files unpacked while systemd still reports `LoadState=not-found` before its dpkg reload trigger. That inactive, fragment-free combination is now accepted only in `transaction`; `installed` and `complete` require loaded official units.
- The connected GitHub read APIs resolved PR #26, but connector write calls were cancelled and no `gh` executable is installed. Exact-head CI therefore remains a documented blocker rather than being replaced with a push that cannot satisfy the required trigger.

## Outcomes & Retrospective

The five repository state-boundary findings are implemented and the complete repository-safe validation passes. No workflow or current-state README/operator documentation changed. Exact-head Codex/normal CI, independent final review, and privileged real-host acceptance remain incomplete, so keep this plan active.
