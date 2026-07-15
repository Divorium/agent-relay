# Add restart-safe raw Codex output streaming without regressing isolation

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current as work proceeds. Maintain this document in accordance with `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

The mandatory runtime baseline is `main` commit `f043af2fa9eb0420a0d64684485700f92a5dc425`. The reviewed implementation snapshot before this plan-only revision is `215c032905ad4fe962125b7fdc822ee4a4a7c56a`. If `origin/main` does not resolve to the pinned baseline when Codex starts, Codex must add a `[blocked]` Progress entry describing the new SHA and stop before editing implementation files. Codex must not silently expand the task to a newer baseline.

Codex may use read-only Git commands such as `status`, `diff`, `show`, `grep`, `rev-parse`, and `merge-base`. It must not run `git add`, `commit`, `merge`, `rebase`, `reset`, `restore`, `checkout`, `cherry-pick`, `push`, or another command that mutates Git history, the index, or tracked files outside the edits required by this plan. The generic `commit frequently` sentence in `.agent/PLANS.md` does not authorize Git mutations in this repository; record stopping points frequently in `Progress` instead. The GitHub runner owns commit and push.

Codex must not edit `AGENTS.md`, `.agent/PLANS.md`, any file under `.github/workflows/`, or any file under `examples/github-actions/`. Those instruction and workflow files are human-maintained. Codex must preserve their contents exactly as they exist in reviewed snapshot `215c032905ad4fe962125b7fdc822ee4a4a7c56a`.

## Purpose / Big Picture

After this work, an operator can watch the exact bytes emitted by Codex stdout and stderr while a job is running, reconnect from an acknowledged byte position after a transient output-transport interruption, and receive a byte-identical terminal archive only after Relay has finalized the complete output stream.

Relay stores the authoritative combined stream in the callback order in which Node delivers stdout and stderr data events. The authoritative output, output endpoint, runner archive, and runner live byte stream are intentionally raw and unredacted, including invalid UTF-8 and secret-looking byte sequences. This makes the output sensitive. Relay-side service logging is only a best-effort presentation copy and may be disabled after its sink fails; runner archive and runner stdout handling are required local sinks and their failure fails the workflow.

`MAX_OUTPUT_BYTES` is a hard limit over all bytes accepted from both child streams. Reaching the limit terminates the child, fails the job and output stream with `OUTPUT_LIMIT_EXCEEDED`, preserves only bytes accepted before the rejected chunk, emits no textual truncation marker, and never publishes clean EOF or a final archive.

The feature is additive to the pinned `main` runtime and security architecture. The create request remains result-free. Codex receives only the approved workspace, launcher, environment, filesystem, and credential boundaries. Codex does not create a model result artifact, select a job status, decide whether a commit is needed, create commits, or publish branches. Relay derives the technical job result from the child process and output lifecycle. The runner derives the commit subject from this active plan. `runner/finalize.sh` remains the only component that decides whether repository changes are publishable.

## Progress

Keep this section append-only for completed historical entries. Split partially completed work into a checked historical entry and a remaining unchecked entry. A checked item must identify a repository location plus passing automated evidence, or a reproducible command plus its captured result.

- [x] (2026-07-13 23:33Z) Created the original raw-output ExecPlan and opened PR #3.
- [x] (2026-07-14, initial prototype) Added a first prototype covering output persistence, an output endpoint, executor mirroring, runner streaming, workflow artifact handling, configuration, documentation, and tests. The prototype remained unaccepted and did not count as completed implementation.
- [x] (2026-07-14 21:50Z) Reviewed the prototype and recorded nine actionable defects in inline review threads.
- [x] (2026-07-15 00:42Z) Compared the branch with the architecture introduced by PR #9 and found that the branch restored contracts removed from `main`.
- [x] (2026-07-15, correction) Restored the prototype at commit `32edacbac00be64a1b5674af2c0c81255c2c72bd` after an incorrect temporary plan-only rewrite.
- [x] (2026-07-15 21:00Z) Recorded seven additional defects: no durable active-job checkpoint, unbounded replay resources, no positive offset acknowledgement, duplicate replay after local sink failure, ignored configured poll interval, incomplete drain failure handling, and short-read spin risk.
- [x] (2026-07-15, plan revision `767e21feb7441f19b1623d1efd3a577d439ad80f`) Added restart-safe persistence, exact protocol, retry, resource-lifecycle, and deterministic test requirements.
- [x] (2026-07-15, plan revision `d6b706fc0da51c6b151e55eb62de141a74bf2e92`) Removed container execution from acceptance. Dockerfiles and `compose.yml` remain subject only to static source validation.
- [x] (2026-07-15) Migrated the complete substance of all nine inline findings into this plan and resolved all nine GitHub review threads. Resolving discussions did not complete implementation.
- [x] (2026-07-15, plan revision `973ee1ff56f3d45be9526325d9b8056e2cc62b8c`) Restored historical entries and separated completed review work from incomplete implementation work, but used checklists outside `Progress` and therefore did not conform to the repository ExecPlan template.
- [x] (2026-07-15, plan revision `21587cf36f2c82c678e9e1d7c2a41f418e74367b`) Rewrote the plan into the article skeleton, but incorrectly described the article-provided `.agent/PLANS.md` as legacy and left implementation scope incomplete.
- [x] (2026-07-15 21:06Z) Re-reviewed PR #3 against `main`, the OpenAI ExecPlan article, and the restored prototype. Corrected task ownership, removed post-commit gates from Codex scope, selected process-restart durability semantics, and expanded runtime, persistence, endpoint, runner, finalizer, and test requirements.
- [x] (2026-07-15 21:06Z) Completed the human-maintained instruction setup in commit `c76cbcc4fb353d8a9b737bbfb5006a77e51d35ac`: preserved `.agent/PLANS.md` at blob `15d9583b1df0663488d55e4fdfea1c6154ba85d1` and updated `AGENTS.md` to the exact article `# ExecPlans` section plus the minimal engineering rules.
- [x] (2026-07-15 21:06Z) Completed the human-maintained workflow setup in commits `b967b14f4753f5a3b82d529ed72c254e0aec9675` and `4a058cf06cbadcd81cf9e4c42ad4d7cedd1b00cc`: the production and example workflows preserve credential, active-plan, and finalizer boundaries and provide terminal archive and console-log paths.
- [x] (2026-07-15 21:30Z) Merged pinned `main` `f043af2fa9eb0420a0d64684485700f92a5dc425` into the PR branch. The branch became zero commits behind `main`; conflicts retained the prototype for later plan-driven repair.
- [x] (2026-07-15 22:23Z) Repaired merge-induced result-contract and test failures through commits `e83d690e03cc534a37e8f5e62069854908790f74`, `052a081787c2912c8ae5254e9ae2f6cc44e971c0`, and `215c032905ad4fe962125b7fdc822ee4a4a7c56a`. GitHub Actions run `29455214780` completed successfully with 86 tests passed, zero failed, and `npm run check` successful. This is a green baseline, not feature acceptance.
- [x] (2026-07-16, implementation-readiness review) Re-reviewed the current branch and plan. Pinned the `main` baseline, protected all workflow files, resolved raw-output versus redaction semantics, defined terminal ordering and interrupted recovery, allowed transient output reconnect after the job becomes terminal, narrowed Codex-owned files, and replaced broad reconciliation prose with independently verifiable milestones.

