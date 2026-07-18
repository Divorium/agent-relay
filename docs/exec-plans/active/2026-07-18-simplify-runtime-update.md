# Simplify runtime update

This ExecPlan is maintained according to `.agent/PLANS.md`.

## Purpose / Big Picture

`update.sh` currently performs Git synchronization, dependency installation, compilation, the complete validation suite, ownership staging, runtime backup, activation, and rollback. That complexity introduced an ownership regression: the builder successfully produced a staged runtime below the private mode-`0700` build root, then the administrator process attempted to inspect that path without sufficient traversal permission and rejected an existing directory as missing.

The required operating model is intentionally simpler. The administrator runs `git pull` manually and then runs `./update.sh`. The pipeline is responsible for validation. The updater waits until the self-hosted runner has finished its current job, discards the existing runtime, compiles a fresh `dist` directly in the repository, applies production ownership and modes, and starts the runner again. A failed update is not recovered or rolled back; the next invocation starts over by deleting `dist` and rebuilding it.

## User Contract

The supported operator sequence is:

```bash
cd /srv/github-runner/storage/agent-relay
git pull --ff-only
./update.sh
```

`git pull` is deliberately outside `update.sh`. The updater performs no Git commands. It does not fetch, pull, reset, switch, inspect cleanliness, resolve a commit, or otherwise inspect or modify Git state. Local tracked or untracked changes do not block an update; the runtime is built from the files currently present in the checkout.

The updater builds `dist`, but it does not run the repository validation suite. In particular it does not run `npm ci`, tests, coverage, shell syntax checks, Node syntax checks, or the toolchain smoke test. Those remain pipeline responsibilities. The only build operation in `update.sh` is the TypeScript compilation needed to create the runtime.

## Explicit Non-Goals

- No Git command in `update.sh`.
- No clean-worktree requirement.
- No update re-execution after a pull.
- No dependency installation in `update.sh`.
- No tests, coverage, syntax validation, or toolchain smoke in `update.sh`.
- No build workspace, staged runtime, activation stage, backup runtime, journal, recovery, or rollback.
- No attempt to preserve the old runtime after replacement starts.
- No analysis of a previous failed update. Every invocation starts by deleting disposable leftovers and rebuilding `dist` from zero.

## Implementation Design

### Runtime compilation contract

Add `tsconfig.runtime.json` extending the existing compiler configuration but including only `src/**/*.ts` and `types/**/*.d.ts`. It keeps `rootDir` as the repository root so the production entrypoint remains `dist/src/run-codex.js`. Tests continue to use the existing `tsconfig.json` and existing coverage flow.

The host already installs pinned TypeScript globally and verifies `/usr/local/bin/tsc`. `update.sh` invokes that exact compiler as `agent-relay-builder` in a minimal environment. It does not require `node_modules` and does not run `npm ci`.

### Update sequence

1. Reject arguments and root execution.
2. Require the repository at `/srv/github-runner/storage/agent-relay`, require the recorded administrator, systemd as PID 1, `/usr/local/bin/tsc`, `/usr/bin/pgrep`, and the runtime compiler configuration.
3. Acquire sudo credentials.
4. Stop `actions.runner.Divorium.gh-runner.service` whether it is active or already stopped. With the installed `KillMode=process`, this stops the listener so it cannot accept another job while an existing `Runner.Worker` may finish.
5. Poll for `Runner.Worker` processes owned by `github-runner`. Exit status `0` means keep waiting, `1` means no worker remains, and any other `pgrep` status is an updater error. There is no timeout: update waits until the current runner job finishes.
6. Remove all children below `/srv/github-runner/storage/build` using a sudo traversal. These are disposable leftovers from the previous updater and from any prior failed invocation. The administrator never traverses this private mode-`0700` directory directly.
7. Remove `/srv/github-runner/storage/agent-relay/dist` completely.
8. Create `dist` as `agent-relay-builder:agent-relay-builder` with mode `0700` through sudo.
9. Run `/usr/local/bin/tsc -p tsconfig.runtime.json --outDir dist` as `agent-relay-builder` in a minimal environment containing only the required identity, locale, home, and path values.
10. Require the compiled production entrypoint `dist/src/run-codex.js` to exist as a regular file.
11. Change the complete `dist` tree to `root:root`; set directories to `0755` and regular files to `0644` using physical, filesystem-bounded `find` traversal.
12. Enable the runner unit because installation prepares but does not enable it, start it, require it to become active, show status, release sudo credentials, and print a success message without invoking Git.

### Failure behavior

There is no rollback. If stopping the service, deleting `dist`, compiling, permission changes, or service startup fails, the script exits nonzero at that point. The service may remain stopped and `dist` may be absent or partial. The next `./update.sh` repeats the same sequence, deletes all of `dist`, and builds it again from zero.

The script must not install an EXIT trap that restores Git, runtime files, or service state. It may invalidate cached sudo credentials on exit; that is process cleanup, not recovery.

### Pipeline responsibility

The pipeline continues to run `npm ci` followed by the complete repository checks. It must also explicitly validate the production runtime compiler configuration and execute the real toolchain smoke outside `update.sh`.

