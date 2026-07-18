# Simplify runtime update

This ExecPlan is maintained according to `.agent/PLANS.md`.

## Purpose / Big Picture

`update.sh` previously combined Git synchronization, dependency installation, the complete validation suite, builder staging, ownership transfer, runtime backup, activation, and rollback. That complexity introduced the observed production regression: the builder successfully created a runtime below the private mode-`0700` build root, then the administrator process attempted to inspect that path without traversal permission and rejected an existing directory as missing.

The required operating model is deliberately simple. The administrator runs `git pull` manually and then runs `./update.sh`. The pipeline owns validation. The updater stops the runner listener, waits until the current runner job finishes, deletes disposable build output and the existing runtime, compiles a fresh `dist` directly in the repository, applies production ownership and modes, and starts the runner again. A failed update is not recovered or rolled back; the next invocation deletes `dist` and rebuilds it from zero.

## User Contract

The supported operator sequence is:

```bash
cd /srv/github-runner/storage/agent-relay
git pull --ff-only
./update.sh
```

`git pull` is outside `update.sh`. The updater performs no Git command. It does not fetch, pull, reset, switch, inspect cleanliness, resolve a commit, or otherwise inspect or modify Git state. Tracked or untracked local content does not block an update; the runtime is built from the files currently present in the checkout.

The updater builds `dist`, but it does not run repository validation. It does not run `npm ci`, tests, coverage, shell syntax checks, Node syntax checks, or toolchain smoke. Those are pipeline responsibilities. The only build command in `update.sh` is the TypeScript compilation required to create the runtime.

## Explicit Non-Goals

- No Git command in `update.sh`.
- No clean-worktree requirement.
- No updater re-execution after a pull.
- No dependency installation in `update.sh`.
- No tests, coverage, syntax validation, or toolchain smoke in `update.sh`.
- No build workspace, staged runtime, activation stage, runtime backup, transaction journal, recovery, or rollback.
- No attempt to preserve the old runtime after replacement starts.
- No inspection of a previous failed update. Every invocation deletes disposable output and rebuilds `dist` from zero.

## Implementation Design

### Runtime compilation contract

`tsconfig.runtime.json` extends the existing TypeScript configuration, includes only `src/**/*.ts` and `types/**/*.d.ts`, and excludes `test/**/*.ts`. It preserves the repository root as `rootDir`, so the production entrypoint remains `dist/src/run-codex.js`.

The host installer already installs and verifies pinned TypeScript at `/usr/local/bin/tsc`. `update.sh` invokes that exact compiler as `agent-relay-builder` in a minimal environment. It does not require `node_modules` and does not run `npm ci`.

### Update sequence

1. Reject arguments and root execution.
2. Require the exact repository path, protected administrator file, recorded administrator identity, systemd as PID 1, `/usr/local/bin/tsc`, `/usr/bin/ps`, the builder and runner accounts, and the runtime compiler configuration.
3. Acquire sudo credentials.
4. Stop `actions.runner.Divorium.gh-runner.service`, whether active or already stopped. The installed `KillMode=process` stops the listener so it cannot accept another job while an existing `Runner.Worker` may finish.
5. Read process names for `github-runner` through `/usr/bin/ps`. If inspection fails, fail the update. If `Runner.Worker` is present, wait five seconds and repeat. There is no timeout.
6. Delete `/srv/github-runner/storage/build` and recreate it as `agent-relay-builder:agent-relay-builder` mode `0700`. This discards leftovers from the previous updater and any prior failed invocation.
7. Delete `/srv/github-runner/storage/agent-relay/dist` completely.
8. Create `dist` as `agent-relay-builder:agent-relay-builder` mode `0700`.
9. Run `/usr/local/bin/tsc -p tsconfig.runtime.json --outDir dist` as `agent-relay-builder` through `env -i` with explicit identity, home, locale, and path.
10. Require `dist/src/run-codex.js` to exist.
11. Change the complete `dist` tree to `root:root`; set directories to `0755` and regular files to `0644` through physical, filesystem-bounded `find` traversal.
12. Enable the runner unit because installation prepares but does not enable it, start it, require it to become active, display status, invalidate cached sudo credentials, and print success without invoking Git.

### Failure behavior

There is no rollback. If listener stop, process inspection, deletion, compilation, permission application, or service startup fails, the script exits nonzero at that point. The service may remain stopped and `dist` may be absent or partial. The next `./update.sh` repeats the same procedure, deletes `dist`, and builds it again from zero.

The only EXIT cleanup invalidates cached sudo credentials. It does not restore Git, runtime files, or service state.

### Pipeline responsibility

The pipeline runs `npm ci` followed by the complete repository checks. The check suite now explicitly validates both responsibilities removed from the updater:

- `scripts/ci-runtime-build.sh` compiles `tsconfig.runtime.json` into a disposable directory and requires `src/run-codex.js`;
- `scripts/ci-toolchain-smoke.sh` creates isolated writable toolchain state, constructs the managed environment through `toolchain_environment_build`, and invokes the real `scripts/toolchain-smoke.sh` with pinned expectations.

The existing pipeline continues to perform type checking, source-and-test compilation, all Node tests, 100% runtime coverage, shell syntax checks, Node script checks, and system integration tests.

### Installer alignment

No new host package is required. `install.sh` already relies on `ps` to verify systemd and installs the pinned global TypeScript compiler. The simplified updater uses the same process-inspection command and validates both `/usr/bin/ps` and `/usr/local/bin/tsc` before stopping the service. The systemd unit retains `KillMode=process`.

