# Agent Relay MVP

## Purpose / Big Picture

Agent Relay is a self-hosted bridge between a repository-scoped GitHub Actions runner and Codex CLI.

GitHub Actions checks out the requested pull-request branch. The runner submits a job to Agent Relay over the Compose network. Agent Relay starts a fresh non-interactive Codex process in the shared workspace. Codex implements the active plan, validates its work, and writes `.agent-relay/result.json`. The runner independently validates that artifact and the actual Git worktree, removes the artifact, commits with the validated message, and pushes to the same branch using GitHub Actions credentials.

The MVP supports one target repository per Docker Compose deployment.

## Progress

- [x] Defined the one-repository architecture and responsibility split.
- [x] Implemented the Node.js 22 and TypeScript relay service.
- [x] Implemented authenticated create-and-poll job APIs.
- [x] Implemented strict request and result contracts.
- [x] Implemented workspace containment, request idempotency, and one-active-job exclusion.
- [x] Implemented atomic file-backed state and restart recovery.
- [x] Implemented controlled Codex process execution, byte-based output limits, redaction, timeout, and process termination.
- [x] Added explicit Codex automation permissions: global approval mode `never` and sandbox `danger-full-access`.
- [x] Implemented the runner client and runner-owned Git flow.
- [x] Fixed the workflow request ID to avoid the invalid `owner/repository` slash.
- [x] Removed direct branch interpolation from shell commands and validate the branch with `git check-ref-format`.
- [x] Made runner registration reusable after an ordinary container restart.
- [x] Added Agent Relay and runner images plus Compose packaging.
- [x] Added the required development toolchain and removed OpenSSH and .NET.
- [x] Added contract, HTTP, lifecycle, child-process, runner-client, workflow-template, and runner-entrypoint tests.
- [x] Added CI for TypeScript, tests, Compose, both images, Codex CLI flags, toolchain contents, and excluded tools.
- [ ] Run the deployment with an operator-owned repository registration token and authenticated `~/.codex`.
- [ ] Record a genuine Codex execution followed by a runner-created commit and push to the same PR branch.
- [ ] Record Agent Relay recreation with the same mounted `~/.codex` and verify authentication remains usable.

The remaining items require external credentials and a running deployment. They are not treated as proven by controlled tests.

## Decisions

- One repository is supported per Compose deployment.
- The runner owns checkout, GitHub credentials, commit, and push.
- Agent Relay owns validation, persistence, process execution, and result reporting.
- Codex edits the shared checkout but does not commit or push.
- The operator's standard `~/.codex` is mounted directly; `CODEX_HOME` is not set.
- One Codex job may run at a time.
- Agent Relay uses a fresh `codex exec` process for every job.
- Codex receives `danger-full-access` inside the dedicated Agent Relay container so it can edit the workspace, run tests, and reach public services.
- The container deliberately has no Docker socket, GitHub job credential, deploy key, or private application-log mount.
- The runner uses an existing `.runner` registration after restart and only requires `RUNNER_TOKEN` for initial registration or recreation.
- OpenSSH and .NET are excluded from the Agent Relay image.

## Implemented Architecture

### Runner

The runner image and workflow provide:

- repository-scoped self-hosted runner registration;
- registration reuse after restart;
- checkout of the requested branch;
- branch-name validation;
- local exclusion and cleanup of `.agent-relay/`;
- authenticated job creation and bounded polling;
- strict independent result validation;
- sensitive-data rejection;
- independent `git status --porcelain` verification;
- commit creation and push to the validated target branch.

Evidence:

- `Dockerfile.runner`
- `runner/entrypoint.sh`
- `runner/client.mjs`
- `examples/github-actions/agent-relay.yml`
- `test/runner-entrypoint.test.sh`
- `test/runner-client.test.ts`

### Agent Relay

Agent Relay provides:

- `GET /health`;
- `POST /v1/jobs`;
- `GET /v1/jobs/{jobId}`;
- bearer authentication for job routes;
- fixed-shape request validation;
- realpath-based workspace containment;
- atomic file-backed job records;
- request-ID idempotency;
- submission-race protection and one-active-job exclusion;
- interrupted-state recovery;
- a fresh Codex process per job;
- explicit approval and sandbox flags;
- timeout with `SIGTERM`, `SIGKILL`, and waiting for process close;
- byte-based output limits and persisted redaction;
- mandatory result parsing and validation.

Evidence:

