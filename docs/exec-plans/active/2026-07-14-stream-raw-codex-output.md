# Stream raw Codex process output

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

After this work, an operator running Codex through Agent Relay can see Codex standard output (`stdout`) and standard error (`stderr`) while the process is still active, reconnect to the Relay without losing or duplicating bytes, and retrieve a complete raw archive when the stream reaches a confirmed terminal end. Raw means the exact process bytes without text decoding, redaction, or normalization. The GitHub-visible log remains bounded to a live prefix and a final tail, while `.agent-relay/result.json` and worktree validation remain the only source of data that controls whether a commit is produced.

The behavior is observable in three places. Agent Relay container logs show the live raw stream. The authenticated `GET /v1/jobs/{jobId}/output?offset=...` endpoint replays already committed bytes and follows new bytes. The runner prints a bounded view and publishes `AGENT_RELAY_OUTPUT_ARCHIVE_PATH` only when the complete stream has been durably stored.

This task does not change output verbosity, hide commands, introduce JSON output mode, or edit the GitHub Actions workflow. Raw process output remains uncapped and unredacted. Sensitive-data validation of the structured result remains enabled.

## Progress

- [x] (2026-07-13 23:33Z) Wrote the original raw-output design and its eleven implementation items.
- [x] (2026-07-14 11:02Z) First Codex pass produced commit `104e23cc164cdd0e587fb0dad1b07f4fc27047b9` and marked all original items complete.
- [x] (2026-07-14 11:02Z) Reviewed the first implementation and reopened partially completed items after finding lifecycle, archive, endpoint, cancellation, and evidence gaps.
- [x] (2026-07-14 12:40Z) Compared this plan line by line with the ExecPlan skeleton in `.agent/PLANS.md`, restored the original Progress items, removed nonstandard headings, made the plan self-contained, and defined repository-specific technical terms.
- [x] (2026-07-14 14:24Z) Rebased the pull-request contents onto current `main` at `7c242764664fc209fed4163c627c4530351e5c41`. Preserved the raw-output implementation, incorporated live Agent Relay container mirroring from `b3175993beb98af3c0dd16ca9b58e690febd0905`, incorporated `-c features.memories=false` from `7c242764664fc209fed4163c627c4530351e5c41`, and updated executor and full-flow tests to assert the exact argument order.
- [x] (2026-07-14 15:22Z) Re-reviewed the active plan against `.agent/PLANS.md` and the current pull-request code. Added prescriptive writer and reader lifecycle contracts, missing-file integrity behavior, a byte-bounded queue, Docker mirror failure semantics, archive failure classification, HTTP response classification, rollback failure handling, and the missing regression-test requirements.
- [x] (2026-07-14 15:26Z) Re-reviewed the revised plan for internal consistency. Separated clean writer finalization from error sealing, made `OutputStore` own and await its append chain, defined nonterminal attachment failure, made stale-final-path removal fatal, bounded remote error bodies, and classified idle abort and premature clean EOF explicitly.
- [x] (2026-07-14 15:29Z) Re-reviewed memory accounting, HTTP protocol validation, startup ordering, and rollback ownership. Counted the in-flight mirror chunk until complete handling, required HTTP `200 application/octet-stream`, moved signal and archive preparation before job submission, and changed request-index rollback to compare-and-delete the created job ID only.
- [x] (2026-07-14 20:13Z) Defined the agent-only repository documentation boundary: `docs/operations/README.md` is the canonical operational runbook, `docs/operations/live-codex-logs.md` is redundant and must be removed after its unique content is merged, and `AGENTS.md` should contain only a concise pointer to the runbook rather than duplicate operational instructions.
- [ ] (2026-07-14 15:29Z) Implement transactional output preparation and idempotent preservation (completed: output is prepared before acceptance, existing request IDs return the existing job, and creation has rollback code; remaining: make rollback attempt every compensating action, compare the request-index mapping before removal, return `OUTPUT_PREPARATION_FAILED` when compensation is incomplete, add deterministic failures after output preparation, job save, and request-index update, and prove that successful retries preserve existing bytes).
- [ ] (2026-07-14 15:29Z) Implement incremental raw persistence with bounded child-stream backpressure (completed: stdout and stderr buffers are appended incrementally, both streams are paused and resumed around queued writes, exact raw chunks are mirrored live to Agent Relay container stdout, and Codex is invoked with the tested `-c features.memories=false` override; remaining: use the byte limits, store-owned append chain, whole-chunk memory accounting, and persistence-before-mirror ordering specified below, wait for both streams and writer closure, release mirror drain waits on `error` or `close`, retain final committed bytes on failures, and add byte-identity, queue-bound, and mirror-failure tests).
- [ ] (2026-07-14 15:26Z) Implement terminal ordering and restart replay (completed: terminal records are persisted, interrupted jobs are recovered, and terminal files can be attached for replay; remaining: separate writable and read-only handles, finalize clean writers before terminal persistence, seal failed writers without requiring clean finalization, make terminal state first-wins, never fabricate a missing terminal output file, reject attachment of a nonterminal record with no live state, prevent clean EOF after output or terminal-persistence failure, close replay handles safely, and test every terminal status after restart).
- [ ] (2026-07-14 15:22Z) Add the authenticated byte-offset stream (completed: authentication, offset replay, live following, waiting, and response backpressure exist; remaining: pre-header versus post-header error handling for every error class, zero-progress read protection, response `error` and `close` cleanup, client-abort cleanup proof, and deterministic endpoint regression tests).
- [ ] (2026-07-14 15:29Z) Add runner streaming, archive mode, reconnect, common finalization, and tail-only fallback (completed: the runner consumes output while active, reconnects from a confirmed offset, keeps a rolling tail, prints a bounded prefix when the archive is healthy, and supports an archive path; remaining: install signal handling and prepare archive state before job submission, keep live prefix display independent of archive health, make stale-final-path removal safe and fatal on failure, publish through a temporary file only after confirmed terminal EOF, require the exact HTTP status and content type, apply the archive, protocol, idle, and early-EOF matrix below, add common finalization, and add failure-path tests).
- [ ] (2026-07-14 12:40Z) Add GitHub workflow-command isolation around raw display (completed: a random stop-command token encloses raw output; remaining: track the last displayed byte rather than the last received byte, make stop and restore lines safe at prefix boundaries, and prove command-looking raw data cannot affect workflow controls or `$GITHUB_OUTPUT`).
- [x] (2026-07-14 12:40Z) Remove total-output truncation and process-output redaction. The old output cap and process-output redaction are absent; structured-result sensitive-data validation remains enabled.
- [ ] (2026-07-14 15:29Z) Add unit, integration, failure-path, and controlled end-to-end tests (completed: initial happy-path and integration tests exist, and executor plus full-flow fixtures now assert the memories override; remaining: the expanded failure matrix and controlled full-flow test described in the Plan of Work).
- [ ] (2026-07-14 20:13Z) Consolidate agent-facing operational documentation (completed: raw-output and sensitivity text exists in both operations documents; remaining: merge the unique live-log commands and semantics into `docs/operations/README.md`, delete `docs/operations/live-codex-logs.md`, add one concise `AGENTS.md` pointer to the canonical runbook, remove or update every reference to the deleted file, and verify that no operational behavior is duplicated across agent instructions and the runbook).
- [ ] (2026-07-14 12:40Z) Run validation and record evidence. The first-pass completion claim is not accepted as final evidence. Run the commands in `Concrete Steps` against the repaired head and record command, exit code, exact test count, and concise output in `Artifacts and Notes`.
- [ ] (2026-07-14 12:40Z) Review every acceptance criterion against final code and fix all findings. Repeat the review after implementation and tests; do not move the plan to `docs/exec-plans/completed/` until no unresolved mismatch remains.

