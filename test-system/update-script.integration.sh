#!/usr/bin/env bash
set -euo pipefail

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/agent-relay-update.XXXXXX")"
cleanup() { chmod -R u+rwx "${ROOT}" 2>/dev/null || true; rm -rf -- "${ROOT}"; }
trap cleanup EXIT

SOURCE_ROOT="${ROOT}/srv/github-runner/storage/agent-relay"
BUILD_ROOT="${ROOT}/srv/github-runner/storage/build"
BUILD_HOME="${ROOT}/srv/github-runner/storage/build-home"
ADMIN_FILE="${ROOT}/etc/agent-relay/administrator"
FAKE_BIN="${ROOT}/bin"
COMMAND_LOG="${ROOT}/commands.log"
DOCKER_LOG="${ROOT}/docker.log"
TRANSFORMED_UPDATE="${ROOT}/update-under-test.sh"
TRANSFORMED_MANAGED_UPDATE="${ROOT}/update-managed-under-test.sh"
FAKE_TSC="${ROOT}/fake-tsc"
DOCKER_PROVISIONER="${SOURCE_ROOT}/scripts/docker-host.sh"
DOCKER_ADAPTER="${SOURCE_ROOT}/scripts/docker-host-debian.sh"
PRIVATE_DIST="${SOURCE_ROOT}/dist"
STICKY_TMP="${ROOT}/tmp"
TEST_UID="$(/usr/bin/id -u)"

mkdir -p "${SOURCE_ROOT}/scripts" "${BUILD_HOME}" "${FAKE_BIN}" "$(dirname "${ADMIN_FILE}")" "${STICKY_TMP}"
chmod 1777 "${STICKY_TMP}"
printf 'test-admin\n' > "${ADMIN_FILE}"
chmod 0600 "${ADMIN_FILE}"
cp scripts/docker-host.sh "${DOCKER_PROVISIONER}"
cp scripts/docker-host-debian.sh "${DOCKER_ADAPTER}"
chmod 0775 "${DOCKER_PROVISIONER}" "${DOCKER_ADAPTER}"
printf '{"extends":"./tsconfig.json"}\n' > "${SOURCE_ROOT}/tsconfig.runtime.json"
: > "${COMMAND_LOG}"
: > "${DOCKER_LOG}"

