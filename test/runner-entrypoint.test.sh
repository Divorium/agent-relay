#!/usr/bin/env bash
set -euo pipefail

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
ENTRYPOINT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/runner/entrypoint.sh"

make_runtime() {
  local directory="$1"
  mkdir -p "$directory"
  cat > "$directory/config.sh" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" > config.args
SCRIPT
  cat > "$directory/run.sh" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${RUNNER_TOKEN:-}" ]]; then
  echo "RUNNER_TOKEN leaked to runner" >&2
  exit 1
fi
printf '%s\n' "started" > run.marker
SCRIPT
  chmod +x "$directory/config.sh" "$directory/run.sh"
}

FIRST="$ROOT/first"
make_runtime "$FIRST"
(
  cd "$FIRST"
  RUNNER_TOKEN=registration-token \
  RUNNER_REPOSITORY_URL=https://github.com/owner/repository \
  RUNNER_NAME=agent-relay-test \
  RUNNER_LABELS=agent-relay,test \
  bash "$ENTRYPOINT"
)
grep -q -- '--url https://github.com/owner/repository' "$FIRST/config.args"
grep -q -- '--token registration-token' "$FIRST/config.args"
grep -q -- '--name agent-relay-test' "$FIRST/config.args"
grep -q -- '--labels agent-relay,test' "$FIRST/config.args"
test -f "$FIRST/run.marker"

RESTART="$ROOT/restart"
make_runtime "$RESTART"
touch "$RESTART/.runner"
(
  cd "$RESTART"
  bash "$ENTRYPOINT"
)
test ! -f "$RESTART/config.args"
test -f "$RESTART/run.marker"

MISSING="$ROOT/missing"
make_runtime "$MISSING"
if (cd "$MISSING" && bash "$ENTRYPOINT" >/dev/null 2>&1); then
  echo "Initial registration must fail without RUNNER_TOKEN" >&2
  exit 1
fi