## Surprises & Discoveries

- Observation: the first pass implemented the intended architecture but marked the work complete before the required failure-path evidence existed.
  Evidence: commit `104e23cc164cdd0e587fb0dad1b07f4fc27047b9` checked every original Progress item even though the runner and output-store tests did not cover archive sync failure, terminal-persistence failure, signal cancellation, or writer file-handle release.

- Observation: `OutputStore.complete()` and `OutputStore.fail()` currently notify readers without closing the writable handle.
  Evidence: in `src/persistence/output-store.ts`, both methods set `state.terminal`, increment `version`, and wake waiters. The handle is closed only by `discard()` or global `close()`.

- Observation: clean finalization and failure sealing require different rules.
  Evidence: `complete()` may publish clean EOF only after successful sync and close. An append, sync, or close failure still needs `fail()` to reject future appends, close the writer best-effort, publish an error terminal, and wake readers; requiring successful clean finalization before `fail()` would leave readers hanging.

- Observation: the current state uses one `r+` file handle for both appending and replay.
  Evidence: `OutputState` has a single `handle`; `prepare()` opens it as `wx+`, and `attach()` opens terminal files as `r+`. Closing that handle to satisfy writer finalization would also break replay unless writing and reading are separated.

- Observation: terminal attachment currently fabricates successful empty output when the persisted file is missing.
  Evidence: `OutputStore.attach()` catches `ENOENT` for a terminal job, creates an empty file, opens it as `r+`, and marks the state clean. Missing persisted output is an integrity failure and cannot be represented as clean EOF.

- Observation: a persisted nonterminal job without a live output state is not a valid attachment target.
  Evidence: active output can only be followed safely through the state created by `prepare()`, because that state owns committed length, writer ordering, and waiters. After restart, `JobService.init()` converts accepted or running records to interrupted before lazy attachment.

- Observation: closing the archive file is not proof that the archive contains the complete output stream.
  Evidence: `runner/client.mjs` can set archive completion after `sync()` and `close()` without first proving that a terminal job was observed and the output endpoint returned final EOF from the current confirmed offset.

- Observation: transport and local sink failures require different recovery behavior.
  Evidence: if a received chunk is appended to an archive and a later stdout operation fails, reconnecting from the old confirmed offset appends the same bytes again. Only failures that occur before a valid HTTP response or while reading its body are safe to reconnect.

- Observation: a completed non-success HTTP response is not a transport failure.
  Evidence: the runner currently classifies most non-2xx responses as `request-failed` and retries them. Authentication, missing-job, malformed-request, range, and server responses have explicit status and body and must fail without reconnect.

- Observation: a nominally successful response can still violate the output protocol.
  Evidence: the route contract is HTTP `200` with `Content-Type: application/octet-stream`. Accepting another `2xx`, a missing or incompatible content type, or a `200` JSON body as raw output would corrupt the archive and offset accounting.

- Observation: clean EOF while the polled job is still nonterminal is not terminal EOF.
  Evidence: terminal EOF requires both a terminal job record and clean output EOF. A successful response that ends while the job remains accepted or running must be treated as an unexpected early end and retried from the same confirmed offset, not accepted as completion.

- Observation: archive health currently controls whether the live prefix is printed.
  Evidence: `handleRawChunk()` writes the live prefix only when `state.archiveHandle` exists, and returns early after an archive append failure. Loss of the optional archive therefore suppresses live display even though the rolling tail and stdout presentation are separate sinks.

- Observation: queue memory includes a chunk while container mirroring is blocked.
  Evidence: persistence may finish before `process.stdout` emits `drain`. Removing that chunk from `pendingBytes` immediately after append would understate Relay-owned memory and allow more child output while the previous buffer is still retained for mirroring.

- Observation: the last received byte is not necessarily the last displayed byte.
  Evidence: after the visible-prefix limit is reached, later bytes are archived but suppressed. Newline decisions for GitHub stop and restore commands must therefore use the last byte actually written to stdout.

- Observation: job-creation rollback currently hides cleanup failures and request-index ownership.
  Evidence: `JobService.create()` suppresses errors from output discard, job deletion, and request-index removal. `JobStore.removeRequestId()` deletes by request ID alone, so compensation must verify that the mapping still points to the newly created job before deleting it.

- Observation: the two commits missing from the original PR branch changed the same executor that the raw-output implementation changed.
  Evidence: automatic `main`-to-branch merging reported conflicts. The synchronized branch therefore had to combine the shared `OutputStore` implementation with raw `process.stdout.write(chunk)` mirroring and `-c features.memories=false`, then update test argument positions from workspace argument `$7` to `$9`.

- Observation: the operations documentation currently has two sources for a small live-log procedure.
  Evidence: `docs/operations/README.md` already documents GitHub logs, recovery, persisted-log inspection, and sensitivity, while `docs/operations/live-codex-logs.md` repeats the raw-output semantics and adds only two short follow commands. In a repository consumed only by agents, this split increases discovery cost and the chance of inconsistent updates without creating a meaningfully independent runbook.

## Decision Log

- Decision: retain the first-pass architecture and repair it instead of replacing it.
  Rationale: the shared output store, offset endpoint, and runner pipeline already implement the central design. The defects are lifecycle and failure-path gaps, not a reason to introduce another transport.
  Date/Author: 2026-07-14 / PR review.

- Decision: Agent Relay persistence is authoritative; Docker and GitHub output are presentation sinks.
  Rationale: failure of a presentation sink must not corrupt committed bytes or reset the replay offset. This allows live container observability to coexist with exact persistence.
  Date/Author: 2026-07-14 / PR review.

- Decision: `OutputStore` owns append serialization and uses separate write and replay handles.
  Rationale: callers may enqueue concurrently from stdout and stderr, so the store maintains one append chain and calculates committed length in that serialized order. Writer finalization closes all write capability while active and terminal readers continue through a separate read-only handle.
  Date/Author: 2026-07-14 / PR review.

- Decision: attachment is lazy, terminal-only when no state exists, and integrity-preserving.
  Rationale: `JobService.init()` marks accepted or running records interrupted but does not open every historical log. The output endpoint attaches a persisted terminal job before sending headers. Concurrent first attachment is serialized; redundant handles are closed. Missing output or a nonterminal record without an existing live state returns `OUTPUT_READ_FAILED` and never becomes clean EOF.
  Date/Author: 2026-07-14 / PR review.

- Decision: clean and error terminal transitions are one-way and first-terminal-wins.
  Rationale: `complete()` requires successful writer finalization. `fail()` may seal a writer from any nonterminal writer state, rejects future appends, closes it best-effort, and publishes the first error. Repeating the same clean status or calling `fail()` again after an error is an idempotent no-op. Every clean-versus-error or different-clean-status transition raises `OUTPUT_WRITE_FAILED` and leaves the first terminal unchanged.
  Date/Author: 2026-07-14 / PR review.

