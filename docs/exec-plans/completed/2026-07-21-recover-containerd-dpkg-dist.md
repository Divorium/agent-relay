# Recover the verified containerd dpkg-dist artifact

This completed ExecPlan records the implementation and local validation performed according to `.agent/PLANS.md`.

## Purpose / Big Picture

Allow `./update.sh` to finish after `dpkg --force-confold` preserves the Agent Relay-managed `/etc/containerd/config.toml` and writes the package-maintainer version beside it as `/etc/containerd/config.toml.dpkg-dist`.

The provisioner must remove only the exact discarded package conffile produced by the recorded `containerd.io` package. It must continue rejecting arbitrary or unverifiable entries in `/etc/containerd`.

## Progress

- [x] (2026-07-21) Reproduced the runner failure with two real locally built `containerd.io` Debian packages and a locally modified conffile.
- [x] (2026-07-21) Confirmed that `--force-confdef --force-confold` preserves the managed conffile and writes the incoming package version as `config.toml.dpkg-dist`.
- [x] (2026-07-21) Confirmed that full storage and configuration validation then fails with the production message `containerd configuration directory contains unmanaged entries`.
- [x] (2026-07-21) Added package-record verification and narrowly scoped removal of the exact `.dpkg-dist` artifact.
- [x] (2026-07-21) Routed reconciliation through clean-state inspection, bounded transaction recovery, and successful exact package installation.
- [x] (2026-07-21) Added a real non-root dpkg integration test and a negative case that preserves unverified content.
- [x] (2026-07-21) Ran focused shell, TypeScript contract, updater integration, and real dpkg regression validation locally without Codex or GitHub Actions.
- [x] (2026-07-21) Ran a mutation check proving the real integration test fails when reconciliation is disabled.

## Surprises & Discoveries

- The previous conffile fix correctly prevented the interactive prompt, but `confold` has a second observable effect: the rejected package version is retained as `.dpkg-dist`.
- The strict directory validator was behaving as designed. The defect was that package recovery did not reconcile the verified side effect it had deliberately requested from dpkg.
- The previous tests checked option wiring and a simulated package state but never performed a real conffile upgrade that generated `.dpkg-dist`.

## Decision Log

- Decision: keep `--force-confdef --force-confold` for the existing transaction.
  Rationale: it preserves the already managed containerd configuration and resolves the original noninteractive prompt. The missing behavior is cleanup of the verified discarded package version, not a different conffile policy.
  Date/Author: 2026-07-21 / implementation review.

- Decision: verify `.dpkg-dist` against the `containerd.io` conffile digest recorded by dpkg before removal.
  Rationale: filename alone is insufficient authority to delete a root-owned configuration artifact. Metadata and package-record content must both match.
  Date/Author: 2026-07-21 / implementation review.

- Decision: keep the strict configuration-directory allowlist unchanged.
  Rationale: reconciliation should remove one proven package artifact; validation should continue rejecting every unrelated entry.
  Date/Author: 2026-07-21 / implementation review.

## Outcomes & Retrospective

A rerun from the currently stranded installed transaction can now remove `config.toml.dpkg-dist` only when it is a root-owned regular `0644` file whose MD5 equals the package conffile record. The Agent Relay-managed `config.toml` remains unchanged. Unverified content fails closed and remains on disk for operator inspection.

## Context and Orientation

`scripts/docker-host-debian.sh` owns dpkg state inspection and the package-specific conffile reconciliation. `scripts/docker-host.sh` continues to own the strict generic directory validator.

`test-system/docker-conffile-recovery.integration.sh` builds two real `.deb` files, performs a real non-root dpkg upgrade, reproduces the exact full-validation error, performs reconciliation, and validates the final directory.

## Validation and Acceptance

Acceptance evidence:

- `npm run check:shell`: passed.
- `npm run build`: passed.
- `node --test dist/test/docker-host-contract.test.js`: 9 passed.
- `bash test-system/update-script.integration.sh` as a non-root user: passed.
- `bash test-system/docker-host.repository-safe.sh` as a non-root user: passed.
- `bash test-system/docker-conffile-recovery.integration.sh` as a non-root user: passed.
- Mutation: replacing `docker_debian_reconcile_conffile_artifacts` with a no-op makes the real dpkg integration fail before final validation.

The complete repository test command was not treated as acceptance evidence in the local container because unrelated executor fixtures depend on production filesystem and ownership conditions unavailable there.

## Idempotence and Recovery

If no `.dpkg-dist` exists, reconciliation is a no-op. If the exact verified artifact exists, it is removed once. A second run is therefore a no-op. Unsafe metadata, missing package ownership, digest mismatch, or removal failure aborts provisioning without changing the artifact.

## Interfaces and Dependencies

No public interface or dependency changes. The implementation uses existing Debian tools already required by provisioning: `dpkg-query`, `awk`, `md5sum`, and `rm`.
