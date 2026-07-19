# Normalize and stream Codex execution output

This ExecPlan follows `.agent/PLANS.md` and addresses issue #33 independently from Docker provisioning.

## Purpose

Agent Relay must consume structured `codex exec --json` output, normalize it once, redact it once, stream it live to the GitHub Actions job log, and persist the same normalized bytes as the workflow artifact.

The current human-readable Codex stream can emit cumulative file diffs repeatedly. Relay forwards those bytes and the workflow persists them through shell `tee`, so long runs can replay the same changes until the output limit is reached. The new design must preserve live progress without heuristic text deduplication.

## Current contract

Verify these statements against the checked-out branch before implementation:

- `.github/workflows/codex.yml` invokes `runner/run-codex.mjs` and persists merged output through `tee`;
- `src/execution/codex-executor.ts` reads separate stdout/stderr pipes, applies streaming redaction, and writes accepted output live;
- `src/run-codex.ts` uses `$GITHUB_OUTPUT` only for workflow values such as `commit_message`;
- `scripts/codex-run` invokes `/usr/local/bin/codex` with executor-supplied arguments;
- output limiting currently applies to forwarded human-readable bytes;
- the Actions step log is live, while the artifact becomes available only after upload.

Do not claim Relay duplicates chunks unless new evidence proves that. Existing artifacts indicate the human Codex renderer emits repeated cumulative diff content and Relay forwards it.

## Runtime protocol

The Codex implementation defines:

- default `codex exec`: only the final message on stdout, other human output on stderr;
- `codex exec --json`: valid JSONL on stdout, one event per line.

Use the installed Codex version as the binding protocol. Record its exact version and capture sanitized representative JSONL before finalizing TypeScript event types. Upstream-main event variants are not automatically supported by the installed binary.

## Binding design

### Structured input

Invoke Codex in JSON mode. Parse stdout as JSONL. Treat stderr as labeled process diagnostics and never feed it into the JSON parser.

### Incremental JSONL framing

The parser must:

- handle records split across arbitrary chunks;
- handle multiple records in one chunk;
- preserve multibyte UTF-8 split across chunks;
- validate the final unterminated line when the stream ends;
- reject malformed non-empty records deterministically;
- bound the size of an unfinished record.

Do not call `JSON.parse` independently on raw process chunks.

### Item lifecycle

Started, updated, and completed events for one item represent one logical item.

Required behavior:

- command start renders once, incremental command output renders as received, completion renders once;
- file-change updates render only newly observed operations or incremental patch content;
- later snapshots never replay already emitted patch content for the same item;
- independent items with identical text remain independent;
- warnings and fatal errors render once per event identity;
- the final assistant message renders once;
- turn completion and usage render once when available.

Prefer Codex-provided item identifiers. For event types without identifiers, define a type-specific lifecycle rule. Do not use global text deduplication, fuzzy matching, arbitrary block hashes, or time-window suppression.

### Normalized presentation

Render readable bounded events for:

- thread/turn start;
- displayable reasoning or progress;
- command start, bounded output, and result;
- file add/modify/delete/rename with bounded incremental patch or concise statistics;
- warnings and errors;
- final assistant message;
- terminal status and usage.

Unknown event types must produce a bounded notice with safe type metadata. They must not be silently ignored or dumped as raw JSON.

### One redacted fan-out

Relay owns the transcript. For every normalized segment:

1. normalize the event;
2. apply streaming redaction;
3. apply the normalized-output byte limit;
4. write the same accepted bytes to both live output and the transcript file.

Both sinks must receive byte-identical normalized content. Do not separately render or separately redact them.

The workflow passes a transcript path below the trusted runner temporary root. Validate containment and reject symlink targets. Flush and close the transcript before artifact upload.

### Workflow changes

Remove workflow-level `2>&1 | tee` transcript ownership. Invoke `runner/run-codex.mjs` directly and pass a transcript path through a dedicated environment variable.

Keep `$GITHUB_OUTPUT` restricted to step outputs. Execution logs never belong there.

The upload step continues to upload the transcript after the Codex step, including on failure.

### Ordering

Use one normalized-event queue for structured stdout events and labeled stderr diagnostics. Preserve the order in which Relay observes events. Do not claim total kernel ordering between separate pipes.

Document and test the chosen arrival-order rule. Live and artifact sinks use the same queue.

### Output limit

Apply `MAX_OUTPUT_BYTES` after normalization and redaction.

At the limit:

