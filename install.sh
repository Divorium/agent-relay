#!/usr/bin/env bash
set -euo pipefail

ORGANIZATION=Divorium
ORGANIZATION_URL=https://github.com/Divorium
RUNNER_NAME=gh-runner
RUNNER_VERSION=2.335.1
RUNNER_SHA256=4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf
TYPESCRIPT_VERSION=5.8.3
BASE_ROOT=/srv/github-runner
STORAGE_ROOT=${BASE_ROOT}/storage
EXPECTED_SOURCE_ROOT=${STORAGE_ROOT}/agent-relay
WORK_ROOT=${STORAGE_ROOT}/work
RUNNER_DIR=${STORAGE_ROOT}/runner
RUNNER_HOME=${STORAGE_ROOT}/home
BUILD_HOME=${STORAGE_ROOT}/build-home
DOCKER_ROOT=${STORAGE_ROOT}/docker/engine
CONTAINERD_ROOT=${STORAGE_ROOT}/docker/containerd
RUNNER_USER=github-runner
BUILD_USER=agent-relay-builder
SERVICE_NAME=actions.runner.Divorium.gh-runner.service
LOCK_ROOT=/var/lib/agent-relay
LOCK_FILE=${LOCK_ROOT}/install.lock
SOURCE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
TOOLCHAIN_PROFILE=${SOURCE_ROOT}/scripts/toolchain-environment.sh

runner_archive=""
service_temp=""
stage_dir=""
lock_fd=""

cleanup() {
  local status=$?
  if [[ -n "${stage_dir}" && -d "${stage_dir}" && ! -L "${stage_dir}" ]]; then
    sudo -n rm -rf --one-file-system -- "${stage_dir}" >/dev/null 2>&1 || true
  fi
  rm -f -- "${runner_archive:-}" "${service_temp:-}"
  sudo -k >/dev/null 2>&1 || true
  exit "${status}"
}
trap cleanup EXIT

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command is missing: $1"
}

stat_uid() { stat -c '%u' -- "$1"; }
stat_gid() { stat -c '%g' -- "$1"; }
stat_mode() { stat -c '%a' -- "$1"; }

require_regular_file() {
  local path=$1
  [[ -f "${path}" && ! -L "${path}" ]] || fail "Required regular non-symlink file is missing: ${path}"
}

require_directory() {
  local path=$1 owner_uid=$2 owner_gid=$3 mode=$4
  [[ -d "${path}" && ! -L "${path}" ]] || fail "Required regular directory is missing: ${path}"
  [[ "$(stat_uid "${path}")" == "${owner_uid}" ]] || fail "Unexpected owner for ${path}"
  [[ "$(stat_gid "${path}")" == "${owner_gid}" ]] || fail "Unexpected group for ${path}"
  [[ "$(stat_mode "${path}")" == "${mode}" ]] || fail "Unexpected mode for ${path}; expected ${mode}"
}

require_locked_account() {
  local user=$1 expected_home=$2 expected_shell=$3
  local passwd_entry status groups
  passwd_entry="$(getent passwd "${user}")" || fail "Required account is missing: ${user}"
  [[ "$(cut -d: -f6 <<<"${passwd_entry}")" == "${expected_home}" ]] || fail "Unexpected home for ${user}"
  [[ "$(cut -d: -f7 <<<"${passwd_entry}")" == "${expected_shell}" ]] || fail "Unexpected shell for ${user}"
  status="$(sudo -n passwd -S "${user}")" || fail "Could not inspect password status for ${user}"
  [[ "$(awk '{print $2}' <<<"${status}")" == "L" ]] || fail "Account password must be locked: ${user}"
  groups="$(id -nG "${user}")" || fail "Could not inspect groups for ${user}"
  if grep -Eq '(^|[[:space:]])sudo([[:space:]]|$)' <<<"${groups}"; then
    fail "Service account must not belong to sudo: ${user}"
  fi
  if sudo -n -u "${user}" sudo -n true >/dev/null 2>&1; then
    fail "Service account must not have passwordless sudo: ${user}"
  fi
}

