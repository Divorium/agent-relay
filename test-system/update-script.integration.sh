#!/usr/bin/env bash
set -euo pipefail

ROOT="$(mktemp -d /tmp/agent-relay-update.XXXXXX)"
cleanup() { rm -rf -- "${ROOT}"; }
trap cleanup EXIT

BASE_ROOT="${ROOT}/host"
STORAGE_ROOT="${BASE_ROOT}/storage"
SOURCE_ROOT="${STORAGE_ROOT}/agent-relay"
BUILD_ROOT="${STORAGE_ROOT}/build"
BUILD_HOME="${STORAGE_ROOT}/build-home"
FAKE_BIN="${ROOT}/bin"
ADMIN_FILE="${ROOT}/administrator"
LOG_FILE="${ROOT}/commands.log"
SERVICE_STATE="${ROOT}/service.state"
WORKER_POLLS="${ROOT}/worker-polls"
FAIL_NEXT_BUILD="${ROOT}/fail-next-build"

mkdir -p "${SOURCE_ROOT}" "${BUILD_ROOT}" "${BUILD_HOME}" "${FAKE_BIN}"
rsync -a --exclude=.git --exclude=node_modules --exclude=dist ./ "${SOURCE_ROOT}/"
printf '%s\n' "$(id -un)" > "${ADMIN_FILE}"
printf 'active\n' > "${SERVICE_STATE}"
printf '0\n' > "${WORKER_POLLS}"
: > "${LOG_FILE}"

BASE_ROOT="${BASE_ROOT}" ADMIN_FILE="${ADMIN_FILE}" SOURCE_ROOT="${SOURCE_ROOT}" \
FAKE_TSC="${FAKE_BIN}/tsc" FAKE_PS="${FAKE_BIN}/ps" \
python3 - "${SOURCE_ROOT}/update.sh" <<'PY'
import json
import os
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
source = path.read_text()
source = source.replace("BASE_ROOT=/srv/github-runner", f"BASE_ROOT={json.dumps(os.environ['BASE_ROOT'])}")
source = source.replace("ADMIN_FILE=/etc/agent-relay/administrator", f"ADMIN_FILE={json.dumps(os.environ['ADMIN_FILE'])}")
source = source.replace(
    'SCRIPT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"',
    f"SCRIPT_ROOT={json.dumps(os.environ['SOURCE_ROOT'])}",
)
source = source.replace("/usr/local/bin/tsc", os.environ["FAKE_TSC"])
source = source.replace("/usr/bin/ps", os.environ["FAKE_PS"])
path.write_text(source)
PY

cat > "${FAKE_BIN}/id" <<'EOF_ID'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "-u" && ( "${2:-}" == "agent-relay-builder" || "${2:-}" == "github-runner" ) ]]; then
  printf '1001\n'
  exit 0
fi
exec /usr/bin/id "$@"
EOF_ID

cat > "${FAKE_BIN}/ps" <<EOF_PS
#!/usr/bin/env bash
set -euo pipefail
if [[ "\$*" == *"-p 1 -o comm="* ]]; then
  printf 'systemd\n'
  exit 0
fi
if [[ "\$*" == "-u github-runner -o comm=" ]]; then
  printf 'worker-ps %s\n' "\$*" >> "${LOG_FILE}"
  remaining="\$(cat "${WORKER_POLLS}")"
  if (( remaining > 0 )); then
    printf '%s\n' "\$((remaining - 1))" > "${WORKER_POLLS}"
    printf 'Runner.Worker\n'
  fi
  exit 0
fi
exec /bin/ps "\$@"
EOF_PS

cat > "${FAKE_BIN}/stat" <<EOF_STAT
#!/usr/bin/env bash
set -euo pipefail
if [[ "\$*" == "-c %U|%G|%a -- ${ADMIN_FILE}" ]]; then
  printf 'root|root|644\n'
  exit 0
fi
exec /usr/bin/stat "\$@"
EOF_STAT

cat > "${FAKE_BIN}/systemctl" <<EOF_SYSTEMCTL
#!/usr/bin/env bash
set -euo pipefail
printf 'systemctl %s\n' "\$*" >> "${LOG_FILE}"
while [[ "\${1:-}" == -* ]]; do shift; done
case "\${1:-}" in
  stop) printf 'inactive\n' > "${SERVICE_STATE}" ;;
  enable) ;;
  start) printf 'active\n' > "${SERVICE_STATE}" ;;
  is-active) grep -qx active "${SERVICE_STATE}" ;;
  status) ;;
  *) echo "unexpected systemctl command: \$*" >&2; exit 1 ;;
esac
EOF_SYSTEMCTL

