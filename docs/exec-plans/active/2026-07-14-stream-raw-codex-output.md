# Add restart-safe raw Codex output streaming without regressing isolation

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current as work proceeds. Maintain this document in accordance with `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

Every repository change required by this pull request must first be described here. Codex must not run commands that create, rewrite, or publish commits. The GitHub runner owns commit and push. Codex must not modify `AGENTS.md`, `.agent/PLANS.md`, `.github/workflows/agent-relay.yml`, or `examples/github-actions/agent-relay.yml`; those instruction and workflow files are maintained by the human reviewer outside the Codex implementation pass.

## Purpose / Big Picture

After this work, an operator can watch the exact standard output and standard error produced by Codex while a job is still running, reconnect after a temporary interruption from an exact byte position, and receive a byte-identical terminal archive after Relay has finalized the stream.

Relay stores the authoritative byte stream in its private state directory. Console output and GitHub-visible output are presentation copies only: their slowness or failure must not reorder, invent, truncate, or invalidate persisted bytes. Raw output is intentionally unredacted and sensitive. `MAX_OUTPUT_BYTES` remains a hard storage limit; reaching it fails the child process, the job, and the output stream rather than reporting successful truncation.

The change must preserve the current `main` runtime architecture. Codex remains isolated from Relay and runner internals, receives only the approved environment and workspace access, and does not create a result artifact or decide whether a commit is needed. Relay derives the technical job result from the child process. The runner derives the commit subject from this active plan. The finalizer remains the only component that decides whether repository changes are publishable.

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
- [x] (2026-07-15, plan revision `21587cf36f2c82c678e9e1d7c2a41f418e74367b`) Rewrote the plan into the article skeleton, but incorrectly described the article-provided `.agent/PLANS.md` as legacy and left the implementation checklist incomplete.
- [x] (2026-07-15 21:06Z) Re-reviewed PR #3 against current `main`, the OpenAI ExecPlan article, and the restored prototype. Corrected task ownership, removed post-commit gates from Codex scope, selected process-restart durability semantics, and expanded the missing runtime, persistence, endpoint, runner, finalizer, and test work below.

- [ ] Human-maintained instruction setup: preserve `.agent/PLANS.md` byte-for-byte with blob `15d9583b1df0663488d55e4fdfea1c6154ba85d1`, and update `AGENTS.md` to contain the exact `# ExecPlans` section from the OpenAI article plus the minimal current-main engineering rules. Codex must not edit either file.
- [ ] Human-maintained workflow setup: update `.github/workflows/agent-relay.yml` and `examples/github-actions/agent-relay.yml` from current `main`, add only the terminal archive environment and upload behavior required by this feature, and preserve credential-free checkout, step-scoped Relay credentials, finalizer-scoped publication credentials, active-plan validation, and runner-owned commit and push. Codex must not edit either workflow file.
- [ ] Reconcile the complete branch snapshot with then-current `main`, not only files listed as changed by PR #3. Preserve every current-main file and contract changed by PR #9, including files changed only on `main`, then reapply only the streaming-specific additions described here. Treat `.agent/PLANS.md`, `AGENTS.md`, and the two human-maintained workflow files as explicit exceptions already owned outside the Codex pass.
- [ ] Restore the current-main result-free request and status contracts in `src/contracts/job.ts`, `src/contracts/validators.ts`, `src/execution/prompt.ts`, `src/application/job-service.ts`, and `runner/client.mjs`. Remove execution modes, review findings, `blocked`, `resultPath`, `.agent-relay/result.json`, `src/contracts/result.ts`, model validation, model summaries, model blockers, model commit messages, and client-side Git status decisions.
- [ ] Restore active-plan and workspace boundary validation from current `main` in `src/security/workspace.ts`, `src/contracts/validators.ts`, and `src/application/job-service.ts`: the plan must be a regular, non-symlink file directly under `docs/exec-plans/active/`, the workspace must resolve below the shared root, and validation must occur before persistence or executor invocation.
- [ ] Restore the fixed runtime launcher and process identity in `Dockerfile`, `scripts/codex-run`, `src/server.ts`, and `src/execution/codex-executor.ts`: Relay runs as `relay`, Codex runs as `agent` only through `/usr/local/bin/codex-run`, the command and user are not configurable, and the launcher cleans generated home state before each execution.
- [ ] Restore the fixed minimal Codex environment and filesystem boundary from current `main`: use `env -i`, the private per-run temporary directory, immutable packaged toolchains, denied Relay, runner, parent-workspace, home, and system temporary paths, write access only to the selected workspace and private runtime directory, and read-only access to the selected repository `.git` metadata.
- [ ] Restore credential isolation in `.env.example`, `compose.yml`, `Dockerfile`, `scripts/codex-run`, and `src/server.ts`: mount only `${HOST_CODEX_AUTH_FILE}` at `/home/agent/.codex/auth.json:ro`, never mount the full Codex home, never expose Relay or GitHub publication credentials to Codex, and never place the Relay token in the long-lived runner service environment.
- [ ] Restore public API filtering from current `main` so create and poll responses never expose `outputPath`, checkpoint paths or fields, private terminal diagnostics, or internal error messages. Add only explicitly public streaming headers and error envelopes.
- [ ] Define the internal output error taxonomy in `src/contracts/errors.ts` and use it consistently through persistence, job service, endpoint, and tests. It must distinguish preparation failure, write failure, read failure, integrity or recovery failure, output-limit exhaustion, and terminal-state disagreement without exposing private paths or raw internal messages through public job DTOs.
- [ ] Implement a durable per-job checkpoint with a versioned schema containing `jobId`, `committedLength`, and terminal output facts. A persistent generation counter is not required. The guarantee is restart safety after Relay process termination or restart, not host power-loss durability.
- [ ] Serialize appends in stdout and stderr callback order. Write each accepted chunk completely, then atomically replace the checkpoint before exposing the new committed length to readers. Do not require `fsync` for every append; perform final sync and close before publishing clean terminal EOF.
- [ ] Enforce `MAX_OUTPUT_BYTES` against committed, writing, and queued bytes before accepting a chunk. On exhaustion, stop accepting output, terminate the child process, publish `OUTPUT_LIMIT_EXCEEDED`, and never publish clean EOF or insert a textual truncation marker into authoritative bytes.
- [ ] Implement first-terminal-wins semantics. Writer finalization seals new appends, drains queued writes, syncs and closes the writer, clears writer state, and persists terminal facts that agree with job metadata. A clean terminal state cannot replace an output error, and a later error cannot replace an already published clean terminal state.
- [ ] Recover interrupted jobs from the checkpoint rather than physical file size. An interrupted active job may remove only a physical suffix beyond `committedLength` under exclusive recovery ownership. Missing, malformed, unreadable, shorter-than-checkpoint, or terminally inconsistent historical data is an integrity error and is never created or repaired during replay.
- [ ] Use short-lived read-only file handles for replay. Make attachment single-flight per job, bound live state and waiters, remove terminal state after the last reader or waiter releases it, and close writers, readers, waiters, and state entries on success, failure, abort, discard, and service shutdown. One corrupted historical output must not prevent unrelated jobs or the service from starting.
- [ ] Create output, checkpoint, and temporary files with mode `0600`; create private directories with mode `0700`; use unique temporary siblings and atomic rename for checkpoint replacement; and clean only temporary resources owned by the current attempt.
- [ ] Make job creation rollback exhaustive and ownership-safe. Independently discard prepared output state, remove the created job record, and compare-delete only the request-ID mapping that still points to that job. Preserve foreign mappings and return `JOB_PREPARATION_FAILED` with an incomplete-rollback indication when any compensation fails.
- [ ] Persist every executor chunk before mirroring it. Use a byte-bounded FIFO with explicit high and low watermarks, pause both child streams when the pending-byte limit is reached, and resume them only after authoritative persistence drains below the low watermark.
- [ ] Treat authoritative persistence failure as fatal to the child and job. Presentation backpressure, closure, or failure may disable the presentation sink but cannot reorder, duplicate, truncate, or fail already persisted authoritative bytes. Remove every `drain`, `error`, and `close` listener on all completion paths.
- [ ] Do not complete execution until the child has closed, both output streams have ended, the persistence queue has drained, the writer has been finalized, and terminal output facts have been persisted. Process exit status determines the job status; output completeness determines whether clean EOF is available.
- [ ] Add the authenticated output endpoint `GET /v1/jobs/{jobId}/output?offset=N`. Validate authentication, job ID, canonical decimal offset, checkpoint integrity, and the first required read or terminal snapshot before sending raw headers.
- [ ] For a valid offset above `committedLength`, return a pre-header JSON `416` response and include `X-Agent-Relay-Committed-Length`. For every successful stream return `200 application/octet-stream`, `Cache-Control: no-store, no-transform`, `X-Content-Type-Options: nosniff`, no compression, and `X-Agent-Relay-Output-Offset` equal to the exact requested offset.
- [ ] Make endpoint reads fail if a read makes short or zero progress before the committed boundary. Handle response `drain`, `error`, `close`, destroyed state, and client abort. Before headers, return the normal bounded JSON error envelope; after headers, destroy the transport for every error and never attempt JSON. Release all waiters and read handles on every path.
- [ ] Rebuild `runner/client.mjs` on the current-main client rather than the prototype control flow. Preserve bounded JSON response reading, strict expected HTTP status and content-type validation, safe request-ID generation, active-plan realpath validation, plan-derived commit subject, and the requirement that `$GITHUB_OUTPUT` is available before submitting a job.
- [ ] Before POST, configure `redirect: "error"` for every Relay request, install `SIGINT` and `SIGTERM` cleanup, remove only the stale final archive for this workflow attempt, create an exclusive same-directory temporary archive with mode `0600`, and initialize workflow-command suppression state.
- [ ] Validate every output response before consuming it: exactly HTTP `200`, `application/octet-stream`, no non-identity content encoding, a body, and an exact `X-Agent-Relay-Output-Offset` match. Bound every explicit HTTP or protocol diagnostic body to 8192 bytes and treat redirects, explicit HTTP failures, missing bodies, and protocol mismatches as fatal and non-retryable.
- [ ] Retry only transient remote connection acquisition, accepted-body transport, idle, or premature-EOF failures while the job remains nonterminal. Never reconnect after archive, stdout, tail, workflow-command, polling, signal cleanup, or finalization failure. Honor `AGENT_RELAY_POLL_INTERVAL_MS` up to the remaining deadline without a hidden one-second cap.
- [ ] Advance the confirmed remote offset only after the complete chunk has been written to the temporary archive and every required local presentation action has succeeded. A local failure after any side effect fails the run, removes the temporary archive, leaves the final archive absent, and never reconnects or replays that offset.
- [ ] Keep GitHub workflow-command-looking bytes inert with `::stop-commands::` while preserving archive bytes and remote offsets exactly. Bound retained live prefix and tail memory by bytes. Restore command parsing on success, failure, signal, and thrown-error paths, and handle stdout and stderr `drain`, `error`, `close`, destroyed state, and listener cleanup without hanging.
- [ ] Distinguish terminal job status from terminal output completion. A completed or failed process is not enough to publish the archive until the output endpoint produces confirmed terminal EOF. When the complete terminal stream is received, preserve its archive even for a failed or timed-out job so diagnostics remain available, while still failing the workflow for the non-completed job status.
- [ ] Publish the final archive only after confirmed terminal EOF, successful file sync, successful close, and atomic rename of the temporary sibling. Incomplete transport, local sink failure, signal, sync failure, close failure, or rename failure leaves the final path absent and removes only the attempt-owned temporary file.
- [ ] Complete common runner cleanup and output finalization before returning success or appending the plan-derived commit subject to `$GITHUB_OUTPUT`. Do not use model output or `git status` to decide whether a commit is needed; `runner/finalize.sh` owns the no-change decision.
- [ ] Reconcile `runner/finalize.sh` independently with current `main`. Preserve `git diff --check`, one-line and 120-Unicode-character commit-subject validation, credential injection only for push, failed-push recovery that restores the uncommitted worktree, and runner-only commit and push ownership. Streaming code must not duplicate or bypass finalizer behavior.
- [ ] Reconcile `.gitignore`, `.dockerignore`, `.env.example`, `Dockerfile`, `compose.yml`, `src/server.ts`, wrapper scripts, README, `docs/operations/README.md`, and `docs/operations/live-codex-logs.md` with current `main` and the final streaming behavior. Do not restore the obsolete `.agent-relay` result directory or result-artifact documentation.
- [ ] Validate Dockerfiles and `compose.yml` only through source comparison and deterministic source assertions. Do not add container-runtime commands, image builds, Compose execution, live-mount inspection, or container-dependent tests to this plan.
- [ ] Preserve every current-main test and fixture before extending coverage. Do not restore result-file, execution-mode, blocked-status, model-validation, model-commit-message, inherited-environment, broad-credential, writable-Codex-home, or obsolete workflow fixtures.
- [ ] Add focused deterministic persistence tests for callback ordering, partial writes, zero-progress writes, queued-byte limit accounting, atomic checkpoint replacement, process-restart suffix recovery, checkpoint corruption, first-terminal-wins, writer finalization, single-flight attachment, file modes, descriptor release, state eviction, startup isolation, and output-limit child termination.
- [ ] Extend current-main job-service and job-store tests for output preparation failures, each independent compensation failure, compare-delete ownership, foreign mapping preservation, incomplete rollback reporting, idempotent request replay, interrupted recovery, terminal disagreement, terminal persistence failure, and active-job lock release.
- [ ] Extend current-main executor tests for binary bytes, invalid UTF-8, stdout and stderr callback ordering, byte watermarks, bounded overshoot, persistence-before-presentation, blocked presentation, presentation failure, listener cleanup, timeout, non-zero exit, spawn failure, persistence failure, and output-limit termination while preserving the fixed launcher and environment boundary.
- [ ] Extend current-main endpoint tests for authentication, filtered DTOs, offset parsing, `416` committed-length acknowledgement, exact successful-offset acknowledgement, first-read-before-headers, replay boundaries, active following, short and zero-progress reads, backpressure, pre-header JSON errors, post-header destruction, abort, restart attachment, and complete resource release.
- [ ] Extend current-main runner and finalizer tests for preflight, safe request IDs, bounded JSON and raw diagnostics, redirects, identity transfer, protocol validation, transient-only reconnect, local-failure no-reconnect, exact offset progression, polling cadence, stream terminal states, workflow-command isolation, bounded presentation memory, signal cleanup, archive finalization, finalization before `$GITHUB_OUTPUT`, no-change behavior, and failed-push recovery.
- [ ] Add local full-flow tests using temporary directories, local HTTP servers, local processes, and a fake Codex child for: successful live binary output with one transient reconnect and byte-identical archive; Relay restart after an uncommitted physical suffix; and local sink failure after an archive side effect with no reconnect, duplicate, final archive, or `$GITHUB_OUTPUT` mutation.
- [ ] Run focused tests on the final working tree and record exact commands, pass/fail counts, coverage, and failures in `Artifacts and Notes`.
- [ ] Run `npm run check` and `git diff --check` on the final working tree and record the results. Do not require Codex to know a final commit SHA, inspect GitHub checks, prove mergeability, or perform post-commit review.