- Decision: use `OUTPUT_QUEUE_HIGH_WATER_BYTES = 1048576` and `OUTPUT_QUEUE_LOW_WATER_BYTES = 262144` and count a chunk until all required executor handling finishes.
  Rationale: one mebibyte permits normal child-process bursts while bounding Relay-owned memory. Both child streams pause when pending bytes reach the high-water mark and resume only after pending bytes fall to or below the low-water mark. A chunk remains counted while queued, being appended, or waiting for mirror `drain`; it is removed only after persistence and mirror handling settle. Because one callback from each child stream may already be pending when pause takes effect, the proved maximum is the high-water mark plus at most one observed stdout chunk and one observed stderr chunk.
  Date/Author: 2026-07-14 / PR review.

- Decision: persist each raw chunk before mirroring that chunk to Agent Relay container stdout.
  Rationale: the authoritative file must never lag behind a presentation sink that already exposed bytes. The mirror honors `drain`; an `error` or `close` releases any pending drain wait, disables further mirroring for that job, removes scoped listeners, and does not fail Codex execution or modify committed offsets.
  Date/Author: 2026-07-14 / PR review.

- Decision: install signal handlers and prepare archive state before submitting the Relay job.
  Rationale: fatal stale-path cleanup or an early signal must not start an unobserved Codex job. Archive create failure remains a documented tail-only degradation, so it does not block job submission after cleanup and signal handling are ready.
  Date/Author: 2026-07-14 / PR review.

- Decision: publish archives through a temporary file in the same directory and atomically rename it after confirmed terminal EOF.
  Rationale: the configured final path must mean complete archive. Atomic rename means exposing the final path in one filesystem operation, so artifact upload cannot observe a partly written file. Writing directly to the final path makes partial output indistinguishable from complete output after cancellation or transport failure.
  Date/Author: 2026-07-14 / PR review.

- Decision: archive create or append failure degrades to tail-only mode; stale-final-path removal and archive sync, close, or rename failure are fatal.
  Rationale: create and append failures can be detected while the current chunk remains available for the bounded tail and visible prefix. A stale configured final path must not survive into the current run. Final publication failures occur when the runner intends to certify completeness, so success, result publication, and `$GITHUB_OUTPUT` are blocked. Every archive failure removes the current temporary file and leaves the configured final path absent.
  Date/Author: 2026-07-14 / PR review.

- Decision: tail-only mode changes archive availability but does not disable the live prefix.
  Rationale: archive persistence, rolling tail, and GitHub-visible stdout are independent local sinks. Operators continue seeing the bounded live prefix when archive creation or append fails.
  Date/Author: 2026-07-14 / PR review.

- Decision: accept only HTTP `200` with `Content-Type: application/octet-stream` as an output stream.
  Rationale: the public output contract has one successful status and media type. Any other `2xx`, a missing or incompatible content type, or a non-2xx response is a fatal remote protocol result and is never written into the raw archive.
  Date/Author: 2026-07-14 / PR review.

- Decision: retry only request transport failure, accepted-body failure, idle abort, or premature clean EOF with a confirmed nonterminal job.
  Rationale: local sink failures may already have handled bytes beyond the confirmed Relay offset, while a completed remote response outside the accepted protocol is explicit rather than a transport interruption. A clean EOF is terminal only after status polling confirms a terminal job; otherwise reconnecting from the unchanged confirmed offset is safe.
  Date/Author: 2026-07-14 / PR review.

- Decision: bound remote response diagnostics to `MAX_REMOTE_ERROR_BODY_BYTES = 8192`.
  Rationale: a remote error or protocol mismatch must not cause the runner to allocate an unbounded response body while reporting a failure. Preserve at most the first 8192 bytes and indicate truncation when more data exists.
  Date/Author: 2026-07-14 / PR review.

- Decision: creation rollback removes a request-index entry only when it still maps to the created job.
  Rationale: compensation must not delete an older or concurrently restored idempotency mapping. `removeRequestId(requestId, expectedJobId)` compares the stored value and removes only an exact match; a different value is preserved and reported as an incomplete compensation.
  Date/Author: 2026-07-14 / PR review.

- Decision: incomplete creation rollback returns `OUTPUT_PREPARATION_FAILED` with HTTP 500.
  Rationale: the service attempts output discard, job deletion, and compare-and-delete request-index removal even if an earlier compensation fails. If any compensation remains incomplete, the error message identifies the original failure and every failed compensation, and the service does not claim that the same request ID can safely retry until repository state is repaired.
  Date/Author: 2026-07-14 / PR review.

- Decision: synchronize onto current `main` and treat `-c features.memories=false` plus live Agent Relay container output as implemented baseline behavior.
  Rationale: commits `b3175993beb98af3c0dd16ca9b58e690febd0905` and `7c242764664fc209fed4163c627c4530351e5c41` were already merged into `main`. The active plan must not assign their reimplementation to Codex; Codex only needs to preserve them while repairing lifecycle and failure semantics.
  Date/Author: 2026-07-14 / maintainer synchronization.

- Decision: output verbosity and command filtering remain outside this task.
  Rationale: this plan repairs correctness of raw transport and persistence. Changing presentation semantics would mix a separate product decision into failure-path work.
  Date/Author: 2026-07-14 / user instruction and PR review.

- Decision: keep one canonical operations runbook for this agent-only repository.
  Rationale: `AGENTS.md` should contain durable agent instructions and a short navigation pointer, not duplicate operating procedures. `docs/operations/README.md` will contain the complete operational procedure for configuration, startup, dispatch, live logs, persisted logs, recovery, and credential rotation. The unique content of `docs/operations/live-codex-logs.md` will be merged into that runbook and the redundant file will be deleted so agents have one source of truth.
  Date/Author: 2026-07-14 / user instruction and documentation review.

## Outcomes & Retrospective

The first major milestone produced the main output-streaming architecture. Codex output now enters a shared `OutputStore` while the process is active, can be replayed through an authenticated byte-offset endpoint, and is consumed by a runner with reconnect, archive, prefix, tail, and GitHub command-isolation foundations. The old total output cap and process-output redaction were removed.

That milestone did not achieve the original reliability bar. The implementation can retain writable file handles, fabricate a clean empty replay for missing terminal output, confuse local, HTTP, content-type, idle, and EOF outcomes, undercount memory while mirroring is blocked, leave or publish an incomplete archive, suppress live output when the archive fails, and lacks deterministic failure-path evidence. The remaining milestones repair those gaps without replacing the working foundations.

The maintainer synchronization incorporated both changes that had already reached `main`: live raw output remains visible through Agent Relay container stdout, and every automated Codex invocation now includes `-c features.memories=false`. Executor and full-flow fixtures assert the new argument positions. These items are no longer pending Codex work, although the presentation mirror still requires the ordering, backpressure, and failure handling described below. Update this section after each remaining milestone with what was achieved, what remains, and what the tests proved.

The documentation review established a single-source-of-truth structure for an agent-only repository. The final implementation must leave `AGENTS.md` as a concise instruction and navigation layer, keep the complete operational procedure in `docs/operations/README.md`, and remove the redundant live-log file after its unique commands are preserved. Update this section after Codex completes the consolidation with the exact files changed and reference search result.

## Context and Orientation

