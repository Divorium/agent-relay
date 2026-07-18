# Fix update ownership handling

This ExecPlan was maintained according to `.agent/PLANS.md` and completed on 2026-07-18.

## Purpose / Big Picture

`update.sh` moved the root-owned active `dist` directory to a temporary path inside the administrator-owned source checkout and then scanned that checkout for non-administrator ownership. The updater therefore rejected its own rollback backup. Rollback moved the backup back to `dist`, so a diagnostic scan performed after the command no longer showed the path that caused the failure.

The audit covered the complete ownership transaction rather than only that symptom. The updater now validates the root storage boundary, administrator-owned source, root-owned active runtime, Git status, builder-produced staged runtime, privileged ownership adoption, activation, rollback, and cleanup as one fail-closed sequence.

## Progress

- [x] Audit the complete source, build, activation, rollback, and cleanup ownership flow.
- [x] Move the previous runtime backup outside the source checkout.
- [x] Add fail-closed storage, source, and active-runtime ownership validation with actionable path metadata.
- [x] Treat `git status`, ownership traversal, and required metadata failures as updater failures.
- [x] Reject symbolic links, special files, and multiply linked files in staged and active runtime output.
- [x] Replace recursive ownership changes with physical, filesystem-bounded, non-dereferencing traversal.
- [x] Add regression contracts, update the system harness, and update the technical specification.
- [x] Run the complete repository validation in GitHub Actions.
- [x] Record outcomes and move this plan to `docs/exec-plans/completed/`.

## Problems Found

1. The root-owned previous runtime was stored at `${SOURCE_ROOT}/.dist.previous.<pid>` and was detected by the updater's own source ownership scan.
2. Source ownership was checked only after pull, build, and runtime swap, allowing an invalid checkout to influence Git and build work before rejection.
3. `[[ -z "$(git status ...)" ]]` could treat a failed `git status` command with empty stdout as a clean checkout.
4. The ownership `find | grep` conditional could treat a failed traversal as absence of a mismatch.
5. The ownership error omitted the offending path and metadata, while rollback could hide transient evidence.
6. `chown -R` on builder-produced output could dereference a symbolic link or modify an inode linked outside the runtime tree.
7. The updater relied on `/srv/github-runner/storage` as a protected transaction parent without verifying that it remained a regular `root:root` directory not writable by group or others.
8. The intentionally excluded active `dist` tree was not independently checked for safe entry types and complete root ownership before service or Git mutation.
9. Static tests encoded the broken in-checkout backup path, while the system harness did not model root-owned storage and runtime trees or verify cleanup of transaction paths.

## Surprises & Discoveries

- Observation: the reported foreign-owned path disappears after the updater exits.
  Evidence: rollback removes the new `dist` and moves `.dist.previous.<pid>` back to `dist`, which the diagnostic command intentionally excludes.

- Observation: the original integration harness could not reproduce the false positive.
  Evidence: its fake `sudo chown` returned success without changing ownership, so the previous runtime backup remained owned by the test user.

- Observation: a successful string comparison around command substitution is not evidence that the underlying command succeeded.
  Evidence: `git status` and the ownership traversal required explicit status capture before interpreting their output.

- Observation: excluding `dist` from the administrator-owned source scan is correct only when a separate invariant proves that `dist` is a safe, completely root-owned runtime tree.
  Evidence: the final preflight performs both checks before any worktree-inspecting Git command or service stop.

## Decision Log

- Decision: store activation and rollback paths as `${STORAGE_ROOT}/.agent-relay-dist.stage.<pid>` and `${STORAGE_ROOT}/.agent-relay-dist.previous.<pid>`.
  Rationale: the root-owned storage parent is outside both the ownership-scanned checkout and the builder-owned build root while remaining on the same storage hierarchy as the final runtime.
  Date/Author: 2026-07-18 / implementation.

- Decision: verify the storage parent before relying on those transaction names.
  Rationale: predictable privileged paths are safe only when their parent is a regular `root:root` directory without group or other write permission.
  Date/Author: 2026-07-18 / implementation.

- Decision: keep the source ownership policy as administrator-owned source with `dist` excluded, and validate `dist` separately.
  Rationale: the activated runtime is intentionally root-owned, while every other checkout path must remain administrator-owned.
  Date/Author: 2026-07-18 / implementation.

- Decision: reject runtime symlinks, special files, and regular files with multiple hard links before privileged ownership adoption and verify root ownership afterward.
  Rationale: builder-controlled links must not cause privileged ownership or mode changes outside the intended runtime tree.
  Date/Author: 2026-07-18 / implementation.

- Decision: use `find -P -xdev -exec chown -h` instead of `chown -R`.
  Rationale: physical, filesystem-bounded traversal and non-dereferencing ownership changes preserve the runtime boundary.
  Date/Author: 2026-07-18 / implementation.

- Decision: report owner, group, mode, file type, link count, and shell-escaped path for the first ownership violation.
  Rationale: the error must remain actionable even when rollback subsequently relocates or removes the offending transient path.
  Date/Author: 2026-07-18 / implementation.

## Outcomes & Retrospective

The updater no longer creates a root-owned path inside the administrator-owned checkout. Ownership validation now occurs before Git or service mutation and immediately before activation. The active runtime and storage parent have explicit invariants, command failures are separated from clean results, runtime links are rejected before privileged adoption, and all transaction paths are removed after success and each tested rollback path.

The system harness models the production `root:root` storage and runtime contracts, verifies that those checks execute, and asserts that no `.agent-relay-dist.*` transaction path remains after successful activation, test failure, build failure, or service-start failure.

GitHub Actions CI run `29651825893` (`CI #635`) completed successfully on commit `8dbaabcdc2ce347930a3f10bcd945a560992c3ca`. The `Validate repository` step executed the complete `npm run check` suite successfully.

## Validation and Acceptance

All acceptance criteria were met:

- the rollback backup and activation stage are outside `${SOURCE_ROOT}` and the builder-owned build root;
- the storage parent must be a regular `root:root` directory without group or other write permission;
- source ownership and active-runtime safety/ownership are checked before `git config`, `git status`, service stop, and `git pull`, then checked again before runtime activation;
- failed Git status, ownership traversal, and required metadata inspection are not treated as clean results;
- the first offending path is reported with owner, group, mode, type, link count, and a shell-escaped path;
- staged and active runtime trees accept only directories and singly linked regular files;
- runtime ownership changes use `find -P -xdev` with `chown -h`, never `chown -R`;
- root ownership is verified after staged runtime adoption;
- transaction paths are absent after successful activation and every tested rollback scenario;
- build, test, rollback, and service activation behavior remains transactional;
- `npm run check` passed on the final implementation head before plan archival.
