# Agent Relay MVP

## Purpose / Big Picture

Agent Relay is a self-hosted bridge between a repository-scoped GitHub Actions runner and Codex CLI.

GitHub Actions checks out a pull-request branch on the self-hosted runner. The runner submits a job to Agent Relay over the shared Compose network. Agent Relay starts a fresh `codex exec` process in the same workspace. Codex implements the active plan, validates its work, and writes `.agent-relay/result.json`. The runner validates that result against the actual worktree, removes the artifact, commits with the proposed message, and pushes with GitHub Actions credentials.

The MVP supports one target repository per Docker Compose deployment. Agent Relay deliberately does not clone repositories, manage branches, hold GitHub credentials, or control project containers.

## Progress

- [x] Defined the simplified one-repository architecture and responsibility split.
- [x] Added repository instructions and TypeScript project foundation.
- [x] Implemented request, job, result, and error contracts.
- [x] Implemented contract validators and sensitive-data checks.
- [x] Implemented bearer authentication and workspace containment.
- [x] Implemented file-backed atomic job persistence and restart recovery.
- [x] Implemented one-active-job exclusion and request idempotency.
- [x] Implemented the asynchronous HTTP API.
- [x] Implemented controlled `codex exec` execution, timeout, output limit, redaction, and result validation.
- [x] Implemented the runner client and runner-owned commit/push workflow template.
- [x] Added Agent Relay and runner Dockerfiles plus shared Compose deployment.
- [x] Added the general-purpose development toolchain and explicit OpenSSH/.NET exclusions.
- [x] Added contract and HTTP/job-lifecycle integration tests.
- [x] Added repository CI for type checking, tests, Compose validation, image build, and toolchain verification.
- [x] Added operational documentation.
- [ ] Run the genuine repository-scoped runner with an operator `RUNNER_TOKEN` and authenticated mounted `~/.codex`.
- [ ] Record a genuine Codex execution that creates a result artifact and a runner-created commit on the same pull-request branch.
- [ ] Record the container-recreation authentication-persistence exercise in the operator environment.

The three remaining items require external operator credentials and a running Docker deployment. They are not replaced by claims or assumptions. All behavior that can be exercised without those credentials is covered by automated checks or controlled integration executors.

## Decisions

- One repository is supported per Compose deployment.
- Runner and Agent Relay run in the same Compose project and share the checkout volume.
- The runner owns checkout, GitHub credentials, commit, and push.
- Agent Relay owns validated job submission, persistence, process execution, and result reporting.
- Codex edits the worktree and writes the result artifact, but never commits or pushes.
- Agent Relay mounts the operator's standard `~/.codex`; it does not use `CODEX_HOME`.
- Agent Relay exposes a small create-and-poll HTTP API.
- One Codex job may run at a time in one deployment.
- Codex has no Docker socket, private application logs, or service lifecycle access.
- Public interfaces and repository-local commands are the only application validation surfaces in the MVP.
- The base image contains common runtimes and build tools but no OpenSSH or .NET SDK.
- Long-running/subagent-specific Codex behavior is treated as Codex functionality and is not a separate Agent Relay acceptance condition.

## Implemented Architecture

### Runner

The runner image and workflow are responsible for:

- repository-scoped self-hosted runner registration;
- checkout of the actual requested branch;
- local exclusion and cleanup of `.agent-relay/`;
- authenticated job creation and status polling;
- complete validation of `.agent-relay/result.json`;
- independent `git status --porcelain` verification;
- commit creation with the validated Codex message;
- push using GitHub Actions credentials.

Evidence:

- `Dockerfile.runner`
- `runner/entrypoint.sh`
- `runner/client.mjs`
- `examples/github-actions/agent-relay.yml`

### Agent Relay

Agent Relay provides:

- `GET /health`;
- `POST /v1/jobs`;
- `GET /v1/jobs/{jobId}`;
- bearer-token authentication for job routes;
- strict request validation;
- realpath-based workspace containment;
- file-backed job records with atomic writes;
- request-id idempotency;
- one-active-job exclusion including submission race protection;
- interrupted-state recovery after restart;
- fresh `codex exec` process per job;
- timeout and output-size limits;
- persisted output redaction;
- required result-file parsing and validation.

Evidence:

