# Agent Relay

Agent Relay is a self-hosted bridge between a repository-scoped GitHub Actions runner and Codex CLI.

A GitHub Actions workflow resolves an open, ready pull request, checks out its exact head revision without persisting credentials, and asks Agent Relay to execute Codex in the shared workspace. Codex edits the repository, runs commands available in the packaged task environment, and keeps the active ExecPlan current. Relay derives the technical job outcome from the child process. The runner decides from Git whether changes exist, derives a commit message from the active plan, and pushes through a finalization-only credential.

## Components

Each deployment contains:

- `runner`: the single self-hosted GitHub Actions runner, registered with the `agent-relay` label, which owns checkout, commit, push, and GitHub credentials;
- `agent-relay`: authenticates requests, launches Codex, enforces execution limits, persists redacted process output, and owns technical job state;
- `Codex`: follows `.agent/PLANS.md`, implements the selected active ExecPlan, updates its living state, and runs repository-local validation.

The runner and Relay are separate containers sharing one workspace volume. Relay runs as the `relay` user. Codex runs as the separate `agent` user. Relay state is mode `0700`. Only the host Codex `auth.json` file is mounted into the agent home, read-only. Generated agent-home state is removed before every execution.

## Workflow inputs

The production workflow is `.github/workflows/agent-relay.yml`. Manual dispatch accepts only:

- `pr_number`: the open pull request to update;
- `plan_path`: a regular, non-symlink Markdown file directly under `docs/exec-plans/active/`.

The workflow does not accept an arbitrary branch, a secondary execution mode, a result schema, or commit intent. `.agent/PLANS.md` defines reusable plan semantics and the selected active ExecPlan is the sole task authority.

Before checkout, `/runner/resolve-pr.mjs` verifies that the pull request exists, is open, is not a draft, belongs to the configured target repository, and has valid head ref and SHA values. Checkout uses the API-derived head SHA. Finalization pushes to the API-derived head ref.

## Living ExecPlan

An incomplete item remains unchecked. A real blocker is marked `[blocked]` in `Progress` with:

- cause;
- impact;
- evidence;
- concrete unblock condition.

Codex continues all unaffected work. A blocker is plan documentation only; it is not a Codex result or Relay job status. A plan with any unchecked or `[blocked]` item remains active.

## Execution outcome

Codex does not write a control or result artifact. Relay classifies execution from observable runtime facts:

- zero exit code: `completed`;
- non-zero exit or spawn failure: `failed`;
- execution deadline: `timed_out`;
- recovered in-flight job after restart: `interrupted`.

The runner independently uses `git status --porcelain` to determine whether work exists. A terminal `completed` job with a clean worktree is treated as a failed implementation run, not as a successful no-op. When changes exist, the runner derives the commit message from the first level-one heading in the active ExecPlan, with `Apply active ExecPlan` as the fallback.

## Security boundary

- Checkout uses `persist-credentials: false` and verifies that no credential helper, authorization header, or credential-bearing remote remains before Codex starts.
- CI and Agent Relay workflows run only on the existing `[self-hosted, agent-relay]` runner and reject fork-origin pull requests before executing repository code.
- The Relay bearer token is supplied only to the workflow client step; it is not part of the runner service environment.
- The push token exists only in the finalization step and is consumed through a temporary askpass helper.
- Codex receives no GitHub token, runner registration token, Relay token, Docker socket, or Relay state.
- The packaged service always launches the root-owned wrapper as the fixed `agent` user; command and user overrides are not configuration inputs.
- The wrapper exclusively defines the final tool environment and clears generated agent-home state before each run while preserving the read-only `auth.json` mount.
- The permissions profile denies the shared workspace root, Relay application directory, Relay home, and agent home; it re-allows writes only in the selected repository and reads only from that repository's Git metadata.
- Image permissions independently prevent the `agent` user from reading `/app` and `/home/relay`.

## Configuration

Copy `.env.example` to `.env`, configure `AGENT_RELAY_TOKEN` with the same value as the repository Actions secret, and provide:

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

## Automated validation

Mandatory pull-request CI runs on the existing containerized self-hosted runner:

```bash
npm ci
npm run check
```

This suite covers type safety, application and runner behavior, failure paths, shell syntax, workflow contracts, packaging structure, Dockerfile `COPY` sources, Compose isolation contracts, and the instruction boundary. It does not claim to build or run Docker images because the runner container has no Docker daemon or socket.

## Docker integration validation

The original Compose, image-build, toolchain, excluded-tool, and runner-image checks are retained in:

```bash
bash scripts/host-validation.sh
```

Run this script explicitly on the Docker host when packaging or deployment files change. No GitHub workflow routes to the host, and this manual gate is not reported as automated CI coverage.

Operational setup, dispatch, recovery, logs, and credential rotation are documented in `docs/operations/README.md`.

## ExecPlans

Active:

- `docs/exec-plans/active/2026-07-15-audit-codex-context.md`

Completed:

- `docs/exec-plans/completed/2026-07-13-agent-relay-mvp.md`
- `docs/exec-plans/completed/2026-07-13-ready-pr-gate.md`