## Progress

- [x] Define the manual-pull and simple replacement contract.
- [x] Review the plan against the requested behavior and remove inconsistencies.
- [x] Add the production-only TypeScript compiler configuration.
- [x] Replace the updater with the direct rebuild-and-restart sequence.
- [x] Move validation-only commands fully into the pipeline.
- [x] Align host assumptions and technical documentation.
- [x] Replace obsolete updater and ownership regression tests while retaining unrelated installer coverage.
- [ ] Validate the complete repository in the self-hosted GitHub Actions pipeline.
- [x] Review the implementation for environment-specific failures and update this plan.
- [ ] Record final CI outcomes and move this plan to `docs/exec-plans/completed/`.

## Acceptance Criteria

- The operator performs `git pull` manually before `./update.sh`.
- `update.sh` contains no Git command, re-execution phase, worktree-clean check, or Git rollback.
- Dirty and untracked checkout content does not block the updater.
- `update.sh` contains no `npm ci`, `node --test`, coverage flags, `bash -n`, `node --check`, or toolchain smoke invocation.
- `update.sh` builds `dist` with the pinned global TypeScript compiler and production-only configuration.
- The runner listener is stopped before waiting for `Runner.Worker`, preventing acceptance of another job.
- Process inspection is fail-closed, and the updater waits without a timeout until the worker exits.
- The old `dist` is deleted rather than backed up or moved.
- No staging or activation directory is used; compilation writes directly to `${SOURCE_ROOT}/dist`.
- The built runtime becomes `root:root`, with directories `0755` and regular files `0644`, before the service starts.
- A failed update performs no rollback. A later invocation deletes the failed runtime and rebuilds it from zero.
- The pipeline independently executes dependency installation, type checking, compilation, tests, coverage, shell checks, Node checks, system tests, production-runtime compilation, and the real toolchain smoke.
- The system harness proves successful replacement, waiting for a worker, acceptance of dirty checkout content, no rollback after build failure, and successful full replacement on the following invocation.
- No unrelated installer regression contracts are removed.

## Plan and Implementation Reviews

The first plan review removed the last proposed Git operation (`rev-parse`) and confirmed that enabling the service remains necessary because installation deliberately leaves activation to the first update.

The first implementation review found that `pgrep` would introduce an unnecessary additional binary contract. The implementation now uses fail-closed `/usr/bin/ps`, which the installer and host already require. The review also found that the initial rewrite of `test/installer.test.ts` removed unrelated installation assertions; the full installer regression coverage was restored and only updater-specific expectations were replaced.

A local isolated validation reproduced the intended host flow with rewritten fixed paths and mocked service accounts: production TypeScript compilation passed, the new updater contract tests passed, shell syntax passed, the listener-stop/worker-wait sequence passed, a forced compiler failure left the service stopped with partial `dist`, and the following invocation deleted the partial runtime and completed successfully.

## Plan Review Checklist

1. No planned or implemented step performs Git synchronization, inspection, or clean-worktree enforcement.
2. No step stores, restores, or moves an old runtime.
3. No updater step performs validation assigned to the pipeline.
4. Runtime compilation still occurs locally in `update.sh`.
5. The administrator never needs to traverse builder-private staged output; compilation writes directly to the final `dist` path created through sudo.
6. A previous failure requires no inspection: deletion and rebuild are sufficient.
7. Listener stop precedes worker wait, and runtime replacement follows worker completion.
8. Every required command is already part of the installed host contract and is checked before destructive work.
9. Existing installer and runtime security tests unrelated to update staging remain present.

## Surprises & Discoveries

- The reported `Staged runtime must be a regular directory` error occurred after successful compilation, coverage, and toolchain output. The directory existed, but the administrator could not traverse its builder-owned mode-`0700` parent.
- The previous integration harness stripped `sudo -u` and mocked ownership metadata, so it could not reproduce that production boundary.
- An intermediate CI run using the old system harness waits for its own `Runner.Worker`; this is a stale-test problem, not a behavior of the final harness. The final harness replaces process inspection and cannot wait on the CI worker.

## Decision Log

- Decision: manual `git pull` is the only source update mechanism.
  Rationale: the updater deploys the checkout already present on disk.
  Date/Author: 2026-07-18 / user requirement.

- Decision: compile directly into the final `dist` after the runner becomes idle.
  Rationale: the deployment model is delete-and-rebuild, not staging and atomic activation.
  Date/Author: 2026-07-18 / user requirement.

- Decision: do not roll back or recover failed updates.
  Rationale: every invocation removes the runtime and builds it again.
  Date/Author: 2026-07-18 / user requirement.

- Decision: pipeline owns validation while update owns runtime compilation and replacement.
  Rationale: a manual deployment must not repeat the complete validation suite.
  Date/Author: 2026-07-18 / user requirement.

- Decision: use `ps` rather than `pgrep` for runner-worker detection.
  Rationale: it avoids a new host dependency and provides fail-closed inspection using an existing installer prerequisite.
  Date/Author: 2026-07-18 / implementation review.

## Outcomes & Retrospective

Implementation and local isolated validation are complete. Final self-hosted CI validation is pending because stale workflow run `CI #650` executes an intermediate harness that waits on its own `Runner.Worker`; the available GitHub connector exposes workflow reads and reruns but no cancellation action.
