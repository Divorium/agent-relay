# Fix noninteractive Docker package conffile handling

This ExecPlan is a living implementation document maintained according to `.agent/PLANS.md`.

## Purpose / Big Picture

Make Docker provisioning finish noninteractively when a Docker or containerd package encounters an existing locally managed dpkg conffile. `./update.sh` must not block on or fail with `end of file on stdin at conffile prompt`, and it must preserve the exact configuration already validated and published by the Docker provisioner.

No workflow, public API, request contract, installation argument, routing, or Codex execution change is required.

## Progress

- [x] (2026-07-21) Reproduced the reported failure with two local Debian packages that upgrade a modified conffile: plain dpkg exited 1 with `end of file on stdin at conffile prompt`.
- [x] (2026-07-21) Verified that `--force-confdef --force-confold` completes the same upgrade with stdin closed and preserves the locally managed conffile.
- [ ] Add a repository regression test that fails when the Docker package transaction does not set the required dpkg conffile policy.
- [ ] Apply the conffile policy only to the actual Docker package installation transaction.
- [ ] Run the focused Docker repository-safe suite and the complete repository validation.
- [ ] Review the full Docker provisioning path for related noninteractive package-installation failures and correct any found issues.
- [ ] Record validation evidence, review the plan point by point, and move this plan to `docs/exec-plans/completed/`.

## Surprises & Discoveries

- Observation: `DEBIAN_FRONTEND=noninteractive` suppresses debconf questions but does not answer dpkg conffile conflicts.
- Observation: keeping the existing conffile is required because the provisioner creates and validates the final Docker and containerd configuration before package activation.

## Decision Log

- Decision: use dpkg `--force-confdef` together with `--force-confold` for the Docker package installation transaction.
  Rationale: dpkg uses the package-defined default when available and otherwise keeps the already validated local configuration without prompting.
  Date/Author: 2026-07-21 / implementation review.

- Decision: do not apply a global apt or dpkg configuration change.
  Rationale: the required behavior belongs only to the bounded Docker transaction owned by this provisioner.
  Date/Author: 2026-07-21 / implementation review.

## Outcomes & Retrospective

Pending implementation and validation.

## Context and Orientation

`scripts/docker-host-debian.sh` owns Debian repository validation, resolver inspection, package installation, and transaction recovery. `docker_debian_install_components` currently runs apt with `DEBIAN_FRONTEND=noninteractive` but no dpkg conffile policy. `test-system/docker-host.repository-safe.sh` is the repository-safe shell suite for Docker provisioning helpers and transaction boundaries.

The provisioner publishes exact `/etc/docker/daemon.json` and `/etc/containerd/config.toml` content before package activation. Replacing those files with package-maintainer versions would invalidate the selected persistent storage roots.

## Plan of Work

Introduce one narrow package-install helper or option boundary that always invokes apt with the noninteractive dpkg conffile policy. Add a focused regression assertion covering both required options and the package-install call path. Keep resolver simulation, version pinning, transaction markers, recovery, and service-start policy unchanged.

After the focused change, inspect every package mutation in the Docker adapter to confirm that no other Docker installation path can encounter the same prompt without the policy.

## Concrete Steps

Run from the repository root:

    bash test-system/docker-host.repository-safe.sh
    npm run check

Use CI for the complete repository validation and inspect the exact-head job log before completing the plan.

## Validation and Acceptance

Acceptance requires:

- the regression test fails against the previous `main` implementation;
- the Docker package installation passes both `Dpkg::Options::=--force-confdef` and `Dpkg::Options::=--force-confold` while retaining `DEBIAN_FRONTEND=noninteractive`;
- the options affect only the actual package installation, not apt metadata refresh or resolver simulation;
- a modified managed conffile is kept without reading from stdin;
- interrupted transaction recovery remains bounded to marker-owned packages;
- the focused Docker suite and `npm run check` pass;
- exact-head CI passes and its required steps contain no hidden failure or skipped validation.

## Idempotence and Recovery

The change does not alter markers or phase transitions. Re-running `./update.sh` after the reported failure uses the existing transaction marker, finishes the package transaction noninteractively, and continues existing validation. The policy keeps the provisioner-managed configuration rather than silently replacing it.

## Artifacts and Notes

Local reproduction evidence:

- upgrade without dpkg conffile options: exit 1, prompt printed, `end of file on stdin at conffile prompt`;
- upgrade with `--force-confdef --force-confold` and stdin closed: exit 0, locally managed content preserved.

## Interfaces and Dependencies

No new dependency is required. Docker package names, repository origin checks, resolver closure, marker schema, systemd policy, storage paths, CLI exposure, workflow files, and runtime interfaces remain unchanged.