cat > "${FAKE_BIN}/tsc" <<EOF_TSC
#!/usr/bin/env bash
set -euo pipefail
printf 'tsc %s\n' "\$*" >> "${LOG_FILE}"
out=""
while (( \$# > 0 )); do
  if [[ "\$1" == "--outDir" ]]; then
    out="\$2"
    shift 2
  else
    shift
  fi
done
[[ -n "\${out}" ]]
mkdir -p "\${out}/src"
if [[ -f "${FAIL_NEXT_BUILD}" ]]; then
  rm -f "${FAIL_NEXT_BUILD}"
  printf 'partial\n' > "\${out}/src/partial.js"
  exit 1
fi
printf 'new runtime\n' > "\${out}/src/run-codex.js"
EOF_TSC

cat > "${FAKE_BIN}/sudo" <<EOF_SUDO
#!/usr/bin/env bash
set -euo pipefail
printf 'sudo %s\n' "\$*" >> "${LOG_FILE}"
if [[ "\${1:-}" == "-v" || "\${1:-}" == "-k" ]]; then exit 0; fi
while [[ "\${1:-}" == "-u" || "\${1:-}" == "-H" ]]; do
  if [[ "\$1" == "-u" ]]; then shift 2; else shift; fi
done
case "\${1:-}" in
  find)
    if printf '%s\n' "\$*" | grep -q -- '-exec chown'; then exit 0; fi
    shift
    exec /usr/bin/find "\$@"
    ;;
  install)
    shift
    filtered=()
    while (( \$# > 0 )); do
      case "\$1" in
        -o|-g) shift 2 ;;
        *) filtered+=("\$1"); shift ;;
      esac
    done
    exec /usr/bin/install "\${filtered[@]}"
    ;;
  *) exec "\$@" ;;
esac
EOF_SUDO

chmod 0700 "${FAKE_BIN}"/*
export PATH="${FAKE_BIN}:/usr/bin:/bin"
export HOME="${ROOT}/home"
mkdir -p "${HOME}"

run_update() {
  (cd "${SOURCE_ROOT}" && bash "${SOURCE_ROOT}/update.sh")
}

# A dirty checkout and an active worker do not block deployment permanently.
printf 'local change\n' > "${SOURCE_ROOT}/local-untracked.txt"
mkdir -p "${SOURCE_ROOT}/dist/src"
printf 'old runtime\n' > "${SOURCE_ROOT}/dist/src/run-codex.js"
printf '2\n' > "${WORKER_POLLS}"
run_update > "${ROOT}/success.out" 2> "${ROOT}/success.err"

test -f "${SOURCE_ROOT}/local-untracked.txt"
test "$(cat "${SOURCE_ROOT}/dist/src/run-codex.js")" = 'new runtime'
grep -qx active "${SERVICE_STATE}"
grep -q 'Agent Relay runtime rebuilt and activated successfully' "${ROOT}/success.out"
test "$(grep -c '^worker-ps ' "${LOG_FILE}")" -eq 3

stop_line="$(grep -n 'systemctl stop' "${LOG_FILE}" | head -n 1 | cut -d: -f1)"
first_worker_line="$(grep -n '^worker-ps ' "${LOG_FILE}" | head -n 1 | cut -d: -f1)"
tsc_line="$(grep -n '^tsc ' "${LOG_FILE}" | head -n 1 | cut -d: -f1)"
start_line="$(grep -n 'systemctl start' "${LOG_FILE}" | head -n 1 | cut -d: -f1)"
(( stop_line < first_worker_line && first_worker_line < tsc_line && tsc_line < start_line ))

# A build failure performs no rollback. The service remains stopped and the
# partial runtime remains until the next invocation deletes it and starts over.
: > "${FAIL_NEXT_BUILD}"
if run_update > "${ROOT}/failure.out" 2> "${ROOT}/failure.err"; then
  echo 'Build failure unexpectedly succeeded' >&2
  exit 1
fi
grep -qx inactive "${SERVICE_STATE}"
test ! -e "${SOURCE_ROOT}/dist/src/run-codex.js"
test -f "${SOURCE_ROOT}/dist/src/partial.js"

printf '0\n' > "${WORKER_POLLS}"
run_update > "${ROOT}/retry.out" 2> "${ROOT}/retry.err"
grep -qx active "${SERVICE_STATE}"
test "$(cat "${SOURCE_ROOT}/dist/src/run-codex.js")" = 'new runtime'
test ! -e "${SOURCE_ROOT}/dist/src/partial.js"
grep -q 'Agent Relay runtime rebuilt and activated successfully' "${ROOT}/retry.out"

printf 'update.sh system integration passed\n'
