# Complete raw Codex output streaming safely

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current as work proceeds.

This document must be maintained in accordance with `.agent/PLANS.md`. Repository-specific instructions in `AGENTS.md` and the Agent Relay prompt take precedence over generic ExecPlan wording. Codex must never run `git commit`, `git push`, or equivalent commit-creation or publication commands. The GitHub runner exclusively owns commit and push.

## Purpose / Big Picture

After this work, an operator can observe Codex standard output and standard error while Codex is still running, reconnect from an exact byte offset without gaps or duplicates, and obtain a complete raw archive only after Relay has durably finalized the output and the runner has confirmed terminal end-of-file. Raw output is preserved byte-for-byte and is not redacted, decoded, or normalized.

The implementation must have one authoritative byte stream: the persisted Relay output file. Docker output and GitHub-visible output are presentation sinks only. Presentation failure must not corrupt persisted bytes, change replay offsets, or convert an incomplete run into success.

The runner may expose only a bounded live prefix and bounded final tail in GitHub logs. The configured final archive path must never contain a partial run. `.agent-relay/result.json` communicates task outcome and a proposed commit message, while `git status --porcelain` is the only source of truth for whether a commit is required. Codex never commits or pushes.

## Progress

- [x] (2026-07-13 23:33Z) Created the original raw-output design and initial implementation scope.
- [x] (2026-07-14 11:02Z) Produced the first implementation and reopened it after lifecycle, archive, endpoint, cancellation, and evidence gaps were found.
- [x] (2026-07-14 15:29Z) Defined the intended writer lifecycle, byte-bounded queue, HTTP protocol, archive publication, rollback, and failure-test requirements.
- [x] (2026-07-14 20:13Z) Defined `docs/operations/README.md` as the canonical operational runbook and identified `docs/operations/live-codex-logs.md` as redundant.
- [x] (2026-07-14 21:31Z) Rebased PR #3 onto `main` after PR #8 and preserved the runner-owned commit contract without `shouldCommit`.
- [x] (2026-07-14 21:50Z) Reviewed the rebased implementation and recorded nine merge-blocking findings: contradictory commit instructions, partial archive publication, retrying explicit HTTP failures, commit output before finalization, fabricated empty output, unfinalized writers, post-header JSON fallback, mirror-before-persistence without backpressure, and suppressed rollback failures.
- [ ] Remove every instruction that can cause Codex to create or publish commits. Update `.agent/PLANS.md`, preserve the Relay prompt prohibition, and add regression checks proving that repository instructions are consistent.
- [ ] Make job creation transactional. Attempt every compensating action, use compare-and-delete request-index cleanup, preserve foreign mappings, and report incomplete rollback as `OUTPUT_PREPARATION_FAILED`.
- [ ] Make `OutputStore` own serialized appends, separate writer and reader handles, finalize writers before clean terminal state, reject fabricated or missing replay data, and enforce first-terminal-wins semantics.
- [ ] Add bounded executor backpressure and persistence-before-mirror ordering. Mirror failure must disable only the presentation sink and must not fail or reorder authoritative persistence.
- [ ] Harden the output endpoint so every error before raw headers is JSON and every error after raw headers destroys the transport. Prevent zero-progress reads and remove waiters on client abort.
- [ ] Rework runner streaming and archive publication around a same-directory temporary file, exact HTTP protocol validation, explicit retry classes, confirmed terminal EOF, and common finalization before any success control output.
- [ ] Keep GitHub workflow commands isolated from raw bytes and track the last displayed byte independently from received and archived bytes.
- [ ] Consolidate operations documentation into `docs/operations/README.md`, delete `docs/operations/live-codex-logs.md`, and leave only a concise runbook pointer in `AGENTS.md`.
- [ ] Add deterministic regression tests for every finding and one controlled full-flow test that proves byte identity, reconnect behavior, final archive publication, result validation, and runner-owned commit behavior together.
- [ ] Run all validation commands, record exact evidence, repeat code review, resolve every finding, and move this plan to `docs/exec-plans/completed/` only when no incomplete item remains.

## Surprises & Discoveries

