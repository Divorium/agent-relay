# Stream raw Codex output and execute accepted plans

## Purpose / Big Picture

Agent Relay must make Codex execution observable directly in GitHub Actions and must use a pull request's native draft state as the plan approval control.

A plan is prepared in a draft pull request. Creating the draft, pushing commits to it, and editing the plan while it remains a draft must not start Codex. Changing the pull request from Draft to Ready for review starts one Agent Relay execution for the current pull-request head. If the pull request is changed back to Draft, the plan can be revised. Changing it to Ready for review again starts a new execution against the new head and the current plan. A commit pushed by Codex must not recursively start another execution.

During execution, the combined stdout and stderr produced by `codex exec` must be forwarded as ordinary process output to the GitHub Actions step. Do not introduce JSONL mode, semantic event conversion, command summaries, or a separate model-facing event protocol. Preserve the process output as observed by Agent Relay, except for the existing secret-redaction boundary. Keep `$GITHUB_OUTPUT` reserved for validated control values such as the final commit message.

GitHub Actions has a practical log-size boundary. The runner must keep a complete output archive for upload as a workflow artifact. The live step may print output until a configured live-log budget is reached, then suppress the middle while retaining a rolling tail. At job completion it must print the final tail with a clear truncation notice. If no archive path is available, retain only the rolling tail and print that tail at completion.

## User-visible flow

1. ChatGPT or an operator creates a branch containing one active ExecPlan under `docs/exec-plans/active/` and opens a draft pull request.
2. No Relay job runs while the pull request is a draft.
3. The operator marks the pull request Ready for review.
4. `.github/workflows/agent-relay.yml` runs from the `ready_for_review` event, revalidates the pull request through the GitHub API, checks out the exact current head SHA, resolves the one changed active ExecPlan, and starts Relay in `implement` mode.
5. The GitHub Actions log displays raw Codex stdout/stderr while Codex works. The complete output is written to an artifact file.
6. The runner independently validates `.agent-relay/result.json` and the worktree, then commits and pushes to the pull-request head branch.
7. The Codex push does not start another Relay run because the production workflow does not subscribe to `synchronize`.
8. To run an amended plan, the operator changes Ready to Draft, edits the plan, and changes Draft to Ready again. The new event creates a new request ID and runs against the current head SHA.
9. `workflow_dispatch` remains available for explicit retry, recovery, `revise`, and `finalize` runs.

## Current repository state

The current implementation already provides these boundaries and they must remain intact:

- `runner/resolve-pr.mjs` retrieves the pull request through the GitHub API and rejects missing, closed, draft, and foreign-head pull requests before checkout and before Relay invocation.
- `.github/workflows/agent-relay.yml` checks out the API-derived head SHA and `runner/finalize.sh` pushes to the API-derived head ref.
- GitHub credentials remain in the runner. Agent Relay and Codex do not receive them.
- `runner/client.mjs` validates the final result contract and writes only the validated commit message to `$GITHUB_OUTPUT`.
- `.agent-relay/result.json` is removed before staging and must never be committed.
- Agent Relay currently buffers process output in memory and writes a redacted log only when the child closes. The runner currently polls job state and prints only state changes plus the final summary and validation records.

The workflow in this pull request adds the `ready_for_review` trigger and automatic active-plan resolution. Treat that workflow behavior as an implemented bootstrap requirement: preserve it, test it, and refine it only where the implementation work requires a correction.

## Scope

Implement all of the following in this repository:

- incremental, bounded-memory persistence of the combined raw stdout/stderr stream;
- an authenticated raw-output read contract that supports offsets and reconnects without translating output into structured events;
- runner-side tailing that writes bytes to the GitHub Actions step as they arrive;
- a complete local archive file for `actions/upload-artifact`;
- live-log budgeting with middle suppression and a final rolling tail;
- preservation of the existing result contract, Git responsibility split, timeout behavior, output redaction, and one-active-job rule;
- removal of the existing total-output truncation so the canonical archive contains the complete redacted process output;
- tests for the workflow approval cycle, output transport, archive behavior, reconnect, truncation, and final commit control;
- README and operations documentation reflecting the actual behavior.