## Surprises & Discoveries

- Observation: `.agent/PLANS.md` in PR #3 is the intended article document, not legacy content.
  Evidence: its blob `15d9583b1df0663488d55e4fdfea1c6154ba85d1` is byte-for-byte identical to the `PLANS.md` body published in the OpenAI article. It must remain unchanged.

- Observation: `AGENTS.md` currently mixes the correct article `# ExecPlans` block with obsolete result-artifact and Docker instructions.
  Evidence: the article provides only the `# ExecPlans` section, while current `main` provides the minimal repository engineering rules. The human-maintained correction must combine those without restoring obsolete runtime contracts.

- Observation: the branch is not merely a 23-file streaming diff; it is also missing the architecture introduced by PR #9.
  Evidence: comparing the branch and current `main` in both directions shows files changed only on `main`, including the workflow, finalizer, launcher, prompt, workspace validation, contracts, packaging, and their tests. Reconciliation must cover the whole branch snapshot.

- Observation: workflow files cannot be delegated to Codex in this task.
  Evidence: the human reviewer owns credential and publication workflow changes. Codex is explicitly prohibited from editing the real or example workflow files.

- Observation: the first prototype opens the configured final archive path directly.
  Evidence: timeout, cancellation, disconnect, or crash can leave a partial file at the path uploaded under `if: always()`.

