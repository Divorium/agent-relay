# Ready-for-review execution workflow

## Status

Completed by ChatGPT. This document records finished workflow work and is not an implementation instruction for Codex.

## Goal

Make GitHub's native Ready for review transition start Agent Relay for the current pull request while retaining manual dispatch as a recovery path.

## Implemented behavior

- `.github/workflows/agent-relay.yml` subscribes to `pull_request` activity `ready_for_review` and to `workflow_dispatch`.
- Automatic execution derives the pull-request number from the event and uses `implement` mode.
- Manual execution retains explicit `pr_number`, `plan_path`, and `mode` inputs.
- The existing GitHub API resolver remains authoritative for open, non-draft, same-repository pull requests and returns the head SHA and head ref.
- Checkout uses the API-derived head SHA and push uses the API-derived head ref.
- Automatic execution resolves exactly one added or modified Markdown plan directly under `docs/exec-plans/active/`.
- The workflow has no `synchronize`, `opened`, or `reopened` activity, so normal pushes do not start Agent Relay.
- Concurrency is grouped by repository and pull-request number with `cancel-in-progress: false`.
- Fork pull requests are skipped before a self-hosted runner is allocated and remain rejected by the API resolver.
- `examples/github-actions/agent-relay.yml` is identical to the production workflow.
- The runner receives `AGENT_RELAY_OUTPUT_ARCHIVE_PATH` for the complete raw output archive.
- Console output is captured separately in `agent-relay-console.log`, preserving compatibility before and after runner streaming support.
- The artifact upload includes the raw output archive when present and the console capture.

## Files changed

- `.github/workflows/agent-relay.yml`
- `examples/github-actions/agent-relay.yml`
- `test/ready-pr-resolver.test.ts`

## Test coverage

`test/ready-pr-resolver.test.ts` verifies:

- the Ready for review trigger;
- retained manual dispatch;
- absence of automatic push/open/reopen triggers;
- same-repository gating;
- event-derived request data and automatic `implement` mode;
- API resolver, checkout, plan resolution, and Relay invocation order;
- deterministic active-plan selection;
- archive and console paths;
- production/example workflow equality;
- existing ready, draft, closed, missing, and foreign pull-request validation.

## Validation evidence

GitHub Actions run `29295450059` completed successfully for commit `c66250765413478863e17e56845c5ffb5f929304`.

Successful jobs and checks:

- `test`: `npm ci` and `npm run check` passed;
- `compose`: Docker Compose validation passed;
- `images`: Agent Relay image build, required toolchain verification, excluded-tool verification, runner image build, and runner image verification passed.

## Acceptance audit

- Ready for review trigger: implemented and tested.
- Manual recovery path: implemented and tested.
- Current PR head resolution: implemented through the existing API resolver.
- One active plan selection: implemented and tested.
- No recursive execution on normal pushes: implemented by the event subscription and tested.
- Same-repository boundary: implemented at job and resolver levels.
- Production/example alignment: implemented and tested.
- Raw archive path supplied to the runner: implemented and tested.
- Repository CI: passed.

## Outcomes & Retrospective

The workflow task is complete and separated from the Codex implementation plan. Workflow ownership, approval-event handling, plan selection, and artifact-path wiring are contained in this completed change. The remaining raw-output persistence, streaming API, runner implementation, and runtime tests are described only in the active Codex plan.
