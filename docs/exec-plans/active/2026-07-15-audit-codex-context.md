# Audit and minimize agent control context

This ExecPlan follows `.agent/PLANS.md` and remains active until the review action items and manual Docker integration gate are complete.

## Purpose / Big Picture

The task process receives one task definition: the selected active ExecPlan interpreted through `.agent/PLANS.md`. Workflow, credentials, process status, Git publication, and environment capabilities remain deterministic system concerns. Validation reflects the infrastructure that actually exists: one containerized self-hosted runner labeled `agent-relay` and one Agent Relay container.

## Progress

- [x] Created draft PR #9 and traced the task-control path from workflow dispatch through Relay execution and Git finalization.
- [x] Removed secondary task fields, model-selected outcomes, commit intent, commit messages, and the model-generated result artifact.
- [x] Reduced `AGENTS.md` to durable engineering rules and restricted the runtime prompt to `.agent/PLANS.md` plus the selected active plan.
- [x] Restricted job creation to a direct regular file under `docs/exec-plans/active/` and removed configurable launcher and user overrides.
- [x] Scoped credentials to their consuming workflow steps and separated Relay and task-process filesystem access.
- [x] Removed the invented native-host runner workflow and every claim that workflow routing can reach a host process.
- [x] Run mandatory CI only on the existing `[self-hosted, agent-relay]` runner and reject fork-origin pull requests before executing repository code.
- [x] Preserved the former Compose, image, toolchain, excluded-tool, and runner-image checks in `scripts/host-validation.sh` without claiming they run inside the containerized runner.
- [x] Replaced key implementation-text assertions with Dockerfile instruction parsing, explicit `COPY` source checks, compensation tests, and no-change behavior tests.
- [x] Made job creation compensate the request index and saved job before accepting another request.
- [x] Treat a completed Relay process with a clean worktree as an explicit no-change failure rather than a successful implementation run.
- [x] Added behavioral tests for restart recovery, compare-delete request-index compensation, and active-lock release after executor failure.
- [x] Recorded merge order for overlapping PR #3: merge PR #9 first, then rebase PR #3 onto the resulting `main` and rerun its streaming and failure-path tests.
- [x] Full mandatory CI passed on the actual self-hosted runner in workflow run `29415211394` for head `c1526474fc7957253ecca8be7c13aa9996d07270`.
- [ ] Review and explicitly approve or reject the policy that a terminal Relay run with a clean worktree is an error; align runner behavior, tests, and documentation with the decision.
- [ ] Decide whether restart-recovery, request-index compare-delete, and active-lock recovery tests belong in PR #9 or should move to a separate Relay reliability PR.
- [ ] Add strict runner HTTP contract tests for create-job and poll responses, including unexpected success statuses, missing identifiers, unknown statuses, invalid or empty JSON, incorrect content type, and bounded error bodies.
- [ ] Add runner polling tests for `accepted -> running -> completed`, an immediately terminal create response, polling timeout, and an HTTP failure during polling.
- [ ] Add commit-message derivation tests for length limits, control characters, CR/LF injection, Unicode, multiple headings, empty headings, and fallback behavior.
- [ ] Expand runner-side workspace and plan validation tests for symlinks, directories, nested paths under `active`, traversal, backslashes, missing `.md`, and a workspace symlink escaping the configured root.
- [ ] Expand Relay request validation tests for unknown fields, empty or overlong `requestId`, invalid workspace and plan paths, and reuse of one request ID with a different body.
- [ ] Add persistence-failure tests for job save, request-index save, and rollback failure combinations without introducing new lifecycle states.
- [ ] Add API error-redaction tests proving that responses do not expose bearer tokens, process environment, the host authentication path, stack traces, or unredacted process output.
- [ ] Add a full integration test covering runner client -> real Relay HTTP API -> fake executor -> `runner/finalize.sh` -> local bare Git remote, including verification of the committed and pushed branch contents.
- [ ] Add an integration test where execution moves the selected plan from `active/` to `completed/` while the runner still completes finalization using preflighted metadata.
- [ ] Add an integration test proving that an invalid or symlinked plan is rejected before the executor is called.
- [ ] Add an integration test proving request idempotency across a Relay restart with the same persisted state directory and no second executor invocation.
- [ ] Add finalizer failure-path tests for `git diff --check`, invalid target branches, rejected pushes, local commits left after a failed push, and retry behavior after partial finalization.
- [ ] Review the final PR history and decide whether to squash or reorganize it into a small set of reviewable logical commits before merge.
- [ ] Rerun the complete self-hosted CI suite after implementing the approved action items and record the final head and workflow run.
- [ ] [blocked] Execute `bash scripts/host-validation.sh` after the packaging changes.
  - Cause: the only GitHub runner is containerized and intentionally has no Docker daemon, Docker socket, or host execution route.
  - Impact: automated CI proves repository behavior and packaging contracts but does not prove that the final images build and run.
  - Evidence: the earlier successful Docker jobs ran on GitHub-hosted Ubuntu; the current self-hosted suite is daemon-independent.
  - Unblock condition: run the retained script directly on the Docker host and record its output.
- [ ] Complete a final review after all approved action items and Docker-host evidence, then move this plan back to `completed/`.

## Surprises & Discoveries

- The previously cited successful run executed on GitHub-hosted Ubuntu. It proved that the original Docker checks were useful and valid in an environment with Docker, but it did not prove they can run inside the current containerized self-hosted runner.
- A manual host script preserves the real Docker validation procedure, but a workflow targeting an unprovisioned runner is a dead test path and must not be represented as CI coverage.
- Green packaging-contract tests do not prove that a Dockerfile builds, a Compose file is accepted by Compose, or the installed Codex sandbox enforces the configured permissions.
- PR #3 and PR #9 overlap in prompt, runner, lifecycle, logging, and plan files. PR #3 must be rebased and retested after PR #9 lands.

## Decision Log

- Decision: every repository workflow uses the existing self-hosted `agent-relay` runner.
  Rationale: no GitHub-hosted or additional native runner is part of this deployment.
- Decision: `.agent/PLANS.md` remains environment-neutral.
  Rationale: environment capabilities are properties of the launcher, not reusable model instructions.
- Decision: real Docker validation remains an operator-executed repository script until an actual automated Docker-capable execution path exists.
  Rationale: a dead workflow is worse than an explicit manual gate.
- Decision: mandatory CI tests application behavior, contracts, scripts, workflow safety, packaging structure, compensation, recovery, and no-change handling without Docker.
  Rationale: lack of a Docker daemon does not justify deleting adjacent coverage.
- Decision: PR #9 precedes PR #3.
  Rationale: PR #3 depends on overlapping lifecycle and runner files and must validate its streaming changes against the final context contract.

## Validation and Acceptance

Mandatory PR validation on `[self-hosted, agent-relay]`:

    npm ci
    npm run check

Result: workflow run `29415211394` passed on head `c1526474fc7957253ecca8be7c13aa9996d07270`.

Manual Docker-host validation retained in the repository:

    bash scripts/host-validation.sh

Acceptance requires completion of the approved action items, a final green self-hosted CI run, and recorded Docker-host validation.

## Outcomes & Retrospective

The repository uses the real single-runner topology, rejects false successful no-op runs, compensates incomplete job persistence, verifies restart and lock recovery, and keeps Docker integration as an explicit manual gate rather than a fictitious workflow. Final completion remains pending on the review action items and Docker-host gate.