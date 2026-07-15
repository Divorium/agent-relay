#!/usr/bin/env bash
set -euo pipefail

export RUNNER_TOKEN="${RUNNER_TOKEN:-placeholder}"
export RUNNER_REPOSITORY_URL="${RUNNER_REPOSITORY_URL:-https://github.com/owner/repository}"
export RUNNER_NAME="${RUNNER_NAME:-agent-relay-host-validation}"
export RUNNER_LABELS="${RUNNER_LABELS:-agent-relay}"
export AGENT_RELAY_TOKEN="${AGENT_RELAY_TOKEN:-placeholder-relay-token}"
export HOST_UID="${HOST_UID:-1000}"
export HOST_GID="${HOST_GID:-1000}"

docker info >/dev/null

auth_file="$(mktemp)"
trap 'rm -f "$auth_file"' EXIT
export HOST_CODEX_AUTH_FILE="${HOST_CODEX_AUTH_FILE:-$auth_file}"

docker compose config >/dev/null
docker build --tag agent-relay:host-validation .
docker run --rm --entrypoint /bin/bash agent-relay:host-validation /app/scripts/toolchain-smoke.sh
docker run --rm --entrypoint /bin/bash agent-relay:host-validation -lc '
  set -euo pipefail
  test "$(stat -c %a /var/lib/agent-relay)" = 700
  test "$(stat -c %a /home/agent/.codex)" = 700
  test ! -w /home/agent/.cargo
  test ! -w /home/agent/.rustup
  test ! -w /runner
  ! command -v ssh
  ! command -v dotnet
'

docker build --file Dockerfile.runner --tag agent-relay-runner:host-validation .
docker run --rm --entrypoint /bin/bash agent-relay-runner:host-validation -lc '
  set -euo pipefail
  node --version >/dev/null
  git --version >/dev/null
  test -x /entrypoint.sh
  test -x /runner/client.mjs
  test -x /runner/resolve-pr.mjs
  test -x /runner/finalize.sh
'
