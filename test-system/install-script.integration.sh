#!/usr/bin/env bash
set -euo pipefail

ROOT="$(mktemp -d /tmp/agent-relay-install.XXXXXX)"
cleanup() { rm -rf -- "${ROOT}"; }
trap cleanup EXIT

BASE_ROOT="${ROOT}/srv/github-runner"
STORAGE_ROOT="${BASE_ROOT}/storage"
SOURCE_ROOT="${STORAGE_ROOT}/agent-relay"
FAKE_BIN="${ROOT}/bin"
FAKE_CODEX="${ROOT}/codex"
FAKE_ETC="${ROOT}/etc"
CONFIG_ROOT="${FAKE_ETC}/agent-relay"
SERVICE_ROOT="${FAKE_ETC}/systemd/system"
NEEDRESTART_ROOT="${FAKE_ETC}/needrestart/conf.d"
USERS_STATE="${ROOT}/users.state"
COMMAND_LOG="${ROOT}/commands.log"
CONFIG_LOG="${ROOT}/config.log"
AUTH_STATE="${ROOT}/codex-authenticated"
TRANSFORMED_INSTALL="${ROOT}/install-under-test.sh"
ADMIN_HOME="${ROOT}/admin-home"

mkdir -p "${SOURCE_ROOT}" "${FAKE_BIN}" "${SERVICE_ROOT}" "${NEEDRESTART_ROOT}" "${ADMIN_HOME}"
rsync -a --exclude=.git --exclude=node_modules --exclude=dist ./ "${SOURCE_ROOT}/"
git init --initial-branch=main "${SOURCE_ROOT}" >/dev/null
: > "${USERS_STATE}"
: > "${COMMAND_LOG}"

BASE_ROOT="${BASE_ROOT}" CONFIG_ROOT="${CONFIG_ROOT}" SOURCE_ROOT="${SOURCE_ROOT}" \
SERVICE_ROOT="${SERVICE_ROOT}" NEEDRESTART_ROOT="${NEEDRESTART_ROOT}" FAKE_CODEX="${FAKE_CODEX}" \
python3 - "${SOURCE_ROOT}/install.sh" "${TRANSFORMED_INSTALL}" <<'PY'
import json
import os
import pathlib
import sys
source = pathlib.Path(sys.argv[1]).read_text()
start = source.index("sudo apt-get update\n")
end = source.index('ensure_locked_user "${RUNNER_USER}"', start)
source = source[:start] + ":\n\n" + source[end:]
replacements = {
    'BASE_ROOT=/srv/github-runner': 'BASE_ROOT=' + json.dumps(os.environ['BASE_ROOT']),
    'CONFIG_ROOT=/etc/agent-relay': 'CONFIG_ROOT=' + json.dumps(os.environ['CONFIG_ROOT']),
    'SOURCE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"': 'SOURCE_ROOT=' + json.dumps(os.environ['SOURCE_ROOT']),
    '/etc/systemd/system': os.environ['SERVICE_ROOT'],
    '/etc/needrestart/conf.d': os.environ['NEEDRESTART_ROOT'],
    '/usr/local/bin/codex': os.environ['FAKE_CODEX'],
}
for old, new in replacements.items():
    source = source.replace(old, new)
pathlib.Path(sys.argv[2]).write_text(source)
PY
chmod 0700 "${TRANSFORMED_INSTALL}"

mkdir -p "${STORAGE_ROOT}/runner/bin"
cat > "${STORAGE_ROOT}/runner/bin/Runner.Listener" <<'EOF_LISTENER'
#!/usr/bin/env bash
exit 0
EOF_LISTENER
cat > "${STORAGE_ROOT}/runner/bin/runsvc.sh" <<'EOF_RUNSVC'
#!/usr/bin/env bash
exit 0
EOF_RUNSVC
cat > "${STORAGE_ROOT}/runner/config.sh" <<EOF_CONFIG
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "\$*" > "${CONFIG_LOG}"
touch .runner
EOF_CONFIG
chmod 0755 "${STORAGE_ROOT}/runner/bin/Runner.Listener" "${STORAGE_ROOT}/runner/bin/runsvc.sh" "${STORAGE_ROOT}/runner/config.sh"

cat > "${FAKE_BIN}/id" <<EOF_ID
#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  -u)
    if [[ \$# == 1 ]]; then echo 1000; exit 0; fi
    grep -qx "\$2" "${USERS_STATE}" || exit 1
    ;;
  -un) echo test-admin ;;
  -gn) echo test-admin ;;
  *) exec /usr/bin/id "\$@" ;;
esac
EOF_ID

