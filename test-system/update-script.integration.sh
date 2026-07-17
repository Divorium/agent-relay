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
FAKE_GO_BIN="${ROOT}/usr-local-go-bin"
ADMIN_FILE="${ROOT}/administrator"
LOG_FILE="${ROOT}/commands.log"
GO_LOG="${ROOT}/go.log"
SERVICE_STATE="${ROOT}/service.state"
FAIL_NEXT_START="${ROOT}/fail-next-start"
FAIL_NEXT_BUILD="${ROOT}/fail-next-build"
FAST_VALIDATION="${ROOT}/fast-validation"
REAL_NODE="$(command -v node)"
ADMIN_HOME="${ROOT}/admin-home"
AMBIENT_PATH="${FAKE_BIN}:/usr/bin:/bin"
BUILDER_PATH_FIXTURE="${FAKE_GO_BIN}:${FAKE_BIN}:/usr/local/bin:/usr/bin:/bin"

mkdir -p "${SEED_ROOT}" "${FAKE_BIN}" "${FAKE_GO_BIN}" "${ADMIN_HOME}" "${STORAGE_ROOT}"
rsync -a --exclude=.git --exclude=node_modules --exclude=dist ./ "${SEED_ROOT}/"
BASE_ROOT="${BASE_ROOT}" ADMIN_FILE="${ADMIN_FILE}" SOURCE_ROOT="${SOURCE_ROOT}" \
BUILDER_PATH_FIXTURE="${BUILDER_PATH_FIXTURE}" \
python3 - "${SEED_ROOT}/update.sh" <<'PY'
import json
import os
import pathlib
import sys
path = pathlib.Path(sys.argv[1])
source = path.read_text()
source = source.replace("BASE_ROOT=/srv/github-runner", f"BASE_ROOT={json.dumps(os.environ['BASE_ROOT'])}")
source = source.replace("ADMIN_FILE=/etc/agent-relay/administrator", f"ADMIN_FILE={json.dumps(os.environ['ADMIN_FILE'])}")
source = source.replace(
    "BUILDER_PATH=/opt/java/openjdk/bin:/usr/local/go/bin:/opt/rust/cargo/bin:/usr/local/bin:/usr/bin:/bin",
    f"BUILDER_PATH={json.dumps(os.environ['BUILDER_PATH_FIXTURE'])}",
)
source = source.replace('SCRIPT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"', f"SCRIPT_ROOT={json.dumps(os.environ['SOURCE_ROOT'])}")
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
: > "${GO_LOG}"
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

cat > "${FAKE_BIN}/node" <<EOF_NODE
#!/usr/bin/env bash
if [[ -f "${FAST_VALIDATION}" && "\${1:-}" == '--test' ]]; then exit 0; fi
exec "${REAL_NODE}" "\$@"
EOF_NODE
cat > "${FAKE_BIN}/codex" <<'EOF_CODEX'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then echo 'codex-cli 0.144.4'; fi
exit 0
EOF_CODEX
cat > "${FAKE_GO_BIN}/go" <<EOF_GO
#!/usr/bin/env bash
printf '%s\n' "\$0" >> "${GO_LOG}"
echo 'go version go1.24.5 linux/amd64'
EOF_GO
cat > "${FAKE_BIN}/rustc" <<'EOF_RUSTC'
#!/usr/bin/env bash
echo 'rustc 1.90.0 (mock)'
EOF_RUSTC
cat > "${FAKE_BIN}/cargo" <<'EOF_CARGO'
#!/usr/bin/env bash
echo 'cargo 1.90.0 (mock)'
EOF_CARGO
cat > "${FAKE_BIN}/git" <<'EOF_GIT'
#!/usr/bin/env bash
if [[ "${1:-}" == "lfs" ]]; then echo 'git-lfs/3.7.0 (mock)'; exit 0; fi
exec /usr/bin/git "$@"
EOF_GIT
chmod 0700 "${FAKE_BIN}"/* "${FAKE_GO_BIN}/go"

if PATH="${AMBIENT_PATH}" command -v go >/dev/null 2>&1; then
  echo 'Ambient update PATH unexpectedly resolves go' >&2
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
grep -qx "${FAKE_GO_BIN}/go" "${GO_LOG}"
grep -Fq "sudo -u agent-relay-builder -H env HOME=${BUILD_HOME} PATH=${BUILDER_PATH_FIXTURE}" "${LOG_FILE}"
if grep -F 'sudo -u agent-relay-builder -H env ' "${LOG_FILE}" \
  | grep -v -F "PATH=${BUILDER_PATH_FIXTURE}" >/dev/null; then
  echo 'A builder command did not receive the deterministic toolchain PATH' >&2
  exit 1
fi
grep -qx reexec "${ROOT}/reexec.marker"

SUCCESSFUL_HEAD="$(git -C "${SOURCE_ROOT}" rev-parse HEAD)"
SUCCESSFUL_RUNTIME_SHA="$(sha256sum "${SOURCE_ROOT}/dist/src/run-codex.js" | cut -d' ' -f1)"
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

rm "${RELEASE_ROOT}/release-broken.txt"
printf 'release three\n' > "${RELEASE_ROOT}/release-three.txt"
git -C "${RELEASE_ROOT}" add -A
git -C "${RELEASE_ROOT}" -c user.name='Agent Relay Test' -c user.email=test@example.invalid commit -m 'release three' >/dev/null
git -C "${RELEASE_ROOT}" push origin main >/dev/null
printf '1\n' > "${FAST_VALIDATION}"
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