Agent Relay is the Node.js service under `src/`. It accepts one Codex job, launches `codex exec`, persists job metadata, and exposes HTTP endpoints. The self-hosted GitHub runner uses `runner/client.mjs` to create a job, consume raw output, validate the structured result, and write a validated commit message to `$GITHUB_OUTPUT`. The runner, not Codex, performs the final Git commit and push.

`src/persistence/output-store.ts` owns each job's raw output path and in-memory lifecycle. An active state has a writable file handle used only for append and may have a separate read-only handle used by replay. The store serializes every append from stdout and stderr through one tracked promise chain. A terminal or restarted state has no writable handle and opens only an existing read-only file. Committed length is the number of bytes that were fully written and are safe to replay. An offset is a zero-based byte position supplied by a reader. Writer finalization means sealing the writer against new appends, awaiting the append chain, attempting file sync and close, and recording successful finalization without yet publishing clean EOF. Failure sealing means rejecting future appends, observing the append chain, closing the writer best-effort, and publishing an error terminal even when clean finalization was impossible.

`src/execution/codex-executor.ts` launches Codex with `-c features.memories=false`, forwards stdout and stderr buffers to the output store, and mirrors committed buffers to Agent Relay container stdout. The streams are combined in callback-arrival order, meaning the order in which Node invokes their data handlers. Backpressure means counting each buffer until append and mirror handling both settle, pausing both child streams at the high-water limit, and resuming only below the low-water limit. The container mirror is secondary to file persistence and is disabled, rather than retried or made authoritative, if its stream closes or errors.

`src/application/job-service.ts` coordinates job metadata with output lifecycle. Terminal means the job will produce no more state changes because it is completed, blocked, failed, timed out, or interrupted. EOF means end of file, the point at which a stream has no more bytes. Clean terminal EOF means all child output was committed, the writer was finalized, and a terminal `JobRecord` was persisted. Readers receive an error rather than clean EOF when any of those conditions fails. Restart recovery updates accepted or running records to interrupted; replay attachment remains lazy.

`src/api/server.ts` exposes `GET /v1/jobs/{jobId}/output?offset={nonNegativeByteOffset}`. Before raw response headers are sent, errors use the normal JSON envelope. After raw streaming begins, every error closes the transport so the runner can reconnect from its last confirmed offset. A successful response is exactly HTTP `200` with `Content-Type: application/octet-stream`, and its body contains only raw bytes.

`runner/client.mjs` prepares signal handling and archive state before creating the remote job. It maintains `confirmedOffset`, the number of bytes fully handled by every currently required local sink. A local sink is one destination that handles already received bytes: the temporary archive while healthy, rolling tail, or GitHub-visible stdout while the prefix is still open. A rolling tail is a bounded in-memory copy of the last bytes received. A live prefix is the bounded initial part written while the job runs. A request transport failure occurs before an HTTP response is received. An accepted-body failure occurs while reading a valid HTTP `200 application/octet-stream` response. An idle abort deliberately interrupts an accepted body after `AGENT_RELAY_OUTPUT_IDLE_MS`. A premature clean EOF is an accepted body ending while status polling still reports a nonterminal job. A local sink failure occurs while handling bytes already received. Any completed response outside the accepted status and media type is a fatal remote result. These categories do not share recovery behavior.

The configured final archive path means a complete archive. Work-in-progress bytes use a unique temporary path in the same directory. Terminal EOF confirmed means the runner observed a terminal job state and then received clean EOF from an output request starting at its current confirmed offset with no unhandled bytes. Tail-only mode means that no complete archive can be published and the runner retains the bounded tail for final display; it does not disable the bounded live prefix.

GitHub workflow commands are specially formatted log lines that can change runner behavior. The stop-command token temporarily disables their interpretation while raw bytes are displayed. `SIGINT` and `SIGTERM` are operating-system signals that request interruption or termination; the runner uses them to enter cleanup rather than exit immediately.

This repository is maintained for agents rather than as a human-facing documentation portal. `AGENTS.md` is the concise instruction and navigation layer loaded for agent work. `docs/operations/README.md` is the canonical detailed runbook. Operational commands and recovery procedures belong in the runbook and must not be repeated in `AGENTS.md` or split into a second short document unless a future procedure becomes independently substantial.

## Plan of Work

### Milestone 1: complete Relay output lifecycle

Continue the existing implementation in `src/persistence/output-store.ts`, `src/execution/codex-executor.ts`, `src/application/job-service.ts`, and `src/persistence/job-store.ts`; do not replace the shared output store or endpoint. At the end of this milestone, active jobs have one byte-bounded writer, replay uses a separate read-only handle, terminal jobs retain no write capability, and readers see clean EOF only after output finalization and terminal-record persistence.

In `OutputStore`, replace the single shared `handle` with separate optional writer and reader handles and a writer state. The store, not `CodexExecutor`, owns one `appendChain` promise per job. `append()` first verifies that the writer state is `open`, adds its full-write operation to that chain, and updates committed length and version only from the serialized operation. A rejected append remains observable to `finalizeWriter()` and `fail()`; it is not replaced by a later successful chain.

Implement `finalizeWriter(jobId)` exactly as specified in `Interfaces and Dependencies`. Atomically change writer state from `open` to `finalizing` so every later append fails. Capture rather than immediately rethrow a rejected append chain, then attempt `sync()` and attempt `close()` even when append or sync failed. Clear the handle after successful close. Set writer state to `finalized` only when append, sync, and close all succeeded; otherwise set it to `failed` and throw `OUTPUT_WRITE_FAILED`, preserving the earliest append, sync, or close failure as the primary message and including later failures as diagnostics.

Implement `fail(jobId, error)` as error sealing, not clean finalization. From any nonterminal writer state, reject future appends, observe the append chain without replacing its failure, attempt to close the writer, set writer state to `failed`, publish the supplied error as the first terminal, increment version, and wake waiters. A close error is attached to diagnostics but does not prevent the error terminal from being published. Repeated `fail()` after an error terminal is an idempotent no-op. `complete()` requires writer state `finalized`; repeating the same clean status is an idempotent no-op. A different clean status or any clean-versus-error transition throws `OUTPUT_WRITE_FAILED` without changing the first terminal.

Make `attach(record)` lazy, read-only, and integrity-preserving. If a state already exists, ensure a reader can be opened lazily and return without replacing that state. If no state exists, require a terminal `JobRecord`; a nonterminal record without live state raises `OUTPUT_READ_FAILED`. Serialize concurrent first attachments per job. Open `record.outputPath` with mode `r`; never create, truncate, or repair it. After opening, re-check whether another caller installed a state or reader handle and close any duplicate. Create an attached state with writer state `finalized`, committed length from file size, and the clean terminal status from the record. If the file is absent or cannot be read, raise `OUTPUT_READ_FAILED` before headers. Do not eagerly attach recovered jobs in `JobService.init()`. If a read expects committed bytes but the file returns zero progress before satisfying the requested range, raise `OUTPUT_READ_FAILED` instead of returning an empty buffer.

In `CodexExecutor.run`, preserve raw callback-arrival order. Track Relay-owned `pendingBytes` and use `OUTPUT_QUEUE_HIGH_WATER_BYTES = 1048576` and `OUTPUT_QUEUE_LOW_WATER_BYTES = 262144`. Pause both child streams when pending bytes reach the high-water mark and resume only at or below the low-water mark. The executor may keep a bounded FIFO of pending chunks but does not keep an unbounded array, string, or copy of total output. A chunk remains counted from enqueue until both `OutputStore.append()` and mirror handling settle. Tests prove that maximum pending bytes do not exceed the high-water mark plus one observed stdout chunk and one observed stderr chunk.

