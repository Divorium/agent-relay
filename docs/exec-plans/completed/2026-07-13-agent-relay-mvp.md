# Agent Relay MVP

## Purpose / Big Picture

Agent Relay is a self-hosted bridge between a repository-scoped GitHub Actions runner and Codex CLI.

GitHub Actions checks out the selected pull-request branch. The runner submits a job to Agent Relay over the Compose network. Agent Relay starts a fresh non-interactive Codex process in the shared workspace. Codex implements the active plan and validates its work. The runner owns repository publication and uses the actual Git worktree as the source of truth for commit creation.

The MVP supports one target repository per Docker Compose deployment.

## Progress

- [x] Defined the one-repository architecture and responsibility split.
- [x] Implemented the Node.js 22 and TypeScript Relay service.
- [x] Implemented authenticated create-and-poll job APIs.
- [x] Implemented strict request and result contracts used by the original MVP.
- [x] Implemented workspace containment, request idempotency, and one-active-job exclusion.
- [x] Implemented atomic file-backed state and restart recovery.
- [x] Implemented controlled Codex process execution, byte-based output limits, redaction, timeout, and process termination.
- [x] Implemented the runner client and runner-owned Git flow.
- [x] Removed agent-provided commit intent; the actual Git worktree became the source of truth for commit creation.
- [x] Strengthened Relay instructions so Codex does not publish repository commits.
- [x] Fixed workflow request IDs and branch validation.
- [x] Made runner registration reusable after an ordinary container restart.
- [x] Added Agent Relay and runner images plus Compose packaging.
- [x] Added the required development toolchain and removed excluded tools.
- [x] Added contract, HTTP, lifecycle, child-process, runner-client, workflow-template, and runner-entrypoint tests.
- [x] Added CI for TypeScript, tests, packaging definitions, command contracts, toolchain contents, and excluded tools.
- [x] Restricted acceptance to repository-owned behavior supported by automated evidence; deployment-specific exercises are outside this completed plan and are not follow-up tasks.

## Decisions

- One repository is supported per Compose deployment.
- The runner owns checkout, GitHub credentials, commit, and push.
- Agent Relay owns validation, persistence, process execution, and result reporting.
- Codex edits the shared checkout but does not publish commits.
- `git status --porcelain` in the runner is the source of truth for whether a commit is needed.
- One Codex job may run at a time.
- Agent Relay uses a fresh `codex exec` process for every job.
- The container has no Docker socket, GitHub job credential, deploy key, or private application-log mount.
- The runner reuses an existing registration after restart and requires a registration token only when creating a registration.
- OpenSSH and .NET are excluded from the Agent Relay image.

## Implemented Architecture

### Runner

The runner image and workflow provide repository-scoped registration, checkout, validated branch handling, authenticated bounded job polling, independent Git worktree verification, commit creation only when changes exist, and push to the validated pull-request branch.

Evidence:

- `Dockerfile.runner`
- `runner/entrypoint.sh`
- `runner/client.mjs`
- `examples/github-actions/agent-relay.yml`
- `test/runner-entrypoint.test.sh`
- `test/runner-client.test.ts`

### Agent Relay

Agent Relay provides authenticated health and job APIs, workspace containment, atomic job records, idempotency, one-active-job exclusion, interrupted-state recovery, a fresh Codex process per job, output limits, persisted redaction, timeout handling, and explicit process lifecycle classification.

Evidence:

- `src/api/server.ts`
- `src/application/job-service.ts`
- `src/persistence/job-store.ts`
- `src/execution/codex-executor.ts`
- `src/execution/prompt.ts`
- `src/contracts/validators.ts`
- `src/security/auth.ts`
- `src/security/workspace.ts`
- `src/security/redaction.ts`
- `test/executor.integration.test.ts`
- `test/integration.test.ts`

## Test Strategy

Repository checks cover request and result contracts, error codes, authentication, workspace containment, sensitive-data handling, persistence and recovery, HTTP lifecycle, idempotency, concurrent-job exclusion, real child-process execution, timeout behavior, runner-client integration, Git worktree decisions, workflow request identifiers, branch handling, runner registration, and command contracts.

A CI result is authoritative only when it belongs to the reviewed head SHA.

## Outcomes

The MVP established the Relay, runner, persistence, execution, and publication boundaries. Commit creation no longer depends on model-authored commit intent. Repository-owned behavior is covered by automated checks and controlled local integration fixtures. No unexecuted deployment or human validation task remains part of this completed plan.

## Revision Notes

- 2026-07-13: Defined the architecture and responsibility boundaries.
- 2026-07-13: Implemented Relay, runner, packaging, contracts, persistence, process execution, and operations.
- 2026-07-13: Added unit and integration coverage plus repository CI.
- 2026-07-14: Removed model-authored commit intent and made the Git worktree authoritative.
- 2026-07-16: Removed unexecuted deployment exercises from completed-plan acceptance under the repository responsibility policy.
