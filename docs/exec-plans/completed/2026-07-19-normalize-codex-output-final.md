# Normalize, stream, and harden Codex output

This completed ExecPlan follows `.agent/PLANS.md` and resolves issue #33 independently from Docker provisioning.

## Outcome

Agent Relay now consumes structured `codex exec --json` output, incrementally frames strict UTF-8 JSONL, normalizes lifecycle events, applies streaming redaction once, streams progress live to GitHub Actions, and persists the same accepted bytes as the `agent-relay-output` artifact transcript.

The implementation removes repeated cumulative human-renderer diffs without heuristic text deduplication and hardens the complete transport against workflow-command interpretation, unbounded buffering, oversized protocol records, no-newline diagnostics, retained cumulative lifecycle payloads, slow Writable sinks, malformed input, and children that do not exit after graceful termination.

## Implemented contracts

- Codex runs with `exec --json`.
- JSONL stdout and diagnostic stderr are framed independently.
- JSONL framing is byte-oriented, incremental, fatal-UTF-8, linear in received bytes, and bounded by a separate protocol-record budget.
- Valid cumulative Codex records larger than 1 MiB are accepted; over-limit records fail early.
- Every physical output line, including empty lines and truncation notices, is Relay-prefixed and cannot begin with an untrusted `::` workflow command.
- C0 control characters and DEL are visibly encoded.
- Normalized segments are UTF-8-safe and bounded to 32 KiB.
- Output admission is asynchronous and bounded by 256 KiB/128 KiB high/low watermarks.
- Child stdout and stderr are paused before raw chunks enter the callback-ordered input queue and resumed only after processing and low-watermark recovery.
- Node Writable callbacks and `drain` are explicitly awaited; `Function.length` is not used as a capability test.
- Live and transcript sinks receive byte-identical normalized, redacted, accepted bytes.
- Stderr without newlines is emitted through bounded UTF-8-safe continuation chunks.
- Active cumulative lifecycle state retains length and SHA-256 prefix metadata instead of prior complete payloads.
- Completed-item and event replay tracking is bounded and lifecycle state is cleared after transcript truncation.
- Syntax validation continues in bounded form after ordinary output truncation.
- Exactly one Relay-owned truncation marker is emitted.
- Transcript create, write, sync, or close failure fails execution.
- Timeout, parser, normalizer, stream, live-output, and transcript failures share one idempotent termination controller.
- Every paused current or queued source is resumed exactly once on success, failure, or discard.
- Post-spawn terminal failure requests graceful process-group termination once and escalates once after the configured delay if the child remains alive.
- Escalation timers are cleared on child close and cannot signal a later reused process identifier.
- The first semantic failure remains authoritative after termination and finalization.

## Validation

Production and integration coverage includes:

- adversarial JSONL and UTF-8 chunk boundaries;
- multi-megabyte valid and over-limit records;
- command, file-change, reasoning, assistant, todo, warning, error, unknown-event, and stderr lifecycle rendering;
- structural workflow-command neutralization for multiline and empty-line content;
- byte-identical live and transcript output;
- cross-chunk secret redaction;
- one-write child bursts against a deliberately slow Writable;
- hard queue bounds using actual parser and executor paths;
- multi-megabyte no-newline stderr;
- bounded lifecycle and replay state across thousands of items;
- malformed JSONL and invalid stderr UTF-8;
- output truncation followed by syntax errors or nonzero exit;
- transcript write/sync/close failure;
- timeout and forced process-group termination;
- parser and transcript failures against children that ignore graceful termination;
- concurrent terminal failures producing one graceful request and one escalation;
- graceful child close cancelling later escalation;
- current and queued paused sources resuming exactly once;
- workspace, credential, process-group, finalizer, commit-decision, runtime, shell, Node, toolchain, and system regressions.

## Review result

Three independent review passes identified and corrected:

1. workflow-command injection, missing backpressure, undersized JSONL record limits, unbounded stderr, and unbounded lifecycle state;
2. false queue-bound evidence, quadratic large-record framing, incomplete physical-line ownership, and unreliable Writable arity inference;
3. a paused current raw source and missing forced escalation after non-timeout terminal failures.

No unresolved P1 or P2 defect remains in the reviewed branch implementation.

## Merge and operational gates

The pull-request Codex workflow executes the trusted deployed runtime under `/srv/github-runner/storage/agent-relay/runner`, not executor code from the PR checkout. Pre-merge acceptance therefore depends on the repository's normal self-hosted CI check succeeding on the exact PR head that contains this completed plan.

The PR must not merge while that check is absent, pending, or failing. This transient check state is intentionally recorded by GitHub rather than by another documentation commit that would create a new unvalidated head.

After merge, run the standard `./update.sh` deployment and then perform one operational Codex smoke run to confirm live normalized output and the bounded artifact on the deployed runtime.

## Final acceptance

- [x] Structured JSONL transport implemented.
- [x] Actions-safe physical-line rendering implemented.
- [x] Bounded asynchronous raw and normalized output pipelines implemented.
- [x] Linear bounded protocol framing implemented.
- [x] Explicit Writable completion and backpressure implemented.
- [x] Bounded diagnostics and lifecycle state implemented.
- [x] Idempotent terminal escalation and paused-source release implemented.
- [x] Production-path regression tests added.
- [x] Independent review found no unresolved P1/P2 issue.
- Pre-merge gate: GitHub CI on the exact PR head must be `success`.
- Post-merge gate: deploy with `./update.sh` and run one real Codex smoke workflow.
