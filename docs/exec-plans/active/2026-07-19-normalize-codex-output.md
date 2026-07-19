# Complete bounded Codex output hardening

This active ExecPlan follows `.agent/PLANS.md`, continues issue #33, and remains independent from Docker provisioning.

## Purpose

Agent Relay must consume `codex exec --json`, normalize and redact output once, stream it live to GitHub Actions, and persist the same accepted bytes as the workflow artifact without workflow-command injection, unbounded memory growth, quadratic framing, repeated cumulative output, or false validation claims.

The first hardening implementation at `ceb329941f655d4e10ec377e8c86689cf4abbb5e` corrected the original five findings only partially. Independent review found additional blocking defects in queue admission, large-record framing, physical-line rendering, and Writable completion semantics. Do not move this plan to `completed/` until the second implementation passes independent review and exact-SHA CI.

Do not revert to human-readable Codex output, workflow-level `tee`, global text deduplication, or end-of-run buffering.

## Scope

This iteration may change:

- `src/execution/codex-executor.ts`;
- `src/execution/codex-normalizer.ts`;
- `src/execution/jsonl-parser.ts`;
- `src/execution/output-pump.ts`;
- `src/execution/output-renderer.ts`;
- `src/execution/transcript.ts`;
- directly related configuration, tests, fixtures, and documentation.

It must not change Docker provisioning, `update.sh`, `install.sh`, request routing, public APIs, result semantics, commit ownership, finalization decisions, or PR #26.

Preserve structured JSONL stdout, separately labeled stderr, one redacted live/artifact fan-out, and `$GITHUB_OUTPUT` only for workflow values.

## Authoritative review baseline

Use these primary contracts:

- GitHub workflow commands can be interpreted when an output line begins with `::`; arbitrary output must be structurally neutralized.
  - https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands
- Node Writable producers must stop writing after `write()` returns `false` and wait for `drain`; continued writes allow memory growth.
  - https://nodejs.org/api/stream.html
- Child-process pipes have finite capacity and must be consumed without unbounded intermediary buffering.
  - https://nodejs.org/api/child_process.html
- Codex CLI 0.144.4 emits JSONL on stdout and cumulative `aggregated_output` inside complete item records.
  - https://github.com/openai/codex/blob/rust-v0.144.4/codex-rs/exec/src/lib.rs
  - https://github.com/openai/codex/blob/rust-v0.144.4/codex-rs/exec/src/exec_events.rs
  - https://github.com/openai/codex/blob/rust-v0.144.4/codex-rs/exec/src/event_processor_with_jsonl_output.rs

The installed `codex-cli 0.144.4` protocol is binding. Current upstream `main` is not a substitute.

## Findings already addressed and to preserve

The implementation must retain these existing improvements:

- `codex exec --json` and strict UTF-8 JSONL;
- structural protection against `::add-mask::`, `::warning::`, `::error::`, and `::stop-commands::` in untrusted content;
- one redacted live/transcript fan-out;
- separate `MAX_JSONL_RECORD_BYTES` with a bounded hard ceiling;
- bounded stderr continuation chunks;
- active cumulative state represented by length and SHA-256 prefix metadata rather than prior complete payloads;
- immediate release of active state on completion;
- bounded completed/event replay sets;
- lifecycle state clearing after transcript truncation;
- timeout, process-group termination, transcript safety, and post-truncation syntax validation.

## Second implementation review findings

### 1. The output queue is not actually bounded

`BoundedOutputPump.enqueue()` calls `pause()` after reaching the high watermark but continues synchronously splitting and appending every remaining segment from the current value. `JsonlParser.write()` can also synchronously emit multiple records from one already delivered child chunk after both streams have been paused.

The current backpressure test stops its producer when a test boolean becomes `paused`; the real parser does not. Another test enqueues a value larger than the high watermark but checks only that `pause()` was called, not the maximum queue size.

Result: `maximumQueuedBytes` can exceed the documented high-watermark allowance by all output generated from the current value or current raw chunk. The acceptance claim is therefore unproven and false for adversarial input.

### 2. Large JSONL framing is quadratic

`JsonlParser` repeatedly performs:

- `pending += decoder.decode(chunk)`;
- `pending.indexOf("\n")` from the beginning;
- `Buffer.byteLength(pending)` over the whole accumulated string.

A valid large no-newline record, now allowed up to tens of megabytes, repeatedly copies and scans its complete accumulated prefix. Increasing the protocol limit without replacing this representation creates quadratic CPU and allocation behavior.

### 3. Empty physical lines are not Relay-owned

`renderRelayLines()` removes the trailing empty logical line when input ends in a newline, and `line()` appends another newline. A multiline value ending in a newline can therefore produce an unprefixed blank physical line. Existing tests filter empty lines or assert the old behavior, so they do not enforce the plan’s requirement that continuation and empty lines are Relay-owned.

