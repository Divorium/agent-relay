# Add restart-safe raw Codex output streaming without regressing isolation

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current as work proceeds. Maintain this document in accordance with `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

Every repository change required by this pull request must first be described here. Codex must not run commands that create, rewrite, or publish commits. The GitHub runner owns commit and push.

## Purpose / Big Picture

After this work, an operator can watch the exact standard output and standard error produced by Codex while a job is still running, reconnect after a temporary interruption from an exact byte position, and receive a byte-identical terminal archive after Relay has finalized the stream.

Relay stores the authoritative byte stream in its private state directory. Console output and GitHub-visible output are presentation copies only: their slowness or failure must not reorder, invent, truncate, or invalidate persisted bytes. Raw output is intentionally unredacted and sensitive. `MAX_OUTPUT_BYTES` remains a hard storage limit; reaching it fails the job and output stream rather than reporting successful truncation.

The change must preserve the current `main` architecture. Codex remains isolated from Relay and runner internals, receives only the approved environment and workspace access, and does not create a result artifact or decide whether a commit is needed. Relay derives the technical job result from the child process. The runner derives the commit subject from this active plan. The finalizer remains the only component that decides whether repository changes are publishable.

## Progress

Keep this section append-only for completed historical entries. Split partially completed work into a completed entry and a remaining unchecked entry. A checked item must identify either a repository location plus a passing automated test, or a reproducible command plus its captured result.

- [x] (2026-07-13 23:33Z) Created the original raw-output ExecPlan and opened PR #3.
- [x] (2026-07-14, initial prototype) Added a first prototype covering output persistence, an output endpoint, executor mirroring, runner streaming, workflow artifact handling, configuration, documentation, and tests. The prototype remains unaccepted and does not count as completed implementation.
- [x] (2026-07-14 21:50Z) Reviewed the prototype and recorded nine actionable defects in inline review threads.
- [x] (2026-07-15 00:42Z) Compared the branch with the architecture introduced by PR #9 and found that the branch restores contracts removed from current `main`.
- [x] (2026-07-15, correction) Restored the prototype at commit `32edacbac00be64a1b5674af2c0c81255c2c72bd` after an incorrect temporary plan-only rewrite.
- [x] (2026-07-15 21:00Z) Recorded seven additional defects: no durable active-job checkpoint, unbounded replay resources, no positive offset acknowledgement, duplicate replay after local sink failure, ignored configured poll interval, incomplete drain failure handling, and short-read spin risk.
- [x] (2026-07-15, plan revision `767e21feb7441f19b1623d1efd3a577d439ad80f`) Added restart-safe persistence, exact protocol, retry, resource-lifecycle, and deterministic test requirements to this plan.
- [x] (2026-07-15, plan revision `d6b706fc0da51c6b151e55eb62de141a74bf2e92`) Removed container execution from acceptance. Dockerfiles and `compose.yml` remain subject only to static source validation.
- [x] (2026-07-15) Migrated the complete substance of all nine inline findings into this plan and resolved all nine GitHub review threads. Resolving discussion threads did not complete the implementation work.
- [x] (2026-07-15, plan revision `973ee1ff56f3d45be9526325d9b8056e2cc62b8c`) Restored historical entries and separated completed review work from incomplete implementation work, but used checklists outside `Progress` and therefore did not conform to the repository ExecPlan template.
- [x] (2026-07-15, this revision) Compared the active plan with the actual `## Skeleton of a Good ExecPlan` in the branch version of `.agent/PLANS.md`. Removed checklists from narrative sections, restored prose-first milestones, added observable validation expectations, and added this required revision note at the end.