cat > "${FAKE_TSC}" <<EOF_TSC
#!/usr/bin/env bash
set -euo pipefail
printf 'tsc %s\n' "\$*" >> "${COMMAND_LOG}"
out=
while (( \$# > 0 )); do
  if [[ "\$1" == '--outDir' ]]; then out=\$2; shift 2; else shift; fi
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
else
  exec /usr/bin/ps "\$@"
fi
EOF_PS

cat > "${FAKE_BIN}/stat" <<EOF_STAT
#!/usr/bin/env bash
set -euo pipefail
if (( \$# == 3 )) && [[ "\$1" == '-c' && "\$2" == '%u:%g|%a' && "\$3" == '${ADMIN_FILE}' ]]; then
  printf '0:0|600\n'
  exit 0
fi
exec /usr/bin/stat "\$@"
EOF_STAT

cat > "${FAKE_BIN}/sudo" <<EOF_SUDO
#!/usr/bin/env bash
set -euo pipefail
printf 'sudo %s\n' "\$*" >> "${COMMAND_LOG}"
if [[ "\${1:-}" == '-v' ]]; then printf '%s\n' "\${PPID}" > "${ROOT}/sudo-parent"; exit 0; fi
if [[ "\${1:-}" == '-k' ]]; then rm -f -- "${ROOT}/sudo-parent"; exit 0; fi
[[ -f "${ROOT}/sudo-parent" && "\$(<"${ROOT}/sudo-parent")" == "\${PPID}" ]] || exit 1
if [[ "\$*" == '-n true' && "\${MOCK_SUDO_EXPIRE:-0}" == 1 && -e "${ROOT}/provisioning" ]]; then exit 1; fi
if [[ "\${1:-}" == '-n' ]]; then shift; fi
run_as_builder=0
if [[ "\${1:-}" == '-u' ]]; then
  [[ "\${2:-}" == agent-relay-builder ]] || exit 64
  run_as_builder=1
  shift 2
fi
if [[ "\${1:-}" == '--' ]]; then shift; fi
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
    printf 'pgid-file %s\n' "\${pgid_file}" >> "${COMMAND_LOG}"
    if [[ "\${MOCK_PROTECTED_REGULAR:-0}" == 1 && "\${pgid_file%/*}" == '${STICKY_TMP}' ]]; then
      printf -- '--: line 3: %s: Permission denied\n' "\${pgid_file}" >&2
      exit 1
    fi
    printf '%s\n' "\${BASHPID}" > "\${pgid_file}"
    printf 'docker provisioner\n' >> "${DOCKER_LOG}"
    if [[ "\${MOCK_DOCKER_MODE:-exit}" == hang ]]; then
      : > "${ROOT}/provisioning"
      while true; do /bin/sleep 1; done
    fi
    if [[ "\${MOCK_DOCKER_MODE:-exit}" == linger ]]; then
      : > "${ROOT}/provisioning"
      /bin/sleep 2
    fi
    exit "\${MOCK_DOCKER_STATUS:-0}"
    ;;
  '${DOCKER_PROVISIONER}')
    printf 'docker provisioner\n' >> "${DOCKER_LOG}"
    if [[ "\${MOCK_DOCKER_MODE:-exit}" == hang ]]; then
      : > "${ROOT}/provisioning"
      while true; do /bin/sleep 1; done
    fi
    if [[ "\${MOCK_DOCKER_MODE:-exit}" == linger ]]; then
      : > "${ROOT}/provisioning"
      /bin/sleep 2
    fi
    exit "\${MOCK_DOCKER_STATUS:-0}"
    ;;
  rm|/usr/bin/rm)
    [[ ! -d "${PRIVATE_DIST}" ]] || chmod 0700 "${PRIVATE_DIST}"
    shift
    exec /usr/bin/rm "\$@"
    ;;
  install|/usr/bin/install)
    shift
    filtered=()
    while (( \$# > 0 )); do
      case "\$1" in
        -o|-g) shift 2 ;;
        *) filtered+=("\$1"); shift ;;
      esac
    done
    /usr/bin/install "\${filtered[@]}"
    status=\$?
    target="\${filtered[\${#filtered[@]}-1]}"
    if [[ "\${target}" == '${PRIVATE_DIST}' ]]; then chmod 000 "${PRIVATE_DIST}"; fi
    exit "\${status}"
    ;;
  find|/usr/bin/find)
    [[ ! -d "${PRIVATE_DIST}" ]] || chmod 0700 "${PRIVATE_DIST}"
    if printf '%s\n' "\$*" | /usr/bin/grep -q -- '-exec /usr/bin/chown'; then exit 0; fi
    shift
    exec /usr/bin/find "\$@"
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
[[ "${1:-}" == '--wait' ]] && shift
exec "$@"
EOF_SETSID
cat > "${FAKE_BIN}/kill" <<'EOF_KILL'
#!/usr/bin/env bash
if [[ "${MOCK_SIGNAL_FAIL:-0}" == 1 && "$*" == *TERM* && -e "${ROOT}/provisioning" ]]; then
  rm -f -- "${ROOT}/provisioning"
  exit 1