- [ ] Verify the pinned baseline and protected-file hashes before editing. Record the command output in `Artifacts and Notes`. If the baseline or a protected file differs, add a `[blocked]` entry and stop.
- [ ] Remove the executor's dual legacy output path. `CodexExecutor` must always use the prepared `OutputStore` writer for production execution; it must not create or append the output file itself, truncate output, add a marker, decode bytes, or import or call `StreamingRedactor`. Keep the standalone redaction utility and its independent unit tests unchanged, but add tests proving secret-looking and invalid UTF-8 bytes pass unchanged through executor, endpoint, and archive.
- [ ] Implement the versioned per-job checkpoint and private file layout described in `Interfaces and Dependencies`. `prepare` must atomically establish both the empty output and initial checkpoint or remove its own partial resources. Physical file size must never become the committed boundary.
- [ ] Serialize every append inside `OutputStore`, write each accepted chunk completely, atomically replace the checkpoint before exposing the new `committedLength`, enforce first-terminal-wins, and finalize the writer by sealing appends, draining pending writes, syncing, attempting close on every path, and clearing writer ownership before any terminal checkpoint is published.
- [ ] Enforce `MAX_OUTPUT_BYTES` over total accepted bytes before accepting a child chunk. Implement a byte-bounded FIFO with explicit high and low watermarks, pause both child streams at the high watermark, resume only below the low watermark, reject the entire chunk that would exceed the hard limit, terminate the child, and keep memory overshoot bounded by already-delivered child chunks.
- [ ] Implement restart recovery and bounded replay state. Recover accepted or running jobs from the checkpoint, truncate only an uncommitted suffix under exclusive interrupted-recovery ownership, save the job as `interrupted`, publish `OUTPUT_INTERRUPTED` rather than clean EOF, use short-lived read-only handles, make attachment single-flight, release every reader and waiter, and evict terminal state when no lease remains. Corrupt historical output must fail only that job, not service startup.
- [ ] Implement the exact job and output terminal state machine. The executor must return process outcome only after child close, both streams end, the append queue drains, and the writer is finalized. JobService must save the terminal job record before publishing the matching terminal checkpoint. Completed, non-zero, timed-out, and spawn-failed processes may publish clean output if output finalization succeeded; interrupted, output-limit, write, integrity, and terminal-state failures must publish an output error and never clean EOF.
- [ ] Complete the internal output error taxonomy and public filtering. Add exact codes for offset range, integrity, interruption, and terminal-state persistence or disagreement. Keep private paths, checkpoint data, and raw internal messages out of create and poll DTOs and bounded pre-header JSON errors.
- [ ] Implement the authenticated output endpoint state machine. Validate authentication, job ID, canonical offset, checkpoint, lease, and the first required read or terminal snapshot before raw headers. Implement exact offset acknowledgement, `416` committed-length acknowledgement, raw identity transfer, active following, strict short-read detection, backpressure, pre-header JSON errors, post-header destruction for every error, and unconditional lease and waiter release.
- [ ] Make `AGENT_RELAY_OUTPUT_ARCHIVE_PATH` mandatory for `runner/client.mjs`, require an absolute path outside `GITHUB_WORKSPACE`, and complete all preflight before POST: bounded settings, active-plan validation, plan-derived subject, redirect policy, signal handlers, stale final removal, exclusive same-directory `0600` temporary archive, and workflow-command guard state.
- [ ] Implement the runner's output/status state machine. Persist each complete chunk to the temporary archive, then perform required guarded stdout presentation, then advance the confirmed offset. Retry only transient output acquisition, idle, body, or premature-EOF failures from the confirmed offset until clean terminal output is established or the global deadline expires, including after the job status is terminal. Explicit HTTP or protocol responses and every local sink, polling, signal, or finalization failure are fatal and never reconnect.
- [ ] Publish a final archive only after clean terminal output, file sync, successful close, and atomic rename. Preserve the complete archive for `failed` and `timed_out` jobs when their output is clean, but still fail the workflow for the job status. Any output error or incomplete local handling removes only attempt-owned temporary state, leaves the final path absent, and leaves `$GITHUB_OUTPUT` unchanged.
- [ ] Update `README.md`, `docs/operations/README.md`, and `docs/operations/live-codex-logs.md` to describe the final sensitive raw-output contract, offset protocol, retry behavior, archive lifecycle, failure behavior, limits, and operator handling. Do not edit workflow, packaging, launcher, finalizer, credential, prompt, or public request files unless this plan is first revised with a concrete blocker and the user resolves it.
- [ ] Add or extend deterministic tests for checkpoint creation and replacement, partial and zero-progress writes, append ordering, watermarks, hard limit, finalization, first-terminal-wins, recovery, corruption isolation, file modes, single-flight attachment, state eviction, compensation, terminal ordering, raw bytes, endpoint protocol, runner reconnect after active and terminal status, workflow-command isolation, signals, archive finalization, and local failure without reconnect.
- [ ] Add local full-flow tests for successful binary live output with one transient reconnect and a byte-identical archive; Relay restart after an uncommitted physical suffix; clean diagnostic archive for a failed process; output-error final archive absence; and local sink failure after an archive side effect with no reconnect, duplicate, final archive, or `$GITHUB_OUTPUT` mutation.
- [ ] Run all focused tests, `npm run check`, and `git diff --check` on the final working tree. Record commands, exact test counts, coverage, failures, and protected-file verification in `Artifacts and Notes`. Update `Outcomes & Retrospective` and append a final revision note before considering implementation complete.

