# Add restart-safe raw Codex output streaming without regressing isolation

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current while work proceeds.

Follow `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the task instruction. Files under `docs/exec-plans/completed/` are historical records, not current contracts. Every repository change required by this pull request must first be described in this plan. Do not create a second implementation plan or an alternative instruction channel. Do not run `git commit`, `git push`, `git merge`, `git rebase`, or an equivalent command that creates, rewrites, or publishes commits. The GitHub runner owns commit and push.

The architectural baseline is current `main` commit `f043af2fa9eb0420a0d64684485700f92a5dc425` from PR #9. The implementation must preserve that commit's execution, credential, filesystem, prompt, request, result-free, finalization, and public-API boundaries. Use `git show f043af2fa9eb0420a0d64684485700f92a5dc425:<path>` when the checked-out branch contains an older conflicting version. Apply raw output streaming additively to current main rather than restoring code removed by PR #9.

Neither Codex nor the reviewing agent can execute Docker, Docker Compose, an image build, a container, or a container health check in this workflow. No milestone, acceptance condition, merge gate, required check, or completion claim may depend on `docker`, `docker compose`, `podman`, an equivalent container runtime, or externally observing a running container. Dockerfiles, `compose.yml`, mount declarations, users, environment declarations, and packaging files are repository configuration and may be checked only through source review, comparison with current main, parsing or text assertions, and non-container tests. Absence of container-runtime evidence is not a blocker and must not be reported as missing validation.

## Purpose / Big Picture

After this work, an operator can observe Codex standard output and standard error while Codex is still running, reconnect to the Relay output endpoint from an exact byte offset, and obtain a byte-identical terminal archive after Relay has finalized the stream. The authoritative stream is stored in the Relay-only state directory. Process-console and GitHub-visible output are presentation sinks and may fail without changing authoritative byte order or job execution.

The feature must not weaken isolation. Codex remains the fixed `agent` user launched through `/usr/local/bin/codex-run`, receives a fixed minimal environment, cannot read Relay or runner internals, can write only the selected repository and private runtime directory, and can read only that repository's Git metadata. The runner receives the Relay bearer token only in the workflow client step. Repository configuration continues to declare only the host Codex `auth.json` file as read-only. Checkout and publication credentials remain outside Codex and Relay execution.

Raw output is intentionally unredacted and sensitive. A configured maximum protects Relay storage. Reaching the maximum fails the job and output stream explicitly; it never produces a successfully truncated stream.

Codex does not write `.agent-relay/result.json`, does not report a model-owned status, blocker, validation result, or commit message, and does not decide whether a commit is needed. Relay derives the technical job outcome from the child process. The runner derives the commit subject from the selected active plan. The finalizer uses Git as the source of truth for publication.

## Progress

- [x] (2026-07-13 23:33Z) Created the original raw-output design and initial implementation.
- [x] (2026-07-14 21:50Z) Recorded nine implementation defects and opened inline review threads.
- [x] (2026-07-15 00:42Z) Re-reviewed all 23 changed files against current main after PR #9 and replaced the obsolete repair plan with a current-main plan.
- [x] (2026-07-15 21:00Z) Rechecked the restored branch, all nine unresolved threads, current merge state, workflow status, implementation files, and tests without changing repository code.
- [x] (2026-07-15 21:00Z) Identified additional merge blockers: no durable active-job committed-length checkpoint, unbounded replay-handle/state lifetime, no response offset confirmation, retry duplication after local sink failure, ignored configured poll interval, incomplete drain failure handling, and short-read spin risk.
- [x] (2026-07-15 21:30Z) Removed every container-runtime dependency from validation. Docker and Compose declarations remain subject only to static repository inspection and non-container tests.
- [ ] Reconcile every touched file with current main, retaining only raw-output implementation, documentation, tests, and necessary static packaging declarations.
- [ ] Preserve all current-main active-plan, request, prompt, process-outcome, runner-finalization, credential, user, environment, filesystem, packaging, and public-API contracts.
- [ ] Implement durable committed-output checkpoints, serialized appends, explicit writer finalization, first-terminal-wins semantics, exact interrupted recovery, and bounded replay resource lifetime.
- [ ] Add bounded persistence-before-presentation processing to the isolated Codex executor without restoring model result files or broad process permissions.
- [ ] Add the authenticated offset endpoint with exact offset acknowledgement, identity transfer, deterministic error semantics, and unchanged public job DTOs.
- [ ] Extend the current runner with exact protocol validation, non-duplicating retry classification, bounded presentation, workflow-command isolation, atomic archive publication, and finalization before `$GITHUB_OUTPUT`.
- [ ] Preserve workflow credential scoping and static packaging declarations while adding only the output artifact configuration required by the feature.
- [ ] Update canonical documentation for raw sensitivity, output limits, checkpoints, replay, archive, failure, recovery, and the explicit absence of container-runtime validation.
- [ ] Add deterministic non-container tests for every merge gate and every original and additional review finding.
- [ ] Run all available non-container validation on the exact final head, reconcile against then-current main, and keep this plan active until GitHub reports the PR mergeable with no unresolved implementation finding.

## Surprises & Discoveries

- Observation: the branch is not based on the current architecture.
  Evidence: PR #3 is ahead of and behind `main`, its merge base predates PR #9, and GitHub reports it as non-mergeable.

- Observation: the branch restores contracts deliberately removed by PR #9.
  Evidence: it restores execution modes, review findings, `blocked`, `resultPath`, `.agent-relay/result.json`, model result validation, model-proposed commit messages, broad prompt prose, `danger-full-access`, inherited process environment, runner-service Relay credentials, and a writable full Codex-home mount.

- Observation: the branch weakens public and instruction boundaries.
  Evidence: it returns internal `JobRecord` fields directly and replaces current-main active-plan-only rules with a generic `.agent/PLANS.md` that tells Codex to commit frequently.

- Observation: nine actionable inline findings remain unresolved.
  Evidence: the open threads cover contradictory commit instructions, non-atomic archives, retrying explicit HTTP responses, finalization after success publication, fabricated missing output, writer descriptor and durability failures, JSON after raw headers, mirror-before-persistence, and incomplete creation rollback.

- Observation: active-job restart correctness cannot be recovered from terminal metadata alone.
  Evidence: `committedLength` exists only in memory while the job runs. A process crash during a positional write may leave a longer physical file but no durable boundary identifying the last fully accepted byte.

- Observation: terminal replay resources can grow without bound.
  Evidence: the prototype stores one read-write handle and one state-map entry per job until process shutdown. Merely separating writer and replay handles still leaks descriptors or memory without explicit release and eviction.

- Observation: the offset protocol has no positive acknowledgement.
  Evidence: the client sends `?offset=N`, but a `200` response contains no header proving the body begins at `N`.

- Observation: local sink failures are caught as remote body disconnects.
  Evidence: an exception from archive, stdout, or workflow-command handling is caught by the same block as `reader.read()`. Reconnecting can replay and duplicate a chunk whose local side effects already occurred.

- Observation: `AGENT_RELAY_POLL_INTERVAL_MS` is not respected.
  Evidence: reconnect paths sleep for `Math.min(pollIntervalMs, 1000)`, silently reducing every configured interval above one second.

- Observation: drain waits are incomplete.
  Evidence: runner write helpers wait only for `drain`; endpoint writes omit `error`. A closed or failed stream can leave a promise pending or produce an unhandled failure.

- Observation: committed reads can make partial or zero progress.
  Evidence: a shortened file can produce a short response and then a zero-read loop instead of `OUTPUT_READ_FAILED`.

- Observation: output archive and terminal ordering are unsafe.
  Evidence: the final path is opened directly, archive sync errors are swallowed, and `$GITHUB_OUTPUT` can be mutated before finalization succeeds.

- Observation: presentation currently precedes persistence and has no reliable bound.
  Evidence: the executor writes to process stdout before `OutputStore.append()` and ignores mirror backpressure. The rolling tail can retain an oversized backing allocation through `subarray()`.

- Observation: startup and creation failure handling are not transactional.
  Evidence: startup eagerly attaches every recovered output file; creation rollback suppresses cleanup failures and removes a request mapping without ownership comparison.

- Observation: output storage protection was removed.
  Evidence: the branch removes `MAX_OUTPUT_BYTES`, allowing one child process to exhaust Relay storage.

- Observation: the current head has no qualifying CI evidence.
  Evidence: results from another head do not validate the restored branch.

- Observation: Docker and Compose cannot be executed in the available agent environment.
  Evidence: neither Codex nor this reviewer has a supported container runtime execution path. A merge condition that requires image construction, container startup, Compose orchestration, a health check, or live mount inspection would be impossible to satisfy and therefore invalid.

## Decision Log

- Decision: current main after PR #9 is the mandatory baseline.
  Rationale: raw streaming is additive observability and does not justify restoring removed control or security mechanisms.
  Date/Author: 2026-07-15 / PR review.

- Decision: the active plan is the sole task authority and must describe every repository change before it is made.
  Rationale: modes, review arrays, completed plans, PR comments, and duplicate prompt prose must not become competing implementation instructions.
  Date/Author: 2026-07-15 / PR review.

- Decision: no Docker or Compose execution is a merge gate.
  Rationale: the available agents cannot execute a container runtime. Dockerfiles and Compose are validated as source configuration only. A missing runtime execution transcript is neither a defect nor incomplete evidence.
  Date/Author: 2026-07-15 / user correction and PR review.

- Decision: committed output requires a durable active-job checkpoint, not only in-memory length or terminal metadata.
  Rationale: exact restart replay is impossible after a crash during a write unless the last accepted boundary is persisted independently of physical file size.
  Date/Author: 2026-07-15 / PR review.

- Decision: a byte becomes committed only after its complete batch is written, data-synced, and an atomic checkpoint containing the new length is persisted.
  Rationale: readers and reconnect offsets may acknowledge only bytes reconstructable after process restart. Batching may amortize sync cost, but append promises and reader notifications occur only after the checkpoint succeeds.
  Date/Author: 2026-07-15 / PR review.

- Decision: interrupted recovery may remove an uncommitted physical suffix only by using the durable checkpoint under exclusive recovery ownership.
  Rationale: a file longer than the checkpoint is expected crash residue for an active job. Historical terminal attachment never creates, repairs, extends, or silently truncates data.
  Date/Author: 2026-07-15 / PR review.

- Decision: output checkpoints are authoritative for output progress and terminal facts; the terminal job record stores a matching copy.
  Rationale: missing, malformed, or mismatched duplicated metadata is an explicit output integrity error, not a reason to infer success from status or file size.
  Date/Author: 2026-07-15 / PR review.

- Decision: replay handles and terminal state entries have a bounded lifecycle.
  Rationale: a long-running Relay must not retain one descriptor or heavyweight state object per completed job.
  Date/Author: 2026-07-15 / PR review.

- Decision: raw persisted output is authoritative and intentionally unredacted.
  Rationale: exact reconnect offsets and byte identity cannot be defined over independently redacted streams. Security comes from credential and filesystem isolation, authenticated access, limits, and retention controls.
  Date/Author: 2026-07-15 / PR review.

- Decision: preserve `MAX_OUTPUT_BYTES`, but convert exhaustion into explicit failure.
  Rationale: unlimited output can exhaust storage, while silent truncation falsely claims completeness.
  Date/Author: 2026-07-15 / PR review.

- Decision: persistence precedes every Relay-side presentation sink.
  Rationale: process-console output is an observation of committed bytes. Mirror backpressure or failure must not alter authoritative ordering, offsets, or job status.
  Date/Author: 2026-07-15 / PR review.

- Decision: every successful output response acknowledges its exact starting offset.
  Rationale: the runner cannot prove gap-free, duplicate-free replay from status and media type alone.
  Date/Author: 2026-07-15 / PR review.

- Decision: redirects are protocol failures.
  Rationale: automatic redirect following can change origin or representation. Relay requests use `redirect: "error"`.
  Date/Author: 2026-07-15 / PR review.

- Decision: only remote acquisition and body failures may reconnect; local sink failures never reconnect.
  Rationale: local effects may already have occurred, so retrying the same offset can duplicate archive, tail, or presentation bytes.
  Date/Author: 2026-07-15 / PR review.

- Decision: the final archive path denotes only an atomically published complete terminal stream.
  Rationale: a failed process may still have complete diagnostic output, but incomplete transport or local finalization never leaves a final artifact.
  Date/Author: 2026-07-15 / PR review.

- Decision: public job responses remain filtered and process outcome remains result-free.
  Rationale: streaming does not require filesystem paths, internal diagnostics, model-owned status, or model-authored commit intent.
  Date/Author: 2026-07-15 / PR review.

- Decision: repository acceptance uses local Node tests, `git diff --check`, focused static checks, available non-container exact-head CI, and final GitHub review.
  Rationale: repository code and configuration can be validated without a container runtime. No external deployment or container procedure may be claimed or required.
  Date/Author: 2026-07-15 / PR review.

## Outcomes & Retrospective

The branch contains useful prototypes for an output store, an offset route, runner streaming, and artifact handling, but it is not ready to merge. It conflicts with current main, restores obsolete and weaker architecture, has unresolved review findings, lacks validation on its current head, and does not yet guarantee exact restart recovery.

This revision preserves the feature and all earlier findings while adding the missing durable-checkpoint, resource-lifecycle, offset-acknowledgement, retry-duplication, poll-interval, drain-failure, and short-read requirements. It also removes container-runtime execution from acceptance. Completion requires deterministic non-container evidence for every merge gate below. Until then, this plan remains active.

## Context and Orientation

`src/execution/codex-executor.ts` launches the isolated Codex child. Current main defines the launcher, environment, and filesystem permission profile. Extend those contracts; do not replace them.

`scripts/codex-run`, Dockerfiles, `compose.yml`, and `src/server.ts` declare the intended packaging boundary. Treat Dockerfiles and Compose strictly as source configuration in this task. Review them against current main and assert their text or parsed structure where useful, but do not attempt to build or run them.

`src/application/job-service.ts` owns job creation, one-active-job admission, execution, terminal persistence, and compensation. `src/persistence/job-store.ts` owns job records and request-ID indexing. Public job responses are produced through `toPublicJob()` and must remain filtered.

`src/persistence/output-store.ts` is the authority for output bytes. Add a per-job checkpoint beside the output file, for example `logs/<jobId>.meta.json`. The checkpoint records durable committed length, a monotonic generation, and terminal metadata. Physical file size alone is never authoritative.

`src/api/server.ts` exposes authenticated APIs. Add `GET /v1/jobs/{jobId}/output?offset={nonNegativeSafeInteger}` without changing create or poll DTOs.

`runner/client.mjs` validates the selected active plan, derives the commit subject, submits and polls jobs, streams output, and writes `$GITHUB_OUTPUT`. Extend the current-main client; do not restore result-file validation, execution modes, `git status`, or model-derived commit messages.

## Plan of Work

### Milestone 0: reconcile with current main

For every changed file overlapping PR #9, begin from `git show f043af2fa9eb0420a0d64684485700f92a5dc425:<path>` and reapply only streaming-specific changes.

Preserve current-main `.agent/PLANS.md`, minimal `AGENTS.md`, minimal generated prompt, active-plan regular-file and symlink validation, request shape, process-derived statuses, plan-derived commit subject, finalizer behavior, public DTO filtering, launcher, environment, filesystem restrictions, credential-free checkout, step-scoped Relay token, publication credential scope, and static read-only `auth.json` mount declaration.

Remove obsolete `mode`, `reviewFindings`, `blocked`, `resultPath`, `.agent-relay/result.json`, result validation, model commit messages, configurable Codex launcher or user, `danger-full-access`, inherited environment, runner-service Relay token, and writable full Codex-home mount.

Acceptance: current-main Node and repository tests pass, static configuration comparisons show no security regression, and GitHub can compute a conflict-free merge. No container runtime command or observation is required.

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

`finalizeWriter(jobId)` seals new appends, drains the queue, performs final sync, attempts close even after an earlier failure, and clears the writer handle. Persist matching terminal output metadata in the output checkpoint and internal terminal job record. Publish clean EOF only after both persist successfully. A mismatch or persistence failure publishes an output error.

On append, sync, checkpoint, or close failure, preserve only the last durable checkpoint prefix. Persist the error terminal best-effort without replacing the first failure. Repeated terminal transitions are idempotent only when they match the first terminal.

On startup, mark accepted and running jobs interrupted as current main already does. Recover output lazily or through an isolated pass that cannot prevent service startup. Never infer committed length from file size. A longer file may be truncated to the checkpoint only for an interrupted active job under exclusive recovery ownership. Missing, shorter, malformed, or mismatched data becomes an output integrity error. Never fabricate an empty stream.

Historical terminal attachment is read-only and never repairs data. Validate checkpoint, terminal job metadata, and physical size before replay.

Use short-lived read-only handles per read, or a reference-counted lease closed when the last reader exits. Do not retain writable handles after finalization. Evict terminal state after the final waiter and reader release it; a later request reattaches from persisted metadata.

Make job creation compensation exhaustive. Independently attempt output and checkpoint discard, job deletion, and compare-and-delete of the exact request mapping. Preserve foreign mappings. Report incomplete cleanup rather than suppressing it.

Acceptance: local filesystem tests prove every crash boundary exposes only a durable prefix and never fabricates clean EOF. Repeated historical reads do not increase open descriptor count or retain unbounded terminal state.

### Milestone 2: isolated executor with bounded processing

Extend current-main executor and wrapper contracts. Preserve launcher arguments, fixed environment, private runtime directory, selected-workspace write access, read-only selected `.git`, and denied Relay, runner, sibling-workspace, agent-home, and general temporary paths in locally executable tests where these are implemented by Node or wrapper code. For declarations that exist only in Dockerfiles or Compose, use static source assertions only.

Remove redaction only from the authoritative raw-output path and document the sensitivity. Do not broaden access to compensate for redaction removal.

Use a FIFO with exact pending-byte accounting and tested high- and low-water marks. Pause both child streams at the high-water mark and resume only at or below the low-water mark. Bound overshoot to callbacks already delivered.

For each chunk, await durable `OutputStore.append()` first. Then mirror the exact chunk to process stdout. When mirror write returns false, wait for `drain`, `error`, or `close`, clean up listeners on every path, and never wait indefinitely. A mirror failure disables only that presentation sink and does not change authoritative output or process outcome.

Wait for child close, stdout end, stderr end, queue drain, checkpoint completion, and writer finalization. Preserve current-main classification: zero exit is completed; non-zero or spawn failure is failed; deadline is timed out; restart recovery is interrupted.

Acceptance: persisted callback order is byte-identical, restart checkpoints are exact, actual Relay-owned memory remains bounded under blocked output, presentation cannot precede persistence, and all locally executable current-main isolation tests pass. No container execution is part of this acceptance.

### Milestone 3: exact authenticated output protocol

Add `GET /v1/jobs/{jobId}/output?offset={nonNegativeSafeInteger}` behind the existing bearer token. Preserve public create and poll DTOs.

Validate job ID and decimal offset. Before raw headers, return the existing JSON envelope for malformed offsets, missing jobs, checkpoint or attachment failures, and offsets above committed length. Use `416` for a valid numeric offset beyond committed length and include `X-Agent-Relay-Committed-Length`.

Before `flushHeaders()`, complete attachment, checkpoint validation, offset validation, and the first required read or terminal snapshot. Preserve the first chunk for later writing.

A valid response is HTTP `200` with:

    Content-Type: application/octet-stream
    Cache-Control: no-store, no-transform
    X-Content-Type-Options: nosniff
    X-Agent-Relay-Output-Offset: <exact requested decimal offset>

Do not set a non-identity content encoding. Every expected read must return the complete requested available range. A zero-progress or short read before the durable committed boundary is `OUTPUT_READ_FAILED`.

After raw headers, every Relay or unknown exception destroys the response. Never call `sendJson()` when headers are sent, the response is destroyed, or it is no longer writable. Response writes wait for `drain`, `error`, or `close`, clean up listeners, and release waiters and reader leases on abort.

Acceptance: local HTTP tests prove exact replay, exact offset acknowledgement, deterministic pre-header and post-header behavior, no short-read loop, and resource release.

### Milestone 4: current-main runner with non-duplicating reconnects

Keep current-main preflight first: resolve real paths, validate the selected regular non-symlink active plan, read it, derive the normalized commit subject, require `$GITHUB_OUTPUT`, and use bounded exact JSON validation.

Install idempotent `SIGINT` and `SIGTERM` cleanup handlers before submission. Remove a stale final archive before POST. Create a unique same-directory temporary file exclusively with mode `0600`. A fatal preflight or preparation error occurs before POST.

Submit only `requestId`, `workspace`, and `planPath`. Use `redirect: "error"` for every Relay request.

For output requests set `Accept: application/octet-stream` and `Accept-Encoding: identity`. Accept only HTTP `200` with the correct media type, absent or identity content encoding, an existing body, and a canonical `X-Agent-Relay-Output-Offset` equal to `confirmedOffset`.

Explicit non-200 responses and protocol mismatches are fatal and non-retryable. Read at most 8192 diagnostic bytes.

Separate remote reading from local handling. Retry only request acquisition failure, accepted-body read failure, idle abort, or premature EOF while the last validated job status is nonterminal. Archive, tail, stdout, workflow-command, JSON-polling, and finalization failures are local and fatal.

Maintain `confirmedOffset` only after all required local handling succeeds. Use an allocation-bounded tail. If archive append failure is an intentional degradation, close and remove the temporary archive, retain the chunk once, continue presentation, and advance once without reconnecting.

Honor `AGENT_RELAY_POLL_INTERVAL_MS` as `Math.min(pollIntervalMs, remainingDeadline)`. Every stdout and stderr write waits for `drain`, `error`, or `close` and removes listeners.

Wrap GitHub-visible raw bytes with unique stop-command and resume markers. Marker newlines never change offsets or archive bytes.

A clean EOF is terminal only after the job is terminal. A technically failed process may still publish a complete diagnostic archive, but the workflow fails and `$GITHUB_OUTPUT` remains unchanged.

After terminal EOF, sync and close the temporary archive and atomically rename it to the final path. Any incomplete output or finalization failure leaves the final path absent.

Use one common finalization path. It restores workflow-command parsing, removes signal handlers, settles archive publication or cleanup, and records finalization errors before structured success or `$GITHUB_OUTPUT` mutation.

Do not read or remove `.agent-relay`, validate a model result, accept `blocked`, inspect Git status, or decide whether to commit. The finalizer retains those responsibilities.

Acceptance: local process and HTTP fixtures prove exact reconnects, no duplicate local bytes, respected polling cadence, non-hanging drain failures, exact archive publication, bounded presentation, inert workflow commands, and finalization before commit output.

### Milestone 5: workflow, packaging, documentation, and operations

Begin workflows, examples, Compose, environment examples, Dockerfiles, server bootstrap, wrapper scripts, README, and operations documentation from current main.

Keep checkout `persist-credentials: false`, the credential-free repository check, Relay token only in the client step, publication token only in finalization, and the static declaration mounting only `HOST_CODEX_AUTH_FILE` at `/home/agent/.codex/auth.json:ro`.

Keep `MAX_OUTPUT_BYTES` in configuration, static Compose declarations, docs, and executor construction. Add `AGENT_RELAY_OUTPUT_ARCHIVE_PATH` only to the client step. Upload the final archive and console log under `if: always()`; the final path is absent after incomplete output.

Do not run or require `docker`, `docker compose`, `podman`, image builds, container startup, container health checks, live user inspection, live mount inspection, or live environment inspection. Validate Dockerfiles and Compose only by comparison with current main, source review, parser-free text assertions, or repository tests that read those files as text. Do not add a test that shells out to a container runtime.

Document raw sensitivity, checkpoint semantics, recovery, output-limit failure, exact offset acknowledgement, redirect rejection, archive behavior, resource release, and the difference between process status and output completeness. Explicitly document that this PR's acceptance does not include container-runtime validation.

Acceptance: static repository checks prove the intended credential, mount, user, command, environment, and configuration declarations match the approved baseline plus required streaming additions. No runtime container evidence is requested or required.

### Milestone 6: deterministic non-container closure

Extend current-main tests rather than restoring obsolete fixtures. All tests required by this plan must run through Node, local files, local child processes, local HTTP servers, Git commands that do not create or rewrite commits, or static source inspection.

Output persistence tests cover concurrent appends; batching; partial and zero-progress writes; data-sync failure; checkpoint write, sync, rename, and mismatch failure; crash boundaries; suffix recovery; malformed data; first-terminal-wins; writer close; metadata agreement; descriptor counts; reader release; state eviction; concurrent attachment; startup isolation; and output-limit failure.

Job-service tests cover every preparation and terminal failure; independent compensation; checkpoint discard failure; job deletion failure; mapping ownership; incomplete rollback; interrupted recovery; output-error persistence; terminal persistence failure; and active-job lock release.

Executor tests cover binary bytes, invalid UTF-8, stdout and stderr order, watermarks, bounded overshoot, persistence before mirror, blocked mirror, mirror failure, listener cleanup, timeout, non-zero exit, spawn failure, persistence failure, output limit, locally executable isolation behavior, and static assertions for packaging declarations that cannot be executed.

Endpoint tests cover authentication; filtered DTOs; offsets; `416`; acknowledgement headers; first read before headers; replay boundaries; active following; short reads; response backpressure and failure; abort; resource release; restart attachment; JSON before headers; and post-header destruction.

Runner tests cover plan preflight; commit-subject derivation; archive preparation; redirects; identity transfer; protocol validation; bounded diagnostics; statuses; retry classes; local sink failures; no duplicates; polling interval; stream failure; signals; archive finalization; bounded memory; workflow-command isolation; finalization before output; and absence of obsolete result or Git-status behavior.

Add a controlled full-flow success test using a local fake Codex child, local Relay server, temporary directories, and local runner process. Prove first output before child exit, checkpoint advancement, exact bytes, exact offsets, no duplicates, bounded presentation, process-derived completion, plan-derived subject, and finalizer-owned publication. Do not use a container.

Add a crash-recovery full-flow test using local processes and temporary files. Crash Relay after a physical partial write, restart it, recover only the checkpoint prefix, expose interrupted or error terminal state, and prove no final archive or `$GITHUB_OUTPUT` mutation.

Add a local-sink failure full-flow test. Fail process stdout after a chunk reaches the temporary archive but before offset advancement. Prove no reconnect, no duplicate bytes, temporary cleanup, absent final path, and unchanged `$GITHUB_OUTPUT`.

After implementation, compare the diff with the recorded baseline and then-current `origin/main`. Do not mark completion while GitHub reports merge conflicts, the exact head lacks available non-container checks, or an implementation thread remains unresolved. Do not wait for or require a Docker-based check.

## Concrete Steps

Run from the repository root. Do not run commands that create, rewrite, or publish commits. Do not run any container-runtime command.

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

The following commands are explicitly forbidden as validation or merge evidence:

    docker ...
    docker compose ...
    docker-compose ...
    podman ...
    nerdctl ...

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

Record exact test counts, coverage, final main SHA, current head SHA, and conclusions from available non-container GitHub checks. Do not report unavailable external or container operations as passed, failed, pending, or required.

## Validation and Acceptance

The following merge gates are mandatory. None requires Docker or Compose execution.

1. The implementation is reconciled with then-current main and GitHub reports the PR mergeable.
2. Only the selected active plan is a task instruction; no agent instruction tells Codex to commit, merge, rebase, or push.
3. No execution mode, review-findings channel, model result artifact, model blocker or status, model validation, model commit message, or client-side Git decision exists.
4. Locally executable launcher, environment, filesystem, workspace, temporary-directory, and Git-metadata restrictions pass non-container tests. Dockerfile and Compose declarations are reviewed statically only; no image or container evidence is required.
5. Credential and packaging declarations are verified statically: the runner service declares no Relay bearer token, checkout persists no credentials, publication credentials remain finalizer-scoped, and only `auth.json` is declared read-only. No live mount or container inspection is required.
6. Create and poll responses expose no internal paths, output checkpoint, terminal diagnostic, or internal error message.
7. Creation attempts every compensation, compare-deletes only its own mapping, preserves foreign mappings, and reports incomplete rollback.
8. Appends are serialized and a byte is committed only after full write, data sync, and atomic checkpoint persistence.
9. Crash recovery never infers committed length from file size; it exposes only the durable checkpoint prefix and handles an uncommitted suffix explicitly.
10. Clean terminal publication drains appends, syncs, closes the writer, persists matching checkpoint and job terminal metadata, and only then publishes EOF.
11. Missing, malformed, unreadable, short, long, mismatched, or error-terminal output cannot become fabricated clean replay.
12. Writer and replay handles, reader leases, waiters, and terminal state entries have bounded lifetimes and are released on success, failure, abort, and repeated historical access.
13. Output-limit exhaustion is explicit failure and never successful truncation.
14. Authoritative persistence precedes mirroring; buffering is byte-bounded; mirror backpressure and failure cannot reorder or fail authoritative output.
15. Pre-header failures use JSON; every post-header failure destroys the transport; short or zero-progress reads cannot spin; abort cannot leak resources.
16. Every successful output response is `200 application/octet-stream`, identity encoded, `no-transform`, and acknowledges the exact requested offset.
17. The runner rejects redirects, missing bodies, media, encoding, or offset mismatch, explicit HTTP failures, and oversized diagnostics without reconnecting.
18. Only remote acquisition, body, idle, or premature-EOF failures while nonterminal reconnect. Local sink failures never reconnect or duplicate local bytes.
19. Reconnects resume from the exact confirmed offset without gaps or duplicates.
20. `AGENT_RELAY_POLL_INTERVAL_MS` is honored up to the remaining deadline; no hidden one-second cap exists.
21. Runner and server stream writes handle `drain`, `error`, `close`, destroyed state, and listener cleanup without hanging.
22. The final archive path is absent until terminal EOF, successful sync and close, and atomic rename. Incomplete output leaves no final artifact.
23. GitHub-visible prefix and tail are bounded in actual retained memory and keep workflow-command-looking bytes inert.
24. Common runner finalization succeeds before structured success or `$GITHUB_OUTPUT`; the current-main finalizer alone owns clean-worktree and publication behavior.
25. README and operations documentation describe the result-free architecture, raw sensitivity, hard limit, checkpoints, exact replay, offset acknowledgement, archive, credentials, resource release, recovery, and the non-container validation boundary.
26. Every original inline finding and every additional finding in this review has a deterministic non-container regression test or, for static packaging declarations, a deterministic source assertion.
27. `npm run check` and `git diff --check` pass on the exact final head, every configured and available non-container required GitHub check for that SHA passes, final review finds no mismatch, and no actionable thread remains unresolved. A Docker-based check, image build, Compose run, or absent container-runtime result is not required and cannot block this gate.

Do not move this file to `docs/exec-plans/completed/` and do not resolve implementation threads before all twenty-seven gates pass.

## Idempotence and Recovery

Tests use temporary repositories, state directories, output files, checkpoints, archive paths, local HTTP servers, and local child processes. Repeated runs do not alter operator state and do not create containers, images, networks, or volumes.

Job request retries preserve current-main idempotency. A matching request ID returns the existing job. Preparation rollback deletes only resources owned by the failing attempt and reports incomplete compensation.

The output checkpoint advances monotonically. Interrupted recovery may truncate only bytes beyond that checkpoint for the interrupted active job; historical terminal replay never repairs data.

The final archive path is dedicated to one workflow attempt. Startup removes a stale final path before POST and uses a unique temporary sibling. Cleanup removes only that temporary file.

A failed publication after a local commit remains the current finalizer's responsibility. Streaming code does not duplicate or bypass its recovery.

## Artifacts and Notes

Review state before this revision:

    PR: #3
    Previous head: 767e21feb7441f19b1623d1efd3a577d439ad80f
    Current main: f043af2fa9eb0420a0d64684485700f92a5dc425
    Merge base: 7dda1338b193f491591fffce219dd4dc362bf824
    GitHub mergeable: false
    Changed files: 23
    Unresolved inline findings: 9

Append final evidence in this form:

    2026-07-15 HH:MMZ - npm run check - exit 0 - <exact tests> passed, 0 failed; coverage recorded.
    2026-07-15 HH:MMZ - git diff --check - exit 0 - no whitespace errors.
    2026-07-15 HH:MMZ - crash checkpoint tests - exit 0 - <exact cases> passed.
    2026-07-15 HH:MMZ - static packaging review - current-main declarations preserved; no container runtime invoked.
    2026-07-15 HH:MMZ - final current-main comparison - <main sha> - no contract regression.
    2026-07-15 HH:MMZ - exact-head non-container GitHub checks - <head sha> - all available required checks passed.
    2026-07-15 HH:MMZ - GitHub PR review - mergeable, no unresolved actionable finding.

Do not add a Docker build, Compose execution, container inspection, health-check transcript, or equivalent placeholder to final evidence.

Raw child output can contain repository content, command output, tokens, or credentials printed by tools. Relay state, process logs, GitHub logs, and uploaded archives are sensitive execution data. Byte preservation is intentional; access restrictions, output limits, retention, checkpoint integrity, and credential isolation are part of acceptance.

## Interfaces and Dependencies

Do not add an external runtime dependency unless Node.js built-ins cannot meet a requirement. Do not add a container-runtime dependency to tests or validation.

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

Define and test explicit queue high and low water thresholds and:

    MAX_REMOTE_ERROR_BODY_BYTES = 8_192

The runner may receive:

    AGENT_RELAY_OUTPUT_ARCHIVE_PATH=<dedicated final path>

The final path means an atomically published complete terminal stream, never a live partial file.

Revision note (2026-07-15 21:30Z): Revised only this active plan after the user clarified that neither Codex nor the reviewer can execute Docker or Docker Compose. Removed every container-runtime execution dependency from milestones, validation, evidence, and merge gates. Dockerfiles and Compose remain statically reviewed repository configuration, but image builds, container runs, Compose orchestration, health checks, and live mount or user inspection are explicitly forbidden and cannot block merge.