validate_checkout() {
  local admin_uid=$1 entry uid mode
  local -a trusted=(
    install.sh
    package.json
    tsconfig.runtime.json
    runner/finalize.sh
    runner/resolve-pr.mjs
    runner/resolve-plan.mjs
    runner/resolve-request.mjs
    runner/run-codex.mjs
    scripts/codex-run
    scripts/toolchain-environment.sh
    scripts/toolchain-smoke.sh
  )

  for entry in "${trusted[@]}"; do
    require_regular_file "${SOURCE_ROOT}/${entry}"
  done

  while IFS= read -r -d '' entry; do
    uid="$(stat -c '%u' -- "${entry}")"
    mode="$(stat -c '%a' -- "${entry}")"
    [[ "${uid}" == "${admin_uid}" ]] || fail "Checkout entry is not administrator-owned: ${entry}"
    if (( (8#${mode} & 8#022) != 0 )); then
      fail "Checkout entry is writable by group or others: ${entry}"
    fi
  done < <(
    find -P "${SOURCE_ROOT}" -xdev \
      \( -path "${SOURCE_ROOT}/dist" -o -path "${SOURCE_ROOT}/dist/*" \
         -o -path "${SOURCE_ROOT}/dist.previous" -o -path "${SOURCE_ROOT}/dist.previous/*" \
         -o -path "${SOURCE_ROOT}/.dist.stage.*" -o -path "${SOURCE_ROOT}/.dist.stage.*/*" \) -prune \
      -o -print0
  )

  local remote_url
  remote_url="$(git -C "${SOURCE_ROOT}" remote get-url origin 2>/dev/null || true)"
  if [[ -n "${remote_url}" && "${remote_url}" =~ ^https?://[^/@]+:[^/@]+@ ]]; then
    fail "The Git remote URL must not contain embedded credentials"
  fi
}

validate_runtime_tree() {
  local root=$1 entry mode uid
  [[ -d "${root}" && ! -L "${root}" ]] || fail "Runtime must be a regular directory: ${root}"
  mountpoint -q "${root}" && fail "Runtime must not be a mount point: ${root}"
  while IFS= read -r -d '' entry; do
    mountpoint -q "${entry}" && fail "Runtime contains a mount point: ${entry}"
    uid="$(stat -c '%u' -- "${entry}")"
    [[ "${uid}" == "0" ]] || fail "Runtime entry is not root-owned: ${entry}"
    if [[ -d "${entry}" ]]; then
      mode="$(stat_mode "${entry}")"
      [[ "${mode}" == "755" ]] || fail "Runtime directory has an unsafe mode: ${entry}"
    elif [[ -f "${entry}" && ! -L "${entry}" ]]; then
      mode="$(stat_mode "${entry}")"
      [[ "${mode}" == "644" ]] || fail "Runtime file has an unsafe mode: ${entry}"
    else
      fail "Runtime contains a symlink or special file: ${entry}"
    fi
  done < <(find -P "${root}" -xdev -print0)
}

validate_stage_tree() {
  local root=$1 entry
  sudo -n test -d "${root}" || fail "Build stage is not a regular directory"
  sudo -n test ! -L "${root}" || fail "Build stage must not be a symlink"
  sudo -n mountpoint -q "${root}" && fail "Build stage must not be a mount point"
  while IFS= read -r -d '' entry; do
    sudo -n mountpoint -q "${entry}" && fail "Build stage contains a mount point: ${entry}"
    if sudo -n test -L "${entry}"; then
      fail "Build stage contains a symlink: ${entry}"
    fi
    if ! sudo -n test -d "${entry}" && ! sudo -n test -f "${entry}"; then
      fail "Build stage contains a special file: ${entry}"
    fi
  done < <(sudo -n find -P "${root}" -xdev -print0)
  sudo -n test -f "${root}/src/run-codex.js" || fail "Compiled entrypoint is missing from the build stage"
  sudo -n test ! -L "${root}/src/run-codex.js" || fail "Compiled entrypoint must not be a symlink"
}

runner_binary_state() {
  local -a required=(bin/Runner.Listener bin/Runner.Worker bin/runsvc.sh config.sh)
  local path present=0 complete=1 runner_uid mode
  runner_uid="$(id -u "${RUNNER_USER}")"
  for path in "${required[@]}"; do
    if [[ -e "${RUNNER_DIR}/${path}" || -L "${RUNNER_DIR}/${path}" ]]; then
      present=1
    fi
    if [[ ! -f "${RUNNER_DIR}/${path}" || -L "${RUNNER_DIR}/${path}" || ! -x "${RUNNER_DIR}/${path}" ]]; then
      complete=0
    elif [[ "$(stat_uid "${RUNNER_DIR}/${path}")" != "${runner_uid}" ]]; then
      complete=0
    else
      mode="$(stat_mode "${RUNNER_DIR}/${path}")"
      if (( (8#${mode} & 8#022) != 0 )); then
        complete=0
      fi
    fi
  done
  if (( complete == 1 )); then
    printf 'complete\n'
  elif (( present == 0 )) && [[ -z "$(find -P "${RUNNER_DIR}" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    printf 'absent\n'
  else
    printf 'partial\n'
  fi
}

registration_state() {
  local -a files=(.runner .credentials .credentials_rsaparams)
  local path present=0 complete=1 runner_uid
  runner_uid="$(id -u "${RUNNER_USER}")"
  for path in "${files[@]}"; do
    if [[ -e "${RUNNER_DIR}/${path}" || -L "${RUNNER_DIR}/${path}" ]]; then
      present=$((present + 1))
    fi
    if [[ ! -f "${RUNNER_DIR}/${path}" || -L "${RUNNER_DIR}/${path}" ]]; then
      complete=0
    elif [[ "$(stat_uid "${RUNNER_DIR}/${path}")" != "${runner_uid}" ]] \
      || (( (8#$(stat_mode "${RUNNER_DIR}/${path}") & 8#022) != 0 )); then
      complete=0
    fi
  done
  if (( complete == 1 )); then
    printf 'complete\n'
  elif (( present == 0 )); then
    printf 'absent\n'
  else
    printf 'partial\n'
  fi
}

install_runner_service() {
  sudo -n -u "${RUNNER_USER}" install -m 0755 "${RUNNER_DIR}/bin/runsvc.sh" "${RUNNER_DIR}/runsvc.sh"
  service_temp="$(mktemp)"
  cat >"${service_temp}" <<EOF_SERVICE
[Unit]
Description=GitHub Actions Runner (${ORGANIZATION}.${RUNNER_NAME})
After=network-online.target
Wants=network-online.target

[Service]
User=${RUNNER_USER}
WorkingDirectory=${RUNNER_DIR}
ExecStart=${RUNNER_DIR}/runsvc.sh
KillMode=process
KillSignal=SIGTERM
TimeoutStopSec=5min
Restart=always
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF_SERVICE
  if ! sudo -n test -f "/etc/systemd/system/${SERVICE_NAME}" \
    || ! sudo -n cmp -s "${service_temp}" "/etc/systemd/system/${SERVICE_NAME}"; then
    sudo -n install -o root -g root -m 0644 "${service_temp}" "/etc/systemd/system/${SERVICE_NAME}"
    sudo -n systemctl daemon-reload
  fi
}

wait_for_workers() {
  local runner_uid process_table
  runner_uid="$(id -u "${RUNNER_USER}")"
  while true; do
    process_table="$(ps -e -o euid=,comm=)" || fail "Could not inspect the process table"
    if ! awk -v uid="${runner_uid}" '$1 == uid && $2 == "Runner.Worker" { found=1 } END { exit !found }' <<<"${process_table}"; then
      return 0
    fi
    sleep 2
  done
}

listener_ready() {
  local runner_uid process_table
  runner_uid="$(id -u "${RUNNER_USER}")"
  process_table="$(ps -e -o euid=,comm=)" || return 1
  awk -v uid="${runner_uid}" '$1 == uid && $2 == "Runner.Listener" { found=1 } END { exit !found }' <<<"${process_table}"
}

if (( $# != 0 )); then
  fail "install.sh does not accept arguments"
fi
if [[ "$(id -u)" == "0" ]]; then
  fail "Run install.sh as the Ansible-created administrator, not root"
fi
[[ "${SOURCE_ROOT}" == "${EXPECTED_SOURCE_ROOT}" ]] || fail "The repository must be checked out at ${EXPECTED_SOURCE_ROOT}"
[[ ! -L "${SOURCE_ROOT}" ]] || fail "The source root must not be a symlink"

require_command python3
python3 -c 'raise SystemExit(0)'
require_command sudo
sudo -n true || fail "The administrator requires passwordless sudo"
require_command flock
require_command find
require_command stat
require_command mountpoint
require_command ps
require_command git
require_command curl
require_command jq
require_command sha256sum
require_command tar
require_command node
require_command npm
require_command java
require_command javac
require_command docker
require_command git-lfs
require_regular_file "${TOOLCHAIN_PROFILE}"
source "${TOOLCHAIN_PROFILE}"

[[ "$(uname -m)" == "x86_64" ]] || fail "Only x86-64 is supported"
[[ -r /etc/os-release ]] || fail "/etc/os-release is required"
# shellcheck disable=SC1091
. /etc/os-release
[[ "${ID:-}" == "debian" && "${VERSION_ID:-}" == "13" && "${VERSION_CODENAME:-}" == "trixie" ]] \
  || fail "Debian 13 (trixie) is required"
[[ "$(ps -p 1 -o comm= | tr -d '[:space:]')" == "systemd" ]] || fail "systemd must run as PID 1"

admin_uid="$(id -u)"
admin_gid="$(id -g)"
[[ "$(stat_uid "${SOURCE_ROOT}")" == "${admin_uid}" ]] || fail "The invoking administrator must own ${SOURCE_ROOT}"
[[ "$(stat_gid "${SOURCE_ROOT}")" == "${admin_gid}" ]] || fail "The source root must use the administrator primary group"
[[ "$(stat_mode "${SOURCE_ROOT}")" == "755" ]] || fail "The source root must have mode 0755"

require_directory "${LOCK_ROOT}" 0 0 755
[[ -f "${LOCK_FILE}" && ! -L "${LOCK_FILE}" ]] || fail "The install lock must be a regular non-symlink file"
[[ "$(stat_uid "${LOCK_FILE}")" == "${admin_uid}" ]] || fail "The administrator must own ${LOCK_FILE}"
[[ "$(stat_mode "${LOCK_FILE}")" == "600" ]] || fail "The install lock must have mode 0600"
exec {lock_fd}<>"${LOCK_FILE}"
flock -n "${lock_fd}" || fail "Another install.sh invocation is active"

runner_uid="$(id -u "${RUNNER_USER}")" || fail "Missing ${RUNNER_USER}"
runner_gid="$(id -g "${RUNNER_USER}")"
builder_uid="$(id -u "${BUILD_USER}")" || fail "Missing ${BUILD_USER}"
builder_gid="$(id -g "${BUILD_USER}")"
require_locked_account "${RUNNER_USER}" "${RUNNER_HOME}" /bin/bash
require_locked_account "${BUILD_USER}" "${BUILD_HOME}" /usr/sbin/nologin
require_directory "${BASE_ROOT}" 0 0 755
require_directory "${STORAGE_ROOT}" 0 0 755
require_directory "${RUNNER_DIR}" "${runner_uid}" "${runner_gid}" 700
require_directory "${WORK_ROOT}" "${runner_uid}" "${runner_gid}" 700
require_directory "${RUNNER_HOME}" "${runner_uid}" "${runner_gid}" 700
require_directory "${BUILD_HOME}" "${builder_uid}" "${builder_gid}" 700
[[ -d "${DOCKER_ROOT}" && ! -L "${DOCKER_ROOT}" ]] || fail "Docker data root is missing"
[[ -d "${CONTAINERD_ROOT}" && ! -L "${CONTAINERD_ROOT}" ]] || fail "containerd data root is missing"

[[ "$(node --version)" == v22.* ]] || fail "Node.js 22 is required"
java -version 2>&1 | head -n1 | grep -Eq 'version "21\.|openjdk 21' || fail "Java 21 is required"
[[ -x "${TOOLCHAIN_GO_ROOT}/bin/go" ]] || fail "Go is missing from ${TOOLCHAIN_GO_ROOT}"
"${TOOLCHAIN_GO_ROOT}/bin/go" version | grep -q 'go1\.24\.5' || fail "Go 1.24.5 is required"
[[ -x "${TOOLCHAIN_RUST_BIN}/rustc" && -x "${TOOLCHAIN_RUST_BIN}/cargo" ]] || fail "Rust stable toolchain is missing"
[[ "$(/usr/local/bin/tsc --version)" == "Version ${TYPESCRIPT_VERSION}" ]] || fail "TypeScript ${TYPESCRIPT_VERSION} is required"
[[ -x /usr/local/bin/codex ]] || fail "Codex CLI is missing"
git lfs version >/dev/null || fail "Git LFS is unavailable"
sudo -n -u "${RUNNER_USER}" -H docker info >/dev/null || fail "${RUNNER_USER} cannot access Docker"
sudo -n -u "${RUNNER_USER}" -H docker compose version >/dev/null || fail "Docker Compose plugin is unavailable"
[[ "$(sudo -n -u "${RUNNER_USER}" -H docker info --format '{{.DockerRootDir}}')" == "${DOCKER_ROOT}" ]] \
  || fail "Docker uses an unexpected data root"
grep -Eq '^[[:space:]]*root[[:space:]]*=[[:space:]]*"'"${CONTAINERD_ROOT}"'"[[:space:]]*$' /etc/containerd/config.toml \
  || fail "containerd uses an unexpected root"

validate_checkout "${admin_uid}"
if [[ -e "${SOURCE_ROOT}/dist" || -L "${SOURCE_ROOT}/dist" ]]; then
  validate_runtime_tree "${SOURCE_ROOT}/dist"
fi
if [[ -e "${SOURCE_ROOT}/dist.previous" || -L "${SOURCE_ROOT}/dist.previous" ]]; then
  fail "dist.previous exists; follow the documented interrupted-swap recovery procedure"
fi

binary_state="$(runner_binary_state)"
case "${binary_state}" in
  absent)
    runner_archive="$(mktemp)"
    curl -fsSL --retry 3 \
      "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" \
      -o "${runner_archive}"
    printf '%s  %s\n' "${RUNNER_SHA256}" "${runner_archive}" | sha256sum -c -
    sudo -n -u "${RUNNER_USER}" tar -C "${RUNNER_DIR}" -xzf "${runner_archive}"
    ;;
  complete) ;;
  *) fail "Runner binaries are partial or conflicting; rebuild the host or remove the state deliberately" ;;
esac

if [[ -L "${RUNNER_DIR}/_work" ]]; then
  [[ "$(readlink "${RUNNER_DIR}/_work")" == ../work ]] || fail "The runner work link points to an unexpected location"
elif [[ -e "${RUNNER_DIR}/_work" ]]; then
  fail "The runner work path must be the managed symlink"
else
  sudo -n -u "${RUNNER_USER}" ln -s ../work "${RUNNER_DIR}/_work"
fi

registration="$(registration_state)"
case "${registration}" in
  absent)
    set +x
    printf 'GitHub credential authorized to create organization runner registration tokens: ' >&2
    IFS= read -r -s github_token
    printf '\n' >&2
    [[ -n "${github_token}" ]] || fail "GitHub credential is required"
    if ! registration_response="$(
      printf 'Authorization: Bearer %s\n' "${github_token}" \
        | curl -fsSL --retry 3 -X POST \
            -H 'Accept: application/vnd.github+json' \
            -H @- \
            -H 'X-GitHub-Api-Version: 2022-11-28' \
            "https://api.github.com/orgs/${ORGANIZATION}/actions/runners/registration-token"
    )"; then
      unset github_token
      fail "Could not obtain a GitHub runner registration token"
    fi
    unset github_token
    registration_token="$(jq -er '.token' <<<"${registration_response}")"
    unset registration_response
    sudo -n -u "${RUNNER_USER}" -H bash -c '
      set -euo pipefail
      cd "$1"
      ./config.sh --unattended --replace --url "$2" --token "$3" --name "$4" --work _work
    ' -- "${RUNNER_DIR}" "${ORGANIZATION_URL}" "${registration_token}" "${RUNNER_NAME}"
    unset registration_token
    ;;
  complete) ;;
  *) fail "Runner registration is partial or conflicting; rebuild the host or remove the state deliberately" ;;
esac

install_runner_service

for stale_stage in "${SOURCE_ROOT}"/.dist.stage.*; do
  [[ -e "${stale_stage}" || -L "${stale_stage}" ]] || continue
  [[ -d "${stale_stage}" && ! -L "${stale_stage}" ]] || fail "Unsafe stale build stage: ${stale_stage}"
  mountpoint -q "${stale_stage}" && fail "Stale build stage is a mount point: ${stale_stage}"
  stale_uid="$(stat_uid "${stale_stage}")"
  [[ "${stale_uid}" == "${builder_uid}" || "${stale_uid}" == "0" ]] || fail "Unexpected stale stage owner: ${stale_stage}"
  sudo -n rm -rf --one-file-system -- "${stale_stage}"
done

stage_dir="$(mktemp -d "${SOURCE_ROOT}/.dist.stage.XXXXXXXX")"
sudo -n chown "${BUILD_USER}:${BUILD_USER}" "${stage_dir}"
sudo -n chmod 0700 "${stage_dir}"
toolchain_environment_build "${BUILD_USER}" "${BUILD_HOME}" "${BUILD_HOME}" build_environment
sudo -n -u "${BUILD_USER}" /usr/bin/env -i "${build_environment[@]}" \
  /usr/local/bin/tsc -p "${SOURCE_ROOT}/tsconfig.runtime.json" --outDir "${stage_dir}"
validate_stage_tree "${stage_dir}"
sudo -n -u "${BUILD_USER}" /usr/bin/env -i "${build_environment[@]}" \
  STAGED_ENTRYPOINT="file://${stage_dir}/src/run-codex.js" \
  /usr/bin/node --input-type=module -e 'await import(process.env.STAGED_ENTRYPOINT)'

sudo -n find -P "${stage_dir}" -xdev -exec chown -h root:root {} +
sudo -n find -P "${stage_dir}" -xdev -type d -exec chmod 0755 {} +
sudo -n find -P "${stage_dir}" -xdev -type f -exec chmod 0644 {} +
validate_runtime_tree "${stage_dir}"

if sudo -n systemctl is-active --quiet "${SERVICE_NAME}"; then
  sudo -n systemctl stop "${SERVICE_NAME}"
fi
wait_for_workers

if [[ -d "${SOURCE_ROOT}/dist" && ! -L "${SOURCE_ROOT}/dist" ]]; then
  sudo -n mv -- "${SOURCE_ROOT}/dist" "${SOURCE_ROOT}/dist.previous"
fi
if ! sudo -n mv -- "${stage_dir}" "${SOURCE_ROOT}/dist"; then
  if [[ ! -e "${SOURCE_ROOT}/dist" && -d "${SOURCE_ROOT}/dist.previous" && ! -L "${SOURCE_ROOT}/dist.previous" ]]; then
    sudo -n mv -- "${SOURCE_ROOT}/dist.previous" "${SOURCE_ROOT}/dist"
  fi
  fail "Could not activate the staged runtime"
fi
stage_dir=""
validate_runtime_tree "${SOURCE_ROOT}/dist"
if [[ -d "${SOURCE_ROOT}/dist.previous" && ! -L "${SOURCE_ROOT}/dist.previous" ]]; then
  sudo -n rm -rf --one-file-system -- "${SOURCE_ROOT}/dist.previous"
fi

sudo -n systemctl enable "${SERVICE_NAME}"
sudo -n systemctl restart "${SERVICE_NAME}"
ready=0
for _ in $(seq 1 60); do
  if sudo -n systemctl is-active --quiet "${SERVICE_NAME}" && listener_ready; then
    ready=1
    break
  fi
  sleep 1
done
(( ready == 1 )) || fail "Runner service did not become ready within 60 seconds"

printf 'Agent Relay runner installation is active: %s (%s)\n' "${RUNNER_NAME}" "${ORGANIZATION_URL}"
