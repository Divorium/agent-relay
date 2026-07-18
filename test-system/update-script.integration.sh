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
PROCESS_MODE="${ROOT}/process-mode"
WORKER_POLLS="${ROOT}/worker-polls"
FAIL_NEXT_BUILD="${ROOT}/fail-next-build"
FAIL_PROCESS_INSPECTION="${ROOT}/fail-process-inspection"

mkdir -p "${SOURCE_ROOT}" "${BUILD_ROOT}" "${BUILD_HOME}" "${FAKE_BIN}"
rsync -a --exclude=.git --exclude=node_modules --exclude=dist ./ "${SOURCE_ROOT}/"
printf '%s\n' "$(id -un)" > "${ADMIN_FILE}"
printf 'active\n' > "${SERVICE_STATE}"
printf 'idle\n' > "${PROCESS_MODE}"
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
if [[ "${1:-}" == "-u" && "${2:-}" == "agent-relay-builder" ]]; then
  printf '1001\n'
  exit 0
fi
if [[ "${1:-}" == "-u" && "${2:-}" == "github-runner" ]]; then
  printf '1002\n'
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
if [[ "\$*" == "-e -o euid=,comm=" ]]; then
  printf 'process-table %s\n' "\$*" >> "${LOG_FILE}"
  if [[ -f "${FAIL_PROCESS_INSPECTION}" ]]; then
    exit 42
  fi

  printf '0 init\n'
  mode="\$(cat "${PROCESS_MODE}")"
  case "\${mode}" in
    idle)
      ;;
    listener)
      printf '1002 Runner.Listener\n'
      ;;
    foreign-worker)
      printf '2002 Runner.Worker\n'
      ;;
    worker)
      printf '1002 Runner.Listener\n'
      remaining="\$(cat "${WORKER_POLLS}")"
      if (( remaining > 0 )); then
        printf '%s\n' "\$((remaining - 1))" > "${WORKER_POLLS}"
        printf '1002 Runner.Worker\n'
      fi
      ;;
    *)
      echo "unexpected process mode: \${mode}" >&2
      exit 1
      ;;
  esac
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

reset_log() {
  : > "${LOG_FILE}"
}

assert_no_wait_message() {
  local output="$1"
  if grep -q 'Waiting for the active GitHub runner job to finish' "${output}"; then
    echo "Update waited for a worker that should have been ignored" >&2
    exit 1
  fi
}

# An idle host with no github-runner processes must continue after listener stop.
printf 'local change\n' > "${SOURCE_ROOT}/local-untracked.txt"
mkdir -p "${SOURCE_ROOT}/dist/src"
printf 'old runtime\n' > "${SOURCE_ROOT}/dist/src/run-codex.js"
printf 'idle\n' > "${PROCESS_MODE}"
reset_log
run_update > "${ROOT}/idle.out" 2> "${ROOT}/idle.err"

test -f "${SOURCE_ROOT}/local-untracked.txt"
test "$(cat "${SOURCE_ROOT}/dist/src/run-codex.js")" = 'new runtime'
grep -qx active "${SERVICE_STATE}"
grep -q 'Agent Relay runtime rebuilt and activated successfully' "${ROOT}/idle.out"
test "$(grep -c '^process-table ' "${LOG_FILE}")" -eq 1
assert_no_wait_message "${ROOT}/idle.out"

# A runner-owned listener without a worker is also idle.
printf 'listener\n' > "${PROCESS_MODE}"
reset_log
run_update > "${ROOT}/listener.out" 2> "${ROOT}/listener.err"
test "$(grep -c '^process-table ' "${LOG_FILE}")" -eq 1
assert_no_wait_message "${ROOT}/listener.out"
grep -qx active "${SERVICE_STATE}"

