#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/agent-relay-install-integration.XXXXXX")"
cleanup() {
  rm -rf -- "${TEST_ROOT}"
}
trap cleanup EXIT

prepare_case() {
  local name=$1 preinstall_runner=${2:-0}
  local case_root="${TEST_ROOT}/${name}"
  local base_root="${case_root}/srv/github-runner"
  local storage_root="${base_root}/storage"
  local source_root="${storage_root}/agent-relay"
  local runner_root="${storage_root}/runner"
  local work_root="${storage_root}/work"
  local runner_home="${storage_root}/home"
  local build_home="${storage_root}/build-home"
  local docker_root="${storage_root}/docker/engine"
  local containerd_root="${storage_root}/docker/containerd"
  local fake_bin="${case_root}/bin"
  local state_root="${case_root}/state"
  local etc_root="${case_root}/etc"
  local lock_root="${case_root}/var/lib/agent-relay"

  mkdir -p "${source_root}" "${runner_root}" "${work_root}" "${runner_home}" \
    "${build_home}/tmp" "${docker_root}" "${containerd_root}" "${fake_bin}" \
    "${state_root}" "${etc_root}/systemd/system" "${etc_root}/docker" \
    "${etc_root}/containerd" "${lock_root}"
  chmod 0755 "${base_root}" "${storage_root}" "${source_root}" "${lock_root}"
  chmod 0700 "${runner_root}" "${work_root}" "${runner_home}" "${build_home}" "${build_home}/tmp"
  chmod 0711 "${storage_root}/docker" "${docker_root}" "${containerd_root}"
  : >"${lock_root}/install.lock"
  chmod 0600 "${lock_root}/install.lock"
  printf '{"data-root":"%s"}\n' "${docker_root}" >"${etc_root}/docker/daemon.json"
  printf 'version = 2\nroot = "%s"\nstate = "/run/containerd"\n' "${containerd_root}" >"${etc_root}/containerd/config.toml"
  chmod 0644 "${etc_root}/docker/daemon.json" "${etc_root}/containerd/config.toml"
  cat >"${etc_root}/os-release" <<'EOF_OS_RELEASE'
ID=debian
VERSION_ID="13"
VERSION_CODENAME=trixie
EOF_OS_RELEASE

  mkdir -p "${source_root}/config" "${source_root}/runner" "${source_root}/scripts"
  cp "${REPOSITORY_ROOT}/install.sh" "${REPOSITORY_ROOT}/package.json" \
    "${REPOSITORY_ROOT}/tsconfig.runtime.json" "${source_root}/"
  cp "${REPOSITORY_ROOT}/config/runner-host.json" "${source_root}/config/"
  cp "${REPOSITORY_ROOT}/runner/finalize.sh" "${REPOSITORY_ROOT}/runner/resolve-pr.mjs" \
    "${REPOSITORY_ROOT}/runner/resolve-plan.mjs" "${REPOSITORY_ROOT}/runner/resolve-request.mjs" \
    "${REPOSITORY_ROOT}/runner/run-codex.mjs" "${source_root}/runner/"
  cp "${REPOSITORY_ROOT}/scripts/codex-run" "${REPOSITORY_ROOT}/scripts/host-config.sh" \
    "${REPOSITORY_ROOT}/scripts/host-toolchain-check.sh" "${REPOSITORY_ROOT}/scripts/toolchain-environment.sh" \
    "${REPOSITORY_ROOT}/scripts/toolchain-smoke.sh" "${source_root}/scripts/"
  chmod 0755 "${source_root}"

  python3 - "${source_root}/config/runner-host.json" "${base_root}" <<'PY'
import json
import pathlib
import sys
path = pathlib.Path(sys.argv[1])
data = json.loads(path.read_text())
data["base_root"] = sys.argv[2]
path.write_text(json.dumps(data, indent=2) + "\n")
PY

  python3 - "${source_root}/install.sh" "${lock_root}" "${etc_root}" "${fake_bin}" <<'PY'
import pathlib
import sys
path = pathlib.Path(sys.argv[1])
source = path.read_text()
replacements = {
    "LOCK_ROOT=/var/lib/agent-relay": f"LOCK_ROOT={sys.argv[2]!r}",
    "/etc/systemd/system": f"{sys.argv[3]}/systemd/system",
    "/etc/docker/daemon.json": f"{sys.argv[3]}/docker/daemon.json",
    "/etc/containerd/config.toml": f"{sys.argv[3]}/containerd/config.toml",
    "/etc/os-release": f"{sys.argv[3]}/os-release",
    "/usr/local/bin/tsc": f"{sys.argv[4]}/tsc",
    "/usr/bin/node": f"{sys.argv[4]}/node",
}
for old, new in replacements.items():
    source = source.replace(old, new)
source = source.replace(
    '''stat_uid() { stat -c '%u' -- "$1"; }
stat_gid() { stat -c '%g' -- "$1"; }
stat_mode() { stat -c '%a' -- "$1"; }
sudo_stat_uid() { sudo -n stat -c '%u' -- "$1"; }
sudo_stat_gid() { sudo -n stat -c '%g' -- "$1"; }
sudo_stat_mode() { sudo -n stat -c '%a' -- "$1"; }''',
    '''stat_uid() {
  case "$1" in
    "${LOCK_FILE}") echo 1000 ;;
    "${SOURCE_ROOT}/dist"|"${SOURCE_ROOT}/dist/"*|"${SOURCE_ROOT}/.dist.stage."*|"${SOURCE_ROOT}/.dist.stage."*/*) echo 0 ;;
    "${SOURCE_ROOT}"|"${SOURCE_ROOT}/"*) echo 1000 ;;
    "${RUNNER_DIR}"|"${RUNNER_DIR}/"*|"${WORK_ROOT}"|"${WORK_ROOT}/"*|"${RUNNER_HOME}"|"${RUNNER_HOME}/"*) echo 2001 ;;
    "${BUILD_HOME}"|"${BUILD_HOME}/"*) echo 2002 ;;
    *) /usr/bin/stat -c '%u' -- "$1" ;;
  esac
}
stat_gid() {
  case "$1" in
    "${LOCK_FILE}") echo 1000 ;;
    "${SOURCE_ROOT}/dist"|"${SOURCE_ROOT}/dist/"*|"${SOURCE_ROOT}/.dist.stage."*|"${SOURCE_ROOT}/.dist.stage."*/*) echo 0 ;;
    "${SOURCE_ROOT}"|"${SOURCE_ROOT}/"*) echo 1000 ;;
    "${RUNNER_DIR}"|"${RUNNER_DIR}/"*|"${WORK_ROOT}"|"${WORK_ROOT}/"*|"${RUNNER_HOME}"|"${RUNNER_HOME}/"*) echo 2001 ;;
    "${BUILD_HOME}"|"${BUILD_HOME}/"*) echo 2002 ;;
    *) /usr/bin/stat -c '%g' -- "$1" ;;
  esac
}
stat_mode() { /usr/bin/stat -c '%a' -- "$1"; }
sudo_stat_uid() { stat_uid "$1"; }
sudo_stat_gid() { stat_gid "$1"; }
sudo_stat_mode() { stat_mode "$1"; }'''
)
path.write_text(source)
PY
  chmod 0755 "${source_root}/install.sh"

  cat >"${source_root}/scripts/toolchain-environment.sh" <<EOF_TOOLCHAIN
#!/usr/bin/env bash
TOOLCHAIN_JAVA_HOME=${case_root}/toolchains/java
TOOLCHAIN_GO_ROOT=${case_root}/toolchains/go
TOOLCHAIN_RUST_CARGO_HOME=${case_root}/toolchains/rust/cargo
TOOLCHAIN_RUST_BIN=\${TOOLCHAIN_RUST_CARGO_HOME}/bin
TOOLCHAIN_RUSTUP_HOME=${case_root}/toolchains/rust/rustup
TOOLCHAIN_SYSTEM_PATH=${fake_bin}:/usr/bin:/bin
TOOLCHAIN_PATH=\${TOOLCHAIN_JAVA_HOME}/bin:\${TOOLCHAIN_GO_ROOT}/bin:\${TOOLCHAIN_RUST_BIN}:\${TOOLCHAIN_SYSTEM_PATH}
EOF_TOOLCHAIN
  cat >"${source_root}/scripts/host-toolchain-check.sh" <<'EOF_CHECK'
#!/usr/bin/env bash
set -euo pipefail
exit 0
EOF_CHECK
  chmod 0755 "${source_root}/scripts/toolchain-environment.sh" "${source_root}/scripts/host-toolchain-check.sh"

  mkdir -p "${case_root}/toolchains/java/bin" "${case_root}/toolchains/go/bin" \
    "${case_root}/toolchains/rust/cargo/bin" "${case_root}/toolchains/rust/rustup"

  local archive_root="${case_root}/runner-archive"
  mkdir -p "${archive_root}/bin"
  chmod 0755 "${archive_root}"
  for file in Runner.Listener Runner.Worker runsvc.sh; do
    cat >"${archive_root}/bin/${file}" <<'EOF_RUNNER_BINARY'
#!/usr/bin/env bash
exit 0
EOF_RUNNER_BINARY
    chmod 0755 "${archive_root}/bin/${file}"
  done
  cat >"${archive_root}/config.sh" <<EOF_CONFIG
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "\$*" >> "${state_root}/config.log"
printf '{}\n' > .runner
printf '{}\n' > .credentials
printf '{}\n' > .credentials_rsaparams
chmod 0600 .runner .credentials .credentials_rsaparams
EOF_CONFIG
  chmod 0755 "${archive_root}/config.sh"
  tar -C "${archive_root}" -czf "${state_root}/runner.tar.gz" .
  if (( preinstall_runner == 1 )); then
    tar -C "${runner_root}" --no-overwrite-dir -xzf "${state_root}/runner.tar.gz"
  fi

  cat >"${fake_bin}/id" <<EOF_ID
#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}:\${2:-}" in
  -u:) echo 1000 ;;
  -g:) echo 1000 ;;
  -un:) echo agent-relay-admin ;;
  -gn:) echo agent-relay-admin ;;
  -u:github-runner) echo 2001 ;;
  -g:github-runner) echo 2001 ;;
  -u:agent-relay-builder) echo 2002 ;;
  -g:agent-relay-builder) echo 2002 ;;
  -nG:github-runner) echo 'github-runner docker' ;;
  -nG:agent-relay-builder) echo 'agent-relay-builder' ;;
  *) exec /usr/bin/id "\$@" ;;
