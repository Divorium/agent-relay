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
SEED_ROOT="${ROOT}/seed"
RELEASE_ROOT="${ROOT}/release"
REMOTE_ROOT="${ROOT}/remote.git"
FAKE_BIN="${ROOT}/bin"
FAKE_JAVA_HOME="${ROOT}/opt-java-openjdk"
FAKE_GO_ROOT="${ROOT}/usr-local-go"
FAKE_RUST_CARGO_HOME="${ROOT}/opt-rust/cargo"
FAKE_RUST_BIN="${FAKE_RUST_CARGO_HOME}/bin"
FAKE_RUSTUP_HOME="${ROOT}/opt-rust/rustup"
ADMIN_FILE="${ROOT}/administrator"
LOG_FILE="${ROOT}/commands.log"
TOOLCHAIN_LOG="${ROOT}/toolchain.log"
NODE_TEST_LOG="${ROOT}/node-tests.log"
SERVICE_STATE="${ROOT}/service.state"
FAIL_NEXT_START="${ROOT}/fail-next-start"
FAIL_NEXT_BUILD="${ROOT}/fail-next-build"
FAIL_NEXT_TEST="${ROOT}/fail-next-test"
REAL_NODE="$(command -v node)"
ADMIN_HOME="${ROOT}/admin-home"
AMBIENT_PATH="${FAKE_BIN}:/usr/bin:/bin"
FIXTURE_SYSTEM_PATH="${FAKE_BIN}:/usr/local/bin:/usr/bin:/bin"

mkdir -p \
  "${SEED_ROOT}" \
  "${FAKE_BIN}" \
  "${FAKE_JAVA_HOME}/bin" \
  "${FAKE_GO_ROOT}/bin" \
  "${FAKE_RUST_BIN}" \
  "${FAKE_RUSTUP_HOME}" \
  "${ADMIN_HOME}" \
  "${STORAGE_ROOT}"
rsync -a --exclude=.git --exclude=node_modules --exclude=dist ./ "${SEED_ROOT}/"

BASE_ROOT="${BASE_ROOT}" ADMIN_FILE="${ADMIN_FILE}" SOURCE_ROOT="${SOURCE_ROOT}" \
python3 - "${SEED_ROOT}/update.sh" <<'PY'
import json
import os
import pathlib
import sys
path = pathlib.Path(sys.argv[1])
source = path.read_text()
source = source.replace("BASE_ROOT=/srv/github-runner", f"BASE_ROOT={json.dumps(os.environ['BASE_ROOT'])}")
source = source.replace("ADMIN_FILE=/etc/agent-relay/administrator", f"ADMIN_FILE={json.dumps(os.environ['ADMIN_FILE'])}")
source = source.replace('SCRIPT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"', f"SCRIPT_ROOT={json.dumps(os.environ['SOURCE_ROOT'])}")
path.write_text(source)
PY

FAKE_JAVA_HOME="${FAKE_JAVA_HOME}" FAKE_GO_ROOT="${FAKE_GO_ROOT}" \
FAKE_RUST_CARGO_HOME="${FAKE_RUST_CARGO_HOME}" FAKE_RUSTUP_HOME="${FAKE_RUSTUP_HOME}" \
FIXTURE_SYSTEM_PATH="${FIXTURE_SYSTEM_PATH}" \
python3 - "${SEED_ROOT}/scripts/toolchain-environment.sh" <<'PY'
import json
import os
import pathlib
import sys
path = pathlib.Path(sys.argv[1])
source = path.read_text()
replacements = {
    "TOOLCHAIN_JAVA_HOME=/opt/java/openjdk": "TOOLCHAIN_JAVA_HOME=" + json.dumps(os.environ["FAKE_JAVA_HOME"]),
    "TOOLCHAIN_GO_ROOT=/usr/local/go": "TOOLCHAIN_GO_ROOT=" + json.dumps(os.environ["FAKE_GO_ROOT"]),
    "TOOLCHAIN_RUST_CARGO_HOME=/opt/rust/cargo": "TOOLCHAIN_RUST_CARGO_HOME=" + json.dumps(os.environ["FAKE_RUST_CARGO_HOME"]),
    "TOOLCHAIN_RUSTUP_HOME=/opt/rust/rustup": "TOOLCHAIN_RUSTUP_HOME=" + json.dumps(os.environ["FAKE_RUSTUP_HOME"]),
    "TOOLCHAIN_SYSTEM_PATH=/usr/local/bin:/usr/bin:/bin": "TOOLCHAIN_SYSTEM_PATH=" + json.dumps(os.environ["FIXTURE_SYSTEM_PATH"]),
}
for old, new in replacements.items():
    if old not in source:
        raise SystemExit(f"missing profile assignment: {old}")
    source = source.replace(old, new)
