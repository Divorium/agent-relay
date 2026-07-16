# Restore the single-agent runtime

This ExecPlan is a completed record maintained according to `.agent/PLANS.md`.

## Purpose / Big Picture

Restore the established local runtime model. The Agent Relay service and its Codex child must run as the same non-root `agent` account inside the service container. The service must launch `/usr/local/bin/codex-run` directly. No user-switching command or second service account belongs in this architecture.

Keep the existing boundaries: the GitHub runner remains a separate container; `auth.json` remains read-only; `codex-run` replaces the environment with `env -i`, clears generated home state, and launches the fixed Codex binary.

## Progress

- [x] (2026-07-16) Confirmed that current `main` installs a user-switching tool, creates a second service account, and starts Agent Relay under that account.
- [x] (2026-07-16) Confirmed that `src/server.ts` passes `agent` to `CodexExecutor`, which converts direct launch into a user-switching invocation.
- [x] (2026-07-16) Changed `Dockerfile` to one runtime account, `agent`, and removed the second account and its switching configuration.
- [x] (2026-07-16) Configured the final service stage as `USER agent` with `HOME=/home/agent` and `WORKDIR=/app`.
- [x] (2026-07-16) Removed `createCodexInvocation`, `runAsUser`, and every user-switching execution path; `CodexExecutor` now spawns the fixed launcher directly.
- [x] (2026-07-16) Removed `/home/relay` from the Codex filesystem policy while preserving the remaining application, workspace, temporary-directory, credential, and Git metadata boundaries.
- [x] (2026-07-16) Preserved the wrapper's `agent` assertion, agent-home cleanup, and complete environment replacement.
- [x] (2026-07-16) Updated packaging, executor, flow, log-stream, and context-boundary tests to enforce the single-agent contract.
- [x] (2026-07-16) Updated `README.md` and `docs/operations/README.md` with the direct single-agent runtime and migration note.
- [x] (2026-07-16) GitHub Actions CI run `29460964856` completed successfully on head `40bb2e8730b9c82d4cf9240ff995aa4635e37977`; `npm run check` passed 114 tests with zero failures, skipped, todo, or cancelled tests.

## Surprises & Discoveries

- Observation: the wrapper error proves the wrapper started under the wrong account; it is not a Codex failure.
- Observation: the wrapper remains necessary because it owns environment cleanup and the fixed Codex invocation.
- Observation: the first CI run found four remaining five-argument `CodexExecutor` calls; the second found one overbroad packaging regex; both were corrected before the successful run.

## Decision Log

- Decision: Agent Relay and Codex use the same non-root `agent` account.
  Rationale: this restores the working local model and removes an unrequested privilege-switching dependency.
  Date/Author: 2026-07-16 / user correction.

- Decision: the GitHub Actions runner stays in its separate container.
  Rationale: checkout, publication, and GitHub credentials remain outside the Agent Relay container.
  Date/Author: 2026-07-16 / review.

## Outcomes & Retrospective

The runtime no longer depends on a second service account or user switching. Agent Relay and Codex execute as the same non-root `agent` account, while the separate runner container retains GitHub credentials and publication ownership. The fixed wrapper, environment replacement, workspace permissions, read-only Codex authentication mount, result-free contract, and finalizer behavior remain intact.

The repository validation suite passes.

## Context and Orientation

`Dockerfile` defines the service account and filesystem ownership. `src/server.ts` constructs `CodexExecutor`. `src/execution/codex-executor.ts` builds the permission profile and launches the child. `scripts/codex-run` clears generated state and creates the clean tool environment. Tests under `test/` encode these contracts.

## Plan of Work

Simplify the image to one non-root account, then simplify executor construction and launch. Update static and integration tests so the second account and user switching cannot return. Update deployment documentation and run the complete repository validation suite.

## Concrete Steps

Run from the repository root:

    npm ci
    npm run check

## Validation and Acceptance

The final image user is `agent`. The image contains no second service account or user-switching configuration. The executor directly spawns `/usr/local/bin/codex-run` and has no runtime-user parameter. The wrapper still requires `agent` and still uses `env -i`. All existing credential, workspace, result-free, finalizer, and workflow tests remain effective.

## Idempotence and Recovery

No API or state-format migration is required. Existing state-volume ownership may require a one-time operator correction when it was created by the rejected account model; document that case without adding a privileged runtime path.

## Artifacts and Notes

- CI run `29460795457`: typecheck failed on four stale constructor calls.
- CI run `29460901279`: typecheck passed; 113 of 114 tests passed; one packaging assertion was overbroad.
- CI run `29460964856`: `npm run check` passed; 114 tests passed, 0 failed, 0 skipped, 0 todo, 0 cancelled; aggregate line coverage 98.52%.

## Interfaces and Dependencies

No new dependency is allowed. The public API, job contracts, workflow inputs, credential names, Compose services, and launcher path remain unchanged.

Revision note (2026-07-16): replaced the unrequested two-account runtime with direct single-agent execution, preserved all external contracts and wrapper isolation behavior, updated tests and documentation, and recorded exact CI evidence.