#!/usr/bin/env bash
set -euo pipefail
launcher="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)/antigravity/antigravity"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/root/accounts" "$tmp/root/skills" "$tmp/root/empty-ue5" "$tmp/project" "$tmp/home/.ssh"
printf ready > "$tmp/root/.ready"
printf 'services:\n  agy: {}\n' > "$tmp/root/docker-compose.yml"
printf test > "$tmp/home/.ssh/antigravity.priv"
chmod 600 "$tmp/home/.ssh/antigravity.priv"
cat > "$tmp/fake-docker" <<'SH'
#!/bin/bash
printf 'ARGS=%s\n' "$*"
printf 'STATE=%s\n' "$ACCOUNT_STATE_DIR"
printf 'WORKSPACE=%s\n' "$WORKSPACE_DIR"
printf 'SSH=%s\n' "$ANTIGRAVITY_SSH_KEY"
printf 'UID=%s\n' "$HOST_UID"
SH
chmod +x "$tmp/fake-docker"
export ANTIGRAVITY_ROOT="$tmp/root" ANTIGRAVITY_DOCKER_BIN="$tmp/fake-docker" HOME="$tmp/home"
cd "$tmp/project"
"$launcher" --help | grep -q 'antigravity <account>'
if "$launcher" '../evil' > "$tmp/error" 2>&1; then echo 'traversal accepted'; exit 1; fi
grep -q 'Invalid account' "$tmp/error"
"$launcher" personal --continue > "$tmp/output"
grep -q 'ARGS=compose -f .* run --rm agy --continue' "$tmp/output"
grep -q 'STATE=.*accounts/personal/state' "$tmp/output"
grep -q 'WORKSPACE=.*project' "$tmp/output"
test -d "$tmp/root/accounts/personal/state"
"$launcher" work --help > "$tmp/output"
test -d "$tmp/root/accounts/work/state"
accounts="$("$launcher" --list)"
grep -q '^personal$' <<< "${accounts}"
grep -q '^work$' <<< "${accounts}"
chmod 644 "$tmp/home/.ssh/antigravity.priv"
if "$launcher" personal >/dev/null 2>"$tmp/error"; then echo 'insecure key accepted'; exit 1; fi
grep -q 'SSH key' "$tmp/error"
echo 'antigravity launcher tests pass'
