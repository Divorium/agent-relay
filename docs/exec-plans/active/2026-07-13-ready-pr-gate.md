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

## Validation

Run all repository checks, including TypeScript checks, tests, Compose validation, and workflow-specific tests. Record exact commands and results in `.agent-relay/result.json`.

Do not mark the work complete when tests fail. Do not weaken tests to make them pass.
