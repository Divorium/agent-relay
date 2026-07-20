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
SOURCE_ROOT="${ROOT}/srv/github-runner/storage/agent-relay"
BUILD_ROOT="${ROOT}/srv/github-runner/storage/build"
BUILD_HOME="${ROOT}/srv/github-runner/storage/build-home"
ADMIN_FILE="${ROOT}/etc/agent-relay/administrator"
FAKE_BIN="${ROOT}/bin"
FAKE_TSC="${ROOT}/fake-tsc"
COMMAND_LOG="${ROOT}/commands.log"
DOCKER_LOG="${ROOT}/docker.log"
TRANSFORMED_UPDATE="${ROOT}/update-under-test.sh"
PRIVATE_DIST="${SOURCE_ROOT}/dist"
DOCKER_PROVISIONER="${SOURCE_ROOT}/scripts/docker-host.sh"
DOCKER_ADAPTER="${SOURCE_ROOT}/scripts/docker-host-debian.sh"
TEST_UID="$(/usr/bin/id -u)"

cleanup() {
  chmod -R u+rwx "${ROOT}" 2>/dev/null || true
  rm -rf -- "${ROOT}"
}
trap cleanup EXIT

mkdir -p "${SOURCE_ROOT}/scripts" "${BUILD_HOME}" "${FAKE_BIN}" "$(dirname "${ADMIN_FILE}")"
printf 'test-admin\n' > "${ADMIN_FILE}"
chmod 0600 "${ADMIN_FILE}"
printf '{"extends":"./tsconfig.json"}\n' > "${SOURCE_ROOT}/tsconfig.runtime.json"
for helper in "${DOCKER_PROVISIONER}" "${DOCKER_ADAPTER}"; do
  cat > "${helper}" <<'EOF_HELPER'
#!/usr/bin/env bash
exit 0
EOF_HELPER
  chmod 0755 "${helper}"
done
: > "${COMMAND_LOG}"
: > "${DOCKER_LOG}"

cat > "${FAKE_TSC}" <<EOF_TSC
#!/usr/bin/env bash
set -euo pipefail
printf 'tsc %s\n' "\$*" >> "${COMMAND_LOG}"
out=
while (( \$# > 0 )); do
  if [[ "\$1" == --outDir ]]; then out=\$2; shift 2; else shift; fi
done
mkdir -p "\${out}/src"
if [[ ! -e "${ROOT}/omit-entrypoint" ]]; then
  printf 'compiled\n' > "\${out}/src/run-codex.js"
fi
EOF_TSC
chmod 0755 "${FAKE_TSC}"

cat > "${FAKE_BIN}/id" <<EOF_ID
#!/usr/bin/env bash
set -euo pipefail
case "\$*" in
  '-u') echo ${TEST_UID} ;;
  '-un') echo test-admin ;;
  '-u agent-relay-builder') echo 2002 ;;
  '-u github-runner') echo 2001 ;;
  *) exec /usr/bin/id "\$@" ;;
esac
EOF_ID

cat > "${FAKE_BIN}/ps" <<EOF_PS
#!/usr/bin/env bash
set -euo pipefail
if [[ "\$*" == '-p 1 -o comm=' ]]; then
  printf 'systemd\n'
elif [[ "\$*" == '-e -o euid=,comm=' ]]; then
  printf '${TEST_UID} bash\n'
elif [[ "\$*" == -o\ pgid=* ]]; then
  printf '%s\n' "\${@: -1}"
elif [[ "\$*" == '-e -o pgid=,stat=' ]]; then
  exit 0
else
  exec /usr/bin/ps "\$@"
fi
EOF_PS