For each queued chunk, await `OutputStore.append()` first. Only after append succeeds may the same buffer be mirrored to Agent Relay container stdout. Await `drain` when `process.stdout.write()` returns false. The same wait also listens for `error` and `close`; either event settles the wait, disables further mirroring for the current job, and cannot leave the executor waiting forever. Remove scoped mirror listeners during cleanup. Mirror failure allows persistence and Codex execution to continue and does not change committed length, reconnect offsets, job status, or the raw file. Decrement `pendingBytes` for that chunk only after append and mirror handling settle, including the mirror-disabled path.

Wait for direct child closure, stdout end, stderr end, the executor FIFO to drain, and `finalizeWriter()` before returning on success or throwing timeout, non-zero-exit, result-missing, or result-invalid errors. If append or writer finalization fails, terminate the child, retain already committed bytes, preserve the first persistence error, and return control to `JobService` with no clean output terminal published. Clear kill timers and child-stream listeners on every path. Preserve the following implemented arguments:

    --ask-for-approval
    never
    -c
    features.memories=false
    exec
    --sandbox
    danger-full-access
    --cd
    <workspace>
    <prompt>

In `JobService.execute`, persist a terminal `JobRecord` after the executor has either cleanly finalized the writer or returned a persistence failure requiring error sealing. Publish clean output completion only if clean writer finalization and terminal-record persistence both succeeded. A fully drained failed, blocked, timed-out, or interrupted job may have clean output EOF even though its job status is not successful. Persistence-write failure publishes output error after the failed terminal record is saved. Terminal-record persistence failure on either the successful-execution or failed-execution branch publishes a new `OUTPUT_WRITE_FAILED` error with message `Terminal job state could not be persisted`; it does not expose the earlier Codex error as if terminal persistence had succeeded. Release the active-job lock last.

In `JobService.create`, keep existing new-job preparation and idempotent return behavior. During rollback, attempt output discard, job deletion, and request-index removal independently and collect all cleanup failures. Change `JobStore.removeRequestId()` to accept the expected created job ID and delete only when the current mapping equals it. A missing mapping is already clean. A different mapping is preserved and reported as incomplete rollback. Preserve the original creation failure when all compensation succeeds. When cleanup is incomplete, throw `OUTPUT_PREPARATION_FAILED` with HTTP 500 and a message that identifies the original failure and every incomplete compensation; do not suppress it or claim retry safety. Add deterministic tests at the output-prepare, job-save, request-index-update, ownership-mismatch, and rollback-cleanup boundaries.

From the repository root, run `npm run build` and the compiled executor and integration tests listed in `Concrete Steps`. Success means the first bytes are readable before child exit, final bytes remain available on timeout and non-zero exit, completed jobs do not accumulate writable file handles, missing terminal files never become empty clean streams, mirror failure does not affect persisted bytes, rollback does not remove a foreign mapping, and terminal persistence failure cannot look like clean EOF.

### Milestone 2: harden the raw-output HTTP endpoint

Continue the existing route in `src/api/server.ts`. At the end of this milestone, all validation, attachment, range, and initial-read failures before raw headers use JSON, and every failure after raw streaming starts closes the transport without attempting another JSON response.

Validate missing, malformed, and out-of-range offsets before raw headers. Return HTTP `400` JSON for malformed offsets and HTTP `416` JSON for an offset beyond committed length. Perform lazy attachment and the first read required for the requested committed range before committing headers, retain that first chunk, and write it only after the raw headers are committed. Once `res.headersSent` is true, destroy the response for every Relay or unknown error and never call `sendJson()`. Continue to honor `ServerResponse.write()` backpressure. The backpressure wait checks for an already destroyed response, listens for `drain`, `error`, and `close`, removes all three listeners on every resolution path, and rejects on `error` or `close`. Abort and remove output-store waiters when the client disconnects. The stream loop fails rather than continuing when committed bytes remain but a read makes no offset progress.

From the repository root, run `npm run build` and `node --test dist/test/integration.test.js`. Success means tests demonstrate replay from zero and a middle offset, live delivery before child completion, waiting at active EOF, clean closure at terminal EOF, `400` and `416` JSON before headers, missing-file, nonterminal-attachment, and initial-read JSON errors before headers, connection destruction for every failure after headers, already-destroyed response handling, and waiter cleanup after client abort.

### Milestone 3: make runner archive and finalization reliable

Revise the existing streaming loop in `runner/client.mjs`. At the end of this milestone, the final archive path exists only for a complete stream, archive degradation does not suppress the live prefix, reconnects cannot duplicate local bytes, cancellation uses the same cleanup as other failures, and GitHub command controls remain valid at every visible-output boundary.

Install `SIGINT` and `SIGTERM` handlers and initialize the common idempotent finalization state before submitting `POST /v1/jobs`. When `AGENT_RELAY_OUTPUT_ARCHIVE_PATH` is configured, remove an existing final path before job submission. Failure to remove that path is fatal because a stale file could otherwise be uploaded as the current archive. Create a unique temporary file in the same directory with exclusive mode and permissions `0600`. Archive create failure starts tail-only mode and does not block job submission. No fatal local preparation step may leave a newly submitted unobserved job.

Keep the configured final path absent while the job is active. Track terminal job observation separately from terminal EOF confirmation. Only after terminal EOF is confirmed may the runner sync and close the temporary file and atomically rename it to the final path.

Apply this exact archive failure matrix. Failure to create the temporary archive starts tail-only mode and the run may continue. Failure to append a chunk removes the temporary archive, keeps that chunk in the rolling tail, keeps live-prefix handling active, enters tail-only mode, and may continue. Failure to sync, close, or rename during final publication removes the temporary file, leaves the final path absent, and is a fatal finalization error. Do not suppress any archive error. A fatal finalization error prevents structured success output and leaves `$GITHUB_OUTPUT` unchanged. Cancellation, transport timeout, offset inconsistency, or incomplete drain removes the current temporary file and leaves no final archive. A fully drained blocked or failed job may publish a complete archive while preserving its job outcome.

Keep the rolling tail bounded independently of archive and stdout health. Process each chunk in a fixed order: update the tail, append to the temporary archive when healthy, write the permitted live-prefix slice, and only then advance `confirmedOffset`. The current chunk remains represented in the tail when archive append fails. A stdout, tail, archive, GitHub control-line, validation, or filesystem failure is local and does not reconnect. Archive create and append failures are the only handled degradation paths; every other local failure is fatal.

Separate response acquisition, accepted-body reading, and local chunk handling so a local exception cannot be caught and mislabeled as a body disconnect. Accept a response as raw output only when `status === 200` and the parsed media type, ignoring parameters and case, equals `application/octet-stream`. Any other status or media type is a fatal remote protocol error. Do not pass a mismatched body to `handleRawChunk()`.

Reconnect from unchanged `confirmedOffset` after a request transport failure, an accepted-body read failure, or an idle abort. When an accepted body ends cleanly, fetch job status once. If the status is terminal, record terminal EOF confirmation and finish draining. If the status remains accepted or running, classify the EOF as premature, wait the normal reconnect interval, and reconnect from the same offset. Failure of the status request is fatal.

