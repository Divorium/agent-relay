# Fix noninteractive Docker package conffile handling

This ExecPlan is a living implementation document maintained according to `.agent/PLANS.md`.

## Purpose / Big Picture

Make Docker provisioning finish noninteractively when a Docker or containerd package encounters an existing locally managed dpkg conffile. `./update.sh` must not block on or fail with `end of file on stdin at conffile prompt`, and it must preserve the exact configuration already validated and published by the Docker provisioner.

The same guarantee must hold when a later `./update.sh` resumes the interrupted marker-owned package transaction.

No workflow, public API, request contract, installation argument, routing, or Codex execution change is required.

## Progress

- [x] (2026-07-21) Reproduced the reported failure with two local Debian packages that upgrade a modified conffile: plain dpkg exited 1 with `end of file on stdin at conffile prompt`.
- [x] (2026-07-21) Verified that `--force-confdef --force-confold` completes the same upgrade with stdin closed and preserves the locally managed conffile.
- [x] (2026-07-21) Audited Docker package mutation paths and found the same missing policy in initial apt installation, recovery `dpkg --configure -a`, and recovery apt installation.
- [x] (2026-07-21) Added shell and TypeScript regression assertions for the exact apt/dpkg conffile policy, initial installation, and both recovery commands.
- [x] (2026-07-21) Added shared exact-install and pending-configuration helpers and routed initial installation plus interrupted-transaction recovery through them.
- [x] (2026-07-21) Fixed the stale-socket repository-safe fixture so it does not count the real runner's Docker apt key as fixture state after a failed host installation.
- [x] (2026-07-21) Audited the remaining package mutations: apt metadata refresh and resolver simulation do not configure packages, while residual cleanup uses `dpkg --purge` and cannot present a replacement-conffile decision.
- [x] (2026-07-21) Passed local focused validation: shell syntax, 9 Docker contract tests, Docker repository-safe helpers, and all three system scripts under a non-root user.
- [ ] Run the complete exact-head repository validation in CI.
- [ ] Record validation evidence, review the plan point by point, and move this plan to `docs/exec-plans/completed/`.

## Surprises & Discoveries

- Observation: `DEBIAN_FRONTEND=noninteractive` suppresses debconf questions but does not answer dpkg conffile conflicts.
- Observation: keeping the existing conffile is required because the provisioner creates and validates the final Docker and containerd configuration before package activation.
- Observation: the reported failure publishes the `transaction` marker before apt runs. A retry therefore enters `docker_host_recover_transaction`, whose `dpkg --configure -a` and exact apt reinstall can reproduce the same prompt unless both use the same conffile policy.
- Observation: the repository-safe stale-socket fixture read the real `/etc/apt/keyrings/docker.asc`. Once the failed installation had created that key, the socket-only fixture counted two remnants and failed before Codex could run. The fixture now treats all unrelated paths as absent inside its isolated subshell.
- Observation: the previous package error told operators to make dpkg clean manually even though the transaction marker contains the exact recovery boundary. The message now instructs a rerun of `./update.sh`, which performs bounded recovery itself.

## Decision Log

- Decision: use dpkg `--force-confdef` together with `--force-confold` for every package configuration command inside the marker-owned Docker transaction.
  Rationale: dpkg uses the package-defined default when available and otherwise keeps the already validated local configuration without prompting. Initial installation and recovery must have identical conffile semantics.
  Date/Author: 2026-07-21 / implementation review.

- Decision: do not apply a global apt or dpkg configuration change.
  Rationale: the required behavior belongs only to the bounded Docker transaction owned by this provisioner.
  Date/Author: 2026-07-21 / implementation review.

- Decision: centralize package configuration in `docker_debian_install_exact_packages` and `docker_debian_configure_pending_packages`.
  Rationale: initial installation and recovery cannot silently drift to different conffile semantics, while apt update, simulation, and residual purge remain untouched.
  Date/Author: 2026-07-21 / implementation review.

## Outcomes & Retrospective

Implementation and focused validation are complete. Exact-head CI remains pending before this plan can be archived.

## Context and Orientation

`scripts/docker-host-debian.sh` owns Debian repository validation, resolver inspection, shared package-configuration helpers, and initial package installation. `docker_debian_install_components` invokes the shared exact-install helper after publishing the transaction marker.

`scripts/docker-host.sh` owns interrupted transaction recovery. `docker_host_recover_transaction` invokes the shared pending-dpkg configuration helper and the same exact-install helper before validating the recorded package versions. `test-system/docker-host.repository-safe.sh` is the repository-safe shell suite for Docker provisioning helpers and transaction boundaries.

The provisioner publishes exact `/etc/docker/daemon.json` and `/etc/containerd/config.toml` content before package activation. Replacing those files with package-maintainer versions would invalidate the selected persistent storage roots.

## Plan of Work

Introduce one narrow, shared package-configuration option boundary. Use it for initial apt installation, recovery `dpkg --configure -a`, and recovery apt installation. Add focused regression assertions covering both required options, both apt paths, the direct dpkg recovery path, and retention of `DEBIAN_FRONTEND=noninteractive`.

Keep apt metadata refresh, resolver simulation, version pinning, transaction markers, recovery package ownership boundaries, and service-start policy unchanged. Inspect every remaining package mutation to confirm that residual purge cannot encounter a replacement conffile prompt and that no additional installation path exists.

## Concrete Steps

Run from the repository root:

    bash test-system/docker-host.repository-safe.sh
    npm run check

Use CI for the complete repository validation and inspect the exact-head job log before completing the plan.

## Validation and Acceptance

Acceptance requires:

- the regression assertions fail against the previous `main` implementation;
- initial Docker apt installation passes both `Dpkg::Options::=--force-confdef` and `Dpkg::Options::=--force-confold` while retaining `DEBIAN_FRONTEND=noninteractive`;
- recovery `dpkg --configure -a` uses the equivalent direct dpkg options;
- recovery apt installation uses the same apt dpkg options;
- the options do not affect apt metadata refresh, resolver simulation, or unrelated package management;
- a modified managed conffile is kept without reading from stdin;
- interrupted transaction recovery remains bounded to marker-owned packages and recorded versions;
- the focused Docker suite and `npm run check` pass;
- exact-head CI passes and its required steps contain no hidden failure or skipped validation.

## Idempotence and Recovery

The change does not alter markers or phase transitions. Re-running `./update.sh` after the reported failure uses the existing transaction marker, completes pending dpkg configuration and the exact apt transaction noninteractively, then continues existing validation. The policy keeps the provisioner-managed configuration rather than silently replacing it.

## Artifacts and Notes

Local reproduction evidence:

- local apt upgrade without dpkg conffile options: exit 100, two conffile-prompt markers, and an incomplete package transaction;
- the same apt upgrade with `Dpkg::Options::=--force-confdef` plus `Dpkg::Options::=--force-confold` and stdin closed: exit 0, locally managed content preserved;
- `node --test dist/test/docker-host-contract.test.js`: 9 passed;
- `bash test-system/docker-host.repository-safe.sh`: passed;
- install, update, and Docker system scripts under a non-root user: passed;
- full local Node coverage is not acceptance evidence because the available container executes as root and intentionally fails runner-only permission tests; exact-head CI is authoritative.

## Interfaces and Dependencies

No new dependency is required. Docker package names, repository origin checks, resolver closure, marker schema, systemd policy, storage paths, CLI exposure, workflow files, and runtime interfaces remain unchanged.