Do not add WebSockets, Server-Sent Events, a message broker, a database, an SDK dependency, or a Codex JSON event parser. Use Node.js built-ins and the existing HTTP service.

## Required design

### 1. Child-process capture and durable raw log

Refactor `src/execution/codex-executor.ts` so it no longer accumulates all output in `outputChunks` before writing the log.

Open the job output file before starting Codex and append data while the process is running. Observe stdout and stderr independently, but append each received chunk immediately in the order in which Node delivers the callbacks. The resulting file is the canonical combined raw process log. Exact ordering between operating-system stdout and stderr pipes cannot be stronger than callback arrival order; document this rather than inventing ordering metadata in the visible output.

The output file must remain mode `0600`. Writes must apply backpressure instead of allowing unbounded pending writes. A slow disk must not cause unbounded memory growth. Ensure the file is flushed and closed after both streams have ended and the child process has closed, including timeout and failure paths.

Do not use `codex exec --json`. Keep the current ordinary `codex exec` invocation and forward its normal output.

The current `MAX_OUTPUT_BYTES` behavior truncates the canonical Relay log and conflicts with the required complete archive. Remove that total-output truncation from `CodexExecutor`, `AppConfig`, Compose configuration, `.env.example`, documentation, and affected tests. The live GitHub budget is a runner presentation limit, not a Relay capture limit. Relay may fail explicitly on filesystem errors such as exhausted disk space, but it must not silently discard the remainder of an otherwise running process.

### 2. Streaming redaction boundary

Keep the existing rule that secrets must not be persisted or returned by Relay. Raw output in this plan means no semantic parsing or reformatting; it does not remove the current redaction boundary.

Adapt `src/security/redaction.ts` for incremental output. Secret patterns may be divided across adjacent chunks, so applying the current function independently to each chunk is insufficient. Implement a bounded overlap buffer that retains enough trailing text to recognize supported secret patterns across chunk boundaries, emits the safe prefix, and flushes the final remainder when both streams close. Do not retain the complete log in memory.

The persisted log, the HTTP output response, the runner archive, and the GitHub live log must all contain the same redacted byte sequence. Never stream unredacted bytes first and redact them later.

If preserving arbitrary binary bytes conflicts with text redaction, treat Codex output as UTF-8 text, use a streaming `TextDecoder`, preserve incomplete multibyte sequences between chunks, and replace invalid terminal sequences deterministically. Cover this behavior with tests.

### 3. Raw output HTTP contract

Extend the Relay API with an authenticated endpoint:

    GET /v1/jobs/{jobId}/output?offset={nonNegativeInteger}&limit={positiveInteger}

The endpoint returns `text/plain; charset=utf-8`. The body is an unmodified slice of the persisted redacted output beginning at `offset`, up to the server-enforced maximum response size. It must not wrap output in JSON.

Return these response headers:

- `x-agent-relay-offset`: the requested effective offset;
- `x-agent-relay-next-offset`: the byte offset immediately after the returned body;
- `x-agent-relay-output-complete`: `true` only when the job is terminal and `next-offset` is at the current end of the output file;
- `x-agent-relay-job-status`: the current job status.

Contract rules:

- reject malformed, negative, or unsafe integer offsets and limits with `INVALID_REQUEST`;
- cap the requested limit using a server constant, initially 64 KiB;
- return an empty body with the same headers when no new bytes are currently available;
- return `JOB_NOT_FOUND` for an unknown job;
- never allow the client to supply a filesystem path;
- authorize this route with the existing Relay bearer token;
- allow repeated reads from the same offset so reconnect is idempotent;
- do not delete the log when the first reader completes.

A short poll is sufficient. Do not hold an HTTP response open indefinitely. The runner may poll at a small bounded interval when the endpoint returns no new data.

### 4. Job metadata and persistence

Keep `JobRecord.outputPath` internal to Relay. Do not expose it in a new client-controlled request field.

The output endpoint must resolve the job through `JobService`/`JobStore`, then read only that job's known output file. Reading an output file while it is being appended must be supported. Handle a just-created job whose output file does not yet exist as an empty output, not as a server error.