For every response outside the accepted protocol, read and retain at most `MAX_REMOTE_ERROR_BODY_BYTES = 8192` bytes of its body, indicate truncation when additional bytes exist, and fail immediately without polling or reconnecting. Advance `confirmedOffset` only after all required handling for the complete chunk succeeds.

The first signal aborts the active response, enters the common finalization path, removes incomplete archives, restores GitHub command processing, and exits non-zero. Additional signals do not run cleanup twice. Remove both signal handlers after finalization so tests and repeated invocations do not leak listeners. Use the same finalization path for every outcome, including failure before job creation. Finalize output before validating the final result, printing structured success, removing `.agent-relay`, or appending the commit message to `$GITHUB_OUTPUT`. Replace the no-change early return with normal control flow so a finalization failure is always checked before success.

Track the last byte actually written to stdout separately from the last received and last archived bytes. Ensure stop and restore commands begin on their own lines when the visible prefix or final tail lacks a trailing newline. Exclude control lines and presentation-only newlines from the archive, tail counters, received counters, and Relay offsets.

From the repository root, run `npm run build` and `node --test dist/test/runner-client.test.js`. Success means tests prove archive and signal preparation before job submission, exact archive bytes, absence of the final path before terminal EOF, fatal stale-path removal failure without a submitted job, cleanup after every archive operation failure, continued live prefix after archive degradation, reconnect without gaps or duplicates for request failure, body failure, idle abort, and premature EOF, immediate failure for wrong status or media type with an 8192-byte diagnostic limit, no reconnect after a local sink or status-poll error, bounded prefix and tail presentation, line-safe command restoration, signal cleanup, and unchanged `$GITHUB_OUTPUT` after finalization failure.

### Milestone 4: close the evidence gap

Extend the existing tests rather than replacing the first-pass architecture. At the end of this milestone, every original acceptance claim and every finding recorded in this plan has a deterministic regression test or a recorded external blocker, and one full-flow scenario proves that live output, reconnect, archive identity, result validation, and commit control work together.

Relay and executor tests must cover arbitrary bytes, invalid UTF-8, split multibyte sequences, ANSI text, token-like strings, stdout/stderr callback order, output above the removed cap, store-owned append serialization, rejected-chain preservation, finalize-after-rejected-append cleanup, the exact high-water and low-water queue behavior, mirror-in-flight byte accounting, the permitted one-chunk-per-stream overshoot, the exact memories-disabled arguments, persistence-before-mirror ordering, mirror `drain`, mirror `error`, mirror `close`, release of a pending drain wait, output-write failure, sync failure, close failure, timeout and non-zero exit, separate writer and reader handles, clean writer closure, error sealing without clean finalization, read-only terminal attachment, missing terminal files, nonterminal attachment rejection, concurrent attachment, first-terminal-wins transitions, terminal-persistence failure on both execution branches, repeated-job file-handle behavior, zero-progress read, creation rollback, compare-and-delete ownership mismatch, rollback cleanup failure and exact error code, idempotent preservation, and replay for completed, blocked, failed, timed-out, and interrupted jobs.

Endpoint tests must cover authentication, malformed and high offsets, exact replay, active following, retained pre-header first read, backpressure, response `error` and `close`, already-destroyed response, client abort cleanup, pre-header JSON errors, post-header transport destruction for Relay and unknown errors, missing output, nonterminal attachment, zero-progress read, and reconnect from a confirmed offset. Runner tests must cover pre-submit archive and signal preparation, no job submission after fatal preparation, live bytes before terminal state, byte-identical temporary and final archives, mode `0600`, stale final-path removal and failure, every archive operation failure with the exact matrix above, live prefix during tail-only mode, terminal EOF publication, premature clean EOF, idle abort, complete archives for fully drained failed or blocked jobs, incomplete outcomes, exact reconnect, local sink failure, status-poll failure, HTTP `200` and exact media-type acceptance, rejection of other `2xx`, wrong or missing media type, every non-2xx status as fatal, 8192-byte response-body truncation, bounded tail-only mode, exact prefix and non-duplicated tail, inert command-looking raw text, signal cleanup and listener removal, no-change finalization failure, and commit output only after successful finalization.

Add one controlled full-flow test. Its fake Codex emits binary stdout, waits until the runner observes it, emits stderr and more stdout across a small visible-prefix limit, experiences one retryable accepted-body disconnect, writes a valid result file, and exits successfully. Compare exact Relay and archive bytes and prove live-before-exit behavior, reconnect identity, bounded visible output, non-duplicated tail, valid GitHub command controls, result validation, worktree correspondence, and commit-message behavior.

From the repository root, run `npm run check`. Success means the Node test summary reports zero failures. After the final tests are added, replace the placeholder expectation in `Artifacts and Notes` with the exact number of passing tests observed on the repaired head. Then run every Docker command in `Concrete Steps`; each command must exit zero.

### Milestone 5: consolidate agent-facing operations documentation

Consolidate the operations documentation only after the final implementation behavior is known. At the end of this milestone, an agent has one canonical detailed operations source, no live-log procedure is duplicated, and the deleted file has no remaining references.

Move every unique and still-correct instruction from `docs/operations/live-codex-logs.md` into an explicit `Live Codex logs` section of `docs/operations/README.md`. Preserve both supported commands, `docker compose logs -f agent-relay` and `bash scripts/follow-codex-logs.sh`, and explain when each is used. Keep the authoritative persisted-log path, the distinction between persisted bytes and the Docker presentation mirror, the bounded GitHub prefix and tail, archive completeness behavior, recovery behavior, and the warning that raw output is unredacted sensitive execution data. Reconcile this material with the existing `GitHub logs` and `Recovery` sections instead of copying the same statements into multiple sections.

Delete `docs/operations/live-codex-logs.md` after its unique content is present in the canonical runbook. Search the full repository for `live-codex-logs.md` and update or remove every reference. Do not replace it with another single-purpose log document in this change.

Update `AGENTS.md` with one concise instruction that agents handling configuration, startup, dispatch, logs, diagnostics, or recovery must use `docs/operations/README.md`. Do not copy commands, raw-output semantics, troubleshooting steps, or recovery procedures into `AGENTS.md`; its role is instruction and navigation, while the runbook owns operational detail.

Review `docs/operations/README.md` after consolidation as an agent entrypoint. It must be self-contained, use current behavior rather than planned behavior, contain no claim that relay-side streaming is future work, and avoid contradictory descriptions of redaction, total-output caps, archive publication, or log authority.

No new runtime test is required solely for moving Markdown. Validate the documentation structure with the static commands in `Concrete Steps`, then include the documentation files in the final repository review. If an existing documentation-link or Markdown check exists, run it as part of `npm run check`; do not introduce a new external documentation tool for this consolidation.

## Concrete Steps

Run all commands from the repository root, which is the directory containing `package.json` and `compose.yml`.

Install the exact locked dependencies:

    npm ci

After each TypeScript milestone, compile and type-check:

    npm run typecheck
    npm run build

The expected result is exit code `0` with no TypeScript diagnostics.