- [ ] Reconcile every changed implementation file with then-current `main`, retaining only streaming-specific changes compatible with the current architecture.
- [ ] Restore `.agent/PLANS.md` from then-current `main`; remove the legacy full-template version and its contradictory instruction to commit frequently.
- [ ] Preserve the current-main agent prompt, request shape, process-derived status, plan-derived commit subject, public DTO filtering, finalizer ownership, credential scope, launcher, environment, workspace boundary, Git metadata boundary, and private runtime directory.
- [ ] Remove obsolete execution modes, review findings, `blocked`, `resultPath`, `.agent-relay/result.json`, model validation, model commit messages, configurable launcher or user, `danger-full-access`, inherited environment, runner-service Relay token, and writable full Codex-home mount.
- [ ] Implement a durable per-job output checkpoint containing committed length, generation, and terminal facts.
- [ ] Serialize appends and commit bytes only after complete write, data sync, and atomic checkpoint replacement.
- [ ] Enforce `MAX_OUTPUT_BYTES` before accepting a chunk and publish `OUTPUT_LIMIT_EXCEEDED` without clean EOF or a textual truncation marker.
- [ ] Finalize writers by sealing appends, draining queued writes, syncing, attempting close on every path, clearing the writer handle, and persisting matching checkpoint and job terminal metadata before clean EOF.
- [ ] Recover interrupted jobs from the checkpoint rather than file size, remove only an uncommitted suffix owned by interrupted recovery, and treat missing or inconsistent historical data as an integrity error.
- [ ] Use bounded replay state, short-lived read handles or reference-counted leases, and release writers, readers, waiters, and terminal state on success, failure, and abort.
- [ ] Make job creation rollback exhaustive and ownership-safe: independently discard output state, remove the created job, compare-delete only the owned request mapping, preserve foreign mappings, and report incomplete cleanup.
- [ ] Persist every executor chunk before mirroring it, use byte-bounded buffering, and handle mirror backpressure, error, close, destroyed state, and listener cleanup without changing authoritative output.
- [ ] Add the authenticated output endpoint with canonical decimal offsets, exact offset acknowledgement, identity transfer, deterministic pre-header JSON errors, and transport destruction for every post-header error.
- [ ] Make endpoint reads fail on short or zero progress before the committed boundary and release all waiters and reader resources after completion, failure, or abort.
- [ ] Make runner preflight validate the selected active plan, derive the commit subject from it, and prepare a same-directory temporary archive before job submission.
- [ ] Reject redirects, explicit HTTP failures, missing bodies, media-type mismatches, content-encoding mismatches, and offset mismatches without reconnecting; bound diagnostic bodies to 8192 bytes.
- [ ] Retry only transient remote acquisition, accepted-body, idle, or premature-EOF failures while the job remains nonterminal. Never reconnect after a local archive, tail, stdout, workflow-command, polling, or finalization failure.
- [ ] Advance the confirmed remote offset only after all required local handling succeeds and prove reconnects contain no gaps or duplicates.
- [ ] Honor `AGENT_RELAY_POLL_INTERVAL_MS` without a hidden one-second cap and handle every stream write through `drain`, `error`, `close`, destroyed-state, and listener-cleanup paths.
- [ ] Keep GitHub workflow-command-looking bytes inert without modifying archive bytes or remote offsets.
- [ ] Publish the final archive only after terminal EOF, successful sync, successful close, and atomic rename; leave the final path absent after incomplete output or finalization failure.
- [ ] Complete common runner finalization before structured success or `$GITHUB_OUTPUT` mutation.
- [ ] Reconcile workflows, examples, environment examples, Dockerfiles, `compose.yml`, server bootstrap, wrapper scripts, README, and operations documentation with current `main` and the final streaming behavior.
- [ ] Validate Dockerfiles and `compose.yml` only through source comparison and deterministic source assertions; do not add container-runtime commands or tests.
- [ ] Add deterministic tests for persistence, job-service rollback, executor ordering and backpressure, endpoint protocol and resource release, runner retry and finalization, full-flow success, crash recovery, and local-sink failure.
- [ ] Run focused tests on the exact implementation head and record commands, counts, coverage, and failures in `Artifacts and Notes`.
- [ ] Run `npm run check` and `git diff --check` on the exact implementation head and record the results.
- [ ] Compare the final diff with then-current `main`, record the final main and head SHAs, obtain all available required non-container checks for that head, perform final review, and make the PR mergeable.