- Observation: explicit HTTP responses are grouped with reconnectable transport failures.
  Evidence: non-200 responses can be retried until the global timeout and their complete diagnostic bodies can be buffered.

- Observation: runner success can be published before output finalization.
  Evidence: `$GITHUB_OUTPUT` can be mutated before archive sync and close, and an early return can bypass a finalization failure.

- Observation: restart attachment can fabricate a missing output file.
  Evidence: missing persisted output can become a clean empty replay rather than an integrity failure.

- Observation: clean EOF can be published before the writable output handle is finalized.
  Evidence: the prototype retains writable descriptors and allows terminal visibility before writer finalization.

- Observation: presentation precedes authoritative persistence.
  Evidence: process stdout is written before `OutputStore.append()`, and mirror backpressure is ignored.

- Observation: creation rollback is not ownership-safe or exhaustive.
  Evidence: cleanup failures are suppressed and request mappings can be removed without comparing the expected job ID.

- Observation: active-job restart correctness cannot be recovered from physical file size.
  Evidence: a process can terminate after extending the physical file but before atomically advancing the checkpoint.

- Observation: local sink failures can enter reconnect handling.
  Evidence: replay can duplicate a chunk whose archive or presentation side effect already occurred.

- Observation: `AGENT_RELAY_POLL_INTERVAL_MS` is not honored above one second.
  Evidence: reconnect sleep uses `Math.min(pollIntervalMs, 1000)`.