## Surprises & Discoveries

- Observation: `.agent/PLANS.md` in PR #3 is the intended article document, not legacy content.
  Evidence: its blob `15d9583b1df0663488d55e4fdfea1c6154ba85d1` is byte-for-byte identical to the `PLANS.md` body published in the OpenAI article and must remain unchanged.

- Observation: the current branch is already merged with the pinned `main` baseline and has a green test baseline.
  Evidence: comparison with `main` reports `behind_by: 0`; CI run `29455214780` passed 86 tests on head `215c032905ad4fe962125b7fdc822ee4a4a7c56a`.

- Observation: a green baseline does not implement the plan's durability and failure semantics.
  Evidence: `src/persistence/output-store.ts` has no checkpoint, derives committed length from file size during attach, creates a missing terminal output file, keeps one read-write handle for replay, and publishes terminal state without writer sync or close.

- Observation: the executor still contains two incompatible output contracts.
  Evidence: the `OutputStore` path preserves raw bytes, while the fallback path imports `StreamingRedactor`, appends its own output file, truncates, and inserts `[OUTPUT TRUNCATED]`. Production raw output must have one path.

- Observation: `runner/client.mjs` currently performs only one output request.
  Evidence: it has no confirmed-offset reconnect loop, no idle timer, no signal cleanup, and no workflow-command suppression. Its archive path is optional even though the workflow feature requires a terminal archive.

- Observation: retry eligibility cannot depend only on an active job status.
  Evidence: a transient connection can fail after the child and job become terminal but before the runner has received all committed bytes or clean EOF. The runner must continue transient output recovery after terminal status until output completion is established.

- Observation: output terminal state and job terminal state are related but not identical.
  Evidence: a non-zero, timed-out, or spawn-failed process can have a complete clean diagnostic stream; an interrupted or output-infrastructure failure cannot publish clean EOF even when the job record is terminal.

- Observation: workflow files cannot be delegated to Codex.
  Evidence: the user assigned workflow maintenance to the human reviewer. The protected scope therefore covers every file under `.github/workflows/` and `examples/github-actions/`, not only the two files currently changed by the PR.

- Observation: `.agent/PLANS.md` contains generic Git advice that conflicts with repository ownership.
  Evidence: this active plan explicitly overrides `commit frequently` for this task; stopping points are recorded in `Progress`, while the runner remains the sole Git mutation owner.

## Decision Log

- Decision: pin the runtime baseline to `f043af2fa9eb0420a0d64684485700f92a5dc425`.
  Rationale: silently following a newer `origin/main` could change scope after review and could require human-owned workflow changes.
  Date/Author: 2026-07-16 / implementation-readiness review.

- Decision: preserve `.agent/PLANS.md`, `AGENTS.md`, all GitHub workflow files, and all example workflow files exactly as reviewed.
  Rationale: instruction and workflow ownership was explicitly assigned to the human reviewer.
  Date/Author: 2026-07-16 / user instruction.

- Decision: Codex records frequent stopping points but performs no Git mutations.
  Rationale: the runner owns commit and push, and the specific repository rule overrides the generic article sentence.
  Date/Author: 2026-07-16 / implementation-readiness review.

- Decision: authoritative output, endpoint output, runner archive, and runner live bytes are raw and unredacted.
  Rationale: byte identity and invalid-UTF-8 support are core feature requirements. `StreamingRedactor` remains an unrelated utility but is not part of any raw-output path.
  Date/Author: 2026-07-16 / implementation-readiness review.

