# Agent Relay

Agent Relay is a self-hosted bridge between a repository-scoped GitHub Actions runner and Codex CLI.

A GitHub Actions workflow resolves an open, ready pull request, checks out its exact head revision without persisting credentials, and asks Agent Relay to execute Codex in the shared workspace. Codex edits the repository, validates the work, keeps the active ExecPlan current, and writes a minimal evidence file. Relay derives the technical job outcome. The runner decides from Git whether changes exist, derives a commit message from the active plan, and pushes through a finalization-only credential.

## Components

Each deployment contains:

- `runner`: resolves the pull request, owns checkout, commit, push, and GitHub credentials;
- `agent-relay`: authenticates requests, launches Codex, enforces execution limits, validates the result, and persists technical job state;
- `Codex`: implements the active ExecPlan, updates its living state, and records validation evidence.

The runner and Relay share one workspace volume. Relay runs as the `relay` user. Codex runs as the separate `agent` user. Relay state is mode `0700`. Only the host Codex `auth.json` file is mounted into the agent home, read-only.

## Workflow inputs

The production workflow is `.github/workflows/agent-relay.yml`. Manual dispatch accepts only:

- `pr_number`: the open pull request to update;
- `plan_path`: the active ExecPlan in that pull request.

The workflow does not accept an arbitrary branch or a secondary execution mode. The active ExecPlan is the single task authority.

Before checkout, `/runner/resolve-pr.mjs` verifies that the pull request:

- exists and is open;
- is not a draft;
- belongs to the configured target repository;
- has valid head ref and SHA values.

Checkout uses the API-derived head SHA. Finalization pushes to the API-derived head ref.

## Living ExecPlan

An incomplete item remains unchecked. A real blocker is marked `[blocked]` in `Progress` with:

- cause;
- impact;
- evidence;
- concrete unblock condition.

Codex continues all unaffected work. A blocker is plan documentation only; it is not a result or Relay job status. A plan with any unchecked or `[blocked]` item remains active.

## Result contract

Codex writes `.agent-relay/result.json` with exactly:

```json
{
  "schemaVersion": 1,
  "summary": "Implemented the requested behavior and updated the active plan.",
  "validation": [
    {
      "command": "npm test",
      "status": "passed",
      "exitCode": 0,
      "details": "All tests passed."
    }
  ]
}
```

The result contains evidence only. It does not contain a request identifier, task status, blocker list, limitations, commit intent, or commit message. Relay sets `completed` only when the Codex process exits successfully and the result validates. Process failure, timeout, invalid output, and interruption are Relay-owned technical states.

The runner independently uses `git status --porcelain` to determine whether work exists. When changes exist, it derives the commit message from the first level-one heading in the active ExecPlan, with `Apply active ExecPlan` as the fallback.

## Security boundary

- Checkout uses `persist-credentials: false` and verifies that no credential helper, authorization header, or credential-bearing remote remains before Codex starts.
- The push token exists only in the finalization step and is consumed through a temporary askpass helper.
- Agent Relay uses a separate bearer token for runner-to-relay requests.
- Codex receives no GitHub token, runner registration token, Relay token, Docker socket, or Relay state.
- Codex receives an allowlisted runtime environment rather than the Relay process environment.
- The host Codex `auth.json` file is mounted read-only; host configuration, history, sessions, logs, and rules are not mounted.
- Codex shell commands run under a restricted permissions profile that denies access to the Codex home directory.

## Configuration

Copy `.env.example` to `.env` and provide:

```env
RUNNER_TOKEN=
RUNNER_REPOSITORY_URL=https://github.com/owner/repository
RUNNER_NAME=agent-relay-runner
RUNNER_LABELS=agent-relay
AGENT_RELAY_TOKEN=
HOST_CODEX_AUTH_FILE=/absolute/path/to/.codex/auth.json
HOST_UID=1000
HOST_GID=1000
CODEX_TIMEOUT_MS=21600000
MAX_OUTPUT_BYTES=10000000
```

`HOST_UID` and `HOST_GID` must match the owner of the authentication file and the runner workspace.

## Build and run

```bash
npm ci
npm run check
docker compose config
docker build -t agent-relay:local .
docker build -f Dockerfile.runner -t agent-relay-runner:local .
docker run --rm --entrypoint /bin/bash agent-relay:local /app/scripts/toolchain-smoke.sh
cp .env.example .env
docker compose up --build -d
```

Operational setup, dispatch, recovery, logs, and credential rotation are documented in `docs/operations/README.md`.

## ExecPlans

Active:

- `docs/exec-plans/active/2026-07-15-audit-codex-context.md`

Completed:

- `docs/exec-plans/completed/2026-07-13-agent-relay-mvp.md`
- `docs/exec-plans/completed/2026-07-13-ready-pr-gate.md`