esac
EOF_ID

  cat >"${fake_bin}/getent" <<EOF_GETENT
#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}:\${2:-}" in
  passwd:github-runner) echo 'github-runner:x:2001:2001::${runner_home}:/bin/bash' ;;
  passwd:agent-relay-builder) echo 'agent-relay-builder:x:2002:2002::${build_home}:/usr/sbin/nologin' ;;
  *) exit 2 ;;
esac
EOF_GETENT

  cat >"${fake_bin}/stat" <<EOF_STAT
#!/usr/bin/env bash
exec /usr/bin/stat "\$@"
EOF_STAT

  cat >"${fake_bin}/sudo" <<EOF_SUDO
#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == '-k' ]]; then exit 0; fi
while (( \$# > 0 )); do
  case "\$1" in
    -n|-H) shift ;;
    -u) shift 2 ;;
    *) break ;;
  esac
done
if [[ "\${1:-}" == sudo ]]; then exit 1; fi
if [[ "\${1:-}" == passwd && "\${2:-}" == -S ]]; then printf '%s L 2026-01-01 0 99999 7 -1\n' "\$3"; exit 0; fi
if [[ "\${1:-}" == chown ]]; then exit 0; fi
if [[ "\${1:-}" == mv && "\${2:-}" == -- && "\${3:-}" == ${source_root}/.dist.stage.* && "\${4:-}" == ${source_root}/dist && -f ${state_root}/fail-activate ]]; then
  rm -f ${state_root}/fail-activate
  exit 1