- Observation: resolving review discussions is not implementation evidence.
  Evidence: all nine requirements are maintained here and their discussions are resolved, but the corresponding code repairs and tests remain unchecked in `Progress`.

## Decision Log

- Decision: implement live raw stdout and stderr streaming through Relay, the runner, and a terminal archive.
  Rationale: operators need live visibility and an exact terminal record.
  Date/Author: 2026-07-13 / original plan.

- Decision: current `main` after PR #9 is the mandatory runtime and security baseline.
  Rationale: raw streaming is additive observability and does not justify restoring removed control, credential, result-artifact, or execution mechanisms.
  Date/Author: 2026-07-15 / PR review.

- Decision: preserve `.agent/PLANS.md` byte-for-byte from the OpenAI article and preserve the exact article `# ExecPlans` section in `AGENTS.md`.
  Rationale: these files define the requested ExecPlan setup and were incorrectly described as legacy in an earlier revision.
  Date/Author: 2026-07-15 / user correction.

- Decision: `AGENTS.md` and both workflow files are human-maintained for this correction; Codex must not edit them.
  Rationale: the user explicitly assigned the article instruction fix and workflow changes to the human reviewer.
  Date/Author: 2026-07-15 / user instruction.

- Decision: the selected active plan is the sole task authority for Codex.
  Rationale: PR comments, completed plans, review arrays, and duplicated prompt prose must not become competing instructions.
  Date/Author: 2026-07-15 / user requirement and PR review.