- Observation: the repository gives Codex contradictory commit instructions.
  Evidence: `.agent/PLANS.md` says to "commit frequently", while `AGENTS.md` and the Relay-generated prompt prohibit `git commit` and `git push`. The same agent reads both instruction sources.

- Observation: the runner currently writes directly to the configured final archive path.
  Evidence: `openArchiveIfConfigured()` opens `AGENT_RELAY_OUTPUT_ARCHIVE_PATH` with mode `w`. The workflow uploads that path with `if: always()`, so cancellation or transport failure can publish a partial file as if it were complete.

- Observation: explicit remote protocol failures are currently retried as transport failures.
  Evidence: non-success responses become `request-failed`, and the runner polls and reconnects until the global deadline. The current code also accepts successful responses without verifying the exact media type and reads error bodies without a diagnostic bound.

- Observation: result control output can be written before archive and workflow-command finalization.
  Evidence: the runner appends `commit_message` inside the main success path and invokes `finalizeOutput()` later in `finally`. The clean-worktree early return can also bypass propagation of a finalization failure.

- Observation: restart attachment can fabricate successful output.
  Evidence: `OutputStore.attach()` creates an empty file after `ENOENT`, opens it read-write, and marks the terminal state clean. Missing output is an integrity failure, not an empty successful stream.

- Observation: clean terminal state is currently independent of writer durability.
  Evidence: `complete()` sets terminal state without awaiting queued appends, syncing, or closing the writer. One `r+` handle is used for both append and replay and remains open until global shutdown.

- Observation: post-header output errors are not handled uniformly.
  Evidence: the server destroys the response after headers only for `OUTPUT_READ_FAILED`. Other Relay errors or unknown failures can fall through to `sendJson()` after `application/octet-stream` headers have already been sent.

- Observation: Docker mirroring currently precedes authoritative persistence and ignores stdout backpressure.
  Evidence: the executor calls `process.stdout.write(chunk)` before `OutputStore.append()` and ignores a `false` return value. A slow presentation sink can therefore retain unbounded data and expose bytes that were never committed.

- Observation: creation rollback suppresses evidence that repository state is inconsistent.
  Evidence: `JobService.create()` catches and ignores discard, job-delete, and request-index cleanup failures. Request-index removal is keyed only by request ID and can remove a mapping it no longer owns.

- Observation: green CI does not prove these failure paths.
  Evidence: current tests cover primary happy paths but not stale archive paths, archive operation failures, explicit HTTP protocol failures, finalization ordering, missing replay files, writer closure, post-header unknown errors, blocked mirror drain, or incomplete rollback.

## Decision Log

- Decision: the runner exclusively owns commit and push.
  Rationale: Git state is observable and deterministic, while model-declared commit intent is not. `.agent/PLANS.md` must be adapted to this repository by replacing "commit frequently" with progress-plan updates and validation checkpoints. The Relay prompt and `AGENTS.md` must continue to prohibit commit and push explicitly.
  Date/Author: 2026-07-14 / PR review.

- Decision: Agent Relay persistence is authoritative; Docker and GitHub output are presentation sinks.
  Rationale: bytes must be durably committed before they are mirrored. Presentation failure may disable that sink but cannot alter persisted length, output status, or reconnect offsets.
  Date/Author: 2026-07-14 / PR review.

- Decision: `OutputStore` owns append serialization and separate write and replay capabilities.
  Rationale: stdout and stderr callbacks can arrive concurrently. A store-owned append chain defines one committed byte order. Closing the writer must not prevent terminal replay through a separate read-only handle.
  Date/Author: 2026-07-14 / PR review.

- Decision: clean writer finalization and error sealing are separate operations.
  Rationale: clean EOF is valid only after queued appends, sync, and close succeed. A failure path must still reject later appends, close best-effort, publish an error terminal, and wake readers even when clean finalization cannot succeed.
  Date/Author: 2026-07-14 / PR review.

- Decision: terminal attachment is lazy, read-only, and integrity-preserving.
  Rationale: a missing or unreadable terminal output file returns `OUTPUT_READ_FAILED`; it is never created or repaired. A persisted nonterminal record without an existing live state is also invalid for attachment.
  Date/Author: 2026-07-14 / PR review.

