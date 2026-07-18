# Fix runner worker inspection

This ExecPlan is maintained according to `.agent/PLANS.md`.

## Purpose / Big Picture

The simplified updater stops the GitHub Actions listener and then waits for an already-running `Runner.Worker`. The current implementation executes `ps -u github-runner -o comm=` and treats every nonzero exit status as an inspection failure. On the production host, once the listener was stopped and the account had no remaining processes, GNU `ps` returned nonzero. The updater therefore stopped before rebuilding `dist` and printed `Could not inspect GitHub runner worker processes` even though the correct state was “runner idle”.

The updater must distinguish three states without weakening the existing fail-closed behavior:

1. no `Runner.Worker` owned by the runner UID — continue immediately;
2. a `Runner.Worker` owned by the runner UID — wait and poll again;
3. process-table inspection itself fails — exit before deleting `build` or `dist`.

The fix must retain the deployment model merged in PR #29: manual `git pull`, no Git operations in `update.sh`, no recovery or rollback, deletion and direct rebuild of `dist`, and pipeline-owned validation.

## User Contract

The operator sequence remains:

```bash
cd /srv/github-runner/storage/agent-relay
git pull --ff-only
./update.sh
```

After the listener is stopped, an idle host with no processes owned by `github-runner` must continue to runtime replacement. An active `Runner.Worker` must delay replacement until it exits. A genuine `ps` execution error must stop the updater before destructive filesystem work.

## Explicit Non-Goals

- No rollback, recovery, backup, staging, or transaction journal.
- No timeout while waiting for an active runner job.
- No Git operation or clean-worktree validation.
- No change to runtime compilation, ownership, modes, or service activation.
- No change to the Codex workflow or pull-request resolver.
- No new host package or executable dependency.

## Implementation Design

### Process-table inspection

Resolve the numeric UID of `github-runner` during preflight and retain it for worker inspection. Replace the user-selected process command with a full process-table command:

```bash
sudo /usr/bin/ps -eo euid=,comm=
```

A successful full-table invocation has an unambiguous contract: command success means the table was inspected, regardless of whether any row belongs to the runner account. Parse each row as numeric effective UID plus command name and match only:

```text
process UID == resolved github-runner UID
command name == Runner.Worker
```

Ignore `Runner.Worker` rows owned by another UID and ignore other runner-owned commands such as `Runner.Listener`. If the `ps` command itself exits nonzero, preserve the current fail-closed error.

### Test model

Update the system harness so its fake `ps` returns a complete process table rather than emulating `ps -u`. Cover these cases:

1. no runner-owned rows — update continues;
2. runner-owned `Runner.Listener` only — update continues;
3. runner-owned `Runner.Worker` — update waits for the configured polls and then continues;
4. `Runner.Worker` owned by another UID — update does not wait;
5. process-table command failure — update exits before deleting `build` or `dist` and before invoking TypeScript;
6. following a successful inspection, the existing direct rebuild and no-rollback scenarios continue to pass.

Add static regression assertions requiring `ps -eo euid=,comm=`, UID matching, and prohibiting `ps -u github-runner` in `update.sh`.

### Documentation

Update the technical specification and operations documentation only where they describe worker inspection. The documented contract must say that the updater scans the full process table and filters by the resolved runner UID.

## Progress

- [x] Reproduce the production failure from the merged implementation and identify the ambiguous `ps -u` exit status.
- [ ] Review this plan against the existing direct-rebuild contract.
- [ ] Replace user-selected `ps` inspection with full-table UID-filtered inspection.
- [ ] Expand static and system regression coverage for idle, listener-only, worker, foreign-UID worker, and inspection-failure states.
- [ ] Update the relevant technical documentation.
- [ ] Run and inspect self-hosted CI.
- [ ] Review the implementation against every acceptance criterion and production-host assumptions.
- [ ] Record outcomes and move this plan to `docs/exec-plans/completed/`.

## Acceptance Criteria

- `update.sh` resolves the numeric UID for `github-runner` before stopping the service.
- Worker inspection executes `/usr/bin/ps -eo euid=,comm=` through sudo.
- An empty set of runner-owned processes is treated as idle.
- A runner-owned `Runner.Listener` without a worker is treated as idle.
- A runner-owned `Runner.Worker` causes repeated waiting.
- A `Runner.Worker` owned by another UID is ignored.
- A nonzero exit from the full process-table command remains a hard failure.
- Inspection failure occurs before removal of `build` and `dist`.
- Existing update behavior remains unchanged after the runner becomes idle.
- Tests no longer mock the invalid assumption that an empty user selection always exits zero.
- CI passes all explicit validation phases on the final head.

## Plan and Implementation Reviews

Pending.

## Plan Review Checklist

1. The plan fixes the observed production command semantics rather than changing only the error message.
2. The solution uses an executable already required by the installer.
3. The implementation cannot confuse “no matching user processes” with command failure.
4. UID and command-name matching prevent false positives from another user or another runner process.
5. Destructive runtime replacement remains after successful idle detection.
6. The existing no-recovery/no-rollback contract is unchanged.
7. Tests exercise the exact idle state seen on the host.

## Surprises & Discoveries

- PR #29 CI passed because the fake `ps` explicitly returned status zero for an empty synthetic `github-runner` selection. That did not reproduce the production command behavior.
- The production failure happened before `build` or `dist` deletion, so the old runtime remained present while the listener stayed stopped.

## Decision Log

- Decision: inspect the full process table and filter by numeric effective UID plus `comm`.
  Rationale: this removes the ambiguous empty-selection exit status while preserving fail-closed command execution.
  Date/Author: 2026-07-19 / implementation plan.

- Decision: keep the current direct rebuild and no-rollback model unchanged.
  Rationale: the reported defect is limited to worker-idle detection and does not require reopening the deployment architecture.
  Date/Author: 2026-07-19 / user requirement.

## Outcomes & Retrospective

Pending implementation and final validation.
