# Agent Relay Operations

## Configure

Copy `.env.example` to `.env` and provide:

- a current repository-scoped `RUNNER_TOKEN` when registering a new runner;
- the target repository URL;
- a unique runner name and labels;
- a strong relay bearer token;
- the absolute host path containing the actual `~/.codex` files.

Agent Relay does not set `CODEX_HOME`. The supplied directory is mounted at `/home/agent/.codex`. Verify that it contains readable `auth.json` and `config.toml` files and is writable by the configured host UID and GID.

`RUNNER_TOKEN` is only a short-lived registration token. A recreated runner container needs a current token unless the runner registration files are persisted separately.

## Start

```bash
docker compose build
docker compose up -d
docker compose ps
```

The relay API is not published to the host. The runner reaches `http://agent-relay:8080` over the Compose network.

## Verify

```bash
docker compose exec agent-relay /app/scripts/toolchain-smoke.sh
docker compose exec agent-relay codex --version
docker compose exec agent-relay codex login status
docker compose exec agent-relay curl -fsS http://localhost:8080/health
```

Verify the mounted Codex directory:

```bash
docker compose exec agent-relay sh -lc '
set -eu
id
test -r "$HOME/.codex/auth.json"
test -r "$HOME/.codex/config.toml"
touch "$HOME/.codex/.write-test"
rm "$HOME/.codex/.write-test"
'
```

## Install the workflow

Use `.github/workflows/agent-relay.yml` in this repository or copy `examples/github-actions/agent-relay.yml` into another target repository.

The workflow requires only:

```yaml
permissions:
  contents: write
  pull-requests: read
```

For normal source changes it uses the job's `github.token`. If Codex may modify `.github/workflows/`, configure a repository secret named `AGENT_RELAY_PUSH_TOKEN` with permission to update repository contents and workflow files. The workflow prefers this secret and otherwise falls back to `github.token`.

## Dispatch

Start the workflow with:

- `pr_number`: the selected pull request number;
- `plan_path`: the active ExecPlan path in that pull request;
- `mode`: `implement`, `revise`, or `finalize`.

The workflow does not accept a branch input. Before checkout, `/runner/resolve-pr.mjs` retrieves the pull request through the GitHub API and rejects it unless:

- it exists;
- it is open;
- `draft == false`;
- its head repository matches the target repository;
- its head ref and SHA are valid.

Checkout uses the API-derived head SHA. Commit and push target the API-derived head ref. Rejected requests fail before checkout and before `/runner/client.mjs` is invoked.

## GitHub logs

The `Run Codex through Agent Relay` step pipes runner-client stdout and stderr through `tee`:

- output is visible in the live GitHub Actions log;
- the same output is uploaded as the `agent-relay-output` artifact;
- `$GITHUB_OUTPUT` is reserved for validated control values such as `commit_message`.

The current client prints job-state transitions, the validated Codex summary, and validation results. Raw stdout/stderr is streamed as bytes, with a bounded live prefix and a final tail when needed. Treat the live log and archive as sensitive execution data: they are not redacted and may contain arbitrary process output.

## Recovery

A restart of the Agent Relay container interrupts an active Codex process. The job is not resumed in memory. Dispatch a new workflow run against the current pull request and active plan.

Do not dispatch another run while preserving unpushed changes from a failed finalize step. A new checkout may clean the shared workspace.

Checkout and push failures belong to GitHub Actions. Codex failures and result-contract failures appear in Agent Relay job state and persisted logs under `/var/lib/agent-relay/logs`.

Inspect the latest persisted Codex log:

```bash
docker compose exec agent-relay sh -lc '
latest=$(find /var/lib/agent-relay/logs -type f -name "*.log" -printf "%T@ %p\n" | sort -n | tail -1 | cut -d" " -f2-)
echo "Latest log: $latest"
test -n "$latest" && tail -n 200 "$latest"
'
```

## Credential rotation

- Replace `RUNNER_TOKEN` with a current registration token when re-registering the runner.
- Rotate `AGENT_RELAY_TOKEN` in `.env` and recreate both services.
- Refresh Codex authentication in the mounted host `~/.codex` directory when `codex login status` reports that it is not logged in.
- Rotate `AGENT_RELAY_PUSH_TOKEN` independently when that optional secret is configured.