- emit one truncation marker to both sinks;
- stop rendering ordinary events;
- keep draining child stdout and stderr so Codex cannot block;
- preserve timeout, process-exit, and fatal-error behavior;
- never emit the marker more than once.

Define and test whether a terminal failure after truncation is represented only by step status or by a reserved terminal-output budget.

### Failure behavior

Fail deterministically on:

- malformed JSONL;
- oversized unfinished JSONL record;
- unsupported lifecycle conditions that make incremental rendering unsafe;
- Codex startup failure;
- nonzero Codex exit;
- timeout;
- transcript create/write/flush/close failure.

A transcript failure must override a successful Codex exit.

## Scope

This PR may change Codex argument construction, executor parsing/normalization, redaction integration, workflow transcript wiring, tests, and directly related documentation.

It must not modify Docker provisioning, Docker lifecycle behavior, `update.sh`, `install.sh`, request routing, public APIs, result semantics, commit ownership, finalization decisions, PR #26, or its active plan.

## Implementation order

1. Capture sanitized JSONL fixtures from the installed Codex version.
2. Add typed incremental framing and parsing.
3. Add lifecycle-aware normalization for commands, file changes, messages, errors, terminal events, and unknown variants.
4. Add one redacted live/artifact fan-out writer.
5. Move output limiting and the single truncation marker into that fan-out.
6. Replace workflow `tee` persistence with an explicit transcript path.
7. Update tests and documentation.
8. Run one final full repository check after the last production edit.

## Acceptance criteria

- `codex exec --json` is used and stdout is parsed incrementally as JSONL;
- arbitrary chunk boundaries, including inside UTF-8 code points, are handled correctly;
- multiple JSONL records in one chunk are handled correctly;
- malformed, oversized unfinished, and invalid final records fail deterministically;
- command progress is visible in the Actions log before Codex exits;
- a file-change lifecycle does not replay previously emitted cumulative patch content;
- independent items are not suppressed because their text matches;
- final assistant output appears exactly once;
- unknown event types produce a bounded notice;
- redaction occurs before both sinks and works across chunk boundaries;
- transcript bytes equal normalized bytes written live by Relay;
- `$GITHUB_OUTPUT` contains workflow outputs only;
- workflow transcript persistence no longer uses `2>&1 | tee`;
- truncation writes one identical marker to both sinks and pipes continue to drain;
- timeout and nonzero-exit behavior remain correct after truncation;
- transcript failure fails the step;
- existing workspace, credential, process-group, finalizer, and commit-decision tests remain passing;
- an integration test proves live progress before child completion and artifact equality;
- `npm run check` passes after the final production edit.

## Test requirements

Tests must exercise production parsers and writers, not replacement implementations.

Required coverage:

- real `Readable` streams with adversarial chunk boundaries;
- representative installed-version JSONL fixtures;
- started/updated/completed sequences for one command and one file-change item;
- two independent items containing identical text;
- command output observed before child completion;
- final assistant message once;
- interleaved structured stdout and diagnostic stderr under the documented ordering rule;
- redaction tokens split across chunks;
- byte-for-byte live sink and transcript comparison;
- transcript containment, symlink rejection, and write/flush/close failures;
- normalized byte-limit and continued pipe draining;
- nonzero exit and timeout after partial output;
- workflow assertions for direct invocation, transcript environment, upload on failure, and absence of `tee`.

A test that only proves a mock or duplicate implementation behaves as configured is not acceptance evidence.

## Documentation

Document that GitHub Actions logs remain live, artifacts become available after upload and contain the same normalized Relay transcript, raw JSONL is an internal protocol, `$GITHUB_OUTPUT` is not a logging channel, and truncation occurs after normalization and redaction.

## Progress

- [x] Confirmed the current human-output and workflow persistence architecture.
- [x] Confirmed Codex JSON mode emits JSONL and default mode separates final stdout from other stderr output.
- [x] Defined normalization, lifecycle, live streaming, artifact, redaction, ordering, and truncation contracts.
- [ ] Capture installed-version fixtures and verify event shapes.
- [ ] Implement incremental parsing and lifecycle-aware normalization.
- [ ] Implement one redacted live/artifact fan-out.
- [ ] Remove workflow `tee` persistence and wire the transcript path.
- [ ] Add repository and workflow integration tests.
- [ ] Update documentation.
- [ ] Run final `npm run check` after the last production edit.
- [ ] Obtain normal CI success on the exact implementation SHA.

## Outcomes & Retrospective

Complete only after implementation, independent review, and exact-SHA CI evidence pass.