The truncation marker also begins with a raw leading newline. The final format must not rely on unowned blank lines.

### 4. Writable callback support is inferred from function arity

`writeLive()` treats a sink as callback-free when `live.write.length < 2`. JavaScript function arity is not a reliable Writable capability contract: bound, wrapped, defaulted, or variadic write functions can still complete asynchronously through the supplied callback.

The production path is a Node Writable. It must always use and await the actual callback contract rather than guessing from `Function.length`. Test-only immediate sinks must use an explicit adapter or call the callback.

### 5. Exact-SHA CI did not run

The commit pushed by the Codex workflow has CI conclusion `action_required` with no jobs. A workflow success on the implementation job is not equivalent to normal pull-request CI on the resulting SHA. The plan remains active until a later non-workflow-token commit triggers and passes full CI on code containing the final production implementation.

## Binding design

### Bounded input-to-output admission

Backpressure must control admission, not merely call `pause()` after output has already been queued.

Use a design with these properties:

- the queue has a hard byte capacity equal to the configured high watermark plus at most one normalized segment;
- `enqueue()` never synchronously appends beyond that hard capacity;
- admission is asynchronous: a producer waits for capacity before the next segment is accepted;
- parsers and normalizers yield records/segments incrementally and await admission instead of returning an arbitrarily large array;
- once either child pipe delivers a raw chunk, processing that chunk cannot enqueue unlimited records while the source is paused;
- at most one current bounded raw chunk per source plus one normalized segment may sit outside the queue accounting;
- both child streams are paused before additional chunks can enter when capacity is exhausted;
- both resume only below the low watermark;
- callback-observation order between stdout and stderr is preserved through one tagged raw-input/admission queue, without claiming kernel-global ordering.

An acceptable architecture is:

1. on each `data` callback, pause that source immediately and enqueue one tagged raw chunk in callback-arrival order;
2. one async consumer processes tagged chunks serially;
3. JSONL and diagnostic framers expose records/chunks incrementally;
4. the normalizer exposes output lazily or through an async segment callback;
5. each normalized segment awaits bounded pump capacity and sink completion;
6. only after the tagged raw chunk is fully processed may its source be resumed, subject to global high/low watermarks.

Codex may use an equivalent design only if tests prove the same hard bound under real parser behavior.

### Linear byte-oriented JSONL framing

Replace the repeatedly concatenated pending string with a byte-oriented incremental framer.

Required behavior:

- retain incoming `Buffer`/`Uint8Array` slices with an incremental byte count;
- scan each incoming byte once for LF;
- do not rescan or recalculate the byte length of the complete pending prefix on every chunk;
- decode and `JSON.parse` a complete record once;
- strip one optional CR before LF;
- preserve fatal UTF-8 validation and final unterminated-record validation;
- reject as soon as the incremental byte count exceeds `MAX_JSONL_RECORD_BYTES`;
- release accumulated record chunks immediately after parsing or failure;
- keep memory O(record limit + current chunk), with linear framing work.

Tests must feed a multi-megabyte valid record through very small chunks and verify completion without a timing-only assertion. Add instrumentation or an internal test seam proving bytes are counted incrementally and the implementation does not rebuild the complete pending string for each chunk.

### Strict physical-line ownership

Define one renderer contract:

- every emitted physical line, including an empty logical line, begins with `[codex] `;
- every returned segment is composed of complete prefixed physical lines, except UTF-8-safe transport splitting that does not change the logical representation;
- CRLF, CR, and LF are canonicalized;
- unsafe C0 controls and DEL are visibly encoded;
- no normalized helper adds a second raw newline after a renderer that already owns termination;
- the truncation marker is a normal Relay-owned line such as `[codex] [OUTPUT TRUNCATED]\n`, without a leading blank line.

Tests must not use `filter(Boolean)` when validating line ownership. Split the complete output and assert every physical line before the final terminator starts with `[codex] `.

### Explicit Node Writable adapter

The production live sink must be treated as a Node Writable:

- always supply and await the write callback;
- when `write()` returns `false`, additionally await `drain`;
- do not branch on `write.length`;
- reject on synchronous throw, callback error, `error`, premature `close`, destroyed state, or ended state;
- remove all per-write listeners on success and failure;
- make test-only immediate sinks explicitly invoke the callback or wrap them in a dedicated immediate adapter.

The error message must distinguish live-output failure from transcript-file failure while retaining the first-failure policy.

### Bounded normalizer emission

Do not construct a large array of normalized segments before admission.

- expose normalized segments as an iterator/generator or callback-driven sequence;
- enforce the 32 KiB UTF-8 segment maximum while yielding;
- bound todo-list and file-change output generation while preserving the installed protocol semantics;
- ensure one valid event cannot allocate an output array proportional to the JSONL record size;
- continue using length/SHA-256 cumulative verification and bounded replay state.