## Surprises & Discoveries

- Observation: the branch version of `.agent/PLANS.md` is not the current-main rules file.
  Evidence: it contains the full article text, the `## Skeleton of a Good ExecPlan` example, and an instruction to commit frequently, while current `main` contains a short repository-specific rules file.

- Observation: `## Skeleton of a Good ExecPlan` is not part of the active plan.
  Evidence: it appears in `.agent/PLANS.md` as an indented authoring example. It is guidance for constructing an ExecPlan and must not be copied into the task plan as implementation content.

- Observation: the previous plan revision violated the same template it claimed to follow.
  Evidence: `.agent/PLANS.md` permits checklists only in `Progress` and requires prose-first milestones, but the previous active plan placed extensive checkbox lists in every milestone and in `Validation and Acceptance`.

- Observation: the first prototype opens the configured final archive path directly.
  Evidence: timeout, cancellation, disconnect, or crash can leave a partial file at the path uploaded under `if: always()`.

- Observation: explicit HTTP responses are grouped with reconnectable transport failures.
  Evidence: non-200 responses can be retried until the global timeout and their complete diagnostic bodies can be buffered.

- Observation: runner success can be published before output finalization.
  Evidence: `$GITHUB_OUTPUT` can be mutated before archive sync and close, and an early return can bypass a finalization failure.

- Observation: restart attachment can fabricate a missing output file.
  Evidence: missing persisted output can become a clean empty replay rather than an integrity failure.

- Observation: clean EOF can be published before the writable output handle is synced and closed.
  Evidence: the prototype retains writable descriptors and allows terminal visibility before durable writer finalization.

- Observation: post-header endpoint failures are not handled uniformly.
  Evidence: some errors can fall through to JSON after raw headers.

- Observation: presentation precedes authoritative persistence.
  Evidence: process stdout is written before `OutputStore.append()`, and mirror backpressure is ignored.

- Observation: creation rollback is not ownership-safe or exhaustive.
  Evidence: cleanup failures are suppressed and request mappings can be removed without comparing the expected job ID.

- Observation: active-job restart correctness cannot be recovered from physical file size.
  Evidence: a crash during a positional write can leave a physical suffix beyond the last fully accepted byte without a durable committed-length boundary.

- Observation: terminal replay resources can grow without bound.
  Evidence: the prototype retains writable handles and state-map entries until process shutdown.

- Observation: the output protocol lacks positive offset acknowledgement.
  Evidence: the runner requests `?offset=N`, but a successful response does not prove that its first body byte is byte `N`.

- Observation: local sink failures can enter reconnect handling.
  Evidence: replay can duplicate a chunk whose archive or presentation side effect already occurred.

- Observation: `AGENT_RELAY_POLL_INTERVAL_MS` is not honored above one second.
  Evidence: reconnect sleep uses `Math.min(pollIntervalMs, 1000)`.

- Observation: drain waits omit complete error and close handling.
  Evidence: a failed stream can leave a promise pending or produce an unhandled failure.

- Observation: committed reads can make partial or zero progress.
  Evidence: a file shortened after validation can produce a short response and a zero-read loop rather than `OUTPUT_READ_FAILED`.

- Observation: resolving review discussions is not implementation evidence.
  Evidence: all nine requirements are maintained here and their discussions are resolved, but the corresponding code repairs and tests remain unchecked in `Progress`.

## Decision Log

- Decision: implement live raw stdout and stderr streaming through Relay, the runner, and a terminal archive.
  Rationale: operators need live visibility and an exact terminal record.
  Date/Author: 2026-07-13 / original plan.

- Decision: current `main` after PR #9 is the mandatory implementation baseline.
  Rationale: raw streaming is additive observability and does not justify restoring removed control, credential, or execution mechanisms.
  Date/Author: 2026-07-15 / PR review.

- Decision: the selected active plan is the sole task authority.
  Rationale: PR comments, completed plans, review arrays, and duplicated prompt prose must not become competing instructions.
  Date/Author: 2026-07-15 / user requirement and PR review.

