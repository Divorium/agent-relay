# Restore the single-agent runtime

This ExecPlan is a living document maintained according to `.agent/PLANS.md`.

## Purpose / Big Picture

Restore the established local runtime model. The Agent Relay service and its Codex child must run as the same non-root `agent` account inside the service container. The service must launch `/usr/local/bin/codex-run` directly. No user-switching command or second service account belongs in this architecture.

Keep the existing boundaries: the GitHub runner remains a separate container; `auth.json` remains read-only; `codex-run` replaces the environment with `env -i`, clears generated home state, and launches the fixed Codex binary.

## Progress

- [x] (2026-07-16) Confirmed that current `main` installs a user-switching tool, creates a second service account, and starts Agent Relay under that account.
- [x] (2026-07-16) Confirmed that `src/server.ts` passes `agent` to `CodexExecutor`, which converts direct launch into a user-switching invocation.
- [ ] Change the image to one runtime account, `agent`, and remove the second account and its switching configuration.
- [ ] Run the service as `agent` with `HOME=/home/agent` and `WORKDIR=/app`.
- [ ] Remove `createCodexInvocation`, `runAsUser`, and every user-switching execution path. Spawn the fixed launcher directly.
- [ ] Remove `/home/relay` from the Codex filesystem policy while preserving all remaining workspace, application, temporary-directory, credential, and Git metadata boundaries.
- [ ] Keep the wrapper's `agent` assertion and complete environment replacement.
- [ ] Update packaging, executor, runtime-script, and context tests to prove the rejected model cannot return.
- [ ] Update `README.md` and `docs/operations/README.md`.
- [ ] Run `npm ci`, `npm run check`, and `git diff --check` and record exact results.

## Surprises & Discoveries

- Observation: the wrapper error proves the wrapper started under the wrong account; it is not a Codex failure.
- Observation: the wrapper remains necessary because it owns environment cleanup and the fixed Codex invocation.

## Decision Log

- Decision: Agent Relay and Codex use the same non-root `agent` account.
  Rationale: this restores the working local model and removes an unrequested privilege-switching dependency.
  Date/Author: 2026-07-16 / user correction.

- Decision: the GitHub Actions runner stays in its separate container.
  Rationale: checkout, publication, and GitHub credentials remain outside the Agent Relay container.
  Date/Author: 2026-07-16 / review.

## Outcomes & Retrospective

Implementation is not yet complete.

## Context and Orientation

`Dockerfile` defines the service account and filesystem ownership. `src/server.ts` constructs `CodexExecutor`. `src/execution/codex-executor.ts` builds the permission profile and launches the child. `scripts/codex-run` clears generated state and creates the clean tool environment. Tests under `test/` encode these contracts.

## Plan of Work

Simplify the image to one non-root account, then simplify executor construction and launch. Update static and integration tests so the second account and user switching cannot return. Update deployment documentation and run the complete repository validation suite.

## Concrete Steps

Run from the repository root:

    npm ci
    npm run check
    git diff --check

## Validation and Acceptance

The final image user is `agent`. The image contains no second service account or user-switching configuration. The executor directly spawns `/usr/local/bin/codex-run` and has no runtime-user parameter. The wrapper still requires `agent` and still uses `env -i`. All existing credential, workspace, result-free, finalizer, and workflow tests remain effective.

## Idempotence and Recovery

No API or state-format migration is required. Existing state-volume ownership may require a one-time operator correction when it was created by the rejected account model; document that case without adding a privileged runtime path.

## Artifacts and Notes

Append exact validation evidence here.

## Interfaces and Dependencies

No new dependency is allowed. The public API, job contracts, workflow inputs, credential names, Compose services, and launcher path remain unchanged.