- `src/api/server.ts`
- `src/application/job-service.ts`
- `src/persistence/job-store.ts`
- `src/execution/codex-executor.ts`
- `src/contracts/validators.ts`
- `src/security/auth.ts`
- `src/security/workspace.ts`
- `src/security/redaction.ts`

### Codex result contract

The controlled artifact is `.agent-relay/result.json` and includes:

- `schemaVersion`;
- matching `requestId`;
- `status`;
- `shouldCommit`;
- conditional `commitMessage`;
- `summary`;
- concise validation records;
- blockers;
- limitations.

The validators reject unknown fields, unsupported schema versions, mismatched request IDs, invalid status combinations, multiline/control-character commit messages, oversized values, malformed validation records, and likely sensitive data.

The runner does not treat the result as proof of the actual worktree. It compares `shouldCommit` with `git status --porcelain` and deletes the result directory before staging.

Evidence:

- `src/contracts/result.ts`
- `src/contracts/validators.ts`
- `runner/client.mjs`
- `test/contracts.test.ts`
- `test/integration.test.ts`

## Development Toolchain

The Agent Relay image includes:

- Node.js 22 and npm;
- TypeScript 5.8.3;
- Codex CLI;
- Python 3, pip, and venv;
- Java 21 JDK;
- Rust through rustup, rustc, and Cargo;
- Go;
- Git and Git LFS;
- GCC/G++, Clang, Make, CMake, and pkg-config;
- Bash, curl, wget, jq;
- zip, unzip, tar, gzip, xz, zstd;
- rsync, file, coreutils, findutils, diffutils, and CA certificates.

The image explicitly excludes OpenSSH, .NET SDK, Docker Engine, project databases, Android SDK, and CUDA.

Evidence:

- `Dockerfile`
- `scripts/toolchain-smoke.sh`
- `.github/workflows/ci.yml`

## Docker and Identity Model

`compose.yml` creates:

- one runner service;
- one Agent Relay service;
- one shared workspace volume;
- one relay-state volume;
- one Compose network.

The service network is not marked internal because Agent Relay needs outbound access to Codex/OpenAI and configured public interfaces. No service port needs to be published for normal runner-to-relay communication.

Both images accept `USER_ID` and `GROUP_ID` build arguments. Compose forwards `HOST_USER_ID` and `HOST_GROUP_ID` so runner-created workspace files and the mounted `~/.codex` remain accessible to both services.

Evidence:

- `compose.yml`
- `Dockerfile`
- `Dockerfile.runner`
- `.env.example`

## Test Strategy and Evidence

### Contract and security tests

`test/contracts.test.ts` covers:

- valid and invalid create-job requests;
- unknown fields;
- absolute and traversing paths;
- Markdown plan-path requirement;
- valid and invalid result combinations;
- request-ID mismatch;
- commit-message validation;
- bearer authentication;
- configuration defaults and missing values;
- prompt requirements;
- secret redaction and sensitive-result rejection;
- workspace directory validation;
- persistence, index lookup, and interrupted-job recovery.

### Integration tests

`test/integration.test.ts` starts the real HTTP server with real JobService and JobStore instances and controlled executor doubles. It verifies:

- public health endpoint;
- authentication on job endpoints;
- HTTP job submission and polling to terminal state;
- execution exactly once for an idempotent repeated request;
- rejection of a second concurrent job while one remains active.

The controlled executor is used because a genuine Codex process requires operator authentication. The integration tests exercise the relay protocol, state machine, persistence, and HTTP boundary without fabricating a successful real Codex login.

### CI

`.github/workflows/ci.yml` performs:

1. `npm ci` and `npm run check` on Node.js 22;
2. `docker compose config` with non-secret placeholders;
3. Agent Relay image build;
4. required toolchain smoke test inside the built image;
5. assertions that `ssh` and `dotnet` are absent.

A CI result is authoritative only after GitHub Actions reports a conclusion for the current head SHA.

## Acceptance Audit

