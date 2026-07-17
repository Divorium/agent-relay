#!/usr/bin/env bash
set -euo pipefail

ROOT="$(mktemp -d /tmp/agent-relay-install.XXXXXX)"
cleanup() { rm -rf -- "${ROOT}"; }
trap cleanup EXIT

BASE_ROOT="${ROOT}/srv/github-runner"
STORAGE_ROOT="${BASE_ROOT}/storage"
SOURCE_ROOT="${STORAGE_ROOT}/agent-relay"
FAKE_BIN="${ROOT}/bin"
FAKE_LOCAL_BIN="${ROOT}/usr-local/bin"
FAKE_GO_ROOT="${ROOT}/usr-local/go"
FAKE_RUST_ROOT="${ROOT}/opt/rust"
FAKE_JAVA_ROOT="${ROOT}/opt/java"
FAKE_ETC="${ROOT}/etc"
CONFIG_ROOT="${FAKE_ETC}/agent-relay"
SERVICE_ROOT="${FAKE_ETC}/systemd/system"
NEEDRESTART_ROOT="${FAKE_ETC}/needrestart/conf.d"
USERS_STATE="${ROOT}/users.state"
COMMAND_LOG="${ROOT}/commands.log"
CONFIG_LOG="${ROOT}/config.log"
AUTH_STATE="${ROOT}/codex-authenticated"
TRANSFORMED_INSTALL="${ROOT}/install-under-test.sh"
RUNNER_ARCHIVE="${ROOT}/runner.tar.gz"
ADMIN_HOME="${ROOT}/admin-home"

mkdir -p "${SOURCE_ROOT}" "${FAKE_BIN}" "${FAKE_LOCAL_BIN}" "${FAKE_GO_ROOT}/bin" \
  "${FAKE_RUST_ROOT}/cargo/bin" "${FAKE_JAVA_ROOT}" "${SERVICE_ROOT}" "${NEEDRESTART_ROOT}" "${ADMIN_HOME}"
rsync -a --exclude=.git --exclude=node_modules --exclude=dist ./ "${SOURCE_ROOT}/"
git init --initial-branch=main "${SOURCE_ROOT}" >/dev/null
git -C "${SOURCE_ROOT}" add .
git -C "${SOURCE_ROOT}" -c user.name='Agent Relay Test' -c user.email=test@example.invalid commit -m initial >/dev/null
: > "${USERS_STATE}"
: > "${COMMAND_LOG}"

RUNNER_PAYLOAD="${ROOT}/runner-payload"
mkdir -p "${RUNNER_PAYLOAD}/bin"
cat > "${RUNNER_PAYLOAD}/bin/Runner.Listener" <<'EOF_LISTENER'
#!/usr/bin/env bash
exit 0
EOF_LISTENER
cat > "${RUNNER_PAYLOAD}/bin/runsvc.sh" <<'EOF_RUNSVC'
#!/usr/bin/env bash
exit 0
EOF_RUNSVC
cat > "${RUNNER_PAYLOAD}/bin/installdependencies.sh" <<EOF_DEPS
#!/usr/bin/env bash
printf 'runner dependencies\\n' >> "${COMMAND_LOG}"
EOF_DEPS
cat > "${RUNNER_PAYLOAD}/config.sh" <<EOF_CONFIG
#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "\$*" > "${CONFIG_LOG}"
touch .runner
EOF_CONFIG
chmod 0755 "${RUNNER_PAYLOAD}/bin/Runner.Listener" "${RUNNER_PAYLOAD}/bin/runsvc.sh" \
  "${RUNNER_PAYLOAD}/bin/installdependencies.sh" "${RUNNER_PAYLOAD}/config.sh"
tar -C "${RUNNER_PAYLOAD}" -czf "${RUNNER_ARCHIVE}" .
RUNNER_SHA256="$(sha256sum "${RUNNER_ARCHIVE}" | cut -d' ' -f1)"

cat > "${FAKE_BIN}/id" <<EOF_ID
#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  -u)
    if [[ \$# == 1 ]]; then echo 1000; exit 0; fi
    grep -qx "\$2" "${USERS_STATE}" || exit 1
    [[ "\$2" == github-runner ]] && echo 2001 || echo 2002
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
  passwd:github-runner) echo 'github-runner:x:2001:2001::${BASE_ROOT}/home:/bin/bash' ;;
  passwd:agent-relay-builder) echo 'agent-relay-builder:x:2002:2002::${BASE_ROOT}/build-home:/usr/sbin/nologin' ;;
  group:sudo) echo 'sudo:x:27:' ;;
  *) exit 2 ;;
esac
EOF_GETENT

cat > "${FAKE_BIN}/sudo" <<EOF_SUDO
#!/usr/bin/env bash
set -euo pipefail
printf 'sudo %s\\n' "\$*" >> "${COMMAND_LOG}"
if [[ "\${1:-}" == '-v' || "\${1:-}" == '-k' ]]; then exit 0; fi
if [[ "\${1:-}" == '-E' ]]; then shift; fi
while [[ "\${1:-}" == '-u' || "\${1:-}" == '-H' ]]; do
  if [[ "\$1" == '-u' ]]; then shift 2; else shift; fi