- Decision: the configured archive path means complete output only.
  Rationale: the runner writes a unique temporary file in the same directory and atomically renames it only after confirmed terminal EOF, successful sync, and successful close. Failure, timeout, cancellation, or incomplete drain leaves the final path absent.
  Date/Author: 2026-07-14 / PR review.

- Decision: accept only HTTP `200` with media type `application/octet-stream` as an output response.
  Rationale: every other response is an explicit remote protocol result, not a retryable transport interruption. Diagnostics are bounded to 8192 bytes.
  Date/Author: 2026-07-14 / PR review.

- Decision: retry only failures that cannot have completed local handling of new bytes.
  Rationale: request acquisition failure, accepted-body read failure, idle abort, and premature EOF with a nonterminal job can reconnect from unchanged `confirmedOffset`. Local sink failure, status-poll failure, offset rejection, or invalid HTTP response is fatal and must not reconnect.
  Date/Author: 2026-07-14 / PR review.

- Decision: finalization precedes every success side effect.
  Rationale: the runner must restore workflow-command parsing, confirm or remove the archive, and settle cleanup before printing structured success, deleting result metadata, returning success for a clean worktree, or writing `commit_message` to `$GITHUB_OUTPUT`.
  Date/Author: 2026-07-14 / PR review.

- Decision: creation rollback uses compare-and-delete ownership and reports incomplete compensation.
  Rationale: compensation must never delete a request-index mapping that no longer points to the newly created job. Every cleanup action is attempted independently, and any incomplete cleanup produces `OUTPUT_PREPARATION_FAILED` with all failures included.
  Date/Author: 2026-07-14 / PR review.

- Decision: one canonical operations runbook remains the documentation boundary.
  Rationale: `AGENTS.md` contains durable rules and one navigation pointer. `docs/operations/README.md` owns configuration, startup, dispatch, live logs, persisted logs, recovery, and credential rotation. The redundant live-log file is deleted after unique instructions are merged.
  Date/Author: 2026-07-14 / documentation review.

## Outcomes & Retrospective

The branch contains the central architecture: a shared output store, authenticated offset endpoint, runner streaming loop, bounded GitHub presentation, and structured result validation. It also preserves the post-PR-#8 contract in which the runner uses actual Git state and Codex does not decide whether a commit is required.

The implementation is not complete. The current code can expose partial archives, retry explicit remote failures, publish commit control output before finalization, fabricate missing terminal output, expose clean EOF before writer durability, write JSON after raw headers, allow presentation backpressure to retain output without a byte bound, and hide incomplete rollback. These are merge blockers even though current CI passes.

Completion means each blocker has a deterministic regression test, all tests pass, the operational documentation matches the implemented behavior, the final review finds no unresolved mismatch, and this file is moved unchanged except for final evidence and retrospective updates to `docs/exec-plans/completed/`.

## Context and Orientation

Agent Relay is the Node.js service under `src/`. It accepts one Codex job, launches `codex exec`, persists job metadata, and exposes HTTP endpoints. The GitHub Actions runner uses `runner/client.mjs` to create a job, consume raw output, validate `.agent-relay/result.json`, inspect the Git worktree, and pass a commit message to `/runner/finalize.sh`. The runner, not Codex, commits and pushes.

`.agent/PLANS.md` defines generic ExecPlan behavior. `AGENTS.md` defines repository-specific constraints. `src/execution/prompt.ts` builds the direct instruction sent to Codex. These three sources must agree that Codex updates the plan and working tree but never runs commit or push commands.

`src/persistence/output-store.ts` owns raw output lifecycle. Committed length is the number of bytes fully persisted in the serialized append order. An active state has a writer handle and may lazily open a separate read-only replay handle. Writer finalization seals new appends, awaits the append chain, syncs, closes, and records whether clean finalization succeeded. Error sealing closes best-effort and publishes an error terminal even if clean finalization failed.

`src/execution/codex-executor.ts` launches Codex with `-c features.memories=false`, receives stdout and stderr buffers, queues them in callback-arrival order, appends each buffer to `OutputStore`, and then optionally mirrors that same committed buffer to container stdout. Backpressure is a byte-counted high-water and low-water mechanism that pauses both child streams while Relay-owned buffers exceed the configured bound.