- Decision: restart safety covers Relay process termination and restart, not host power loss.
  Rationale: complete writes plus same-directory atomic checkpoint replacement are sufficient without per-append `fsync`; clean terminal publication still requires final writer sync and close.
  Date/Author: 2026-07-15 / scope decision.

- Decision: the checkpoint is authoritative for committed length and terminal output facts; physical file size is never authoritative.
  Rationale: a process may terminate after extending the file but before advancing the checkpoint.
  Date/Author: 2026-07-15 / persistence review.

- Decision: the executor finalizes the writer, JobService saves the terminal job record, and only then may JobService publish the matching clean or error terminal checkpoint.
  Rationale: clean EOF must never become visible while the durable job record is still active or contradictory.
  Date/Author: 2026-07-16 / implementation-readiness review.

- Decision: clean output terminal states are permitted only for job statuses `completed`, `failed`, and `timed_out`.
  Rationale: failed and timed-out processes can produce complete diagnostics; an interrupted process cannot prove complete output and must terminate with `OUTPUT_INTERRUPTED`.
  Date/Author: 2026-07-16 / implementation-readiness review.

- Decision: Relay-side process stdout is best-effort, while runner archive and guarded runner stdout are required local sinks.
  Rationale: Relay logging failure must not invalidate authoritative bytes, but runner local failure makes offset acknowledgement unsafe and must prevent reconnect.
  Date/Author: 2026-07-16 / implementation-readiness review.

- Decision: transient output transport recovery remains allowed after the job status becomes terminal until the runner establishes clean output EOF or receives an output terminal error.
  Rationale: job status does not prove that the runner received all authoritative bytes.
  Date/Author: 2026-07-16 / implementation-readiness review.

- Decision: redirects, explicit HTTP errors, protocol mismatches, polling failures, signals, and local sink or finalization failures are fatal and non-retryable.
  Rationale: reconnect is safe only for remote output acquisition or body failures before local acknowledgement; local side effects may already have occurred.
  Date/Author: 2026-07-16 / implementation-readiness review.

- Decision: the final archive path denotes only an atomically published complete terminal stream.
  Rationale: incomplete transport, output errors, or local finalization failure must leave no artifact that can be mistaken for complete output.
  Date/Author: 2026-07-15 / archive review.

- Decision: use Node.js built-ins and deterministic local tests; add no runtime dependency and no container-runtime acceptance test.
  Rationale: the feature does not require a third-party library or live container environment.
  Date/Author: 2026-07-16 / implementation-readiness review.

- Decision: post-commit SHA checks, GitHub status checks, mergeability, and remote review are not Codex tasks.
  Rationale: Codex operates before the runner creates and pushes the commit and has neither the final SHA nor publication credentials.
  Date/Author: 2026-07-15 / user correction.

## Outcomes & Retrospective

This plan remains active. The branch has a green current-main baseline, but the complete raw-streaming feature is not accepted.

The instruction files, workflows, `main` merge, result-free request, active-plan validation, launcher, environment, credential boundary, finalizer, packaging, and baseline tests are already in place. Codex must preserve them rather than reimplement them.

Remaining work is deliberately limited to durable output persistence, executor backpressure and terminal behavior, job/output terminal ordering and recovery, the output endpoint, the runner output state machine, documentation, and deterministic tests. Completion requires every unchecked Progress item and all working-tree validation, not merely a green pre-existing CI run.

## Context and Orientation

Agent Relay accepts a job for one repository workspace and launches Codex through the fixed `/usr/local/bin/codex-run` boundary. `src/execution/codex-executor.ts` receives stdout and stderr data events. Their Node callback order defines the combined authoritative stream; no stronger operating-system ordering is claimed.

`src/persistence/output-store.ts` owns output files, checkpoints, writer ownership, append serialization, live snapshots, waiters, replay leases, and terminal output facts. A committed byte is a byte fully written to the output file and included in an atomically replaced checkpoint. The output path remains private in `JobRecord`; the checkpoint path is derived internally and never enters a public DTO.

`src/application/job-service.ts` owns job creation, one-active-job admission, execution, process-derived terminal status, terminal job persistence, restart recovery, and compensation. `src/persistence/job-store.ts` owns job records and the request-ID index. Compare-delete means removing a request mapping only if it still points to the exact job created by the failing attempt.

`src/api/server.ts` exposes authenticated create, poll, and output APIs. A pre-header output failure occurs before octet-stream headers and uses the bounded JSON error envelope. A post-header output failure occurs after octet-stream headers and destroys the transport; it never changes representation to JSON.

`runner/client.mjs` validates local context, derives the commit subject, submits and polls the job, consumes output from a confirmed byte offset, writes the temporary archive, produces a guarded live view, and updates `$GITHUB_OUTPUT` only after output and job success. Confirmed offset is the number of remote bytes for which every required local operation completed successfully.

`runner/finalize.sh` remains unchanged. It decides whether the worktree has changes, validates the commit subject, creates the commit, injects publication credentials only for push, and restores the uncommitted worktree if push fails.