fi
exec "\$@"
EOF_SUDO

  cat >"${fake_bin}/systemctl" <<EOF_SYSTEMCTL
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "\$*" >> "${state_root}/systemctl.log"
case "\${1:-}" in
  is-active) test -f "${state_root}/service-active" ;;
  stop) rm -f "${state_root}/service-active" ;;
  restart|start) touch "${state_root}/service-active" ;;
  enable|daemon-reload) exit 0 ;;
  *) exit 0 ;;
esac
EOF_SYSTEMCTL

  cat >"${fake_bin}/ps" <<EOF_PS
#!/usr/bin/env bash
set -euo pipefail
if [[ "\$*" == *'-p 1 -o comm='* ]]; then echo systemd; exit 0; fi
if [[ "\$*" == *'-e -o euid=,comm='* ]]; then
  if [[ -f "${state_root}/service-active" ]]; then printf '2001 Runner.Listener\n'; fi
  exit 0
fi
exec /bin/ps "\$@"
EOF_PS

  cat >"${fake_bin}/curl" <<EOF_CURL
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "\$*" >> "${state_root}/curl.log"
output=''
for ((i=1; i<=\$#; i++)); do
  if [[ "\${!i}" == '-o' ]]; then j=\$((i+1)); output="\${!j}"; fi
done
if [[ "\$*" == *registration-token* ]]; then
  echo '{"token":"registration-token"}'
else
  cp "${state_root}/runner.tar.gz" "\${output}"
fi
EOF_CURL

  cat >"${fake_bin}/jq" <<'EOF_JQ'
#!/usr/bin/env bash
cat >/dev/null
printf 'registration-token\n'
EOF_JQ

  cat >"${fake_bin}/sha256sum" <<'EOF_SHA'
#!/usr/bin/env bash
cat >/dev/null
printf 'runner.tar.gz: OK\n'
EOF_SHA

  cat >"${fake_bin}/docker" <<EOF_DOCKER
#!/usr/bin/env bash
set -euo pipefail
if [[ "\$*" == *"--format"* ]]; then echo "${docker_root}"; exit 0; fi
if [[ "\${1:-}" == compose ]]; then echo 'Docker Compose version v2'; exit 0; fi
exit 0
EOF_DOCKER

  cat >"${fake_bin}/git" <<'EOF_GIT'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *'remote get-url origin'* ]]; then echo 'https://github.com/Divorium/agent-relay.git'; exit 0; fi
