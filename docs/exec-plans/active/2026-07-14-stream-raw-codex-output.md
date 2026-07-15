# Add restart-safe raw Codex output streaming without regressing isolation

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current as work proceeds. Maintain this document in accordance with `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

The mandatory runtime baseline is `main` commit `f043af2fa9eb0420a0d64684485700f92a5dc425`. The reviewed implementation snapshot before the implementation-readiness revisions is `215c032905ad4fe962125b7fdc822ee4a4a7c56a`. Codex must verify that the pinned commit exists and is an ancestor of `HEAD`. If `refs/remotes/origin/main` exists and resolves to a different commit, Codex must add a `[blocked]` Progress entry describing the new SHA and stop before editing implementation files. Absence of the remote-tracking ref is not a blocker when the pinned commit exists in the checkout. Codex must not silently expand the task to a newer baseline.

Codex may use read-only Git commands such as `status`, `diff`, `show`, `grep`, `rev-parse`, `show-ref`, `cat-file`, and `merge-base`. It must not run `git add`, `commit`, `merge`, `rebase`, `reset`, `restore`, `checkout`, `cherry-pick`, `push`, or another command that mutates Git history, the index, or tracked files outside the edits required by this plan. The generic `commit frequently` sentence in `.agent/PLANS.md` does not authorize Git mutations in this repository; record stopping points frequently in `Progress` instead. The GitHub runner owns commit and push.

Codex must not edit `AGENTS.md`, `.agent/PLANS.md`, any file under `.github/workflows/`, or any file under `examples/github-actions/`. Those instruction and workflow files are human-maintained. Codex must preserve their contents exactly as they exist in reviewed snapshot `215c032905ad4fe962125b7fdc822ee4a4a7c56a`.

## Purpose / Big Picture

After this work, an operator can watch every Codex stdout and stderr chunk without decoding, redaction, truncation, or mutation while a job is running, reconnect from an acknowledged byte position after a transient output-transport interruption, and receive a byte-identical terminal archive only after Relay has finalized the complete output stream.

Relay stores the authoritative combined stream in the callback order in which Node delivers stdout and stderr data events. The authoritative output, output endpoint, and runner archive are exactly the child bytes, including invalid UTF-8 and secret-looking sequences. Runner stdout surrounds the raw child chunks with unpredictable GitHub `stop-commands` and resume guard lines, but each child chunk inside that presentation envelope is written byte-for-byte and guard bytes never enter the archive or remote offset. This output is intentionally sensitive.

Relay-side service stdout is only a best-effort presentation copy. After authoritative persistence, Relay attempts to mirror the chunk once; if stdout is unavailable, returns backpressure, emits an error, or closes, Relay permanently disables that mirror for the job without delaying, failing, or reordering authoritative output. Runner archive and guarded runner stdout are required local sinks; their failure fails the workflow.

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
- [x] (2026-07-16, second readiness pass) Verified the revised plan against the checkout workflow and implementation contracts. Removed reliance on a mandatory `origin/main` ref, fixed queue thresholds, made prepare transactional rather than falsely cross-file atomic, specified terminal job mappings and final output confirmation, defined the workflow-command presentation envelope, tightened archive-path validation, and prohibited deletion or weakening of the 86-test baseline.
- [x] (2026-07-16, third readiness pass) Closed crash-window and storage-edge ambiguities: defined legal physical suffixes for terminal error checkpoints, idempotent recovery of interrupted records whose output error was not yet published, in-memory failure behavior when terminal checkpoint persistence fails, synchronous chunk ownership and accounting, and separate header-acquisition and body-idle timers.

- [ ] Verify the pinned baseline and protected-file hashes before editing. Record the command output in `Artifacts and Notes`. If the baseline or a protected file differs, add a `[blocked]` entry and stop.
- [ ] Remove the executor's dual legacy output path. `CodexExecutor` must always use the prepared `OutputStore` writer for production execution; it must not create or append the output file itself, truncate output, add a marker, decode bytes, or import or call `StreamingRedactor`. Keep the standalone redaction utility and its independent unit tests unchanged, but add tests proving secret-looking and invalid UTF-8 bytes pass unchanged through executor, endpoint, and archive.
- [ ] Implement the versioned per-job checkpoint and private file layout described in `Interfaces and Dependencies`. `prepare` must transactionally create the exclusive empty output and initial checkpoint: after success both exist; after any failure it closes and removes every resource created by that attempt. No cross-file atomicity is claimed. Physical file size must never become the committed boundary.
- [ ] Serialize every append inside `OutputStore`. The child data callback must synchronously copy the delivered chunk, reserve its accepted-byte count, and enqueue it before returning. Write each accepted chunk completely, atomically replace the checkpoint before exposing the new `committedLength`, enforce first-terminal-wins, and finalize the writer by sealing appends, draining pending writes, syncing, attempting close on every path, and clearing writer ownership before any terminal checkpoint is published.
- [ ] Enforce `MAX_OUTPUT_BYTES` over total accepted bytes before accepting a child chunk. Use `highWatermark = min(MAX_OUTPUT_BYTES, 1048576)` and `lowWatermark = floor(highWatermark / 2)`. The pending count includes the chunk currently writing and all queued chunks. Pause both child streams when pending bytes are at least the high watermark, resume only when pending bytes are at most the low watermark, reject the entire chunk that would exceed the hard limit, terminate the child, and reject or discard every later queued chunk after the first persistence or limit failure. Memory above the high watermark is bounded by child chunks already delivered before both streams were paused.
- [ ] Implement restart recovery and bounded replay state. Recover accepted or running jobs from the checkpoint, truncate only an uncommitted suffix under exclusive interrupted-recovery ownership, save the job as `interrupted` with `errorCode: OUTPUT_INTERRUPTED`, then publish `OUTPUT_INTERRUPTED` rather than clean EOF. Recovery must be idempotent: an `interrupted` job with a valid nonterminal checkpoint is a crash between job save and error publication, so validate that physical size equals `committedLength` and publish `OUTPUT_INTERRUPTED` without changing bytes. If an active or interrupted job's output is corrupt, save or retain it as interrupted with `OUTPUT_INTEGRITY_FAILED`, do not modify historical bytes, and continue service startup. Use short-lived read-only handles, make attachment single-flight, release every reader and waiter, and evict terminal state when no lease remains.
- [ ] Implement the exact job and output terminal state machine. The executor must return process outcome only after child close, both streams end, the append queue drains, and the writer is finalized. JobService must save the terminal job record before publishing the matching terminal checkpoint. Map zero exit to `completed`; non-zero exit to `failed` with `CODEX_FAILED` and the actual exit code; timeout to `timed_out` with `CODEX_TIMEOUT` and any available exit code; spawn failure to `failed` with `CODEX_FAILED`; and output infrastructure failure to `failed` with the output error code. Zero, non-zero, timeout, and spawn failure may publish clean output when writer finalization succeeded. Interrupted, output-limit, write, integrity, and terminal-state failures publish an output error and never clean EOF. If terminal job persistence fails, set the live snapshot to `OUTPUT_TERMINAL_STATE_FAILED`, reject waiters, and attempt to persist that error checkpoint. If clean checkpoint publication fails after the job record is terminal, set the same live error and attempt its error checkpoint; never expose clean EOF. On later restart, a terminal job with a nonterminal checkpoint is `OUTPUT_TERMINAL_STATE_FAILED`, not clean output.
- [ ] Complete the internal output error taxonomy and public filtering. Add exact codes for offset range, integrity, interruption, and terminal-state persistence or disagreement. Keep private paths, checkpoint data, and raw internal messages out of create and poll DTOs and bounded pre-header JSON errors.
- [ ] Implement the authenticated output endpoint state machine. Validate authentication, job ID, canonical offset, checkpoint, lease, and the first required read or terminal snapshot before raw headers. Implement exact offset acknowledgement, `416` committed-length acknowledgement, raw identity transfer, active following, strict short-read detection, backpressure, pre-header JSON errors, post-header destruction for every error, and unconditional lease and waiter release. For terminal output error at an offset below `committedLength`, stream the committed prefix and destroy the transport at the boundary; at the boundary return the fixed JSON error before raw headers. Never read or expose a physical suffix beyond `committedLength`.
- [ ] Make `AGENT_RELAY_OUTPUT_ARCHIVE_PATH` mandatory for `runner/client.mjs`. Require an absolute path whose existing real parent directory resolves outside `GITHUB_WORKSPACE`; reject a path equal to `GITHUB_OUTPUT`. Complete all preflight before POST: bounded settings, active-plan validation, plan-derived subject, redirect policy, signal handlers, stale final removal, exclusive same-directory `0600` temporary archive, and workflow-command guard state.
- [ ] Implement the runner's output/status state machine. Persist each complete chunk to the temporary archive, then write the unchanged chunk through guarded stdout, then advance the confirmed offset. Use a dedicated acquisition AbortController whose timer is cleared as soon as response headers arrive. Use a separate body-idle timer of `AGENT_RELAY_REQUEST_TIMEOUT_MS`, reset after every body chunk, and use `AGENT_RELAY_POLL_TIMEOUT_MS` as the global deadline. Retry only transient output acquisition, idle, body, or premature-EOF failures from the confirmed offset, sleeping the configured poll interval up to the remaining deadline. Continue retry after terminal job status until a confirmation request started while the job is known terminal returns zero bytes and clean EOF at the confirmed offset. Explicit HTTP or protocol responses and every JSON polling, local sink, signal, or finalization failure are fatal and never reconnect.
- [ ] Guard GitHub command parsing without changing authoritative bytes. Immediately before the first raw stdout chunk, write `::stop-commands::<random-token>\n`; after clean completion or on every failure and signal path, write `\n::<random-token>::\n` when stdout remains usable. Guard lines are presentation-only and never affect archive bytes or confirmed offset. Retain no historical output in memory beyond owned queued chunks and bounded diagnostic bodies.
- [ ] Publish a final archive only after terminal confirmation, file sync, successful close, and atomic rename. Preserve the complete archive for `failed` and `timed_out` jobs when their output is clean, but still fail the workflow for the job status. Any output error or incomplete local handling removes only attempt-owned temporary state, leaves the final path absent, and leaves `$GITHUB_OUTPUT` unchanged.
- [ ] Update `README.md`, `docs/operations/README.md`, and `docs/operations/live-codex-logs.md` to describe the final sensitive raw-output contract, presentation guard envelope, offset protocol, retry and confirmation behavior, archive lifecycle, failure behavior, limits, and operator handling. Do not edit workflow, packaging, launcher, finalizer, credential, prompt, or public request files unless this plan is first revised with a concrete blocker and the user resolves it.
- [ ] Preserve the complete 86-test baseline. Do not delete, skip, mark todo, weaken, or replace a baseline test except when an assertion directly conflicts with the intentional raw-output or mandatory-archive contract; in that case replace it with an equal or stronger test and record the replacement. Add deterministic tests for checkpoint creation and replacement, partial and zero-progress writes, append ordering, watermarks, hard limit, finalization, first-terminal-wins, recovery crash windows, legal and illegal physical suffixes, corruption isolation, file modes, single-flight attachment, state eviction, compensation, terminal ordering, raw bytes, endpoint protocol, runner reconnect after active and terminal status, terminal confirmation, separated acquisition and idle timers, workflow-command isolation, signals, archive finalization, and local failure without reconnect.
- [ ] Add local full-flow tests for successful binary live output with one transient reconnect and a byte-identical archive; Relay restart after an uncommitted physical suffix; restart after interrupted job persistence but before output-error publication; clean diagnostic archive for a failed process; output-error final archive absence; and local sink failure after an archive side effect with no reconnect, duplicate, final archive, or `$GITHUB_OUTPUT` mutation.
- [ ] Run all focused tests, `npm run check`, and `git diff --check` on the final working tree. The final test count must be at least 86 with zero skipped, todo, cancelled, or failed tests. Record commands, exact counts, coverage, failures, baseline-test replacements, and protected-file verification in `Artifacts and Notes`. Update `Outcomes & Retrospective` and append a final revision note before considering implementation complete.

## Surprises & Discoveries

- Observation: `.agent/PLANS.md` in PR #3 is the intended article document, not legacy content.
  Evidence: its blob `15d9583b1df0663488d55e4fdfea1c6154ba85d1` is byte-for-byte identical to the `PLANS.md` body published in the OpenAI article and must remain unchanged.

- Observation: the current branch is already merged with the pinned `main` baseline and has a green test baseline.
  Evidence: comparison with `main` reports `behind_by: 0`; CI run `29455214780` passed 86 tests on head `215c032905ad4fe962125b7fdc822ee4a4a7c56a`.

- Observation: the workflow checkout has complete history but a remote-tracking `origin/main` ref is not a safe invariant.
  Evidence: `.github/workflows/agent-relay.yml` checks out the resolved head SHA with `fetch-depth: 0`; the pinned baseline is already an ancestor of the branch and can be verified directly by commit SHA.

- Observation: a green baseline does not implement the plan's durability and failure semantics.
  Evidence: `src/persistence/output-store.ts` has no checkpoint, derives committed length from file size during attach, creates a missing terminal output file, keeps one read-write handle for replay, and publishes terminal state without writer sync or close.

- Observation: the executor still contains two incompatible output contracts.
  Evidence: the `OutputStore` path preserves raw bytes, while the fallback path imports `StreamingRedactor`, appends its own output file, truncates, and inserts `[OUTPUT TRUNCATED]`. Production raw output must have one path.

- Observation: `runner/client.mjs` currently performs only one output request.
  Evidence: it has no confirmed-offset reconnect loop, no idle timer, no signal cleanup, no terminal confirmation, and no workflow-command suppression. Its archive path is optional even though the workflow feature requires a terminal archive.

- Observation: retry eligibility cannot depend only on an active job status.
  Evidence: a transient connection can fail after the child and job become terminal but before the runner has received all committed bytes or clean EOF. The runner must continue transient output recovery after terminal status until output completion is confirmed.

- Observation: a graceful body EOF after terminal status is not sufficient by itself to prove that an earlier connection delivered every byte.
  Evidence: the runner needs a final request from the confirmed offset while the job is already known terminal; only a zero-byte clean response establishes terminal output completion.

- Observation: physical bytes beyond `committedLength` have state-dependent meaning.
  Evidence: an active crash suffix is uncommitted and may be truncated during exclusive recovery; a clean terminal checkpoint requires exact file length; a terminal error checkpoint may legitimately retain an ignored physical suffix from a failed write or checkpoint update and historical replay must not expose or modify it.

- Observation: recovery has a crash window after the interrupted job record is saved.
  Evidence: restart can occur before `OUTPUT_INTERRUPTED` is published. A later startup must recognize the valid interrupted record plus nonterminal checkpoint and finish error publication idempotently.

- Observation: workflow-command safety requires a presentation envelope.
  Evidence: child chunks remain exact inside stdout, but unpredictable stop and resume guard lines must surround them. Archive bytes and remote offsets exclude those guard lines.

- Observation: output terminal state and job terminal state are related but not identical.
  Evidence: a non-zero, timed-out, or spawn-failed process can have a complete clean diagnostic stream; an interrupted or output-infrastructure failure cannot publish clean EOF even when the job record is terminal.

- Observation: workflow files cannot be delegated to Codex.
  Evidence: the user assigned workflow maintenance to the human reviewer. The protected scope covers every file under `.github/workflows/` and `examples/github-actions/`, not only the two files currently changed by the PR.

- Observation: `.agent/PLANS.md` contains generic Git advice that conflicts with repository ownership.
  Evidence: this active plan explicitly overrides `commit frequently` for this task; stopping points are recorded in `Progress`, while the runner remains the sole Git mutation owner.

## Decision Log

- Decision: pin the runtime baseline to `f043af2fa9eb0420a0d64684485700f92a5dc425` and verify it directly by commit identity and ancestry.
  Rationale: silently following a newer `origin/main` could change scope after review, while requiring a remote-tracking ref could block a valid detached checkout.
  Date/Author: 2026-07-16 / implementation-readiness review.

- Decision: preserve `.agent/PLANS.md`, `AGENTS.md`, all GitHub workflow files, and all example workflow files exactly as reviewed.
  Rationale: instruction and workflow ownership was explicitly assigned to the human reviewer.
  Date/Author: 2026-07-16 / user instruction.

- Decision: Codex records frequent stopping points but performs no Git mutations.
  Rationale: the runner owns commit and push, and the specific repository rule overrides the generic article sentence.
  Date/Author: 2026-07-16 / implementation-readiness review.

- Decision: authoritative output, endpoint output, and runner archive are raw and unredacted; runner stdout contains unchanged raw chunks inside a command-suppression envelope.
  Rationale: byte identity and invalid-UTF-8 support are core requirements, while GitHub command parsing must remain inert. `StreamingRedactor` remains an unrelated utility and is not part of any raw-output path.
  Date/Author: 2026-07-16 / implementation-readiness review.

- Decision: restart safety covers Relay process termination and restart, not host power loss.
  Rationale: complete writes plus same-directory atomic checkpoint replacement are sufficient without per-append `fsync`; clean terminal publication still requires final writer sync and close.
  Date/Author: 2026-07-15 / scope decision.

- Decision: `prepare` is transactional through exclusive creation and compensation, not atomically committed across two files.
  Rationale: a filesystem rename cannot atomically create both output and checkpoint, but the method can guarantee that successful return means both exist and failure removes attempt-owned partial resources.
  Date/Author: 2026-07-16 / second readiness pass.

- Decision: the checkpoint is authoritative for committed length and terminal output facts; physical file size is never authoritative.
  Rationale: a process may terminate after extending the file but before advancing the checkpoint.
  Date/Author: 2026-07-15 / persistence review.

- Decision: physical suffix validation depends on checkpoint state.
  Rationale: clean terminal output must have exact physical length; active recovery may truncate an uncommitted suffix; terminal error replay may ignore but never expose or mutate a retained suffix; physical length below `committedLength` is always integrity failure.
  Date/Author: 2026-07-16 / third readiness pass.

- Decision: use a 1 MiB high watermark capped by `MAX_OUTPUT_BYTES` and a low watermark equal to half the high watermark.
  Rationale: this provides a fixed memory bound without introducing another environment setting.
  Date/Author: 2026-07-16 / second readiness pass.

- Decision: chunk ownership, accepted-byte reservation, and queue insertion occur synchronously in the child data callback.
  Rationale: later buffer mutation or asynchronous accounting must not reorder output or permit concurrent callbacks to exceed the hard limit.
  Date/Author: 2026-07-16 / third readiness pass.

- Decision: the executor finalizes the writer, JobService saves the terminal job record, and only then may JobService publish the matching clean or error terminal checkpoint.
  Rationale: clean EOF must never become visible while the durable job record is still active or contradictory.
  Date/Author: 2026-07-16 / implementation-readiness review.

- Decision: a terminal-checkpoint persistence failure immediately becomes a live `OUTPUT_TERMINAL_STATE_FAILED` even when its error checkpoint also cannot be persisted.
  Rationale: waiters must never observe clean EOF; after restart, the durable job and nonterminal checkpoint mismatch deterministically produces the same error.
  Date/Author: 2026-07-16 / third readiness pass.

- Decision: clean output terminal states are permitted only for job statuses `completed`, `failed`, and `timed_out`.
  Rationale: failed and timed-out processes can produce complete diagnostics; an interrupted process cannot prove complete output and must terminate with `OUTPUT_INTERRUPTED`.
  Date/Author: 2026-07-16 / implementation-readiness review.

- Decision: Relay-side process stdout is attempted once after persistence and permanently disabled for that job on backpressure, error, close, or unavailable state; runner archive and guarded runner stdout are required local sinks.
  Rationale: Relay logging slowness must not stall or invalidate authoritative output, while runner local failure makes offset acknowledgement unsafe and must prevent reconnect.
  Date/Author: 2026-07-16 / second readiness pass.

- Decision: transient output transport recovery remains allowed after the job status becomes terminal until a terminal confirmation request returns zero bytes and clean EOF at the confirmed offset.
  Rationale: job status does not prove that the runner received all authoritative bytes, and an earlier graceful EOF is not a sufficient final confirmation.
  Date/Author: 2026-07-16 / second readiness pass.

- Decision: response-header acquisition timeout and response-body idle timeout use separate timers and controllers.
  Rationale: one fixed timeout attached to the whole fetch would abort a healthy long-lived output response even while bytes continue arriving.
  Date/Author: 2026-07-16 / third readiness pass.

- Decision: redirects, explicit HTTP errors, protocol mismatches, JSON polling failures, signals, and local sink or finalization failures are fatal and non-retryable.
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

Remaining work is deliberately limited to durable output persistence, executor backpressure and terminal behavior, job/output terminal ordering and recovery, the output endpoint, the runner output and confirmation state machine, documentation, and deterministic tests. Completion requires every unchecked Progress item and all working-tree validation, not merely a green pre-existing CI run.

## Context and Orientation

Agent Relay accepts a job for one repository workspace and launches Codex through the fixed `/usr/local/bin/codex-run` boundary. `src/execution/codex-executor.ts` receives stdout and stderr data events. Their Node callback order defines the combined authoritative stream; no stronger operating-system ordering is claimed.

`src/persistence/output-store.ts` owns output files, checkpoints, writer ownership, append serialization, live snapshots, waiters, replay leases, and terminal output facts. A committed byte is a byte fully written to the output file and included in an atomically replaced checkpoint. The output path remains private in `JobRecord`; the checkpoint path is derived internally and never enters a public DTO.

`src/application/job-service.ts` owns job creation, one-active-job admission, execution, process-derived terminal status, terminal job persistence, restart recovery, and compensation. `src/persistence/job-store.ts` owns job records and the request-ID index. Compare-delete means removing a request mapping only if it still points to the exact job created by the failing attempt.

`src/api/server.ts` exposes authenticated create, poll, and output APIs. A pre-header output failure occurs before octet-stream headers and uses the bounded JSON error envelope. A post-header output failure occurs after octet-stream headers and destroys the transport; it never changes representation to JSON.

`runner/client.mjs` validates local context, derives the commit subject, submits and polls the job, consumes output from a confirmed byte offset, writes the temporary archive, produces a guarded live view, confirms terminal output with a final empty request, and updates `$GITHUB_OUTPUT` only after output and job success. Confirmed offset is the number of remote bytes for which every required local operation completed successfully.

`runner/finalize.sh` remains unchanged. It decides whether the worktree has changes, validates the commit subject, creates the commit, injects publication credentials only for push, and restores the uncommitted worktree if push fails.

The expected Codex-owned implementation files are `src/contracts/errors.ts`, `src/persistence/output-store.ts`, `src/persistence/job-store.ts`, `src/application/job-service.ts`, `src/execution/codex-executor.ts`, `src/api/server.ts`, `src/server.ts`, `runner/client.mjs`, the three operator documents, this active plan, relevant `test/*.ts` files, and a local type shim only when required for Node built-ins. The expected preserved files include `src/contracts/job.ts`, `src/contracts/validators.ts`, `src/execution/prompt.ts`, `src/security/workspace.ts`, `src/security/redaction.ts`, `src/config/config.ts`, `.env.example`, `compose.yml`, both Dockerfiles, `scripts/codex-run`, `runner/finalize.sh`, all workflow files, `AGENTS.md`, and `.agent/PLANS.md`.

## Plan of Work

### Milestone 1: Freeze the reviewed baseline and remove the executor's competing output contract

Verify the pinned commit, optional remote-tracking ref, protected files, current public request, fixed launcher, active-plan validation, credentials, and packaging before changing runtime code. Remove only the executor's redacted/truncating fallback path and make the prepared OutputStore writer the single execution path. Preserve the standalone redaction utility, but prove it is not imported by the executor and does not touch raw bytes.

The milestone is complete when the baseline assertions pass, the executor has one output path, all unaffected baseline tests still pass, and new executor tests preserve invalid UTF-8 and secret-looking bytes exactly.

### Milestone 2: Build durable, bounded output persistence and recovery

Replace in-memory file-size authority with the exact checkpoint model below. Implement transactional prepare, synchronous chunk ownership, serialized append, complete writes, checkpoint replacement, hard limit accounting, writer finalization, first-terminal-wins, state-dependent suffix validation, single-flight attachment, short-lived reads, leases, state eviction, interrupted crash-window recovery, and corruption isolation. Extend JobStore only as needed to enumerate and save records during restart recovery while preserving request-index idempotency and compare-delete compensation.

The milestone is complete when deterministic persistence and job-service tests cover every write, checkpoint, suffix, terminal, recovery, cleanup, and compensation boundary without timing-only assertions.

### Milestone 3: Integrate child execution with the job/output terminal state machine

Move byte FIFO and child backpressure into the executor while keeping OutputStore append serialization authoritative. Ensure the executor waits for child close, both stream endings, queue drain, and writer finalization. Return process outcome for zero exit, non-zero exit, and timeout; finalize an empty writer before reporting spawn failure. JobService saves the exact terminal job record first, then publishes the matching output terminal checkpoint. Output-infrastructure failures terminate the child, discard later queued chunks, finalize the writer, save the failed job, and publish an output error. Terminal persistence failures immediately fail live readers even if the error checkpoint cannot be saved.

The milestone is complete when tests demonstrate exact callback order, synchronous byte reservation, fixed watermarks, bounded pending bytes, child termination on limit or persistence failure, disabled Relay mirror on backpressure or failure, diagnostic clean output for non-zero, timeout, and spawn failure, output errors for interrupted and infrastructure failures, and no clean EOF before job persistence.

### Milestone 4: Implement the exact output HTTP protocol

Build the endpoint around an acquired OutputStore lease. Resolve all errors that can be known before headers, perform the first required read before headers, acknowledge the requested offset exactly, stream only committed bytes, follow active output, and release every resource. Return `416` for an offset above the committed boundary. A terminal error with an unread committed prefix may stream that prefix, but reaching the boundary destroys the raw response; a new boundary request receives the fixed JSON error before headers. Physical suffixes beyond the checkpoint are never read.

The milestone is complete when endpoint tests cover authentication, canonical offsets, `416`, initial reads, active following, clean empty EOF, terminal errors before and after headers, ignored error suffixes, short reads, backpressure, aborts, and resource release.

### Milestone 5: Implement the runner reconnect, confirmation, and archive state machine

Make the archive path mandatory and safe before POST. Install signal handling and prepare command-guard state before remote work. Consume raw responses from the confirmed offset, write archive then guarded stdout then advance the offset, and separate transient output transport failures from every fatal response or local failure. Use a cleared header-acquisition timer, a resettable body-idle timer, configured retry sleep, and a global deadline. Continue transient recovery after terminal job status. Establish completion only with a zero-byte clean response to a request started while the job is already known terminal. Publish the archive atomically and only after that confirmation, then update `$GITHUB_OUTPUT` only for a completed job.

The milestone is complete when runner tests cover reconnect while active and terminal, final confirmation, exact offset progression, separated acquisition and idle timeouts, redirects, protocol failures, command guard lines, invalid UTF-8, stdout failure, archive failure, signals, failed-job diagnostic archives, output-error archive absence, and finalization ordering.

### Milestone 6: Complete documentation and whole-tree validation

Update only the three operator documents, add local full-flow tests, run focused tests and the complete repository checks, verify protected files are unchanged, and update the living sections of this plan with exact evidence. Do not move the plan to `completed`; the runner or human reviewer handles repository publication after Codex exits.

The milestone is complete when all unchecked Progress items are checked with evidence, the final test count is at least 86 with no skipped, todo, cancelled, or failed tests, `npm run check` and `git diff --check` pass, protected files match the reviewed snapshot, `Outcomes & Retrospective` reflects the implemented result, and the final revision note records implementation evidence.

## Concrete Steps

Run all commands from the repository root. Do not run container-runtime commands or Git mutation commands.

Verify the immutable baseline before editing:

    git cat-file -e f043af2fa9eb0420a0d64684485700f92a5dc425^{commit}
    git merge-base --is-ancestor f043af2fa9eb0420a0d64684485700f92a5dc425 HEAD
    if git show-ref --verify --quiet refs/remotes/origin/main; then
      test "$(git rev-parse refs/remotes/origin/main)" = "f043af2fa9eb0420a0d64684485700f92a5dc425"
    fi
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
    sed -n '1,320p' src/persistence/output-store.ts
    sed -n '1,320p' src/execution/codex-executor.ts
    sed -n '1,280p' src/application/job-service.ts
    sed -n '1,280p' src/api/server.ts
    sed -n '1,420p' runner/client.mjs

Expected result: the baseline files show the result-free and isolation contracts; the branch files show the incomplete prototype findings documented above.

Implement Milestones 1 through 5 in order. After each milestone, update `Progress`, `Surprises & Discoveries`, `Decision Log` when a decision changes, `Outcomes & Retrospective`, and `Artifacts and Notes`. Do not mark a milestone task complete because code exists; mark it only after its focused tests pass.

Create deterministic focused tests with controlled fake file handles, barriers, local HTTP servers, temporary directories, and fake child processes. Do not rely on arbitrary sleeps to prove ordering or resource release. Expected new focused files are `test/output-store.test.ts`, `test/output-endpoint.integration.test.ts`, and `test/streaming-flow.integration.test.ts`; extending baseline `job-service`, `job-store`, `executor`, `runner-client`, `flow`, `context-boundary`, and packaging tests is also expected.

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

A successful full-flow test starts Relay with temporary state, starts the runner against it, and launches a fake child. The child emits binary stdout, stderr, invalid UTF-8, secret-looking bytes, and a workflow-command-looking line in a controlled callback sequence. Runner stdout contains stop and resume guard lines but preserves each child chunk unchanged inside the envelope. One output-body transport failure occurs while the job is active or after it becomes terminal. The runner reconnects from the exact confirmed offset. After the job is known terminal, a confirmation request from the final offset returns zero bytes and clean EOF. Relay replay and the final archive equal the original callback-order byte sequence with no gap, duplicate, decoding, redaction, marker, or guard byte. The final archive path does not exist before confirmation, sync, close, and atomic rename.

A restart-recovery test writes a physical suffix after the last checkpoint and terminates Relay while the job is active. On restart, Relay validates the checkpoint, truncates only that uncommitted suffix under exclusive recovery ownership, saves the job as interrupted with `OUTPUT_INTERRUPTED`, publishes the matching output error, exposes the committed prefix diagnostically, never publishes clean EOF, and never creates missing historical data. A second restart between saving `interrupted` and publishing the output error finishes publication idempotently. A separate corrupt active or terminal job returns `OUTPUT_INTEGRITY_FAILED` without preventing another job or the service from operating.

A terminal-error suffix test leaves physical bytes beyond `committedLength` after a failed append or checkpoint update, publishes a terminal output error, restarts Relay, and proves that replay exposes only the committed prefix, keeps the suffix untouched, and returns the terminal error at the boundary. A clean terminal checkpoint with physical length different from `committedLength`, or any file shorter than `committedLength`, is an integrity failure.

A terminal-ordering test blocks terminal job persistence after the writer is finalized. No clean EOF is visible while the job remains active. If terminal job persistence fails, live readers immediately receive `OUTPUT_TERMINAL_STATE_FAILED`, even when persisting that error checkpoint also fails. On restart, the terminal/nonterminal mismatch yields the same error. For zero exit, non-zero exit, timeout, and spawn failure with healthy output, the durable job record and exact exit or error fields precede a matching clean output terminal state. Interrupted and output-infrastructure failures never publish clean output.

A local-sink failure test fails guarded runner stdout after a chunk is fully written to the temporary archive but before confirmed-offset advancement. The runner fails without reconnecting, removes the attempt-owned temporary archive, leaves the final archive absent, does not duplicate the chunk, restores workflow-command parsing when possible, and does not modify `$GITHUB_OUTPUT`.

Persistence tests demonstrate transactional initial prepare, synchronous buffer ownership, complete writes, append ordering, checkpoint replacement, hard-limit rejection of the entire overflowing chunk, fixed watermarks, byte-bounded queues, writer finalization, first-terminal-wins, process-restart recovery, state-dependent suffix rules, missing and malformed data errors, single-flight attachment, short-lived readers, file and directory modes, waiter release, state eviction, service-start isolation, and exhaustive ownership-safe compensation.

Endpoint tests demonstrate authentication, canonical offset validation, `416` with `X-Agent-Relay-Committed-Length`, successful `200 application/octet-stream` with exact `X-Agent-Relay-Output-Offset`, `Cache-Control: no-store, no-transform`, `X-Content-Type-Options: nosniff`, absent or identity content encoding, first-read-before-headers, active following, strict short-read detection, clean empty EOF, terminal prefix followed by transport destruction, boundary JSON terminal error, ignored physical suffixes, backpressure, abort handling, and lease release.

Runner tests demonstrate mandatory safe archive preflight, bounded JSON and 8192-byte output diagnostics, redirect rejection, exact protocol validation, separately controlled acquisition and resettable idle timeouts, transient reconnect while active and terminal, final terminal confirmation, no reconnect after explicit or local failure, archive-before-stdout-before-offset ordering, exact poll interval, no historical raw-output retention, workflow-command guard isolation, signal cleanup, failed-job diagnostic archive preservation, output-error archive absence, and `$GITHUB_OUTPUT` mutation only after complete output and a `completed` job.

The implementation is complete when every unchecked Progress item is checked with working-tree evidence, all focused and full-flow tests pass, the total test count is at least 86 with zero skipped, todo, cancelled, or failed tests, `npm run check` and `git diff --check` pass, protected files are unchanged, the operator documentation matches behavior, and the living sections and final revision note are current.

## Idempotence and Recovery

Tests use only temporary repositories, state directories, output files, checkpoints, archive paths, local HTTP servers, and fake child processes. Repeated test runs must not modify operator state.

A matching request ID returns the existing job. A failed creation attempt independently removes only its prepared output, checkpoint, job record, and request mapping. Request-index deletion is compare-delete against the expected job ID. Every failed compensation is attempted and reflected in `JOB_PREPARATION_FAILED` diagnostics without exposing private paths publicly.

The checkpoint advances monotonically by same-directory atomic replacement. Interrupted recovery may remove only bytes beyond `committedLength` for a formerly active job under exclusive recovery ownership. An interrupted job plus valid nonterminal checkpoint completes `OUTPUT_INTERRUPTED` publication idempotently. Historical terminal replay never creates, repairs, truncates, or silently modifies output; a terminal error checkpoint may ignore an existing suffix while exposing only the committed prefix.

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
- 2026-07-16 - First plan readiness revision `598d28f348d05f30eb86ad54ad9d8a09c13c6eb5` - pinned the baseline, protected workflow ownership, resolved raw/redaction and terminal-ordering gaps, narrowed files, and added observable milestones. Only the active plan changed.
- 2026-07-16 - Second plan readiness revision `133fe84a3cf52fcb9075d5379f117349b009990f` - corrected optional remote-ref handling, queue thresholds, transactional prepare wording, exact process mappings, terminal confirmation, guard-envelope semantics, archive path safety, and baseline-test preservation. Only the active plan changed.
- 2026-07-16 - Third plan readiness review - defined physical suffix states, interrupted recovery idempotence, live failure on terminal-checkpoint persistence errors, synchronous chunk ownership, and separated response acquisition and body-idle timers. No production code changed.

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

`committedLength` must be a non-negative safe integer no larger than physical output size. For a nonterminal checkpoint belonging to an active job, a larger physical file is an uncommitted crash suffix and may be truncated only by exclusive interrupted recovery. For a clean terminal checkpoint, physical size must equal `committedLength`. For an error terminal checkpoint, physical size may be greater than `committedLength`; replay ignores the suffix and never truncates it. Physical size below `committedLength` is always `OUTPUT_INTEGRITY_FAILED`.

Checkpoint JSON, output files, and temporary files use mode `0600`. Private directories created by this feature use mode `0700`. Checkpoint replacement uses a unique same-directory temporary file and atomic rename. A persistent generation counter is not required; an in-memory version may coordinate waiters.

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

Names may differ, but ownership, ordering, durability, single-flight attachment, first-terminal-wins, and resource behavior may not. `publishClean` or `publishError` updates the live snapshot only after a successful atomic terminal checkpoint replacement, except that failure to persist any terminal checkpoint must immediately set a non-clean live `OUTPUT_TERMINAL_STATE_FAILED` and reject waiters.

The executor queue uses:

    highWatermark = Math.min(MAX_OUTPUT_BYTES, 1_048_576)
    lowWatermark = Math.floor(highWatermark / 2)

`pendingBytes` includes the currently writing chunk and queued chunks. `acceptedBytes` includes committed, writing, and queued bytes and never decreases. The child callback copies the chunk into owned memory and increments `acceptedBytes` before scheduling asynchronous work. The entire chunk is rejected when `acceptedBytes + chunk.length` exceeds `MAX_OUTPUT_BYTES`.

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

`MAX_REMOTE_ERROR_BODY_BYTES` is an internal constant, not a new environment variable. Each JSON request may use `AGENT_RELAY_REQUEST_TIMEOUT_MS` for the complete bounded response. Each output request uses a dedicated AbortController and header-acquisition timer of that duration; the timer is cleared when headers arrive. Body reads use a separate timer of the same duration, reset after each chunk. `AGENT_RELAY_POLL_TIMEOUT_MS` is the total deadline after job submission. Retry sleep is `min(AGENT_RELAY_POLL_INTERVAL_MS, remainingDeadline)` with no hidden one-second cap. Fatal state or a process signal aborts both controllers and prevents reconnect.

`AGENT_RELAY_OUTPUT_ARCHIVE_PATH` is required and absolute. Its parent must already exist, resolve outside `GITHUB_WORKSPACE`, and not be a symlink into the workspace. The final archive path must not equal `GITHUB_OUTPUT`. The final path means an atomically published complete terminal stream, never a live partial file.

For GitHub command suppression, the runner generates an unpredictable token before output begins. Immediately before the first child chunk it writes the stop guard. It writes the resume guard after terminal completion or during cleanup when stdout remains usable. These guard bytes are never written to the archive and never included in confirmed offsets.

A response body EOF establishes completion only when it comes from a confirmation request that was started while the most recently polled job status was terminal and the response delivered zero bytes. Any earlier EOF triggers an immediate job poll and another request from the confirmed offset. If that poll is active, the EOF is a retryable premature EOF; if it is terminal, the next request is the terminal confirmation request. A confirmation response that delivers bytes processes them normally and is followed by another confirmation request.

Revision note (2026-07-16): Performed three plan-readiness reviews after the `main` merge and green baseline CI. Pinned the reviewed commit without depending on a remote-tracking ref; protected all instruction and workflow files; explicitly overrode generic Git mutation advice; narrowed Codex-owned files; resolved raw output versus redaction and command-suppression envelope semantics; defined transactional prepare, synchronous chunk ownership, checkpoint layout, fixed watermarks, state-dependent physical suffix rules, output error taxonomy, process and output terminal ordering, exact job mappings, interrupted crash-window recovery, live terminal-persistence failure, terminal-prefix endpoint behavior, separate acquisition and idle timers, retry after terminal status, final zero-byte confirmation, mandatory safe archive handling, and preservation of the complete baseline test suite. The plan provides six observable milestones, exact commands, interfaces, and deterministic acceptance scenarios. This revision changes only the active ExecPlan and does not claim implementation complete.