The expected Codex-owned implementation files are `src/contracts/errors.ts`, `src/persistence/output-store.ts`, `src/persistence/job-store.ts`, `src/application/job-service.ts`, `src/execution/codex-executor.ts`, `src/api/server.ts`, `src/server.ts`, `runner/client.mjs`, the three operator documents, this active plan, relevant `test/*.ts` files, and a local type shim only when required for Node built-ins. The expected preserved files include `src/contracts/job.ts`, `src/contracts/validators.ts`, `src/execution/prompt.ts`, `src/security/workspace.ts`, `src/security/redaction.ts`, `src/config/config.ts`, `.env.example`, `compose.yml`, both Dockerfiles, `scripts/codex-run`, `runner/finalize.sh`, all workflow files, `AGENTS.md`, and `.agent/PLANS.md`.

## Plan of Work

### Milestone 1: Freeze the reviewed baseline and remove the executor's competing output contract

Verify the pinned `main` SHA, protected files, current public request, fixed launcher, active-plan validation, credentials, and packaging before changing runtime code. Remove only the executor's redacted/truncating fallback path and make the prepared OutputStore writer the single execution path. Preserve the standalone redaction utility, but prove it is not imported by the executor and does not touch raw bytes.

The milestone is complete when the baseline assertions pass, the executor has one output path, the existing non-streaming security and contract tests still pass, and new executor tests preserve invalid UTF-8 and secret-looking bytes exactly.

### Milestone 2: Build durable, bounded output persistence and recovery

Replace in-memory file-size authority with the exact checkpoint model below. Implement atomic prepare, serialized append, complete writes, checkpoint replacement, hard limit accounting, writer finalization, first-terminal-wins, single-flight attachment, short-lived reads, leases, state eviction, interrupted recovery, and corruption isolation. Extend JobStore only as needed to enumerate and save records during restart recovery while preserving request-index idempotency and compare-delete compensation.

The milestone is complete when deterministic persistence and job-service tests cover every write, checkpoint, terminal, recovery, cleanup, and compensation boundary without timing-only assertions.

### Milestone 3: Integrate child execution with the job/output terminal state machine

Move byte FIFO and child backpressure into the executor while keeping OutputStore append serialization authoritative. Ensure the executor waits for child close, both stream endings, queue drain, and writer finalization. Return enough process outcome for JobService to distinguish zero exit, non-zero exit, timeout, and spawn failure. JobService saves the terminal job record first, then publishes the matching output terminal checkpoint. Output-infrastructure failures terminate the child and publish an output error after the failed job record.

The milestone is complete when tests demonstrate exact callback order, bounded pending bytes, child termination on limit or persistence failure, diagnostic clean output for non-zero and timed-out processes, output errors for interrupted and infrastructure failures, and no clean EOF before job persistence.

### Milestone 4: Implement the exact output HTTP protocol

Build the endpoint around an acquired OutputStore lease. Resolve all errors that can be known before headers, perform the first required read before headers, acknowledge the requested offset exactly, stream only committed bytes, follow active output, and release every resource. Return `416` for an offset above the committed boundary. If an error occurs after raw headers, destroy the response for every error type.

The milestone is complete when endpoint tests cover authentication, canonical offsets, `416`, initial reads, active following, clean empty EOF, terminal errors before and after headers, short reads, backpressure, aborts, and resource release.

### Milestone 5: Implement the runner reconnect and archive state machine

Make the archive path mandatory and safe before POST. Install signal and workflow-command handling before remote work. Consume raw responses from the confirmed offset, write archive then guarded stdout then advance the offset, and separate transient output transport failures from every fatal response or local failure. Continue transient recovery even after terminal job status until output completion is proven. Publish the archive atomically and only after clean EOF, then update `$GITHUB_OUTPUT` only for a completed job.

The milestone is complete when runner tests cover reconnect while active and terminal, exact offset progression, idle timeout, redirects, protocol failures, workflow-command-looking bytes, invalid UTF-8, stdout failure, archive failure, signals, failed-job diagnostic archives, output-error archive absence, and finalization ordering.

### Milestone 6: Complete documentation and whole-tree validation

Update only the three operator documents, add local full-flow tests, run focused tests and the complete repository checks, verify protected files are unchanged, and update the living sections of this plan with exact evidence. Do not move the plan to `completed`; the runner or human reviewer handles repository publication after Codex exits.

The milestone is complete when all unchecked Progress items are checked with evidence, `npm run check` and `git diff --check` pass, protected files match the reviewed snapshot, `Outcomes & Retrospective` reflects the implemented result, and the final revision note records the implementation evidence.

## Concrete Steps

Run all commands from the repository root. Do not run container-runtime commands or Git mutation commands.

Verify the immutable baseline before editing:

    test "$(git rev-parse origin/main)" = "f043af2fa9eb0420a0d64684485700f92a5dc425"
    git merge-base --is-ancestor f043af2fa9eb0420a0d64684485700f92a5dc425 HEAD
    git diff --exit-code 215c032905ad4fe962125b7fdc822ee4a4a7c56a -- AGENTS.md .agent/PLANS.md .github/workflows examples/github-actions
    test "$(git hash-object .agent/PLANS.md)" = "15d9583b1df0663488d55e4fdfea1c6154ba85d1"
    test "$(git hash-object AGENTS.md)" = "619e05959c3d94ecefe3b389935645faf8b0e24b"
    test "$(git hash-object .github/workflows/agent-relay.yml)" = "f12025d7b237d9df20070985d43721a370d71bf6"
    test "$(git hash-object examples/github-actions/agent-relay.yml)" = "f12025d7b237d9df20070985d43721a370d71bf6"

Expected result: every command exits 0. Any failure is a blocker and must be recorded before stopping.