`src/application/job-service.ts` coordinates output state, job records, idempotent request IDs, terminal ordering, and creation rollback. A terminal job status is `completed`, `blocked`, `failed`, `timed_out`, or `interrupted`. Clean output EOF does not mean the job succeeded; it means all bytes were committed, the writer was finalized, and terminal metadata was persisted.

`src/api/server.ts` exposes `GET /v1/jobs/{jobId}/output?offset={nonNegativeByteOffset}`. Before raw headers are sent, validation, attachment, range, and initial-read errors use the JSON error envelope. After raw headers are sent, any error destroys the transport so the runner can reconnect only when its failure classification permits it.

`runner/client.mjs` owns remote output consumption, the rolling tail, bounded live prefix, workflow-command isolation, reconnect classification, temporary archive publication, result validation, worktree inspection, and `$GITHUB_OUTPUT`. `confirmedOffset` advances only after every required local action for a complete chunk succeeds.

The final archive path is controlled by `AGENT_RELAY_OUTPUT_ARCHIVE_PATH`. A temporary archive is a unique `0600` file beside the final path. Terminal EOF is confirmed only when the runner has observed a terminal job state and then receives clean EOF from a valid output response starting at its current confirmed offset.

## Plan of Work

### Milestone 0: make agent instructions internally consistent

Update `.agent/PLANS.md` so its implementation guidance does not tell Codex to commit. Replace the repository-incompatible phrase "commit frequently" with an instruction to update the ExecPlan at each stopping point, run validation frequently, and leave commit and push to the runner. Do not weaken the existing prohibition in `AGENTS.md` or `src/execution/prompt.ts`.

Add or extend a contract test that reads `.agent/PLANS.md`, `AGENTS.md`, and the generated prompt. It must assert that the plan rules contain no instruction for Codex to commit or push and that both repository instructions and the generated prompt explicitly assign commit and push to the runner. Search for command-equivalent wording such as creating commits, publishing commits, pushing branches, and committing frequently.

Acceptance for this milestone is that a fresh Codex execution receives one unambiguous Git ownership rule from every instruction source.

### Milestone 1: make output persistence and job creation transactional

Refactor `src/persistence/output-store.ts` so `OutputState` has `writerHandle`, optional `readerHandle`, `writerState`, a store-owned `appendChain`, committed length, version, terminal state, and waiters. `append()` serializes full writes on the chain. A rejected append remains observable to finalization; later work must not replace the rejected chain with a successful promise.

Implement `finalizeWriter(jobId)` as a clean-only operation. Atomically move from `open` to `finalizing`, reject later appends, await the append chain, attempt sync, and attempt close even if an earlier step failed. Clear the writer handle after close. Set `finalized` only when append, sync, and close all succeed. Otherwise set `failed` and throw `OUTPUT_WRITE_FAILED`, preserving the earliest failure and including later cleanup failures as diagnostics.

Implement `fail(jobId, error)` as error sealing. It rejects future appends, observes the append chain, closes the writer best-effort, records writer state `failed`, publishes the supplied error as the first terminal state, increments version, and wakes readers. Repeating the same error terminal is an idempotent no-op. `complete(jobId, status)` requires writer state `finalized`. Terminal transitions are first-wins: a different terminal transition raises `OUTPUT_WRITE_FAILED` without replacing the original state.

Make `attach(record)` lazy and read-only. If no live state exists, require a terminal record and open the existing file with mode `r`. Never create, truncate, or repair the file. Missing or unreadable output returns `OUTPUT_READ_FAILED`. A nonterminal record without live state also returns `OUTPUT_READ_FAILED`. Serialize concurrent first attachment and close duplicate handles. A read that expects committed bytes but receives zero progress returns `OUTPUT_READ_FAILED`.

In `src/application/job-service.ts`, finalize the writer before persisting a clean terminal record. Persist terminal metadata before publishing clean output completion. If terminal metadata persistence fails, publish an output error `Terminal job state could not be persisted`; never expose clean EOF. Failed execution paths still fully drain and finalize output when persistence is healthy, but output persistence errors use error sealing.

