# Treat a missing active ExecPlan as a successful Codex skip

This is the only active ExecPlan for this pull request.

## Purpose

A pull request may be marked ready for review without adding or modifying a file under `docs/exec-plans/active/`. On current `main`, the Codex workflow treats that state as an error in `runner/resolve-plan.mjs`, so the `codex` job fails even though there is no Codex task to execute.

Change the pull-request path so that zero matching active ExecPlans is a valid no-op. The workflow must finish successfully, show an English notice that no plan was found, and skip Codex execution, artifact upload, failure propagation, and finalization.

## Current State

- `.github/workflows/codex.yml` runs when a pull request changes from draft to ready for review.
- `runner/resolve-plan.mjs` obtains active-plan candidates from the pull-request diff.
- On current `main`, exactly one candidate is resolved and validated, while zero candidates throws `Expected exactly one added or modified active ExecPlan, found 0`.
- Codex run `29774292352` for PR #37 demonstrated the baseline failure: repository validation passed, while `Resolve active ExecPlan` failed and the Codex job concluded as a failure.
- Workflow files are taken from the pull-request head, while `/srv/github-runner/storage/agent-relay/runner/resolve-plan.mjs` is the resolver currently deployed from `main`. A pull request that changes both must remain compatible with the deployed resolver during its own validation run.

## Scope and Decisions

- For a pull-request event with zero added or modified active ExecPlans, the new resolver emits `plan_found=false` and an empty `plan_path`, then exits successfully.
- For exactly one candidate, the new resolver emits `plan_found=true` and the validated path.
- For more than one candidate, continue to fail because the task instruction is ambiguous.
- Keep `workflow_dispatch` strict: its required explicit plan path must still exist and pass all path and file checks.
- When `plan_found=false`, show the English message `No active ExecPlan was found in this pull request. Codex execution was skipped.` as a GitHub Actions notice and job summary.
- Do not run Codex, upload its transcript, propagate a Codex result, or call `runner/finalize.sh` when the resolver explicitly reports `plan_found=false`.
- Preserve transitional compatibility with the deployed resolver from `main`, which emits a non-empty `plan_path` but no `plan_found` output when it finds one plan.
- Keep `.github/workflows/codex.yml` and `examples/github-actions/codex.yml` synchronized.
- Do not change the pull-request trigger, repository validation, permissions, concurrency, public API, installation behavior, request routing, or normal CI workflow.

## Implementation

1. Make pull-request plan resolution return a nullable plan instead of rejecting zero candidates.
2. Add explicit `plan_found` output for both the found and not-found paths.
3. Report a missing plan only for the explicit `plan_found=false` result.
4. Run Codex-only steps when the result is not explicitly false and `plan_path` is non-empty. This supports both the new resolver and the currently deployed resolver during rollout.
5. Gate transcript upload, failure propagation, and finalization with the same plan-presence contract.
6. Keep the production and example workflows identical.
7. Add integration coverage for zero, one, and multiple active-plan candidates, workflow gating, deployed-resolver compatibility, and both Codex success and failure propagation.
8. Update the implemented runner specification so it no longer claims that every pull request must contain exactly one active plan.

## Acceptance Criteria

- A ready pull request with no active ExecPlan produces a successful Codex workflow.
- The successful no-plan job visibly reports in English that no active ExecPlan was found and Codex execution was skipped.
- No Codex process, transcript upload, commit decision, or branch mutation occurs in the no-plan path.
- A ready pull request with exactly one changed active ExecPlan continues to run Codex normally, including while the runner still uses the resolver deployed from the previous `main` revision.
- Multiple changed active ExecPlans and invalid manual-dispatch paths remain failures.
- Production and example Codex workflows remain synchronized.
- `npm run check` and normal pull-request CI pass on the exact final head.
- Independent review finds no hidden execution or finalization path when `plan_found=false`.

## Progress

- [x] Reproduce and identify the no-plan failure using Codex run `29774292352`.
- [x] Implement nullable pull-request plan resolution and explicit outputs.
- [x] Gate Codex-only workflow steps and add the English skip notice.
- [x] Add focused regression coverage.
- [x] CI run `29775376796` (#857) passed before the rollout-compatibility correction.
- [x] Codex run `29775431500` (#33) exposed that the pull-request workflow executes against the resolver currently deployed from `main`.
- [x] Add compatibility for a deployed resolver that emits `plan_path` without `plan_found`.
- [x] CI run `29775666642` (#862) passed on the rollout-compatible implementation head.
- [x] Codex run `29775731689` (#34) detected this active plan, skipped the no-plan notice, executed Codex successfully, and uploaded the transcript.
- [x] Review and preserve the Codex-authored specification and failure-gating test corrections after its final push step failed.
- [ ] Normal pull-request CI passes on the exact final branch head containing the preserved Codex corrections.
- [ ] Review the final diff and exact-head workflow logs.

## Surprises & Discoveries

- The baseline workflow already fails safely before running Codex; the defect is semantic rather than an unintended execution path. Zero plans should be a valid no-op, while multiple plans must remain an error.
- Artifact upload and finalization require explicit plan gating. Merely skipping the Codex step would otherwise allow later success-path steps to evaluate independently.
- Codex run `29775431500` used the workflow YAML from the branch but the resolver installed under `/srv/github-runner/storage/agent-relay` from `main`. That resolver successfully returned `plan_path` without the new `plan_found` output, so a strict `plan_found == 'true'` condition incorrectly skipped Codex. The workflow therefore needs a rollout-compatible condition until the new resolver is deployed by `update.sh`.
- Codex run `29775731689` proved the rollout-compatible execution path: plan resolution succeeded, the missing-plan notice was skipped, Codex ran successfully, and the transcript upload succeeded. Its later `Commit and push` step failed, so the reviewed changes were recovered from the transcript and committed through the repository connector rather than discarded.

## Decision Log

- Represent the new resolver result with a separate `plan_found` output instead of requiring every consumer to infer absence from an empty path.
- Treat only explicit `plan_found=false` as the no-plan result; require a non-empty `plan_path` before any Codex-only step.
- Keep the user-facing message in the workflow so the resolver remains responsible only for deterministic plan selection and validation.
- Preserve strict manual dispatch because the caller explicitly supplies a required task path.
- Keep the example workflow synchronized with the production workflow because repository tests and operator usage treat it as the maintained reference.
- Preserve reviewed Codex changes through the connector when finalization fails after successful Codex execution and artifact publication.

## Outcomes & Retrospective

The no-plan behavior, explicit English notice, strict multiple-plan behavior, rollout compatibility, specification correction, and focused tests are implemented. CI #862 passed before the final Codex-authored corrections, and Codex run #34 executed the active plan successfully. Exact-head CI and final log review remain pending, so this plan stays active.
