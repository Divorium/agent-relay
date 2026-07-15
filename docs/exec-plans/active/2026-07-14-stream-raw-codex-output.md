# Add restart-safe raw Codex output streaming without regressing isolation

This ExecPlan is a living implementation document governed by `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is an instruction for the implementation. Preserve the history in `Progress`, `Surprises & Discoveries`, `Decision Log`, validation evidence, and `Outcomes & Retrospective` when the plan changes. Do not replace completed historical entries with a rewritten summary.

Every repository change required by this pull request must first be described here. Codex must not run `git commit`, `git push`, `git merge`, `git rebase`, or any equivalent command that creates, rewrites, or publishes commits. The GitHub runner owns commit and push.

The implementation baseline is current `main`, inspected at commit `f043af2fa9eb0420a0d64684485700f92a5dc425`. Apply raw output streaming additively to that architecture. Validate Dockerfiles and `compose.yml` only through source review, comparison with current main, and deterministic non-container assertions. Do not add container-runtime commands or container-dependent tests to this plan.

## Purpose / Big Picture

After this work, an operator can observe Codex standard output and standard error while Codex is still running, reconnect to the Relay output endpoint from an exact byte offset, and obtain a byte-identical terminal archive after Relay finalizes the stream.

The authoritative stream is stored in Relay state. Process-console output and GitHub-visible output are presentation sinks and cannot change authoritative byte order or job outcome. Raw output is intentionally unredacted and sensitive. `MAX_OUTPUT_BYTES` remains a hard storage limit; reaching it fails the job and stream rather than producing successful truncation.

The feature must preserve current-main boundaries:

- Codex is launched through the approved wrapper with the approved user, minimal environment, workspace boundary, private runtime directory, and Git metadata restrictions.
- Checkout credentials, publication credentials, Relay credentials, and the host Codex credential remain scoped according to current main.
- Public create and poll responses remain filtered.
- Codex does not produce `.agent-relay/result.json`, a model-owned status, blocker, validation result, or commit message.
- Relay derives technical completion from the child process.
- The runner derives the commit subject from the selected active plan.
- The finalizer remains the only owner of clean-worktree and publication decisions.

## Progress

### Historical record

Keep this subsection append-only. These entries describe work that actually happened, including superseded or corrected work.

- [x] (2026-07-13 23:33Z) Created the original raw-output ExecPlan and opened PR #3.
- [x] (2026-07-14, initial implementation) Added a first prototype across Relay output persistence, the output endpoint, executor mirroring, runner streaming, workflow artifact handling, configuration, documentation, and tests. This prototype remains in the branch but is not accepted as complete.
- [x] (2026-07-14 21:50Z) Reviewed the prototype and recorded nine actionable defects in inline review threads.
- [x] (2026-07-15 00:42Z) Re-reviewed all changed files against the architecture introduced by PR #9 and determined that the branch restores contracts removed from current main.
- [x] (2026-07-15, correction) A temporary plan-only interpretation removed the prototype from the branch. The original implementation was restored at commit `32edacbac00be64a1b5674af2c0c81255c2c72bd`. The active plan must therefore describe repairs to the restored implementation, not replace the implementation with a plan-only pull request.
- [x] (2026-07-15 21:00Z) Added seven additional implementation defects: no durable active-job committed-length checkpoint, unbounded replay resource lifetime, no positive offset acknowledgement, duplicate replay after local sink failure, ignored configured poll interval, incomplete drain failure handling, and short-read spin risk.
- [x] (2026-07-15, plan revision `767e21feb7441f19b1623d1efd3a577d439ad80f`) Expanded only this active plan with restart-safe persistence, exact protocol, retry, resource-lifecycle, and deterministic test requirements.
- [x] (2026-07-15, plan revision `d6b706fc0da51c6b151e55eb62de141a74bf2e92`) Removed Docker and Compose execution from acceptance. Packaging files remain subject only to static repository validation.
- [x] (2026-07-15) Migrated the complete substance of all nine inline findings into this active plan and resolved all nine GitHub review threads. Resolving the discussion threads did not mark the corresponding implementation work complete.
- [x] (2026-07-15, this revision) Restored ExecPlan-style history and status tracking. Separated completed planning and review work from incomplete implementation work, converted milestones and merge gates to checkboxes, and removed stale claims that the review threads remain unresolved.

### Current implementation status

The checked items above are planning, review, branch-restoration, and documentation history. They do not prove that the code satisfies the feature contract. The following implementation items remain open until supported by repository references and passing automated tests or reproducible validation evidence.

- [ ] Reconcile every touched implementation file with then-current `main`, retaining only raw-output changes that are compatible with the current architecture.
- [ ] Remove contracts restored from the old architecture: execution modes, review findings, `blocked`, `resultPath`, `.agent-relay/result.json`, model validation, model commit messages, configurable launcher or user, `danger-full-access`, inherited environment, runner-service Relay token, and writable full Codex-home mount.
- [ ] Implement durable committed-output checkpoints, serialized appends, exact crash recovery, writer finalization, terminal agreement, and bounded replay resources.
- [ ] Implement persistence-before-presentation with byte-bounded buffering and complete mirror backpressure handling.
- [ ] Implement the authenticated output endpoint with exact offset acknowledgement and deterministic pre-header and post-header failures.
- [ ] Implement runner protocol validation, retry classification, exact reconnects, bounded presentation, atomic archive publication, and finalization before `$GITHUB_OUTPUT`.
- [ ] Reconcile workflow, configuration, packaging declarations, README, and operations documentation with current main.
- [ ] Add or repair deterministic non-container tests for every requirement and every migrated review finding.
- [ ] Run focused tests, `npm run check`, and `git diff --check` on the exact implementation head and record the results below.
- [ ] Reconcile against then-current main, obtain passing available required checks for the same head, complete final review, and make the PR mergeable.

### Current snapshot

This is a historical snapshot taken before this plan correction. Append a new snapshot after implementation or when the branch state materially changes; do not overwrite this one.

    Inspected: 2026-07-15
    PR: #3
    Base: main
    Base SHA: f043af2fa9eb0420a0d64684485700f92a5dc425
    Head before this revision: d6b706fc0da51c6b151e55eb62de141a74bf2e92
    Mergeable: false
    Changed files: 23
    Inline review threads: 9 resolved, 0 unresolved
    Workflow runs for inspected head: 0
    Combined status contexts for inspected head: 0
    Implementation tests after the latest plan-only revisions: not run
    Merge readiness: not ready

## Surprises & Discoveries

- Observation (2026-07-14): the first prototype opened the configured final archive path directly.
  Evidence: a timeout, cancellation, disconnect, or crash could leave a partial file at the path uploaded under `if: always()`.

- Observation (2026-07-14): explicit HTTP responses were classified with reconnectable transport failures.
  Evidence: non-200 responses could be retried until the global timeout and their full diagnostic bodies could be buffered.

- Observation (2026-07-14): runner success could be published before output finalization.
  Evidence: `$GITHUB_OUTPUT` was mutated before archive sync and close, and an early return could bypass a finalization failure.

- Observation (2026-07-14): restart attachment could fabricate a missing output file.
  Evidence: missing persisted output could become a clean empty replay rather than an integrity failure.

- Observation (2026-07-14): clean EOF could be published before the writable output handle was synced and closed.
  Evidence: the prototype retained one writable descriptor per job and allowed terminal visibility before durable writer finalization.

- Observation (2026-07-14): post-header endpoint failures were not handled uniformly.
  Evidence: some errors could fall through to JSON after raw headers, producing invalid or corrupt response behavior.

- Observation (2026-07-14): presentation preceded authoritative persistence.
  Evidence: process stdout was written before `OutputStore.append()`, and mirror backpressure was ignored.

- Observation (2026-07-14): creation rollback was not ownership-safe or exhaustive.
  Evidence: cleanup failures were suppressed and request mappings could be removed without comparing the expected job ID.

- Observation (2026-07-14): `.agent/PLANS.md` in the branch instructed Codex to commit frequently.
  Evidence: that contradicted the runner-owned Git flow and the current-main agent instructions.

- Observation (2026-07-15): the branch is not based on the current architecture.
  Evidence: it diverges from current main after PR #9 and GitHub reports it as non-mergeable.

- Observation (2026-07-15): active-job restart correctness cannot be recovered from file size.
  Evidence: a crash during a positional write can leave a physical suffix beyond the last fully accepted byte without a durable committed-length boundary.

- Observation (2026-07-15): terminal replay resources can grow without bound.
  Evidence: the prototype retains writable handles and state-map entries until process shutdown.

- Observation (2026-07-15): the output protocol lacks positive offset acknowledgement.
  Evidence: the runner requests `?offset=N`, but the response does not prove that the body begins at `N`.

- Observation (2026-07-15): local sink failures can enter reconnect handling.
  Evidence: archive or presentation failure can replay a chunk whose local side effects already occurred.

- Observation (2026-07-15): `AGENT_RELAY_POLL_INTERVAL_MS` is not honored above one second.
  Evidence: reconnect sleep uses `Math.min(pollIntervalMs, 1000)`.

- Observation (2026-07-15): drain waits omit complete error and close handling.
  Evidence: a failed stream can leave a promise pending or produce an unhandled failure.

- Observation (2026-07-15): committed reads can make partial or zero progress.
  Evidence: a file shortened after validation can produce a short response and a zero-read loop rather than `OUTPUT_READ_FAILED`.

- Observation (2026-07-15): resolving review discussions is not implementation evidence.
  Evidence: all nine requirements are now in this plan and the threads are resolved, but the prototype has not yet been repaired or validated against those requirements.

## Decision Log

Keep this section append-only. When a decision is superseded, record the superseding decision instead of deleting the earlier history.

- Decision (2026-07-13): implement live raw stdout and stderr streaming through Relay, the runner, and a terminal archive.
  Rationale: operators need live visibility and an exact terminal record.

- Decision (2026-07-15): current main after PR #9 is the mandatory implementation baseline.
  Rationale: raw streaming is additive observability and does not justify restoring removed control, credential, or execution mechanisms.

- Decision (2026-07-15): the selected active plan is the sole task authority.
  Rationale: PR comments, completed plans, review arrays, and duplicated prompt prose must not become competing instructions.

- Decision (2026-07-15): preserve the restored implementation and repair it; do not convert the pull request into a plan-only change.
  Rationale: the user requires every repository change to be described in the active plan, not every repository change to be removed from the pull request.

- Decision (2026-07-15): review threads may be resolved after their complete requirements are transferred into this plan.
  Rationale: Codex follows the selected active plan rather than PR comments. Implementation status remains represented by unchecked plan items and gates.

- Decision (2026-07-15): validate Dockerfiles and Compose statically only.
  Rationale: container execution is not part of this task's available validation path and must not become a merge gate.

- Decision (2026-07-15): a byte becomes committed only after complete write, data sync, and atomic checkpoint persistence.
  Rationale: readers may acknowledge only bytes reconstructable after restart.

- Decision (2026-07-15): output checkpoints are authoritative for progress and terminal facts; terminal job metadata must agree with them.
  Rationale: missing or mismatched persisted state is an integrity error, never a reason to infer success from file size or process status.

- Decision (2026-07-15): interrupted recovery may remove an uncommitted suffix only under exclusive recovery ownership for the interrupted active job.
  Rationale: historical replay must never repair or silently modify persisted output.

- Decision (2026-07-15): replay handles, reader leases, waiters, and terminal state entries have bounded lifetimes.
  Rationale: a long-running Relay cannot retain one descriptor or heavyweight object per completed job.

- Decision (2026-07-15): authoritative persistence precedes every presentation sink.
  Rationale: mirror behavior cannot reorder, invent, or invalidate authoritative bytes.

- Decision (2026-07-15): each successful output response acknowledges its exact starting offset.
  Rationale: the runner cannot prove duplicate-free and gap-free replay from status and media type alone.

- Decision (2026-07-15): redirects and explicit HTTP or protocol failures are fatal and non-retryable.
  Rationale: reconnect applies only to transient remote acquisition or body failures while the job remains nonterminal.

- Decision (2026-07-15): local sink failures never reconnect.
  Rationale: local side effects may already have occurred, so replaying the same remote offset can duplicate bytes.

- Decision (2026-07-15): the final archive path denotes only an atomically published complete terminal stream.
  Rationale: incomplete transport or local finalization must leave no final artifact.

- Decision (2026-07-15): repository acceptance requires local deterministic tests, `npm run check`, `git diff --check`, static packaging assertions, available exact-head non-container checks, and final review.
  Rationale: completion must be supported by reproducible evidence, not intended design.

## Outcomes & Retrospective

This plan is active and the implementation is not complete.

Completed outcomes:

- The original feature purpose and prototype history are preserved.
- The architectural baseline is current main rather than the obsolete branch architecture.
- Nine original review findings and seven additional findings are recorded in the active plan.
- All nine inline discussion threads are resolved after their requirements were transferred here.
- Container-runtime execution has been removed from validation and merge acceptance.
- The plan now distinguishes completed planning and review work from incomplete implementation and validation work.

Incomplete outcomes:

- The branch still contains an unaccepted prototype.
- Current-main reconciliation has not been completed.
- Persistence, endpoint, runner, executor, rollback, archive, and resource-lifecycle defects have not been proven fixed.
- Focused tests and full repository validation have not been run on the final implementation head.
- The PR remains non-mergeable and is not ready to merge.

Update this section again after each completed milestone. Replace the incomplete outcome statements only when the corresponding `Progress` item and acceptance gate are checked with evidence.

## Context and Orientation

`src/execution/codex-executor.ts` launches the isolated Codex child and receives stdout and stderr callbacks. Extend the current-main launcher and isolation contract rather than the obsolete branch contract.

`src/persistence/output-store.ts` owns authoritative output bytes, durable output metadata, live waiters, and historical replay. Add a per-job checkpoint beside each output file, for example `logs/<jobId>.meta.json`. Physical file size alone is never authoritative.

`src/application/job-service.ts` owns job creation, one-active-job admission, execution, terminal persistence, restart handling, and compensation. `src/persistence/job-store.ts` owns job records and request-ID indexing.

`src/api/server.ts` exposes authenticated APIs. Add `GET /v1/jobs/{jobId}/output?offset={nonNegativeSafeInteger}` without changing public create or poll DTOs.

`runner/client.mjs` validates the selected active plan, derives the commit subject, submits and polls jobs, streams output, publishes a complete archive, and writes `$GITHUB_OUTPUT` only after successful finalization.

Workflows, environment examples, Dockerfiles, `compose.yml`, `scripts/codex-run`, `src/server.ts`, README, and operations documentation describe packaging, credential scope, configuration, and operator behavior. Treat Dockerfiles and Compose as source configuration only.

## Plan of Work

### Milestone 0: reconcile with current main

Status: not complete. The branch contains a prototype built against an older architecture.

- [ ] For each changed file overlapping PR #9, begin from the then-current main version and reapply only streaming-specific changes.
- [ ] Preserve current-main `.agent/PLANS.md`, minimal `AGENTS.md`, generated prompt, active-plan path validation, request shape, process-derived statuses, plan-derived commit subject, finalizer behavior, public DTO filtering, launcher, environment, filesystem restrictions, credential-free checkout, step-scoped Relay token, publication credential scope, and read-only `auth.json` declaration.
- [ ] Remove obsolete execution modes, review findings, `blocked`, `resultPath`, `.agent-relay/result.json`, result validation, model commit messages, configurable launcher or user, `danger-full-access`, inherited environment, runner-service Relay token, and writable full Codex-home mount.
- [ ] Add or update regression tests for every preserved current-main boundary.
- [ ] Record the final main SHA used for reconciliation.

Milestone acceptance:

- [ ] Current-main contract tests pass.
- [ ] Static configuration comparison finds no credential or isolation regression.
- [ ] GitHub reports a conflict-free merge against then-current main.

### Milestone 1: durable output persistence and transactional lifecycle

Status: not complete. A prototype output store exists, but it does not provide the required durability, recovery, or resource lifecycle.

Define persisted checkpoint data equivalent to:

    interface PersistedOutputCheckpoint {
      schemaVersion: 1;
      jobId: string;
      generation: number;
      committedLength: number;
      terminal?:
        | { kind: "clean"; status: JobStatus }
        | { kind: "error"; errorCode: string; errorMessage: string };
    }

- [ ] Make `prepare(jobId, outputPath)` create the output file and initial checkpoint exclusively with mode `0600` without truncating stale data.
- [ ] Serialize appends in callback order.
- [ ] Treat a batch as committed only after complete write, data sync, and atomic checkpoint replacement.
- [ ] Resolve append promises and wake readers only after checkpoint persistence succeeds.
- [ ] Fail zero-progress writes.
- [ ] Enforce exact pending-byte accounting and `MAX_OUTPUT_BYTES` before accepting a chunk.
- [ ] Publish `OUTPUT_LIMIT_EXCEEDED` as an explicit error without a textual marker or clean EOF.
- [ ] Seal appends, drain the queue, sync, attempt close after earlier failure, and clear the writer handle during finalization.
- [ ] Persist matching terminal facts in the checkpoint and internal job record before publishing clean EOF.
- [ ] Preserve the last durable prefix and first error after append, sync, checkpoint, or close failure.
- [ ] Recover interrupted active jobs from the checkpoint, never from file size.
- [ ] Handle longer physical files as uncommitted crash suffixes only under exclusive interrupted recovery ownership.
- [ ] Treat missing, short, malformed, mismatched, or unreadable historical data as output integrity errors.
- [ ] Never fabricate a missing empty output stream.
- [ ] Use short-lived read-only handles or reference-counted replay leases.
- [ ] Release writers, readers, waiters, leases, and terminal state entries on every success, failure, and abort path.
- [ ] Make creation compensation exhaustive and ownership-safe: output discard, job deletion, and compare-delete of the exact request mapping.
- [ ] Preserve foreign request mappings and report incomplete rollback.

Milestone acceptance:

- [ ] Crash tests at every write, checkpoint, terminal-record, sync, and close boundary expose only a previously durable prefix.
- [ ] Restart tests never fabricate clean EOF.
- [ ] Repeated historical reads do not increase open descriptor count or retain unbounded terminal state.
- [ ] Every preparation and compensation failure has deterministic coverage.

### Milestone 2: isolated executor with bounded processing

Status: not complete. The prototype mirrors before persistence and does not fully handle backpressure.

- [ ] Extend the current-main executor and wrapper without broadening launcher, environment, workspace, Git metadata, runtime-directory, or denied-path access.
- [ ] Remove redaction only from the authoritative raw-output path and document sensitivity.
- [ ] Implement a FIFO with exact pending-byte accounting and explicit high and low watermarks.
- [ ] Pause both child streams at the high watermark and resume only at or below the low watermark.
- [ ] Bound overshoot to callbacks already delivered.
- [ ] Await durable `OutputStore.append()` before mirroring each chunk.
- [ ] Handle mirror `drain`, `error`, `close`, destroyed state, and listener cleanup without hanging.
- [ ] Disable only the failed presentation sink; do not fail or reorder authoritative output.
- [ ] Wait for child close, stdout end, stderr end, queue drain, checkpoint completion, and writer finalization.
- [ ] Preserve process-derived status classification for completed, failed, timed out, and interrupted jobs.

Milestone acceptance:

- [ ] Persisted callback order is byte-identical.
- [ ] Relay-owned memory remains bounded under blocked presentation.
- [ ] Presentation never precedes persistence.
- [ ] All locally executable current-main isolation tests pass.
- [ ] Static packaging assertions preserve declarations that cannot be executed without containers.

### Milestone 3: exact authenticated output protocol

Status: not complete. The prototype endpoint lacks the final durability, offset, error, and resource contracts.

- [ ] Add authenticated `GET /v1/jobs/{jobId}/output?offset={nonNegativeSafeInteger}`.
- [ ] Preserve filtered public create and poll DTOs.
- [ ] Validate job ID and canonical decimal offset.
- [ ] Return the existing JSON envelope before raw headers for malformed input, missing jobs, attachment failures, checkpoint failures, and invalid offsets.
- [ ] Return `416` plus `X-Agent-Relay-Committed-Length` for an offset above the committed boundary.
- [ ] Complete attachment, checkpoint validation, offset validation, and the first required read or terminal snapshot before `flushHeaders()`.
- [ ] Return successful output as `200 application/octet-stream` with `Cache-Control: no-store, no-transform`, `X-Content-Type-Options: nosniff`, identity encoding, and `X-Agent-Relay-Output-Offset` equal to the requested offset.
- [ ] Fail short and zero-progress reads before the durable boundary with `OUTPUT_READ_FAILED`.
- [ ] Destroy the transport for every post-header Relay or unknown error.
- [ ] Never call `sendJson()` after headers are sent or the response is destroyed or unwritable.
- [ ] Handle response `drain`, `error`, `close`, destroyed state, abort, listener cleanup, waiter release, and reader release.

Milestone acceptance:

- [ ] Every valid offset replays exact bytes.
- [ ] Every successful response acknowledges the exact starting offset.
- [ ] Pre-header and post-header error behavior is deterministic.
- [ ] No short-read or zero-progress loop exists.
- [ ] Normal completion, failure, and abort release all endpoint resources.

### Milestone 4: current-main runner with non-duplicating reconnects

Status: not complete. The prototype contains unsafe archive, retry, polling, drain, and finalization behavior.

- [ ] Preserve current-main preflight: real-path resolution, regular non-symlink active-plan validation, plan-derived commit subject, required `$GITHUB_OUTPUT`, and bounded exact JSON validation.
- [ ] Install idempotent `SIGINT` and `SIGTERM` cleanup handlers before submission.
- [ ] Remove a stale final archive before POST.
- [ ] Create a unique same-directory temporary archive exclusively with mode `0600`.
- [ ] Ensure fatal preflight or archive preparation failure occurs before POST.
- [ ] Submit only `requestId`, `workspace`, and `planPath`.
- [ ] Set `redirect: "error"` on every Relay request.
- [ ] Request `Accept: application/octet-stream` and `Accept-Encoding: identity` for output.
- [ ] Accept only `200` with the exact media type, absent or identity content encoding, a body, and a canonical offset header equal to `confirmedOffset`.
- [ ] Treat redirects, explicit non-200 responses, missing bodies, and protocol mismatches as fatal and non-retryable.
- [ ] Limit remote diagnostic bodies to 8192 bytes.
- [ ] Separate remote acquisition and body-read failures from local handling failures.
- [ ] Retry only request acquisition, accepted-body read, idle, or premature-EOF failure while the last validated job status is nonterminal.
- [ ] Never reconnect after archive, tail, stdout, workflow-command, JSON-polling, or finalization failure.
- [ ] Advance `confirmedOffset` only after all required local handling succeeds.
- [ ] Keep the tail allocation-bounded.
- [ ] Prevent duplicate bytes if archive handling degrades or fails.
- [ ] Honor `AGENT_RELAY_POLL_INTERVAL_MS` as `Math.min(pollIntervalMs, remainingDeadline)` without a hidden one-second cap.
- [ ] Handle stdout and stderr `drain`, `error`, `close`, destroyed state, and listener cleanup.
- [ ] Wrap GitHub-visible raw bytes with unique stop-command and resume markers without changing offsets or archive bytes.
- [ ] Treat clean EOF as terminal only after the job is terminal.
- [ ] Allow a technically failed job to publish a complete diagnostic archive while keeping workflow success and `$GITHUB_OUTPUT` unchanged.
- [ ] Sync and close the temporary archive and atomically rename it only after confirmed terminal EOF.
- [ ] Leave the final path absent after incomplete output, cancellation, signal, protocol failure, sync failure, close failure, or rename failure.
- [ ] Use one common finalization path before any structured success or `$GITHUB_OUTPUT` mutation.
- [ ] Do not restore `.agent-relay`, model-result validation, `blocked`, client-side Git status, or model-derived commit decisions.

Milestone acceptance:

- [ ] Reconnects contain no gaps or duplicates.
- [ ] Local sink failure after any partial local effect does not reconnect.
- [ ] Configured polling cadence is honored.
- [ ] Stream failures cannot leave a pending drain wait.
- [ ] Archive bytes are exact and no partial final artifact exists.
- [ ] Presentation memory is bounded and workflow-command-looking output is inert.
- [ ] Finalization failure prevents structured success and `$GITHUB_OUTPUT` mutation.

### Milestone 5: workflow, packaging, documentation, and operations

Status: not complete. These files must be reconciled with current main after implementation behavior is final.

- [ ] Begin workflows, examples, environment examples, Dockerfiles, `compose.yml`, server bootstrap, wrapper scripts, README, and operations documentation from current main.
- [ ] Preserve `persist-credentials: false` and the credential-free repository check.
- [ ] Keep the Relay token only in the client step and publication credentials only in finalization.
- [ ] Preserve the static read-only declaration for only `HOST_CODEX_AUTH_FILE` at `/home/agent/.codex/auth.json:ro`.
- [ ] Keep `MAX_OUTPUT_BYTES` in configuration, static packaging declarations, executor construction, and documentation.
- [ ] Add `AGENT_RELAY_OUTPUT_ARCHIVE_PATH` only to the client step.
- [ ] Upload the final archive and console log under `if: always()` while ensuring incomplete output leaves no final archive path.
- [ ] Validate Dockerfiles and Compose only through source comparison and deterministic source assertions.
- [ ] Document raw sensitivity, checkpoint semantics, interrupted recovery, output-limit failure, exact offset acknowledgement, redirect rejection, archive publication, resource release, and the distinction between process completion and output completeness.

Milestone acceptance:

- [ ] Static repository checks prove credential, mount, user, command, environment, and configuration declarations match current main plus the required streaming additions.
- [ ] README and operations documentation describe one result-free architecture consistent with implementation and tests.

### Milestone 6: deterministic closure

Status: not complete. No exact-head implementation validation has been recorded.

- [ ] Extend current-main tests rather than restoring obsolete fixtures.
- [ ] Cover output persistence concurrency, batching, partial writes, zero-progress writes, sync failure, checkpoint replacement failure, crash boundaries, suffix recovery, malformed data, terminal agreement, descriptor release, state eviction, concurrent attachment, startup isolation, and output-limit failure.
- [ ] Cover job-service preparation failures, terminal failures, independent compensation, mapping ownership, foreign mapping preservation, incomplete rollback, interrupted recovery, output-error persistence, terminal persistence failure, and active-job lock release.
- [ ] Cover executor binary bytes, invalid UTF-8, stdout and stderr ordering, watermarks, bounded overshoot, persistence before mirror, blocked mirror, mirror failure, listener cleanup, timeout, non-zero exit, spawn failure, persistence failure, output limit, and current-main isolation.
- [ ] Cover endpoint authentication, filtered DTOs, offset validation, `416`, exact acknowledgement, first read before headers, replay boundaries, active following, short reads, backpressure, response failure, abort, resource release, restart attachment, JSON before headers, and post-header destruction.
- [ ] Cover runner preflight, commit-subject derivation, archive preparation, redirects, identity transfer, protocol validation, bounded diagnostics, status classes, retry classes, local sink failures, duplicate prevention, polling interval, stream failure, signals, archive finalization, bounded memory, workflow-command isolation, finalization before output, and absence of obsolete result or Git behavior.
- [ ] Add a controlled full-flow success test using a local fake Codex child, local Relay server, temporary directories, and local runner process.
- [ ] Add a crash-recovery full-flow test using local processes and temporary files.
- [ ] Add a local-sink failure full-flow test proving no reconnect and no duplicate local bytes.
- [ ] Run focused validation.
- [ ] Run complete repository validation.
- [ ] Compare the final diff with the recorded baseline and then-current main.
- [ ] Record exact test counts, coverage, main SHA, head SHA, and available required check conclusions.
- [ ] Perform final review against every unchecked item and merge gate.

## Concrete Steps

Run from the repository root. Do not run commands that create, rewrite, or publish commits. Do not run container-runtime commands.

Inspect current-main contracts before editing:

    git show f043af2fa9eb0420a0d64684485700f92a5dc425:.agent/PLANS.md
    git show f043af2fa9eb0420a0d64684485700f92a5dc425:runner/client.mjs
    git show f043af2fa9eb0420a0d64684485700f92a5dc425:src/execution/codex-executor.ts
    git show f043af2fa9eb0420a0d64684485700f92a5dc425:src/application/job-service.ts
    git show f043af2fa9eb0420a0d64684485700f92a5dc425:src/api/server.ts
    git show f043af2fa9eb0420a0d64684485700f92a5dc425:compose.yml

Run focused validation during implementation:

    npm ci
    npm run typecheck
    npm run build
    node --test --experimental-test-coverage dist/test/contracts.test.js
    node --test --experimental-test-coverage dist/test/executor.integration.test.js
    node --test --experimental-test-coverage dist/test/integration.test.js
    node --test --experimental-test-coverage dist/test/runner-client.test.js
    node --test --experimental-test-coverage dist/test/flow.integration.test.js

Run complete repository validation:

    npm run check
    git diff --check

Verify obsolete contracts did not return:

    ! git grep -n 'danger-full-access'
    ! git grep -n 'shouldCommit\|reviewFindings\|resultPath' -- src runner test .github examples compose.yml README.md docs/operations
    ! git grep -n '\.agent-relay/result\.json' -- src runner test .github examples compose.yml README.md docs/operations
    ! git grep -n 'AGENT_RELAY_MODE' -- src runner test .github examples compose.yml README.md docs/operations
    ! git grep -n 'HOST_CODEX_DIR' -- .env.example compose.yml README.md docs/operations
    ! git grep -n 'AGENT_RELAY_TOKEN: \${AGENT_RELAY_TOKEN}' -- compose.yml
    grep -F 'HOST_CODEX_AUTH_FILE' .env.example compose.yml README.md docs/operations/README.md
    grep -F '/home/agent/.codex/auth.json:ro' compose.yml
    grep -F '/usr/local/bin/codex-run' src/server.ts

Verify output protocol and persistence:

    git grep -n 'application/octet-stream' -- src runner test README.md docs/operations
    git grep -n 'Accept-Encoding' -- runner test
    git grep -n 'no-transform' -- src test
    git grep -n 'X-Agent-Relay-Output-Offset' -- src runner test README.md docs/operations
    git grep -n 'committedLength' -- src test
    git grep -n 'MAX_OUTPUT_BYTES' -- .env.example compose.yml src test README.md docs/operations

Update `Progress` immediately after each completed implementation step. A completed item must cite a code location and passing test or a reproducible command and captured result. If an item is blocked, leave it unchecked, prefix it with `[blocked]`, and record cause, impact, evidence, and the exact unblock condition.

## Validation and Acceptance

All gates remain unchecked until supported by exact-head evidence. Resolved PR discussions do not satisfy these gates.

- [ ] Gate 1: the implementation is reconciled with then-current main and GitHub reports the PR mergeable.
- [ ] Gate 2: only the selected active plan is a task instruction; no agent instruction tells Codex to commit, merge, rebase, or push.
- [ ] Gate 3: no execution mode, review-findings channel, model result artifact, model blocker or status, model validation, model commit message, or client-side Git decision exists.
- [ ] Gate 4: locally executable launcher, environment, filesystem, workspace, temporary-directory, and Git-metadata restrictions pass deterministic tests; packaging declarations pass static assertions.
- [ ] Gate 5: credential declarations preserve a credential-free checkout, client-step Relay token, finalizer-scoped publication credentials, no runner-service Relay token, and only the read-only `auth.json` declaration.
- [ ] Gate 6: create and poll responses expose no internal path, checkpoint, terminal diagnostic, or internal error message.
- [ ] Gate 7: creation attempts every compensation, compare-deletes only its own mapping, preserves foreign mappings, and reports incomplete rollback.
- [ ] Gate 8: appends are serialized and bytes become committed only after full write, data sync, and atomic checkpoint persistence.
- [ ] Gate 9: crash recovery never infers committed length from file size and exposes only the durable checkpoint prefix.
- [ ] Gate 10: clean terminal publication drains appends, syncs, closes the writer, persists matching checkpoint and job metadata, and only then publishes EOF.
- [ ] Gate 11: missing, malformed, unreadable, short, long, mismatched, or error-terminal output cannot become fabricated clean replay.
- [ ] Gate 12: writers, replay handles, reader leases, waiters, and terminal state entries have bounded lifetimes and are released on every path.
- [ ] Gate 13: output-limit exhaustion is explicit failure and never successful truncation.
- [ ] Gate 14: authoritative persistence precedes mirroring; buffering is byte-bounded; mirror backpressure and failure cannot reorder or fail authoritative output.
- [ ] Gate 15: pre-header failures use JSON; every post-header failure destroys the transport; short or zero-progress reads cannot spin; abort cannot leak resources.
- [ ] Gate 16: every successful output response is `200 application/octet-stream`, identity encoded, `no-transform`, and acknowledges the exact requested offset.
- [ ] Gate 17: the runner rejects redirects, missing bodies, media, encoding, or offset mismatch, explicit HTTP failures, and oversized diagnostics without reconnecting.
- [ ] Gate 18: only transient remote acquisition, body, idle, or premature-EOF failures while nonterminal reconnect; local sink failures never reconnect.
- [ ] Gate 19: reconnects resume from the exact confirmed offset without gaps or duplicates.
- [ ] Gate 20: `AGENT_RELAY_POLL_INTERVAL_MS` is honored up to the remaining deadline without a hidden one-second cap.
- [ ] Gate 21: runner and server stream writes handle `drain`, `error`, `close`, destroyed state, and listener cleanup without hanging.
- [ ] Gate 22: the final archive path is absent until terminal EOF, successful sync and close, and atomic rename; incomplete output leaves no final artifact.
- [ ] Gate 23: GitHub-visible prefix and tail are bounded in retained memory and keep workflow-command-looking bytes inert.
- [ ] Gate 24: common runner finalization succeeds before structured success or `$GITHUB_OUTPUT`; the current-main finalizer alone owns publication behavior.
- [ ] Gate 25: README and operations documentation describe the result-free architecture, sensitivity, hard limit, checkpoints, replay, acknowledgement, archive, credentials, resource release, and recovery.
- [ ] Gate 26: every migrated inline finding and every additional finding has a deterministic regression test or static source assertion.
- [ ] Gate 27: `npm run check` and `git diff --check` pass on the exact final head, available required GitHub checks pass for that SHA, final review finds no mismatch, and no new actionable thread remains unresolved.

Do not move this file to `docs/exec-plans/completed/` until every gate and every current implementation item is checked with evidence.

## Idempotence and Recovery

Tests use temporary repositories, state directories, output files, checkpoints, archive paths, local HTTP servers, and local child processes. Repeated test runs must not alter operator state.

Job request retries preserve current-main idempotency. A matching request ID returns the existing job. Preparation rollback deletes only resources owned by the failing attempt and reports incomplete compensation.

The output checkpoint advances monotonically. Interrupted recovery may truncate only bytes beyond that checkpoint for the interrupted active job under exclusive ownership. Historical terminal replay never repairs persisted data.

The final archive path is dedicated to one workflow attempt. Startup removes only a stale final path for that attempt, writes to a unique temporary sibling, and removes only that temporary file on failure.

A failed publication after a local commit remains the current finalizer's responsibility. Streaming code does not duplicate or bypass that recovery path.

## Artifacts and Notes

### Migrated review requirements

The review threads are resolved because these requirements are now maintained here. Their implementation remains open in the milestones and gates above.

1. `.agent/PLANS.md`: remove contradictory commit instructions and preserve runner-owned Git flow. Covered by Milestone 0 and Gates 2-3.
2. `runner/client.mjs`: publish the final archive only through temporary file, sync, close, and atomic rename. Covered by Milestone 4 and Gate 22.
3. `runner/client.mjs`: explicit HTTP and protocol responses are bounded, fatal, and non-retryable. Covered by Milestone 4 and Gates 16-18.
4. `runner/client.mjs`: complete common finalization before success or `$GITHUB_OUTPUT`. Covered by Milestone 4 and Gate 24.
5. `src/persistence/output-store.ts`: never fabricate a missing terminal output file. Covered by Milestone 1 and Gate 11.
6. `src/persistence/output-store.ts`: serialize appends, sync and close the writer, and separate replay resources before clean EOF. Covered by Milestone 1 and Gates 8-12.
7. `src/api/server.ts`: after raw headers, destroy the transport for every error and never send JSON. Covered by Milestone 3 and Gate 15.
8. `src/execution/codex-executor.ts`: persist before mirroring and honor mirror backpressure. Covered by Milestone 2 and Gate 14.
9. `src/application/job-service.ts`: attempt every rollback independently and compare-delete only the owned request mapping. Covered by Milestone 1 and Gate 7.

### Validation evidence log

Keep this subsection append-only. Do not replace prior failures or unavailable evidence with later success.

- 2026-07-15 - Review of restored implementation - identified nine original and seven additional defects; no implementation test was claimed as passing.
- 2026-07-15 - GitHub review threads - all nine migrated threads resolved; implementation milestones and gates remained unchecked.
- 2026-07-15 - Head `d6b706fc0da51c6b151e55eb62de141a74bf2e92` - zero associated workflow runs and zero combined status contexts.
- 2026-07-15 - Plan-only revisions - no code tests run because only the active plan changed.
- 2026-07-15 - ExecPlan correction - history, current status, milestone checkboxes, merge-gate checkboxes, migrated finding map, and append-only evidence restored in this file.

Append final evidence in this form:

    YYYY-MM-DD HH:MMZ - <command or check> - <exact head SHA> - exit <code> - <exact result>

Required final evidence includes:

- focused test commands and exact pass/fail counts;
- `npm run check` and exact pass/fail counts and coverage;
- `git diff --check` result;
- crash-checkpoint test result;
- static packaging assertion result;
- final main SHA and reconciliation conclusion;
- exact-head available required GitHub check conclusion;
- final GitHub mergeability and review conclusion.

Raw child output can contain repository content, command output, tokens, or credentials printed by tools. Relay state, process logs, GitHub logs, and uploaded archives are sensitive execution data. Access restrictions, output limits, retention, checkpoint integrity, and credential isolation are part of acceptance.

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

Output checkpoint data remains internal and is omitted by `toPublicJob()`.

The output store must provide equivalent operations and lifecycle semantics:

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

Keep configuration equivalent to:

    CODEX_TIMEOUT_MS=<positive integer>
    MAX_OUTPUT_BYTES=<positive integer>

Define and test explicit queue high and low watermarks and:

    MAX_REMOTE_ERROR_BODY_BYTES = 8_192

The runner may receive:

    AGENT_RELAY_OUTPUT_ARCHIVE_PATH=<dedicated final path>

The final path means an atomically published complete terminal stream, never a live partial file.