| # | Requirement | Implementation evidence | Automated evidence | State |
|---|---|---|---|---|
| 1 | One runner and one Agent Relay service | `compose.yml` | `docker compose config` CI | Implemented |
| 2 | `.env.example` contains `RUNNER_TOKEN`, no value | `.env.example` | repository inspection | Implemented |
| 3 | Runner registration | `runner/entrypoint.sh` | requires live token | Implemented, live verification pending |
| 4 | Private Compose communication | `compose.yml` | Compose CI | Implemented |
| 5 | Shared workspace | `compose.yml` | Compose CI; integration workspace tests | Implemented |
| 6 | Standard `~/.codex`, no `CODEX_HOME` | `compose.yml`, `Dockerfile` | image/config inspection | Implemented |
| 7 | Login persists after recreation | bind mount in `compose.yml` | operator exercise required | Implemented, live verification pending |
| 8 | Relay auth | `auth.ts`, `server.ts` | contract + integration tests | Verified |
| 9 | Workspace containment | `workspace.ts` | contract tests | Verified |
| 10 | One active job | `job-service.ts` | integration concurrency test | Verified |
| 11 | Codex reads plan/instructions | `prompt.ts`, `codex-executor.ts` | prompt contract test | Verified structurally |
| 12 | Shared changes visible to runner | shared volume design | genuine deployment required | Implemented, live verification pending |
| 13 | Valid result with commit message | validators + prompt | contract tests | Verified |
| 14 | Invalid/sensitive result rejected | validators | contract tests | Verified |
| 15 | No GitHub token/SSH key in Codex | Compose/workflow boundary | repository inspection | Verified structurally |
| 16 | Relay performs no Git operations | source architecture | source inspection | Verified structurally |
| 17 | Actual PR branch checkout | workflow template | live workflow required | Implemented, live verification pending |
| 18 | Runner independently verifies worktree | `runner/client.mjs` | code-path inspection | Implemented |
| 19 | Result removed before staging | client + workflow | code-path inspection | Implemented |
| 20 | Runner commits and pushes | workflow template | live workflow required | Implemented, live verification pending |
| 21 | Same PR branch receives commit | workflow template | live workflow required | Pending live verification |
| 22 | Workflow concurrency | workflow template | workflow syntax/inspection | Implemented |
| 23 | Restart marks active work interrupted | `job-store.ts`, `job-service.ts` | contract test | Verified |
| 24 | New run continues from branch and plan | GitHub workflow model | live workflow required | Implemented, live verification pending |
| 25 | No Docker/log/lifecycle access | Compose and image | repository/image inspection | Verified structurally |
| 26 | Public-interface access | non-internal relay network | live endpoint depends on target | Implemented |
| 27 | Unavailable logs reported as limitations | prompt + result schema | prompt/result contract tests | Verified structurally |
| 28 | Secrets not exposed | redaction + result validators | contract tests | Verified |
| 29 | Complete implementation/revision/finalization loop | workflow modes and prompt | operator end-to-end exercise | Pending live verification |

No item marked pending should be described as proven until its external exercise is recorded.

## Idempotence and Recovery

- Repeating the same request ID with identical immutable fields returns the existing job.
- Reusing it with different fields returns `REQUEST_ID_CONFLICT`.
- A second request while another is active returns `JOB_ALREADY_RUNNING`.
- The submission guard closes the asynchronous workspace-resolution race window.
- Running jobs found after restart are marked interrupted.
- Agent Relay never attempts Git recovery.
- Recovery is a new GitHub Actions run against the current branch and active plan.

## Operations

Operational instructions are maintained in `docs/operations/README.md` and cover:

- configuration;
- Compose startup;
- runner registration and token rotation;
- Codex authentication mount;
- workspace cleanup;
- interrupted job recovery;
- result-artifact troubleshooting;
- upgrades and toolchain validation.

## Outcomes and Remaining External Evidence

The repository implementation is complete for all behavior that can be deterministically exercised without operator credentials. Contract tests, integration tests, Compose validation, and image checks replace unavailable external flow segments.

The following evidence must still be collected in the deployment environment:

1. self-hosted runner registers with the configured repository;
2. mounted `~/.codex` authenticates a real `codex exec`;
3. Codex modifies the shared checkout and writes a valid result;
4. the runner commits and pushes those changes to the same PR branch;
5. recreating Agent Relay preserves authentication while interrupting an in-flight process.

Until those exercises pass, the PR should remain draft.

## Revision Notes

- 2026-07-13: Defined the architecture and simplified Git ownership.
- 2026-07-13: Added result handoff, toolchain, Docker packaging, APIs, validators, persistence, runner integration, and operations.
- 2026-07-13: Added contract tests, HTTP/job-lifecycle integration tests, CI, and a point-by-point evidence audit.
