# Complete Codex output hardening

This active ExecPlan follows `.agent/PLANS.md`, continues issue #33, and remains independent from Docker provisioning.

## Purpose

Agent Relay must consume `codex exec --json`, normalize and redact output once, stream it live to GitHub Actions, and persist the same accepted bytes as the artifact without workflow-command injection, unbounded buffering, repeated cumulative output, quadratic framing, or non-terminating failure paths.

The implementation at `b27a5470444192f5d76cee66fa9d66047c52a9bf` satisfies the reviewed normal-flow requirements. Independent review found one remaining blocking defect in abnormal termination. Preserve the completed hardening and correct only this terminal path plus its validation.

Do not move this plan to `completed/` during the next implementation run.

## Scope

This iteration may change `src/execution/codex-executor.ts`, `src/execution/output-pump.ts`, and directly related tests and documentation. It must not change Docker provisioning, `update.sh`, `install.sh`, request routing, public APIs, result semantics, commit ownership, finalization decisions, or PR #26.

## Authoritative baseline

Use the official Node.js child-process and stream contracts:

- a termination request does not prove that a child has exited; a child may intercept or ignore it while the parent continues waiting;
- `Readable.pause()` stops future `data` delivery and leaves unread data buffered until the stream resumes or is otherwise consumed;
- child-process pipes must remain consumed or explicitly discarded.

Sources:

- https://nodejs.org/api/child_process.html
- https://nodejs.org/api/stream.html

## Completed behavior to preserve

Do not regress:

- structured Codex JSONL stdout and separately framed stderr;
- Actions-safe ownership of every physical output line;
- byte-identical redacted live/transcript fan-out;
- explicit Writable callback and `drain` handling;
- 256 KiB/128 KiB output watermarks and 32 KiB maximum segments;
- callback-ordered raw-chunk admission with immediate source pause;
- byte-oriented linear JSONL framing and bounded protocol-record budget;
- bounded stderr continuation chunks;
- lazy normalizer output and bounded lifecycle/replay state;
- syntax validation after transcript truncation;
- timeout, nonzero-exit, transcript-safety, workspace, credential, finalizer, and commit-decision behavior.

## Blocking finding

`OrderedInputPump.accept()` pauses a source before processing its chunk. If `processChunk()` throws, the current source has already been removed from the queue. The catch path resumes queued sources but not that current source.

The executor then sends one graceful termination request and waits for child close. Parser, normalizer, live-output, and transcript-write failures do not use the timeout path’s later forced-termination fallback.

A child that ignores or indefinitely handles graceful termination can therefore leave the current pipe paused and keep the workflow running forever. Existing tests use children that exit after the first signal and do not cover this case.

## Binding design

### One idempotent termination controller

Use one controller for timeout and every post-spawn fatal failure.

It must:

- preserve the first semantic failure separately from termination mechanics;
- send the graceful process-group termination request at most once;
- schedule one forced process-group termination after `forceKillDelayMs` when the child has not closed;
- clear the escalation timer on child close and startup failure;
- tolerate repeated failure notifications without extra timers or signal storms;
- never replace the original parser, normalizer, live-output, transcript, or timeout error with a later termination error;
- avoid signalling after child close;
- retain existing process-group fallback behavior.

Timeout must still surface `CODEX_TIMEOUT`; non-timeout failures must surface their original failure.

### Release every paused input

`OrderedInputPump` must track its currently processed raw input.

On normal completion, resume that source only after its chunk is fully processed and output is below the low watermark.

On failure or discard:

- resume the current source exactly once;
- resume every queued source exactly once;
- clear the raw queue;
- switch executor handlers to drain/discard mode;
- keep the data listeners active so resumed pipes are consumed and ignored until child close;
- do not re-enter parsing or normalization;
- avoid double resume when failure races with normal chunk completion.

### Terminal ordering

After child close:

1. clear any pending escalation timer;
2. wait for the raw-input pump to become idle;
3. wait for output-pump and fan-out finalization;
4. throw the original semantic failure, timeout, or nonzero-exit result using existing precedence.

Transcript sync and close must still be attempted once. A later finalization error must not overwrite an earlier semantic failure.

## Required regression tests

Add production-path tests that fail against `b27a5470444192f5d76cee66fa9d66047c52a9bf`:

1. Current raw input throws during processing and its source is resumed exactly once.
2. The same failure occurs while another source is queued; current and queued sources are each resumed once and the pump becomes idle.
3. A fake child emits malformed JSONL and ignores graceful termination; executor escalates and rejects with the original JSONL error within a bounded test duration.
4. A fake child triggers transcript-write failure and ignores graceful termination; executor escalates and rejects with the original transcript error.
5. Near-simultaneous parser, stream, and sink failures produce one graceful request and one forced escalation only.
6. A child closes after the graceful request before the escalation delay; no later signal is sent.
7. Existing timeout escalation still reports `CODEX_TIMEOUT`.
8. All existing normal-flow burst, queue, parser, renderer, Writable, stderr, lifecycle, truncation, and finalization tests remain passing.

Tests must exercise production pumps and executor paths, not a duplicate controller.

## Validation boundary

