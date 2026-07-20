# Treat a missing active ExecPlan as a successful Codex skip

This is the only active ExecPlan for this pull request.

## Purpose

A pull request may be marked ready for review without adding or modifying a file under `docs/exec-plans/active/`. The Codex workflow currently treats that state as an error in `runner/resolve-plan.mjs`, so the `codex` job fails even though there is no Codex task to execute.

Change the pull-request path so that zero matching active ExecPlans is a valid no-op. The workflow must finish successfully, show an English notice that no plan was found, and skip Codex execution, artifact upload, failure propagation, and finalization.

## Current State

- `.github/workflows/codex.yml` runs when a pull request changes from draft to ready for review.
- `runner/resolve-plan.mjs` obtains active-plan candidates from the pull-request diff.
- Exactly one candidate is resolved and validated.
- Zero candidates currently throws `Expected exactly one added or modified active ExecPlan, found 0`.
- Codex run `29774292352` for PR #37 demonstrated the failure: repository validation passed, while `Resolve active ExecPlan` failed and the Codex job concluded as a failure.

## Scope and Decisions

- For a pull-request event with zero added or modified active ExecPlans, emit `plan_found=false` and an empty `plan_path`, then exit successfully.
- For exactly one candidate, emit `plan_found=true` and the validated path, preserving the existing behavior.
- For more than one candidate, continue to fail because the task instruction is ambiguous.
- Keep `workflow_dispatch` strict: its required explicit plan path must still exist and pass all path and file checks.
- When `plan_found=false`, show the English message `No active ExecPlan was found in this pull request. Codex execution was skipped.` as a GitHub Actions notice and job summary.
- Do not run Codex, upload its transcript, propagate a Codex result, or call `runner/finalize.sh` when no plan was found.
- Do not change the pull-request trigger, repository validation, permissions, concurrency, public API, installation behavior, request routing, or normal CI workflow.

## Implementation

1. Make pull-request plan resolution return a nullable plan instead of rejecting zero candidates.
2. Add an explicit `plan_found` step output for both the found and not-found paths.
3. Gate all Codex-only workflow steps on `plan_found == 'true'`.
4. Add a dedicated success-path notice for `plan_found != 'true'`.
5. Add integration coverage for zero, one, and multiple active-plan candidates and workflow gating.

## Acceptance Criteria

- A ready pull request with no active ExecPlan produces a successful Codex workflow.
- The successful no-plan job visibly reports in English that no active ExecPlan was found and Codex execution was skipped.
- No Codex process, transcript upload, commit decision, or branch mutation occurs in the no-plan path.
- A ready pull request with exactly one changed active ExecPlan continues to run Codex normally.
- Multiple changed active ExecPlans and invalid manual-dispatch paths remain failures.
- `npm run check` and normal pull-request CI pass.
- Independent review finds no hidden execution or finalization path when `plan_found=false`.

## Progress

- [x] Reproduce and identify the no-plan failure using Codex run `29774292352`.
- [x] Implement nullable pull-request plan resolution and explicit outputs.
- [x] Gate Codex-only workflow steps and add the English skip notice.
- [x] Add focused regression coverage.
- [ ] Normal pull-request CI passes on the exact branch head.
- [ ] The Codex workflow detects this active plan and completes without introducing a regression.
- [ ] Review the final diff and workflow logs.

## Surprises & Discoveries

- The existing workflow already fails safely before running Codex; the defect is semantic rather than an unintended execution path. Zero plans should be a valid no-op, while multiple plans must remain an error.
- Artifact upload and finalization require explicit plan gating. Merely skipping the Codex step would otherwise allow later success-path steps to evaluate independently.

## Decision Log

- Represent plan presence with a separate `plan_found` output instead of inferring it from an empty path in each workflow step.
- Keep the user-facing message in the workflow so the resolver remains responsible only for deterministic plan selection and validation.
- Preserve strict manual dispatch because the caller explicitly supplies a required task path.

## Outcomes & Retrospective

Pending exact-head CI, Codex execution against this plan, and final review.