cat > "${FAKE_BIN}/stat" <<EOF_STAT
#!/usr/bin/env bash
set -euo pipefail
if (( \$# == 3 )) && [[ "\$1" == -c && "\$2" == '%u:%g|%a' && "\$3" == '${ADMIN_FILE}' ]]; then
  printf '0:0|600\n'
  exit 0
fi
exec /usr/bin/stat "\$@"
EOF_STAT

cat > "${FAKE_BIN}/sudo" <<EOF_SUDO
#!/usr/bin/env bash
set -euo pipefail
printf 'sudo %s\n' "\$*" >> "${COMMAND_LOG}"
if [[ "\${1:-}" == -v ]]; then printf '%s\n' "\${PPID}" > "${ROOT}/sudo-parent"; exit 0; fi
if [[ "\${1:-}" == -k ]]; then rm -f -- "${ROOT}/sudo-parent"; exit 0; fi
[[ -f "${ROOT}/sudo-parent" && "\$(<"${ROOT}/sudo-parent")" == "\${PPID}" ]] || exit 1
if [[ "\${1:-}" == -n ]]; then shift; fi

run_as_builder=0
if [[ "\${1:-}" == -u ]]; then
  [[ "\${2:-}" == agent-relay-builder ]] || exit 64
  run_as_builder=1
  shift 2
fi
if [[ "\${1:-}" == -- ]]; then shift; fi

if (( run_as_builder == 1 )); then
  [[ ! -d "${PRIVATE_DIST}" ]] || chmod 0700 "${PRIVATE_DIST}"
  set +e
  "\$@"
  status=\$?
  set -e
  [[ ! -d "${PRIVATE_DIST}" ]] || chmod 000 "${PRIVATE_DIST}"
  exit "\${status}"
fi

case "\${1:-}" in
  '${FAKE_BIN}/setsid')
    pgid_file="\${@: -2:1}"
    printf '%s\n' "\${BASHPID}" > "\${pgid_file}"
    printf 'docker provisioner\n' >> "${DOCKER_LOG}"
    exit 0
    ;;
  install|/usr/bin/install)
    command=\$1
    shift
    filtered=()
    while (( \$# > 0 )); do
      case "\$1" in
        -o|-g) shift 2 ;;
        *) filtered+=("\$1"); shift ;;
      esac
    done
    "\${command}" "\${filtered[@]}"
    status=\$?
    target="\${filtered[\${#filtered[@]}-1]}"
    if [[ "\${target}" == '${PRIVATE_DIST}' ]]; then chmod 000 "${PRIVATE_DIST}"; fi
    exit "\${status}"
    ;;
  find|/usr/bin/find)
    command=\$1
    shift
    [[ ! -d "${PRIVATE_DIST}" ]] || chmod 0700 "${PRIVATE_DIST}"
    if printf '%s\n' "\$*" | /usr/bin/grep -q -- '-exec /usr/bin/chown'; then exit 0; fi
    exec "\${command}" "\$@"
    ;;
  *) exec "\$@" ;;
esac
EOF_SUDO

cat > "${FAKE_BIN}/systemctl" <<EOF_SYSTEMCTL
#!/usr/bin/env bash
set -euo pipefail
printf 'systemctl %s\n' "\$*" >> "${COMMAND_LOG}"
exit 0
EOF_SYSTEMCTL