exec /usr/bin/git "$@"
EOF_GIT

  cat >"${fake_bin}/mountpoint" <<'EOF_MOUNTPOINT'
#!/usr/bin/env bash
exit 1
EOF_MOUNTPOINT

  cat >"${fake_bin}/uname" <<'EOF_UNAME'
#!/usr/bin/env bash
[[ "${1:-}" == '-m' ]] && { echo x86_64; exit 0; }
exec /usr/bin/uname "$@"
EOF_UNAME

  cat >"${fake_bin}/node" <<'EOF_NODE'
#!/usr/bin/env bash
set -euo pipefail
exit 0
EOF_NODE

  cat >"${fake_bin}/tsc" <<EOF_TSC
#!/usr/bin/env bash
set -euo pipefail
if [[ -f "${state_root}/fail-build" ]]; then exit 23; fi
out=''
while (( \$# > 0 )); do
  if [[ "\$1" == '--outDir' ]]; then out="\$2"; shift 2; else shift; fi
done
mkdir -p "\${out}/src"
printf 'export const build = %q;\n' "\$(date +%s%N)" > "\${out}/src/run-codex.js"
printf 'build\n' >> "${state_root}/build.log"
EOF_TSC

  chmod 0755 "${fake_bin}"/*

  printf '%s\n' "${source_root}" "${state_root}" "${fake_bin}"
}

run_installer() {
  local source_root=$1 state_root=$2 fake_bin=$3 token=${4-}
  if [[ -n "${token}" ]]; then
    printf '%s\n' "${token}" | PATH="${fake_bin}:/usr/bin:/bin" bash "${source_root}/install.sh"
  else
    PATH="${fake_bin}:/usr/bin:/bin" bash "${source_root}/install.sh" </dev/null
  fi
}

mapfile -t first < <(prepare_case first 0)
source_root=${first[0]}
state_root=${first[1]}
fake_bin=${first[2]}
runner_root="$(dirname "${source_root}")/runner"
run_installer "${source_root}" "${state_root}" "${fake_bin}" first-token
[[ "$(stat -c '%a' -- "${runner_root}")" == 700 ]]
[[ -f "${source_root}/dist/src/run-codex.js" ]]
[[ -f "${state_root}/service-active" ]]
[[ "$(grep -c registration-token "${state_root}/curl.log")" == 1 ]]
[[ "$(grep -c actions-runner-linux "${state_root}/curl.log")" == 1 ]]
[[ "$(wc -l < "${state_root}/config.log")" == 1 ]]
[[ "$(wc -l < "${state_root}/build.log")" == 1 ]]

run_installer "${source_root}" "${state_root}" "${fake_bin}"
[[ "$(grep -c registration-token "${state_root}/curl.log")" == 1 ]]
[[ "$(grep -c actions-runner-linux "${state_root}/curl.log")" == 1 ]]
[[ "$(wc -l < "${state_root}/config.log")" == 1 ]]
[[ "$(wc -l < "${state_root}/build.log")" == 2 ]]

stop_count_before="$(grep -c '^stop ' "${state_root}/systemctl.log" || true)"
touch "${state_root}/fail-build"
if run_installer "${source_root}" "${state_root}" "${fake_bin}"; then
  echo 'installer unexpectedly succeeded after build failure' >&2
  exit 1
fi
rm -f "${state_root}/fail-build"
[[ -f "${state_root}/service-active" ]]
[[ "$(grep -c '^stop ' "${state_root}/systemctl.log" || true)" == "${stop_count_before}" ]]

previous_runtime="$(cat "${source_root}/dist/src/run-codex.js")"
touch "${state_root}/fail-activate"
if run_installer "${source_root}" "${state_root}" "${fake_bin}"; then
  echo 'installer unexpectedly succeeded after activation failure' >&2
  exit 1
fi
[[ "$(cat "${source_root}/dist/src/run-codex.js")" == "${previous_runtime}" ]]
[[ ! -e "${source_root}/dist.previous" ]]

mapfile -t resume < <(prepare_case resume 1)
run_installer "${resume[0]}" "${resume[1]}" "${resume[2]}" resume-token
[[ "$(grep -c registration-token "${resume[1]}/curl.log")" == 1 ]]
if grep -q actions-runner-linux "${resume[1]}/curl.log"; then
  echo 'complete runner binaries were downloaded again' >&2
  exit 1
fi
[[ "$(wc -l < "${resume[1]}/config.log")" == 1 ]]

printf 'installer behavioral integration checks passed\n'
