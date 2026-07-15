#!/usr/bin/env bash
set -euo pipefail

runuser -u agent -- test ! -w /home/agent/.cargo
runuser -u agent -- test ! -w /home/agent/.rustup
runuser -u agent -- test ! -w /runner
runuser -u agent -- /home/agent/.cargo/bin/cargo --version

printf relay-private > /var/lib/agent-relay/private
chown relay:relay /var/lib/agent-relay/private
runuser -u agent -- test ! -r /var/lib/agent-relay/private

runuser -u relay -- env AGENT_RELAY_TOKEN=relay-secret /bin/bash -lc 'echo $$ > /var/lib/agent-relay/test.pid; exec sleep 60' &
relay_launcher="$!"
cleanup() {
  if kill -0 "$relay_launcher" 2>/dev/null; then
    kill "$relay_launcher" 2>/dev/null || true
  fi
  wait "$relay_launcher" 2>/dev/null || true
}
trap cleanup EXIT
for attempt in $(seq 1 50); do
  [[ -s /var/lib/agent-relay/test.pid ]] && break
  sleep 0.1
done
relay_pid="$(cat /var/lib/agent-relay/test.pid)"
kill -0 "$relay_pid"
runuser -u agent -- test ! -r "/proc/$relay_pid/environ"
kill "$relay_pid"
wait "$relay_launcher" || true
trap - EXIT

mkdir -p /tmp/codex-root/current /tmp/codex-root/sibling /tmp/agent-relay-runtime
chown -R agent:agent /tmp/codex-root /tmp/agent-relay-runtime
runuser -u agent -- git -C /tmp/codex-root/current init --quiet
runuser -u agent -- git -C /tmp/agent-relay-runtime init --quiet
runuser -u agent -- mkdir -m 0700 /tmp/agent-relay-runtime/.agents

printf sibling-private > /tmp/codex-root/sibling/private
printf unrelated-temp > /tmp/unrelated-context
printf unrelated-var-temp > /var/tmp/unrelated-context
printf stale-runtime > /tmp/agent-relay-runtime/stale-context
chown agent:agent \
  /tmp/codex-root/sibling/private \
  /tmp/unrelated-context \
  /var/tmp/unrelated-context \
  /tmp/agent-relay-runtime/stale-context
printf stale-codex-state > /home/agent/.codex/sentinel
printf stale-tool-state > /home/agent/stale-context
chown agent:agent /home/agent/.codex/sentinel /home/agent/stale-context

/usr/local/bin/codex \
  -c features.memories=false \
  -c 'default_permissions="relay"' \
  -c 'permissions.relay.extends=":workspace"' \
  -c 'permissions.relay.filesystem={"/home/agent/.codex"="deny","/app"="deny","/home/relay"="deny","/runner"="deny","/tmp"="deny","/var/tmp"="deny","/tmp/agent-relay-runtime"="write","/tmp/codex-root"="deny","/tmp/codex-root/current"="write","/tmp/codex-root/current/.git"="read"}' \
  -c permissions.relay.network.enabled=true \
  sandbox -P relay -C /tmp/codex-root/current \
  /usr/sbin/runuser -u agent -- /bin/bash -lc '
    set -euo pipefail
    git status --short >/dev/null
    test ! -r /home/agent/.codex/sentinel
    test ! -w /runner
    test ! -r /tmp/codex-root/sibling/private
    test ! -r /tmp/unrelated-context
    test ! -r /var/tmp/unrelated-context
    test ! -r /app/dist/src/server.js
    touch /tmp/agent-relay-runtime/runtime-write-ok
    touch workspace-write-ok
    ! touch .git/sandbox-write-denied
  '

test -f /tmp/codex-root/current/workspace-write-ok
test ! -e /tmp/codex-root/current/.git/sandbox-write-denied
runuser -u agent -- test ! -r /app/dist/src/server.js

su -s /bin/bash relay -c 'cd /tmp/codex-root/current && sudo -H -u agent -- /usr/local/bin/codex-run --version'

test -d /tmp/codex-root/current
test -d /tmp/agent-relay-runtime/.git/objects
test -d /tmp/agent-relay-runtime/.agents
test ! -e /tmp/agent-relay-runtime/stale-context
test ! -e /home/agent/.codex/sentinel
test ! -e /home/agent/stale-context