cat > "${FAKE_BIN}/getent" <<EOF_GETENT
#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}:\${2:-}" in
  passwd:github-runner) echo 'github-runner:x:2001:2001::${STORAGE_ROOT}/home:/bin/bash' ;;
  passwd:agent-relay-builder) echo 'agent-relay-builder:x:2002:2002::${STORAGE_ROOT}/build-home:/usr/sbin/nologin' ;;
  group:sudo) echo 'sudo:x:27:' ;;
  *) exit 2 ;;
esac
EOF_GETENT

cat > "${FAKE_BIN}/sudo" <<EOF_SUDO
#!/usr/bin/env bash
set -euo pipefail
printf 'sudo %s\n' "\$*" >> "${COMMAND_LOG}"
if [[ "\${1:-}" == '-v' || "\${1:-}" == '-k' ]]; then exit 0; fi
if [[ "\${1:-}" == '-E' ]]; then shift; fi
while [[ "\${1:-}" == '-u' || "\${1:-}" == '-H' ]]; do
  if [[ "\$1" == '-u' ]]; then shift 2; else shift; fi
done
if [[ "\${1:-}" == 'sudo' && "\${2:-}" == '-n' ]]; then exit 1; fi
case "\${1:-}" in
  useradd)
    user="\${@: -1}"
    printf '%s\n' "\$user" >> "${USERS_STATE}"
    args=("\$@")
    for ((i=0; i<\${#args[@]}; i++)); do
      if [[ "\${args[i]}" == '--home-dir' ]]; then mkdir -p "\${args[i+1]}"; fi
    done
    ;;
  passwd|gpasswd|chown) exit 0 ;;
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

cat > "${FAKE_BIN}/ps" <<'EOF_PS'
#!/usr/bin/env bash
[[ "$*" == *'-p 1 -o comm='* ]] && { printf 'systemd\n'; exit 0; }
exec /bin/ps "$@"
EOF_PS
cat > "${FAKE_BIN}/uname" <<'EOF_UNAME'
#!/usr/bin/env bash
[[ "${1:-}" == '-m' ]] && { echo x86_64; exit 0; }
exec /usr/bin/uname "$@"
EOF_UNAME
cat > "${FAKE_BIN}/systemctl" <<EOF_SYSTEMCTL
#!/usr/bin/env bash
printf 'systemctl %s\n' "\$*" >> "${COMMAND_LOG}"
[[ "\${1:-}" == 'daemon-reload' ]]
EOF_SYSTEMCTL
cat > "${FAKE_BIN}/curl" <<'EOF_CURL'
#!/usr/bin/env bash
printf '%s\n' '{"token":"mock-value"}'
EOF_CURL
cat > "${FAKE_BIN}/jq" <<'EOF_JQ'
#!/usr/bin/env bash
cat >/dev/null
printf '%s\n' 'mock-value'
EOF_JQ
cat > "${FAKE_CODEX}" <<EOF_CODEX
#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == 'login' && "\${2:-}" == 'status' ]]; then [[ -f "${AUTH_STATE}" ]]; exit; fi
if [[ "\${1:-}" == 'login' ]]; then touch "${AUTH_STATE}"; exit 0; fi
exit 0
EOF_CODEX
chmod 0755 "${FAKE_BIN}"/* "${FAKE_CODEX}"

export HOME="${ADMIN_HOME}"
export PATH="${FAKE_BIN}:${PATH}"
printf 'mock-input\n' | bash "${TRANSFORMED_INSTALL}" > "${ROOT}/install.out" 2> "${ROOT}/install.err"

for path in agent-relay work runner home build build-home; do
  test -d "${STORAGE_ROOT}/${path}"
done
test -L "${STORAGE_ROOT}/runner/_work"
test "$(readlink "${STORAGE_ROOT}/runner/_work")" = '../work'
test -f "${SERVICE_ROOT}/actions.runner.Divorium.gh-runner.service"
grep -q "^ExecStart=${STORAGE_ROOT}/runner/runsvc.sh$" "${SERVICE_ROOT}/actions.runner.Divorium.gh-runner.service"
grep -q "^WorkingDirectory=${STORAGE_ROOT}/runner$" "${SERVICE_ROOT}/actions.runner.Divorium.gh-runner.service"
grep -q -- '--token mock-value' "${CONFIG_LOG}"
grep -q -- '--work _work' "${CONFIG_LOG}"
test -f "${AUTH_STATE}"
! grep -q 'systemctl enable' "${COMMAND_LOG}"
! grep -q 'systemctl start' "${COMMAND_LOG}"

printf 'install.sh system integration passed\n'