Inspect the existing baseline and implementation before editing:

    git status --short
    git diff --name-status f043af2fa9eb0420a0d64684485700f92a5dc425...HEAD
    git show f043af2fa9eb0420a0d64684485700f92a5dc425:src/execution/codex-executor.ts
    git show f043af2fa9eb0420a0d64684485700f92a5dc425:src/application/job-service.ts
    git show f043af2fa9eb0420a0d64684485700f92a5dc425:src/persistence/job-store.ts
    git show f043af2fa9eb0420a0d64684485700f92a5dc425:src/api/server.ts
    git show f043af2fa9eb0420a0d64684485700f92a5dc425:runner/client.mjs
    sed -n '1,280p' src/persistence/output-store.ts
    sed -n '1,280p' src/execution/codex-executor.ts
    sed -n '1,260p' src/application/job-service.ts
    sed -n '1,260p' src/api/server.ts
    sed -n '1,360p' runner/client.mjs

Expected result: the baseline files show the result-free and isolation contracts; the branch files show the incomplete prototype findings documented above.

Implement Milestones 1 through 5 in order. After each milestone, update `Progress`, `Surprises & Discoveries`, `Decision Log` when a decision changes, `Outcomes & Retrospective`, and `Artifacts and Notes`. Do not mark a milestone task complete because code exists; mark it only after its focused tests pass.

Create deterministic focused tests with controlled fake file handles, barriers, local HTTP servers, temporary directories, and fake child processes. Do not rely on arbitrary sleeps to prove ordering or resource release. Expected new focused files are `test/output-store.test.ts`, `test/output-endpoint.integration.test.ts`, and `test/streaming-flow.integration.test.ts`; extending current-main `job-service`, `job-store`, `executor`, `runner-client`, `flow`, `context-boundary`, and packaging tests is also expected.

After building, run at least:

    npm ci
    npm run typecheck
    npm run build
    node --test --experimental-test-coverage dist/test/output-store.test.js
    node --test --experimental-test-coverage dist/test/job-service.test.js
    node --test --experimental-test-coverage dist/test/job-store.test.js
    node --test --experimental-test-coverage dist/test/executor.integration.test.js
    node --test --experimental-test-coverage dist/test/output-endpoint.integration.test.js
    node --test --experimental-test-coverage dist/test/runner-client.test.js
    node --test --experimental-test-coverage dist/test/streaming-flow.integration.test.js
    node --test --experimental-test-coverage dist/test/flow.integration.test.js
    node --test --experimental-test-coverage dist/test/context-boundary.test.js
    node --test --experimental-test-coverage dist/test/packaging.test.js

Expected result: every command exits 0 and reports zero failed tests. If Codex chooses different new test filenames, it must update this section before running them and preserve the same scenario coverage.

Run complete validation:

    npm run check
    git diff --check
    ! git grep -n 'StreamingRedactor' -- src/execution/codex-executor.ts
    ! git grep -n 'OUTPUT TRUNCATED' -- src runner test README.md docs/operations
    ! git grep -n 'danger-full-access\|resultPath\|reviewFindings\|AGENT_RELAY_MODE\|\.agent-relay/result\.json' -- src runner test README.md docs/operations
    git grep -n 'X-Agent-Relay-Output-Offset' -- src runner test README.md docs/operations
    git grep -n 'X-Agent-Relay-Committed-Length' -- src runner test README.md docs/operations
    git grep -n 'committedLength' -- src test
    git diff --exit-code 215c032905ad4fe962125b7fdc822ee4a4a7c56a -- AGENTS.md .agent/PLANS.md .github/workflows examples/github-actions

Expected result: `npm run check` and `git diff --check` exit 0; prohibited searches find nothing; required protocol searches find implementation, tests, and documentation; protected files have no diff.

## Validation and Acceptance

Acceptance is based on observable behavior and deterministic working-tree evidence, not on code presence, resolved review comments, a future commit SHA, GitHub checks, or remote mergeability.

A successful full-flow test starts Relay with temporary state, starts the runner against it, and launches a fake child. The child emits binary stdout, stderr, invalid UTF-8, secret-looking bytes, and a workflow-command-looking line in a controlled callback sequence. The runner observes guarded bytes before child exit. One output-body transport failure occurs while the job is active or after it becomes terminal. The runner reconnects from the exact confirmed offset. Relay replay and the final archive equal the original callback-order byte sequence with no gap, duplicate, decoding, redaction, or marker. The final archive path does not exist before terminal clean EOF, sync, close, and atomic rename.

A restart-recovery test writes a physical suffix after the last checkpoint and terminates Relay while the job is active. On restart, Relay validates the checkpoint, truncates only that uncommitted suffix under exclusive recovery ownership, saves the job as interrupted, publishes `OUTPUT_INTERRUPTED`, exposes the committed prefix diagnostically, never publishes clean EOF, and never creates missing historical data. A separate corrupt historical job returns an integrity error without preventing another job or the service from operating.

A terminal-ordering test blocks terminal job persistence after the writer is finalized. No clean EOF is visible while the job remains active. If terminal job persistence fails, output ends in `OUTPUT_TERMINAL_STATE_FAILED`. For zero exit, non-zero exit, timeout, and spawn failure with healthy output, the durable job record precedes a matching clean output terminal state. Interrupted and output-infrastructure failures never publish clean output.