- Decision: preserve and repair the restored implementation rather than converting the pull request into a plan-only change.
  Rationale: every repository change must be described in the active plan; that does not mean the implementation should be removed.
  Date/Author: 2026-07-15 / user correction.

- Decision: review threads may be resolved after their complete requirements are transferred into this plan.
  Rationale: Codex follows this plan rather than PR discussions. Incomplete implementation remains represented by unchecked `Progress` items.
  Date/Author: 2026-07-15 / user correction.

- Decision: restore `.agent/PLANS.md` from then-current `main` during implementation.
  Rationale: the branch version is a legacy full template, contains a contradictory commit instruction, and is not the current repository contract.
  Date/Author: 2026-07-15 / template comparison.

- Decision: use the repository skeleton as structure guidance, not as content to copy into the active plan.
  Rationale: the skeleton explains required sections; it is not a milestone or task requirement.
  Date/Author: 2026-07-15 / template comparison.

- Decision: checklists are restricted to `Progress`; milestones and acceptance remain prose-first.
  Rationale: this is required by `.agent/PLANS.md` and makes the distinction between work status and implementation narrative unambiguous.
  Date/Author: 2026-07-15 / template comparison.

- Decision: validate Dockerfiles and Compose statically only.
  Rationale: container execution is not part of the available validation path and cannot become a merge condition.
  Date/Author: 2026-07-15 / user correction.

- Decision: a byte becomes committed only after complete write, data sync, and atomic checkpoint persistence.
  Rationale: readers may acknowledge only bytes reconstructable after restart.
  Date/Author: 2026-07-15 / PR review.

- Decision: output checkpoints are authoritative for output progress and terminal facts; terminal job metadata must agree with them.
  Rationale: missing or mismatched persisted state is an integrity error, never a reason to infer success from file size or process status.
  Date/Author: 2026-07-15 / PR review.

- Decision: authoritative persistence precedes every presentation sink.
  Rationale: presentation cannot reorder, invent, or invalidate authoritative bytes.
  Date/Author: 2026-07-15 / PR review.

- Decision: each successful output response acknowledges its exact starting offset.
  Rationale: the runner cannot prove duplicate-free and gap-free replay from status and media type alone.
  Date/Author: 2026-07-15 / PR review.

- Decision: redirects and explicit HTTP or protocol failures are fatal and non-retryable.
  Rationale: reconnect applies only to transient remote acquisition or body failures while the job remains nonterminal.
  Date/Author: 2026-07-15 / PR review.

- Decision: local sink failures never reconnect.
  Rationale: local side effects may already have occurred, so replaying the same offset can duplicate bytes.
  Date/Author: 2026-07-15 / PR review.

- Decision: the final archive path denotes only an atomically published complete terminal stream.
  Rationale: incomplete transport or local finalization must leave no final artifact.
  Date/Author: 2026-07-15 / PR review.

## Outcomes & Retrospective

This plan remains active and the implementation is not complete.

The feature purpose, prototype history, nine original review findings, seven additional findings, branch-restoration correction, and subsequent plan revisions are preserved. All nine inline discussions are resolved because their full requirements are maintained in this document. No resolved discussion is treated as proof that code is fixed.

The current branch still contains an unaccepted prototype built partly against an obsolete architecture. Current-main reconciliation, durable persistence, exact restart recovery, bounded resources, endpoint correctness, runner retry and archive behavior, deterministic tests, exact-head validation, and mergeability remain incomplete.

The previous plan review improved status visibility but did not follow the actual skeleton. This revision corrects the document structure only. It does not claim any implementation test or code repair.

## Context and Orientation

Agent Relay runs a Codex child process for a selected repository workspace. `src/execution/codex-executor.ts` launches the child and receives stdout and stderr callbacks. In this plan, a presentation sink is any non-authoritative copy of output, such as process stdout or GitHub logs.

