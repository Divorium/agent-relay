# Repair PR #9 script integration and coverage

This ExecPlan follows `.agent/PLANS.md`. It covers only the corrections requested after the preceding audit plan was completed and archived. Completed plans are immutable historical records and are not edited by this work.

## Purpose / Big Picture

PR #9 must use only credentials that the workflow actually provides, preserve completed ExecPlans exactly, integration-test every executable repository script without invoking Docker or GitHub, and publish repository test coverage in the GitHub Actions job summary. This repair does not change the Codex sandbox profile or Codex authentication mount.

## Progress

- [x] Recorded the new findings in a separate active ExecPlan instead of editing the completed audit plan.
- [x] Removed `AGENT_RELAY_PUSH_TOKEN` from production workflow behavior, example workflow behavior, current operations documentation, and current contract tests.
- [x] Kept `GITHUB_PUSH_TOKEN` as the finalizer's local environment variable and supplied it from the workflow's built-in `github.token`.
- [x] Restored `docs/exec-plans/completed/2026-07-13-agent-relay-mvp.md` exactly to its `main` blob.
- [x] Restored `docs/exec-plans/completed/2026-07-13-ready-pr-gate.md` exactly to its `main` blob.
- [x] Preserved the historical `AGENT_RELAY_PUSH_TOKEN` references in the restored completed plan because completed records must not be rewritten.
- [x] Integration-tested the actual `runner/client.mjs` against the real Relay HTTP server, real `JobService`, real `JobStore`, and real `CodexExecutor` with a controlled local Codex process.
- [x] Integrated the actual `runner/finalize.sh` into the same flow using a real local Git repository and local bare remote.
- [x] Retained focused integration coverage for finalizer success, clean no-op, validation failures, rejected push, restored worktree, and retry.
- [x] Integration-tested the actual `scripts/codex-run` file through a controlled Bash harness that exercises its user guard, cleanup commands, and final isolated environment invocation.
- [x] Integration-tested the actual `scripts/toolchain-smoke.sh` file with local command fixtures, including required commands, Codex version/parser checks, and excluded OpenSSH/.NET failures.
- [x] Retained actual-process integration tests for `runner/entrypoint.sh` and `runner/resolve-pr.mjs`.
- [x] Enabled Node's built-in test coverage without adding a dependency.
- [x] Added GitHub Actions job-summary publication for the coverage report while retaining the complete check log artifact.
- [ ] Run the complete repository validation suite on the current head.
- [ ] Review the final diff for script coverage, completed-plan immutability, credential scope, and absence of Docker/GitHub test invocation.
- [ ] Record the successful current-head CI run and move this unchanged plan to `completed/`.

## Surprises & Discoveries

- The optional push secret existed only as a workflow convention; this repository did not create or provision it.
- Removing the Docker image job also removed behavioral checks that belonged to repository scripts. Those checks can be executed against controlled local fixtures without testing Docker itself.
- The preceding review rewrote two completed plans into summaries. Their original blobs still existed on `main` and could be restored exactly.
- `runner/client.mjs` already had broad child-process tests, but the strongest evidence is the full local Relay-to-client-to-finalizer flow.
- `scripts/codex-run` contains absolute runtime paths, so its integration test must intercept its shell operations while executing the real script file; otherwise the test would mutate the test host.

## Decision Log

- Decision: use `${{ github.token }}` directly for checkout and finalization.
  Rationale: it is the only publication credential actually provided by this workflow, and `contents: write` is already declared.
- Decision: keep the finalizer variable name `GITHUB_PUSH_TOKEN`.
  Rationale: it describes the token's purpose inside the script and does not imply a separate secret.
- Decision: restore completed plans byte-for-byte from `main` and leave historical inaccuracies untouched.
  Rationale: completed ExecPlans are records, not editable current documentation.
- Decision: integration tests may use local HTTP servers, child processes, temporary workspaces, fake local command binaries, and local bare Git repositories.
  Rationale: these exercise repository-owned behavior without testing Docker, GitHub, hosted services, or external credentials.
- Decision: use Node 22's built-in `--experimental-test-coverage` report.
  Rationale: it adds no dependency and can be copied directly into `$GITHUB_STEP_SUMMARY`.
- Decision: do not change the current Codex permission profile or `HOST_CODEX_AUTH_FILE` mount in this repair.
  Rationale: the user requested an explanation of those earlier changes, not another unapproved behavior change.

## Validation and Acceptance

Repository validation:

    npm ci
    npm run check

Acceptance requires:

- every executable repository script to have an actual-process integration path;
- no automated test to invoke Docker, Compose, GitHub APIs, hosted services, or external credentials;
- the two pre-existing completed plans to have the exact blob SHA present on `main`;
- current workflow and documentation to contain no operational `AGENT_RELAY_PUSH_TOKEN` configuration;
- coverage to appear in the GitHub Actions job summary;
- the complete suite to pass for the final PR head.

## Outcomes & Retrospective

Pending final validation and review.