done
if [[ "\${1:-}" == 'sudo' && "\${2:-}" == '-n' ]]; then exit 1; fi
case "\${1:-}" in
  apt-get) exit 0 ;;
  useradd)
    user="\${@: -1}"
    printf '%s\\n' "\$user" >> "${USERS_STATE}"
    home=''
    args=("\$@")
    for ((i=0; i<\${#args[@]}; i++)); do
      if [[ "\${args[i]}" == '--home-dir' ]]; then home="\${args[i+1]}"; fi
    done
    mkdir -p "\$home"
    ;;
  passwd|gpasswd|chown) exit 0 ;;
  find)
    if printf '%s\\n' "\$*" | grep -q -- '-exec chown'; then exit 0; fi
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
  env) shift; exec /usr/bin/env "\$@" ;;
  *) exec "\$@" ;;
esac
EOF_SUDO

cat > "${FAKE_BIN}/ps" <<'EOF_PS'
#!/usr/bin/env bash
if [[ "$*" == *'-p 1 -o comm='* ]]; then printf 'systemd\n'; else exec /bin/ps "$@"; fi
EOF_PS
cat > "${FAKE_BIN}/uname" <<'EOF_UNAME'
#!/usr/bin/env bash
[[ "${1:-}" == '-m' ]] && { echo x86_64; exit 0; }
exec /usr/bin/uname "$@"
EOF_UNAME
cat > "${FAKE_BIN}/systemctl" <<EOF_SYSTEMCTL
#!/usr/bin/env bash
printf 'systemctl %s\\n' "\$*" >> "${COMMAND_LOG}"
[[ "\${1:-}" == 'daemon-reload' ]]
EOF_SYSTEMCTL
cat > "${FAKE_BIN}/curl" <<EOF_CURL
#!/usr/bin/env bash
set -euo pipefail
printf 'curl %s\\n' "\$*" >> "${COMMAND_LOG}"
out=''
url=''
while (( \$# > 0 )); do
  case "\$1" in
    -o) out="\$2"; shift 2 ;;
    -H)
      if [[ "\$2" == '@-' ]]; then
        IFS= read -r header
        [[ "\$header" == 'Authorization: Bearer test-pat' ]]
      fi
      shift 2
      ;;
    -*) shift ;;
    *) url="\$1"; shift ;;
  esac
done
case "\$url" in
  https://api.github.com/meta) exit 0 ;;
  *'/actions/runners/registration-token') printf '%s\\n' '{"token":"runner-registration-token"}' ;;
  *'actions-runner-linux-x64-'*) cp "${RUNNER_ARCHIVE}" "\$out" ;;
  *) echo "unexpected curl URL: \$url" >&2; exit 1 ;;
esac
EOF_CURL
cat > "${FAKE_BIN}/git" <<EOF_GIT
#!/usr/bin/env bash
if [[ "\${1:-}" == lfs ]]; then printf 'git-lfs mock\\n' >> "${COMMAND_LOG}"; exit 0; fi
exec /usr/bin/git "\$@"
EOF_GIT

cat > "${FAKE_BIN}/node" <<'EOF_NODE'
#!/usr/bin/env bash
[[ "${1:-}" == '--version' ]] && { echo v22.16.0; exit 0; }
exec /opt/nvm/versions/node/v22.16.0/bin/node "$@"
EOF_NODE
cat > "${FAKE_BIN}/npm" <<EOF_NPM
#!/usr/bin/env bash
printf 'npm %s\\n' "\$*" >> "${COMMAND_LOG}"
exit 0
EOF_NPM
cat > "${FAKE_BIN}/java" <<'EOF_JAVA'
#!/usr/bin/env bash
echo 'openjdk version "21.0.1"' >&2
EOF_JAVA
cat > "${FAKE_BIN}/javac" <<'EOF_JAVAC'
#!/usr/bin/env bash
exit 0
EOF_JAVAC
cat > "${FAKE_BIN}/go" <<'EOF_GO'
#!/usr/bin/env bash
echo 'go version go1.24.5 linux/amd64'
EOF_GO
cp "${FAKE_BIN}/go" "${FAKE_GO_ROOT}/bin/go"
cat > "${FAKE_BIN}/rustc" <<'EOF_RUSTC'
#!/usr/bin/env bash
exit 0
EOF_RUSTC
cat > "${FAKE_LOCAL_BIN}/codex" <<EOF_CODEX
#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == 'login' && "\${2:-}" == 'status' ]]; then [[ -f "${AUTH_STATE}" ]]; exit; fi
if [[ "\${1:-}" == 'login' ]]; then touch "${AUTH_STATE}"; exit 0; fi
if [[ "\${1:-}" == '--version' ]]; then echo 'codex-cli 0.144.4'; exit 0; fi
exit 0
EOF_CODEX
cat > "${FAKE_LOCAL_BIN}/tsc" <<'EOF_TSC'
#!/usr/bin/env bash
echo 'Version 5.8.3'
EOF_TSC
for tool in cargo rustdoc rustup; do
  cat > "${FAKE_RUST_ROOT}/cargo/bin/${tool}" <<EOF_TOOL
