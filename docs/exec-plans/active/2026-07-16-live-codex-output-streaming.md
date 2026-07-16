# Stream live Codex output to GitHub Actions

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current as work proceeds. Maintain this document in accordance with `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

## Purpose / Big Picture

After this change, a person watching the `Run Codex through Agent Relay` step in GitHub Actions can see Codex activity while the process is still running. Standard output and standard error appear as they are delivered by Node.js, without waiting for the final `completed`, `failed`, or `timed_out` status. The same accepted process bytes are written to `agent-relay-output.log` and uploaded after the step, including when Codex fails, the output limit is reached, or output transport ends after only a prefix was delivered.

Agent Relay remains responsible for running Codex, persisting the authoritative combined output, serving it over an authenticated HTTP stream, and deriving the technical job result. The runner remains responsible for displaying the stream in GitHub Actions, preserving a local artifact copy, retrying a transient HTTP interruption from a confirmed byte offset, and failing the workflow when the Relay job or output handling fails.

The implementation must stay within this epic. It must not add a new system user, `sudo`, a separate execution container, an external log service, restart-safe process recovery, distributed checkpoints, indefinite retention, log rotation, a new commit or push model, a new pull-request gate, or a changed active ExecPlan contract.

## Progress

- [x] (2026-07-16) Read `AGENTS.md`, `.agent/PLANS.md`, the current runner, executor, job service, API server, workflow, configuration, persistence, and repository validation commands.
- [x] (2026-07-16) Confirmed that current `main` lists no active ExecPlan, so there was no active plan file to move to `docs/exec-plans/completed/` before creating this plan.
- [x] (2026-07-16) Created this plan-only branch from `main` commit `04e1f6d3c3a0eb54f4a77848be237ed12727ab0e`; no production implementation is part of the planning pull request.
- [ ] Introduce one `OutputStore` that owns accepted Codex bytes, serialized file writes, committed length, active waiters, terminal output state, and historical file reads without becoming a queueing platform or database.
- [ ] Refactor `CodexExecutor` so stdout and stderr chunks have one raw output path through `OutputStore`, preserve Node.js callback order, enforce the whole-chunk output limit, and remove silent truncation, UTF-8 transformation, redaction, and textual truncation markers from this path.
- [ ] Change `JobService` terminal ordering so the Codex process result, pending output writes, durable job status, and output stream completion cannot contradict one another.
- [ ] Add the authenticated `GET /v1/jobs/{jobId}/output?offset={byteOffset}` octet-stream endpoint with exact offset acknowledgement, active following, controlled pre-stream errors, and no path exposure.
- [ ] Extend `runner/client.mjs` to stream output immediately after job creation, write a partial-or-complete artifact, display raw chunks safely in GitHub Actions, poll status concurrently, resume transient HTTP failures from the confirmed offset, and surface every process, transport, and local write failure.
- [ ] Update the production and example GitHub Actions workflows so the runner owns transport, the workflow uploads `agent-relay-output.log` with `if: always()`, and the existing final failure and Git finalization behavior remains intact.
- [ ] Update operator and architecture documentation with the raw-output security decision, endpoint contract, artifact semantics, failure behavior, limit behavior, and explicit non-goals.
- [ ] Add deterministic unit and integration tests for live-before-terminal output, stdout/stderr interleaving, success, non-zero exit, timeout, output limit, reconnect, artifact-write failure, unavailable endpoint, authorization, offset validation, partial artifact upload wiring, and terminal ordering.
- [ ] Run focused tests, `npm run check`, and `git diff --check`; record exact evidence, complete `Outcomes & Retrospective`, and move this file to `docs/exec-plans/completed/` only after every item is supported by passing automated evidence.

## Surprises & Discoveries

- Observation: the current executor already captures both child streams, but it writes a redacted text representation to a private file and mirrors that representation only to Relay container stdout.
  Evidence: `src/execution/codex-executor.ts` uses separate `StreamingRedactor` instances, decodes chunks, appends text, and calls `process.stdout.write`.

- Observation: the existing limit silently accepts a prefix of an oversized chunk and adds `[OUTPUT TRUNCATED]` while still allowing normal process completion.
  Evidence: `src/execution/codex-executor.ts` slices the chunk to the remaining byte count and writes a textual marker after process close.

- Observation: the runner currently creates the job and polls JSON status only. It neither reads Relay's output file nor opens an output stream.
  Evidence: `runner/client.mjs` calls `POST /v1/jobs` and repeatedly calls `GET /v1/jobs/{id}` until the status is terminal.

- Observation: the current workflow artifact is a `tee` copy of runner console output, not an authoritative raw Codex output file.
  Evidence: `.github/workflows/agent-relay.yml` pipes `runner/client.mjs` through `tee` into `agent-relay-console.log`.

- Observation: the repository already persists job records and private output paths, so this epic does not require a second database or an external logging service.
  Evidence: `src/application/job-service.ts` assigns `stateDir/logs/{jobId}.log`, while `src/persistence/job-store.ts` persists job JSON records.

- Observation: the previously closed PR #3 explored a much broader restart-safe checkpoint and lease design. That design is not the scope of this plan.
  Evidence: the epic explicitly allows offset reconnect after a temporary HTTP interruption but excludes process recovery after Relay restart, distributed checkpoints, and multiple persistent state machines.

## Decision Log

- Decision: the authoritative Relay file, HTTP response body, and workflow artifact contain the exact accepted child bytes without semantic secret redaction.
  Rationale: this epic defines raw output as no JSON, Base64, UTF-8 decode/re-encode, prefixes, or truncation markers. Applying `StreamingRedactor` would change byte identity and make byte offsets ambiguous. Access is therefore controlled by the existing Relay bearer token and GitHub repository permissions. This makes the log intentionally sensitive and must be documented clearly.
  Date/Author: 2026-07-16 / plan author.

- Decision: GitHub Actions command parsing is disabled only in the console presentation layer with a random `::stop-commands::<token>` guard and matching resume line.
  Rationale: lines that begin with `::` must not be interpreted as workflow commands. Guard lines are runner presentation bytes and must never enter the Relay output file, HTTP offset accounting, or artifact.
  Date/Author: 2026-07-16 / plan author.

- Decision: accepted output order is the order in which Node.js invokes the stdout and stderr `data` callbacks.
  Rationale: the operating system exposes two independently buffered streams, so the service cannot promise a stronger chronology than the callback order it receives.
  Date/Author: 2026-07-16 / plan author.

- Decision: `MAX_OUTPUT_BYTES` is a hard limit over the combined stdout and stderr bytes reserved for acceptance. A chunk that would exceed the limit is rejected in full.
  Rationale: partial acceptance and a truncation marker hide diagnostic loss and can make a successful process appear complete. The job must fail with `OUTPUT_LIMIT_EXCEEDED`, preserve the already accepted prefix, terminate Codex, and publish that prefix as the artifact.
  Date/Author: 2026-07-16 / plan author.

- Decision: `OutputStore` is a small in-process coordination component backed by one private file per job; it is not a durable event log, message broker, or restart-safe checkpoint system.
  Rationale: the epic needs current-process live following and offset replay from the file. Relay restart still marks an active job `interrupted`; it does not restart Codex or reconstruct an active stream state machine.
  Date/Author: 2026-07-16 / plan author.

- Decision: a successful HTTP response acknowledges its exact starting byte in `X-Agent-Relay-Output-Offset`; an offset above the committed length returns `416` with `X-Agent-Relay-Output-Length`.
  Rationale: the runner must prove where replay began before it can avoid duplicates. The protocol remains simple and byte-oriented.
  Date/Author: 2026-07-16 / plan author.

- Decision: the runner advances its confirmed offset only after the full chunk has been written to the artifact and to guarded stdout. A local sink failure is fatal and is never retried.
  Rationale: retrying after a local side effect could duplicate either the artifact or GitHub Actions output. Offset reconnect is only for transient remote HTTP transport failure.
  Date/Author: 2026-07-16 / plan author.

- Decision: the workflow always attempts to upload the artifact path, even when the runner, Codex, output limit, or transport fails.
  Rationale: the acceptance criteria require a partial artifact when only a prefix was delivered and when the output limit is reached. If artifact creation itself fails, the workflow must show the explicit error and may have no file to upload.
  Date/Author: 2026-07-16 / plan author.

- Decision: job terminal persistence precedes output stream completion.
  Rationale: a clean stream end must mean that every accepted byte is durably written and the corresponding terminal job status is already available. The runner can then await both the stream and the status without a race that loses final bytes.
  Date/Author: 2026-07-16 / plan author.

- Decision: existing process user, launcher, authentication mount, Codex permissions, checkout rules, token scope, pull-request gating, and `runner/finalize.sh` remain unchanged.
  Rationale: these are explicit non-goals and are unrelated to output transport.
  Date/Author: 2026-07-16 / plan author.

## Outcomes & Retrospective

This plan is active and contains no implementation. The current repository still shows only job status in the runner, persists redacted and silently truncated executor output, and uploads a runner-console transcript rather than the raw accepted Codex bytes.

Completion will be measured by observable live GitHub Actions behavior, byte-identical replay and artifact tests, explicit failure behavior, and the full repository validation suite. A passing implementation must remain smaller than a general logging platform and must not reintroduce the restart-safe checkpoint architecture that is outside this epic.

## Context and Orientation

`src/execution/codex-executor.ts` launches `/usr/local/bin/codex-run` with stdout and stderr pipes. It currently owns file creation, output byte counting, redaction, truncation, Relay stdout mirroring, timeout termination, and exit-code classification. This concentration is the first boundary to change: process execution remains there, while output persistence and active-reader notification move to `OutputStore`.

Create `src/persistence/output-store.ts` as the single output component. A committed byte is a byte whose complete file write has finished successfully. The component serializes appends in the callback order in which they were enqueued, tracks the committed length, wakes output endpoint readers when the length or terminal state changes, and keeps the file available after process exit. It may use Node.js built-ins only.

`src/application/job-service.ts` creates a `JobRecord`, persists it through `src/persistence/job-store.ts`, starts execution, and stores the final job status. It must prepare output before the child starts. It must not mark the output complete until the executor has closed the child, both child streams have ended, and all accepted writes have drained. It must save the terminal job record before asking `OutputStore` to close the live stream.

`src/api/server.ts` currently supports health, job creation, and job status. Add the output route beside the existing job route. Authentication must reuse `requireBearerToken`. The server derives the output file only from the validated `JobRecord`; no URL, query, or request body may supply a filesystem path.

`runner/client.mjs` is the GitHub Actions transport client. After `POST /v1/jobs` returns a validated job ID, it must start two concurrent operations: output consumption and job-status polling. Output consumption writes bytes to the configured artifact file and guarded stdout. Status polling continues to use the existing validated JSON contract. The client exits successfully only when the output stream ended cleanly and the job status is `completed`.

`.github/workflows/agent-relay.yml` and `examples/github-actions/agent-relay.yml` are presentation and publication layers. They must provide the artifact path, run the client directly so its stdout remains live, upload the artifact on every outcome, preserve the step outcome, and run the existing finalizer only after a successful Relay step.

The public create-job request, active plan validation, prompt, workspace security, Docker images, Compose topology, Codex launcher, GitHub credential boundaries, and Git finalizer are outside this change.

## Plan of Work

### Milestone 1: Establish one raw output contract

Add `src/persistence/output-store.ts` and focused tests. Prepare an exclusive private output file with mode `0600`, accept copied `Buffer` instances, reserve total bytes synchronously before asynchronous writing, serialize complete writes, and expose committed length plus active or terminal state. Reject an entire chunk when accepting it would exceed `MAX_OUTPUT_BYTES`. Preserve already committed bytes after any limit or write failure.

The store must support a current HTTP reader starting at any valid committed offset and waiting for either more committed bytes or terminal state. Historical terminal output can be read from the same private file. Active-job restart recovery remains limited to the existing `interrupted` job behavior; do not add checkpoint files, leases, a broker, a database, or child-process recovery.

This milestone is complete when tests prove exact append order, whole-chunk limit behavior, file mode, write serialization, committed-length updates only after full writes, waiter wakeup, terminal wakeup, and preservation of the committed prefix after failures.

### Milestone 2: Integrate Codex execution and terminal ordering

Change `CodexExecutor.run` to receive an output writer rather than an output path. On every stdout or stderr `data` event, synchronously copy and enqueue the chunk. The single enqueue sequence defines combined order. Remove `StreamingRedactor`, text decoding, partial chunk slicing, direct output-file ownership, and `[OUTPUT TRUNCATED]` from the execution path.

If the store rejects a chunk because of the limit or a write fails, terminate Codex, ignore later child chunks, wait for the child and already accepted writes to settle, and return an output-specific failure to `JobService`. Keep timeout and non-zero exit classification distinct. Relay container stdout mirroring is optional and best-effort only: attempt it after an authoritative append; disable it for the rest of the job if writing throws, emits an error, closes, or returns backpressure. Mirror failure must not alter job or stream outcome.

Update `JobService` to prepare output before execution, save the process-derived or output-derived terminal job record, and only then mark the output terminal so endpoint readers receive clean EOF. Use `OUTPUT_LIMIT_EXCEEDED` and `OUTPUT_WRITE_FAILED` as stable job error codes. Keep `CODEX_FAILED`, `CODEX_TIMEOUT`, and `INTERRUPTED` semantics. A non-zero or timed-out Codex process still has clean diagnostic output if output persistence succeeded.

This milestone is complete when integration tests prove live output before process completion, controlled stdout/stderr interleaving, success, non-zero exit, timeout, spawn failure, hard limit, write failure, final-byte drain, and no output completion before terminal job persistence.

### Milestone 3: Add the authenticated offset streaming endpoint

Add `GET /v1/jobs/{jobId}/output?offset={byteOffset}`. The runner sends `Authorization: Bearer <token>` and `Accept: application/octet-stream`. Parse `offset` as a canonical non-negative decimal safe integer, defaulting to zero when omitted. Validate authorization, job ID, job existence, offset, and output availability before starting the raw response.

A successful response uses HTTP `200`, `Content-Type: application/octet-stream`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and `X-Agent-Relay-Output-Offset` equal to the exact requested starting offset. It writes all committed bytes from that offset, remains open while the job output is active, writes newly committed bytes in order, and ends only after the store is terminal and every committed byte has been sent.

An offset greater than committed length returns HTTP `416` with the normal bounded JSON error envelope, code `OUTPUT_OFFSET_OUT_OF_RANGE`, and `X-Agent-Relay-Output-Length` containing the current committed length. Missing or invalid authentication uses the existing `UNAUTHORIZED` behavior. Invalid syntax uses `INVALID_REQUEST`. Unknown jobs use `JOB_NOT_FOUND`. No error response exposes an output path. Once octet-stream headers or bytes have been sent, a later server or filesystem error must destroy the response rather than append JSON to raw output; the runner will retry from its confirmed offset or report a terminal transport failure.

This milestone is complete when endpoint tests prove existing-byte replay, live following, clean terminal EOF, zero-byte output, exact acknowledgement headers, `416`, invalid offsets, unknown jobs, missing and incorrect tokens, client abort cleanup, write backpressure, and no path disclosure.

### Milestone 4: Stream, resume, and archive in the runner

Add mandatory `AGENT_RELAY_OUTPUT_PATH` handling to `runner/client.mjs`. Validate that it is an absolute path under `RUNNER_TEMP` and outside `GITHUB_WORKSPACE`, reject symlinks and `GITHUB_OUTPUT`, create or truncate it before job creation with mode `0600`, and leave the file in place on every later outcome so the workflow can upload a partial prefix.

Immediately after job creation, start output consumption and status polling concurrently. Open the endpoint at offset zero, validate `200`, octet-stream content type, no redirect, and exact `X-Agent-Relay-Output-Offset`. Before the first raw chunk, print one random GitHub `stop-commands` guard. For each complete response chunk, fully append it to the artifact, fully write the unchanged bytes to stdout, and only then advance the confirmed offset. Guard lines, status lines, and errors never enter the artifact.

Retry only transient endpoint connection, response-body, or premature-close failures. Reopen with the confirmed offset, require the server to acknowledge that exact offset, and sleep for `AGENT_RELAY_POLL_INTERVAL_MS` without exceeding the existing global poll deadline. Retry remains allowed after the job becomes terminal because the previous connection may have broken before the final bytes arrived. Explicit HTTP errors, redirects, content-type errors, acknowledgement mismatches, JSON polling failures, local artifact failures, stdout failures, and signals are fatal and non-retryable.

Always restore GitHub command processing in a `finally` path when the guard was started. After both output consumption and polling finish, print the terminal job result outside the guard. Preserve the artifact for `completed`, `failed`, `timed_out`, `OUTPUT_LIMIT_EXCEEDED`, unrecoverable transport failure, and any other partial-output outcome. Write `commit_message` to `$GITHUB_OUTPUT` only when output handling completed cleanly and the job status is `completed`.

This milestone is complete when runner tests prove immediate streaming, no duplicate bytes during normal execution or reconnect, exact artifact bytes, safe workflow-command-looking output, partial artifact preservation, retry while active and terminal, unavailable endpoint behavior, artifact-write failure behavior, status failure behavior, and correct process exit codes.

### Milestone 5: Publish the right artifact without moving transport into YAML

Update `.github/workflows/agent-relay.yml` and `examples/github-actions/agent-relay.yml`. Set `AGENT_RELAY_OUTPUT_PATH` to `${RUNNER_TEMP}/agent-relay-output.log`. Run `node /runner/client.mjs` directly; do not use the workflow as an HTTP streaming implementation. Keep `continue-on-error: true` on the client step so the artifact upload runs. Upload the configured raw file with `if: always()` and preserve the existing step that converts a failed client outcome into a failed workflow.

Do not change checkout, pull-request resolution, credentials, concurrency, active-plan selection, commit message ownership, or `runner/finalize.sh`. The upload name remains `agent-relay-output`. The file itself is `agent-relay-output.log` and contains only the process bytes successfully written by the runner, which may be a partial prefix on failure.

This milestone is complete when workflow contract tests prove direct live stdout, exact output path wiring, unconditional upload, partial-file compatibility, failure propagation after upload, and unchanged finalizer and credential boundaries.

### Milestone 6: Document and validate the complete behavior

Update `README.md` and `docs/operations/README.md`, and add or update a focused live-output document under `docs/operations/`. Explain the authenticated endpoint, byte ordering, raw and unredacted security decision, GitHub command guard, output limit, process versus transport failures, partial artifact semantics, optional Relay stdout mirror, retention limitations, and restart non-goals.

Run focused tests after each milestone, then run the full repository suite. Update this living plan with exact test names, counts, coverage, failure evidence, and decisions made during implementation. Do not mark a Progress item complete merely because code exists.

This milestone is complete when all acceptance scenarios pass, `npm run check` and `git diff --check` succeed, no prohibited architecture change is present, and this plan can be moved to `completed` with a truthful retrospective.

## Concrete Steps

Run all commands from the repository root. Begin by confirming the plan-only baseline and relevant contracts:

    git status --short
    git rev-parse HEAD
    sed -n '1,240p' AGENTS.md
    sed -n '1,240p' .agent/PLANS.md
    sed -n '1,260p' src/execution/codex-executor.ts
    sed -n '1,260p' src/application/job-service.ts
    sed -n '1,260p' src/persistence/job-store.ts
    sed -n '1,220p' src/api/server.ts
    sed -n '1,320p' runner/client.mjs
    sed -n '1,260p' .github/workflows/agent-relay.yml

Expected result: the worktree contains this active plan and its README index entry; the implementation files still match the current behavior described in `Surprises & Discoveries`.

Implement Milestones 1 through 5 in order. Add focused tests before or with each behavior. Expected test locations are:

    test/output-store.test.ts
    test/output-endpoint.integration.test.ts
    test/executor.integration.test.ts
    test/job-service.test.ts
    test/runner-client.test.ts
    test/flow.integration.test.ts
    test/workflow-contract.test.ts

Use the existing test layout when a listed baseline file has a different current name. Do not delete, skip, weaken, or convert existing tests to `todo` to make the feature pass.

After each implementation milestone, run:

    npm run typecheck
    npm run build
    node --test dist/test/<focused-test-file>.js

Expected result: each focused command exits zero with no failed, skipped, todo, or cancelled test that covers this epic.

Run final validation:

    npm ci
    npm run check
    git diff --check
    git status --short
    git grep -n 'OUTPUT TRUNCATED' -- src runner test README.md docs || true
    git grep -n 'StreamingRedactor' -- src/execution/codex-executor.ts || true
    git diff -- Dockerfile compose.yml scripts/codex-run runner/finalize.sh src/execution/prompt.ts src/security/workspace.ts

Expected result: `npm run check` and `git diff --check` exit zero; the executor contains no truncation marker or redactor; the final diff for protected architecture files is empty unless this plan was explicitly revised because a proven blocker required a narrowly documented change.

## Validation and Acceptance

Acceptance is behavioral. Code structure alone is insufficient.

A live-output integration test starts Relay and the real runner client against a controlled fake Codex process. The process emits one stdout chunk, waits on a test barrier while the job remains running, then emits stderr and additional stdout. The test must observe the first bytes in runner stdout and in the artifact before releasing the barrier. This proves that GitHub Actions can display output before process completion.

An ordering test emits labeled stdout and stderr chunks through controlled callbacks. Relay replay, runner stdout inside the guard envelope, and the artifact must all contain the same callback-order byte sequence. The test must not claim operating-system chronology beyond the callback order.

A success test emits output and exits zero. The endpoint closes only after the final accepted write and terminal job save. The runner exits zero, writes `commit_message`, and the artifact exactly equals all accepted bytes.

A non-zero exit test emits diagnostic output and exits with code one. The live output and complete artifact remain available. The job is `failed` with `CODEX_FAILED`, the runner prints the failure after restoring GitHub commands, and the workflow-facing process exits non-zero.

A timeout test emits a prefix and remains running. Relay terminates it at `CODEX_TIMEOUT_MS`, drains accepted output, records `timed_out` with `CODEX_TIMEOUT`, closes the output stream, and preserves the prefix artifact. The runner and workflow fail.

A limit test configures a small `MAX_OUTPUT_BYTES`, emits chunks whose next full chunk would exceed the limit, and proves that the exceeding chunk contributes zero bytes. Relay terminates Codex, records `OUTPUT_LIMIT_EXCEEDED`, preserves and streams the previously accepted prefix without a marker, and the runner leaves that prefix as the uploaded artifact.

A reconnect test breaks the first HTTP output response after a known confirmed prefix. The runner reconnects with that exact offset, validates the acknowledgement header, receives the suffix once, and produces no gap or duplicate in stdout or the artifact. Repeat the break after the job has become terminal to prove that retry is not incorrectly disabled by terminal status.

An artifact-write failure test injects a local append failure. The runner must not retry the remote stream after the failed local side effect. It restores GitHub command processing, prints a stable `OUTPUT_ARTIFACT_WRITE_FAILED` diagnostic, exits non-zero, and leaves any already written prefix available for the workflow upload step.

An unavailable-endpoint test makes the output route refuse or reset connections. The runner retries only according to the transport policy, preserves any existing artifact prefix, emits a stable `OUTPUT_TRANSPORT_FAILED` diagnostic when the deadline is exhausted, and exits non-zero. Status polling alone must not turn missing output into success.

Authorization tests call the endpoint with no token, an incorrect token, and the configured token. The first two return the existing controlled `UNAUTHORIZED` JSON error before raw headers. The valid token may read only the output derived from the requested job record. No response contains a private filesystem path.

Workflow contract tests prove that `Run Codex through Agent Relay` displays client stdout directly, provides the raw artifact path, uploads with `if: always()`, and fails only after the upload step when the client step failed. The finalizer, checkout, token scopes, and ready-pull-request gate remain unchanged.

The complete suite must pass through:

    npm run check

The final plan update must record exact test counts and relevant coverage. Every acceptance scenario must have automated evidence.

## Idempotence and Recovery

Output file creation is per job ID and must be exclusive. A failed prepare removes only resources created by that failed attempt. Repeating a request with the same `requestId` continues to use the existing idempotency behavior and must not create a second output file or second child process.

Runner reconnect is idempotent only at the confirmed byte offset. The runner must never truncate or recreate the artifact during a retry. It opens the file once for the attempt, appends each acknowledged chunk once, and advances the offset only after both local sinks succeed.

A Relay process restart does not resume Codex. Existing `JobStore.markRunningJobsInterrupted()` behavior remains authoritative. A later read may expose the output file prefix as diagnostic data for the interrupted job, but this plan does not guarantee recovery of bytes that were in memory or in an incomplete filesystem write at the moment of restart. Do not add a checkpoint protocol to claim stronger guarantees.

A workflow rerun creates a new job and a new runner artifact file for that attempt. GitHub Actions retention owns the uploaded artifact lifecycle. Agent Relay log retention and rotation remain outside this epic.

## Artifacts and Notes

Planning evidence:

- `AGENTS.md` requires strict TypeScript, explicit validated contracts, English code, and agent-owned repository work.
- `.agent/PLANS.md` requires active plans under `docs/exec-plans/active/`, checked evidence for completion, and movement to `docs/exec-plans/completed/` only after all work is complete.
- `README.md` on the base commit listed `Active: None`; therefore no active plan file was archived by this planning change.
- `src/execution/codex-executor.ts` currently redacts, decodes, partially truncates, inserts a marker, and owns the output file.
- `runner/client.mjs` currently performs JSON status polling only.
- `.github/workflows/agent-relay.yml` currently uploads `agent-relay-console.log`, a `tee` transcript rather than an exact raw output artifact.

Implementation evidence must be appended here as work proceeds. Include concise command results, test names, counts, coverage, and any intentional replacement of a baseline assertion.

## Interfaces and Dependencies

Use Node.js built-ins and existing repository utilities only. Do not add a runtime dependency.

In `src/contracts/errors.ts`, extend the error code union with at least:

    OUTPUT_LIMIT_EXCEEDED
    OUTPUT_WRITE_FAILED
    OUTPUT_OFFSET_OUT_OF_RANGE

Use the existing `RelayError` and JSON error envelope for errors known before raw headers.

In `src/persistence/output-store.ts`, expose one repository-internal component with responsibilities equivalent to:

    type OutputTerminal =
      | { kind: "complete" }
      | { kind: "error"; code: "OUTPUT_LIMIT_EXCEEDED" | "OUTPUT_WRITE_FAILED" | "INTERRUPTED" };

    interface OutputSnapshot {
      committedLength: number;
      terminal?: OutputTerminal;
    }

    class OutputStore {
      prepare(jobId: string, outputPath: string, maxBytes: number): Promise<void>;
      append(jobId: string, chunk: Uint8Array): Promise<void>;
      snapshot(jobId: string, outputPath: string): Promise<OutputSnapshot>;
      read(jobId: string, outputPath: string, offset: number, maxBytes: number): Promise<Buffer>;
      waitForChange(jobId: string, offset: number, signal: AbortSignal): Promise<OutputSnapshot>;
      finish(jobId: string, terminal: OutputTerminal): Promise<void>;
    }

The final names may follow repository conventions, but the responsibilities and state transitions must remain explicit and tested. `append` must copy caller-owned bytes before returning and serialize writes. The file path comes only from `JobRecord` or trusted service construction.

Change `CodexExecutor.run` so it receives the prepared output sink instead of creating or opening an output path. It returns process outcome only after child close and accepted output drain. Output limit and write failures must be distinguishable from process exit and timeout.

Keep `JobRecord.outputPath` private through `toPublicJob`. `JobService` remains the owner of job status and the output terminal ordering. Do not add output bytes, Base64 content, or paths to job JSON polling.

The output endpoint contract is:

    GET /v1/jobs/{jobId}/output?offset={byteOffset}
    Authorization: Bearer <token>
    Accept: application/octet-stream

Successful response headers include:

    Content-Type: application/octet-stream
    Cache-Control: no-store
    X-Content-Type-Options: nosniff
    X-Agent-Relay-Output-Offset: <exact-start-offset>

An offset beyond the committed boundary returns `416` JSON and:

    X-Agent-Relay-Output-Length: <current-committed-length>

Add `AGENT_RELAY_OUTPUT_PATH` to the runner contract and workflow environment. Keep the existing request, poll, plan-path, commit-message, and finalizer contracts unchanged.

Revision note (2026-07-16): created a plan-only ExecPlan from the live-output epic, resolved raw-output and partial-artifact semantics, kept transient offset reconnect in scope, and explicitly excluded the restart-safe checkpoint and lease architecture explored by the closed PR #3.