## Required tests

Add tests that fail against `ceb329941f655d4e10ec377e8c86689cf4abbb5e`:

1. A single parser chunk containing many JSONL records, each producing multiple segments, while a real controllable Writable remains backpressured. Assert the hard queue bound, actual source pause/resume, order, and byte-identical transcript.
2. One single normalized value requiring many segments. Assert the queue never grows above high watermark plus one segment even though the producer does not stop itself after `pause()`.
3. A multi-megabyte JSONL record fed in small chunks. Assert linear incremental byte accounting and successful parse.
4. A protocol-over-limit record fed incrementally. Assert early deterministic rejection and release of pending chunks.
5. Command output, patch, reasoning, assistant, todo, warning, error, unknown event, and stderr values ending with newlines and containing empty lines. Assert every physical line is prefixed without filtering blanks.
6. The truncation marker is a Relay-owned line with no leading blank line and remains byte-identical across sinks.
7. A wrapped or variadic asynchronous Writable whose `write.length` is zero. Assert completion waits for its callback and `drain`.
8. A real executor integration test with a fast fake child producing a burst larger than the high watermark in one write while the live Writable is deliberately slow.
9. Large todo/file-change events prove normalization yields incrementally rather than constructing an unbounded output array.
10. Existing malformed JSONL, invalid UTF-8, large valid record, stderr continuation, lifecycle replay, timeout, nonzero exit, transcript failure, workspace, credential, finalizer, and commit-decision tests remain passing.

## Validation boundary

The pull-request Codex workflow executes the trusted deployed runtime under `/srv/github-runner/storage/agent-relay/runner`, not executor code from the PR checkout. Its 97-thousand-line human-readable log and missing transcript artifact do not validate or invalidate the branch implementation.

Pre-merge acceptance requires:

- full `npm run check` on the exact final SHA;
- normal self-hosted pull-request CI with actual jobs and conclusion `success` on that SHA;
- production integration tests exercising the branch executor code with real Node streams and controlled child processes;
- independent code review confirming every acceptance criterion.

A real Codex transport smoke remains a post-merge, post-`update.sh` operational check.

## Implementation order

1. Add the ten missing regression tests.
2. Replace synchronous output admission with a hard-bounded async input/output pipeline.
3. Replace string-concatenating JSONL framing with linear byte-oriented framing.
4. Correct physical-line and truncation-marker ownership.
5. Replace function-arity inference with an explicit Node Writable adapter.
6. Make normalizer emission lazy and bounded.
7. Update documentation and this plan with actual implemented limits and evidence.
8. Run the complete repository checks after the final production edit.
9. Leave this plan active for independent review and exact-SHA CI.

## Acceptance criteria

- The normalized queue never exceeds the high watermark plus one 32 KiB segment under actual parser and executor burst tests.
- Pausing prevents further admission from the already delivered chunk; tests do not rely on a cooperative producer stopping itself.
- Raw input outside queue accounting is bounded to one current child chunk per source.
- JSONL framing is byte-oriented, incremental, linear, and bounded.
- A multi-megabyte small-chunk record passes; an over-limit record fails early.
- Every physical output line, including empty lines and the truncation marker, is Relay-prefixed.
- No untrusted line can begin with `::` at column zero.
- The Node Writable callback is always awaited without `Function.length` inference; `drain` is also awaited after `false`.
- Live-output and transcript-output failures are distinguishable and deterministic.
- Normalizer output is yielded incrementally with no record-sized output array.
- Lifecycle state and replay sets remain bounded and cumulative replay prevention remains correct.
- Live and artifact bytes remain identical after safe rendering, redaction, and truncation.
- Full repository checks and normal self-hosted PR CI pass on the exact final SHA.
- Independent review finds no unresolved P1/P2 defect.
- The plan remains active until those criteria pass.

## Progress

- [x] Completed the original structured-output implementation.
- [x] Reviewed and partially addressed workflow-command injection, sink backpressure, protocol limits, stderr buffering, and lifecycle retention.
- [x] Performed a second independent review against current GitHub, Node.js, and Codex 0.144.4 contracts.
- [x] Identified false queue-bound evidence, quadratic large-record framing, incomplete physical-line ownership, and unreliable Writable arity inference.
- [ ] Add second-review regression tests.
- [ ] Implement hard-bounded async admission.
- [ ] Implement linear byte-oriented JSONL framing.
- [ ] Correct complete physical-line ownership.
- [ ] Implement explicit Node Writable completion semantics.
- [ ] Implement lazy bounded normalizer emission.
- [ ] Pass exact-SHA full CI.
- [ ] Complete final independent review.

## Outcomes and retrospective

Complete only after all acceptance criteria pass. Do not move this plan to `completed/` during the next Codex implementation run.