# Add restart-safe raw Codex output streaming without regressing isolation

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current while work proceeds.

Follow `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the task instruction. Files under `docs/exec-plans/completed/` are historical records, not current contracts. Every repository change required by this pull request must first be described in this plan. Do not create a second implementation plan or an alternative instruction channel. Do not run `git commit`, `git push`, `git merge`, `git rebase`, or an equivalent command that creates, rewrites, or publishes commits. The GitHub runner owns commit and push.

The architectural baseline is current `main` commit `f043af2fa9eb0420a0d64684485700f92a5dc425` from PR #9. The implementation must preserve that commit's execution, credential, filesystem, prompt, request, result-free, finalization, and public-API boundaries. Use `git show f043af2fa9eb0420a0d64684485700f92a5dc425:<path>` when the checked-out branch contains an older conflicting version. Apply raw output streaming additively to current main rather than restoring code removed by PR #9.

## Purpose / Big Picture

After this work, an operator can observe Codex standard output and standard error while Codex is still running, reconnect to the Relay output endpoint from an exact byte offset, and obtain a byte-identical terminal archive after Relay has finalized the stream. The authoritative stream is stored in the Relay-only state volume. Docker output and GitHub-visible output are presentation sinks and may fail without changing authoritative byte order or job execution.

The feature must not weaken isolation. Codex remains the fixed `agent` user launched through `/usr/local/bin/codex-run`, receives a fixed minimal environment, cannot read Relay or runner internals, can write only the selected repository and private runtime directory, and can read only that repository's Git metadata. The runner receives the Relay bearer token only in the workflow client step. Only the host Codex `auth.json` file is mounted read-only. Checkout and publication credentials remain outside Codex and Relay execution.

Raw output is intentionally unredacted and sensitive. A configured maximum protects Relay storage. Reaching the maximum fails the job and output stream explicitly; it never produces a successfully truncated stream.

Codex does not write `.agent-relay/result.json`, does not report a model-owned status, blocker, validation result, or commit message, and does not decide whether a commit is needed. Relay derives the technical job outcome from the child process. The runner derives the commit subject from the selected active plan. The finalizer uses Git as the source of truth for publication.

## Progress

- [x] (2026-07-13 23:33Z) Created the original raw-output design and initial implementation.
- [x] (2026-07-14 21:50Z) Recorded nine implementation defects and opened inline review threads.
- [x] (2026-07-15 00:42Z) Re-reviewed all 23 changed files against current main after PR #9 and replaced the obsolete repair plan with a current-main plan.
- [x] (2026-07-15 21:00Z) Rechecked the restored branch, all nine unresolved threads, current merge state, workflow status, implementation files, and tests without changing repository code.
- [x] (2026-07-15 21:00Z) Identified additional merge blockers: no durable active-job committed-length checkpoint, unbounded replay-handle/state lifetime, no response offset confirmation, retry duplication after local sink failure, ignored configured poll interval, incomplete drain failure handling, and short-read spin risk.
- [ ] Reconcile every touched file with current main, retaining only raw-output implementation, documentation, and tests.
- [ ] Preserve all current-main active-plan, request, prompt, process-outcome, runner-finalization, credential, user, environment, filesystem, packaging, and public-API contracts.
- [ ] Implement durable committed-output checkpoints, serialized appends, explicit writer finalization, first-terminal-wins semantics, exact interrupted recovery, and bounded replay resource lifetime.
- [ ] Add bounded persistence-before-presentation processing to the isolated Codex executor without restoring model result files or broad process permissions.
- [ ] Add the authenticated offset endpoint with exact offset acknowledgement, identity transfer, deterministic error semantics, and unchanged public job DTOs.
- [ ] Extend the current runner with exact protocol validation, non-duplicating retry classification, bounded presentation, workflow-command isolation, atomic archive publication, and finalization before `$GITHUB_OUTPUT`.
- [ ] Preserve workflow credential scoping and packaging isolation while adding only the output artifact configuration required by the feature.
- [ ] Update canonical documentation for raw sensitivity, output limits, checkpoints, replay, archive, failure, and recovery behavior.
- [ ] Add deterministic tests for every merge gate and every original and additional review finding.
- [ ] Run validation on the exact final head, reconcile against then-current main, and keep this plan active until GitHub reports the PR mergeable with no unresolved implementation finding.

## Surprises & Discoveries

- Observation: the branch is not based on the current architecture.
  Evidence: PR #3 head `32edacbac00be64a1b5674af2c0c81255c2c72bd` is three commits ahead and one commit behind `main`; the merge base is `7dda1338b193f491591fffce219dd4dc362bf824`; GitHub reports the PR as non-mergeable.

- Observation: the branch restores contracts deliberately removed by PR #9.
  Evidence: it restores execution modes, review findings, `blocked`, `resultPath`, `.agent-relay/result.json`, model result validation, model-proposed commit messages, broad prompt prose, `danger-full-access`, inherited process environment, runner-service Relay credentials, and a writable full Codex-home mount.

- Observation: the branch weakens public and instruction boundaries.
  Evidence: it returns internal `JobRecord` fields directly and replaces current-main active-plan-only rules with a generic `.agent/PLANS.md` that tells Codex to commit frequently.

- Observation: nine actionable inline findings remain unresolved.
  Evidence: the open threads cover contradictory commit instructions, non-atomic archives, retrying explicit HTTP responses, finalization after success publication, fabricated missing output, writer descriptor/durability failures, JSON after raw headers, mirror-before-persistence, and incomplete creation rollback.

- Observation: active-job restart correctness cannot be recovered from the current plan's terminal metadata alone.
  Evidence: `committedLength` exists only in memory while the job runs. A process crash during a positional write may leave a longer physical file but no durable boundary identifying the last fully accepted byte. File size cannot distinguish a complete chunk from an uncommitted partial chunk.

- Observation: terminal replay resources can grow without bound.
  Evidence: the prototype stores one read-write handle and one state-map entry per job until process shutdown. Merely separating writer and replay handles still leaks descriptors or memory unless terminal states and reader handles have an explicit release and eviction lifecycle.

- Observation: the offset protocol has no positive acknowledgement.
  Evidence: the client sends `?offset=N`, but a `200` response contains no header proving the server accepted and started at `N`. A stale, buggy, redirected, or misconfigured response can silently append duplicate or missing bytes.

- Observation: local sink failures are caught as remote body disconnects.
  Evidence: an exception from archive, stdout, or workflow-command handling is caught by the same block as `reader.read()`. If a chunk was already appended locally but `confirmedOffset` was not advanced, reconnecting replays that chunk and duplicates local output.

- Observation: `AGENT_RELAY_POLL_INTERVAL_MS` is not respected.
  Evidence: reconnect paths sleep for `Math.min(pollIntervalMs, 1000)`, so every configured interval above one second is silently reduced to one second.

- Observation: drain waits are incomplete.
  Evidence: runner `writeBuffer()` and `writeText()` wait only for `drain`; endpoint writes wait for `drain` or `close` but not `error`. A closed or failed stream can leave a promise pending indefinitely or crash through an unhandled error.

- Observation: committed reads can make partial or zero progress.
  Evidence: `readFully()` returns a short buffer at EOF and the endpoint loops when an expected read returns zero bytes. A file shortened after metadata validation can therefore expose a partial response and then spin instead of producing `OUTPUT_READ_FAILED`.

- Observation: output archive and terminal ordering are unsafe.
  Evidence: the final path is opened directly, archive sync errors are swallowed, and `$GITHUB_OUTPUT` can be mutated before finalization succeeds.

- Observation: presentation currently precedes persistence and has no reliable bound.
  Evidence: the executor writes to container stdout before `OutputStore.append()` and ignores mirror backpressure. The rolling tail can retain an oversized backing allocation through `subarray()`.

- Observation: startup and creation failure handling are not transactional.
  Evidence: startup eagerly attaches every recovered output file; creation rollback suppresses cleanup failures and removes the request mapping without ownership comparison.

- Observation: output storage protection was removed.
  Evidence: the branch removes `MAX_OUTPUT_BYTES`, allowing one child process to exhaust the Relay state volume.

- Observation: the current head has no qualifying CI evidence.
  Evidence: GitHub reports no workflow runs and no combined status contexts for head `32edacbac00be64a1b5674af2c0c81255c2c72bd`. Results from an earlier head do not validate the restored branch.

## Decision Log

- Decision: current main after PR #9 is the mandatory baseline.
  Rationale: raw streaming is additive observability and does not justify restoring removed control or security mechanisms.
  Date/Author: 2026-07-15 / PR review.

- Decision: the active plan is the sole task authority and must describe every repository change before it is made.
  Rationale: modes, review arrays, completed plans, PR comments, and duplicate prompt prose must not become competing implementation instructions.
  Date/Author: 2026-07-15 / PR review.

- Decision: committed output requires a durable active-job checkpoint, not only in-memory length or terminal metadata.
  Rationale: exact restart replay is impossible after a crash during a write unless the last accepted boundary is persisted independently of physical file size.
  Date/Author: 2026-07-15 / PR review.

- Decision: a byte becomes committed only after its complete batch is written, data-synced, and an atomic checkpoint containing the new length is persisted.
  Rationale: readers and reconnect offsets may only acknowledge bytes that can be reconstructed after process restart. Batching queued chunks may amortize sync cost, but append promises and reader notifications occur only after the checkpoint succeeds.
  Date/Author: 2026-07-15 / PR review.

- Decision: interrupted recovery may remove an uncommitted physical suffix only by using the durable checkpoint under exclusive recovery ownership.
  Rationale: a file longer than the checkpoint is an expected crash residue for an active job. Historical terminal attachment never creates, repairs, extends, or silently truncates data.
  Date/Author: 2026-07-15 / PR review.

- Decision: output checkpoints are authoritative for output progress and terminal facts; the terminal job record stores a matching copy.
  Rationale: duplicated metadata must be compared. Missing, malformed, or mismatched metadata is an explicit output integrity error, not a reason to infer success from status or file size.
  Date/Author: 2026-07-15 / PR review.

- Decision: replay handles and terminal state entries have a bounded lifecycle.
  Rationale: a long-running Relay must not retain one descriptor or heavyweight state object per completed job. Reads use short-lived read-only handles or reference-counted leases, and terminal state is evicted after the last active reader or waiter.
  Date/Author: 2026-07-15 / PR review.

- Decision: raw persisted output is authoritative and intentionally unredacted.
  Rationale: exact reconnect offsets and byte identity cannot be defined over independently redacted streams. Security comes from credential and filesystem isolation, authenticated access, limits, and retention controls.
  Date/Author: 2026-07-15 / PR review.

- Decision: preserve `MAX_OUTPUT_BYTES`, but convert exhaustion into explicit failure.
  Rationale: unlimited output can exhaust storage, while silent truncation falsely claims completeness.
  Date/Author: 2026-07-15 / PR review.

- Decision: persistence precedes every Relay-side presentation sink.
  Rationale: Docker logs are observations of committed bytes. Mirror backpressure or failure must not alter authoritative ordering, offsets, or job status.
  Date/Author: 2026-07-15 / PR review.

- Decision: every successful output response acknowledges its exact starting offset.
  Rationale: the runner cannot prove gap-free, duplicate-free replay from status and media type alone.
  Date/Author: 2026-07-15 / PR review.

- Decision: redirects are protocol failures.
  Rationale: automatic redirect following can change origin or representation and bypass explicit response classification. Relay requests use `redirect: "error"`.
  Date/Author: 2026-07-15 / PR review.

- Decision: only remote acquisition/body failures may reconnect; local sink failures never reconnect.
  Rationale: local effects may already have occurred. Retrying the same remote offset after a local failure can duplicate archive, tail, or presentation bytes.
  Date/Author: 2026-07-15 / PR review.

- Decision: the final archive path denotes only an atomically published complete terminal stream.
  Rationale: a failed process may still have complete diagnostic output, but incomplete transport or local finalization never leaves a final artifact.
  Date/Author: 2026-07-15 / PR review.

- Decision: public job responses remain filtered and process outcome remains result-free.
  Rationale: streaming does not require filesystem paths, internal diagnostics, model-owned status, or model-authored commit intent.
  Date/Author: 2026-07-15 / PR review.

- Decision: repository acceptance is `npm run check`, `git diff --check`, focused static checks, exact-head CI, and final GitHub review.
  Rationale: repository tests validate local code and fixtures; external deployment procedures must not be reported as executed unless they actually ran.
  Date/Author: 2026-07-15 / PR review.

## Outcomes & Retrospective

The branch contains useful prototypes for an output store, an offset route, runner streaming, and artifact handling, but it is not ready to merge. It conflicts with current main, restores obsolete and weaker architecture, has nine unresolved review findings, lacks validation on its current head, and does not yet define enough persistence state to guarantee exact restart recovery.

This revision preserves the feature and all earlier findings while adding the missing durable-checkpoint, resource-lifecycle, offset-acknowledgement, retry-duplication, poll-interval, drain-failure, and short-read requirements. Completion requires deterministic evidence for every merge gate below. Until then, this plan remains active.

## Context and Orientation

`src/execution/codex-executor.ts` launches the isolated Codex child. Current main defines the fixed launcher, user, environment, and filesystem permission profile. Extend those contracts; do not replace them.

`scripts/codex-run`, the Dockerfile, `compose.yml`, and `src/server.ts` establish the image-level boundary. Relay runs as `relay`; Codex runs as `agent`; only `auth.json` is mounted read-only; the root-owned wrapper is the launcher.

`src/application/job-service.ts` owns job creation, one-active-job admission, execution, terminal persistence, and compensation. `src/persistence/job-store.ts` owns job records and request-ID indexing. Public job responses are produced through `toPublicJob()` and must remain filtered.

`src/persistence/output-store.ts` is the authority for output bytes. Add a per-job checkpoint beside the output file, for example `logs/<jobId>.meta.json`. The checkpoint records the last durable committed length, a monotonic generation, and terminal metadata when present. Physical file size alone is never authoritative.

`src/api/server.ts` exposes authenticated APIs. Add `GET /v1/jobs/{jobId}/output?offset={nonNegativeSafeInteger}` without changing create or poll DTOs.

`runner/client.mjs` validates the selected active plan, derives the commit subject, submits and polls jobs, streams output, and writes `$GITHUB_OUTPUT`. Extend the current-main client; do not restore result-file validation, execution modes, `git status`, or model-derived commit messages.

## Plan of Work

### Milestone 0: reconcile with current main

For every changed file overlapping PR #9, begin from `git show f043af2fa9eb0420a0d64684485700f92a5dc425:<path>` and reapply only streaming-specific changes.

Preserve current-main `.agent/PLANS.md`, minimal `AGENTS.md`, minimal generated prompt, active-plan regular-file and symlink validation, request shape, process-derived statuses, plan-derived commit subject, finalizer behavior, public DTO filtering, fixed launcher, fixed user, fixed environment, filesystem restrictions, credential-free checkout, step-scoped Relay token, publication credential scope, and read-only `auth.json` mount.

Remove obsolete `mode`, `reviewFindings`, `blocked`, `resultPath`, `.agent-relay/result.json`, result validation, model commit messages, configurable Codex launcher/user, `danger-full-access`, inherited environment, runner-service Relay token, and writable full Codex-home mount.

Acceptance: all current-main boundary tests pass before relying on new streaming tests, and GitHub can compute a conflict-free merge after the streaming changes are reapplied.

### Milestone 1: durable output persistence and transactional lifecycle

Define checkpoint data equivalent to:

    interface PersistedOutputCheckpoint {
      schemaVersion: 1;
      jobId: string;
      generation: number;
      committedLength: number;
      terminal?:
        | { kind: "clean"; status: JobStatus }
        | { kind: "error"; errorCode: string; errorMessage: string };
    }

`prepare(jobId, outputPath)` creates the output file and initial checkpoint exclusively with mode `0600`. It must not truncate stale data. Any preparation failure uses the current job-preparation error contract and leaves no live state.

`append(jobId, chunk)` is serialized by the store. Queue chunks in callback order. A batch is committed only after every byte is written, the output file is data-synced, and an atomic checkpoint replacement records the new length and generation. Only then resolve append promises and wake readers. Zero-progress writes fail. If checkpoint persistence fails, the batch is uncommitted, the child is terminated, and readers receive the first output error.

Maintain exact pending-byte accounting and enforce `MAX_OUTPUT_BYTES` before accepting a chunk. Limit exhaustion terminates the child and publishes `OUTPUT_LIMIT_EXCEEDED`; it does not append a textual marker and does not publish clean EOF.

`finalizeWriter(jobId)` seals new appends, drains the queue, performs final sync, attempts close even after an earlier failure, and clears the writer handle. Persist matching terminal output metadata in both the output checkpoint and internal terminal job record. Publish clean EOF only after both persist successfully. A mismatch or persistence failure publishes an output error.

On append, sync, checkpoint, or close failure, preserve only the last durable checkpoint prefix. Persist the error terminal best-effort without replacing the first failure. Repeated terminal transitions are idempotent only when they match the first terminal.

On startup, mark accepted and running jobs interrupted as current main already does. Recover each output lazily or through an isolated recovery pass that cannot prevent service startup. Read the checkpoint; never infer committed length from file size. If the file is longer than the checkpoint, remove the uncommitted suffix only for that interrupted active job under exclusive ownership, sync the repaired file, and persist an interrupted terminal checkpoint and matching job record. If the file is missing, shorter than the checkpoint, or the checkpoint is missing, malformed, or mismatched, persist an output integrity error. Do not fabricate an empty stream.

Historical terminal attachment is read-only and never repairs data. Validate checkpoint, terminal job metadata, and physical size before replay.

Use short-lived read-only file handles per read, or a reference-counted lease closed when the last reader exits. Do not retain writable handles after finalization. Evict terminal state-map entries after the final waiter and reader release them; a later request reattaches from persisted metadata.

Make job creation compensation exhaustive. Independently attempt output/checkpoint discard, job deletion, and compare-and-delete of the exact request mapping. Preserve foreign mappings. Report incomplete cleanup rather than suppressing it.

Acceptance: a crash after any partial write, completed write before checkpoint, checkpoint before terminal record, terminal record before publication, or final sync/close point exposes only a previously durable prefix and never fabricates clean EOF. Repeated historical reads do not increase open descriptor count or retain unbounded terminal state.

### Milestone 2: isolated executor with bounded processing

Extend current-main executor and wrapper contracts. Keep the fixed `agent` user, fixed environment, private runtime directory, selected-workspace write access, read-only selected `.git`, and denied Relay, runner, sibling-workspace, agent-home, and general temporary paths.

Remove redaction only from the authoritative raw-output path and document the sensitivity. Do not broaden access to compensate for redaction removal.

Use a FIFO with exact pending-byte accounting and tested high- and low-water marks. Pause both child streams at the high-water mark and resume only at or below the low-water mark. Bound overshoot to callbacks already delivered.

For each chunk, await durable `OutputStore.append()` first. Then mirror the exact chunk to container stdout. When mirror write returns false, wait for `drain`, `error`, or `close`, clean up listeners on every path, and never wait indefinitely. A mirror failure disables only that presentation sink and does not change authoritative output or process outcome.

Wait for child close, stdout end, stderr end, queue drain, checkpoint completion, and writer finalization. Preserve current-main classification: zero exit is completed; non-zero or spawn failure is failed; deadline is timed out; restart recovery is interrupted.

Acceptance: persisted callback order is byte-identical, restart checkpoints are exact, actual Relay-owned memory remains bounded under blocked output, presentation cannot precede persistence, and all current-main isolation tests remain unchanged.

### Milestone 3: exact authenticated output protocol

Add `GET /v1/jobs/{jobId}/output?offset={nonNegativeSafeInteger}` behind the existing bearer token. Preserve public create and poll DTOs.

Validate job ID and decimal offset. Before raw headers, return the existing JSON envelope for malformed offsets, missing jobs, checkpoint/attachment failures, and offsets above committed length. Use `416` for a valid numeric offset beyond the committed length and include `X-Agent-Relay-Committed-Length`.

Before `flushHeaders()`, complete attachment, checkpoint validation, offset validation, and the first required read or terminal snapshot. Preserve the first chunk for later writing.

A valid response is HTTP `200` with:

    Content-Type: application/octet-stream
    Cache-Control: no-store, no-transform
    X-Content-Type-Options: nosniff
    X-Agent-Relay-Output-Offset: <exact requested decimal offset>

Do not set a non-identity content encoding. The acknowledged offset must exactly equal the first body byte position.

Every expected read must return the complete requested available range. A zero-progress or short read before the durable committed boundary is `OUTPUT_READ_FAILED`; never spin or silently return a shorter successful stream.

After raw headers, every Relay or unknown exception destroys the response. Never call `sendJson()` when headers are sent, the response is destroyed, or it is no longer writable. Response writes wait for `drain`, `error`, or `close`, clean up listeners, and honor client abort by removing output waiters and releasing reader leases.

Acceptance: every valid offset replays exact bytes, a missing or mismatched checkpoint never becomes clean output, the offset acknowledgement is exact, no post-header JSON is attempted, no short-read loop exists, and reader resources are released after normal completion, error, and abort.

### Milestone 4: current-main runner with non-duplicating reconnects

Keep current-main preflight first: resolve real paths, validate the selected regular non-symlink active plan, read it, derive the normalized commit subject, require `$GITHUB_OUTPUT`, and use bounded exact JSON validation.

Install idempotent `SIGINT` and `SIGTERM` cleanup handlers before submission. If a final archive path is configured, remove a stale final path before POST. Create a unique same-directory temporary file exclusively with mode `0600`. A fatal preflight or preparation error occurs before POST. Archive creation may explicitly degrade to tail-only mode if that behavior is retained and tested.

Submit only `requestId`, `workspace`, and `planPath`. Use `redirect: "error"` for every Relay request.

For output requests set `Accept: application/octet-stream` and `Accept-Encoding: identity`. Accept only HTTP `200` whose parsed media type is `application/octet-stream`, whose content encoding is absent or `identity`, whose body exists, and whose `X-Agent-Relay-Output-Offset` is a canonical decimal exactly equal to `confirmedOffset`. Missing or mismatched acknowledgement is a fatal protocol error.

For every explicit non-200 response, media mismatch, encoding mismatch, redirect, missing body, or offset mismatch, read at most 8192 diagnostic bytes where applicable and fail without reconnecting.

Keep remote reading and local handling in separate error scopes. Retry only request acquisition failure, accepted-body read failure, idle abort, or premature clean EOF while the last validated job status is nonterminal. An error thrown by archive handling, tail management, stdout/stderr, workflow-command control, JSON polling, or finalization is local and fatal; it never enters reconnect logic.

Maintain `confirmedOffset` as the number of remote bytes for which all required local handling succeeded. For each chunk, update a truly allocation-bounded tail, append to the temporary archive when healthy, write the allowed live-prefix slice, and only then advance the offset. If archive append failure is an intentional recoverable degradation, close and remove the temporary file, retain the current chunk in the bounded tail, continue live-prefix handling, and advance once; do not reconnect or append the same chunk twice.

Honor `AGENT_RELAY_POLL_INTERVAL_MS` exactly by sleeping `Math.min(pollIntervalMs, remainingDeadline)`. Do not cap configured values to one second. Use a separate documented reconnect backoff only if it is intentionally configured and tested.

Every stdout/stderr write helper waits for `drain`, `error`, or `close`, rejects on sink failure, and removes listeners. Track the last byte actually displayed separately from the last received, archived, or retained byte.

Wrap raw GitHub-visible bytes with a unique `::stop-commands::<token>` line and matching resume line. Control lines begin on their own line even when raw data has no trailing newline. Markers and presentation newlines never change offsets or archive bytes.

A clean EOF is terminal only after the job is terminal. A failed, timed-out, or interrupted process may still publish a complete archive after clean terminal EOF, but the workflow fails and `$GITHUB_OUTPUT` remains unchanged. A terminal job followed by disconnect, idle timeout, or output error is fatal and does not retry indefinitely.

After confirmed terminal EOF, sync and close the temporary archive and atomically rename it to the final path. Sync, close, or rename failure is fatal and leaves the final path absent. Signals, deadline, invalid protocol, incomplete drain, or client failure remove only the temporary file.

Use one common finalization path. It restores workflow-command parsing, removes signal handlers, settles archive publication or cleanup, and records finalization errors. Do not return from inside the protected body. Finalization must succeed before structured success or `$GITHUB_OUTPUT` mutation.

Do not read or remove `.agent-relay`, validate a model result, accept `blocked`, inspect Git status, or decide whether to commit. The finalizer retains those responsibilities from current main.

Acceptance: exact-offset reconnect has no gaps or duplicates; local sink failure after any partial local side effect does not reconnect; configured polling cadence is honored; drain failure cannot hang; archive bytes are exact; no partial final artifact exists; presentation memory is actually bounded; workflow-command-looking output is inert; and no commit output is published before finalization.

### Milestone 5: workflow, packaging, documentation, and operations

Begin workflows, examples, Compose, environment examples, Dockerfiles, server bootstrap, wrapper scripts, README, and operations documentation from current main.

Keep checkout `persist-credentials: false`, the credential-free repository check, Relay token only in the client step, publication token only in finalization, and only `HOST_CODEX_AUTH_FILE` mounted at `/home/agent/.codex/auth.json:ro`.

Keep `MAX_OUTPUT_BYTES` in configuration, Compose, docs, and executor construction. Add `AGENT_RELAY_OUTPUT_ARCHIVE_PATH` only to the client step. Upload the final archive and console log under `if: always()`; the final path is absent after incomplete output.

Document raw sensitivity, durable checkpoint semantics, recovery of uncommitted suffixes, output-limit failure, exact offset acknowledgement, redirect rejection, archive degradation, terminal archive publication, resource release, and the difference between process status and output completeness. Do not restore obsolete result, mode, blocker, or model-commit documentation.

Acceptance: credentials, user, mounts, prompt, request, and finalizer remain current-main behavior; documentation describes one consistent architecture and does not claim unexecuted external validation.

### Milestone 6: deterministic closure

Extend current-main tests rather than restoring obsolete fixtures.

Output persistence tests cover concurrent stdout/stderr appends; batching; partial and zero-progress writes; data-sync failure; checkpoint temp-write, sync, rename, and mismatch failure; crash after each write/checkpoint boundary; uncommitted suffix recovery; missing, short, long, malformed, and mismatched files/checkpoints; first-terminal-wins; writer close; terminal job/checkpoint agreement; descriptor counts; reader lease release; terminal state eviction; concurrent attachment; startup isolation; and output-limit failure.

Job-service tests cover failure after every preparation and terminal step; independent compensation; checkpoint discard failure; job deletion failure; compare-delete ownership; foreign mapping preservation; incomplete rollback diagnostics; interrupted recovery; output-error persistence; terminal persistence failure; and active-job lock release.

Executor tests cover binary bytes, invalid UTF-8, split multibyte sequences, stdout/stderr callback order, high/low-water transitions, permitted overshoot, persistence-before-mirror, blocked mirror, mirror `error` and `close`, listener cleanup, timeout, non-zero exit, spawn failure, append/checkpoint/sync/close failure, output limit, and the complete current-main isolation boundary.

Endpoint tests cover authentication; filtered public DTOs; malformed and unsafe offsets; `416` and committed-length header; exact output-offset acknowledgement; retained first read before headers; replay from every boundary; active following; short and zero-progress reads; response backpressure; response `error`, `close`, and destroyed states; client abort; waiter and reader release; clean and error restart attachment; JSON before headers; and destruction for every post-header error.

Runner tests cover current-main plan preflight and commit-subject derivation; stale final removal; no POST after fatal preparation; temporary archive mode and location; redirect rejection; identity headers; content type, content encoding, response body, and exact offset-header validation; bounded diagnostics; every status class; remote request/read/idle/premature-EOF retry; terminal disconnect failure; no retry for every local sink failure; archive append degradation without duplicate bytes; configured poll interval above and below one second; stdout/stderr drain/error/close handling; signals; exact archive; sync/close/rename failure; bounded allocation under an oversized chunk; workflow-command isolation; finalization-before-output; failed job with complete archive; and absence of result, Git-status, or `.agent-relay` behavior.

Add a controlled full-flow success test on current-main architecture. Fake Codex emits binary stdout, waits until the runner observes it, emits stderr and more stdout across a small live limit, experiences one retryable accepted-body disconnect, changes a tracked file, and exits zero without a result artifact. Prove isolation, first output before exit, durable checkpoint advancement, exact Relay and archive bytes, acknowledged exact offsets, no duplicate reconnect bytes, bounded presentation, inert control-looking output, process-derived completion, plan-derived commit subject, and finalizer-owned publication.

Add a crash-recovery full-flow test. Crash Relay after a physical partial write beyond the last checkpoint. Restart it, recover only the durable checkpoint prefix, discard the uncommitted suffix under interrupted recovery, expose an interrupted/error terminal rather than clean completion, and prove no final archive or `$GITHUB_OUTPUT` mutation.

Add a local-sink failure full-flow test. Fail GitHub-visible stdout after a chunk has reached the temporary archive but before offset advancement. Prove the client fails without reconnecting, removes the temporary archive, leaves the final path absent, and never duplicates the chunk.

After implementation, compare the diff with the recorded baseline and then-current `origin/main`. Record newer relevant main changes in this plan. Do not mark completion while GitHub reports merge conflicts, the exact head lacks passing required checks, or an implementation thread remains unresolved.

## Concrete Steps

Run from the repository root. Do not run commands that create, rewrite, or publish commits.

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

Record exact test counts, coverage, final main SHA, current head SHA, and GitHub check conclusions. Do not report unavailable external operations as passed.

## Validation and Acceptance

The following merge gates are mandatory:

1. The implementation is reconciled with then-current main and GitHub reports the PR mergeable.
2. Only the selected active plan is a task instruction; no agent instruction tells Codex to commit, merge, rebase, or push.
3. No execution mode, review-findings channel, model result artifact, model blocker/status, model validation, model commit message, or client-side Git decision exists.
4. The fixed `agent` user, wrapper, minimal environment, filesystem restrictions, selected-workspace boundary, private temp, read-only Git metadata, and denied Relay/runner/sibling paths remain tested.
5. The runner service has no Relay bearer token; checkout persists no credentials; publication credentials exist only in finalization; only `auth.json` is mounted read-only.
6. Create and poll responses expose no internal paths, output checkpoint, terminal diagnostic, or internal error message.
7. Creation attempts every compensation, compare-deletes only its own mapping, preserves foreign mappings, and reports incomplete rollback.
8. Appends are serialized and a byte is committed only after full write, data sync, and atomic checkpoint persistence.
9. Crash recovery never infers committed length from file size; it exposes only the durable checkpoint prefix and handles an uncommitted suffix explicitly.
10. Clean terminal publication drains appends, syncs, closes the writer, persists matching checkpoint and job terminal metadata, and only then publishes EOF.
11. Missing, malformed, unreadable, short, long, mismatched, or error-terminal output cannot become fabricated clean replay.
12. Writer, replay handles, reader leases, waiters, and terminal state entries have bounded lifetimes and are released on success, failure, abort, and repeated historical access.
13. Output-limit exhaustion is explicit failure and never successful truncation.
14. Authoritative persistence precedes mirroring; buffering is byte-bounded; mirror backpressure and failure cannot reorder or fail authoritative output.
15. Pre-header failures use JSON; every post-header failure destroys the transport; short or zero-progress reads cannot spin; abort cannot leak resources.
16. Every successful output response is `200 application/octet-stream`, identity encoded, `no-transform`, and acknowledges the exact requested offset.
17. The runner rejects redirects, missing bodies, media/encoding/offset mismatch, explicit HTTP failures, and oversized diagnostics without reconnecting.
18. Only remote acquisition/body/idle/premature-EOF failures while nonterminal reconnect. Local sink failures never reconnect or duplicate local bytes.
19. Reconnects resume from the exact confirmed offset without gaps or duplicates.
20. `AGENT_RELAY_POLL_INTERVAL_MS` is honored up to the remaining deadline; no hidden one-second cap exists.
21. Runner and server stream writes handle `drain`, `error`, `close`, destroyed state, and listener cleanup without hanging.
22. The final archive path is absent until terminal EOF, successful sync and close, and atomic rename. Incomplete output leaves no final artifact.
23. GitHub-visible prefix and tail are bounded in actual retained memory and keep workflow-command-looking bytes inert.
24. Common runner finalization succeeds before structured success or `$GITHUB_OUTPUT`; current-main finalizer alone owns clean-worktree and publication behavior.
25. README and operations documentation describe the result-free architecture, raw sensitivity, hard limit, checkpoints, exact replay, offset acknowledgement, archive, credentials, resource release, and recovery.
26. Every original inline finding and every additional finding in this review has a deterministic regression test.
27. `npm run check` and `git diff --check` pass on the exact final head, required GitHub checks pass for that same SHA, final review finds no mismatch, and no actionable thread remains unresolved.

Do not move this file to `docs/exec-plans/completed/` and do not resolve implementation threads before all twenty-seven gates pass.

## Idempotence and Recovery

Tests use temporary repositories, state directories, output files, checkpoints, archive paths, and local HTTP/process fixtures. Repeated runs do not alter operator state.

Job request retries preserve current-main idempotency. A matching request ID returns the existing job. Preparation rollback deletes only resources owned by the failing attempt and reports incomplete compensation.

The output checkpoint advances monotonically. A retry after process failure uses the last durable generation. Interrupted recovery may truncate only bytes beyond that checkpoint for the interrupted active job; historical terminal replay never repairs data.

The final archive path is dedicated to one workflow attempt. Startup removes a stale final path before POST and uses a unique temporary sibling. Cleanup removes only that temporary file.

A failed publication after a local commit remains the current finalizer's responsibility. Streaming code does not duplicate or bypass its recovery.

## Artifacts and Notes

Review state at this revision:

    PR: #3
    Head: 32edacbac00be64a1b5674af2c0c81255c2c72bd
    Current main: f043af2fa9eb0420a0d64684485700f92a5dc425
    Merge base: 7dda1338b193f491591fffce219dd4dc362bf824
    Comparison: 3 commits ahead, 1 commit behind, diverged
    GitHub mergeable: false
    Changed files: 23
    Unresolved inline findings: 9
    Workflow runs associated with current head: 0
    Combined status contexts on current head: 0

Append final evidence in this form:

    2026-07-15 HH:MMZ - npm run check - exit 0 - <exact tests> passed, 0 failed; coverage recorded.
    2026-07-15 HH:MMZ - git diff --check - exit 0 - no whitespace errors.
    2026-07-15 HH:MMZ - crash checkpoint tests - exit 0 - <exact cases> passed.
    2026-07-15 HH:MMZ - final current-main comparison - <main sha> - no contract regression.
    2026-07-15 HH:MMZ - exact-head GitHub checks - <head sha> - all required checks passed.
    2026-07-15 HH:MMZ - GitHub PR review - mergeable, no unresolved actionable finding.

Raw child output can contain repository content, command output, tokens, or credentials printed by tools. Relay state, Docker logs, GitHub logs, and uploaded archives are sensitive execution data. Byte preservation is intentional; access restrictions, output limits, retention, checkpoint integrity, and credential isolation are part of acceptance.

## Interfaces and Dependencies

Do not add an external runtime dependency unless Node.js built-ins cannot meet a requirement.

The public create request remains:

    interface CreateJobRequest {
      requestId: string;
      workspace: string;
      planPath: string;
    }

Public statuses remain:

    type JobStatus = "accepted" | "running" | "completed" | "failed" | "timed_out" | "interrupted";

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

A valid response starts at the exact acknowledged offset and contains authoritative raw bytes only.

Keep configuration equivalent to:

    CODEX_TIMEOUT_MS=<positive integer>
    MAX_OUTPUT_BYTES=<positive integer>

Define and test explicit queue high/low-water thresholds and:

    MAX_REMOTE_ERROR_BODY_BYTES = 8_192

The runner may receive:

    AGENT_RELAY_OUTPUT_ARCHIVE_PATH=<dedicated final path>

The final path means an atomically published complete terminal stream, never a live partial file.

Revision note (2026-07-15 21:00Z): Re-reviewed the restored implementation and expanded the plan only. Added durable active-job output checkpoints, exact crash-boundary recovery, bounded replay resource lifetime, exact response-offset acknowledgement, redirect rejection, separation of remote retryable failures from local fatal sink failures, configured poll-interval enforcement, complete drain/error/close handling, exact short-read failure, exact-head CI requirements, and corresponding deterministic tests and merge gates. No repository file other than this active plan was changed.