- Decision: preserve and repair the restored implementation rather than converting the pull request into a plan-only change.
  Rationale: every repository change must be described in the active plan; that does not mean implementation should be removed.
  Date/Author: 2026-07-15 / user correction.

- Decision: restart safety covers Relay process termination and restart, not host power loss.
  Rationale: this permits complete writes plus atomic checkpoint replacement for appends without requiring `fsync` on every chunk; clean terminal publication still requires final sync and close.
  Date/Author: 2026-07-15 / scope correction.

- Decision: the persistent checkpoint does not require a generation counter.
  Rationale: serialized append ownership and atomic checkpoint replacement make `committedLength` and terminal facts sufficient for process-restart recovery; in-memory versions may still coordinate waiters.
  Date/Author: 2026-07-15 / scope correction.

- Decision: replay uses short-lived read-only handles rather than persistent reference-counted file handles.
  Rationale: this is simpler, prevents unbounded descriptor retention, and makes terminal state eviction deterministic.
  Date/Author: 2026-07-15 / scope correction.

- Decision: authoritative persistence precedes every presentation sink.
  Rationale: presentation cannot reorder, invent, or invalidate authoritative bytes.
  Date/Author: 2026-07-15 / PR review.

- Decision: redirects and explicit HTTP or protocol failures are fatal and non-retryable; local sink failures never reconnect.
  Rationale: reconnect applies only to transient remote acquisition or body failures, and local side effects may already have occurred.
  Date/Author: 2026-07-15 / PR review.

- Decision: the final archive path denotes only an atomically published complete terminal stream.
  Rationale: incomplete transport or local finalization must leave no final artifact.
  Date/Author: 2026-07-15 / PR review.

- Decision: post-commit SHA checks, GitHub status checks, mergeability, and final remote review are not Codex tasks in this ExecPlan.
  Rationale: Codex operates before the runner creates and pushes the commit and has neither the final SHA nor publication credentials.
  Date/Author: 2026-07-15 / user correction.

## Outcomes & Retrospective

This plan remains active and the implementation is not complete.

The prototype history, original and additional findings, review-thread migration, branch-restoration correction, and plan-format corrections remain preserved. The task list now distinguishes human-owned instruction and workflow work from Codex-owned implementation work, covers the complete current-main reconciliation rather than only the visible PR diff, and removes impossible post-commit gates from Codex scope.

The current branch still contains an unaccepted prototype built partly against obsolete runtime contracts. Human-maintained instruction and workflow corrections, current-main reconciliation, runtime isolation, durable process-restart persistence, bounded resources, endpoint correctness, runner retry and archive behavior, finalizer preservation, deterministic tests, and final working-tree validation remain incomplete.

## Context and Orientation

Agent Relay runs a Codex child process for a selected repository workspace. `src/execution/codex-executor.ts` launches the child and receives stdout and stderr callbacks. A presentation sink is any non-authoritative copy of output, such as Relay process stdout or GitHub logs.

`src/persistence/output-store.ts` owns authoritative output bytes and live replay state. A committed byte is a byte that has been completely written and included in an atomically replaced checkpoint. The checkpoint is a private, versioned per-job metadata file recording `jobId`, `committedLength`, and terminal output facts. Physical output-file size alone is not authoritative. Final clean publication additionally requires syncing and closing the writer.

`src/application/job-service.ts` owns job creation, one-active-job admission, execution, terminal persistence, restart handling, and rollback. `src/persistence/job-store.ts` owns job records and the request-ID index. Compare-delete means removing a request-ID mapping only if it still points to the exact job created by the failing attempt.

`src/api/server.ts` exposes authenticated HTTP APIs. The output route is `GET /v1/jobs/{jobId}/output?offset=N`, where `N` is a canonical non-negative safe-integer byte position. A pre-header failure happens before raw response headers are sent and may use the normal JSON error envelope. A post-header failure happens after raw headers are sent and must destroy the transport instead of changing representation to JSON.

