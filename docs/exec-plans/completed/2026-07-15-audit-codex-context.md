# Audit and minimize agent control context

This ExecPlan follows `.agent/PLANS.md`. It was completed after two repository reviews, implementation of every accepted finding, and repository-only validation.

## Purpose / Big Picture

The task process receives one task definition: the selected active ExecPlan interpreted through `.agent/PLANS.md`. Workflow credentials, technical process status, Git publication, and environment capabilities remain deterministic system concerns. The implementation stays within the existing Agent Relay topology and adds neither product functionality nor infrastructure. Automated tests validate repository code and local fixtures only; they do not invoke or validate Docker, GitHub, hosted services, or credentials.

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
- [x] Rejected adding a Docker-capable workflow, host runner, Docker socket, GitHub integration test, or any other infrastructure.
- [x] Rejected a runner-to-GitHub publication integration test and PR-history reorganization. Existing components are tested locally without testing GitHub.
- [x] Restored a completed Relay run with a clean worktree to a successful no-op.
- [x] Hardened the runner HTTP client with exact success statuses, JSON content-type checks, bounded response bodies, validated job identifiers and statuses, malformed-response rejection, and deterministic polling deadlines.
- [x] Added runner polling coverage for `accepted -> running -> completed`, immediate completion, timeout, and polling HTTP failure.
- [x] Made commit-message derivation deterministic for limits, control characters, CR/LF, Unicode, multiple headings, empty headings, and fallback behavior.
- [x] Expanded runner-side workspace and plan validation coverage for symlinks, directories, nested active paths, traversal, backslashes, invalid extensions, and workspace symlink escape.
- [x] Strengthened Relay request validation for unknown fields, invalid request IDs, unsafe workspace paths, invalid plan paths, and request-ID reuse with a different body.
- [x] Added persistence-failure coverage for job save, request-index save, rollback failure, request-index ownership, and restart idempotency without adding lifecycle states.
- [x] Removed internal filesystem paths and stored executor messages from public job responses.
- [x] Made process-output redaction safe when UTF-8 sequences or secrets are split across process chunks and when output truncates an incomplete sensitive line.
- [x] Added API tests proving responses do not expose bearer tokens, process environment, authentication-file paths, stack traces, internal output paths, or raw process output.
- [x] Added coverage for moving the selected plan from `active/` to `completed/` while finalization uses preflighted metadata.
- [x] Added coverage proving invalid or symlinked plans are rejected before the executor is called.
- [x] Added coverage proving request idempotency survives Relay restart without a second executor invocation.
- [x] Made a rejected push restore pre-commit working-tree changes and covered retry through a local bare Git repository.
- [x] Added finalizer coverage for `git diff --check`, invalid target branches, rejected pushes, retry, control characters, and Unicode length limits.
- [x] Removed `scripts/host-validation.sh` and every package, documentation, and acceptance reference that presented Docker or GitHub as a test target.
- [x] Added the second-review finding that Bash string length depends on locale; finalizer validation now counts Unicode characters deterministically with Node.
- [x] Fixed CI compatibility with the repository's intentionally minimal Node declarations without adding runtime dependencies.
- [x] Completed the second full review and found no remaining correctness or security defect within the PR scope.
- [x] Completed repository-only validation.
- [x] Moved this plan from `active/` to `completed/`.

## Surprises & Discoveries

- The original active plan had become a backlog of speculative integration and infrastructure work rather than a bounded repair plan.
- A clean worktree can be a valid result for review-only work or a plan already satisfied by the repository; forcing it to fail invented a task outcome.
- The runner previously parsed any successful JSON body as a job, allowing missing identifiers, unknown statuses, wrong content types, and unexpectedly large bodies past the HTTP boundary.
- Public job responses exposed internal output paths and could return stored executor details.
- Chunk-local redaction could leak a secret split across process-output chunks.
- A failed push occurred after creating a local commit and could hide the original working-tree changes from a retry.
- Bash `${#value}` is locale-dependent and was not a deterministic implementation of the runner's 120-Unicode-character commit-message contract.
- The repository uses intentionally minimal Node type declarations; tests must stay compatible with those declarations rather than silently broadening the environment contract.

## Decision Log

- Decision: do not add functionality or infrastructure while repairing PR #9.
  Rationale: both were explicitly outside the approved scope.
- Decision: tests exercise repository code and local fixtures only.
  Rationale: Docker, GitHub, hosted runners, and remote services are external dependencies, not test subjects for this task.
- Decision: a completed Relay job with no repository changes is successful.
  Rationale: technical process completion and worktree mutation are separate facts.
- Decision: existing persistence and recovery behavior stays in PR #9 and receives focused coverage.
  Rationale: PR #9 already changes those code paths.
- Decision: finalizer publication tests use a local bare Git repository.
  Rationale: this exercises repository-owned Git behavior deterministically without testing GitHub or adding infrastructure.
- Decision: PR #9 precedes PR #3.
  Rationale: PR #3 overlaps lifecycle, prompt, runner, logging, and plan files and must be rebased after this contract stabilizes.

## Validation and Acceptance

Repository-only validation:

    npm ci
    npm run check

Self-hosted CI run `29419774713` passed on code-complete head `6da16ab2802de6da820a56a6c9d1e9c48f9ef7a9`. The suite used repository code and local fixtures. It did not invoke Docker, Compose, GitHub APIs, hosted services, external network services, or credentials.

The preceding failed run `29419437625` exposed only TypeScript compatibility issues with the repository's minimal Node declarations. Those issues were repaired, covered, and the complete suite then passed.

## Outcomes & Retrospective

PR #9 now has one bounded task authority, deterministic runtime outcomes, strict runner and API contracts, safe path handling, chunk-safe redaction, recoverable publication failure, and repository-only regression coverage. The second review found one additional Unicode-length defect, which was added to the plan, fixed, and tested. No accepted finding remains open.