path.write_text(source)
PY

git init --initial-branch=main "${SEED_ROOT}" >/dev/null
git -C "${SEED_ROOT}" add .
git -C "${SEED_ROOT}" -c user.name='Agent Relay Test' -c user.email=test@example.invalid commit -m initial >/dev/null
git clone --bare "${SEED_ROOT}" "${REMOTE_ROOT}" >/dev/null
git clone "${REMOTE_ROOT}" "${SOURCE_ROOT}" >/dev/null
git clone "${REMOTE_ROOT}" "${RELEASE_ROOT}" >/dev/null
python3 - "${RELEASE_ROOT}/update.sh" "${ROOT}/reexec.marker" <<'PY'
import json
import pathlib
import sys
path = pathlib.Path(sys.argv[1])
source = path.read_text()
marker = json.dumps(sys.argv[2])
source = source.replace(
    "set -euo pipefail\n",
    f"set -euo pipefail\nif [[ \"${{AGENT_RELAY_UPDATE_PHASE:-}}\" == reexec ]]; then printf 'reexec\\n' > {marker}; fi\n",
    1,
)
path.write_text(source)
PY
printf 'release two\n' > "${RELEASE_ROOT}/release-marker.txt"
git -C "${RELEASE_ROOT}" add update.sh release-marker.txt
git -C "${RELEASE_ROOT}" -c user.name='Agent Relay Test' -c user.email=test@example.invalid commit -m 'release two' >/dev/null
git -C "${RELEASE_ROOT}" push origin main >/dev/null

mkdir -p "${SOURCE_ROOT}/dist" "${BUILD_ROOT}" "${BUILD_HOME}"
printf 'old\n' > "${SOURCE_ROOT}/dist/old-runtime.js"
printf '%s\n' "$(id -un)" > "${ADMIN_FILE}"
: > "${LOG_FILE}"
: > "${TOOLCHAIN_LOG}"
: > "${NODE_TEST_LOG}"
printf 'active\n' > "${SERVICE_STATE}"

cat > "${FAKE_BIN}/ps" <<'EOF_PS'
#!/usr/bin/env bash
if [[ "$*" == *"-p 1 -o comm="* ]]; then
  printf 'systemd\n'
else
  exec /bin/ps "$@"
fi
EOF_PS

cat > "${FAKE_BIN}/systemctl" <<EOF_SYSTEMCTL
#!/usr/bin/env bash
set -euo pipefail
printf 'systemctl %s\n' "\$*" >> "${LOG_FILE}"
while [[ "\${1:-}" == -* ]]; do shift; done
case "\${1:-}" in
  is-active) grep -qx active "${SERVICE_STATE}" ;;
  stop) printf 'inactive\n' > "${SERVICE_STATE}" ;;
  start)
    if [[ -f "${FAIL_NEXT_START}" ]]; then
      rm -f "${FAIL_NEXT_START}"
      exit 1
    fi
    printf 'active\n' > "${SERVICE_STATE}"
    ;;
  daemon-reload|enable|status) ;;
  *) echo "unexpected systemctl command: \$*" >&2; exit 1 ;;
esac
EOF_SYSTEMCTL