`runner/client.mjs` validates the selected active plan, derives the commit subject, submits and polls jobs, consumes the byte stream, prints a bounded live view, writes a complete temporary archive, and updates `$GITHUB_OUTPUT` only after successful common finalization. Confirmed offset is the count of remote bytes whose required local handling has completed successfully.

`runner/finalize.sh` remains independent from streaming. It decides whether the worktree has changes, validates and creates the commit, injects publication credentials only for push, and restores the uncommitted worktree if push fails.

`AGENTS.md`, `.agent/PLANS.md`, `.github/workflows/agent-relay.yml`, and `examples/github-actions/agent-relay.yml` are human-maintained in this correction. Codex may read them but must not edit them.

## Plan of Work

The human reviewer first corrects `AGENTS.md` using the exact article `# ExecPlans` section and the current-main engineering rules, preserves `.agent/PLANS.md` unchanged, and updates both workflow files from current `main` with only the required archive environment and upload additions. These changes are recorded in `Progress` before Codex implementation starts.

Codex then reconciles the complete branch snapshot with then-current `main`. It must consider files changed only on `main`, not only the visible PR diff. The current-main result-free contract, workspace and active-plan validation, fixed launcher, process users, minimal environment, credential boundaries, finalizer, packaging, documentation, and tests are authoritative. Only raw-output persistence, streaming endpoint, runner consumption, archive production, configuration, documentation, and tests are additive.

Persistence is rebuilt around a versioned checkpoint authoritative for committed length and terminal output facts. Appends are serialized; process-restart recovery exposes only the checkpoint prefix; file-size suffixes are never inferred as committed; replay uses short-lived readers; terminal and attachment state is bounded; output-limit exhaustion kills the child and publishes an explicit error; and job creation compensation remains exhaustive and ownership-safe.

The executor feeds a byte-accounted FIFO, persists before presentation, obeys high and low watermarks, handles every child and presentation stream terminal state, and does not return until output persistence and writer finalization are complete.

The endpoint validates the request and first readable state before raw headers, returns exact offset acknowledgements and committed-length diagnostics, streams only authoritative bytes, and destroys the transport after any post-header error while releasing every reader and waiter.

The runner is rebuilt on current `main`. It performs all fatal preflight, signal setup, redirect policy, and temporary-archive preparation before POST; separates retryable remote failures from fatal protocol and local failures; advances offsets only after complete local handling; neutralizes workflow commands without changing bytes; publishes the final archive atomically; and completes cleanup before `$GITHUB_OUTPUT`.

The finalizer remains a separate current-main component. Documentation, configuration, packaging, and static assertions are reconciled after runtime behavior stabilizes. Tests begin from every current-main test and add deterministic failure-boundary and local full-flow scenarios. Codex finishes by running focused validation, `npm run check`, and `git diff --check` on the working tree and recording the evidence here.

## Concrete Steps

Run all commands from the repository root. Do not run commands that create, rewrite, or publish commits. Do not run container-runtime commands. Do not edit `AGENTS.md`, `.agent/PLANS.md`, `.github/workflows/agent-relay.yml`, or `examples/github-actions/agent-relay.yml`.

Record the current reconciliation base and inspect the complete divergence:

    git rev-parse origin/main
    git diff --name-status origin/main...HEAD
    git diff --name-status HEAD...origin/main

Expected result: the first command prints a 40-character SHA. The two diffs expose both PR-side changes and files changed only on current `main`; use both lists when reconciling.

Inspect the current-main runtime contracts before editing:

    git show origin/main:src/contracts/job.ts
    git show origin/main:src/contracts/validators.ts
    git show origin/main:src/execution/prompt.ts
    git show origin/main:src/security/workspace.ts
    git show origin/main:src/execution/codex-executor.ts
    git show origin/main:src/application/job-service.ts
    git show origin/main:src/persistence/job-store.ts
    git show origin/main:src/api/server.ts
    git show origin/main:runner/client.mjs
    git show origin/main:runner/finalize.sh
    git show origin/main:scripts/codex-run
    git show origin/main:Dockerfile
    git show origin/main:compose.yml

Expected result: every command exits 0. Preserve the current-main behavior described above and add streaming without restoring obsolete contracts.