- `src/api/server.ts`
- `src/application/job-service.ts`
- `src/persistence/job-store.ts`
- `src/execution/codex-executor.ts`
- `src/contracts/validators.ts`
- `src/security/auth.ts`
- `src/security/workspace.ts`
- `src/security/redaction.ts`
- `test/executor.integration.test.ts`
- `test/integration.test.ts`

### Result contract

`.agent-relay/result.json` contains:

- `schemaVersion`;
- matching `requestId`;
- `status`;
- `shouldCommit`;
- conditional one-line `commitMessage`;
- `summary`;
- validation records;
- blockers;
- limitations.

Relay and runner validators reject unknown fields, unsupported versions, request-ID mismatches, invalid status combinations, malformed validation records, oversized values, control characters, and likely sensitive data. The runner compares `shouldCommit` with the actual worktree and removes the artifact before staging.

## Docker and Toolchain

`compose.yml` creates one runner, one Agent Relay service, one shared workspace volume, one state volume, and one network. `HOST_UID` and `HOST_GID` are forwarded to both images. `HOST_CODEX_DIR` is mounted at `/home/agent/.codex`.

The Agent Relay image includes Node.js 22, npm, TypeScript, Codex CLI, Python, Java 21, Rust, Go, Git, Git LFS, GCC/G++, Clang, Make, CMake, pkg-config, Bash, curl, wget, jq, archive tools, rsync, file, findutils, and diffutils. CI verifies the exact Codex parser form used by the executor and confirms that `ssh` and `dotnet` are absent.

## Test Strategy

`npm run check` covers:

- request and result contracts;
- error codes and strict unknown-field rejection;
- authentication and configuration;
- workspace containment;
- sensitive-data handling;
- persistence and restart recovery;
- HTTP create-and-poll lifecycle;
- idempotent retries and concurrent-job exclusion;
- real child-process execution;
- explicit Codex argument order;
- timeout only after child termination;
- runner-client request/result/Git integration;
- safe workflow request ID and branch handling;
- runner initial registration, restart reuse, and missing-token failure.

Repository CI additionally covers:

- `docker compose config`;
- Agent Relay image build;
- toolchain smoke test;
- exact Codex automation flag parsing;
- absence of OpenSSH and .NET;
- runner image build.

A CI result is authoritative only when it belongs to the current head SHA.

## Acceptance Audit

| Area | Automated state | External state |
|---|---|---|
| API authentication and validation | Verified | None |
| Workspace containment | Verified | None |
| Idempotency and one active job | Verified | None |
| Persistence and interrupted recovery | Verified | None |
| Codex process flags and lifecycle | Verified with real child process and image parser smoke | Real authenticated model call pending |
| Result contract and redaction | Verified in Relay and runner | None |
| Runner registration behavior | Verified with controlled entrypoint test | Real repository registration pending |
| Runner client and Git worktree checks | Verified with real temporary Git repository | Real GitHub job credential pending |
| Workflow request ID and branch safety | Verified | Real workflow dispatch pending |
| Compose and both images | Verified by CI | Host deployment pending |
| Mounted `~/.codex` | Structurally verified | Authentication and recreation exercise pending |
| Same-branch commit and push | Structurally verified | End-to-end push pending |

## Idempotence and Recovery

- Repeating the same request ID with identical immutable fields returns the existing job.
- Reusing it with different fields returns `REQUEST_ID_CONFLICT`.
- A second request while another job is active returns `JOB_ALREADY_RUNNING`.
- Jobs left in `accepted` or `running` are marked `interrupted` after restart.
- A timed-out process must close before the active-job lock is released.
- Recovery is a new GitHub Actions run against the current branch and active plan.
- An ordinary runner-container restart reuses `.runner`; container recreation requires a new registration token.

## Outcomes and Remaining External Evidence

All behavior that can be deterministically exercised without operator credentials is implemented and covered by automated checks or controlled integration tests.

The deployment owner must still record:

1. successful self-hosted runner registration;
2. a real authenticated `codex exec` using the mounted `~/.codex`;
3. a valid result produced after modifying the shared checkout;
4. a runner-created commit and push to the same PR branch;
5. successful reuse of Codex authentication after Agent Relay recreation.

The plan remains active until those deployment-specific exercises are recorded.

## Revision Notes

- 2026-07-13: Defined the architecture and responsibility boundaries.
- 2026-07-13: Implemented Relay, runner, Docker packaging, contracts, persistence, process execution, and operations.
- 2026-07-13: Added unit and integration coverage plus repository CI.
- 2026-07-13: Review fixed runner restart behavior, OpenSSH inheritance, workflow request ID and branch injection, independent runner validation, polling bounds, default read-only Codex execution, Codex global-flag ordering, and byte-accurate output limiting.