cat > "${FAKE_BIN}/sudo" <<EOF_SUDO
#!/usr/bin/env bash
set -euo pipefail
printf 'sudo %s\n' "\$*" >> "${LOG_FILE}"
if [[ "\${1:-}" == "-v" || "\${1:-}" == "-k" ]]; then exit 0; fi
if [[ "\${1:-}" == "-n" ]]; then exit 1; fi
while [[ "\${1:-}" == "-u" || "\${1:-}" == "-H" ]]; do
  if [[ "\$1" == "-u" ]]; then shift 2; else shift; fi
done
if [[ -f "${FAIL_NEXT_BUILD}" && "\$*" == *'/node_modules/.bin/tsc '* ]]; then
  rm -f "${FAIL_NEXT_BUILD}"
  exit 1
fi
if [[ "\${1:-}" == "sudo" ]]; then shift; exec sudo "\$@"; fi
case "\${1:-}" in
  chown) exit 0 ;;
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

cat > "${FAKE_BIN}/check-toolchain-state" <<EOF_STATE
#!/usr/bin/env bash
set -euo pipefail
[[ "\${JAVA_HOME:-}" == "${FAKE_JAVA_HOME}" ]]
[[ "\${RUSTUP_HOME:-}" == "${FAKE_RUSTUP_HOME}" ]]
state_root="\${GOPATH%/go}"
[[ "\${state_root}" == "${BUILD_ROOT}"/state.* ]]
checks=(
  "CARGO_HOME:cargo"
  "GOPATH:go"
  "GOCACHE:go-cache"
  "GRADLE_USER_HOME:gradle"
  "NPM_CONFIG_CACHE:npm"
  "PIP_CACHE_DIR:pip"
  "XDG_CACHE_HOME:cache"
  "XDG_CONFIG_HOME:config"
  "XDG_DATA_HOME:data"
  "TMPDIR:tmp"
  "TMP:tmp"
  "TEMP:tmp"
)
for check in "\${checks[@]}"; do
  variable="\${check%%:*}"
  suffix="\${check#*:}"
  value="\${!variable:-}"
  [[ "\${value}" == "\${state_root}/\${suffix}" ]]
  [[ -d "\${value}" && -w "\${value}" ]]
done
printf '%s\n' "\${state_root}" >> "${TOOLCHAIN_LOG}"
EOF_STATE

cat > "${FAKE_BIN}/node" <<EOF_NODE
#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == '--test' ]]; then
  printf 'node %s\n' "\$*" >> "${NODE_TEST_LOG}"
  if [[ -f "${FAIL_NEXT_TEST}" ]]; then
    rm -f "${FAIL_NEXT_TEST}"
    exit 1
  fi
  exit 0
fi
exec "${REAL_NODE}" "\$@"
EOF_NODE
cat > "${FAKE_BIN}/codex" <<'EOF_CODEX'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then echo 'codex-cli 0.144.4'; fi
exit 0
EOF_CODEX
cat > "${FAKE_JAVA_HOME}/bin/java" <<EOF_JAVA
#!/usr/bin/env bash
"${FAKE_BIN}/check-toolchain-state"
if [[ "\${1:-}" == '-version' ]]; then echo 'openjdk version "21.0.11" 2026-04-21 LTS' >&2; fi
EOF_JAVA
cat > "${FAKE_GO_ROOT}/bin/go" <<EOF_GO
#!/usr/bin/env bash
"${FAKE_BIN}/check-toolchain-state"
echo 'go version go1.24.5 linux/amd64'
EOF_GO
cat > "${FAKE_RUST_BIN}/rustc" <<EOF_RUSTC
#!/usr/bin/env bash
"${FAKE_BIN}/check-toolchain-state"
echo 'rustc 1.90.0 (mock)'
EOF_RUSTC
cat > "${FAKE_RUST_BIN}/cargo" <<EOF_CARGO
#!/usr/bin/env bash
"${FAKE_BIN}/check-toolchain-state"
echo 'cargo 1.90.0 (mock)'
EOF_CARGO
cat > "${FAKE_RUST_BIN}/rustup" <<EOF_RUSTUP
#!/usr/bin/env bash
"${FAKE_BIN}/check-toolchain-state"
if [[ "\${1:-}" == 'show' && "\${2:-}" == 'active-toolchain' ]]; then
  echo 'stable-x86_64-unknown-linux-gnu (default)'
  exit 0