Make job creation rollback exhaustive. Attempt output discard, job deletion, and request-index cleanup independently. Change `JobStore.removeRequestId(requestId, expectedJobId)` to return `removed`, `missing`, or `mismatch`. Delete only an exact owned mapping. Preserve mismatches and report them as incomplete compensation. If all compensation succeeds, rethrow the original creation error. If any compensation fails or mismatches, throw `OUTPUT_PREPARATION_FAILED` with the original failure and every cleanup failure.

Acceptance for this milestone is that successful terminal output has no writable handle, missing persisted output cannot become an empty clean stream, a terminal-state persistence failure cannot become EOF, and failed creation never silently claims rollback succeeded.

### Milestone 2: add bounded executor backpressure and safe mirroring

In `src/execution/codex-executor.ts`, define:

    const OUTPUT_QUEUE_HIGH_WATER_BYTES = 1_048_576;
    const OUTPUT_QUEUE_LOW_WATER_BYTES = 262_144;

Maintain a FIFO of buffers and an exact `pendingBytes` count. A buffer remains counted from enqueue until persistence and mirror handling both settle. Pause both child streams when pending bytes reach the high-water threshold and resume only when pending bytes fall to or below the low-water threshold. The allowed overshoot is at most one already-observed stdout chunk plus one already-observed stderr chunk.

For each buffer, await `OutputStore.append()` first. Only after persistence succeeds may the exact buffer be written to container stdout. When `process.stdout.write()` returns false, await `drain`, but also listen for `error` and `close`. Either failure releases the wait, disables mirroring for the remainder of that job, removes scoped listeners, and allows authoritative persistence and Codex execution to continue. Mirror failure must not alter committed length, reconnect offsets, job status, or raw bytes.

Wait for child close, stdout end, stderr end, FIFO drain, and `finalizeWriter()` before returning or throwing timeout, non-zero exit, missing result, or invalid result. On append or finalization failure, terminate the child, retain committed bytes, preserve the first persistence error, and return control without clean output completion.

Acceptance for this milestone is byte-identical persistence across arbitrary binary stdout and stderr, bounded Relay-owned memory under blocked mirroring, persistence-before-presentation ordering, and no hang or job failure when the mirror closes or errors.

### Milestone 3: harden the authenticated output endpoint

In `src/api/server.ts`, perform attachment, offset validation, and the first required read before `flushHeaders()`. Preserve the first chunk and write it after committing `200 application/octet-stream` headers. Return `400` JSON for missing or malformed offsets and `416` JSON for offsets beyond committed length.

After headers are sent, every error class destroys the response: `OUTPUT_READ_FAILED`, `OUTPUT_WRITE_FAILED`, any other `RelayError`, and unknown exceptions. Never call `sendJson()` after `res.headersSent` is true. `writeChunk()` must reject when the response is already destroyed and must listen for `drain`, `error`, and `close`, removing every listener on every path. A client disconnect aborts the current wait and removes its output-store waiter.

When committed bytes remain, a zero-length read is `OUTPUT_READ_FAILED`; do not spin. Clean EOF is sent only for a clean terminal snapshot after every committed byte has been written.

Acceptance for this milestone is deterministic JSON before headers, deterministic transport destruction after headers, no `ERR_HTTP_HEADERS_SENT`, no waiter leak after abort, and no zero-progress loop.

### Milestone 4: make runner protocol, archive, and finalization reliable

Before submitting `POST /v1/jobs`, install idempotent `SIGINT` and `SIGTERM` handlers and initialize cleanup state. When `AGENT_RELAY_OUTPUT_ARCHIVE_PATH` is configured, remove any stale final path before submission. Failure to remove it is fatal and must prevent job submission. Create a unique temporary archive in the same directory with exclusive mode and permissions `0600`. Archive creation failure may degrade to tail-only mode, but no fatal preparation step may leave an unobserved submitted job.

Keep the final archive path absent while the job runs. Process each received chunk in this order: update the bounded tail, append to the temporary archive if healthy, write the permitted live-prefix slice, then advance `confirmedOffset`. Archive append failure removes the temporary file, preserves the current chunk in the tail, keeps live-prefix display active, enters tail-only mode, and may continue. No other local sink failure reconnects.