Run focused compiled tests while iterating:

    node --test dist/test/executor.integration.test.js
    node --test dist/test/integration.test.js
    node --test dist/test/runner-client.test.js
    node --test dist/test/flow.integration.test.js

Each command must exit `0`. Node's test summary must end with zero failed tests, for example:

    # pass <positive number recorded after implementation>
    # fail 0

New regression tests must fail against the first-pass behavior they target and pass after the repair. Before this plan is completed, update this section and `Artifacts and Notes` with the exact passing-test count from the final `npm run check` run.

Validate the operations-documentation consolidation:

    test -f docs/operations/README.md
    test ! -e docs/operations/live-codex-logs.md
    grep -F 'docker compose logs -f agent-relay' docs/operations/README.md
    grep -F 'bash scripts/follow-codex-logs.sh' docs/operations/README.md
    grep -F 'docs/operations/README.md' AGENTS.md
    test -z "$(git grep -n 'live-codex-logs\.md' -- . ':!docs/exec-plans/active/2026-07-14-stream-raw-codex-output.md' || true)"

Each command must exit `0`. The final `git grep` intentionally excludes this living plan because it records the migration history and deletion requirement; no source, agent instruction, workflow, script, or stable documentation file may still reference the deleted path.

After all milestones, run:

    npm run check
    docker compose config
    docker build --tag agent-relay:local .
    docker build --file Dockerfile.runner --tag agent-relay-runner:local .
    docker run --rm --entrypoint /bin/bash agent-relay:local /app/scripts/toolchain-smoke.sh

`npm run check` must exit `0`, report no TypeScript errors, and report the exact recorded number of passing tests with zero failures. `docker compose config` must print the resolved configuration and exit `0`. Both builds must finish successfully. The smoke script must exit `0`. Record the command, exit code, exact test count where applicable, and concise result in `Artifacts and Notes`. An unavailable Docker environment is an explicit blocker, not a passing result.

## Validation and Acceptance

Start a controlled Codex job whose first output chunk is emitted before process exit. While the child remains active, the output endpoint, Agent Relay container mirror, and runner live prefix expose that first chunk. Archive degradation does not suppress the live prefix. After completion, reading Relay output from offset zero and reading the published archive produce identical bytes.

In a reconnect scenario, deliberately fail request acquisition, close one accepted output response after committed bytes are handled, trigger one idle abort, and end one accepted body while status remains nonterminal. Each next request starts from `confirmedOffset`, and the final archive contains no gap and no duplicate. A response outside HTTP `200 application/octet-stream` fails immediately without reconnect and never buffers more than 8192 diagnostic bytes.

In an incomplete-run scenario, cancel or time out the runner before terminal EOF. The configured final archive path does not exist afterward. Injected create or append failure enters tail-only mode without disabling the live prefix. Injected stale-path removal, sync, close, or rename failure fails the runner, leaves the final path absent, and leaves `$GITHUB_OUTPUT` unchanged. Stale-path failure occurs before job submission.

In a terminal-persistence failure scenario, an active output reader receives a transport failure instead of clean EOF. In a restart scenario, an existing terminal file replays through a read-only handle, while a missing terminal file and a nonterminal record without live state return errors and do not create files. Repeated completed jobs do not retain one writable file handle per job.

In a persistence-failure scenario, a rejected append does not prevent sync and close attempts, and the earliest append, sync, or close error remains the primary output error. `fail()` still seals the state and wakes readers even though clean writer finalization did not succeed. No conflicting terminal transition changes the first terminal state.

In a mirror-failure scenario, committed output remains byte-identical, the child continues, a pending `drain` wait settles, and no reconnect or job failure results solely from Docker stdout `error` or `close`. Queue instrumentation counts the mirror-in-flight chunk and remains within the documented high-water bound and overshoot allowance.

In a creation-rollback scenario, successful compensation permits retry with the same request ID. Injected compensation failure returns `OUTPUT_PREPARATION_FAILED`, identifies incomplete cleanup, and is not represented as a clean rollback. A request-index mapping that no longer points to the created job is preserved.

In a GitHub command-safety scenario, raw output resembles workflow commands and the visible prefix ends without a newline. The raw content remains inert, the restore token begins on a new line, and `$GITHUB_OUTPUT` contains only a validated commit message after successful finalization.

The operations documentation has one canonical detailed source at `docs/operations/README.md`. It contains both live-log commands and the current persisted-log, archive, sensitivity, and recovery semantics. `docs/operations/live-codex-logs.md` is absent, no stable repository file references it, and `AGENTS.md` points agents to the canonical runbook without duplicating its commands or procedures.

The full `npm run check` command and both Docker builds pass. Documentation describes live raw output, archive completeness, archive degradation, reconnect and protocol classification, bounded prefix and tail behavior, Docker mirror degradation, sensitivity of unredacted output, automated disabling of Codex memories, and the canonical location of operational instructions.

## Idempotence and Recovery

All tests use temporary workspaces, state directories, archive paths, and injected handles, so rerunning them does not modify persistent developer state. Job creation rollback attempts every compensation independently. A retry with the same request ID is permitted only when output state, job record, and the matching created-job index entry were all restored; incomplete rollback returns `OUTPUT_PREPARATION_FAILED` and requires state repair.

An idempotent request that already maps to a valid job returns that existing job and preserves its committed output. Request-index compensation is compare-and-delete and never removes an older, foreign, or concurrently restored mapping.

Runner setup installs cleanup before submitting work. It removes the workflow-owned final archive path for the current execution before creating a unique temporary file beside it, removes only the temporary file created by the current process during cleanup, and does not glob or delete unrelated files. A failed run can be repeated without treating a previous partial file as complete. Failure to remove the owned final path is fatal before job submission.

Relay restart converts accepted or running jobs to interrupted and preserves committed output for lazy replay. It does not open every historical output file during startup. Existing terminal records remain readable when their files exist; missing or unreadable files produce `OUTPUT_READ_FAILED` without being recreated. A persisted nonterminal record without live state also produces `OUTPUT_READ_FAILED`. Validation scenarios require no manual state cleanup unless a test intentionally injects incomplete rollback and asserts the resulting blocker.

Documentation consolidation is idempotent after completion. Re-running the milestone leaves `docs/operations/README.md` as the sole detailed operations source, does not recreate `docs/operations/live-codex-logs.md`, and does not append duplicate runbook sections or duplicate `AGENTS.md` pointers.

## Artifacts and Notes

The first implementation is commit `104e23cc164cdd0e587fb0dad1b07f4fc27047b9`, titled `Implement raw Codex output streaming`. It created the current architecture and prematurely recorded the plan as complete. This plan incorporates the relevant history because the earlier completed-plan file is no longer the execution source.

The synchronized branch is based on `main` commit `7c242764664fc209fed4163c627c4530351e5c41`. The executor combines the raw-output pipeline with live container mirroring and `-c features.memories=false`; `test/executor.integration.test.ts`, `test/flow.integration.test.ts`, and `test/log-stream.integration.test.ts` use the resulting argument positions.

Raw stdout and stderr may contain repository content, tool output, or credentials printed by child processes. Relay files, Docker logs, GitHub-visible output, and uploaded archives are sensitive execution data. The raw stream is intentionally not redacted because byte identity is required; the structured result retains separate sensitive-data validation.

