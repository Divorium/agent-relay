# Fix runner worker inspection

This completed ExecPlan is a historical record maintained according to `.agent/PLANS.md`.

## Purpose / Big Picture

The simplified updater stopped the GitHub Actions listener and then waited for an already-running `Runner.Worker`. The previous implementation executed `ps -u github-runner -o comm=` and treated every nonzero exit status as an inspection failure. On the production host, once the listener was stopped and the account had no remaining processes, GNU `ps` returned nonzero. The updater therefore stopped before rebuilding `dist` even though the correct state was “runner idle”.

The implemented fix distinguishes three states without weakening fail-closed behavior:

1. no `Runner.Worker` owned by the runner UID — continue immediately;
2. a `Runner.Worker` owned by the runner UID — wait and poll again;
3. process-table inspection itself fails — exit before deleting `build` or `dist`.

## User Contract

The operator sequence remains:

```bash
cd /srv/github-runner/storage/agent-relay
git pull --ff-only
./update.sh
```

After the listener is stopped, an idle host with no processes owned by `github-runner` continues to runtime replacement. An active `Runner.Worker` delays replacement until it exits. A genuine `ps` execution error stops the updater before destructive filesystem work.

## Implementation

`update.sh` resolves the numeric UID of `github-runner` and inspects the complete process table through:

```bash
sudo /usr/bin/ps -e -o euid=,comm=
```

It matches only a row whose effective UID equals the resolved runner UID and whose command name is exactly `Runner.Worker`. Empty results, `Runner.Listener`, unrelated commands, and workers owned by another UID are ignored. A nonzero exit from the process-table command remains a hard failure.

The system harness models a complete process table and covers idle, listener-only, runner-owned worker, foreign-owned worker, and inspection-failure states. Static regression coverage requires the full-table command, numeric UID matching, and the absence of `ps -u github-runner`.

## Progress

- [x] Reproduce the production failure and identify the ambiguous `ps -u` exit status.
- [x] Review the plan against the direct-rebuild contract.
- [x] Replace user-selected process inspection with full-table UID-filtered inspection.
- [x] Expand static and system regression coverage for idle, listener-only, worker, foreign-UID worker, and inspection-failure states.
- [x] Update the relevant technical and operations documentation.
- [x] Validate the implementation through the repository CI suite.
- [x] Review the implementation against every acceptance criterion.
- [x] Record outcomes and move the plan to `docs/exec-plans/completed/`.

## Acceptance Evidence

- `update.sh` resolves `RUNNER_UID` before stopping the service.
- `update.sh` executes `/usr/bin/ps -e -o euid=,comm=` through sudo.
- Matching requires both the numeric runner UID and exact `Runner.Worker` command name.
- A successful inspection with no matching worker returns immediately.
- A nonzero process-table command fails before build or runtime removal.
- `test/update-regression.test.ts` statically verifies the command, UID filter, wait behavior, diagnostic, and absence of the previous `ps -u` form.
- `test-system/update-script.integration.sh` covers idle, listener-only, runner-owned worker, foreign-owned worker, and process-inspection failure.
- `docs/native-github-runner-specification.md` and `docs/operations/README.md` describe UID-scoped full-process-table inspection.

## Decision Log

- Decision: inspect the full process table and filter by numeric effective UID plus `comm`.
  Rationale: this removes the ambiguous empty-selection exit status while preserving fail-closed command execution.
  Date/Author: 2026-07-19 / implementation plan.

- Decision: use separate `-e` and `-o` options for `ps`.
  Rationale: it makes the full-table selection and output format explicit in code and tests.
  Date/Author: 2026-07-19 / plan review.

- Decision: keep the direct-rebuild and no-rollback model unchanged.
  Rationale: the production defect was limited to worker-idle detection.
  Date/Author: 2026-07-19 / user requirement.

## Outcomes & Retrospective

The updater now distinguishes an idle runner account from a process-table failure without weakening worker protection. Production no longer stops on the valid “no runner-owned processes” state, while an active runner-owned `Runner.Worker` still blocks runtime replacement and a genuine inspection failure still occurs before destructive work.

The original test double encoded an incorrect assumption about `ps -u` returning zero for an empty selection. Modeling the complete process table removed that ambiguity and added coverage for ownership-sensitive worker detection.