fi
exit 0
EOF_RUSTUP
cat > "${FAKE_BIN}/git" <<'EOF_GIT'
#!/usr/bin/env bash
if [[ "${1:-}" == "lfs" ]]; then echo 'git-lfs/3.7.0 (mock)'; exit 0; fi
exec /usr/bin/git "$@"
EOF_GIT
chmod 0700 \
  "${FAKE_BIN}"/* \
  "${FAKE_JAVA_HOME}/bin/java" \
  "${FAKE_GO_ROOT}/bin/go" \
  "${FAKE_RUST_BIN}"/*

if PATH="${AMBIENT_PATH}" command -v go >/dev/null 2>&1; then
  echo 'Ambient update PATH unexpectedly resolves go' >&2
  exit 1
fi
if PATH="${AMBIENT_PATH}" command -v rustc >/dev/null 2>&1; then
  echo 'Ambient update PATH unexpectedly resolves rustc' >&2
  exit 1
fi

export HOME="${ADMIN_HOME}"
export XDG_CONFIG_HOME="${ADMIN_HOME}/.config"
export NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-${ADMIN_HOME}/.npm}"
export PATH="${AMBIENT_PATH}"
export USER="$(id -un)"

run_update() {
  (cd "${SOURCE_ROOT}" && bash "${SOURCE_ROOT}/update.sh")
}

run_update > "${ROOT}/update-success.out" 2> "${ROOT}/update-success.err"
test "$(cat "${SOURCE_ROOT}/release-marker.txt")" = 'release two'
test -f "${SOURCE_ROOT}/dist/src/run-codex.js"
test ! -e "${SOURCE_ROOT}/dist/old-runtime.js"
test -d "${STORAGE_ROOT}/build"
test -d "${STORAGE_ROOT}/build-home"
test ! -d "${BASE_ROOT}/build"
test ! -d "${BASE_ROOT}/build-home"
grep -qx active "${SERVICE_STATE}"
grep -q 'systemctl stop' "${LOG_FILE}"
grep -q 'systemctl enable' "${LOG_FILE}"
grep -q 'systemctl start' "${LOG_FILE}"
grep -q 'Agent Relay updated successfully' "${ROOT}/update-success.out"
grep -q 'go version go1.24.5 linux/amd64' "${ROOT}/update-success.out"
grep -q 'rustc 1.90.0 (mock)' "${ROOT}/update-success.out"
grep -q 'cargo 1.90.0 (mock)' "${ROOT}/update-success.out"
grep -q '^node --test --test-concurrency=1 ' "${NODE_TEST_LOG}"
test -s "${TOOLCHAIN_LOG}"

mapfile -t builder_lines < <(grep '^sudo -u agent-relay-builder ' "${LOG_FILE}" | grep -v ' sudo -n true$')
(( ${#builder_lines[@]} > 0 ))
for builder_line in "${builder_lines[@]}"; do
  [[ "${builder_line}" == *' -H /usr/bin/env -i '* ]] || {
    echo "Builder command bypassed the clean toolchain environment: ${builder_line}" >&2
    exit 1
  }
  for binding in \
    "USER=agent-relay-builder" \
    "HOME=${BUILD_HOME}" \
    "JAVA_HOME=${FAKE_JAVA_HOME}" \
    "RUSTUP_HOME=${FAKE_RUSTUP_HOME}"; do
    [[ "${builder_line}" == *" ${binding} "* ]] || {
      echo "Builder command omitted ${binding}: ${builder_line}" >&2
      exit 1
    }
  done
done

grep -qx reexec "${ROOT}/reexec.marker"

SUCCESSFUL_HEAD="$(git -C "${SOURCE_ROOT}" rev-parse HEAD)"
SUCCESSFUL_RUNTIME_SHA="$(sha256sum "${SOURCE_ROOT}/dist/src/run-codex.js" | cut -d' ' -f1)"
TEST_INVOCATIONS="$(wc -l < "${NODE_TEST_LOG}")"
printf 'release with simulated test failure\n' > "${RELEASE_ROOT}/release-test-broken.txt"
git -C "${RELEASE_ROOT}" add release-test-broken.txt
git -C "${RELEASE_ROOT}" -c user.name='Agent Relay Test' -c user.email=test@example.invalid commit -m 'release with simulated test failure' >/dev/null
git -C "${RELEASE_ROOT}" push origin main >/dev/null
printf '1\n' > "${FAIL_NEXT_TEST}"
if run_update > "${ROOT}/test-failure.out" 2> "${ROOT}/test-failure.err"; then
  echo 'Test failure unexpectedly succeeded' >&2
  exit 1
fi
test "$(git -C "${SOURCE_ROOT}" rev-parse HEAD)" = "${SUCCESSFUL_HEAD}"
test "$(sha256sum "${SOURCE_ROOT}/dist/src/run-codex.js" | cut -d' ' -f1)" = "${SUCCESSFUL_RUNTIME_SHA}"
test ! -e "${SOURCE_ROOT}/release-test-broken.txt"
test ! -e "${FAIL_NEXT_TEST}"
test "$(wc -l < "${NODE_TEST_LOG}")" -eq "$((TEST_INVOCATIONS + 1))"
grep -qx active "${SERVICE_STATE}"

printf 'release with simulated build failure\n' > "${RELEASE_ROOT}/release-broken.txt"
git -C "${RELEASE_ROOT}" add release-broken.txt
git -C "${RELEASE_ROOT}" -c user.name='Agent Relay Test' -c user.email=test@example.invalid commit -m 'release with simulated build failure' >/dev/null
git -C "${RELEASE_ROOT}" push origin main >/dev/null
printf '1\n' > "${FAIL_NEXT_BUILD}"
if run_update > "${ROOT}/update-failure.out" 2> "${ROOT}/update-failure.err"; then
  echo 'Build failure unexpectedly succeeded' >&2
  exit 1
fi
test "$(git -C "${SOURCE_ROOT}" rev-parse HEAD)" = "${SUCCESSFUL_HEAD}"
test "$(sha256sum "${SOURCE_ROOT}/dist/src/run-codex.js" | cut -d' ' -f1)" = "${SUCCESSFUL_RUNTIME_SHA}"
test ! -e "${SOURCE_ROOT}/release-broken.txt"
grep -qx active "${SERVICE_STATE}"

printf 'release three\n' > "${RELEASE_ROOT}/release-three.txt"
git -C "${RELEASE_ROOT}" add -A
git -C "${RELEASE_ROOT}" -c user.name='Agent Relay Test' -c user.email=test@example.invalid commit -m 'release three' >/dev/null
git -C "${RELEASE_ROOT}" push origin main >/dev/null
printf '1\n' > "${FAIL_NEXT_START}"
if run_update > "${ROOT}/service-failure.out" 2> "${ROOT}/service-failure.err"; then
  echo 'Service-start failure unexpectedly succeeded' >&2
  exit 1
fi
test "$(git -C "${SOURCE_ROOT}" rev-parse HEAD)" = "${SUCCESSFUL_HEAD}"
test "$(sha256sum "${SOURCE_ROOT}/dist/src/run-codex.js" | cut -d' ' -f1)" = "${SUCCESSFUL_RUNTIME_SHA}"
test ! -e "${SOURCE_ROOT}/release-three.txt"
grep -qx active "${SERVICE_STATE}"

printf 'update.sh system integration passed\n'
