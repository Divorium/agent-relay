# Fix update ownership handling

This ExecPlan is maintained according to `.agent/PLANS.md`.

## Purpose / Big Picture

`update.sh` currently moves the root-owned active `dist` directory to a temporary path inside the administrator-owned source checkout and then scans that checkout for non-administrator ownership. The updater therefore rejects its own rollback backup. The rollback moves the backup back to `dist`, so a later diagnostic scan no longer shows the path that caused the failure.

The ownership flow also has three adjacent correctness and security gaps: source ownership is checked only after pull, build, and runtime swap; a failed `git status` command can be interpreted as an empty clean status; a failed ownership `find` pipeline can be interpreted as no mismatch; and recursive `chown` of builder-produced runtime output can affect paths outside `dist` through symbolic or hard links.

After this change, ownership is validated before Git mutates or inspects the checkout and again immediately before activation, the rollback backup stays in the root-controlled storage root outside the checkout, command failures are distinguished from clean results, unsafe staged runtime entries are rejected, and runtime ownership is adopted without dereferencing links.

## Progress

- [x] Audit the complete source, build, activation, rollback, and cleanup ownership flow.
- [ ] Move the previous runtime backup outside the source checkout.
- [ ] Add fail-closed source ownership validation with actionable path metadata.
- [ ] Treat `git status` and ownership-probe failures as updater failures.
- [ ] Reject symbolic links, special files, and multiply linked files in staged runtime output.
- [ ] Replace recursive ownership changes with physical, non-dereferencing traversal.
- [ ] Add regression contracts and update the system specification.
- [ ] Run the complete repository validation in GitHub Actions.
- [ ] Record outcomes and move this plan to `docs/exec-plans/completed/`.

## Surprises & Discoveries

- Observation: the reported foreign-owned path disappears after the updater exits.
  Evidence: rollback removes the new `dist` and moves `.dist.previous.<pid>` back to `dist`, which the diagnostic command intentionally excludes.

- Observation: the existing integration harness does not model the active runtime as root-owned.
  Evidence: its fake `sudo chown` returns success without changing filesystem ownership, so the broken backup-inside-checkout path remains owned by the test user and the false positive is not reproduced.

- Observation: `[[ -z "$(git status ...)" ]]` does not preserve the command's exit status as the cleanliness decision.
  Evidence: an empty stdout from a failed status command can satisfy the string test.

## Decision Log

- Decision: store the rollback backup as `${STORAGE_ROOT}/.agent-relay-dist.previous.<pid>`.
  Rationale: `/srv/github-runner/storage` is root-owned and not writable by the builder or runner, while remaining on the same intended storage hierarchy and outside the ownership-scanned checkout.
  Date/Author: 2026-07-18 / implementation.

- Decision: keep the source ownership policy as administrator-owned source with `dist` excluded.
  Rationale: the active runtime is intentionally root-owned, while every other checkout path must remain administrator-owned.
  Date/Author: 2026-07-18 / implementation.

- Decision: reject staged runtime symlinks, special files, and regular files with multiple hard links before privileged ownership adoption.
  Rationale: a builder-controlled link must not cause a root `chown` or `chmod` to modify an inode outside the staged runtime.
  Date/Author: 2026-07-18 / implementation.

## Validation and Acceptance

Acceptance requires:

- the rollback backup path is outside `${SOURCE_ROOT}` and protected by the root-owned storage parent;
- source ownership is checked before `git config`, `git status`, service stop, and `git pull`, then checked again before runtime activation;
- an ownership traversal failure cannot be treated as a clean result;
- the first offending path is reported with owner, group, and mode before rollback can hide it;
- `git status` failure and a dirty status are separate failures;
- staged runtime output accepts only directories and singly linked regular files;
- runtime ownership changes use `find -P -xdev` with `chown -h`, never `chown -R`;
- build, test, rollback, and service activation behavior remains unchanged apart from the corrected ownership flow;
- `npm run check` passes on the final branch head.