Restart behavior remains explicit: accepted or running jobs become `interrupted`. Their persisted redacted output remains readable and `x-agent-relay-output-complete` becomes true after recovery marks the job terminal.

### 5. Runner raw tailing

Refactor `runner/client.mjs` so it starts tailing immediately after job creation. Preserve status polling only where needed to determine terminal failures and to validate the final result; do not wait for terminal state before reading output.

Maintain a byte offset. Repeatedly call the output endpoint, write every returned body to the configured archive, advance only to the validated `x-agent-relay-next-offset`, and retry from the last confirmed offset after transient request failures. Reject a response if offsets move backwards, skip bytes, do not match the body byte length, or contain malformed headers.

Use raw byte handling rather than converting a response to JSON. Write live bytes with `process.stdout.write`. Do not prefix normal process chunks with Relay labels and do not transform newlines. Relay's own lifecycle messages may remain separate concise lines before or after raw output.

The runner must not write any raw output to `$GITHUB_OUTPUT`. Keep the existing final `appendFile(githubOutput, commit_message...)` path and result validation separate from output transport.

### 6. Archive and GitHub live-log budget

Add runner configuration with validated positive integer values:

- `AGENT_RELAY_OUTPUT_POLL_INTERVAL_MS`, default 250;
- `AGENT_RELAY_OUTPUT_READ_BYTES`, default 65536 and no greater than the Relay response cap;
- `AGENT_RELAY_LIVE_OUTPUT_BYTES`, default 8 MiB;
- `AGENT_RELAY_LIVE_OUTPUT_TAIL_BYTES`, default 256 KiB;
- `AGENT_RELAY_OUTPUT_ARCHIVE_PATH`, optional filesystem path supplied by the workflow.

When an archive path is present:

1. create or truncate it before the first output read;
2. append every returned raw chunk, including bytes not printed live;
3. print output live until `AGENT_RELAY_LIVE_OUTPUT_BYTES` has been written to stdout;
4. after the budget is exhausted, stop printing the middle and maintain a rolling tail of the last `AGENT_RELAY_LIVE_OUTPUT_TAIL_BYTES` bytes;
5. at completion, print one clear truncation notice followed by the final tail;
6. avoid printing tail bytes twice when the complete output never exceeded the budget.

When no archive path is present, do not discard an unbounded stream into memory. Maintain only the rolling tail and print that tail at completion. This is the fallback requested for environments without artifact storage.

The production workflow must set `AGENT_RELAY_OUTPUT_ARCHIVE_PATH` to a file in `RUNNER_TEMP` and upload that file with `actions/upload-artifact@v4` under a stable name. Artifact upload remains `if: always()` and must not determine whether the Codex result is valid. If artifact upload itself fails, the workflow result should reflect the action's normal failure semantics, while the final tail remains visible in the preceding step log.

Remove reliance on `tee` as the complete archive, because stdout may intentionally omit the middle. The client owns the complete archive file.

### 7. Completion and failure ordering

Do not validate `.agent-relay/result.json` until all output through the terminal end offset has been read or a clearly reported output-transport failure has occurred.

Required ordering:

1. create job;
2. tail output while job is accepted/running;
3. observe a terminal job status;
4. continue reading until `x-agent-relay-output-complete: true`;
5. close the archive and print the final tail if truncation occurred;
6. fail for Relay terminal failures, output transport failures, or blocked Codex results;
7. validate `.agent-relay/result.json` and the Git worktree;
8. remove `.agent-relay`;
9. write the validated commit message to `$GITHUB_OUTPUT` only when changes exist.

A failed output stream must not be silently treated as success merely because `result.json` exists. Bounded retries are required. Report the last confirmed byte offset in the error so an operator can diagnose the missing section.

### 8. Workflow approval behavior

Preserve and test the production workflow behavior introduced with this plan:

