# Agent Relay Operations

## Configure

Copy `.env.example` to `.env` and provide:

- a current repository-scoped `RUNNER_TOKEN`;
- the target repository URL;
- a unique runner name and labels;
- a strong relay bearer token;
- an absolute host path containing the existing `~/.codex` files.

Agent Relay does not set `CODEX_HOME`. The supplied directory is mounted at `/home/agent/.codex`.

## Start

    docker compose build
    docker compose up -d
    docker compose ps

The relay API is not published to the host. The runner reaches `http://agent-relay:8080` over the Compose network.

## Verify

    docker compose exec agent-relay /app/scripts/toolchain-smoke.sh
    docker compose exec agent-relay codex --version
    docker compose exec agent-relay curl -fsS http://localhost:8080/health

Recreate Agent Relay and confirm authentication remains available through the same mount:

    docker compose up -d --force-recreate agent-relay
    docker compose exec agent-relay codex --version

## Dispatch

Copy `examples/github-actions/agent-relay.yml` into the target repository. Dispatch it with the pull-request branch, active plan path, and execution mode.

The runner checks out the branch, calls Agent Relay, validates `.agent-relay/result.json`, removes the artifact, commits with the proposed message, and pushes using GitHub Actions credentials.

## Recovery

A container restart interrupts an active Codex process. The job is not resumed in memory. Dispatch a new workflow run against the current branch and active plan.

Checkout and push failures belong to GitHub Actions. Codex failures and result-contract failures appear in Agent Relay job state and persisted logs under the relay state volume.

## Credential rotation

Replace `RUNNER_TOKEN` with a current registration token when re-registering the runner. Rotate `AGENT_RELAY_TOKEN` in `.env` and recreate both services. Refresh browser login in the mounted host `~/.codex` directory when Codex authentication expires.