Accept an output response only when `status === 200` and the parsed media type, ignoring case and parameters, is exactly `application/octet-stream`. Every other status or media type is fatal. Read at most `MAX_REMOTE_ERROR_BODY_BYTES = 8192` bytes for diagnostics and mark truncation if more bytes exist. `401`, `404`, `416`, `429`, `5xx`, other `2xx`, missing content type, and wrong content type are never retried as transport failures.

Retry only request acquisition failure, valid-body read failure, idle abort, or clean EOF while the current job status is still nonterminal. Reconnect from unchanged `confirmedOffset`. A status-poll failure is fatal. A clean EOF becomes terminal EOF only after a terminal job state is observed.

After confirmed terminal EOF, sync and close the temporary archive and atomically rename it to the final path. Sync, close, or rename failure is fatal, removes the temporary file, leaves the final path absent, and leaves `$GITHUB_OUTPUT` unchanged. Cancellation, timeout, invalid protocol, offset inconsistency, incomplete drain, and local fatal errors also remove the temporary file and leave the final path absent.

Use one common finalization path for every exit. It restores GitHub command processing, removes signal handlers, closes or removes archive state, and records any finalization failure. Do not use a success-path early return. Finalization must finish successfully before printing structured success, deleting `.agent-relay`, returning success for a clean worktree, or appending `commit_message` to `$GITHUB_OUTPUT`.

Track the last byte actually displayed separately from the last byte received or archived. Stop and restore workflow-command lines must start on their own lines even when visible raw output lacks a trailing newline. Presentation-only newlines and control lines do not affect archive bytes, tail accounting, or confirmed offsets.

Acceptance for this milestone is that the final archive exists only for complete output, explicit remote failures fail immediately, reconnects do not duplicate bytes, finalization failure cannot publish commit control output, and raw workflow-command-looking text remains inert.

### Milestone 5: close the test and documentation gaps

Add deterministic failure injection rather than relying on timing or unavailable external systems.

Output-store and job-service tests must cover serialized concurrent appends, rejected-chain preservation, sync and close attempts after append failure, separate writer and reader handles, writer closure after every terminal status, first-terminal-wins behavior, missing terminal files, nonterminal attachment, concurrent attachment, zero-progress read, terminal-record persistence failure, creation failure after each persistence step, compare-and-delete mismatch, every rollback cleanup failure, and idempotent retry preserving existing bytes.

Executor tests must cover arbitrary bytes, invalid UTF-8, split multibyte sequences, stdout/stderr callback order, output above the removed cap, exact high-water and low-water behavior, permitted overshoot, persistence-before-mirror ordering, blocked mirror drain, mirror `error`, mirror `close`, listener cleanup, timeout, non-zero exit, append failure, writer sync failure, writer close failure, and exact Codex arguments including `features.memories=false`.

Endpoint tests must cover authentication, malformed and high offsets, retained first read before headers, active following, exact replay, response backpressure, already-destroyed response, `drain`, `error`, and `close`, client abort cleanup, missing output, nonterminal attachment, zero-progress read, JSON errors before headers, and transport destruction for every Relay and unknown error after headers.

Runner tests must cover stale final-path removal before submission, no submission after fatal preparation, temporary file mode and same-directory placement, absence of final path before terminal EOF, exact archive bytes, archive create and append degradation, sync, close, and rename failure, signal cleanup, request acquisition failure, body disconnect, idle abort, premature EOF, terminal EOF, status-poll failure, offset rejection, every non-accepted HTTP status and media type, 8192-byte diagnostic truncation, no reconnect after local failure, live prefix in tail-only mode, bounded prefix and tail, workflow-command isolation, clean-worktree finalization failure, and `$GITHUB_OUTPUT` only after successful finalization.

Add a controlled full-flow test in which fake Codex emits binary stdout, waits until the runner observes it, emits stderr and additional stdout across a small prefix limit, experiences one retryable valid-body disconnect, writes a valid result file, and exits successfully. Prove exact Relay bytes, exact archive bytes, live-before-exit behavior, reconnect identity, bounded and non-duplicated presentation, valid workflow-command controls, result validation, Git-based commit decision, and absence of any Codex-created commit.

Update `.agent/PLANS.md` tests or static checks so the phrase "commit frequently" and equivalent model-owned commit instructions cannot return. Preserve explicit prohibitions in `AGENTS.md` and the generated prompt.

