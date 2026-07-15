# Add raw Codex output streaming without regressing isolation

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current while work proceeds.

Follow `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the task instruction. Files under `docs/exec-plans/completed/` are historical records, not current contracts. Do not run `git commit`, `git push`, `git merge`, `git rebase`, or an equivalent command that creates, rewrites, or publishes commits. The GitHub runner owns commit and push.

The review baseline for this revision is current `main` commit `f043af2fa9eb0420a0d64684485700f92a5dc425` from PR #9. The implementation must preserve that commit's execution, credential, filesystem, prompt, request, result-free, and public-API boundaries. Use `git show f043af2fa9eb0420a0d64684485700f92a5dc425:<path>` when the checked-out branch contains an older conflicting version of a file. Apply the streaming feature additively to those current-main contracts rather than restoring code removed by PR #9.

## Purpose / Big Picture

After this work, an operator can observe Codex standard output and standard error while Codex is still running, reconnect to the Relay output endpoint from an exact byte offset, and receive a complete output artifact after Relay has finalized the stream. The authoritative stream is the file persisted in the Relay-only state volume. Docker output and GitHub-visible output are presentation sinks and may fail without changing the authoritative byte order.

The feature must not weaken the current security boundary. Codex remains a separate fixed `agent` user launched through `/usr/local/bin/codex-run`, receives a fixed minimal environment, cannot read Relay or runner internals, can write only the selected repository and private runtime directory, and can read only that repository's Git metadata. The runner receives the Relay token only in the workflow client step. Only the host Codex `auth.json` file is mounted read-only. Checkout and publication credentials remain outside Codex and Relay execution.

Raw means byte-preserving and therefore unredacted. This is an intentional behavior change from the current redacted process log and must be documented as sensitive. A configured maximum still protects Relay storage: reaching the limit fails the job and output stream explicitly instead of truncating a successful stream. No completed job may claim that a truncated stream is complete.

Codex does not write `.agent-relay/result.json`, does not report a model-owned status, blocker, validation result, or commit message, and does not decide whether a commit is needed. Relay derives the technical job outcome from the child process. The runner derives the commit message from the selected active plan. The finalizer uses Git as the source of truth for whether a commit is required.

## Progress

- [x] (2026-07-13 23:33Z) Created the original raw-output design and initial implementation.
- [x] (2026-07-14 21:50Z) Recorded nine implementation defects in the first branch version and opened inline review threads for them.
- [x] (2026-07-15 00:42Z) Re-reviewed all 23 changed files, the nine unresolved review threads, CI state, and the complete branch against current `main` after PR #9.
- [x] (2026-07-15 00:42Z) Determined that the branch is one main commit behind, GitHub reports it non-mergeable, and the previous plan targets an obsolete architecture.
- [x] (2026-07-15 00:42Z) Replaced the previous repair plan with this current-main plan and mapped both the original nine findings and the newly discovered regressions to explicit milestones and merge gates.
- [ ] Reconcile every touched file with current-main commit `f043af2fa9eb0420a0d64684485700f92a5dc425`, retaining only changes required for raw output streaming and its documentation/tests.
- [ ] Preserve the current-main active-plan, request, prompt, process-outcome, runner-finalization, credential, user, environment, filesystem, packaging, and public-API contracts.
- [ ] Implement a restart-safe output lifecycle with serialized appends, exact committed-length metadata, separate write and replay capabilities, writer finalization, first-terminal-wins semantics, and lazy integrity-preserving attachment.
- [ ] Add bounded persistence-before-presentation processing to the current isolated Codex executor without restoring model result files or broad process permissions.
- [ ] Add the authenticated offset output endpoint while preserving public job DTO filtering and deterministic pre-header/post-header error semantics.
- [ ] Extend the current runner client with exact streaming protocol validation, retry classification, bounded presentation, workflow-command isolation, complete archive publication, and finalization before `$GITHUB_OUTPUT`.
- [ ] Preserve workflow credential scoping and packaging isolation while adding only the output artifact configuration needed by the feature.
- [ ] Update the canonical README and operations documentation to describe the implemented raw-output security, limit, replay, archive, failure, and recovery behavior without restoring obsolete result-contract or execution-mode documentation.
- [ ] Add deterministic regression tests for every merge gate, including current-main security boundaries, restart corruption, output limits, compression/offset semantics, bounded memory, and the original nine findings.
- [ ] Run the complete repository-owned validation, record exact evidence, repeat review against current `main`, and keep this plan active until GitHub reports the PR mergeable with no unresolved implementation finding.

## Surprises & Discoveries

- Observation: the branch no longer has the current architecture as its base.
  Evidence: PR #3 head `b5287d4cbca94a9c447b253d8d75869b3b5d4c51` is one commit behind `main`; the merge base is `7dda1338b193f491591fffce219dd4dc362bf824`, current `main` is `f043af2fa9eb0420a0d64684485700f92a5dc425`, and GitHub reports the PR as non-mergeable.

- Observation: PR #9 intentionally removed model-owned result artifacts and narrowed the task context.
  Evidence: current `main` request data contains only `requestId`, `workspace`, and `planPath`; the prompt only points to `.agent/PLANS.md` and the selected active plan; technical completion comes from process exit; the runner derives the commit subject from the plan. The branch restores execution modes, review findings, `blocked`, `resultPath`, `.agent-relay/result.json`, result validation, model-proposed commit messages, and a long duplicate prompt.

- Observation: the branch restores a materially weaker Codex execution boundary.
  Evidence: branch `src/execution/codex-executor.ts` invokes `codex` with `--sandbox danger-full-access` and passes almost the complete Relay environment. Current `main` uses `/usr/local/bin/codex-run`, the fixed `agent` user, a fixed locale-only environment, and an explicit filesystem permission profile that denies Relay, runner, agent-home, sibling-workspace, and general temporary paths.

- Observation: the branch restores long-lived credentials and writable host state in places removed by PR #9.
  Evidence: branch `compose.yml` injects `AGENT_RELAY_TOKEN` into the runner service and mounts the complete host Codex directory writable. Current `main` gives the Relay token only to the workflow client step and mounts only `auth.json` read-only.

- Observation: the branch removes active-plan boundary validation.
  Evidence: current `main` validates a regular non-symlink file directly under `docs/exec-plans/active/` in the runner and Relay. The branch accepts a general relative Markdown path and adds secondary instruction channels through `mode` and `reviewFindings`.

- Observation: the branch output endpoint removes the current public DTO boundary.
  Evidence: current `main` strips `outputPath` and `errorMessage` from job responses. The branch returns internal `JobRecord` values directly, including internal output and result paths and detailed internal errors.

- Observation: the original `.agent/PLANS.md` review finding is now broader than one phrase.
  Evidence: the branch replaces the concise current-main file, including its active-only instruction rule and `[blocked]` convention, with a generic article copy that says to commit frequently. The correct repair is to preserve current-main `.agent/PLANS.md`, not to edit only one sentence in the obsolete copy.

- Observation: terminal replay cannot be reconstructed safely from job status and file size alone.
  Evidence: a partial write may extend the physical file before `committedLength` advances. The branch then persists a failed terminal job, and restart attachment uses `stat.size` and marks every terminal job as clean. A known write or finalization failure can therefore become clean replay after restart, including bytes that were never committed by the output state machine.

- Observation: startup currently couples service availability to every recovered output file.
  Evidence: branch `JobService.init()` eagerly attaches every interrupted job. One missing, unreadable, or corrupt log can prevent Relay startup. Replay attachment must be lazy per output request, while recovery persists enough output metadata to diagnose integrity failures.

- Observation: the configured final archive path is opened directly.
  Evidence: branch `runner/client.mjs` opens `AGENT_RELAY_OUTPUT_ARCHIVE_PATH` with mode `w`, while the workflow uploads it under `if: always()`. Cancellation, timeout, invalid protocol, or a client crash can expose a partial file as the final artifact.

- Observation: explicit HTTP responses are classified as reconnectable transport failures.
  Evidence: non-success responses are retried until the global deadline, response diagnostics are unbounded, and successful responses are accepted without an exact media-type and content-encoding contract.

- Observation: byte offsets require an identity transfer representation.
  Evidence: replay offsets count persisted bytes. The client must request `Accept-Encoding: identity`, the server must send `Cache-Control: no-transform`, and the client must reject any non-identity `Content-Encoding`; otherwise an intermediary transformation can make the next offset refer to different bytes.

- Observation: runner success side effects currently precede output finalization.
  Evidence: result cleanup, summary output, clean-worktree return, and `$GITHUB_OUTPUT` mutation occur before `finalizeOutput()`. The early return resumes after `finally` and can bypass a stored finalization failure.

- Observation: missing terminal output is fabricated as a successful empty stream.
  Evidence: branch `OutputStore.attach()` creates an empty file on `ENOENT`, opens it read-write, and publishes clean terminal state.

- Observation: clean EOF is published before append drain, sync, and writer close.
  Evidence: branch `complete()` only changes an in-memory terminal field. The same `r+` descriptor remains writable and is reused for replay.

- Observation: post-header failures do not uniformly terminate the raw transport.
  Evidence: the server destroys the response only for one output error code. Other Relay errors and unknown exceptions fall through to JSON after raw headers have been sent.

- Observation: presentation precedes persistence and has no bounded backpressure.
  Evidence: the executor calls `process.stdout.write(chunk)` before `OutputStore.append()` and ignores the return value. A slow or closed Docker stdout can retain unbounded buffers and display bytes that were not committed.

- Observation: creation rollback reports success even when compensation is incomplete.
  Evidence: output discard, job deletion, and request-index removal errors are suppressed, and the branch removes a request mapping without confirming that it still belongs to the attempted job.

- Observation: removing `MAX_OUTPUT_BYTES` changes an availability boundary without replacement.
  Evidence: the Relay state volume can be filled by one process. Successful byte identity requires eliminating silent truncation, but it does not require unlimited storage. The limit must become an explicit terminal failure rather than disappear.

- Observation: the branch's bounded tail can retain an oversized backing allocation.
  Evidence: replacing a retained Buffer with `first.subarray(overflow)` reduces logical length but can keep the complete original allocation reachable. The tail must copy retained suffixes or use fixed-size owned segments so the actual retained memory is bounded.

- Observation: green CI is not completion evidence for this branch.
  Evidence: the current CI workflow succeeded, but the Agent Relay workflow failed and the existing tests do not cover current-main regressions, restart corruption, archive atomicity, exact output protocol, writer durability, blocked mirror drain, or incomplete compensation.

## Decision Log

- Decision: current `main` after PR #9 is the architectural and security baseline.
  Rationale: raw streaming is an additive observability feature. It does not justify restoring mechanisms deliberately removed by the context and isolation audit.
  Date/Author: 2026-07-15 / PR review.

- Decision: reconcile files manually against the recorded main commit without running merge, rebase, commit, or push from Codex.
  Rationale: the selected agent has read-only Git metadata and the runner owns commit publication. `git show <sha>:<path>` provides the necessary baseline while preserving that ownership boundary.
  Date/Author: 2026-07-15 / PR review.

- Decision: retain the result-free process-derived outcome model.
  Rationale: Relay can observe spawn, exit, timeout, interruption, and output persistence directly. Model-authored status, blockers, validation, and commit intent are weaker duplicate control channels.
  Date/Author: 2026-07-15 / PR review.

- Decision: retain the current minimal prompt and active-plan-only instruction model.
  Rationale: `.agent/PLANS.md` defines reusable behavior, and this selected active plan contains the complete task. Modes, review-finding arrays, completed plans, and duplicate prompt prose must not become additional task authorities.
  Date/Author: 2026-07-15 / PR review.

- Decision: raw persisted output is authoritative and intentionally unredacted.
  Rationale: exact reconnect offsets and byte identity cannot be defined over independently redacted stdout and stderr transformations. Access remains bearer-authenticated and the state volume remains Relay-only. Documentation must state that persisted, Docker, GitHub, and artifact output can contain secrets printed by the child process.
  Date/Author: 2026-07-15 / PR review.

- Decision: preserve `MAX_OUTPUT_BYTES`, but convert reaching it from successful truncation into explicit failure.
  Rationale: unlimited output can exhaust the state volume. Silent truncation violates complete-stream semantics. A hard output error preserves both storage safety and honesty: the committed prefix remains replayable, the job fails, and no clean EOF or successful archive is claimed.
  Date/Author: 2026-07-15 / PR review.

- Decision: job persistence records the exact output terminal metadata required for restart.
  Rationale: job status and physical file size cannot distinguish a clean finalized stream from a partial write or failed finalization. Persisted metadata must include the accepted committed length and whether output ended cleanly or with an error.
  Date/Author: 2026-07-15 / PR review.

- Decision: `OutputStore` owns append serialization, writer finalization, replay capability, and first-terminal-wins behavior.
  Rationale: stdout and stderr callbacks can overlap. One store-owned chain defines byte order. Clean EOF is valid only after queued writes, file sync, writer close, terminal job persistence, and terminal publication succeed.
  Date/Author: 2026-07-15 / PR review.

- Decision: attachment is lazy and integrity-preserving.
  Rationale: a corrupt historical log must fail only its output request rather than Relay startup. Attachment never creates or repairs a file and validates persisted committed length against the physical file before replay.
  Date/Author: 2026-07-15 / PR review.

- Decision: persistence precedes every presentation sink.
  Rationale: Docker and GitHub logs are observations of committed bytes. Their backpressure or failure must not change authoritative ordering, committed length, job status, or reconnect offsets.
  Date/Author: 2026-07-15 / PR review.

- Decision: only HTTP `200` with media type `application/octet-stream` and identity content encoding is an accepted output response.
  Rationale: every other response is an explicit protocol result, not a transient body interruption. Offset semantics are valid only for the unchanged persisted representation.
  Date/Author: 2026-07-15 / PR review.

- Decision: the final artifact path denotes a complete terminal stream, including a technically failed job if all output bytes reached clean terminal EOF.
  Rationale: failed process output is useful diagnostic evidence. The artifact may be published after clean terminal EOF, sync, close, and atomic rename, but failed jobs still fail the workflow and never publish a commit message.
  Date/Author: 2026-07-15 / PR review.

- Decision: runner output finalization precedes `$GITHUB_OUTPUT` mutation.
  Rationale: archive or workflow-command restoration failure must prevent publication and commit. The runner must preserve current-main commit-subject derivation and leave no model result or Git-status decision in the client.
  Date/Author: 2026-07-15 / PR review.

- Decision: public job responses remain filtered.
  Rationale: adding an authenticated output route does not require exposing filesystem paths or internal error detail in create and poll responses.
  Date/Author: 2026-07-15 / PR review.

- Decision: repository-owned acceptance remains `npm run check` plus static Git checks.
  Rationale: current-main tests intentionally use local fixtures and do not claim to validate Docker, Compose, GitHub APIs, external credentials, or hosted services. Operator deployment commands remain documented procedures.
  Date/Author: 2026-07-15 / PR review.

## Outcomes & Retrospective

The branch contains useful prototypes for an output store, offset route, runner streaming loop, and artifact handling, but it cannot be repaired in place by addressing only the nine original inline comments. It is based on the pre-PR-#9 architecture and restores obsolete result contracts and weaker execution, credential, filesystem, prompt, request, and API boundaries.

This revised plan treats current main as the starting point and specifies the feature as an additive layer. Completion requires both streaming correctness and proof that none of the PR #9 boundaries regressed. Until every merge gate has deterministic evidence, all implementation threads remain unresolved and this plan remains active.

## Context and Orientation

`src/execution/codex-executor.ts` launches the isolated Codex child. On current main, `createCodexArgs()` defines the restricted permission profile, `createCodexInvocation()` selects the fixed user, and `createCodexEnvironment()` returns the fixed child environment. Streaming work must extend these functions rather than replace them.

`scripts/codex-run`, the Dockerfile, `compose.yml`, and `src/server.ts` establish the independent image-level boundary: Relay runs as `relay`, Codex runs as `agent`, only `auth.json` is mounted read-only, and the root-owned wrapper is the fixed launcher. These files are security contracts, not incidental packaging.

`src/application/job-service.ts` owns job creation, one-active-job admission, execution, terminal persistence, and preparation compensation. `src/persistence/job-store.ts` stores job records and the request-ID index. Output metadata used after restart belongs to internal job persistence, but public job responses must continue to be filtered by `toPublicJob()` in `src/api/server.ts`.

Create `src/persistence/output-store.ts` as the single authority for output bytes. A committed byte is one that completed a full positional write in serialized order and is included in `committedLength`. A clean output terminal means no later append is accepted, the append chain settled, the file was synced, the writer was closed, the matching terminal metadata was persisted, and readers were notified. An error terminal exposes only the persisted committed prefix and then terminates with the stored output error.

`src/api/server.ts` exposes authenticated job APIs. Add `GET /v1/jobs/{jobId}/output?offset={nonNegativeSafeInteger}` without changing the create or poll DTO. Before raw headers, failures use the existing JSON envelope. After raw headers, any failure destroys the connection.

`runner/client.mjs` currently validates the selected plan, derives the commit message, performs bounded JSON requests, validates public jobs, submits and polls, and writes `$GITHUB_OUTPUT`. Extend this client. Do not restore result-file validation, execution modes, `git status`, `.agent-relay` cleanup, or model-derived commit messages.

The workflow supplies `AGENT_RELAY_TOKEN` only to the client step. It may additionally supply a dedicated output artifact path to that same step. The finalizer continues to receive publication credentials only in its own step.

## Plan of Work

### Milestone 0: restore the current-main contract before extending it

For every changed file that overlaps PR #9, begin from `git show f043af2fa9eb0420a0d64684485700f92a5dc425:<path>` and reapply only streaming-specific edits. Do not copy the branch version forward merely because it already contains the first prototype.

Preserve current-main `.agent/PLANS.md` exactly in behavior: only the selected active plan is an instruction, completed plans are historical, blockers use unchecked `[blocked]` progress entries with cause, impact, evidence, and unblock condition, and completion requires checked evidence. Preserve the minimal `AGENTS.md` and minimal generated prompt.

Preserve the request and job contract: no `mode`, `reviewFindings`, `blocked`, `resultPath`, or model result schema. Preserve both runner-side and Relay-side validation that the selected plan is a regular non-symlink file directly under `docs/exec-plans/active/`.

Preserve current-main runner behavior: bounded JSON reads, exact expected statuses and JSON media types, public-job validation, commit subject derived from the first level-one plan heading, and no client-side Git decision. Preserve current-main finalizer behavior for clean worktrees and publication recovery.

Preserve the process boundary in `src/execution/codex-executor.ts`, `src/server.ts`, `scripts/codex-run`, Docker packaging, and Compose. The final implementation must not contain `danger-full-access`; must launch through the fixed wrapper and `agent` user; must use the fixed child environment and current permission profile; must not expose the Relay token to the runner service; and must mount only `HOST_CODEX_AUTH_FILE` at `/home/agent/.codex/auth.json:ro`.

Preserve `toPublicJob()` and its response tests. Internal output metadata may be added to `JobRecord`, but create and poll responses must not expose `outputPath`, output terminal diagnostics, or internal error messages.

Acceptance for this milestone is that all current-main contract tests pass before relying on any new streaming test and static regression tests reject every obsolete symbol or weaker boundary listed above.

### Milestone 1: implement restart-safe output persistence and transactional job lifecycle

In `src/persistence/output-store.ts`, use distinct writer and reader handles. Define explicit writer states such as `open`, `finalizing`, `finalized`, and `failed`. Maintain a store-owned append chain, exact committed length, version, first terminal state, waiters, and a serialized lazy-attachment operation.

`prepare(jobId, outputPath)` creates the file exclusively with mode `0600`. It must not truncate a stale file. If preparation fails, return `OUTPUT_PREPARATION_FAILED` and leave no live state.

`append(jobId, chunk)` queues the complete chunk behind the store-owned chain. The write loop must reject zero progress. Advance `committedLength` and wake readers only after the complete chunk is written. Preserve the first rejected append so later successful work cannot replace its evidence.

`finalizeWriter(jobId)` seals new appends, awaits the append chain, attempts sync, and attempts close even when an earlier step fails. Clear the writer handle after close. Only all-success changes writer state to `finalized`; any failure becomes `OUTPUT_WRITE_FAILED` and records the earliest cause plus later cleanup diagnostics.

Persist enough output terminal metadata in the internal job record to reconstruct the stream after restart. The terminal metadata must include exact committed length and either clean output or an output error code/message. Do not infer this from job status or `stat.size`.

For a healthy execution, order terminal work as follows: drain the child streams and store queue; finalize the writer; create the terminal job record with exact clean output metadata; persist that record; then publish clean output completion and wake readers. If terminal job persistence fails, publish an output error and never clean EOF.

For an execution or timeout failure with healthy output persistence, still drain and finalize the writer, persist the failed or timed-out job with clean output metadata, then publish clean output completion. Job failure and output completeness are separate facts.

For append, sync, or close failure, preserve the committed prefix, best-effort close the writer, persist an output error terminal with its exact committed length, and publish the same first error to readers. The job is failed. Repeated terminal calls are idempotent only when they match the first terminal; conflicting terminal transitions fail without replacing it.

`attach(record)` is lazy. It never creates, truncates, or repairs a file and never opens a writer. Reject records without persisted terminal output metadata. Open the existing file read-only, compare its physical size with the persisted committed length, and reject missing, unreadable, short, or unexpectedly long data as `OUTPUT_READ_FAILED`. A stored output-error terminal may replay exactly its committed prefix and must then surface the stored error, not clean EOF. Serialize concurrent first attachment and close duplicate handles if a race still occurs.

On Relay startup, mark accepted and running jobs interrupted as current main already does, but persist exact output terminal metadata for the bytes safely present at recovery. Do not eagerly attach historical files in `JobService.init()`. A corrupt historical file must not prevent health or unrelated job APIs from starting.

Make creation compensation exhaustive. If any step after output preparation fails, independently attempt output discard, job removal, and compare-and-delete of the request-ID mapping using the exact created job ID. Preserve a foreign mapping. If every compensation succeeds, return the original preparation error. If any cleanup fails or ownership mismatches, return `JOB_PREPARATION_FAILED` or the current-main preparation code with an explicit incomplete-rollback diagnostic. Do not restore the obsolete `OUTPUT_PREPARATION_FAILED` name if current-main contracts use `JOB_PREPARATION_FAILED`; choose one current contract and test it consistently.

`discard()` must report close and removal failures to compensation rather than suppressing them. Store shutdown may remain best-effort, but job creation rollback may not.

Acceptance for this milestone is that clean terminal output is restart-replayable, error terminal output cannot become clean after restart, physical bytes outside committed length are never exposed, one corrupt historical log does not stop Relay startup, and failed creation never silently claims successful rollback.

### Milestone 2: stream raw bytes from the isolated executor with bounded memory

Extend the current-main executor and wrapper contracts; do not replace them. The child invocation must still use the fixed `agent` user, fixed environment, current permission profile, private runtime directory, selected-workspace write access, read-only selected `.git`, and denial of sibling workspace and Relay/runner/agent-home paths.

Remove `StreamingRedactor` only from the new authoritative raw-output path. Record this intentional security change in README and operations documentation. Do not restore access to any additional secret or host state as a substitute for redaction.

Keep `MAX_OUTPUT_BYTES` in configuration and Compose. Count raw persisted bytes. When accepting the next chunk would exceed the configured maximum, persist only bytes already fully committed, terminate the child, finalize or error-seal the writer, and fail with a dedicated code such as `OUTPUT_LIMIT_EXCEEDED`. Do not append a textual truncation marker to the authoritative stream and do not report clean output completion.

Use a FIFO and an exact Relay-owned pending-byte count. Define tested high- and low-water thresholds. A chunk remains counted from callback receipt until persistence and mirror handling settle. Pause both child streams at the high-water threshold and resume only at or below the low-water threshold. Bound permitted overshoot to chunks already delivered by stdout and stderr callbacks.

For each chunk, await `OutputStore.append()` first. Only then mirror the exact chunk to container stdout. When `process.stdout.write()` returns false, await `drain` while also observing `error` and `close`. A mirror failure disables that presentation sink for the remainder of the job, removes scoped listeners, releases the chunk count, and allows authoritative persistence and child execution to continue.

Wait for child close, stdout end, stderr end, queue drain, and writer finalization before returning a technical outcome. On timeout, process failure, or spawn failure, preserve current-main status classification. On output persistence failure, terminate the child and preserve the first output error.

Do not read, create, validate, or delete `.agent-relay/result.json`. A zero child exit is `completed`; non-zero/spawn failure is `failed`; the deadline is `timed_out`; restart recovery is `interrupted`.

Acceptance for this milestone is byte-identical persisted stdout/stderr callback order, actual bounded memory under a blocked mirror, no persistence reordering, no job failure caused only by presentation loss, explicit hard failure at the output limit, and unchanged isolation tests.

### Milestone 3: add the offset endpoint without weakening the public API

Add `GET /v1/jobs/{jobId}/output?offset={nonNegativeSafeInteger}` behind the existing bearer token. Preserve `toPublicJob()` for POST and GET job responses. Output-route authorization must not expose whether a job or file exists before authentication.

Validate the job ID and decimal offset. Return the existing JSON error envelope before raw headers for malformed offsets, missing jobs, attachment failures, and offsets above committed length. Use `416` for a valid numeric offset beyond committed length.

Complete attachment, offset validation, and the first required read or terminal snapshot before `flushHeaders()`. Preserve any first chunk and write it after setting `200`, `Content-Type: application/octet-stream`, `Cache-Control: no-store, no-transform`, and `X-Content-Type-Options: nosniff`. Do not set a non-identity content encoding.

After raw headers are sent, every `RelayError` and unknown exception destroys the response. Never call `sendJson()` when `res.headersSent` is true. A clean terminal ends only after all committed bytes have been written. An error terminal writes its committed prefix and then destroys the transport with the stored error.

A read that expects committed bytes but makes zero progress is `OUTPUT_READ_FAILED`; do not loop. Response writes must handle `drain`, `error`, `close`, and an already-destroyed response while removing all listeners on every path. Client abort must remove its output-store waiter.

Acceptance for this milestone is exact replay from every valid offset, deterministic JSON before headers, deterministic destruction after headers, no `ERR_HTTP_HEADERS_SENT`, no zero-progress spin, no waiter leak, and unchanged create/poll DTOs.

### Milestone 4: extend the current runner without restoring obsolete control channels

Keep the current-main runner preflight first: resolve the real workspace, validate the selected active plan path and symlink boundary, read the plan, derive the normalized commit subject, require `$GITHUB_OUTPUT`, and perform bounded exact JSON protocol validation.

Install idempotent `SIGINT` and `SIGTERM` cleanup handlers before any job submission. If `AGENT_RELAY_OUTPUT_ARCHIVE_PATH` is configured, remove a stale final path before submission. Failure to remove it is fatal. Create a unique same-directory temporary file exclusively with mode `0600` before submission. Archive creation may degrade to tail-only mode, but every fatal preparation failure must happen before POST so no submitted job is left unobserved.

Submit the current-main request shape only: `requestId`, `workspace`, and `planPath`. Validate the current public job shape and statuses. Do not send `mode` or `reviewFindings`.

For each output request, set `Accept: application/octet-stream` and `Accept-Encoding: identity`. Accept only HTTP `200` whose parsed media type is exactly `application/octet-stream` ignoring case and parameters and whose `Content-Encoding` is absent or exactly `identity`. For every other response, read at most `8192` diagnostic bytes, record whether more data was truncated, and fail immediately without reconnecting.

Maintain `confirmedOffset` as the number of remote bytes for which all required local handling succeeded. For each chunk, append it to a truly bounded rolling tail, append it to the temporary archive when healthy, write the allowed live-prefix slice, and only then advance the offset. Archive append failure closes and removes the temporary file, keeps the current chunk in the tail, preserves live-prefix presentation, and enters tail-only mode without reconnecting.

The tail must bound actual retained allocation, not only logical Buffer length. Copy retained suffixes or use fixed-size owned segments. Test a single incoming chunk much larger than the tail limit.

Retry only request acquisition failure, accepted-body read failure, idle abort, or clean EOF while the current job is nonterminal. Reconnect from unchanged `confirmedOffset`. Explicit HTTP responses, media/content-encoding mismatch, offset rejection, status-poll failure, archive-finalization failure, workflow-command failure, and other local sink failures are fatal and never reconnect.

A clean EOF becomes terminal EOF only after the current job status is terminal. Continue to poll using current-main bounded JSON rules. A technically failed, timed-out, or interrupted job may still produce a complete archive after terminal EOF, but the runner then fails and leaves `$GITHUB_OUTPUT` unchanged.

Wrap every raw byte written to GitHub-visible stdout between a unique `::stop-commands::<token>` line and its matching resume line. Ensure control lines begin on their own line even when raw output lacks a trailing newline. Track the last byte actually displayed separately from the last byte received, archived, or retained in the tail. Presentation-only line breaks and markers do not affect offsets or archive bytes.

After confirmed terminal EOF, sync and close the temporary archive and atomically rename it to the final path. Sync, close, or rename failure is fatal; remove the temporary file and leave the final path absent. Cancellation, deadline, invalid protocol, incomplete drain, or client failure also leaves the final path absent.

Use one common finalization path for all exits. It restores workflow-command parsing, removes signal handlers, settles archive cleanup/publication, and records any finalization failure. Do not return from inside the protected success body. Finalization must succeed before printing structured success or appending the already runner-derived commit subject to `$GITHUB_OUTPUT`.

Do not read or remove `.agent-relay`, validate a Codex result, accept `blocked`, inspect `git status`, or choose whether to commit. On a completed technical job and successful output finalization, write the derived commit subject. The existing finalizer remains responsible for clean-worktree success, commit, and push.

Acceptance for this milestone is no partial final artifact, exact archive bytes, exact-offset reconnect without gaps or duplicates, bounded live prefix and tail in archive and tail-only modes, inert workflow-command-looking raw output, immediate explicit protocol failures, and no commit output before finalization.

### Milestone 5: preserve workflow, credential, packaging, and documentation boundaries

Begin `.github/workflows/agent-relay.yml`, `examples/github-actions/agent-relay.yml`, `compose.yml`, `.env.example`, Dockerfiles, `src/server.ts`, and wrapper scripts from current main.

Keep checkout `persist-credentials: false` and the credential-free repository check. Keep the Relay token out of the runner service and supply it only to the Relay client step. Keep the GitHub publication token only in the finalization step. Keep the runner request free of mode and model-result inputs.

Add `AGENT_RELAY_OUTPUT_ARCHIVE_PATH` only to the Relay client step. Upload the final archive path and console log under `if: always()`; the runner's atomic-publication contract ensures the final archive is absent after incomplete output. Keep `if-no-files-found: warn`.

Keep only `HOST_CODEX_AUTH_FILE` mounted at `/home/agent/.codex/auth.json:ro`. Keep `MAX_OUTPUT_BYTES` in `.env.example`, Compose, configuration, and executor construction. Do not restore configurable Codex command or user overrides.

Update `README.md` from current main. Add the output endpoint, raw/unredacted sensitivity, hard output-limit failure, replay and archive behavior, and the distinction between technical job status and output completeness. Do not restore model result, mode, blocked-status, or client-side Git-decision documentation.

Update `docs/operations/README.md` as the canonical full runbook. Update `docs/operations/live-codex-logs.md` only if it remains intentionally linked; otherwise merge its unique commands into the canonical runbook and remove it. Do not duplicate credential or execution architecture in `AGENTS.md`; preserve current-main minimal instructions.

Document that repository tests validate local code and fixtures only. Keep Docker/Compose/GitHub/credential checks as operator procedures rather than claiming `npm run check` executed them.

Acceptance for this milestone is unchanged credential lifetime, unchanged user and mount boundaries, one consistent current architecture in documentation, and no obsolete result/mode text.

### Milestone 6: close every deterministic test and review gap

Extend current-main tests rather than restoring obsolete fixtures. Tests must reject `mode`, `reviewFindings`, `blocked`, `resultPath`, `shouldCommit`, `.agent-relay/result.json`, model commit messages, broad prompt text, `danger-full-access`, full inherited environments, runner-service Relay tokens, writable full Codex-home mounts, and unfiltered public jobs.

Output-store tests must cover concurrent stdout/stderr appends, exact callback ordering, partial writes, zero-progress writes and reads, rejected-chain preservation, sync and close attempts after earlier failure, writer closure, separate replay handles, first-terminal-wins, lazy concurrent attachment, missing/unreadable/short/long files, clean restart replay, output-error restart replay, and corrupt historical output not blocking startup.

Job-service and store tests must cover preparation failure after every step, independent compensation attempts, output discard failure, job-removal failure, request-index cleanup failure, foreign-mapping preservation, exact incomplete-rollback diagnostics, technical failure with complete output, terminal-record persistence failure, output-error metadata persistence, interrupted recovery, and lock release.

Executor tests must cover binary bytes, invalid UTF-8, split multibyte sequences, stdout/stderr callback order, output near and above the hard limit, high/low-water transitions, permitted overshoot, persistence-before-mirror ordering, blocked mirror drain, mirror `error`, mirror `close`, listener cleanup, timeout, non-zero exit, spawn failure, append failure, writer sync failure, writer close failure, and the complete current-main invocation/environment/filesystem boundary.

Endpoint tests must cover authentication, public DTO filtering, malformed and unsafe offsets, `416`, retained first read before headers, active following, replay from every boundary, response backpressure, destroyed response, drain/error/close listener cleanup, client abort cleanup, zero-progress read, clean and error restart attachment, JSON before headers, and transport destruction for every Relay and unknown error after headers.

Runner tests must cover current-main plan preflight and commit-subject derivation; stale final-path removal; no POST after fatal preparation; temporary mode and same-directory placement; final-path absence before terminal EOF; identity request headers; content-type and content-encoding validation; every status class; bounded 8192-byte diagnostics; request failure, body failure, idle abort, premature EOF, terminal EOF, offset rejection, poll failure; exact archive bytes; archive create/append degradation; sync/close/rename failure; signals; live prefix in archive and tail-only modes; actual tail allocation under an oversized chunk; workflow-command isolation; finalization-before-output; failed job with complete archive; and no result, Git-status, or `.agent-relay` behavior.

Add one controlled full-flow test on the current-main architecture. Fake Codex emits binary stdout, waits until the runner observes it, emits stderr and more stdout across a small live limit, experiences one retryable accepted-body disconnect, changes a tracked file, and exits zero without writing a result artifact. Prove selected-repository isolation, first output before exit, exact Relay bytes, exact archive bytes, exact-offset reconnect, bounded non-duplicated presentation, inert control-looking output, process-derived completion, plan-derived commit subject, and finalizer-owned worktree behavior.

Add a second full-flow failure case where output persistence fails after a committed prefix. Persist the output-error terminal, restart Relay state, replay only the committed prefix, then end with the stored error rather than clean EOF. Prove no final archive and no `$GITHUB_OUTPUT` mutation.

After implementation, review the diff against `f043af2fa9eb0420a0d64684485700f92a5dc425` and the then-current `origin/main`. Record any newer relevant main change in `Surprises & Discoveries` and reconcile it without weakening these gates. Do not mark this milestone complete while GitHub reports merge conflicts or an unresolved implementation thread remains.

## Concrete Steps

Run commands from the repository root. Do not run commands that create, rewrite, or publish commits.

Inspect the recorded current-main version of every overlapping contract before editing:

    git show f043af2fa9eb0420a0d64684485700f92a5dc425:.agent/PLANS.md
    git show f043af2fa9eb0420a0d64684485700f92a5dc425:runner/client.mjs
    git show f043af2fa9eb0420a0d64684485700f92a5dc425:src/execution/codex-executor.ts
    git show f043af2fa9eb0420a0d64684485700f92a5dc425:src/application/job-service.ts
    git show f043af2fa9eb0420a0d64684485700f92a5dc425:src/api/server.ts
    git show f043af2fa9eb0420a0d64684485700f92a5dc425:compose.yml

Install locked dependencies and run focused checks during implementation:

    npm ci
    npm run typecheck
    npm run build
    node --test --experimental-test-coverage dist/test/contracts.test.js
    node --test --experimental-test-coverage dist/test/executor.integration.test.js
    node --test --experimental-test-coverage dist/test/integration.test.js
    node --test --experimental-test-coverage dist/test/runner-client.test.js
    node --test --experimental-test-coverage dist/test/flow.integration.test.js

Run the repository-owned complete validation:

    npm run check
    git diff --check

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

Verify the output protocol and documentation through tests and focused static checks:

    git grep -n 'application/octet-stream' -- src runner test README.md docs/operations
    git grep -n 'Accept-Encoding' -- runner test
    git grep -n 'no-transform' -- src test
    git grep -n 'MAX_OUTPUT_BYTES' -- .env.example compose.yml src test README.md docs/operations

The exact test count and zero failures belong in `Artifacts and Notes`. Do not record unavailable or skipped external operations as passed.

## Validation and Acceptance

The following merge gates are mandatory:

1. The implementation is reconciled with current main and GitHub reports the PR mergeable.
2. `.agent/PLANS.md`, the minimal prompt, and the selected active-plan validation preserve the current-main active-only instruction model and never instruct Codex to commit, merge, rebase, or push.
3. No execution mode, review-findings channel, model result artifact, model blocker/status, model validation report, or model commit message exists.
4. The current fixed `agent` user, wrapper, minimal environment, filesystem permissions, selected-workspace boundary, private temp, read-only Git metadata, and denied Relay/runner/sibling paths remain tested.
5. The runner service has no Relay bearer token, checkout persists no GitHub credentials, publication credentials exist only in finalization, and only `auth.json` is mounted read-only.
6. Create and poll responses retain the public DTO and expose no output path, result path, internal output terminal, or internal error message.
7. Job creation attempts every compensation, compare-deletes only its own request mapping, preserves foreign mappings, and reports incomplete rollback.
8. Appends are serialized; only completely written chunks advance committed length; output-limit exhaustion is an explicit failure, never successful truncation.
9. Every clean terminal drains appends, syncs, closes the writer, persists exact terminal output metadata, and only then publishes clean EOF.
10. Missing, unreadable, short, long, partially written, or error-terminal output cannot become a fabricated clean stream after restart; corrupt history does not prevent Relay startup.
11. Authoritative persistence precedes mirroring; Relay-owned buffering is byte-bounded; mirror backpressure and failure cannot reorder or fail authoritative output.
12. Pre-header output failures use JSON; every post-header failure destroys the transport; zero-progress and client-abort paths cannot spin or leak waiters.
13. The runner accepts only `200 application/octet-stream` with identity content encoding and bounded diagnostics; explicit responses never reconnect.
14. Reconnects resume from exact confirmed offsets without gaps or duplicates and retry only the explicitly allowed transport/body/idle/premature-EOF classes.
15. The final archive path is absent until terminal EOF, successful sync and close, and atomic rename. Incomplete output never leaves a final artifact.
16. GitHub-visible prefix and tail are bounded in actual retained memory, remain available after archive degradation, and keep workflow-command-looking bytes inert.
17. Common runner finalization succeeds before any structured success or `$GITHUB_OUTPUT` mutation. The current finalizer alone decides clean-worktree, commit, and push behavior.
18. README and operations documentation describe the current result-free architecture, raw sensitivity, hard limit, exact replay, terminal archive, credential scope, and recovery without obsolete contracts.
19. Every original inline finding and every additional finding in this review has a deterministic regression test.
20. `npm run check` and `git diff --check` exit zero, exact evidence is recorded, a final review finds no unresolved mismatch, and this plan remains active until those conditions hold.

Do not move this file to `docs/exec-plans/completed/` and do not resolve review threads before all twenty gates pass.

## Idempotence and Recovery

Tests use temporary repositories, state directories, output files, archive paths, and local HTTP/process fixtures. Repeated test runs do not alter persistent operator state.

Job request retries preserve current-main idempotency. An identical request ID returns the existing job. Preparation rollback deletes only resources created by the failing attempt. A foreign request mapping is preserved and reported.

The final archive path is dedicated to one workflow attempt. Startup removes a stale final path before POST and uses a unique temporary sibling. Cleanup removes only that temporary file. A failed retry cannot mistake an earlier partial file for complete output.

Relay restart converts accepted/running jobs to interrupted and records exact output terminal metadata. Historical attachment is lazy. Missing or corrupt data remains an explicit output integrity error and does not get repaired automatically.

A failed publication after a local commit remains the current finalizer's responsibility: it restores worktree changes as current main documents. Streaming code must not duplicate or bypass this recovery.

## Artifacts and Notes

Review baseline:

    PR head: b5287d4cbca94a9c447b253d8d75869b3b5d4c51
    Merge base: 7dda1338b193f491591fffce219dd4dc362bf824
    Current main: f043af2fa9eb0420a0d64684485700f92a5dc425
    GitHub state at review: open, non-draft, non-mergeable, one main commit behind
    Changed files: 23
    Existing unresolved inline findings: 9
    CI workflow: success
    Agent Relay workflow: failure

Append final validation evidence in this form:

    2026-07-15 HH:MMZ - npm run check - exit 0 - <exact tests> passed, 0 failed; coverage summary recorded.
    2026-07-15 HH:MMZ - git diff --check - exit 0 - no whitespace errors.
    2026-07-15 HH:MMZ - final current-main comparison - <main sha> - no security or contract regression.
    2026-07-15 HH:MMZ - GitHub PR review - mergeable, no unresolved implementation finding.

Raw child output can contain repository content, command output, tokens, or credentials printed by tools. Relay state, Docker logs, GitHub logs, and uploaded archives are sensitive execution data. The feature intentionally preserves bytes rather than redacting them; access restriction, hard output limits, retention procedures, and credential isolation are therefore part of acceptance.

## Interfaces and Dependencies

Do not add an external runtime dependency unless Node.js built-ins cannot meet a requirement.

The current public create request remains equivalent to:

    interface CreateJobRequest {
      requestId: string;
      workspace: string;
      planPath: string;
    }

The current public statuses remain:

    type JobStatus = "accepted" | "running" | "completed" | "failed" | "timed_out" | "interrupted";

Add internal output terminal metadata equivalent to:

    interface PersistedOutputTerminal {
      committedLength: number;
      kind: "clean" | "error";
      errorCode?: string;
      errorMessage?: string;
    }

The exact field placement may follow the existing internal `JobRecord`, but `toPublicJob()` must omit it.

The output store must provide equivalent operations:

    prepare(jobId: string, outputPath: string): Promise<void>
    append(jobId: string, chunk: Uint8Array): Promise<void>
    finalizeWriter(jobId: string): Promise<void>
    publishClean(jobId: string, status: JobStatus): Promise<void>
    publishError(jobId: string, error: RelayError): Promise<void>
    attach(record: JobRecord): Promise<void>
    peek(jobId: string): OutputSnapshot
    read(jobId: string, offset: number, maxBytes?: number): Promise<Uint8Array>
    waitForChange(jobId: string, observedVersion: number, signal?: AbortSignal): Promise<OutputSnapshot>
    discard(jobId: string): Promise<void>
    close(): Promise<void>

Names may differ, but lifecycle, ordering, and evidence may not.

The authenticated route remains:

    GET /v1/jobs/{jobId}/output?offset={nonNegativeSafeInteger}
    Authorization: Bearer <AGENT_RELAY_TOKEN>
    Accept: application/octet-stream
    Accept-Encoding: identity

A valid response is HTTP `200`, media type `application/octet-stream`, and absent or identity content encoding. Its body contains authoritative raw bytes only.

Keep configuration equivalent to:

    CODEX_TIMEOUT_MS=<positive integer>
    MAX_OUTPUT_BYTES=<positive integer>

Define and test explicit queue high/low water thresholds and:

    MAX_REMOTE_ERROR_BODY_BYTES = 8_192

The runner may receive:

    AGENT_RELAY_OUTPUT_ARCHIVE_PATH=<dedicated final path>

The final path means an atomically published complete terminal stream. It is not a live partial file.

Revision note (2026-07-15 00:42Z): Replaced the obsolete post-PR-#8 repair plan after reviewing PR #3 against current main after PR #9. The new plan preserves the result-free, minimal-context, isolated-user, fixed-environment, restricted-filesystem, step-scoped-credential, read-only-auth, active-plan-only, and public-DTO contracts; retains all nine original findings; adds restart-safe terminal metadata, current-main reconciliation, hard output-limit failure, identity transfer semantics, actual tail-memory bounds, and comprehensive regression gates. No repository file other than this active plan was changed by this review revision.
