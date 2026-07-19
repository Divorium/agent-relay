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
- [ ] Add terminal-path regression tests.
- [ ] Implement shared idempotent termination escalation.
- [ ] Release current and queued paused sources exactly once.
- [ ] Preserve first-failure and finalization ordering.
- [ ] Pass exact-SHA full CI.
- [ ] Complete final independent code review.

## Outcomes and retrospective

Complete only after every acceptance criterion passes. Do not move this plan to `completed/` during the next Codex run.