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
- [x] Ran the complete repository validation suite on head `d4c486fb19083f3e2086f7c8a5c8e3e2e4a3a882`.
- [x] Reviewed the final diff for script coverage, completed-plan immutability, credential scope, and absence of Docker/GitHub test invocation.
- [x] Recorded successful CI run `29425577134` and prepared this unchanged plan for `completed/`.

## Surprises & Discoveries

- The optional push secret existed only as a workflow convention; this repository did not create or provision it.
- Removing the Docker image job also removed behavioral checks that belonged to repository scripts. Those checks can be executed against controlled local fixtures without testing Docker itself.
- The preceding review rewrote two completed plans into summaries. Their original blobs still existed on `main` and were restored exactly as blobs `56b5cfe229ab1d1f94182345d9a161d4ec678c0c` and `62947952771ed57d1a5746e722195e208c442a42`.
- `runner/client.mjs` already had broad child-process tests, but the strongest evidence is the full local Relay-to-client-to-finalizer flow.
- `scripts/codex-run` contains absolute runtime paths, so its integration test intercepts its shell operations while executing the real script file; otherwise the test would mutate the test host.
- CI run `29425418514` exposed one test-only defect: `g++` was interpolated into a regular expression without escaping. The assertion was fixed without changing production code.

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

CI run `29425577134` passed on head `d4c486fb19083f3e2086f7c8a5c8e3e2e4a3a882`:

- 114 tests passed and 0 failed;
- line coverage: 98.59%;
- branch coverage: 88.11%;
- function coverage: 96.88%;
- the coverage report was published in the GitHub Actions job summary;
- no Docker, Compose, GitHub API, hosted service, external network service, or external credential was invoked by the test suite.

Acceptance is satisfied:

- every executable repository script has an actual-process integration path;
- no automated test invokes Docker, Compose, GitHub APIs, hosted services, or external credentials;
- the two pre-existing completed plans have the exact blob SHA present on `main`;
- current workflow and operations documentation contain no operational `AGENT_RELAY_PUSH_TOKEN` configuration;
- coverage appears in the GitHub Actions job summary;
- the complete suite passed for the reviewed head.

## Outcomes & Retrospective

PR #9 now preserves completed plans, uses only the built-in workflow publication token, integration-tests all repository runtime scripts with local fixtures, and exposes coverage directly in GitHub Actions. The final review found no remaining defect within this correction scope.