`src/persistence/output-store.ts` owns authoritative output bytes and live replay state. A committed byte is a byte that has been completely written, synced to storage, and included in an atomically persisted checkpoint. The checkpoint is a small per-job metadata file, for example `logs/<jobId>.meta.json`, that records the last durable byte length, a monotonic generation, and terminal facts. Physical output-file size alone is not authoritative.

`src/application/job-service.ts` owns job creation, one-active-job admission, execution, terminal persistence, restart handling, and rollback. `src/persistence/job-store.ts` owns job records and the request-ID index. Compare-delete means removing a request-ID mapping only if it still points to the exact job created by the failing attempt.

`src/api/server.ts` exposes authenticated HTTP APIs. The new output route is `GET /v1/jobs/{jobId}/output?offset=N`, where `N` is a non-negative safe integer byte position. A pre-header failure happens before raw response headers are sent and may use the normal JSON error envelope. A post-header failure happens after raw headers are sent and must destroy the transport instead of changing representation to JSON.

`runner/client.mjs` validates the selected active plan, derives the commit subject, submits and polls jobs, consumes the byte stream, prints a bounded live view, writes a complete archive, and updates `$GITHUB_OUTPUT` only after successful common finalization. Confirmed offset means the count of remote bytes whose required local handling has completed successfully.

Workflows, `.env.example`, Dockerfiles, `compose.yml`, `scripts/codex-run`, `src/server.ts`, README, and `docs/operations/README.md` describe packaging, credential scope, configuration, and operator behavior. Dockerfiles and Compose are source configuration in this task; they are not executed.

The branch version of `.agent/PLANS.md` is legacy. It contains the full generic template, including `## Skeleton of a Good ExecPlan`, and instructs the agent to commit frequently. The current-main file is a shorter repository-specific contract. Milestone 0 restores the current-main file before relying on it as the final agent instruction.

## Plan of Work

First reconcile the branch with then-current `main`. For each file changed both by this pull request and by PR #9, start from the current-main version and reapply only the raw-streaming behavior described here. Restore the current-main `.agent/PLANS.md`, prompt, request contract, process-owned statuses, finalizer ownership, credential boundaries, launcher, environment, workspace permissions, and public response filtering. Remove all obsolete result, mode, blocker, model-validation, model-commit, inherited-environment, and broad credential or filesystem behavior. This milestone ends when the branch contains the current architecture plus only additive streaming changes and GitHub can compute a conflict-free merge.

Next rebuild output persistence around a durable checkpoint. `src/persistence/output-store.ts` must serialize stdout and stderr chunks in callback order, write complete batches, sync data, atomically persist the new committed length, and notify append callers and readers only after that checkpoint succeeds. Writer finalization must seal new appends, drain pending work, sync, close, and persist matching terminal facts before clean EOF. Restart recovery must use the checkpoint, never file size, and may remove an uncommitted suffix only for the interrupted active job under exclusive ownership. Historical reads must never create or repair missing data. Replay handles, waiters, leases, and terminal state must be bounded and released. `src/application/job-service.ts` must perform every rollback independently and preserve mappings it does not own.

Then update `src/execution/codex-executor.ts`. Both child streams feed a byte-accounted FIFO with explicit high and low watermarks. The executor persists a chunk before mirroring it. Presentation backpressure, closure, or failure may disable that sink but cannot reorder or fail authoritative output. Completion waits for child close, both child streams to end, queued output to drain, checkpoint work to finish, and writer finalization to complete.

After persistence is reliable, implement the output protocol in `src/api/server.ts`. Validate authentication, job ID, and the canonical decimal offset before selecting the raw representation. Validate the checkpoint and perform the first required read or terminal snapshot before flushing headers. Successful responses use `application/octet-stream`, identity encoding, `no-store, no-transform`, and an exact `X-Agent-Relay-Output-Offset` acknowledgement. Short or zero-progress reads before the committed boundary are failures. Every error after raw headers destroys the response and releases all resources.