The PR Codex workflow runs the trusted deployed runtime, not branch executor code. Its output is not acceptance evidence for this branch.

Pre-merge acceptance requires:

- full `npm run check` on the exact final SHA;
- normal self-hosted PR CI with actual jobs and conclusion `success` on that SHA;
- production integration tests using a child that ignores graceful termination;
- independent review confirming that no paused source or escalation timer survives a terminal path.

A real Codex transport smoke remains a post-merge, post-`update.sh` operational check.

## Acceptance criteria

- Every source paused by `OrderedInputPump` is resumed exactly once on success, failure, or discard.
- The raw-input pump becomes idle after current-chunk failure.
- Every post-spawn fatal path initiates one graceful termination and at most one forced escalation.
- An ignored graceful signal cannot hang parser, normalizer, live-output, or transcript failures.
- The escalation timer is cleared on close/startup failure and cannot signal afterward.
- The original semantic error remains authoritative after forced termination.
- Timeout still reports `CODEX_TIMEOUT`; nonzero exit remains authoritative when no earlier failure exists.
- Transcript finalization is attempted once and does not overwrite an earlier failure.
- All completed output-hardening behavior remains unchanged.
- Full repository checks and normal self-hosted PR CI pass on the exact final SHA.
- Independent review finds no unresolved P1/P2 issue.
- The plan remains active until those criteria pass.

## Plan review

The plan is narrow, implementable, and consistent with the current architecture. The finding maps directly to the current raw-input catch/discard path and executor failure callback. One shared termination state machine avoids independent signal logic in every error source. Source release, escalation, first-failure precedence, timer cleanup, and finalization each have explicit production-path tests.

No plan-level blocker remains. The plan is ready for implementation.

## Progress

- [x] Completed structured, bounded, Actions-safe output handling.
- [x] Completed byte-oriented framing, bounded raw admission, explicit Writable handling, and bounded lifecycle state.
- [x] Performed third independent review against current Node.js process and stream contracts.
- [x] Identified the paused-current-source and missing forced-escalation defect.
- [x] Completed plan review; no plan-level blocker remains.
- [x] Add terminal-path regression tests.
- [x] Implement shared idempotent termination escalation.
- [x] Release current and queued paused sources exactly once.
- [x] Preserve first-failure and finalization ordering.
- [ ] [blocked] Pass exact-SHA full CI. The implementation is still an uncommitted runner worktree by design, so no final SHA exists yet; PR #35 CI success is for baseline `1746fbc6564aeb10e08cc6cf41313d490556f842`, not these changes. Local `npm run check` also cannot complete in this sandbox because `scripts/toolchain-smoke.sh` and the system integration scripts create directories under policy-denied `/tmp`. Unblock when the existing finalizer commits and pushes these changes and the normal self-hosted `test` job succeeds on that exact SHA.
- [x] Complete final independent code review.

## Surprises & discoveries

- Independent review found that a post-spawn child `error` was still treated as a startup failure and closure. The executor now distinguishes the `spawn` event from later errors and waits for `close` before cancelling escalation.
- Independent review also found that malformed trailing JSON discovered after forced timeout could replace `CODEX_TIMEOUT`. Timeout now enters the same first-terminal-failure path, so chronological precedence is retained.
- The local sandbox denies `/tmp`. `npm run check` reaches `check:runtime` and fails at its hard-coded `/tmp` default; setting `RUNNER_TEMP` allows runtime validation, but the toolchain smoke and system integration scripts themselves use `/tmp` explicitly.

## Decision log

- Use a private termination controller in `codex-executor.ts` rather than adding a constructor injection or public API. Regression tests observe and forward real process-group signals around production executor paths.
- Schedule forced escalation before requesting graceful termination, contain signalling exceptions, and clear escalation only on genuine startup failure or child `close`. This preserves the semantic failure even when signalling synchronously errors.
- Treat timeout as a first terminal failure through the shared failure path. Later parser, stream, sink, and finalization failures cannot replace it.

## Validation evidence

- `npm run typecheck && npm run build && node --test --test-concurrency=1 dist/test/executor.integration.test.js dist/test/codex-output.test.js`: 56 tests passed.
- `npm test`: 124 tests passed with 100% line, branch, and function coverage.
- `RUNNER_TEMP=... npm run check:runtime`, `npm run check:shell`, and `npm run check:node-scripts`: passed.
- `RUNNER_TEMP=... npm run check:toolchain`: verified the configured toolchain, then failed when `scripts/toolchain-smoke.sh` attempted `mktemp -d /tmp/agent-relay-smoke.XXXXXX`; this is the recorded sandbox blocker, not acceptance evidence.
- Final independent re-review: no unresolved P1/P2 issue in source release, drain mode, escalation, timeout/error precedence, or finalization ordering.
- GitHub PR #35 baseline SHA `1746fbc6564aeb10e08cc6cf41313d490556f842`: self-hosted `test` and `validate` concluded `success`; excluded from final acceptance because the implementation is not in that SHA.

## Outcomes and retrospective

Complete only after every acceptance criterion passes. Do not move this plan to `completed/` during the next Codex run.
