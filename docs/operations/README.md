# Agent Relay Operations

All commands in this document run on the Docker host. They are never task-agent validation commands and must not be executed by Codex or by the containerized GitHub runner.

## Configure

Copy `.env.example` to `.env` and provide:

- a current repository-scoped `RUNNER_TOKEN` when registering a new runner;
- the target repository URL;
- a unique runner name and labels;
- a strong Relay bearer token;
- the absolute host path to Codex `auth.json`;
- the host UID and GID that own the authentication file and runner workspace.

Configure the same Relay bearer token as the repository Actions secret `AGENT_RELAY_TOKEN`. The Compose runner service does not receive this token; the workflow supplies it only to the client step.

Only `auth.json` is mounted into the Codex home directory, read-only. Do not mount the complete host `~/.codex` directory. The launcher removes all generated agent-home content except `auth.json` before every execution.

## Start and verify

```bash
docker compose build
docker compose up -d
docker compose ps
docker compose exec agent-relay /app/scripts/toolchain-smoke.sh
docker compose exec --user agent agent-relay /usr/local/bin/codex --version
docker compose exec --user agent agent-relay /usr/local/bin/codex login status
docker compose exec agent-relay curl -fsS http://localhost:8080/health
```

Verify the user and filesystem boundary:

```bash
docker compose exec agent-relay sh -lc '
set -eu
test "$(id -un)" = relay
test "$(stat -c %a /var/lib/agent-relay)" = 700
sudo -H -u agent -- test -r /home/agent/.codex/auth.json
sudo -H -u agent -- test ! -w /home/agent/.codex/auth.json
'
```

## Install and dispatch the workflow

Use `.github/workflows/agent-relay.yml` in this repository or copy `examples/github-actions/agent-relay.yml` into another target repository.

Manual dispatch requires:

- `pr_number`: the selected pull request number;
- `plan_path`: a regular, non-symlink Markdown file directly under `docs/exec-plans/active/`.

There is no branch input, execution-mode input, or model result contract. `.agent/PLANS.md` defines reusable plan behavior and the selected active plan is the sole task instruction.

Before checkout, `/runner/resolve-pr.mjs` rejects the pull request unless it exists, is open, is not a draft, belongs to the target repository, and has valid head ref and SHA values. Checkout uses the API-derived head SHA. Commit and push target the API-derived head ref.

The runner derives an idempotency key from repository, workflow-run, and run-attempt identifiers when available. It is not included in the Codex prompt.

## Credentials

Checkout uses the selected token with `persist-credentials: false`. The workflow verifies that no authorization header, credential helper, or credential-bearing remote remains before invoking Relay.

Credential lifetime is step-scoped:

- the GitHub API token is supplied only to pull-request resolution;
- the Relay bearer token is supplied only to the Relay client step;
- the push token is supplied only to finalization.

For normal source changes the workflow uses the job's `github.token` for checkout and finalization. When the plan may change `.github/workflows/`, configure `AGENT_RELAY_PUSH_TOKEN` with permission to update repository contents and workflow files.

## Logs and outcomes

The `Run Codex through Agent Relay` step pipes runner-client stdout and stderr through `tee`:

- output is visible in the live GitHub Actions log;
- the same output is uploaded as the `agent-relay-output` artifact;
- `$GITHUB_OUTPUT` is reserved for the runner-derived commit message.

The complete redacted Codex process log is stored under the Relay-only state volume.

Codex does not write a result file. Relay sets the technical outcome from the process:

- exit code `0` → `completed`;
- non-zero exit or spawn failure → `failed`;
- deadline exceeded → `timed_out`;
- in-flight job recovered after restart → `interrupted`.

A task-level blocker is recorded only in the active ExecPlan. The item remains unchecked and includes cause, impact, evidence, and unblock condition. Codex continues unaffected work. The plan remains active until every item is completed.

## Recovery

A Relay container restart interrupts an active Codex process. The job is not resumed in memory. Dispatch a new run against the current pull request and active plan.

Do not dispatch another run while preserving unpushed changes from a failed finalization step. A new checkout may clean the shared workspace.

Inspect the latest persisted Codex log as the Relay user:

```bash
docker compose exec agent-relay sh -lc '
latest=$(find /var/lib/agent-relay/logs -type f -name "*.log" -printf "%T@ %p\n" | sort -n | tail -1 | cut -d" " -f2-)
echo "Latest log: $latest"
test -n "$latest" && tail -n 200 "$latest"
'
```

## Credential rotation

- Replace `RUNNER_TOKEN` when re-registering the runner.
- Rotate `AGENT_RELAY_TOKEN` in `.env` and the repository Actions secret, then recreate the Relay service.
- Refresh host `auth.json` when `codex login status` reports that it is not logged in.
- Rotate `AGENT_RELAY_PUSH_TOKEN` independently when configured.