Extend the current-main runner rather than the obsolete prototype control flow. Perform all fatal preflight and archive preparation before job submission. Stream into a unique same-directory temporary archive, validate every successful response and acknowledged offset, and separate transient remote failures from fatal local failures. Advance the confirmed offset only after required local handling succeeds. Bound the visible prefix and tail, neutralize GitHub workflow commands without modifying archive bytes, honor the configured poll interval, and handle every writable-stream terminal state. After confirmed terminal EOF, sync and close the temporary archive and atomically rename it. Common finalization must finish before success or `$GITHUB_OUTPUT` mutation.

Finally reconcile workflow files, static packaging declarations, configuration, README, and operations documentation with current `main` and the final implementation. Add deterministic local tests for each failure boundary and three full-flow scenarios: successful live output with one reconnect, Relay crash after an uncommitted physical suffix, and local presentation failure after an archive side effect. Complete exact-head validation and final review only after all remaining `Progress` items have repository evidence.

## Concrete Steps

Run all commands from the repository root. Do not run commands that create, rewrite, or publish commits. Do not run container-runtime commands.

Inspect the authoritative current-main contracts before editing:

    git show origin/main:.agent/PLANS.md
    git show origin/main:runner/client.mjs
    git show origin/main:src/execution/codex-executor.ts
    git show origin/main:src/application/job-service.ts
    git show origin/main:src/api/server.ts
    git show origin/main:compose.yml

Expected result: each command prints the current-main file and exits with status 0. Record the exact `origin/main` SHA used for reconciliation.

During implementation, compile and run focused tests:

    npm ci
    npm run typecheck
    npm run build
    node --test --experimental-test-coverage dist/test/contracts.test.js
    node --test --experimental-test-coverage dist/test/executor.integration.test.js
    node --test --experimental-test-coverage dist/test/integration.test.js
    node --test --experimental-test-coverage dist/test/runner-client.test.js
    node --test --experimental-test-coverage dist/test/flow.integration.test.js

Expected result: every command exits 0; each Node test command reports zero failed tests. Record exact test counts and coverage in `Artifacts and Notes`. A failing command leaves the corresponding `Progress` item unchecked and records the failure evidence.

Run complete repository validation:

    npm run check
    git diff --check

Expected result: `npm run check` exits 0 with zero failed tests, and `git diff --check` exits 0 without output.

Verify that obsolete contracts did not return:

    ! git grep -n 'danger-full-access'
    ! git grep -n 'shouldCommit\|reviewFindings\|resultPath' -- src runner test .github examples compose.yml README.md docs/operations
    ! git grep -n '\.agent-relay/result\.json' -- src runner test .github examples compose.yml README.md docs/operations
    ! git grep -n 'AGENT_RELAY_MODE' -- src runner test .github examples compose.yml README.md docs/operations
    ! git grep -n 'HOST_CODEX_DIR' -- .env.example compose.yml README.md docs/operations
    ! git grep -n 'AGENT_RELAY_TOKEN: \${AGENT_RELAY_TOKEN}' -- compose.yml
    grep -F 'HOST_CODEX_AUTH_FILE' .env.example compose.yml README.md docs/operations/README.md
    grep -F '/home/agent/.codex/auth.json:ro' compose.yml
    grep -F '/usr/local/bin/codex-run' src/server.ts

Expected result: every negated search exits successfully because it finds no obsolete contract; every positive search prints the approved declaration.

Verify output protocol and persistence declarations:

    git grep -n 'application/octet-stream' -- src runner test README.md docs/operations
    git grep -n 'Accept-Encoding' -- runner test
    git grep -n 'no-transform' -- src test
    git grep -n 'X-Agent-Relay-Output-Offset' -- src runner test README.md docs/operations
    git grep -n 'committedLength' -- src test
    git grep -n 'MAX_OUTPUT_BYTES' -- .env.example compose.yml src test README.md docs/operations

Expected result: every search prints implementation, test, and documentation references consistent with the final behavior.

