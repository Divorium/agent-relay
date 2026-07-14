# Agent Relay

Agent Relay is a self-hosted bridge between a repository-scoped GitHub Actions runner and Codex CLI.

A GitHub Actions workflow resolves a specific pull request through the GitHub API, verifies that it is open and ready for review, and checks out the exact head revision returned by GitHub. The runner asks Agent Relay to execute Codex in the shared workspace. Codex edits and validates the repository and writes a structured result file. The runner validates that result, creates a commit when the Git worktree changed, and pushes it to the API-derived pull-request branch.

## Status

The MVP includes:

- a Node.js 22 and TypeScript relay service;
- authenticated asynchronous job creation and polling APIs;
- one active Codex execution per deployment;
- persistent file-backed job state and interrupted-job recovery;
- controlled `codex exec` process execution;
- a versioned Codex-to-runner result contract;
- a repository-scoped GitHub Actions runner image and client;
- a pull-request readiness gate backed by the GitHub API;
- Docker Compose packaging with a shared workspace;
- CI, contract tests, integration tests, workflow-gate tests, and image toolchain checks.

## Architecture

Each deployment supports one target repository and contains two services:

- `runner`: a repository-scoped GitHub Actions self-hosted runner;
- `agent-relay`: the HTTP service and Codex CLI environment.

The services share one Docker network and one workspace volume. The runner owns checkout, GitHub credentials, commit, and push. Agent Relay never clones repositories, chooses branches, stores GitHub credentials, or pushes changes.

```text
Operator or automation
   -> workflow_dispatch with PR number and ExecPlan path
   -> GitHub API readiness resolution
   -> self-hosted runner: checkout exact PR head SHA
   -> Agent Relay: codex exec in shared workspace
   -> Codex: .agent-relay/result.json
   -> runner: validate worktree, commit when changed, and push to PR head ref
   -> review
```

## Pull-request readiness rule

The production workflow is `.github/workflows/agent-relay.yml`. It is started with:

- `pr_number`: the pull request to update;
- `plan_path`: the active ExecPlan inside the pull-request workspace;
- `mode`: `implement`, `revise`, or `finalize`.

Before checkout, `/runner/resolve-pr.mjs` retrieves the pull request from the GitHub API. Execution is allowed only when all of these conditions are true:

- the pull request exists;
- `state == open`;
- `draft == false`;
- the head repository is the configured target repository;
- the head ref and SHA are valid.

The workflow does not accept an arbitrary branch. Checkout uses the head SHA returned by the API, while commit and push use the head ref returned by the same response. Draft, closed, missing, and foreign-repository pull requests fail before checkout and before Agent Relay is invoked.

## Responsibility split

### Runner

The runner:

- registers with the configured target repository;
- resolves the selected pull request through the GitHub API;
- checks out the resolved head SHA;
- prepares and locally excludes `.agent-relay/`;
- submits and polls an Agent Relay job;
- validates the complete result contract;
- verifies the actual Git worktree independently;
- removes the relay artifact before staging;
- decides whether a commit is needed exclusively from `git status --porcelain`;
- commits with the validated Codex-proposed message when repository changes exist;
- pushes to the resolved pull-request head ref.

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
- never runs `git commit`, `git push`, or equivalent commit-publishing commands;
- does not receive GitHub credentials;
- writes `.agent-relay/result.json` before exit.

## GitHub log output

The workflow runs the runner client through `tee`. Everything written by `runner/client.mjs` to stdout or stderr is visible in the GitHub Actions step log and stored in the `agent-relay-output` artifact.

The client writes control data such as `commit_message` directly to `$GITHUB_OUTPUT`, so normal log output cannot corrupt GitHub step outputs. The current client emits Agent Relay job-state changes, the validated Codex summary, and validation results. A future relay-side Codex-output streaming implementation can write to the same stdout channel without another workflow redesign.

The complete redacted Codex process output is currently persisted under the Agent Relay state volume and is not yet streamed through the polling API.

## Result contract

Codex writes `.agent-relay/result.json`:

```json
{
  "schemaVersion": 1,
  "requestId": "owner-repo-run-123-attempt-1",
  "status": "completed",
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

A completed result must include a valid one-line `commitMessage`; a blocked result must omit it. The runner validates the schema version, matching request ID, allowed status combination, commit-message format, field sizes, and sensitive-data rules. The result does not contain `shouldCommit`: the runner determines whether a commit is needed exclusively from the actual Git worktree. The artifact is deleted before staging and must never enter a repository commit.

## Authentication and access boundaries

- `RUNNER_TOKEN` is a short-lived registration token used only when the runner has no existing registration.
- GitHub Actions job credentials remain in the runner.
- Agent Relay uses a separate `AGENT_RELAY_TOKEN` for runner-to-relay authentication.
- The operator's existing `~/.codex` directory is mounted at `/home/agent/.codex`.
- `CODEX_HOME` is not set.
- Codex receives no GitHub token, Docker socket, or service lifecycle controls.

The workflow uses `github.token` for normal repository updates. If an ExecPlan may modify `.github/workflows/`, configure the repository secret `AGENT_RELAY_PUSH_TOKEN` with permission to update repository contents and workflow files. The checkout step automatically prefers that secret and falls back to `github.token` when it is absent.

## Configuration

Copy `.env.example` to `.env` and provide:

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

`HOST_CODEX_DIR` must point to the actual Codex directory containing `auth.json` and `config.toml`. `HOST_UID` and `HOST_GID` should match its owner.

## Build and validation

```bash
npm ci
npm run check
docker compose config
docker build -t agent-relay:local .
docker build -f Dockerfile.runner -t agent-relay-runner:local .
docker run --rm --entrypoint /bin/bash agent-relay:local /app/scripts/toolchain-smoke.sh
```

## Run

```bash
cp .env.example .env
docker compose up --build -d
```

Copy `examples/github-actions/agent-relay.yml` into a target repository when Agent Relay is deployed separately. Registration, recovery, dispatch, and troubleshooting instructions are in `docs/operations/README.md`.

## Active plans

- `docs/exec-plans/active/2026-07-13-agent-relay-mvp.md`
- `docs/exec-plans/active/2026-07-13-ready-pr-gate.md`
