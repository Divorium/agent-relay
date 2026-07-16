# Restore Codex runtime and failure logs

This ExecPlan is a completed implementation record maintained according to `.agent/PLANS.md`.

## Purpose / Big Picture

Restore the working behavior established by PR #5: Codex starts successfully, its stdout and stderr reach the Agent Relay container log while the process is running, and the same redacted output is persisted under the Relay state directory. Preserve the current single-account runtime introduced by PR #10: Agent Relay and Codex run under the same non-root kernel identity without `sudo`, a second service account, an init container, or Docker socket access.

Correct every regression that allowed the deployment to report `codex-run must execute as the isolated agent user` before Codex started. Make failures observable in two layers: child output remains visible and persisted when Codex exits non-zero, and Agent Relay emits a terminal structured failure line containing the job ID, status, error code, and error message.

## Progress

- [x] (2026-07-16) Read `AGENTS.md`, `.agent/PLANS.md`, PR #5, PR #9, PR #10, their merge commits, and relevant GitHub Actions runs.
- [x] (2026-07-16) Identified the working logging commit as `b3175993beb98af3c0dd16ca9b58e690febd0905` from PR #5.
- [x] (2026-07-16) Identified the runtime regression: PR #9 added a username-based wrapper guard, and PR #10 retained it while the image continued creating `agent` with the same default numeric UID as the base image's `node` account.
- [x] (2026-07-16) Confirmed PR #10 validation ran only `npm run check`; no image or container was built or started.
- [x] (2026-07-16) Changed the wrapper guard from ambiguous username lookup to kernel UID equality with the configured `agent` account.
- [x] (2026-07-16) Added behavioral wrapper tests covering an alias name with the same UID and a genuinely different UID.
- [x] (2026-07-16) Added a non-zero child-process regression proving stdout and stderr reach Relay stdout and the persisted job log before the executor reports failure.
- [x] (2026-07-16) Added and tested a structured terminal failure line from `JobService`.
- [x] (2026-07-16) Updated operations documentation with the failure-output contract and the one-time old-volume recreation required after the prior runtime-account migration.
- [x] (2026-07-16) GitHub Actions CI run `29500234874` passed on implementation head `44237d63b73aec05dc3d34566ffdabf5dbd0c69c`: 116 tests passed, 0 failed, 0 skipped, 0 cancelled, and aggregate line coverage was 98.55%.

## Surprises & Discoveries

- Observation: Docker logging was not removed. The visible wrapper message proved child stderr still reached Agent Relay stdout. No Codex output followed because the wrapper exited before `/usr/local/bin/codex` was executed.
- Observation: Linux authorization and file ownership are enforced by numeric UID/GID, not by the display name returned by `id -un`. Multiple passwd entries may resolve the same UID to a different name.
- Observation: the former runtime-script test mocked `id` as a one-value function returning `agent`; it could not reproduce `id -un = node` together with `id -u = id -u agent = 1000`.
- Observation: the former live-log test covered only exit code zero and did not prove that output survived the non-zero exit path.
- Observation: CI run `29299178145` for PR #5 included Compose validation and image builds, while PR #9 removed those jobs. CI runs `29425790625` and `29462156325` contained only the repository test job.
- Observation: the exact regression can be tested without Docker by executing the real wrapper with controlled `id` behavior and the real executor with controlled child processes.

## Decision Log

- Decision: retain the single non-root service account and direct wrapper invocation.
  Rationale: the user previously rejected the second `relay` account and runtime switching; the failure did not require restoring them.
  Date/Author: 2026-07-16 / user direction and repository history.

- Decision: compare effective UID with `id -u agent`, not the result of `id -un`.
  Rationale: UID is the kernel security identity and remains correct when passwd contains aliases for the same UID.
  Date/Author: 2026-07-16 / regression analysis.

- Decision: do not add an init container or rename the state volume.
  Rationale: the observed state permission error was a one-time stale-volume migration issue; `docker compose down -v` recreates disposable volumes with current image ownership.
  Date/Author: 2026-07-16 / user correction.

- Decision: do not add Docker-in-Docker CI.
  Rationale: the configured self-hosted runner has no Docker socket, and the regression is exercised deterministically by running the real wrapper and executor against controlled process fixtures.
  Date/Author: 2026-07-16 / user correction.

- Decision: log terminal job failures explicitly in addition to streaming child output.
  Rationale: a process may fail with little or no output; the container log must still show which job failed and why Relay classified it as failed.
  Date/Author: 2026-07-16 / failure observability requirement.

## Outcomes & Retrospective

The single-account runtime now uses the effective UID as its security invariant. The wrapper no longer rejects a valid `agent` process merely because the base image resolves the shared numeric UID to the display name `node`. A different effective UID remains rejected before cleanup or Codex execution.

The original PR #5 logging behavior remains intact and is now covered on both success and failure. A non-zero child process writes its stdout and stderr to Relay stdout and the persisted job log before the executor raises `CODEX_FAILED`. `JobService` adds one terminal error-stream line containing the job ID, terminal status, error code, and message, so a silent child failure still has an explicit container diagnostic.