After each stopping point, update only `Progress`, the relevant discovery or decision entry, `Outcomes & Retrospective`, and the validation evidence log. If work is blocked, leave its item unchecked, prefix it with `[blocked]`, and record the cause, impact, evidence, and exact unblock condition.

## Validation and Acceptance

Acceptance is based on observable behavior and deterministic evidence, not on the existence of code or resolved review comments.

A local full-flow success test starts Relay with temporary state, starts the runner against it, and launches a fake Codex child. The child emits binary stdout before exit, then stderr and more stdout. The runner observes the first bytes while the child is still running. One accepted-body disconnect occurs, after which the runner reconnects from the acknowledged confirmed offset. The final Relay bytes and final archive bytes are identical to the original callback-order byte sequence, with no gap or duplicate. The final archive path does not exist until terminal EOF, sync, close, and rename have succeeded.

A crash-recovery test stops Relay after a physical write extends beyond the last checkpoint. On restart, Relay exposes only the checkpoint prefix, removes the uncommitted suffix only under interrupted recovery ownership, reports interrupted or error terminal state rather than clean success, and does not produce a final archive or modify `$GITHUB_OUTPUT`.

A local-sink failure test fails GitHub-visible output after a chunk has reached the temporary archive but before offset advancement. The runner fails without reconnecting, removes the temporary archive, leaves the final archive absent, does not duplicate the chunk, and does not modify `$GITHUB_OUTPUT`.

Persistence tests must show serialized callback order, complete-write and sync ordering, atomic checkpoint replacement, output-limit failure, first-terminal-wins behavior, writer closure before EOF, exact restart recovery, missing-data integrity errors, bounded descriptors, bounded state, and complete rollback diagnostics.

Endpoint tests must show normal JSON errors before raw headers, `416` with committed length for a valid offset above the durable boundary, exact offset acknowledgement on every successful response, complete reads up to the committed boundary, transport destruction after every post-header failure, and resource release on completion, error, and client abort.

Runner tests must show fatal classification of redirects and explicit protocol responses, bounded diagnostics, reconnect only for transient remote failures while nonterminal, no reconnect after any local sink failure, exact configured polling cadence, complete drain/error/close handling, bounded retained presentation memory, inert workflow-command-looking output, atomic archive publication, and finalization before success output.

Current-main contract tests and static packaging assertions must show that the branch preserves the approved agent instruction, prompt, request, status, credential, filesystem, launcher, and finalizer boundaries. No image build, container run, Compose execution, live mount inspection, or container health check is an acceptance requirement.

The plan is complete only when every unchecked `Progress` item is checked with evidence, `npm run check` and `git diff --check` pass on the exact final head, all available required non-container checks pass for that same SHA, GitHub reports the PR mergeable, final review finds no mismatch, and no new actionable review thread remains unresolved.

## Idempotence and Recovery

Tests use temporary repositories, state directories, output files, checkpoints, archive paths, local HTTP servers, and local child processes. Repeated test runs must not change operator state.

Job request retries preserve current-main idempotency: a matching request ID returns the existing job. A failed creation attempt deletes only resources it owns and reports incomplete compensation instead of suppressing it.

The output checkpoint advances monotonically. Interrupted recovery may truncate only bytes beyond that checkpoint for the interrupted active job under exclusive ownership. Historical terminal replay never creates, repairs, or silently modifies persisted output.

The runner removes a stale final archive for the current attempt before submission, writes to a unique temporary sibling, and removes only that temporary file on failure. A failed publication after a local commit remains the existing finalizer's responsibility; streaming code does not duplicate or bypass that recovery path.

## Artifacts and Notes

The nine resolved review requirements remain represented by unchecked `Progress` items until implementation evidence exists:

1. Restore runner-owned Git flow and remove contradictory commit instructions.
2. Publish the final archive only through temporary file, sync, close, and atomic rename.
3. Treat explicit HTTP and protocol responses as bounded, fatal, and non-retryable.
4. Complete common finalization before success or `$GITHUB_OUTPUT`.
5. Never fabricate a missing terminal output file.
6. Serialize appends, finalize and close the writer, and separate replay resources before clean EOF.
7. Destroy the transport for every post-header endpoint error and never send JSON afterward.
8. Persist before mirroring and honor mirror backpressure.
9. Attempt every rollback independently and compare-delete only the owned request mapping.