During implementation, compile and run the affected current-main and new tests. At minimum include:

    npm ci
    npm run typecheck
    npm run build
    node --test --experimental-test-coverage dist/test/context-boundary.test.js
    node --test --experimental-test-coverage dist/test/contracts.test.js
    node --test --experimental-test-coverage dist/test/job-service.test.js
    node --test --experimental-test-coverage dist/test/job-store.test.js
    node --test --experimental-test-coverage dist/test/executor.integration.test.js
    node --test --experimental-test-coverage dist/test/integration.test.js
    node --test --experimental-test-coverage dist/test/log-stream.integration.test.js
    node --test --experimental-test-coverage dist/test/runner-client.test.js
    node --test --experimental-test-coverage dist/test/runner-finalize.test.js
    node --test --experimental-test-coverage dist/test/runner-preflight.test.js
    node --test --experimental-test-coverage dist/test/flow.integration.test.js
    node --test --experimental-test-coverage dist/test/runtime-scripts.integration.test.js
    node --test --experimental-test-coverage dist/test/packaging.test.js

Expected result: every command exits 0 and each Node test command reports zero failed tests. Record exact counts and coverage in `Artifacts and Notes`. A failing command leaves the corresponding `Progress` item unchecked and records the failure evidence.

Run complete working-tree validation:

    npm run check
    git diff --check

Expected result: `npm run check` exits 0 with zero failed tests, and `git diff --check` exits 0 without output.

Verify obsolete contracts did not return and required boundaries remain:

    ! git grep -n 'danger-full-access'
    ! git grep -n 'shouldCommit\|reviewFindings\|resultPath' -- src runner test .github examples compose.yml README.md docs/operations
    ! git grep -n '\.agent-relay/result\.json' -- src runner test .github examples compose.yml README.md docs/operations
    ! git grep -n 'AGENT_RELAY_MODE' -- src runner test .github examples compose.yml README.md docs/operations
    ! git grep -n 'HOST_CODEX_DIR' -- .env.example compose.yml README.md docs/operations
    ! git grep -n 'AGENT_RELAY_TOKEN: \${AGENT_RELAY_TOKEN}' -- compose.yml
    grep -F 'HOST_CODEX_AUTH_FILE' .env.example compose.yml README.md docs/operations/README.md
    grep -F '/home/agent/.codex/auth.json:ro' compose.yml
    grep -F '/usr/local/bin/codex-run' src/server.ts
    grep -F 'Follow .agent/PLANS.md and execute the active ExecPlan' src/execution/prompt.ts

Expected result: every negated search succeeds because it finds no obsolete contract; every positive search prints the approved declaration.

Verify output protocol and persistence declarations:

    git grep -n 'application/octet-stream' -- src runner test README.md docs/operations
    git grep -n 'X-Agent-Relay-Output-Offset' -- src runner test README.md docs/operations
    git grep -n 'X-Agent-Relay-Committed-Length' -- src runner test README.md docs/operations
    git grep -n 'no-transform' -- src test
    git grep -n 'nosniff' -- src test
    git grep -n 'committedLength' -- src test
    git grep -n 'MAX_OUTPUT_BYTES' -- .env.example compose.yml src test README.md docs/operations

Expected result: every search prints implementation, test, and documentation references consistent with the final behavior.

After each stopping point, update `Progress`, the relevant discovery or decision entry, `Outcomes & Retrospective`, and the validation evidence log. If work is blocked, leave its item unchecked and record the cause, impact, evidence, and exact unblock condition without creating a model-controlled job status.

## Validation and Acceptance

Acceptance is based on observable behavior and deterministic working-tree evidence, not on the existence of code, resolved review comments, a future commit SHA, GitHub checks, or remote mergeability.

A local full-flow success test starts Relay with temporary state, starts the runner against it, and launches a fake Codex child. The child emits binary stdout before exit, then stderr and more stdout. The runner observes bytes while the child is still running. One accepted-body disconnect occurs, after which the runner reconnects from the acknowledged confirmed offset. Relay replay and the final archive are byte-identical to the original callback-order sequence, with no gap or duplicate. The final archive path does not exist until terminal EOF, sync, close, and atomic rename succeed.

A restart-recovery test terminates Relay after a physical write extends beyond the last checkpoint. On restart, Relay exposes only the checkpoint prefix, removes the uncommitted suffix only under interrupted recovery ownership, reports interrupted or error terminal state rather than clean success, and does not fabricate missing historical data.

A local-sink failure test fails a required local presentation operation after a chunk reaches the temporary archive but before confirmed-offset advancement. The runner fails without reconnecting, removes the temporary archive, leaves the final archive absent, does not duplicate the chunk, and does not modify `$GITHUB_OUTPUT`.

Persistence tests demonstrate serialized callback order, complete-write and checkpoint ordering, process-restart recovery, output-limit child termination, first-terminal-wins behavior, writer closure before EOF, missing-data integrity errors, single-flight attachment, file permissions, bounded descriptors and state, startup isolation, and complete rollback diagnostics.

