#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project="agent-relay-state-test-${GITHUB_RUN_ID:-local}-$$"
temp_dir="$(mktemp -d)"
auth_file="${temp_dir}/auth.json"
compose=(docker compose --project-name "${project}" --file "${repo_root}/compose.yml")

cleanup() {
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "${temp_dir}"
}
trap cleanup EXIT

printf '{}\n' > "${auth_file}"
export AGENT_RELAY_TOKEN="integration-test-token"
export HOST_CODEX_AUTH_FILE="${auth_file}"
export HOST_UID="$(id -u)"
export HOST_GID="$(id -g)"
export RUNNER_TOKEN="unused"
export RUNNER_REPOSITORY_URL="https://github.com/example/example"

wait_for_health() {
  local container_id
  container_id="$("${compose[@]}" ps --quiet agent-relay)"
  test -n "${container_id}"

  for _ in $(seq 1 90); do
    case "$(docker inspect --format '{{.State.Health.Status}}' "${container_id}")" in
      healthy)
        return 0
        ;;
      unhealthy)
        "${compose[@]}" logs agent-relay
        return 1
        ;;
    esac
    sleep 2
  done

  "${compose[@]}" logs agent-relay
  return 1
}

assert_runtime_state() {
  "${compose[@]}" exec --no-TTY agent-relay sh -eu -c '
    agent_uid="$(id -u agent)"
    agent_gid="$(id -g agent)"
    test "$(id -u)" = "${agent_uid}"
    test "$(stat -c %u /var/lib/agent-relay)" = "${agent_uid}"
    test "$(stat -c %g /var/lib/agent-relay)" = "${agent_gid}"
    test "$(stat -c %a /var/lib/agent-relay)" = "700"
    test -d /var/lib/agent-relay/jobs
    test -w /var/lib/agent-relay/jobs
    test "$(cat /var/lib/agent-relay/preserved-state)" = "preserved"
  '
}

"${compose[@]}" build agent-relay agent-relay-state-init
"${compose[@]}" run --rm --no-deps --user 0:0 --entrypoint sh agent-relay -eu -c '
  mkdir -p /var/lib/agent-relay/jobs
  printf preserved > /var/lib/agent-relay/preserved-state
  chown -R 0:0 /var/lib/agent-relay
  chmod 0700 /var/lib/agent-relay
'

"${compose[@]}" up --detach agent-relay
wait_for_health
assert_runtime_state

"${compose[@]}" restart agent-relay
wait_for_health
assert_runtime_state