Keep the validation evidence below append-only:

- 2026-07-15 - Review of restored implementation - identified nine original and seven additional defects; no implementation test was claimed as passing.
- 2026-07-15 - GitHub review threads - all nine migrated threads resolved; implementation items remained unchecked.
- 2026-07-15 - Head `d6b706fc0da51c6b151e55eb62de141a74bf2e92` - zero associated workflow runs and zero combined status contexts.
- 2026-07-15 - Plan-only revisions - no code tests run because only the active plan changed.
- 2026-07-15 - Revision `973ee1ff56f3d45be9526325d9b8056e2cc62b8c` - history and status were improved, but formal comparison later found checklists outside `Progress`, bureaucratic milestones, and no final revision note.
- 2026-07-15 - This revision - compared the active plan with `.agent/PLANS.md` lines containing `## Skeleton of a Good ExecPlan`; corrected only the active plan structure and made no implementation or test claim.

Append future evidence in this form:

    YYYY-MM-DD HH:MMZ - <command or check> - <exact head SHA> - exit <code> - <exact result>

## Interfaces and Dependencies

Do not add an external runtime dependency unless Node.js built-ins cannot meet a requirement. Do not add a container-runtime dependency to implementation tests or validation.

The public create request remains:

    interface CreateJobRequest {
      requestId: string;
      workspace: string;
      planPath: string;
    }

Public statuses remain:

    type JobStatus =
      | "accepted"
      | "running"
      | "completed"
      | "failed"
      | "timed_out"
      | "interrupted";

Output checkpoint data remains internal and is omitted by the public job mapper. The output store must provide operations equivalent to:

    prepare(jobId: string, outputPath: string): Promise<void>
    append(jobId: string, chunk: Uint8Array): Promise<void>
    finalizeWriter(jobId: string): Promise<void>
    publishClean(jobId: string, status: JobStatus): Promise<void>
    publishError(jobId: string, error: RelayError): Promise<void>
    attach(record: JobRecord): Promise<OutputLease>
    peek(jobId: string): OutputSnapshot
    read(jobId: string, offset: number, maxBytes?: number): Promise<Uint8Array>
    waitForChange(jobId: string, observedVersion: number, signal?: AbortSignal): Promise<OutputSnapshot>
    release(lease: OutputLease): Promise<void>
    discard(jobId: string): Promise<void>
    close(): Promise<void>

Names may differ, but durable checkpoint ordering, terminal agreement, resource release, and error behavior may not.

The authenticated route is:

    GET /v1/jobs/{jobId}/output?offset={nonNegativeSafeInteger}
    Authorization: Bearer <AGENT_RELAY_TOKEN>
    Accept: application/octet-stream
    Accept-Encoding: identity

A successful response starts at the exact acknowledged offset and contains authoritative raw bytes only.

Configuration remains equivalent to:

    CODEX_TIMEOUT_MS=<positive integer>
    MAX_OUTPUT_BYTES=<positive integer>
    MAX_REMOTE_ERROR_BODY_BYTES=8192

The runner may receive:

    AGENT_RELAY_OUTPUT_ARCHIVE_PATH=<dedicated final path>

The final path means an atomically published complete terminal stream, never a live partial file.

Revision note (2026-07-15): Compared the branch active plan with the actual `## Skeleton of a Good ExecPlan` in `.agent/PLANS.md`. The previous revision had copied the skeleton's section names but violated its formatting and milestone rules. This revision preserves all historical work and technical requirements, keeps all checkboxes exclusively in `Progress`, rewrites milestones and acceptance as prose-first executable guidance, adds expected command outcomes, records the legacy branch `.agent/PLANS.md` as an implementation task, and adds this required note. Only this active plan was changed.