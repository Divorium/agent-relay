# Restore Codex runtime and failure logs

This ExecPlan is a living implementation document maintained according to `.agent/PLANS.md`.

## Purpose / Big Picture

Restore the working behavior established by PR #5: Codex starts successfully, its stdout and stderr reach the Agent Relay container log while the process is running, and the same redacted output is persisted under the Relay state directory. Preserve the current single-account runtime introduced by PR #10: Agent Relay and Codex run under the same non-root kernel identity without `sudo`, a second service account, an init container, or Docker socket access.

Correct every regression that allowed the current deployment to report `codex-run must execute as the isolated agent user` before Codex started. Make failures observable in two layers: child output must remain visible and persisted when Codex exits non-zero, and Agent Relay must emit a terminal structured failure line containing the job ID, status, error code, and error message.

## Progress

- [x] (2026-07-16) Read `AGENTS.md`, `.agent/PLANS.md`, PR #5, PR #9, PR #10, their merge commits, and relevant GitHub Actions runs.
- [x] (2026-07-16) Identified the working logging commit as `b3175993beb98af3c0dd16ca9b58e690febd0905` from PR #5.
- [x] (2026-07-16) Identified the runtime regression: PR #9 added a username-based wrapper guard, and PR #10 retained it while the image continued creating `agent` with the same default numeric UID as the base image's `node` account.
- [x] (2026-07-16) Confirmed PR #10 validation ran only `npm run check`; no image or container was built or started.
- [ ] Change the wrapper guard from ambiguous username lookup to kernel UID equality with the configured `agent` account.
- [ ] Add behavioral wrapper tests covering an alias name with the same UID and a genuinely different UID.
- [ ] Add a non-zero child-process regression proving stdout and stderr reach Relay stdout and the persisted job log before the executor reports failure.
- [ ] Emit and test a structured terminal failure line from `JobService`.
- [ ] Update operations documentation with the failure-output contract and the one-time old-volume recreation required after the prior runtime-account migration.
- [ ] Run the complete repository validation through CI, record exact evidence, complete this plan, and move it to `docs/exec-plans/completed/`.

## Surprises & Discoveries

- Observation: Docker logging was not removed. The visible wrapper message proves child stderr still reaches Agent Relay stdout. No Codex output followed because the wrapper exited before `/usr/local/bin/codex` was executed.
- Observation: Linux authorization and file ownership are enforced by numeric UID/GID, not by the display name returned by `id -un`. Multiple passwd entries may resolve the same UID to a different name.
- Observation: the existing runtime-script test mocked `id` as a one-value function returning `agent`; it could not reproduce `id -un = node` together with `id -u = id -u agent = 1000`.
- Observation: the existing live-log test covers only exit code zero. It does not prove that output survives the non-zero exit path.
- Observation: CI run `29299178145` for PR #5 included Compose validation and image builds, while PR #9 removed those jobs. CI runs `29425790625` and `29462156325` contained only the repository test job.

## Decision Log

- Decision: retain the single non-root service account and direct wrapper invocation.
  Rationale: the user previously rejected the second `relay` account and runtime switching; the failure does not require restoring them.
  Date/Author: 2026-07-16 / user direction and repository history.

- Decision: compare effective UID with `id -u agent`, not the result of `id -un`.
  Rationale: UID is the kernel security identity and remains correct when passwd contains aliases for the same UID.
  Date/Author: 2026-07-16 / regression analysis.

- Decision: do not add an init container or rename the state volume.
  Rationale: the observed state permission error is a one-time stale-volume migration issue; `docker compose down -v` recreates the disposable volumes with current image ownership.
  Date/Author: 2026-07-16 / user correction.

- Decision: do not add Docker-in-Docker CI.
  Rationale: the configured self-hosted runner has no Docker socket, and the regression can be exercised deterministically by running the real wrapper and executor against controlled process fixtures.
  Date/Author: 2026-07-16 / user correction.

- Decision: log terminal job failures explicitly in addition to streaming child output.
  Rationale: a process may fail with little or no output; the container log must still show which job failed and why Relay classified it as failed.
  Date/Author: 2026-07-16 / failure observability requirement.

## Outcomes & Retrospective

Pending implementation and CI evidence.

## Context and Orientation

