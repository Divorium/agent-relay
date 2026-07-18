# Fix update ownership handling

This ExecPlan was maintained according to `.agent/PLANS.md` and completed on 2026-07-18.

## Purpose / Big Picture

`update.sh` moved the root-owned active `dist` directory to a temporary path inside the administrator-owned source checkout and then scanned that checkout for non-administrator ownership. The updater therefore rejected its own rollback backup. Rollback moved the backup back to `dist`, so a diagnostic scan performed after the command no longer showed the path that caused the failure.

The audit covered the complete ownership transaction rather than only that symptom. The updater now validates every persistent trust anchor, restores re-execution rollback state before preflight, separates builder-owned and root-owned phases, and treats source inspection, runtime adoption, activation, rollback, and cleanup as one fail-closed sequence.

## Progress

- [x] Audit the complete source, build, activation, rollback, and cleanup ownership flow.
- [x] Move the previous runtime backup outside the source checkout.
- [x] Validate the administrator state file, storage parent, private builder roots, source checkout, and active runtime.
- [x] Treat `git status`, ownership traversal, and required metadata failures as updater failures.
- [x] Load re-execution rollback state before ownership preflight can fail.
- [x] Reject symbolic links, special files, and multiply linked files in staged and active runtime output.
- [x] Replace recursive ownership changes with physical, filesystem-bounded, non-dereferencing traversal.
- [x] Require builder process quiescence before privileged adoption.
- [x] Add focused regression contracts, update the system harness, and update the technical specification.
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
9. `/etc/agent-relay/administrator` selected the privileged updater identity but was not verified as a regular non-symlink `root:root` trust-anchor file protected from group/other writes.
10. `/srv/github-runner/storage/build` and `build-home` were used as builder-private roots without verifying exact builder ownership and mode `0700`.
11. Root executed `install -d -o agent-relay-builder` below a builder-owned parent; builder-owned staging paths should instead be created by the builder identity so privileged path creation cannot follow builder-controlled entries.
12. Re-executed updater state was loaded after ownership preflight, so a newly pulled updater could fail preflight before learning that the previously active service needed to be restarted and the original revision restored.
13. The updater did not verify that no builder-owned process remained after validation, allowing a lingering process to retain access to staged files during privileged adoption.
14. The staged runtime retained builder ownership immediately after being moved into the root-controlled storage parent; its top-level directory was not locked to `root:root` mode `0700` before recursive adoption.
15. Static tests encoded the broken in-checkout backup path, while the system harness did not model root-owned trust anchors, builder-private roots, or transaction-path cleanup.

## Surprises & Discoveries

- Observation: the reported foreign-owned path disappears after the updater exits.
  Evidence: rollback removes the new `dist` and moves `.dist.previous.<pid>` back to `dist`, which the diagnostic command intentionally excludes.

- Observation: the original integration harness could not reproduce the false positive.
  Evidence: its fake `sudo chown` returned success without changing ownership, so the previous runtime backup remained owned by the test user.

- Observation: a successful string comparison around command substitution is not evidence that the underlying command succeeded.
  Evidence: `git status` and ownership traversals require explicit status capture before interpreting their output.

- Observation: excluding `dist` from the administrator-owned source scan is correct only when a separate invariant proves that `dist` is a safe, completely root-owned runtime tree.
  Evidence: preflight performs both checks before any worktree-inspecting Git command or service stop.

- Observation: rollback state must be available before validating the newly pulled script's stronger host invariants.
  Evidence: otherwise an ownership-policy migration can fail before the updater knows to restore the original revision and restart a service stopped by the old revision.

## Decision Log

- Decision: store activation and rollback paths as `${STORAGE_ROOT}/.agent-relay-dist.stage.<pid>` and `${STORAGE_ROOT}/.agent-relay-dist.previous.<pid>`.
  Rationale: the root-owned storage parent is outside both the ownership-scanned checkout and the builder-owned build root while remaining on the same storage hierarchy as the final runtime.
  Date/Author: 2026-07-18 / implementation.