Merge the unique live-log commands and current semantics from `docs/operations/live-codex-logs.md` into a `Live Codex logs` section in `docs/operations/README.md`. Preserve:

    docker compose logs -f agent-relay
    bash scripts/follow-codex-logs.sh

Document authoritative persisted bytes, presentation mirrors, bounded GitHub prefix and tail, archive completeness, recovery, and the fact that raw output is unredacted sensitive execution data. Delete `docs/operations/live-codex-logs.md`. Add one concise `AGENTS.md` pointer to `docs/operations/README.md` without duplicating procedures.

Acceptance for this milestone is that every merge blocker has a regression test, the full flow proves all boundaries together, and agents have one consistent instruction source and one canonical operations runbook.

## Concrete Steps

Run all commands from the repository root.

Install locked dependencies and build:

    npm ci
    npm run typecheck
    npm run build

Run focused tests while implementing:

    node --test dist/test/contracts.test.js
    node --test dist/test/executor.integration.test.js
    node --test dist/test/integration.test.js
    node --test dist/test/runner-client.test.js
    node --test dist/test/flow.integration.test.js

Verify the Git ownership instructions:

    ! grep -F 'commit frequently' .agent/PLANS.md
    grep -F 'runner exclusively owns commit and push' AGENTS.md
    grep -F 'Never run git commit, git push' src/execution/prompt.ts

Automated tests must also perform semantic assertions that no instruction source assigns commit or push to Codex.

Verify documentation consolidation:

    test -f docs/operations/README.md
    test ! -e docs/operations/live-codex-logs.md
    grep -F 'docker compose logs -f agent-relay' docs/operations/README.md
    grep -F 'bash scripts/follow-codex-logs.sh' docs/operations/README.md
    grep -F 'docs/operations/README.md' AGENTS.md
    test -z "$(git grep -n 'live-codex-logs\.md' -- . ':!docs/exec-plans/active/2026-07-14-stream-raw-codex-output.md' || true)"

Run the full validation suite:

    npm run check
    git diff --check
    docker compose config
    docker build --tag agent-relay:local .
    docker build --file Dockerfile.runner --tag agent-relay-runner:local .
    docker run --rm --entrypoint /bin/bash agent-relay:local /app/scripts/toolchain-smoke.sh

Every available command must exit zero. Record the exact Node test count and zero failures in `Artifacts and Notes`. If Docker is unavailable, record it as an explicit unresolved validation blocker rather than a pass.

## Validation and Acceptance

The following nine review findings are explicit merge gates:

1. No instruction source tells Codex to commit or push. `AGENTS.md`, `.agent/PLANS.md`, and the generated Relay prompt agree that the runner owns these operations.
2. The final archive path is absent until confirmed terminal EOF and atomic publication. Every incomplete outcome leaves it absent.
3. Only HTTP `200 application/octet-stream` is accepted. Explicit remote errors and protocol mismatches fail immediately with bounded diagnostics and no reconnect.
4. Common finalization succeeds before any structured success, clean-worktree success return, metadata deletion, or `$GITHUB_OUTPUT` write.
5. Missing or unreadable terminal output returns `OUTPUT_READ_FAILED` and does not create a replacement file.
6. Every clean terminal output has completed append drain, sync, and writer close; terminal replay remains available through read-only capability.
7. Every post-header error destroys the raw response, while every pre-header error uses the JSON envelope.
8. Authoritative persistence precedes mirroring; mirror backpressure is bounded and mirror failure cannot fail persistence or the job.
9. Creation rollback attempts every compensation, preserves foreign request-index mappings, and reports incomplete cleanup as `OUTPUT_PREPARATION_FAILED`.

In the controlled full-flow scenario, first output is observable before Codex exits. Relay replay from offset zero and the published archive are byte-identical. A retryable disconnect reconnects from the exact confirmed offset without a gap or duplicate. The GitHub-visible prefix and tail remain bounded and workflow-command-looking output is inert. Codex writes a completed result but creates no commit. The runner detects repository changes with Git, finalizes output successfully, and only then publishes the validated commit message.