A local-sink failure test fails guarded runner stdout after a chunk is fully written to the temporary archive but before confirmed-offset advancement. The runner fails without reconnecting, removes the attempt-owned temporary archive, leaves the final archive absent, does not duplicate the chunk, restores workflow-command parsing when possible, and does not modify `$GITHUB_OUTPUT`.

Persistence tests demonstrate atomic initial prepare, complete writes, append ordering, checkpoint replacement, hard-limit rejection of the entire overflowing chunk, byte-bounded queues, writer finalization, first-terminal-wins, process-restart recovery, missing and malformed data errors, single-flight attachment, short-lived readers, file and directory modes, waiter release, state eviction, service-start isolation, and exhaustive ownership-safe compensation.

Endpoint tests demonstrate authentication, canonical offset validation, `416` with `X-Agent-Relay-Committed-Length`, successful `200 application/octet-stream` with exact `X-Agent-Relay-Output-Offset`, `Cache-Control: no-store, no-transform`, `X-Content-Type-Options: nosniff`, absent or identity content encoding, first-read-before-headers, active following, strict short-read detection, clean empty EOF, pre-header JSON errors, post-header transport destruction for every error, backpressure, abort handling, and lease release.

Runner tests demonstrate mandatory safe archive preflight, bounded JSON and 8192-byte output diagnostics, redirect rejection, exact protocol validation, acquisition and idle timeouts, transient reconnect while active and terminal, no reconnect after explicit or local failure, archive-before-stdout-before-offset ordering, exact poll interval, bounded retained presentation state, workflow-command isolation, signal cleanup, failed-job diagnostic archive preservation, output-error archive absence, and `$GITHUB_OUTPUT` mutation only after complete output and a `completed` job.

The implementation is complete when every unchecked Progress item is checked with working-tree evidence, all focused and full-flow tests pass, `npm run check` and `git diff --check` pass, protected files are unchanged, the operator documentation matches behavior, and the living sections and final revision note are current.

## Idempotence and Recovery

Tests use only temporary repositories, state directories, output files, checkpoints, archive paths, local HTTP servers, and fake child processes. Repeated test runs must not modify operator state.

A matching request ID returns the existing job. A failed creation attempt independently removes only its prepared output, checkpoint, job record, and request mapping. Request-index deletion is compare-delete against the expected job ID. Every failed compensation is attempted and reflected in `JOB_PREPARATION_FAILED` diagnostics without exposing private paths publicly.

The checkpoint advances monotonically by same-directory atomic replacement. Interrupted recovery may remove only bytes beyond `committedLength` for a formerly active job under exclusive recovery ownership. Historical terminal replay never creates, repairs, truncates, or silently modifies output.

The runner removes only the stale final archive selected for the current attempt and its unique temporary sibling. Signals, output errors, local failures, and repeated startup leave no final partial artifact. Streaming code does not duplicate or bypass finalizer push recovery.

## Artifacts and Notes

Keep the validation evidence below append-only:

- 2026-07-15 - Review of restored implementation - identified nine original and seven additional defects; no implementation test was claimed as passing.
- 2026-07-15 - GitHub review threads - all nine migrated threads resolved; implementation items remained unchecked.
- 2026-07-15 - Head `d6b706fc0da51c6b151e55eb62de141a74bf2e92` - zero associated workflow runs and zero combined status contexts at that time.
- 2026-07-15 - Plan-only revisions - no code tests run because only the active plan changed.
- 2026-07-15 - Revision `973ee1ff56f3d45be9526325d9b8056e2cc62b8c` - history and status improved, but formal comparison later found checklists outside `Progress`, bureaucratic milestones, and no final revision note.
- 2026-07-15 - Revision `21587cf36f2c82c678e9e1d7c2a41f418e74367b` - structure improved, but `.agent/PLANS.md` was wrongly classified as legacy, reconciliation was under-specified, and post-commit GitHub gates were assigned to Codex.
- 2026-07-15 21:06Z - Instruction correction `c76cbcc4fb353d8a9b737bbfb5006a77e51d35ac` - verified `.agent/PLANS.md` blob `15d9583b1df0663488d55e4fdfea1c6154ba85d1`; updated `AGENTS.md` with the exact article block and engineering rules.
- 2026-07-15 21:06Z - Workflow corrections `b967b14f4753f5a3b82d529ed72c254e0aec9675` and `4a058cf06cbadcd81cf9e4c42ad4d7cedd1b00cc` - preserved credential, active-plan, and finalizer boundaries and added terminal archive and console-log paths.
- 2026-07-15 21:30Z - Merge and reconciliation baseline - merged `main` `f043af2fa9eb0420a0d64684485700f92a5dc425`; branch comparison later reported zero commits behind.
- 2026-07-15 22:23Z - GitHub Actions run `29455214780` on head `215c032905ad4fe962125b7fdc822ee4a4a7c56a` - `npm run check` passed; 86 tests passed, zero failed. This evidence validates the baseline only.
- 2026-07-16 - Plan readiness review - found and corrected dynamic baseline scope, workflow ownership gaps, raw/redaction conflict, terminal ordering ambiguity, retry-after-terminal gap, optional archive behavior, stale branch description, and non-verifiable milestones. No production code changed in this review.

Append implementation evidence in this form:

    YYYY-MM-DD HH:MMZ - <command or test> - <working-tree baseline> - exit <code> - <exact result>

## Interfaces and Dependencies

Do not add an external runtime dependency. Use Node.js built-ins. Extend local type declarations only where the repository's existing shims do not expose a required built-in API.