fi
exec /usr/bin/kill "$@"
EOF_KILL
chmod 0755 "${FAKE_BIN}"/*

SOURCE_ROOT="${SOURCE_ROOT}" BUILD_ROOT="${BUILD_ROOT}" BUILD_HOME="${BUILD_HOME}" \
ADMIN_FILE="${ADMIN_FILE}" FAKE_TSC="${FAKE_TSC}" FAKE_BIN="${FAKE_BIN}" STICKY_TMP="${STICKY_TMP}" \
python3 - update.sh "${TRANSFORMED_UPDATE}" "${TRANSFORMED_MANAGED_UPDATE}" <<'PY'
import json
import os
import pathlib
import re
import sys

source = pathlib.Path(sys.argv[1]).read_text()
replacements = {
    'BASE_ROOT=/srv/github-runner': 'BASE_ROOT=' + json.dumps(os.path.realpath(os.path.join(os.environ['SOURCE_ROOT'], '..', '..'))),
    'ADMIN_FILE=/etc/agent-relay/administrator': 'ADMIN_FILE=' + json.dumps(os.environ['ADMIN_FILE']),
    '/tmp/agent-relay-provisioner.XXXXXXXX': os.path.join(os.environ['STICKY_TMP'], 'agent-relay-provisioner.XXXXXXXX'),
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
managed_source = source.replace('DOCKER_PROVISIONING_ENABLED=0', 'DOCKER_PROVISIONING_ENABLED=1', 1)
pathlib.Path(sys.argv[3]).write_text(managed_source)
PY
chmod 0755 "${TRANSFORMED_UPDATE}" "${TRANSFORMED_MANAGED_UPDATE}"

assert_control_clean() {
  local leaked
  leaked="$(/usr/bin/find -P "${STICKY_TMP}" -mindepth 1 -maxdepth 1 -print -quit)"
  [[ -z "${leaked}" ]] || {
    printf 'Docker provisioner control state leaked after updater exit: %s\n' "${leaked}" >&2
    exit 1
  }
}

run_update() {
  : > "${COMMAND_LOG}"
  : > "${DOCKER_LOG}"
  rm -f -- "${ROOT}/sudo-parent"
  if [[ "${5:-1}" == 1 ]]; then rm -f -- "${ROOT}/omit-entrypoint"; else : > "${ROOT}/omit-entrypoint"; fi
  (
    cd "${SOURCE_ROOT}"
    TMPDIR="${STICKY_TMP}" PATH="${FAKE_BIN}:${PATH}" MOCK_DOCKER_STATUS="${1:-0}" \
      MOCK_DOCKER_MODE="${2:-exit}" MOCK_SUDO_EXPIRE="${3:-0}" \
      MOCK_SIGNAL_FAIL="${4:-0}" MOCK_PROTECTED_REGULAR=1 bash "${6:-${TRANSFORMED_UPDATE}}"
  )
}

set +e
run_update 0 > "${ROOT}/success.out" 2> "${ROOT}/success.err"
success_status=$?
set -e
if (( success_status != 0 )); then
  cat "${ROOT}/success.out" >&2
  cat "${ROOT}/success.err" >&2
  printf 'successful updater scenario exited with status %s\n' "${success_status}" >&2
  exit "${success_status}"
fi

test -f "${SOURCE_ROOT}/dist/src/run-codex.js"
grep -Fq "${BUILD_ROOT}" "${COMMAND_LOG}"
grep -Fq "tsc -p ${SOURCE_ROOT}/tsconfig.runtime.json --outDir ${SOURCE_ROOT}/dist" "${COMMAND_LOG}"
grep -Fq "sudo -n -u agent-relay-builder /usr/bin/test -f ${PRIVATE_DIST}/src/run-codex.js" "${COMMAND_LOG}"
if grep -Fq 'pgid-file ' "${COMMAND_LOG}"; then
  echo 'disabled updater created Docker provisioner control state' >&2
  exit 1
fi
[[ ! -s "${DOCKER_LOG}" ]] || { echo 'disabled updater invoked Docker provisioning' >&2; exit 1; }
grep -Fq 'systemctl stop actions.runner.Divorium.gh-runner.service' "${COMMAND_LOG}"
grep -Fq 'systemctl enable actions.runner.Divorium.gh-runner.service' "${COMMAND_LOG}"
grep -Fq 'systemctl start actions.runner.Divorium.gh-runner.service' "${COMMAND_LOG}"
grep -Fq 'Update completed. Runner is active with the finalized runtime. Docker provisioning is disabled.' "${ROOT}/success.out"
[[ "$(/usr/bin/stat -c '%a' -- "${DOCKER_PROVISIONER}")" == 775 ]] \
  || { echo 'disabled updater changed Docker provisioner permissions' >&2; exit 1; }
[[ "$(/usr/bin/stat -c '%a' -- "${DOCKER_ADAPTER}")" == 775 ]] \
  || { echo 'disabled updater changed Docker adapter permissions' >&2; exit 1; }
assert_control_clean

set +e
run_update 0 exit 0 0 0 > "${ROOT}/missing.out" 2> "${ROOT}/missing.err"
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
assert_control_clean

set +e
run_update 42 exit 0 0 1 "${TRANSFORMED_MANAGED_UPDATE}" > "${ROOT}/failure.out" 2> "${ROOT}/failure.err"
failure_status=$?
set -e
if (( failure_status != 42 )); then
  cat "${ROOT}/failure.out" >&2
  cat "${ROOT}/failure.err" >&2
  printf 'failing updater scenario exited with status %s instead of 42\n' "${failure_status}" >&2
  exit 1
fi
grep -Fq 'Docker provisioning failed with status 42 after runtime finalization; the runner was restored with the finalized runtime.' "${ROOT}/failure.err"
grep -Fq 'systemctl start actions.runner.Divorium.gh-runner.service' "${COMMAND_LOG}"
assert_control_clean

rm -f -- "${ROOT}/provisioning"
set +e
run_update 0 hang 0 0 1 "${TRANSFORMED_MANAGED_UPDATE}" > "${ROOT}/deadline.out" 2> "${ROOT}/deadline.err"
deadline_status=$?
set -e
(( deadline_status == 70 )) || fail_status=1
if [[ "${fail_status:-0}" == 1 ]]; then
  cat "${ROOT}/deadline.err" >&2
  printf 'deadline scenario exited with status %s instead of 70\n' "${deadline_status}" >&2
  exit 1
fi
grep -Fq 'Docker provisioner exceeded its bounded deadline' "${ROOT}/deadline.err"
grep -Fq 'systemctl start actions.runner.Divorium.gh-runner.service' "${COMMAND_LOG}"
assert_control_clean

rm -f -- "${ROOT}/provisioning"
set +e
run_update 0 hang 1 0 1 "${TRANSFORMED_MANAGED_UPDATE}" > "${ROOT}/expiry.out" 2> "${ROOT}/expiry.err"
expiry_status=$?
set -e
if (( expiry_status == 0 )); then
  cat "${ROOT}/expiry.err" >&2
  printf 'expired-authority scenario unexpectedly succeeded\n' >&2
  exit 1
fi
grep -Eq 'Noninteractive .*sudo authority expired|Update interrupted by TERM' "${ROOT}/expiry.err" || {
  cat "${ROOT}/expiry.err" >&2
  exit 1
}
grep -Fq 'systemctl start actions.runner.Divorium.gh-runner.service' "${COMMAND_LOG}"
assert_control_clean

rm -f -- "${ROOT}/provisioning"
set +e
run_update 0 linger 0 1 1 "${TRANSFORMED_MANAGED_UPDATE}" > "${ROOT}/signal-failure.out" 2> "${ROOT}/signal-failure.err"
signal_failure_status=$?
set -e
if (( signal_failure_status != 70 )); then
  cat "${ROOT}/signal-failure.err" >&2
  printf 'signal-failure scenario exited with status %s instead of 70\n' "${signal_failure_status}" >&2
  exit 1
fi
grep -Fq 'Docker provisioner exceeded its bounded deadline' "${ROOT}/signal-failure.err"
grep -Fq 'systemctl start actions.runner.Divorium.gh-runner.service' "${COMMAND_LOG}"
assert_control_clean

printf 'update.sh system integration passed\n'