#!/usr/bin/env bash
exit 0
EOF_TOOL
done
cp "${FAKE_BIN}/rustc" "${FAKE_RUST_ROOT}/cargo/bin/rustc"
chmod 0755 "${FAKE_BIN}"/* "${FAKE_LOCAL_BIN}"/* "${FAKE_GO_ROOT}/bin/go" "${FAKE_RUST_ROOT}/cargo/bin"/*

RUNNER_SHA256="${RUNNER_SHA256}" BASE_ROOT="${BASE_ROOT}" CONFIG_ROOT="${CONFIG_ROOT}" \
SOURCE_ROOT="${SOURCE_ROOT}" FAKE_BIN="${FAKE_BIN}" FAKE_LOCAL_BIN="${FAKE_LOCAL_BIN}" \
FAKE_GO_ROOT="${FAKE_GO_ROOT}" FAKE_RUST_ROOT="${FAKE_RUST_ROOT}" FAKE_JAVA_ROOT="${FAKE_JAVA_ROOT}" \
SERVICE_ROOT="${SERVICE_ROOT}" NEEDRESTART_ROOT="${NEEDRESTART_ROOT}" \
python3 - "${SOURCE_ROOT}/install.sh" "${TRANSFORMED_INSTALL}" <<'PY'
import json
import os
import pathlib
import sys
source = pathlib.Path(sys.argv[1]).read_text()
replacements = {
    'RUNNER_SHA256=4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf': f"RUNNER_SHA256={os.environ['RUNNER_SHA256']}",
    'BASE_ROOT=/srv/github-runner': f"BASE_ROOT={json.dumps(os.environ['BASE_ROOT'])}",
    'CONFIG_ROOT=/etc/agent-relay': f"CONFIG_ROOT={json.dumps(os.environ['CONFIG_ROOT'])}",
    'SOURCE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"': f"SOURCE_ROOT={json.dumps(os.environ['SOURCE_ROOT'])}",
    '/etc/systemd/system': os.environ['SERVICE_ROOT'],
    '/etc/needrestart/conf.d': os.environ['NEEDRESTART_ROOT'],
    '/usr/bin/node': f"{os.environ['FAKE_BIN']}/node",
    '/usr/bin/npm': f"{os.environ['FAKE_BIN']}/npm",
    '/usr/bin/java': f"{os.environ['FAKE_BIN']}/java",
    '/usr/bin/javac': f"{os.environ['FAKE_BIN']}/javac",
    '/usr/local/go': os.environ['FAKE_GO_ROOT'],
    '/opt/rust': os.environ['FAKE_RUST_ROOT'],
    '/opt/java': os.environ['FAKE_JAVA_ROOT'],
    '/usr/local/bin': os.environ['FAKE_LOCAL_BIN'],
}
for old, new in replacements.items():
    source = source.replace(old, new)
pathlib.Path(sys.argv[2]).write_text(source)
PY
chmod 0700 "${TRANSFORMED_INSTALL}"

export HOME="${ADMIN_HOME}"
export PATH="${FAKE_BIN}:${PATH}"
printf 'test-pat\n' | bash "${TRANSFORMED_INSTALL}" > "${ROOT}/install.out" 2> "${ROOT}/install.err"

test -x "${BASE_ROOT}/runner/bin/Runner.Listener"
test -f "${BASE_ROOT}/runner/.runner"
test -L "${BASE_ROOT}/runner/_work"
test "$(readlink "${BASE_ROOT}/runner/_work")" = '../storage/work'
test -d "${BASE_ROOT}/storage/work"
test -f "${SERVICE_ROOT}/actions.runner.Divorium.gh-runner.service"
grep -q '^User=github-runner$' "${SERVICE_ROOT}/actions.runner.Divorium.gh-runner.service"
grep -q "^ExecStart=${BASE_ROOT}/runner/runsvc.sh$" "${SERVICE_ROOT}/actions.runner.Divorium.gh-runner.service"
grep -q -- '--url https://github.com/Divorium' "${CONFIG_LOG}"
grep -q -- '--token runner-registration-token' "${CONFIG_LOG}"
grep -q -- '--name gh-runner' "${CONFIG_LOG}"
grep -q -- '--work _work' "${CONFIG_LOG}"
! grep -q -- '--labels' "${CONFIG_LOG}"
grep -qx test-admin "${CONFIG_ROOT}/administrator"
test -f "${AUTH_STATE}"
grep -q 'runner dependencies' "${COMMAND_LOG}"
grep -q 'systemctl daemon-reload' "${COMMAND_LOG}"
! grep -q 'systemctl enable' "${COMMAND_LOG}"
! grep -q 'systemctl start' "${COMMAND_LOG}"
! grep -q 'test-pat' "${COMMAND_LOG}"
grep -q 'Run `./update.sh`' "${ROOT}/install.out"

printf 'install.sh system integration passed\n'
