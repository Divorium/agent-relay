#!/usr/bin/env bash
set -euo pipefail

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/agent-relay-update.XXXXXX")"
cleanup() { rm -rf -- "${ROOT}"; }
trap cleanup EXIT

SOURCE_ROOT="${ROOT}/srv/github-runner/storage/agent-relay"
BUILD_ROOT="${ROOT}/srv/github-runner/storage/build"
BUILD_HOME="${ROOT}/srv/github-runner/storage/build-home"
ADMIN_FILE="${ROOT}/etc/agent-relay/administrator"
FAKE_BIN="${ROOT}/bin"
COMMAND_LOG="${ROOT}/commands.log"
DOCKER_LOG="${ROOT}/docker.log"
TRANSFORMED_UPDATE="${ROOT}/update-under-test.sh"
FAKE_TSC="${ROOT}/fake-tsc"
DOCKER_PROVISIONER="${SOURCE_ROOT}/scripts/docker-host.sh"
DOCKER_ADAPTER="${SOURCE_ROOT}/scripts/docker-host-debian.sh"
TEST_UID="$(/usr/bin/id -u)"

mkdir -p "${SOURCE_ROOT}/scripts" "${BUILD_HOME}" "${FAKE_BIN}" "$(dirname "${ADMIN_FILE}")"
printf 'test-admin\n' > "${ADMIN_FILE}"
chmod 0600 "${ADMIN_FILE}"
cp scripts/docker-host.sh "${DOCKER_PROVISIONER}"
cp scripts/docker-host-debian.sh "${DOCKER_ADAPTER}"
chmod 0755 "${DOCKER_PROVISIONER}" "${DOCKER_ADAPTER}"
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
printf 'compiled\n' > "\${out}/src/run-codex.js"
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
if [[ "\${1:-}" == '-v' || "\${1:-}" == '-k' ]]; then exit 0; fi
if [[ "\${1:-}" == '-n' ]]; then shift; fi
if [[ "\${1:-}" == '-u' ]]; then shift 2; fi
if [[ "\${1:-}" == '--' ]]; then shift; fi
case "\${1:-}" in
  '${DOCKER_PROVISIONER}')
    printf 'docker provisioner\n' >> "${DOCKER_LOG}"
    exit "\${MOCK_DOCKER_STATUS:-0}"
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
    exec /usr/bin/install "\${filtered[@]}"
    ;;
  find|/usr/bin/find)
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
exit 0
EOF_SLEEP
cat > "${FAKE_BIN}/setsid" <<'EOF_SETSID'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == '--wait' ]] && shift
exec "$@"
EOF_SETSID
cat > "${FAKE_BIN}/kill" <<'EOF_KILL'
#!/usr/bin/env bash
exec /usr/bin/kill "$@"
EOF_KILL
chmod 0755 "${FAKE_BIN}"/*

SOURCE_ROOT="${SOURCE_ROOT}" BUILD_ROOT="${BUILD_ROOT}" BUILD_HOME="${BUILD_HOME}" \
ADMIN_FILE="${ADMIN_FILE}" FAKE_TSC="${FAKE_TSC}" FAKE_BIN="${FAKE_BIN}" \
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
pathlib.Path(sys.argv[2]).write_text(source)
PY
chmod 0755 "${TRANSFORMED_UPDATE}"

run_update() {
  : > "${COMMAND_LOG}"
  : > "${DOCKER_LOG}"
  (
    cd "${SOURCE_ROOT}"
    PATH="${FAKE_BIN}:${PATH}" MOCK_DOCKER_STATUS="${1:-0}" bash "${TRANSFORMED_UPDATE}"
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
grep -Fq 'docker provisioner' "${DOCKER_LOG}"
grep -Fq 'systemctl stop actions.runner.Divorium.gh-runner.service' "${COMMAND_LOG}"
grep -Fq 'systemctl enable actions.runner.Divorium.gh-runner.service' "${COMMAND_LOG}"
grep -Fq 'systemctl start actions.runner.Divorium.gh-runner.service' "${COMMAND_LOG}"
grep -Fq 'Update completed. Runner is active with the finalized runtime and Docker access.' "${ROOT}/success.out"

set +e
run_update 42 > "${ROOT}/failure.out" 2> "${ROOT}/failure.err"
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

printf 'update.sh system integration passed\n'