Endpoint tests demonstrate normal bounded JSON errors before raw headers, `416` with committed length for an offset above the durable boundary, exact offset acknowledgement on every successful response, complete reads up to the committed boundary, no compression, cache and nosniff headers, transport destruction after every post-header failure, and resource release on completion, error, and client abort.

Runner tests demonstrate current-main preflight and JSON controls, fatal redirects and protocol responses, bounded diagnostics, reconnect only for transient remote failures while nonterminal, no reconnect after any local failure, exact configured polling cadence, complete stream terminal-state handling, bounded retained presentation memory, inert workflow-command-looking output, signal cleanup, atomic archive publication, failed-job diagnostic archive behavior, and finalization before `$GITHUB_OUTPUT`.

Current-main contract tests and static packaging assertions demonstrate the approved request, status, prompt, credential, filesystem, launcher, public DTO, workflow, and finalizer boundaries. No image build, container run, Compose execution, live mount inspection, or container health check is an acceptance requirement.

The Codex implementation is complete when every Codex-owned unchecked `Progress` item is checked with working-tree evidence and both `npm run check` and `git diff --check` pass. Human-maintained instruction and workflow items must already be checked before Codex begins. No post-commit or GitHub-state gate belongs to this plan.

## Idempotence and Recovery

Tests use temporary repositories, state directories, output files, checkpoints, archive paths, local HTTP servers, and local child processes. Repeated test runs must not change operator state.

Job request retries preserve current-main idempotency: a matching request ID returns the existing job. A failed creation attempt deletes only resources it owns and reports incomplete compensation instead of suppressing it.

The checkpoint advances monotonically by replacement. Interrupted recovery may remove only bytes beyond `committedLength` for the interrupted active job under exclusive ownership. Historical terminal replay never creates, repairs, or silently modifies persisted output.

The runner removes only the stale final archive and temporary sibling owned by the current workflow attempt. Repeated startup is safe. A failed push remains the existing finalizer's responsibility; streaming code does not duplicate or bypass that recovery path.

## Artifacts and Notes

The nine resolved review requirements remain represented by unchecked `Progress` items until implementation evidence exists: runner-owned Git flow, atomic archive publication, fatal explicit HTTP and protocol responses, finalization before `$GITHUB_OUTPUT`, no fabricated terminal output, serialized writer finalization, post-header transport destruction, persistence before presentation, and ownership-safe exhaustive rollback.

Keep the validation evidence below append-only:

- 2026-07-15 - Review of restored implementation - identified nine original and seven additional defects; no implementation test was claimed as passing.
- 2026-07-15 - GitHub review threads - all nine migrated threads resolved; implementation items remained unchecked.
- 2026-07-15 - Head `d6b706fc0da51c6b151e55eb62de141a74bf2e92` - zero associated workflow runs and zero combined status contexts at that time.
- 2026-07-15 - Plan-only revisions - no code tests run because only the active plan changed.
- 2026-07-15 - Revision `973ee1ff56f3d45be9526325d9b8056e2cc62b8c` - history and status were improved, but formal comparison later found checklists outside `Progress`, bureaucratic milestones, and no final revision note.
- 2026-07-15 - Revision `21587cf36f2c82c678e9e1d7c2a41f418e74367b` - structure was corrected, but `.agent/PLANS.md` was wrongly classified as legacy, current-main reconciliation was under-specified, and post-commit GitHub gates were incorrectly assigned to Codex.
- 2026-07-15 21:06Z - This revision - compared PR #3 with current `main` and the OpenAI article, preserved `.agent/PLANS.md`, separated human-owned instruction and workflow changes, expanded Codex implementation tasks, selected process-restart durability without per-append `fsync`, and removed post-commit gates. No implementation test was claimed.

Append future evidence in this form:

    YYYY-MM-DD HH:MMZ - <command or test> - <working-tree revision or base SHA> - exit <code> - <exact result>

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

The private checkpoint is equivalent to:

    interface OutputCheckpoint {
      schemaVersion: 1;
      jobId: string;
      committedLength: number;
      terminal?:
        | { kind: "clean"; status: JobStatus }
        | { kind: "error"; code: string };
    }

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

Names may differ, but checkpoint ordering, terminal agreement, bounded resource release, and error behavior may not.

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

Revision note (2026-07-15 21:06Z): Re-reviewed the active plan against PR #3, current `main`, and the OpenAI ExecPlan article. Corrected the false requirement to replace `.agent/PLANS.md`, assigned `AGENTS.md` and workflow changes to the human reviewer, expanded full-branch reconciliation and all missing runtime, persistence, endpoint, runner, finalizer, and current-main test requirements, removed unnecessary persistent generation and per-append sync requirements, chose short-lived replay handles, and removed post-commit SHA, GitHub checks, mergeability, and remote review from Codex scope.