`scripts/codex-run` validates the service identity, removes generated agent-home state, creates the private runtime directory, replaces the process environment with `env -i`, and executes the fixed Codex binary. `Dockerfile` currently creates the `agent` account with `--non-unique`; with the default UID 1000, the base image may also expose the name `node` for the same kernel identity.

`src/execution/codex-executor.ts` starts the wrapper with piped stdout and stderr. `StreamingRedactor` incrementally redacts both streams. `writeRedacted` writes each accepted value to Agent Relay stdout and queues the same value for append to the job log. The executor throws `CODEX_FAILED` after the child closes non-zero.

`src/application/job-service.ts` converts executor errors into terminal job records. It currently persists the error code and message but does not write a terminal error line to the Relay container stream.

`test/runtime-scripts.integration.test.ts` executes the real wrapper through a Bash harness. `test/log-stream.integration.test.ts` executes the real executor against controlled child scripts. These are the correct no-Docker locations for the regressions.

## Plan of Work

First, update the wrapper identity condition so that a process is accepted when its effective UID equals the UID assigned to `agent`, regardless of the display name returned for that UID. Update the real-script harness to model both the ambiguous-name success case and a mismatched-UID rejection case.

Second, extend the live-log integration suite with a child that prints to both stdout and stderr and exits non-zero. Capture Relay stdout, assert the executor rejects with the expected exit code, and assert both diagnostics exist in the persisted log.

Third, add a terminal failure log in `JobService` and cover it with a real `JobStore`, controlled failing executor, and captured Relay stderr. The test must verify the persisted job status and the emitted code/message.

Finally, update operations documentation, run `npm run check` through the repository CI, review the PR patch, and move this plan to completed only after current-head CI passes.

## Concrete Steps

Run from the repository root through automated CI:

    npm ci
    npm run check

The focused tests exercised by that suite are:

    node --test dist/test/runtime-scripts.integration.test.js
    node --test dist/test/log-stream.integration.test.js
    node --test dist/test/job-service.test.js

## Validation and Acceptance

Acceptance requires all of the following:

1. The real `scripts/codex-run` continues when `id -un` could resolve to `node` but the effective UID equals `id -u agent`.
2. The wrapper rejects execution when the effective UID differs from `id -u agent`.
3. A child that prints stdout and stderr and exits non-zero sends both streams to Relay stdout and the persisted job log before `CodexExecutor.run` rejects.
4. `JobService` persists the terminal `failed` state and emits one structured Relay failure line with job ID, status, code, and message.
5. Successful live output, split UTF-8 redaction, split-secret redaction, truncation behavior, timeout behavior, workspace isolation, credentials, finalization, workflow gating, and all existing repository contracts continue to pass.
6. No init container, second service account, `sudo`, Docker socket, GitHub-hosted Docker test, output API, or GitHub live-streaming implementation is added by this PR.

## Idempotence and Recovery

The code changes are stateless and safe to reapply. Existing jobs and API contracts require no migration. A deployment upgraded from the previous `relay` state-volume owner may recreate disposable Compose volumes once with `docker compose down -v`; no recurring initialization is introduced.

If CI fails, keep this plan active, record the failing run and exact cause, correct the implementation, and rerun current-head validation. Do not mark completion from an older commit.

## Artifacts and Notes

Historical evidence:

- PR #5 merge `b3175993beb98af3c0dd16ca9b58e690febd0905` introduced incremental Docker stdout and persisted-file logging.
- PR #5 CI run `29299178145` passed its test, Compose, and image jobs.
- PR #9 merge `f043af2fa9eb0420a0d64684485700f92a5dc425` added `scripts/codex-run`, the username guard, and repository-only validation.
- PR #9 CI run `29425790625` passed 114 repository tests without Docker or image execution.
- PR #10 merge `04e1f6d3c3a0eb54f4a77848be237ed12727ab0e` moved Relay and Codex to direct single-account execution but retained the ambiguous username guard.
- PR #10 CI run `29462156325` passed the same repository-only test job and therefore did not exercise the packaged identity.

## Interfaces and Dependencies

No public HTTP, job, workflow input, credential, persistence, or Git finalization contract changes. No new runtime or development dependency. The only new operational output is one structured terminal failure line on Relay stderr.
