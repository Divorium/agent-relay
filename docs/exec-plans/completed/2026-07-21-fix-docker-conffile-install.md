# Fix noninteractive Docker package conffile handling

This completed ExecPlan records the implementation and validation performed according to `.agent/PLANS.md`.

## Purpose / Big Picture

Make Docker provisioning finish noninteractively when a Docker or containerd package encounters an existing locally managed dpkg conffile. `./update.sh` must not block on or fail with `end of file on stdin at conffile prompt`, must preserve the exact configuration already published by the provisioner, and must recover the same transaction when `./update.sh` is rerun.

No public API, request contract, installation argument, routing, workflow, or Codex execution behavior changed.

## Progress

- [x] (2026-07-21) Reproduced the failure with a real local Debian package upgrade and a modified conffile. Without an explicit dpkg policy, apt exited 100 and left the package in `iU` state.
- [x] (2026-07-21) Verified that `--force-confdef --force-confold` completes pending dpkg configuration with stdin closed and preserves the locally managed conffile.
- [x] (2026-07-21) Audited all Docker package mutation paths. The missing policy affected initial apt installation, recovery `dpkg --configure -a`, and recovery apt installation.
- [x] (2026-07-21) Added one shared exact conffile policy and routed all three package-configuration paths through it.
- [x] (2026-07-21) Replaced the misleading manual-repair instruction with a bounded retry instruction: rerun `./update.sh`.
- [x] (2026-07-21) Added shell and TypeScript regression assertions for the exact apt/dpkg options and both recovery commands.
- [x] (2026-07-21) Fixed the stale-socket repository-safe fixture so real Docker apt artifacts on the host do not leak into the isolated fixture.
- [x] (2026-07-21) Reviewed apt metadata refresh, resolver simulation, and residual purge. None requires the conffile policy: update and simulation do not configure packages, and `dpkg --purge` does not choose between replacement conffiles.
- [x] (2026-07-21) Ran local Docker-focused and repository validation without Codex or GitHub Actions.
- [x] (2026-07-21) Reviewed the final PR diff and removed temporary workflow, patch-staging, and unrelated package-manifest changes.

## Surprises & Discoveries

- `DEBIAN_FRONTEND=noninteractive` suppresses debconf questions but does not answer dpkg conffile conflicts.
- The provisioner publishes the `transaction` marker before apt runs. A retry therefore enters `docker_host_recover_transaction`; recovery needed the same policy as initial installation.
- The repository-safe stale-socket fixture read the real `/etc/apt/keyrings/docker.asc`. After the failed host installation created that key, the fixture counted unrelated host state and blocked validation. The fixture now treats unrelated paths as absent inside its isolated subshell.
- The runner and its CI/Codex jobs were unavailable because Docker provisioning had already failed. Per operator instruction, implementation, review, and validation were completed locally and written directly to the PR branch.

## Decision Log

- Decision: use `--force-confdef` together with `--force-confold` for every package-configuration command inside the marker-owned Docker transaction.
  Rationale: use the package-defined default when one exists and otherwise retain the already validated local configuration without prompting.
  Date/Author: 2026-07-21 / implementation review.

- Decision: centralize package configuration in `docker_debian_install_exact_packages` and `docker_debian_configure_pending_packages`.
  Rationale: initial installation and recovery must not drift to different conffile semantics.
  Date/Author: 2026-07-21 / implementation review.

- Decision: do not set a global apt or dpkg policy.
  Rationale: the behavior belongs only to the bounded Docker transaction owned by this provisioner.
  Date/Author: 2026-07-21 / implementation review.

- Decision: do not depend on Codex or CI for this repair.
  Rationale: the self-hosted runner was unavailable because of the defect being repaired. The operator explicitly required direct implementation and local validation.
  Date/Author: 2026-07-21 / operator instruction.

## Outcomes & Retrospective

Initial Docker installation and interrupted-transaction recovery now use identical noninteractive conffile handling. A rerun of `./update.sh` can configure the recorded partial transaction, reinstall the exact recorded package versions, preserve `/etc/docker/daemon.json` and `/etc/containerd/config.toml`, and continue normal validation.

The fix remains narrowly scoped. Repository refresh, dependency simulation, package-origin validation, version pinning, transaction markers, package ownership boundaries, service suppression, activation, storage roots, and public interfaces are unchanged.

## Context and Orientation

`scripts/docker-host-debian.sh` owns repository validation, resolver inspection, shared package-configuration helpers, and initial package installation.

`scripts/docker-host.sh` owns interrupted transaction recovery. `docker_host_recover_transaction` now invokes the shared pending-configuration helper and the same exact-install helper used by the initial transaction.

`test-system/docker-host.repository-safe.sh` validates Docker provisioning helpers and state boundaries. `test/docker-host-contract.test.ts` validates the repository-level implementation contract.

## Validation and Acceptance

Acceptance evidence:

- Real apt/dpkg regression, no policy: apt exited 100, emitted the conffile prompt failure, and left the package in `iU` state.
- Real recovery with direct dpkg options: package transitioned from `iU` to `ii`; locally managed conffile content remained unchanged.
- Real apt installation with `Dpkg::Options::=--force-confdef` and `Dpkg::Options::=--force-confold`: exit 0; package state `ii`; locally managed conffile content remained unchanged.
- `node --test dist/test/docker-host-contract.test.js`: 9 passed.
- `bash test-system/docker-host.repository-safe.sh`: passed.
- `test-system/install-script.integration.sh`, `test-system/update-script.integration.sh`, and `test-system/docker-host.repository-safe.sh` as a non-root user: passed.
- Full Node test suite: 143 tests passed with 100% line, branch, and function coverage. The local container required a temporary `/usr/bin/node` compatibility symlink because repository fixtures intentionally use that production path.
- `npm run check:runtime`: passed.
- `npm run check:shell`: passed.
- `npm run check:node-scripts`: passed.
- `npm run check:system`: passed.
- `npm run check:toolchain` was not treated as Docker acceptance evidence because this local container does not contain the repository's pinned Java, Codex, and Rust installation under the required production paths.

## Idempotence and Recovery

The marker schema and phase transitions are unchanged. After the reported failure, rerunning `./update.sh` validates that pending dpkg work is limited to marker-owned packages and allowed triggers, installs the service-suppression policy, finishes configuration with the conffile policy, reinstalls the exact recorded versions with the same policy, revalidates package and configuration state, and proceeds to activation.

## Interfaces and Dependencies

No new dependency was added. Docker package names, repository origin checks, resolver closure, marker schema, systemd policy, storage paths, CLI exposure, workflow files, and runtime interfaces remain unchanged.