No init service, second runtime account, `sudo`, Docker socket, Docker-in-Docker test, public output API, workflow transport change, or Git finalization change was introduced. The one-time stale-volume case is documented as deployment recovery rather than converted into recurring runtime architecture.

## Context and Orientation

`scripts/codex-run` validates the service identity, removes generated agent-home state, creates the private runtime directory, replaces the process environment with `env -i`, and executes the fixed Codex binary. The guard now compares `id -u` with `id -u agent`.

`src/execution/codex-executor.ts` starts the wrapper with piped stdout and stderr. `StreamingRedactor` incrementally redacts both streams. `writeRedacted` writes each accepted value to Agent Relay stdout and queues the same value for append to the job log. The executor throws `CODEX_FAILED` only after the child closes and queued writes drain.

`src/application/job-service.ts` converts executor errors into terminal job records and now emits a structured terminal failure line before attempting terminal persistence.

`test/runtime-scripts.integration.test.ts` executes the real wrapper through a Bash harness. `test/log-stream.integration.test.ts` executes the real executor against controlled child scripts. `test/job-service.test.ts` validates terminal persistence and the Relay error stream.

## Plan of Work

The implementation changed the wrapper identity condition to accept the configured kernel identity regardless of passwd display-name ambiguity. The real-script harness now models both the ambiguous-name success case and a mismatched-UID rejection case.

The live-log integration suite now includes a child that prints to both stdout and stderr and exits non-zero. The test captures Relay stdout, verifies the executor rejects with exit code 17, and verifies both diagnostics exist in the persisted job log.

`JobService` now writes a terminal failure line and is covered with a real `JobStore`, a controlled failing executor, and captured Relay stderr. Operations documentation records the failure-output contract and one-time volume recovery.

## Concrete Steps

Validation executed by GitHub Actions:

    npm ci
    npm run check

The suite built the TypeScript output and executed the focused wrapper, log-stream, and job-service regressions as part of the complete repository suite.

## Validation and Acceptance

All acceptance criteria passed:

1. The real `scripts/codex-run` continues when `id -un` resolves to `node` but the effective UID equals `id -u agent`.
2. The wrapper rejects execution when the effective UID differs from `id -u agent`.
3. A child that prints stdout and stderr and exits non-zero sends both streams to Relay stdout and the persisted job log before `CodexExecutor.run` rejects.
4. `JobService` persists the terminal `failed` state and emits one structured Relay failure line with job ID, status, code, and message.
5. Successful live output, split UTF-8 redaction, split-secret redaction, truncation behavior, timeout behavior, workspace isolation, credentials, finalization, workflow gating, and all existing repository contracts passed.
6. No init container, second service account, `sudo`, Docker socket, GitHub-hosted Docker test, output API, or GitHub live-streaming implementation was added.

CI run `29500234874` results:

- 116 tests passed;
- 0 tests failed;
- 0 tests skipped;
- 0 tests cancelled;
- `test/log-stream.integration.test.ts`: 100% line, branch, and function coverage;
- `test/runtime-scripts.integration.test.ts`: 100% line and function coverage, 95.83% branch coverage;
- `src/application/job-service.ts`: 100% line and function coverage, 97.06% branch coverage;
- aggregate coverage: 98.55% lines, 88.13% branches, 96.90% functions.

## Idempotence and Recovery

The code changes are stateless and safe to reapply. Existing jobs and API contracts require no migration. A deployment upgraded from the previous `relay` state-volume owner may recreate disposable Compose volumes once with `docker compose down -v`; no recurring initialization is introduced.

## Artifacts and Notes

Historical evidence:

- PR #5 merge `b3175993beb98af3c0dd16ca9b58e690febd0905` introduced incremental Docker stdout and persisted-file logging.
- PR #5 CI run `29299178145` passed its test, Compose, and image jobs.
- PR #9 merge `f043af2fa9eb0420a0d64684485700f92a5dc425` added `scripts/codex-run`, the username guard, and repository-only validation.
- PR #9 CI run `29425790625` passed 114 repository tests without Docker or image execution.
- PR #10 merge `04e1f6d3c3a0eb54f4a77848be237ed12727ab0e` moved Relay and Codex to direct single-account execution but retained the ambiguous username guard.
- PR #10 CI run `29462156325` passed the same repository-only test job and therefore did not exercise the packaged identity.
- PR #13 implementation CI run `29500234874` passed on head `44237d63b73aec05dc3d34566ffdabf5dbd0c69c`.

## Interfaces and Dependencies

No public HTTP, job, workflow input, credential, persistence, or Git finalization contract changes. No new runtime or development dependency. The only new operational output is one structured terminal failure line on Relay stderr.

Revision note (2026-07-16): restored the working PR #5 log behavior under the current single-account runtime, replaced display-name identity with kernel UID identity, added failure-path observability tests, documented one-time stale-volume recovery, and completed validation on PR #13.