The public request remains unchanged:

    interface CreateJobRequest {
      requestId: string;
      workspace: string;
      planPath: string;
    }

Public job statuses remain unchanged:

    type JobStatus =
      | "accepted"
      | "running"
      | "completed"
      | "failed"
      | "timed_out"
      | "interrupted";

Clean output is narrower than JobStatus:

    type CleanOutputJobStatus = "completed" | "failed" | "timed_out";

The private checkpoint is stored at `${outputPath}.checkpoint.json` and is equivalent to:

    interface OutputCheckpoint {
      schemaVersion: 1;
      jobId: string;
      committedLength: number;
      terminal?:
        | { kind: "clean"; jobStatus: CleanOutputJobStatus }
        | {
            kind: "error";
            code:
              | "OUTPUT_WRITE_FAILED"
              | "OUTPUT_INTEGRITY_FAILED"
              | "OUTPUT_LIMIT_EXCEEDED"
              | "OUTPUT_INTERRUPTED"
              | "OUTPUT_TERMINAL_STATE_FAILED";
          };
    }

`committedLength` must be a non-negative safe integer no larger than physical output size. Checkpoint JSON, output files, and temporary files use mode `0600`. Private directories created by this feature use mode `0700`. Checkpoint replacement uses a unique same-directory temporary file and atomic rename. A persistent generation counter is not required; an in-memory version may coordinate waiters.

The internal error union must include at least:

    "OUTPUT_PREPARATION_FAILED"
    "OUTPUT_WRITE_FAILED"
    "OUTPUT_READ_FAILED"
    "OUTPUT_OFFSET_OUT_OF_RANGE"
    "OUTPUT_INTEGRITY_FAILED"
    "OUTPUT_LIMIT_EXCEEDED"
    "OUTPUT_INTERRUPTED"
    "OUTPUT_TERMINAL_STATE_FAILED"

`OUTPUT_OFFSET_OUT_OF_RANGE` maps to HTTP 416 and includes `X-Agent-Relay-Committed-Length`. `OUTPUT_LIMIT_EXCEEDED` maps to 413. `OUTPUT_INTERRUPTED` maps to 409 when returned before raw headers. Other output infrastructure errors map to 500. Public messages are fixed and contain no private path or raw internal error.

OutputStore must provide operations equivalent to:

    prepare(jobId: string, outputPath: string): Promise<void>
    append(jobId: string, chunk: Uint8Array): Promise<void>
    finalizeWriter(jobId: string): Promise<void>
    publishClean(jobId: string, jobStatus: CleanOutputJobStatus): Promise<void>
    publishError(jobId: string, code: OutputTerminalErrorCode): Promise<void>
    recoverInterrupted(record: JobRecord): Promise<void>
    acquire(record: JobRecord): Promise<OutputLease>
    peek(lease: OutputLease): OutputSnapshot
    read(lease: OutputLease, offset: number, maxBytes?: number): Promise<Uint8Array>
    waitForChange(lease: OutputLease, observedVersion: number, signal?: AbortSignal): Promise<OutputSnapshot>
    release(lease: OutputLease): Promise<void>
    discard(jobId: string): Promise<void>
    close(): Promise<void>

Names may differ, but ownership, ordering, durability, single-flight attachment, first-terminal-wins, and resource behavior may not.

The executor process outcome is equivalent to:

    interface ExecutionOutcome {
      exitCode: number | null;
      timedOut: boolean;
    }

The executor returns this outcome only after writer finalization. A non-zero exit and timeout are process outcomes, not output errors. Spawn failure may throw `CODEX_FAILED` after finalizing the empty prepared writer. Output infrastructure failures throw their output code after finalization.

The authenticated output route is:

    GET /v1/jobs/{jobId}/output?offset={canonicalNonNegativeSafeInteger}
    Authorization: Bearer <AGENT_RELAY_TOKEN>
    Accept: application/octet-stream
    Accept-Encoding: identity

A successful response is exactly HTTP 200 with `Content-Type: application/octet-stream`, `Cache-Control: no-store, no-transform`, `X-Content-Type-Options: nosniff`, and `X-Agent-Relay-Output-Offset` equal to the requested decimal offset. Content encoding is absent or `identity`. The response contains authoritative raw bytes only.

The runner uses existing timeout settings and these fixed internal bounds:

    MAX_RESPONSE_BYTES = 64000
    MAX_REMOTE_ERROR_BODY_BYTES = 8192

`MAX_REMOTE_ERROR_BODY_BYTES` is an internal constant, not a new environment variable. `AGENT_RELAY_OUTPUT_ARCHIVE_PATH` is required, absolute, and outside `GITHUB_WORKSPACE`. The final path means an atomically published complete terminal stream, never a live partial file.

Revision note (2026-07-16): Re-reviewed the current PR and active plan after the `main` merge and green baseline CI. Pinned the reviewed `main` SHA and protected files; explicitly overrode generic Git mutation advice; removed stale full-branch reconciliation work; narrowed Codex-owned files; resolved raw output versus redaction; defined the checkpoint layout, output error taxonomy, process and output terminal ordering, interrupted recovery, and clean diagnostic output; corrected retry eligibility after terminal job status; made archive production mandatory and safe; distinguished Relay best-effort presentation from required runner sinks; added six observable milestones, exact validation commands, and deterministic full-flow acceptance. This revision changes only the active ExecPlan and does not claim the feature implementation complete.
