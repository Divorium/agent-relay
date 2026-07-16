# Restrict Agent Relay to ready pull requests

## Goal

Implement and validate a production workflow that allows Agent Relay to work only on an open pull request that is explicitly ready for review.

The runner must not invoke Agent Relay for:

- draft pull requests;
- closed pull requests;
- branches that are not the exact head branch of the selected pull request;
- missing pull requests;
- label-only states that do not prove the pull request is ready.

Use GitHub's native draft state as the source of truth. A pull request is allowed only when `state == open` and `draft == false`.

## Required implementation

1. Install the production workflow under `.github/workflows/`.
2. The workflow must be startable only for a specific pull request, not for an arbitrary branch.
3. Resolve the pull request through the GitHub API and derive the checkout ref from the pull request response.
4. Fail before checkout or before invoking `/runner/client.mjs` when the pull request is missing, closed, or draft.
5. Do not trust a user-supplied branch as proof that a pull request is ready.
6. Preserve the current runner -> Agent Relay -> Codex -> result -> commit -> push flow.
7. Restrict workflow permissions to the minimum required permissions.
8. Add automated tests that prove:
   - ready open PR is accepted;
   - draft PR is rejected before Agent Relay invocation;
   - closed PR is rejected;
   - missing PR is rejected;
   - the checked-out and pushed branch is derived from the PR head ref;
   - Agent Relay is not invoked on rejected cases.
9. Update README and operational documentation with the exact trigger and readiness rule.
10. Remove or replace obsolete example workflow behavior that accepts an arbitrary branch without PR verification.

## Implementation record

- Added `.github/workflows/agent-relay.yml` with `workflow_dispatch` inputs for pull request number, ExecPlan path, and mode.
- Added `runner/resolve-pr.mjs` to retrieve the selected pull request through the GitHub API and enforce open, non-draft, same-repository state before checkout.
- Checkout uses the API-derived head SHA; finalize pushes to the API-derived head ref.
- Replaced the example workflow's arbitrary branch input with the same PR-number gate.
- Separated `$GITHUB_OUTPUT` control data from runner stdout so GitHub logs and future Codex-output streaming cannot corrupt step outputs.
- Added a live GitHub log and `agent-relay-output` artifact through `tee`.
- Added optional `AGENT_RELAY_PUSH_TOKEN` support for plans that modify workflow files.
- Added automated ready, draft, closed, missing, foreign-repository, workflow-order, output-channel, and API-derived-ref tests.
- Updated README and operational documentation.
- Removed the temporary bootstrap workflow from `main` so it cannot recursively schedule jobs after pushes.

## Validation

GitHub Actions run `29290651956` completed successfully for commit `a9dd7ba34320978206c42e247770ca3800134e03`:

- `npm ci`: passed;
- `npm run check`: passed, including TypeScript, all Node tests, runner entrypoint tests, ready-PR cases, and output-channel tests;
- `docker compose config`: passed;
- Agent Relay image build: passed;
- required toolchain verification: passed;
- excluded OpenSSH and .NET checks: passed;
- runner image build: passed;
- runner image verification, including `/runner/resolve-pr.mjs`: passed.

## Scope boundary

Repository acceptance is complete based on the recorded automated evidence. Deployment-specific exercises are outside this plan's acceptance and are not assigned as follow-up work.
