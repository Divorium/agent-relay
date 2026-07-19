# Normalize and stream Codex execution output

This completed ExecPlan follows `.agent/PLANS.md` and resolves issue #33 independently from Docker provisioning.

## Purpose

Agent Relay consumes structured `codex exec --json` output, normalizes it once, redacts it once, streams it live to the GitHub Actions job log, and persists the same normalized bytes as the workflow artifact.

The previous human-readable Codex renderer repeatedly emitted cumulative file diffs. Relay forwarded those bytes correctly, but the workflow persisted the repeated stream through shell `tee`, allowing long runs to reach the output limit without adding useful information. The implemented design removes the repeated renderer rather than heuristically deduplicating arbitrary text.

## Scope

The implementation changes only:

- Codex argument construction;
- JSONL framing and event normalization;
- redacted live/artifact fan-out;
- workflow transcript wiring;
- directly related tests and documentation.

It does not change Docker provisioning, `update.sh`, `install.sh`, request routing, public APIs, result semantics, commit ownership, finalization decisions, or PR #26.

## Implemented protocol

- Codex is invoked as `codex exec --json`.
- Structured stdout is strict fatal-UTF-8 JSONL.
- Stderr is framed independently as labeled process diagnostics and is never parsed as JSONL.
- The JSONL parser handles arbitrary process chunks, multiple records per chunk, split UTF-8 code points, a final unterminated record, malformed records, non-object records, and a 1 MiB unfinished-record bound.
- The installed `codex-cli 0.144.4` event model is represented by a sanitized fixture verified against the matching versioned event definitions.

## Lifecycle normalization

Codex item identifiers are the only lifecycle correlation keys.

- command start renders once;
- cumulative command output is emitted only as the newly observed suffix;
- command completion renders once;
- file operations render once per item/path/kind;
- optional cumulative patch or diff content is emitted only as the new suffix;
- reasoning progress is emitted incrementally;
- the final assistant message is emitted once on completion;
- independent items with identical text remain independent;
- warnings and errors use event identity when available;
- unknown events produce bounded type notices instead of raw JSON dumps;
- unsafe non-cumulative or post-completion lifecycle changes fail deterministically.

No global text deduplication, fuzzy matching, time-window suppression, or arbitrary block hashing is used.

## Live output and artifact contract

Relay owns the transcript.

For each normalized segment it:

1. normalizes the structured event;
2. applies streaming redaction;
3. applies the normalized byte limit;
4. writes the same accepted bytes to the live process output and transcript sink.

The transcript path must be below the canonical `RUNNER_TEMP`, its parent may not escape through symlinks, and the target must not already exist or be a symlink. The file is created exclusively with mode `0600`, synchronized, and closed before artifact upload.

The workflow no longer uses `2>&1 | tee`. `$GITHUB_OUTPUT` remains limited to workflow outputs such as `commit_message`.

## Ordering and truncation

- stdout events and stderr diagnostics enter one promise queue in Relay callback-arrival order;
- no total kernel ordering is claimed across the two OS pipes;
- the live sink and transcript use the same queue;
- `MAX_OUTPUT_BYTES` is applied after normalization and redaction;
- truncation never splits a UTF-8 code point;
- exactly one fixed truncation marker is emitted to both sinks;
- after truncation, both child pipes continue to drain;
- later timeout or nonzero exit is represented by the step result;
- transcript write, sync, or close failure fails the execution even when Codex exits successfully.

## Validation

Production code is exercised directly rather than through replacement implementations.

Coverage includes:

- adversarial JSONL and UTF-8 chunk boundaries;
- multiple records in one chunk and final unterminated records;
- malformed, oversized, non-object, and invalid-UTF-8 input;
- installed-version command, file-change, reasoning, assistant, error, todo, and usage events;
- cumulative lifecycle deltas without replay;
- independent equal-text items;
- live command progress observed before child completion;
- byte-identical live output and transcript contents;
- cross-chunk secret redaction;
- transcript containment, symlink rejection, exclusive creation, and sink failures;
- deterministic truncation, UTF-8 boundary preservation, and continued pipe draining;
- timeout and nonzero exit after partial or truncated output;
- workflow assertions for direct execution, transcript environment, upload on failure, and absence of `tee`;
- existing workspace, credentials, process-group, finalizer, commit-decision, runtime, shell, Node, toolchain, and system regressions.

## Progress

- [x] Confirmed that Relay did not duplicate chunks; repeated cumulative diffs originated in the human-readable Codex stream.
- [x] Confirmed the installed Codex version and structured JSONL protocol.
- [x] Implemented incremental JSONL and diagnostic framing.
- [x] Implemented lifecycle-aware event normalization.
- [x] Implemented one redacted live/artifact fan-out.
- [x] Removed workflow-level `tee` transcript ownership.
- [x] Added transcript path validation and deterministic failure handling.
- [x] Added production parser, normalizer, fan-out, executor, workflow, and integration tests.
- [x] Added UTF-8-safe output truncation after independent review found a possible split code point.
- [x] Updated README, technical specification, operations documentation, and example workflow.
- [x] Ran the complete normal repository CI on implementation SHA `a7884e94bc6befc9e566e538916f8117fbdb6849`.
- [x] CI run #747 passed type checking, 91 tests, 100% line/branch/function coverage, production runtime build, shell checks, Node checks, toolchain validation, and system tests.
- [x] Independently reviewed the final production paths and corrected every identified blocking issue.

## Surprises and discoveries

- A direct authenticated sample invocation from the task sandbox could not initialize the in-process Codex app server because the sandbox intentionally denied its normal home boundary. The sanitized `0.144.4` fixture was therefore checked against the exact versioned event definitions and JSONL processor.
- Codex CLI `0.144.4` file-change events expose path, kind, and status but do not guarantee patch bodies. Relay handles the installed shape and supports optional cumulative patch or diff fields without assuming a newer upstream schema.
- The first independent review found that byte-based truncation could split a multibyte UTF-8 code point. The fan-out now backs up to a valid code-point boundary, with a production regression test.
- The initial Codex implementation run completed its edits and tests but the workflow finalizer failed to update the branch ref. The exact uploaded Git objects were reconstructed into the implementation commit without regenerating the code.

## Outcomes and retrospective

The output path is now structured and lifecycle-aware. Repeated cumulative human-renderer diffs are no longer part of Relay output. Progress remains live, the persisted artifact is produced by the same redacted fan-out, and both sinks receive byte-identical accepted content. Output limits are applied to useful normalized text rather than raw repeated renderer output.

The implementation is complete and independently validated. Future Codex event variants must be added explicitly against the installed binary's protocol rather than silently dumping raw events or applying text-level deduplication.