cat > "${FAKE_BIN}/flock" <<'EOF_FLOCK'
#!/usr/bin/env bash
exit 0
EOF_FLOCK
cat > "${FAKE_BIN}/sleep" <<'EOF_SLEEP'
#!/usr/bin/env bash
/bin/sleep 0.001
EOF_SLEEP
cat > "${FAKE_BIN}/setsid" <<'EOF_SETSID'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == --wait ]] && shift
exec "$@"
EOF_SETSID
cat > "${FAKE_BIN}/kill" <<'EOF_KILL'
#!/usr/bin/env bash
exec /usr/bin/kill "$@"
EOF_KILL
chmod 0755 "${FAKE_BIN}"/*

SOURCE_ROOT="${SOURCE_ROOT}" ADMIN_FILE="${ADMIN_FILE}" FAKE_TSC="${FAKE_TSC}" FAKE_BIN="${FAKE_BIN}" \
python3 - update.sh "${TRANSFORMED_UPDATE}" <<'PY'
import json
import os
import pathlib
import re
import sys

source = pathlib.Path(sys.argv[1]).read_text()
replacements = {
    'BASE_ROOT=/srv/github-runner': 'BASE_ROOT=' + json.dumps(os.path.realpath(os.path.join(os.environ['SOURCE_ROOT'], '..', '..'))),
    'ADMIN_FILE=/etc/agent-relay/administrator': 'ADMIN_FILE=' + json.dumps(os.environ['ADMIN_FILE']),
    '/usr/local/bin/tsc': os.environ['FAKE_TSC'],
    '/usr/bin/id': os.path.join(os.environ['FAKE_BIN'], 'id'),
    '/usr/bin/ps': os.path.join(os.environ['FAKE_BIN'], 'ps'),
    '/usr/bin/stat': os.path.join(os.environ['FAKE_BIN'], 'stat'),
    '/usr/bin/flock': os.path.join(os.environ['FAKE_BIN'], 'flock'),
    '/usr/bin/setsid': os.path.join(os.environ['FAKE_BIN'], 'setsid'),
    '/usr/bin/sleep': os.path.join(os.environ['FAKE_BIN'], 'sleep'),
    '/usr/bin/kill': os.path.join(os.environ['FAKE_BIN'], 'kill'),
}
for old, new in replacements.items():
    source = source.replace(old, new)
fake_sudo = os.path.join(os.environ['FAKE_BIN'], 'sudo')
source = source.replace('/usr/bin/sudo', fake_sudo)
source = re.sub(r'(?<![/A-Za-z0-9_.-])sudo(?=\s)', fake_sudo, source)
source = source.replace('PROCESS_GROUP_WAIT_STEPS=300', 'PROCESS_GROUP_WAIT_STEPS=2')
source = source.replace('PROCESS_GROUP_WAIT_SECONDS=0.1', 'PROCESS_GROUP_WAIT_SECONDS=0')
source = source.replace('PROVISIONER_DEADLINE_STEPS=7200', 'PROVISIONER_DEADLINE_STEPS=2')
source = source.replace('PROVISIONER_DEADLINE_SECONDS=1', 'PROVISIONER_DEADLINE_SECONDS=0')
source = source.replace('SUDO_REFRESH_STEPS=15', 'SUDO_REFRESH_STEPS=1')
pathlib.Path(sys.argv[2]).write_text(source)
PY
chmod 0755 "${TRANSFORMED_UPDATE}"

run_update() {
  : > "${COMMAND_LOG}"
  : > "${DOCKER_LOG}"
  rm -f -- "${ROOT}/sudo-parent"
  (
    cd "${SOURCE_ROOT}"
    if [[ "$1" == 1 ]]; then rm -f -- "${ROOT}/omit-entrypoint"; else : > "${ROOT}/omit-entrypoint"; fi
    PATH="${FAKE_BIN}:${PATH}" PRIVATE_DIST="${PRIVATE_DIST}" bash "${TRANSFORMED_UPDATE}"
  )
}

set +e
run_update 1 > "${ROOT}/success.out" 2> "${ROOT}/success.err"
success_status=$?
set -e
if (( success_status != 0 )); then
  cat "${ROOT}/success.out" >&2
  cat "${ROOT}/success.err" >&2
  printf 'successful private-runtime scenario exited with status %s\n' "${success_status}" >&2
  exit "${success_status}"
fi

grep -Fq "sudo -n -u agent-relay-builder /usr/bin/test -f ${PRIVATE_DIST}/src/run-codex.js" "${COMMAND_LOG}"
grep -Fq -- "-exec /usr/bin/chown -h root:root" "${COMMAND_LOG}"
grep -Fq 'docker provisioner' "${DOCKER_LOG}"
grep -Fq 'systemctl start actions.runner.Divorium.gh-runner.service' "${COMMAND_LOG}"
test -f "${PRIVATE_DIST}/src/run-codex.js"

set +e
run_update 0 > "${ROOT}/missing.out" 2> "${ROOT}/missing.err"
missing_status=$?
set -e
if (( missing_status != 1 )); then
  cat "${ROOT}/missing.out" >&2
  cat "${ROOT}/missing.err" >&2
  printf 'missing-entrypoint scenario exited with status %s instead of 1\n' "${missing_status}" >&2
  exit 1
fi

grep -Fq 'Compiled runtime entrypoint is missing; the runner remains stopped' "${ROOT}/missing.err"
grep -Fq 'Runner remains stopped because the replacement runtime was not fully finalized.' "${ROOT}/missing.err"
grep -Fq "sudo -n -u agent-relay-builder /usr/bin/test -f ${PRIVATE_DIST}/src/run-codex.js" "${COMMAND_LOG}"
if grep -Fq -- '-exec /usr/bin/chown -h root:root' "${COMMAND_LOG}"; then
  echo 'missing-entrypoint scenario adopted an unvalidated runtime' >&2
  exit 1
fi
if [[ -s "${DOCKER_LOG}" ]]; then
  echo 'missing-entrypoint scenario invoked Docker provisioning' >&2
  exit 1
fi
if grep -Eq 'systemctl (enable|start) actions\.runner\.Divorium\.gh-runner\.service' "${COMMAND_LOG}"; then
  echo 'missing-entrypoint scenario restored the runner before finalization' >&2
  exit 1
fi

echo 'private runtime updater integration passed'