# A process with the worker name but a different UID must not block replacement.
printf 'foreign-worker\n' > "${PROCESS_MODE}"
reset_log
run_update > "${ROOT}/foreign-worker.out" 2> "${ROOT}/foreign-worker.err"
test "$(grep -c '^process-table ' "${LOG_FILE}")" -eq 1
assert_no_wait_message "${ROOT}/foreign-worker.out"
grep -qx active "${SERVICE_STATE}"

# A worker owned by github-runner delays replacement until it exits.
printf 'worker\n' > "${PROCESS_MODE}"
printf '2\n' > "${WORKER_POLLS}"
reset_log
run_update > "${ROOT}/worker.out" 2> "${ROOT}/worker.err"
test "$(grep -c '^process-table ' "${LOG_FILE}")" -eq 3
test "$(grep -c 'Waiting for the active GitHub runner job to finish' "${ROOT}/worker.out")" -eq 2

stop_line="$(grep -n 'systemctl stop' "${LOG_FILE}" | head -n 1 | cut -d: -f1)"
first_process_line="$(grep -n '^process-table ' "${LOG_FILE}" | head -n 1 | cut -d: -f1)"
tsc_line="$(grep -n '^tsc ' "${LOG_FILE}" | head -n 1 | cut -d: -f1)"
start_line="$(grep -n 'systemctl start' "${LOG_FILE}" | head -n 1 | cut -d: -f1)"
(( stop_line < first_process_line && first_process_line < tsc_line && tsc_line < start_line ))

# A real process-table failure is fatal before build or runtime deletion.
mkdir -p "${BUILD_ROOT}"
printf 'keep build\n' > "${BUILD_ROOT}/sentinel"
mkdir -p "${SOURCE_ROOT}/dist/src"
printf 'keep runtime\n' > "${SOURCE_ROOT}/dist/src/run-codex.js"
printf 'idle\n' > "${PROCESS_MODE}"
: > "${FAIL_PROCESS_INSPECTION}"
reset_log
if run_update > "${ROOT}/ps-failure.out" 2> "${ROOT}/ps-failure.err"; then
  echo 'Process inspection failure unexpectedly succeeded' >&2
  exit 1
fi
rm -f "${FAIL_PROCESS_INSPECTION}"
grep -q 'Could not inspect GitHub runner worker processes' "${ROOT}/ps-failure.err"
grep -qx inactive "${SERVICE_STATE}"
test "$(cat "${BUILD_ROOT}/sentinel")" = 'keep build'
test "$(cat "${SOURCE_ROOT}/dist/src/run-codex.js")" = 'keep runtime'
if grep -q '^tsc ' "${LOG_FILE}"; then
  echo 'TypeScript ran after process inspection failed' >&2
  exit 1
fi
if grep -q 'sudo rm -rf' "${LOG_FILE}"; then
  echo 'Runtime directories were removed after process inspection failed' >&2
  exit 1
fi

# A build failure performs no rollback. The service remains stopped and the
# partial runtime remains until the next invocation deletes it and starts over.
: > "${FAIL_NEXT_BUILD}"
reset_log
if run_update > "${ROOT}/build-failure.out" 2> "${ROOT}/build-failure.err"; then
  echo 'Build failure unexpectedly succeeded' >&2
  exit 1
fi
grep -qx inactive "${SERVICE_STATE}"
test ! -e "${SOURCE_ROOT}/dist/src/run-codex.js"
test -f "${SOURCE_ROOT}/dist/src/partial.js"

printf 'idle\n' > "${PROCESS_MODE}"
reset_log
run_update > "${ROOT}/retry.out" 2> "${ROOT}/retry.err"
grep -qx active "${SERVICE_STATE}"
test "$(cat "${SOURCE_ROOT}/dist/src/run-codex.js")" = 'new runtime'
test ! -e "${SOURCE_ROOT}/dist/src/partial.js"
grep -q 'Agent Relay runtime rebuilt and activated successfully' "${ROOT}/retry.out"

printf 'update.sh system integration passed\n'
