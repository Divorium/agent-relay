# Harden normalized Codex output streaming

This active ExecPlan follows `.agent/PLANS.md`, reopens issue #33 after independent review, and remains independent from Docker provisioning.

## Purpose

Agent Relay already uses `codex exec --json`, parses JSONL, normalizes events, redacts once, streams progress live to GitHub Actions, and writes the accepted transcript to the artifact. Independent review found five blocking defects under hostile or high-volume output. Preserve the structured architecture while fixing them. Do not revert to human-readable Codex output, shell `tee`, global text deduplication, or end-of-run buffering.

## Scope

This iteration may change the Codex executor, normalizer, JSONL/diagnostic framing, transcript fan-out, directly related configuration, tests, fixtures, and documentation. It must not change Docker provisioning, `update.sh`, `install.sh`, request routing, public APIs, result semantics, commit ownership, finalization decisions, or PR #26.

Keep separate JSONL stdout and diagnostic stderr, one redacted live/artifact fan-out, and `$GITHUB_OUTPUT` only for workflow values.

## Review baseline

Use these primary contracts:

- GitHub workflow commands: arbitrary logged content may be interpreted when a physical line starts with `::`; `stop-commands` requires a unique random resume token.
  - https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands
- Node Writable streams: after `write()` returns `false`, producers must wait for `drain`; continued writes permit unbounded buffering.
  - https://nodejs.org/api/stream.html
- Child-process pipes have finite capacity and must remain consumed.
  - https://nodejs.org/api/child_process.html
- Codex 0.144.4 `exec --json` emits one JSON object per stdout line and diagnostics on stderr.
  - https://github.com/openai/codex/blob/rust-v0.144.4/codex-rs/exec/src/lib.rs
- Codex 0.144.4 command items serialize cumulative `aggregated_output` inside one JSONL record.
  - https://github.com/openai/codex/blob/rust-v0.144.4/codex-rs/exec/src/exec_events.rs
  - https://github.com/openai/codex/blob/rust-v0.144.4/codex-rs/exec/src/event_processor_with_jsonl_output.rs

Use installed `codex-cli 0.144.4` as the binding protocol, not current upstream `main`.

## Blocking findings

1. The formatter prefixes only the first physical line, so later lines such as `::add-mask::`, `::warning::`, or `::stop-commands::` can be interpreted by GitHub Runner.
2. The executor creates an unbounded Promise chain, leaves child streams flowing, and ignores `process.stdout.write()` backpressure.
3. The fixed 1 MiB JSONL record limit can reject a valid cumulative Codex event after JSON envelope and escaping.
4. Stderr retains an unlimited no-newline diagnostic line.
5. The normalizer retains complete cumulative payloads and completed identities for the entire run.

## Binding design

### Actions-safe physical lines

All model-, tool-, file-, and process-controlled strings are untrusted log content. Preserve byte-identical live/transcript output by making the normalized representation itself safe.

- Canonicalize CRLF, bare CR, and LF into logical line boundaries.
- Prefix every physical output line, including continuations and empty lines, with a fixed Relay-owned prefix.
- Guarantee that no untrusted physical line begins with `::` at column zero.
- Visibly encode unsafe C0 controls and DEL rather than passing them raw.
- Route command output, patches, reasoning, assistant messages, todos, warnings, errors, unknown notices, and stderr through the same renderer.
- Do not search only for known workflow command names. The invariant is structural.

Do not add live-only control lines unless the live/transcript equality contract is deliberately changed and tested.

### Bounded backpressure-aware pump

Replace the Promise-per-segment chain with one explicit bounded asynchronous pump.

- Bound the queue by pending normalized bytes with documented high and low watermarks.
- Pause both child stdout and stderr at the high watermark and resume only below the low watermark.
- Permit only current delivered chunks and one bounded normalized segment beyond the high watermark.
- Use one consumer loop and preserve callback-observation order across the two pipes.
- On parser, normalizer, or sink failure, retain the first failure, terminate the process group, and continue draining/discarding pipes until close.
- After transcript truncation, stop retaining ordinary lifecycle content while continuing the documented bounded framing/drain behavior.

Make the live sink asynchronous. Its Node Writable adapter must:

- wait for write completion;
- wait for `drain` when `write()` returns `false`;
- fail on writable `error` or premature `close`;
- not mark a segment consumed until both live and transcript writes settle successfully.

Tests must use a controllable Writable that returns `false`, delays `drain`, and records maximum queued bytes. A fast fake Codex process must not create unbounded pending operations.

### Protocol record budget

Add a separate validated `MAX_JSONL_RECORD_BYTES` budget. The default must safely exceed `MAX_OUTPUT_BYTES` with documented JSON escaping and envelope headroom; a hard-coded 1 MiB default is not acceptable.