- `pull_request` subscribes only to `ready_for_review`;
- `workflow_dispatch` remains available with `pr_number`, `plan_path`, and `mode` inputs;
- same-repository head validation occurs before assigning untrusted repository content to Codex;
- the existing API resolver still verifies that the pull request is open and not draft;
- automatic runs derive the pull-request number from `github.event.pull_request.number`;
- automatic runs find exactly one added, modified, or renamed Markdown file under `docs/exec-plans/active/` between the event base SHA and resolved head SHA;
- automatic runs use `implement` mode;
- manual runs validate the supplied active-plan path and mode;
- no `synchronize` trigger is added;
- concurrency remains grouped by repository and pull-request number with `cancel-in-progress: false` so a second Draft-to-Ready transition queues rather than modifying the same workspace concurrently;
- each run uses `repository_id`, `run_id`, and `run_attempt` in the request ID, so a second approval is a new Relay request;
- checkout and push continue to use API-derived refs.

The job-level condition must skip fork pull requests before a self-hosted runner is assigned. The resolver remains a second server-side/API-backed check.

### 9. Documentation

Update `README.md` and `docs/operations/README.md` to explain:

- Draft is the editable plan state;
- Draft to Ready starts implementation;
- Ready to Draft to Ready starts a new implementation of the amended plan;
- normal pushes do not trigger Relay;
- manual dispatch is the recovery path;
- raw stdout/stderr is shown in the Actions log;
- the complete redacted output is uploaded as an artifact;
- after the live-log budget, the middle is available only in the artifact and the final tail is printed;
- `$GITHUB_OUTPUT` remains control-only;
- this plan requires an `AGENT_RELAY_PUSH_TOKEN` if Codex changes workflow files.

Keep `examples/github-actions/agent-relay.yml` behavior aligned with the production workflow. If a copied example cannot depend on repository-local helper files, keep the request-resolution logic self-contained in the workflow or document every file that must be copied.

## Implementation sequence

1. Add focused tests for incremental redaction and output-file appends before changing the executor.
2. Refactor the executor to persist redacted output incrementally with bounded memory and proper stream/file closure.
3. Add output-slice reading to the application layer and the authenticated HTTP route.
4. Add API contract tests covering offsets, headers, concurrent append/read, empty reads, terminal completion, restart recovery, and authentication.
5. Refactor the runner client to tail raw output, validate offsets, retry transient failures, and preserve final result handling.
6. Implement archive, live budget, rolling tail, and no-archive fallback behavior.
7. Update the production and example workflows to supply the archive path and upload the complete archive rather than a `tee` capture.
8. Expand workflow tests for `ready_for_review`, second approval, no `synchronize`, automatic plan resolution, fork skipping, and manual dispatch.
9. Update README and operations documentation.
10. Run the full automated and container validation suite.
11. Exercise a real draft pull request through Draft to Ready, observe live output before Codex exits, verify the artifact, allow Codex to push, then repeat Ready to Draft to Ready with an amended plan.
12. Audit every acceptance item against code and captured evidence. Fix all review findings before moving the plan to `completed/`.

## Tests and validation

### Unit and integration tests

Add or update tests to prove:

- the executor writes output before the child exits;
- large output does not accumulate in memory;
- stdout and stderr chunks both reach the canonical log;
- UTF-8 split across chunks is reconstructed correctly;
- supported secrets split across chunks are redacted before persistence;
- timeout and nonzero-exit paths close and retain the output log;
- output reads validate offset and limit;
- a reader can observe bytes appended after an earlier empty read;
- repeated reads from one offset return the same bytes;
- terminal completion is false until the final file length is consumed;
- interrupted jobs expose their retained output as complete;
- the runner prints bytes before job completion;
- reconnect resumes from the last confirmed offset without gaps or duplicates;
- malformed offset headers fail the run;
- the archive contains the complete output;
- output below the live budget is not duplicated;
- output above the budget produces a beginning, a truncation notice, and the final tail in stdout while the archive remains complete;
- no-archive mode retains bounded memory and prints only the final tail;
- raw output cannot alter the commit message written to `$GITHUB_OUTPUT`;
- result validation and worktree checks remain unchanged;
- a draft PR is rejected;
- `ready_for_review` is the only automatic trigger;
- `Ready -> Draft -> Ready` produces a second distinct workflow run/request ID;
- a Codex push does not trigger another run;
- automatic plan resolution fails for zero or multiple changed active plans;
- workflow dispatch still accepts valid manual modes and paths.

### Repository checks