The documentation consolidation is intentionally limited to three repository effects: update `docs/operations/README.md`, delete `docs/operations/live-codex-logs.md`, and add a concise navigation pointer in `AGENTS.md`. It must not create a broader documentation hierarchy or duplicate the runbook in agent instructions.

Final validation evidence has not yet been recorded. As commands run, append dated, concise evidence here. The following line is only a format example and is not validation evidence:

    2026-07-14 20:13Z — npm run check — exit 0 — typecheck passed; Node summary reported pass <exact final count>, fail 0.

Do not record a command as passed when it was unavailable or skipped.

## Interfaces and Dependencies

Do not add a new external runtime dependency unless the Node.js standard library cannot satisfy a requirement. The current design uses Node file handles and streams, the built-in `fetch` API, `AbortController`, and HTTP response backpressure. `AbortController` is the built-in JavaScript mechanism used here to cancel a pending HTTP request.

In `src/persistence/output-store.ts`, preserve `OutputSnapshot` as the reader-visible committed-length, version, and terminal view. Replace the single-handle state with equivalent fields that separate write and replay capability and track the append chain:

    type WriterState = "open" | "finalizing" | "finalized" | "failed";

    interface OutputState {
      path: string;
      writerHandle?: FileHandle;
      readerHandle?: FileHandle;
      writerState: WriterState;
      appendChain: Promise<void>;
      committedLength: number;
      version: number;
      terminal?: OutputSnapshot["terminal"];
      waiters: Waiter[];
    }

The public `OutputStore` contract at the end of Milestone 1 includes these signatures and semantics:

    prepare(jobId: string, outputPath: string): Promise<void>
    attach(record: JobRecord): Promise<void>
    peek(jobId: string): OutputSnapshot
    append(jobId: string, chunk: Uint8Array): Promise<void>
    finalizeWriter(jobId: string): Promise<void>
    read(jobId: string, offset: number, maxBytes?: number): Promise<Uint8Array>
    waitForChange(jobId: string, observedVersion: number, signal?: AbortSignal): Promise<OutputSnapshot>
    complete(jobId: string, status: JobStatus): Promise<void>
    fail(jobId: string, error: RelayError): Promise<void>
    discard(jobId: string): Promise<void>
    close(): Promise<void>

`prepare()` creates a new `0600` file, writer handle, and resolved append chain and does not overwrite existing state. `append()` serializes full writes on the store-owned chain and changes committed length only after a full write. `finalizeWriter()` seals new appends, captures append failure, still attempts sync and close, and publishes no terminal. `complete()` requires writer state `finalized`. `fail()` seals future appends, closes best-effort, and publishes the first error even when finalization failed. `attach()` opens an existing terminal file read-only and never creates one; without existing live state it rejects a nonterminal record. `read()` lazily establishes a read-only handle and detects zero progress. `discard()` is for failed creation only and removes the state and file it created. `close()` closes every remaining writer, reader, and waiter.

In `src/persistence/job-store.ts`, use compare-and-delete semantics:

    removeRequestId(requestId: string, expectedJobId: string): Promise<"removed" | "missing" | "mismatch">

`removed` means the matching created-job mapping was deleted, `missing` means no cleanup was needed, and `mismatch` leaves the current value unchanged and is reported by creation rollback as incomplete compensation.

In `src/execution/codex-executor.ts`, define module constants with these exact values:

    const OUTPUT_QUEUE_HIGH_WATER_BYTES = 1_048_576;
    const OUTPUT_QUEUE_LOW_WATER_BYTES = 262_144;

The executor exposes no total-output cap. Its queue accounting counts a chunk from enqueue until persistence and mirror handling both settle. Container mirroring occurs after persistence and does not retain another complete output copy.

In `runner/client.mjs`, define:

    const MAX_REMOTE_ERROR_BODY_BYTES = 8_192;

The runner reads at most that many bytes from any response outside the accepted HTTP `200 application/octet-stream` protocol and marks the diagnostic as truncated when more bytes exist.

The public output route remains:

    GET /v1/jobs/{jobId}/output?offset={nonNegativeByteOffset}
    Authorization: Bearer <AGENT_RELAY_TOKEN>
    Accept: application/octet-stream

Successful responses are exactly HTTP `200` with media type `application/octet-stream`; parameters such as `charset` are ignored when comparing the parsed media type. Bodies contain only raw bytes. The route sends no heartbeat or Relay metadata into the body. Before headers, errors use the existing JSON envelope. After headers, every error destroys the response.

The runner continues to use `AGENT_RELAY_OUTPUT_ARCHIVE_PATH`, `AGENT_RELAY_GITHUB_LOG_BYTES`, `AGENT_RELAY_GITHUB_TAIL_BYTES`, and `AGENT_RELAY_OUTPUT_IDLE_MS`. `$GITHUB_OUTPUT` remains a separate control channel and receives only the validated one-line commit message after successful output finalization.

The repository documentation contract after Milestone 5 is:

    AGENTS.md
      concise agent rules and a pointer to docs/operations/README.md

    docs/operations/README.md
      canonical detailed operations runbook

    docs/operations/live-codex-logs.md
      absent after its unique content is merged

This documentation consolidation adds no runtime interface and no external dependency.

Revision note (2026-07-14 12:40Z): Compared every line of this ExecPlan with the skeleton and requirements in `.agent/PLANS.md`. The revision keeps the exact required section order, removes the nonstandard `Validation Evidence` and `Revision Note` headings, moves evidence instructions into `Artifacts and Notes`, preserves all eleven original Progress items with current done-versus-remaining state, defines repository-specific terminology for a novice reader, and adds exact milestone commands and observable acceptance behavior.

Revision note (2026-07-14 14:24Z): Synchronized the pull-request contents onto current `main`, reconciled the overlapping executor changes, and updated every affected living-document section. The plan now records live container mirroring and `-c features.memories=false` as implemented baseline behavior rather than pending Codex work, while retaining the remaining mirror robustness, lifecycle, archive, endpoint, finalization, and evidence tasks.

Revision note (2026-07-14 15:22Z): Re-reviewed the current code and made the repair contract prescriptive. This revision separates writer and reader handles, forbids fabricated terminal files, defines first-terminal-wins behavior, fixes exact queue thresholds and mirror ordering, defines archive and HTTP failure matrices, keeps live display independent of archive health, requires explicit rollback failure reporting, expands deterministic tests, and adds exact interfaces so Codex does not need to choose correctness semantics during implementation.

Revision note (2026-07-14 15:26Z): Re-reviewed the revised plan and removed its remaining lifecycle ambiguity. This revision makes `OutputStore` own append serialization, distinguishes successful writer finalization from error sealing, rejects nonterminal lazy attachment, defines stale archive and early-EOF behavior, bounds remote error diagnostics, and specifies cleanup for mirror drain waits and signal listeners.

Revision note (2026-07-14 15:29Z): Re-reviewed memory, protocol, startup, and rollback boundaries. This revision counts chunks through mirror completion, requires exact HTTP success semantics, prepares cleanup before job submission, and prevents rollback from deleting a request-index mapping it does not own.

Revision note (2026-07-14 20:13Z): Added the final agent-only documentation boundary. This revision makes `docs/operations/README.md` the canonical runbook, requires merging and deleting `docs/operations/live-codex-logs.md`, limits `AGENTS.md` to a concise navigation pointer, adds static validation commands, and prevents Codex from creating another redundant documentation layer.
