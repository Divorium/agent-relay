# Remove the discarded containerd package conffile

This completed ExecPlan records the implementation and local validation performed according to `.agent/PLANS.md`.

## Purpose / Big Picture

Allow `./update.sh` to finish after `dpkg --force-confold` preserves the Agent Relay-managed `/etc/containerd/config.toml` and writes the incoming package version beside it as `/etc/containerd/config.toml.dpkg-dist`.

The provisioner removes that exact, known `dpkg` sidecar before applying the existing strict directory validation. Other entries in `/etc/containerd` remain unsupported and still stop provisioning.

## Progress

- [x] (2026-07-21) Reproduced the failure using two real locally built `containerd.io` Debian packages and a locally modified conffile.
- [x] (2026-07-21) Confirmed that `--force-confdef --force-confold` preserves the managed conffile and creates `config.toml.dpkg-dist`.
- [x] (2026-07-21) Confirmed that the prior full configuration validation fails with `containerd configuration directory contains unmanaged entries`.
- [x] (2026-07-21) Added unconditional removal of the exact `config.toml.dpkg-dist` path before configuration validation.
- [x] (2026-07-21) Kept strict rejection of every unrelated entry in the containerd configuration directory.
- [x] (2026-07-21) Added a real non-root `dpkg` integration test covering generation, removal, preservation of managed content, and rejection of a separate rogue entry.
- [x] (2026-07-21) Ran focused shell, system, and mutation validation locally without Codex or GitHub Actions.

## Surprises & Discoveries

- The previous conffile fix prevented the interactive prompt but did not account for the normal `.dpkg-dist` side effect of `confold`.
- The strict directory validator was correct to reject unknown files. Package recovery needed to remove the one deterministic sidecar caused by the selected package policy before validation.
- The earlier tests asserted command wiring but did not perform a real conffile upgrade, so they never generated the failing file.

## Decision Log

- Decision: remove `/etc/containerd/config.toml.dpkg-dist` unconditionally when present.
  Rationale: it is the exact deterministic sidecar created by the selected `dpkg --force-confold` policy and is not the active containerd configuration.
  Date/Author: 2026-07-21 / operator instruction.

- Decision: do not compare the sidecar with package metadata or hash its content.
  Rationale: the operator explicitly selected direct deletion; the provisioner still targets only one exact path and does not weaken validation for any other entry.
  Date/Author: 2026-07-21 / operator instruction.

- Decision: retain the exact-directory allowlist after cleanup.
  Rationale: removing one known package artifact must not cause arbitrary files or directories under `/etc/containerd` to be accepted.
  Date/Author: 2026-07-21 / implementation review.

## Outcomes & Retrospective

A rerun from the currently stranded installed transaction removes `config.toml.dpkg-dist`, preserves the Agent Relay-managed `config.toml`, and proceeds through the existing configuration checks. A separate unmanaged file still fails provisioning.

## Validation and Acceptance

Acceptance evidence:

- `bash -n scripts/docker-host.sh test-system/docker-conffile-recovery.integration.sh`: passed.
- `bash test-system/docker-conffile-recovery.integration.sh` as a non-root user: passed.
- `bash test-system/docker-host.repository-safe.sh` as a non-root user: passed.
- `bash test-system/update-script.integration.sh` as a non-root user: passed.
- Mutation: removing the cleanup call makes the real `dpkg` integration fail with the production directory error.

## Idempotence and Recovery

`rm -f` makes cleanup idempotent. If the sidecar does not exist, no state changes. If it exists, only the exact `.dpkg-dist` path is removed. Failure to remove it aborts provisioning before activation.

## Interfaces and Dependencies

No public interface or dependency changes. The test uses Debian tools already required by the target platform: `dpkg` and `dpkg-deb`.