Run and record:

    npm ci
    npm run check
    docker compose config
    docker build --tag agent-relay:plan-validation .
    docker build --file Dockerfile.runner --tag agent-relay-runner:plan-validation .
    docker run --rm --entrypoint /bin/bash agent-relay:plan-validation /app/scripts/toolchain-smoke.sh

Also run a controlled integration test with a fake child process that emits delayed stdout and stderr, including multibyte text and a secret divided across chunks. The test must read from the HTTP endpoint while the process is still active and prove that output is available before child completion.

### Live acceptance test

The feature is not complete until evidence records this exact sequence:

1. open a draft PR containing exactly one changed active ExecPlan;
2. confirm no Agent Relay workflow starts while it is draft or while draft commits are pushed;
3. mark it Ready for review;
4. confirm exactly one workflow starts automatically;
5. confirm raw command output becomes visible in the GitHub Actions log before Codex exits;
6. confirm the full output artifact contains content omitted from the live middle after the configured budget;
7. confirm the final tail is visible in the live log;
8. confirm the validated Codex commit is pushed to the same PR branch;
9. confirm that push does not start another Agent Relay run;
10. change the PR back to Draft, amend the plan, and mark it Ready again;
11. confirm a second run starts with a different request ID and the current head SHA;
12. confirm `.agent-relay/` and secrets are absent from all commits and uploaded output is redacted.

## Acceptance criteria

The work is accepted only when all of these statements have code and test or live evidence:

- Draft PR activity never invokes Relay.
- Every Draft-to-Ready transition invokes one new run for the current PR head.
- Codex pushes do not recursively invoke Relay.
- GitHub displays ordinary Codex stdout/stderr before process completion.
- Output is transported without JSONL or semantic event conversion.
- Existing secret redaction occurs before persistence or transport.
- The runner can reconnect by byte offset without gaps or duplicates.
- Relay does not silently truncate total process output; the complete redacted output is available in the uploaded artifact when an archive path is configured.
- After the live budget is exceeded, the live log shows a truncation notice and final tail while the middle remains in the artifact.
- Without an archive path, memory remains bounded and only the final tail is printed.
- Raw output never enters `$GITHUB_OUTPUT`.
- The final result contract remains authoritative for commit behavior.
- GitHub credentials remain unavailable to Relay and Codex.
- The full repository validation suite passes on the final head SHA.

## Progress

- [x] Confirmed the existing ready-PR resolver already rejects draft, closed, missing, and foreign pull requests.
- [x] Added the plan-approval trigger and automatic plan resolution to the plan pull request workflow.
- [ ] Refactor raw output persistence.
- [ ] Add the output HTTP contract.
- [ ] Tail raw output in the runner.
- [ ] Add full archive and live-tail behavior.
- [ ] Complete automated coverage.
- [ ] Update documentation and example workflow.
- [ ] Complete the real Draft-to-Ready-to-Draft-to-Ready acceptance exercise.
- [ ] Perform the final point-by-point review and resolve every finding.

## Decision Log

- Use GitHub's native `ready_for_review` activity as explicit plan approval.
- Do not subscribe to `synchronize`; normal commits, including Codex pushes, must not trigger implementation.
- Keep manual workflow dispatch as recovery and explicit mode selection.
- Transport ordinary redacted stdout/stderr as raw text. Do not use Codex JSON output or semantic events.
- Use authenticated offset reads over the existing HTTP API rather than WebSockets or SSE.
- Persist output incrementally and let the runner create the complete workflow artifact.
- Keep `$GITHUB_OUTPUT` control-only.
- Remove the old total-output cap; use a live prefix plus final tail when an archive exists, and only a bounded final tail when no archive exists.

## Surprises & Discoveries

- Record implementation discoveries here as they occur. Include differences between expected Codex CLI output behavior and observed behavior, operating-system pipe ordering, GitHub log limits, or artifact behavior.

## Outcomes & Retrospective

Complete this section only after all automated and live acceptance evidence exists. Summarize the final architecture, any deviations from this plan, operational limits, and remaining work. Move this same file to `docs/exec-plans/completed/` only after the acceptance audit has no unresolved item.
