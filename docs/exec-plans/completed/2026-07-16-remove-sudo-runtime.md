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
- [x] (2026-07-16) Updated `README.md` and `docs/operations/README.md` with the direct single-agent runtime.
- [x] (2026-07-16) Removed host-only checks that repository automation cannot execute or prove.
- [x] (2026-07-16) Added durable repository rules forbidding hidden delegation of implementation, validation, review, or follow-up work to a human.
- [x] (2026-07-16) Added automated plan validation for unfinished completed plans, pending completion language, manual follow-up, and human-delegated work.
- [x] (2026-07-16) Normalized earlier completed plans so they contain no unexecuted external exercises or after-merge tasks.

## Surprises & Discoveries

- Observation: the wrapper error proves the wrapper started under the wrong account; it is not a Codex failure.
- Observation: the wrapper remains necessary because it owns environment cleanup and the fixed Codex invocation.
- Observation: a completed plan can still conceal unfinished work when external checks are written as prose instead of checkboxes; repository validation must inspect both task state and delegation language.

## Decision Log

- Decision: Agent Relay and Codex use the same non-root `agent` account.
  Rationale: this restores the working local model and removes an unrequested privilege-switching dependency.
  Date/Author: 2026-07-16 / user correction.

- Decision: the GitHub Actions runner stays in its separate container.
  Rationale: checkout, publication, and GitHub credentials remain outside the Agent Relay container.
  Date/Author: 2026-07-16 / review.

- Decision: every required repository action is executed by the agent or automated CI.
  Rationale: lack of access must remain an explicit incomplete condition and must never become hidden work for another person.
  Date/Author: 2026-07-16 / user correction.

## Outcomes & Retrospective

The runtime no longer depends on a second service account or user switching. Agent Relay and Codex execute as the same non-root `agent` account, while the separate runner container retains GitHub credentials and publication ownership. The fixed wrapper, environment replacement, workspace permissions, read-only Codex authentication mount, result-free contract, and finalizer behavior remain intact.

Repository rules and tests now prevent completed plans from containing unchecked items, blockers, pending validation, after-merge work, manual checks, or tasks assigned to a human.

## Context and Orientation

`Dockerfile` defines the service account and filesystem ownership. `src/server.ts` constructs `CodexExecutor`. `src/execution/codex-executor.ts` builds the permission profile and launches the child. `scripts/codex-run` clears generated state and creates the clean tool environment. `AGENTS.md`, `.agent/PLANS.md`, and `test/plan-responsibility.test.ts` enforce repository responsibility boundaries.

## Plan of Work

Simplify the image to one non-root account, simplify executor construction and launch, remove unverifiable host acceptance, and enforce that required work is executed only by repository automation.

## Concrete Steps

Run from the repository root:

    npm ci
    npm run check

## Validation and Acceptance

The final image user is `agent`. The image contains no second service account or user-switching configuration. The executor directly spawns `/usr/local/bin/codex-run` and has no runtime-user parameter. The wrapper still requires `agent` and still uses `env -i`. Repository checks reject hidden human work and incomplete completed plans.

## Idempotence and Recovery

No API or state-format migration is required. Existing disposable state can be recreated by normal service lifecycle behavior; no privileged runtime path or human correction is part of acceptance.

## Artifacts and Notes

- CI run `29460964856`: `npm run check` passed; 114 tests passed, 0 failed, 0 skipped, 0 todo, 0 cancelled; aggregate line coverage 98.52%.
- CI run `29461358488`: documentation-only cleanup passed the complete repository suite.

## Interfaces and Dependencies

No new runtime dependency is allowed. The public API, job contracts, workflow inputs, credential names, Compose services, and launcher path remain unchanged.

Revision note (2026-07-16): replaced the unrequested two-account runtime with direct single-agent execution, removed unverifiable host acceptance, and added executable repository safeguards against hidden human work delegation.