- Decision: verify the administrator state file, storage parent, builder roots, source checkout, and active runtime before Git or service mutation.
  Rationale: each path controls a different ownership boundary and none can safely be inferred from another.
  Date/Author: 2026-07-18 / implementation.

- Decision: load and validate re-execution rollback variables before ownership preflight, but defer worktree-inspecting commit lookup until after preflight.
  Rationale: rollback retains the original revision and service state even when the newly pulled updater rejects the host, while source ownership is still checked before Git inspects the worktree.
  Date/Author: 2026-07-18 / implementation.

- Decision: have `agent-relay-builder` create build workspace, staged runtime, and state directories under its verified private build root.
  Rationale: privileged directory creation is unnecessary inside a builder-owned boundary and creates avoidable path-following risk.
  Date/Author: 2026-07-18 / implementation.

- Decision: reject runtime symlinks, special files, and regular files with multiple hard links before privileged ownership adoption and verify root ownership afterward.
  Rationale: builder-controlled links must not cause privileged ownership or mode changes outside the intended runtime tree.
  Date/Author: 2026-07-18 / implementation.

- Decision: require no remaining builder process before moving the stage into the root-controlled transaction area.
  Rationale: ownership and path validation are meaningful only after the unprivileged producer can no longer mutate the staged tree.
  Date/Author: 2026-07-18 / implementation.

- Decision: immediately lock the moved activation root to `root:root` mode `0700`, then validate and adopt its descendants using `find -P -xdev -exec chown -h`.
  Rationale: the top-level transaction path becomes inaccessible to the builder before any privileged recursive operation, and physical non-dereferencing traversal preserves the runtime boundary.
  Date/Author: 2026-07-18 / implementation.

- Decision: report owner, group, mode, file type, link count, and shell-escaped path for the first ownership violation.
  Rationale: the error remains actionable even when rollback subsequently relocates or removes the offending transient path.
  Date/Author: 2026-07-18 / implementation.

## Outcomes & Retrospective

The updater no longer creates a root-owned path inside the administrator-owned checkout. Re-execution state is available before preflight, all persistent ownership roots have explicit contracts, builder-created output is quiescent before privileged adoption, and activation is transferred through a root-locked transaction path. Command failures are separated from clean results, unsafe links are rejected, and transaction paths are removed after success and each tested rollback path.

The system harness models the production administrator file, storage root, builder roots, and runtime ownership contracts. It verifies that those checks execute and that no `.agent-relay-dist.*` transaction path remains after successful activation, test failure, build failure, or service-start failure. A focused regression suite fixes the ordering and trust-anchor invariants independently of the system harness.

GitHub Actions CI run `29652038562` (`CI #640`) completed successfully on commit `adaebe8f27dd9eec4228df127abe4b8b33883e00`. The `Validate repository` step executed the complete `npm run check` suite, including the focused ownership regressions and system update harness.

## Validation and Acceptance

All acceptance criteria were met:

- the administrator state file is a protected root-owned trust anchor;
- the storage parent is a regular `root:root` directory without group or other write permission;
- build and builder-home roots are private builder-owned directories with mode `0700`;
- rollback state is loaded before newly pulled code can fail ownership preflight;
- source ownership and active-runtime safety/ownership are checked before `git config`, `git status`, service stop, and `git pull`, then checked again before runtime activation;
- failed Git status, ownership traversal, and required metadata inspection are not treated as clean results;
- the first offending path is reported with owner, group, mode, type, link count, and a shell-escaped path;
- builder-owned staging paths are created by the builder identity;
- no builder process may remain before privileged adoption;
- staged and active runtime trees accept only directories and singly linked regular files;
- the activation root becomes `root:root` mode `0700` before recursive adoption;
- runtime ownership changes use `find -P -xdev` with `chown -h`, never `chown -R`;
- root ownership is verified after staged runtime adoption;
- rollback backup and activation stage remain outside `${SOURCE_ROOT}` and the builder-owned build root;
- transaction paths are absent after successful activation and every tested rollback scenario;
- build, test, rollback, and service activation behavior remains transactional;
- `npm run check` passed on the final implementation head before documentation-only completion commits.
