# Agent Relay

Agent Relay is a self-hosted bridge between a repository-scoped GitHub Actions runner and Codex CLI.

A GitHub Actions workflow checks out a pull-request branch on the self-hosted runner. The runner asks Agent Relay to execute Codex in the same shared workspace. Codex edits and validates the repository and writes a structured result file. The runner independently validates the result and worktree, creates a commit, and pushes it to the same pull-request branch using GitHub Actions credentials.

## Status

The MVP implementation is present on this branch. It includes:

- a Node.js 22 and TypeScript relay service;
- validated asynchronous job creation and polling APIs;
- one active Codex execution per deployment;
- persistent file-backed job state and interrupted-job recovery;
- controlled `codex exec` process execution;
- the versioned Codex-to-runner result contract;
- a repository-scoped GitHub Actions runner image and client;
- Docker Compose packaging with a shared workspace;
- CI, contract tests, integration tests, and image toolchain checks.

A real end-to-end run still requires operator-owned runtime credentials: `RUNNER_TOKEN`, a valid mounted `~/.codex`, and a target repository workflow invocation.

## Architecture

Each MVP deployment supports one target repository and contains two services:

- `runner`: a repository-scoped GitHub Actions self-hosted runner;
- `agent-relay`: the HTTP service and Codex CLI environment.

The services share:

- one Docker network for runner-to-relay communication;
- one workspace volume containing the checkout prepared by GitHub Actions.

The runner owns checkout, commit, push, and GitHub credentials. Agent Relay never clones repositories, chooses branches, stores GitHub credentials, or pushes changes.

```text
ChatGPT
   -> pull request and active plan
   -> GitHub Actions workflow
   -> self-hosted runner: checkout
   -> Agent Relay: codex exec in shared workspace
   -> Codex: .agent-relay/result.json
   -> runner: validate worktree, commit and push
   -> ChatGPT review
```

## Responsibility split

### Runner

The runner:

- registers with the configured target repository;
- checks out the requested pull-request branch;
- prepares and locally excludes `.agent-relay/`;
- submits and polls an Agent Relay job;
- validates the complete result contract;
- verifies the actual Git worktree independently;
- removes the relay artifact before staging;
- commits with the validated Codex-proposed message;
- pushes with GitHub Actions job credentials.

### Agent Relay

Agent Relay:

- exposes `GET /health`, `POST /v1/jobs`, and `GET /v1/jobs/{jobId}`;
- requires bearer authentication for job APIs;
- accepts only validated, fixed-shape requests;
- rejects workspace traversal and paths outside the shared root;
- enforces one active job per deployment;
- persists job records atomically;
- marks incomplete running jobs as interrupted after restart;
- starts a fresh `codex exec` process per job;
- applies timeout and output-size limits;
- redacts sensitive output before persistence;
- validates the required result JSON before completing the job.

### Codex

Codex:

- reads `AGENTS.md` and the active ExecPlan;
- implements and validates the requested change;
- updates the active plan;
- does not commit or push;
- does not receive GitHub credentials;
- writes `.agent-relay/result.json` before exit.

## Result contract

Codex writes:

```text
.agent-relay/result.json
```

Example:

```json
{
  "schemaVersion": 1,
  "requestId": "owner-repo-run-123-attempt-1",
  "status": "completed",
  "shouldCommit": true,
  "commitMessage": "Implement the active ExecPlan",
  "summary": "Implemented the requested behavior and updated the active plan.",
  "validation": [
    {
      "command": "npm test",
      "status": "passed",
      "exitCode": 0,
      "details": "All tests passed."
    }
  ],
  "blockers": [],
  "limitations": []
}
```

The runner validates the schema version, matching request ID, allowed status combination, commit-message format, field sizes, sensitive-data rules, and correspondence between `shouldCommit` and the actual worktree. The artifact is deleted before staging and must never enter the repository commit.

## Codex development toolchain

The Agent Relay image includes a general-purpose development environment:

- Node.js 22 and npm;
- Python 3 with `pip` and `venv`;
- Java 21 JDK;
- Rust through `rustup`, including `rustc` and Cargo;
- Go;
- Git and Git LFS;
- GCC/G++, Clang, Make, CMake, and `pkg-config`;
- Bash, curl, wget, jq;
- zip, unzip, tar, gzip, xz, zstd;
- rsync, file, GNU coreutils, findutils, diffutils, and CA certificates.

OpenSSH, .NET SDK, Docker Engine, database servers, Android SDK, and CUDA are deliberately excluded.

## Authentication and access boundaries

- `RUNNER_TOKEN` is used only during self-hosted runner registration and removed from the runner process environment before the runner starts accepting jobs.
- GitHub Actions job credentials remain in the runner.
- Agent Relay uses a separate `AGENT_RELAY_TOKEN` for runner-to-relay API authentication.
- The operator's existing `~/.codex` directory is mounted directly into the Agent Relay user's `~/.codex` path.
- `CODEX_HOME` is not set.
- Codex receives no Docker socket, private application logs, or service lifecycle controls.
- Codex may use repository-local commands and public interfaces reachable from its container.

## Configuration

Copy `.env.example` to `.env` and provide at least:

```env
RUNNER_TOKEN=
RUNNER_REPOSITORY_URL=https://github.com/owner/repository
RUNNER_NAME=agent-relay-runner
RUNNER_LABELS=agent-relay
AGENT_RELAY_TOKEN=
HOST_CODEX_DIR=/absolute/path/to/.codex
HOST_UID=1000
HOST_GID=1000
CODEX_TIMEOUT_MS=21600000
MAX_OUTPUT_BYTES=10000000
```

`HOST_UID` and `HOST_GID` should match the owner of the mounted `~/.codex` directory and workspace files.

## Build and validation

```bash
npm ci
npm run check
docker compose config
docker build -t agent-relay:local .
docker run --rm --entrypoint /bin/bash agent-relay:local /app/scripts/toolchain-smoke.sh
```

Repository CI performs TypeScript checking, unit and integration tests, Compose validation, image build, required-tool checks, and confirmation that OpenSSH and .NET are absent.

## Run

```bash
cp .env.example .env
docker compose up --build -d
```

The target repository can use `examples/github-actions/agent-relay.yml` as its workflow template. Operational registration, recovery, and troubleshooting instructions are in `docs/operations/README.md`.

## Known external verification boundary

The repository can verify contracts, HTTP behavior, process orchestration through controlled integration executors, Compose validity, and image contents. A genuine GitHub-runner-to-Codex-to-push flow cannot be completed without the operator's repository registration token and authenticated `~/.codex`; it must be run in the deployment environment and recorded as end-to-end evidence.

## Active plan

`docs/exec-plans/active/2026-07-13-agent-relay-mvp.md`
