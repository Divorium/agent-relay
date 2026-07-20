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
- [ ] Add repository regression tests that fail when initial installation or interrupted-transaction recovery omits the required dpkg conffile policy.
- [ ] Apply one exact conffile policy to initial installation and both recovery configuration paths.
- [ ] Run the focused Docker repository-safe suite and the complete repository validation.
- [ ] Review the remaining Docker provisioning path for related noninteractive package failures and correct any found issues.
- [ ] Record validation evidence, review the plan point by point, and move this plan to `docs/exec-plans/completed/`.

## Surprises & Discoveries

- Observation: `DEBIAN_FRONTEND=noninteractive` suppresses debconf questions but does not answer dpkg conffile conflicts.
- Observation: keeping the existing conffile is required because the provisioner creates and validates the final Docker and containerd configuration before package activation.
- Observation: the reported failure publishes the `transaction` marker before apt runs. A retry therefore enters `docker_host_recover_transaction`, whose `dpkg --configure -a` and exact apt reinstall can reproduce the same prompt unless both use the same conffile policy.

## Decision Log

- Decision: use dpkg `--force-confdef` together with `--force-confold` for every package configuration command inside the marker-owned Docker transaction.
  Rationale: dpkg uses the package-defined default when available and otherwise keeps the already validated local configuration without prompting. Initial installation and recovery must have identical conffile semantics.
  Date/Author: 2026-07-21 / implementation review.

- Decision: do not apply a global apt or dpkg configuration change.
  Rationale: the required behavior belongs only to the bounded Docker transaction owned by this provisioner.
  Date/Author: 2026-07-21 / implementation review.

## Outcomes & Retrospective

Pending implementation and validation.

## Context and Orientation

`scripts/docker-host-debian.sh` owns Debian repository validation, resolver inspection, and initial package installation. `docker_debian_install_components` currently runs apt with `DEBIAN_FRONTEND=noninteractive` but no dpkg conffile policy.

`scripts/docker-host.sh` owns interrupted transaction recovery. `docker_host_recover_transaction` currently runs `dpkg --configure -a` and an exact apt install with the same missing conffile policy. `test-system/docker-host.repository-safe.sh` is the repository-safe shell suite for Docker provisioning helpers and transaction boundaries.

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

- upgrade without dpkg conffile options: exit 1, prompt printed, `end of file on stdin at conffile prompt`;
- upgrade with `--force-confdef --force-confold` and stdin closed: exit 0, locally managed content preserved.

## Interfaces and Dependencies

No new dependency is required. Docker package names, repository origin checks, resolver closure, marker schema, systemd policy, storage paths, CLI exposure, workflow files, and runtime interfaces remain unchanged.
