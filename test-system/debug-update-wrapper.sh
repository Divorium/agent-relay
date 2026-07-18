#!/usr/bin/env bash
set -euo pipefail

tmp="$(mktemp /tmp/agent-relay-update-debug.XXXXXX.sh)"
cleanup() { rm -f -- "${tmp}"; }
trap cleanup EXIT

python3 - "${tmp}" <<'PY'
from pathlib import Path
import sys

source = Path("test-system/update-script.integration.sh").read_text()
old = 'run_update > "${ROOT}/update-success.out" 2> "${ROOT}/update-success.err"\n'
new = '''if ! run_update > "${ROOT}/update-success.out" 2> "${ROOT}/update-success.err"; then
  cat "${ROOT}/update-success.out" >&2 || true
  cat "${ROOT}/update-success.err" >&2 || true
  exit 1
fi
'''
if old not in source:
    raise SystemExit("debug replacement target not found")
Path(sys.argv[1]).write_text(source.replace(old, new, 1))
PY

bash "${tmp}"