- Keep the protocol budget bounded.
- Accept a valid installed-version command event larger than 1 MiB.
- Account for worst-case JSON string escaping.
- Reject complete or unfinished records above the configured protocol limit.
- Keep this independent from normalized transcript truncation.
- Document the rule and configuration.

### Bounded diagnostics

Stderr framing must have a fixed unfinished-line byte bound. Prefer bounded continuation emission instead of failing only because stderr omitted a newline.

- Preserve UTF-8 boundaries across chunks.
- Emit labeled continuation chunks when a diagnostic line exceeds the bound.
- Retain only a bounded suffix.
- Route every chunk through the actions-safe renderer.
- Test multi-megabyte no-newline stderr with adversarial UTF-8 splits and prove bounded pending memory.

### Bounded lifecycle state

Do not retain complete cumulative payloads after emission.

For active cumulative items, store only minimum verification metadata, such as prior length plus a cryptographic digest of the prior prefix. On each update, verify the digest of the current corresponding prefix before emitting the suffix.

- Remove active payload state immediately on completion.
- Keep only bounded replay-protection metadata.
- Cap completed-item and event-identity tracking with deterministic eviction.
- Clear unnecessary lifecycle state after transcript truncation.
- Preserve independent items with identical content.
- Bound per-file metadata for active file-change items.

Tests must demonstrate bounded retained state across many completed commands, messages, reasoning items, warnings, and file changes.

## Failure and truncation semantics

Preserve these contracts:

- malformed JSONL and invalid UTF-8 fail deterministically before truncation;
- transcript create/write/sync/close failures fail the step;
- timeout and nonzero exit remain authoritative after partial output or truncation;
- exactly one truncation marker reaches both sinks;
- child pipes remain drained;
- successful live and artifact sinks contain identical Relay-normalized accepted bytes.

Document and test whether syntax validation continues after ordinary output truncation. The selected behavior must remain bounded.

## Implementation order

1. Add failing production tests for all five findings.
2. Centralize actions-safe multiline rendering.
3. Replace the Promise chain with the bounded pump and async Writable adapter.
4. Separate and validate the JSONL protocol budget.
5. Bound and incrementally emit stderr diagnostics.
6. Replace retained cumulative payloads with length/digest state and bounded replay metadata.
7. Update README, technical specification, operations guide, and prior completed-plan claims.
8. Run the full repository check after the final production edit.
9. Leave this plan active until independent review and a self-hosted final-SHA smoke run use the corrected transport.

## Acceptance criteria

- No physical Relay output line containing untrusted data begins with `::`.
- Tests cover `::add-mask::`, `::warning::`, `::error::`, and `::stop-commands::` in all multiline source categories.
- Live and transcript output remain byte-identical after safe rendering and redaction.
- A slow Writable returning `false` pauses child ingestion and resumes after `drain`.
- Stress tests prove the queue stays within the documented allowance.
- No unbounded Promise-per-segment chain remains.
- Live writable errors and premature close fail execution.
- A valid Codex 0.144.4 command JSONL record larger than 1 MiB is accepted.
- Records above the separate protocol limit fail deterministically.
- Multi-megabyte no-newline stderr is emitted in bounded continuation chunks.
- Active cumulative state stores bounded metadata rather than prior complete payloads.
- Completed items and event identities use bounded replay tracking and state is released after completion/truncation.
- Existing lifecycle replay prevention and equal-text independence remain correct.
- Timeout, forced kill, nonzero exit, parser failure, redaction, transcript safety, workspace, credentials, finalizer, and commit-decision regressions pass.
- `npm run check` and normal PR CI pass on the exact implementation SHA.
- A second self-hosted Codex run starts from that exact SHA and demonstrates live progress, bounded output, no cumulative diff replay, and no workflow-command interpretation from adversarial fixture content.
- The plan remains active until final-SHA smoke evidence and independent review pass.

## Progress

- [x] Reproduced and reviewed the initial structured JSONL implementation.
- [x] Confirmed all five blocking findings against production code.
- [x] Confirmed GitHub workflow-command and Node backpressure contracts from primary documentation.
- [x] Confirmed Codex 0.144.4 serializes cumulative command output in one JSONL event.
- [ ] Add regression tests for all findings.
- [ ] Implement actions-safe multiline rendering.
- [ ] Implement bounded backpressure-aware pumping.
- [ ] Implement protocol-derived JSONL record bounds.
- [ ] Implement bounded stderr framing.
- [ ] Implement bounded lifecycle state.
- [ ] Run exact-SHA CI.
- [ ] Complete independent code review.
- [ ] Complete final-SHA self-hosted smoke validation.

## Outcomes and retrospective

Complete only after all acceptance criteria pass. Do not move this plan to `completed/` during the first implementation run.