Add a pipeline-only toolchain check that:

- creates an isolated temporary state root;
- creates all state subdirectories defined by `scripts/toolchain-environment.sh`;
- constructs the managed environment through `toolchain_environment_build`;
- invokes `scripts/toolchain-smoke.sh` with the pinned TypeScript, Codex, and Go expectations;
- removes the temporary state afterward.

The same pipeline must compile `tsconfig.runtime.json` into a disposable output directory and require `src/run-codex.js`. This proves that the exact production compiler configuration used by `update.sh` remains valid without putting the broader validation suite into the updater.

### Installer alignment

`install.sh` must install `procps` explicitly because `update.sh` uses `/usr/bin/pgrep`. The installer already installs pinned global TypeScript and creates the builder account and builder home. The systemd unit retains `KillMode=process`, which is required for stopping the listener while allowing an active worker to finish.

## Progress

- [x] Define the manual-pull and simple replacement contract.
- [x] Review this plan against the requested behavior and remove inconsistencies.
- [ ] Add the production-only TypeScript compiler configuration.
- [ ] Replace the current updater with the direct rebuild-and-restart sequence.
- [ ] Move validation-only commands fully into the pipeline.
- [ ] Align installer dependencies and technical documentation.
- [ ] Replace obsolete updater and ownership regression tests.
- [ ] Validate the complete repository in GitHub Actions.
- [ ] Review the implementation for environment-specific failures and update this plan if corrections are required.
- [ ] Record outcomes and move this plan to `docs/exec-plans/completed/`.

## Acceptance Criteria

- The operator performs `git pull` manually before `./update.sh`.
- `update.sh` contains no Git command, re-execution phase, worktree-clean check, or Git rollback.
- Dirty and untracked checkout content does not block the updater.
- `update.sh` contains no `npm ci`, `node --test`, coverage flags, `bash -n`, `node --check`, or toolchain smoke invocation.
- `update.sh` builds `dist` with the pinned global TypeScript compiler and a production-only compiler configuration.
- The runner listener is stopped before waiting for an existing `Runner.Worker`, preventing acceptance of a new job during deployment.
- The updater waits without a timeout until the existing worker exits and treats `pgrep` execution errors as failures.
- The old `dist` is deleted rather than backed up or moved.
- No staging or activation directory is used; the new runtime is compiled directly into `${SOURCE_ROOT}/dist`.
- The built runtime becomes `root:root`, with directories `0755` and regular files `0644`, before the service starts.
- A failed update performs no rollback. A later invocation deletes the failed `dist` and rebuilds it from zero.
- The pipeline independently executes dependency installation, type checking, compilation, tests, coverage, shell checks, Node checks, system tests, production-runtime compilation, and the real toolchain smoke.
- The system harness proves successful replacement, waiting for a worker, acceptance of a dirty checkout, no rollback after build failure, and successful clean replacement on the following invocation.
- Installation explicitly provides every binary used by the simplified updater.

## Plan Review

The first review removed the last proposed Git operation (`rev-parse`) and confirmed that the updater can print success without resolving a commit. It also confirmed that enabling the service remains necessary because `install.sh` installs the unit but deliberately leaves activation to the first update. No plan step accesses staged output below the private builder root, preserves an old runtime, or performs validation work assigned to the pipeline.

## Plan Review Checklist

1. No planned step performs Git synchronization, inspection, or clean-worktree enforcement.
2. No planned step stores, restores, or moves an old runtime.
3. No planned step treats pipeline validation as updater work.
4. Runtime compilation still occurs locally in `update.sh`.
5. The updater never needs administrator access through the private builder root; it builds directly in the repository `dist` path.
6. A previous failure requires no inspection: deletion and rebuild are sufficient.
7. Listener stop precedes worker wait, and runtime replacement follows worker completion.
8. Every command required on the production Debian host is installed by `install.sh` or already guaranteed by the base system.

## Surprises & Discoveries

- The reported `Staged runtime must be a regular directory` error occurred after successful compilation, coverage, and toolchain output. The directory existed, but the administrator could not traverse the builder-owned mode-`0700` parent.
- The previous integration harness stripped `sudo -u` and reported mocked ownership metadata, so it did not reproduce the production traversal boundary.

## Decision Log

- Decision: manual `git pull` is the only source update mechanism.
  Rationale: the operator already performs it and the updater should only deploy the checkout currently on disk.
  Date/Author: 2026-07-18 / user requirement.

- Decision: compile directly into the final `dist` location after the runner becomes idle.
  Rationale: the requested deployment model is delete-and-rebuild, not staging and atomic activation.
  Date/Author: 2026-07-18 / user requirement.

- Decision: do not roll back or recover failed updates.
  Rationale: every invocation removes the runtime and builds it again, so prior partial output is disposable.
  Date/Author: 2026-07-18 / user requirement.

- Decision: pipeline owns validation while update owns only runtime compilation and replacement.
  Rationale: validation must gate repository changes but should not make a manual deployment repeat the complete suite.
  Date/Author: 2026-07-18 / user requirement.

## Outcomes & Retrospective

Pending implementation and final review.
