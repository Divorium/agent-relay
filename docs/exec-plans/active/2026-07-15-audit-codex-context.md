# Audit and minimize agent control context

This ExecPlan follows `.agent/PLANS.md` and remains active until the repository-only review findings are fixed and the final review is complete.

## Purpose / Big Picture

The task process receives one task definition: the selected active ExecPlan interpreted through `.agent/PLANS.md`. Workflow credentials, technical process status, Git publication, and environment capabilities remain deterministic system concerns. The implementation must stay within the existing Agent Relay topology and must not add product functionality or infrastructure. Automated tests validate repository code only; they do not validate Docker, GitHub, or another external platform.

## Progress

- [x] Created draft PR #9 and traced the task-control path from workflow dispatch through Relay execution and Git finalization.
- [x] Removed secondary task fields, model-selected outcomes, commit intent, commit messages, and the model-generated result artifact.
- [x] Reduced `AGENTS.md` to durable engineering rules and restricted the runtime prompt to `.agent/PLANS.md` plus the selected active plan.
- [x] Restricted job creation to a direct regular file under `docs/exec-plans/active/` and removed configurable launcher and user overrides.
- [x] Scoped credentials to their consuming workflow steps and separated Relay and task-process filesystem access.
- [x] Removed the invented native-host runner workflow and every claim that workflow routing can reach a host process.
- [x] Run mandatory CI only on the existing `[self-hosted, agent-relay]` runner and reject fork-origin pull requests before executing repository code.
- [x] Made job creation compensate the request index and saved job before accepting another request.
- [x] Added behavioral tests for restart recovery, compare-delete request-index compensation, and active-lock release after executor failure.
- [x] Recorded merge order for overlapping PR #3: merge PR #9 first, then rebase PR #3 onto the resulting `main` and rerun its streaming and failure-path tests.
- [x] Rejected the manual Docker-host validation gate and removed it from acceptance. Docker and Compose are external dependencies and are not test targets for this task.
- [x] Rejected adding a new Docker-capable workflow, host runner, Docker socket, GitHub integration test, or any other infrastructure.
- [x] Rejected a full runner-to-GitHub publication integration test and PR-history reorganization. Existing components may be tested locally, but GitHub behavior and commit-history policy are outside this repair.
- [x] Retained restart recovery, request-index compare-delete, and active-lock recovery coverage because PR #9 changes those existing code paths.
- [ ] Restore a completed Relay run with a clean worktree to a successful no-op. Treating it as an error is an unapproved behavior expansion and conflicts with review-only or already-satisfied plans.
- [ ] Harden the runner HTTP client: require the expected success status and JSON content type, bound response bodies, validate job identifiers and statuses, reject malformed success bodies, and keep polling timeout deterministic.
- [ ] Add runner polling coverage for `accepted -> running -> completed`, an immediately terminal create response, timeout, and an HTTP failure while polling.
- [ ] Make commit-message derivation deterministic for length limits, control characters, CR/LF, Unicode, multiple headings, empty headings, and fallback behavior.
- [ ] Expand runner-side workspace and plan validation coverage for symlinks, directories, nested active paths, traversal, backslashes, missing `.md`, and a workspace symlink escaping the configured root.
- [ ] Strengthen Relay request validation for unknown fields, empty or overlong request IDs, unsafe workspace paths, invalid plan paths, and reuse of one request ID with a different body.
- [ ] Add persistence-failure coverage for job save, request-index save, and rollback-failure combinations without adding lifecycle states.
- [ ] Remove internal filesystem paths from public job responses and redact any stored error text before it is returned by the API.
- [ ] Make process-output redaction safe when UTF-8 sequences or secrets are split across stdout/stderr chunks.
- [ ] Add repository-only API tests proving responses do not expose bearer tokens, process environment, authentication-file paths, stack traces, internal output paths, or raw process output.
- [ ] Add repository-only coverage for moving the selected plan from `active/` to `completed/` while finalization still uses preflighted metadata.
- [ ] Add repository-only coverage proving invalid or symlinked plans are rejected before the executor is called.
- [ ] Add repository-only coverage proving request idempotency survives Relay restart with the same persisted state and does not invoke the executor twice.
- [ ] Make a rejected push restore the pre-commit working-tree changes, and cover it with a local bare Git remote. Do not test GitHub.
- [ ] Add finalizer failure-path coverage for `git diff --check`, invalid target branches, rejected pushes, and retry after a failed publication attempt.
- [ ] Remove `scripts/host-validation.sh` and every documentation, package-script, and acceptance reference that presents Docker or GitHub as an automated or manual test target for this task.
- [ ] Run `npm run check` and record repository-only validation evidence.
- [ ] Perform a second full review, add every new finding to this plan, repair the accepted findings, and rerun `npm run check`.
- [ ] Complete the final review and move this plan to `completed/` only when every accepted repository-code item is complete.

## Surprises & Discoveries

- The active plan had become a backlog of speculative integration and infrastructure work rather than a bounded repair plan.
- A clean worktree can be a valid result for review-only work or a plan already satisfied by the repository; forcing it to fail adds behavior that the user did not request.
- The runner currently parses any successful JSON body as a job. Missing identifiers, unknown statuses, wrong content types, and unexpectedly large bodies can therefore escape the HTTP boundary.
- Public job responses currently expose the internal `outputPath` and may return stored executor error text without response-time redaction.
- Chunk-local redaction can leak a secret split across process-output chunks even when the complete value matches a configured secret pattern.
- A failed push occurs after creating a local commit, so the next attempt may not see the original working-tree changes unless finalization rolls the commit back.

## Decision Log

- Decision: do not add functionality or infrastructure while repairing PR #9.
  Rationale: the user explicitly prohibited both.
- Decision: tests exercise repository code and local fixtures only.
  Rationale: Docker, GitHub, hosted runners, and remote platform behavior are external dependencies, not test subjects for this task.
- Decision: a completed Relay job with no repository changes is successful.
  Rationale: technical completion and worktree mutation are different facts; the runner must not invent a failure outcome.
- Decision: existing persistence and recovery behavior stays in PR #9 and receives focused coverage.
  Rationale: PR #9 already changes those paths, so validating them is repair work rather than scope expansion.
- Decision: finalizer publication tests may use a local bare Git repository.
  Rationale: this exercises the repository script deterministically without testing GitHub or adding infrastructure.
- Decision: PR #9 precedes PR #3.
  Rationale: PR #3 overlaps lifecycle, prompt, runner, logging, and plan files and must be rebased after this context contract stabilizes.

## Validation and Acceptance

Repository-only validation:

    npm ci
    npm run check

Tests may start local HTTP servers, temporary processes, temporary workspaces, and local bare Git repositories to exercise code owned by this repository. They must not require or validate Docker, Compose, GitHub APIs, hosted runners, network services, or credentials.

Acceptance requires all accepted findings to be implemented, repository-only validation to pass, and a second review to find no unresolved correctness or security defect within the PR scope.

## Outcomes & Retrospective

PR #9 has a bounded repair plan again. The first review identified contract-validation, path-validation, redaction, API-exposure, no-op semantics, persistence, and failed-publication recovery work. Completion remains pending on implementation, repository-only validation, and the required second review.
