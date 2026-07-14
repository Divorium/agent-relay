#!/usr/bin/env bash
set -euo pipefail

docker compose exec -T agent-relay sh -lc '
set -eu
while :; do
  latest="$(find /var/lib/agent-relay/logs -maxdepth 1 -type f -name "*.log" -printf "%T@ %p\n" 2>/dev/null | sort -nr | head -n 1 | cut -d" " -f2-)"
  if test -n "${latest}"; then
    echo "Following ${latest}" >&2
    exec tail -n 100 -F "${latest}"
  fi
  sleep 1
done
'
