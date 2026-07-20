#!/usr/bin/env bash
set -euo pipefail

if [[ "$(/usr/bin/id -u)" == 0 ]]; then
  [[ -x /usr/sbin/runuser ]] || {
    echo "runuser is required to exercise private runtime permissions from a root test process" >&2
    exit 1
  }
  exec /usr/sbin/runuser -u nobody -- /bin/bash "$0"
fi

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/agent-relay-private-runtime.XXXXXX")"
SOURCE_ROOT="${ROOT}/source"
PRIVATE_DIST="${SOURCE_ROOT}/dist"
FAKE_BIN="${ROOT}/bin"

cleanup() {
  chmod 0700 "${PRIVATE_DIST}" 2>/dev/null || true
  rm -rf -- "${ROOT}"
}
trap cleanup EXIT

mkdir -p "${PRIVATE_DIST}/src" "${FAKE_BIN}"
printf 'compiled\n' > "${PRIVATE_DIST}/src/run-codex.js"
chmod 000 "${PRIVATE_DIST}"

if /usr/bin/test -f "${PRIVATE_DIST}/src/run-codex.js" 2>/dev/null; then
  echo "the updater caller unexpectedly traversed the private runtime directory" >&2
  exit 1
fi

cat > "${FAKE_BIN}/sudo" <<'EOF_SUDO'
#!/usr/bin/env bash
set -euo pipefail

[[ "${1:-}" == -n ]] || exit 64
shift
[[ "${1:-}" == -u && "${2:-}" == agent-relay-builder ]] || exit 64
shift 2
[[ "${1:-}" == /usr/bin/test && "${2:-}" == -f && "${3:-}" == "${PRIVATE_DIST}/src/run-codex.js" ]] || exit 64

chmod 0700 "${PRIVATE_DIST}"
set +e
/usr/bin/test -f "${PRIVATE_DIST}/src/run-codex.js"
status=$?
set -e
chmod 000 "${PRIVATE_DIST}"
exit "${status}"
EOF_SUDO
chmod 0755 "${FAKE_BIN}/sudo"

expected='sudo -n -u "${BUILD_USER}" /usr/bin/test -f "${SOURCE_ROOT}/dist/src/run-codex.js" || {'
actual="$(grep -F 'dist/src/run-codex.js' update.sh | head -n 1)"
[[ "${actual}" == "${expected}" ]] || {
  printf 'unexpected runtime entrypoint validation: %s\n' "${actual}" >&2
  exit 1
}

run_builder_validation() {
  PATH="${FAKE_BIN}:${PATH}" \
  PRIVATE_DIST="${PRIVATE_DIST}" \
  BUILD_USER=agent-relay-builder \
  SOURCE_ROOT="${SOURCE_ROOT}" \
  bash -c 'sudo -n -u "${BUILD_USER}" /usr/bin/test -f "${SOURCE_ROOT}/dist/src/run-codex.js"'
}

run_builder_validation

mode="$(/usr/bin/stat -c '%a' -- "${PRIVATE_DIST}")"
[[ "${mode}" == 0 ]] || {
  printf 'private runtime mode was widened permanently: %s\n' "${mode}" >&2
  exit 1
}

chmod 0700 "${PRIVATE_DIST}"
rm -f -- "${PRIVATE_DIST}/src/run-codex.js"
chmod 000 "${PRIVATE_DIST}"
if run_builder_validation; then
  echo "builder validation unexpectedly accepted a missing runtime entrypoint" >&2
  exit 1
fi

mode="$(/usr/bin/stat -c '%a' -- "${PRIVATE_DIST}")"
[[ "${mode}" == 0 ]] || {
  printf 'private runtime mode was widened after failed validation: %s\n' "${mode}" >&2
  exit 1
}

printf 'private runtime entrypoint integration passed\n'