Do not merge the PR or move this plan to `completed/` until all nine gates have deterministic evidence and a final review reports no unresolved findings.

## Idempotence and Recovery

All tests use temporary workspaces, state directories, output files, and archive paths. Repeated runs do not alter persistent developer state.

A duplicate request ID with an identical request returns the existing job and preserves existing output. Rollback deletes only resources created by the failing attempt. A mismatched request-index mapping is preserved and reported, never silently deleted.

Runner startup removes only the configured final archive path owned by the current workflow and creates a unique temporary file beside it. Cleanup removes only that temporary file. Re-running after failure cannot mistake a prior partial file for complete output.

Relay restart marks accepted or running jobs interrupted, preserves committed output, and attaches terminal replay lazily. It does not create missing output files. Missing or unreadable data remains an explicit integrity error.

Documentation consolidation is idempotent: rerunning it does not recreate the deleted live-log file or duplicate the runbook section or `AGENTS.md` pointer.

## Artifacts and Notes

The first implementation was commit `104e23cc164cdd0e587fb0dad1b07f4fc27047b9`. PR #3 was later rebased onto `main` after PR #8, preserving runner-owned commit decisions and removing `shouldCommit` from the result contract.

The 2026-07-14 post-rebase review identified nine merge-blocking findings. Current green CI is baseline evidence only; it does not satisfy the failure-path acceptance criteria in this plan.

Raw stdout and stderr may contain repository content, tool output, or credentials printed by child processes. Relay files, Docker logs, GitHub-visible output, and uploaded archives are sensitive execution data. Byte identity requires that the raw stream remain unredacted; structured result validation remains separately protected against sensitive values.

Append final validation evidence here in this form:

    2026-07-14 HH:MMZ - npm run check - exit 0 - <exact pass count> passed, 0 failed.
    2026-07-14 HH:MMZ - docker compose config - exit 0 - configuration resolved.
    2026-07-14 HH:MMZ - docker builds and toolchain smoke - exit 0 - both images verified.

Do not record skipped or unavailable commands as passed.

## Interfaces and Dependencies

Do not add an external runtime dependency unless Node.js built-ins cannot satisfy a requirement. Use file handles, streams, `fetch`, `AbortController`, and standard HTTP primitives.

In `src/persistence/output-store.ts`, preserve a reader-visible snapshot and implement equivalent state to:

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

The public `OutputStore` contract must include:

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

In `src/persistence/job-store.ts`, implement:

    removeRequestId(requestId: string, expectedJobId: string): Promise<"removed" | "missing" | "mismatch">

In `src/execution/codex-executor.ts`, define:

    const OUTPUT_QUEUE_HIGH_WATER_BYTES = 1_048_576;
    const OUTPUT_QUEUE_LOW_WATER_BYTES = 262_144;

In `runner/client.mjs`, define:

    const MAX_REMOTE_ERROR_BODY_BYTES = 8_192;

The output route remains:

    GET /v1/jobs/{jobId}/output?offset={nonNegativeByteOffset}
    Authorization: Bearer <AGENT_RELAY_TOKEN>
    Accept: application/octet-stream

A valid response is exactly HTTP `200` with media type `application/octet-stream`; parameters and case are ignored when comparing the parsed media type. The body contains raw bytes only.

The result contract does not contain `shouldCommit`. A completed result contains a valid one-line `commitMessage`; a blocked result omits it. The runner decides whether a commit is needed exclusively from `git status --porcelain`. Codex never runs commit or push commands.

The documentation contract after completion is:

    AGENTS.md
      repository rules and one pointer to docs/operations/README.md

    .agent/PLANS.md
      ExecPlan rules adapted to runner-owned commit and push

    docs/operations/README.md
      canonical detailed operations runbook

    docs/operations/live-codex-logs.md
      absent

Revision note (2026-07-14 21:50Z): Rewrote the active plan after the post-rebase code review. The revision maps all nine merge-blocking findings to explicit implementation contracts, regression tests, and acceptance gates; adds the `.agent/PLANS.md` commit-instruction conflict as Milestone 0; strengthens archive, HTTP, finalization, writer, endpoint, mirror, and rollback requirements; and preserves the runner-owned Git contract introduced by PR #8.
