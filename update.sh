#!/usr/bin/env bash
set -euo pipefail

BASE_ROOT=/srv/github-runner
STORAGE_ROOT=${BASE_ROOT}/storage
SOURCE_ROOT=${STORAGE_ROOT}/agent-relay
BUILD_ROOT=${STORAGE_ROOT}/build
BUILD_HOME=${STORAGE_ROOT}/build-home
BUILD_USER=agent-relay-builder
RUNNER_USER=github-runner
SERVICE_NAME=actions.runner.Divorium.gh-runner.service
ADMIN_FILE=/etc/agent-relay/administrator
SCRIPT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

stage=""
activation_stage=""
build_workspace=""
builder_state=""
previous_dist=""
original_head=""
service_was_active=0
reexec_phase=0
committed=0
dist_swapped=0
declare -a builder_env=()

validate_source_entrypoints() {
  local path
  for path in \
    install.sh \
    update.sh \
    runner/finalize.sh \
    runner/resolve-pr.mjs \
    runner/resolve-plan.mjs \
    runner/resolve-request.mjs \
    runner/run-codex.mjs \
    scripts/codex-run \
    scripts/toolchain-environment.sh \
    scripts/toolchain-smoke.sh \
    test-system/install-script.integration.sh \
    test-system/update-script.integration.sh; do
    if [[ ! -f "${SOURCE_ROOT}/${path}" || -L "${SOURCE_ROOT}/${path}" ]]; then
      echo "Required source file must be a regular non-symlink file: ${path}" >&2
      exit 1
    fi
  done
}

path_metadata() {
  local path="$1"
  local metadata
  if metadata="$(sudo stat -c 'owner=%U group=%G mode=%a type=%F links=%h' -- "${path}" 2>/dev/null)"; then
    printf '%s path=%q' "${metadata}" "${path}"
  else
    printf 'metadata=unavailable path=%q' "${path}"
  fi
}

assert_admin_state_file() {
  local metadata owner group mode mode_value
  if [[ ! -f "${ADMIN_FILE}" || -L "${ADMIN_FILE}" || ! -r "${ADMIN_FILE}" ]]; then
    echo "Run ./install.sh before ./update.sh; administrator state must be a readable regular non-symlink file" >&2
    exit 1
  fi
  if ! metadata="$(stat -c '%U|%G|%a' -- "${ADMIN_FILE}")"; then
    echo "Could not inspect administrator state ownership" >&2
    exit 1
  fi
  IFS='|' read -r owner group mode <<< "${metadata}"
  if [[ ! "${mode}" =~ ^[0-7]{3,4}$ ]]; then
    echo "Administrator state has an invalid mode: ${mode}" >&2
    exit 1
  fi
  mode_value=$((8#${mode}))
  if [[ "${owner}" != root || "${group}" != root ]] || (( (mode_value & 0022) != 0 )); then
    echo "Administrator state must be root:root and not group/other-writable" >&2
    exit 1
  fi
}

assert_secure_storage_root() {
  local metadata owner group mode mode_value
  if [[ ! -d "${STORAGE_ROOT}" || -L "${STORAGE_ROOT}" ]]; then
    printf 'Storage root must be a regular directory: %q\n' "${STORAGE_ROOT}" >&2
    exit 1
  fi
  if ! metadata="$(sudo stat -c '%U|%G|%a' -- "${STORAGE_ROOT}")"; then
    echo "Could not inspect storage root ownership" >&2
    exit 1
  fi
  IFS='|' read -r owner group mode <<< "${metadata}"
  if [[ ! "${mode}" =~ ^[0-7]{3,4}$ ]]; then
    echo "Storage root has an invalid mode: ${mode}" >&2
    exit 1
  fi
  mode_value=$((8#${mode}))
  if [[ "${owner}" != root || "${group}" != root ]] || (( (mode_value & 0022) != 0 )); then
    printf 'Storage root must be root:root and not group/other-writable: ' >&2
    path_metadata "${STORAGE_ROOT}" >&2
    printf '\n' >&2
    exit 1
  fi
}

assert_private_directory() {
  local path="$1"
  local expected_owner="$2"
  local expected_group="$3"
  local label="$4"
  local metadata owner group mode
  if [[ ! -d "${path}" || -L "${path}" ]]; then
    printf '%s must be a regular directory: %q\n' "${label}" "${path}" >&2
    exit 1
  fi
  if ! metadata="$(sudo stat -c '%U|%G|%a' -- "${path}")"; then
    printf 'Could not inspect %s ownership\n' "${label}" >&2
    exit 1
  fi
  IFS='|' read -r owner group mode <<< "${metadata}"
  if [[ "${owner}" != "${expected_owner}" || "${group}" != "${expected_group}" || "${mode}" != 700 ]]; then
    printf '%s must be %s:%s with mode 700: ' "${label}" "${expected_owner}" "${expected_group}" >&2
    path_metadata "${path}" >&2
    printf '\n' >&2
    exit 1
  fi
}

assert_source_ownership() {
  local foreign_path
  if ! foreign_path="$(
    sudo find -P "${SOURCE_ROOT}" -xdev \
      -path "${SOURCE_ROOT}/dist" -prune -o \
      ! -user "${expected_admin}" -print -quit
  )"; then
    echo "Could not verify source checkout ownership" >&2
    exit 1
  fi
  if [[ -n "${foreign_path}" ]]; then
    printf 'The source checkout contains a path not owned by %s: ' "${expected_admin}" >&2
    path_metadata "${foreign_path}" >&2
    printf '\n' >&2
    exit 1
  fi
}

assert_tree_ownership() {
  local root="$1"
  local expected_owner="$2"
  local label="$3"
  local foreign_path
  if ! foreign_path="$(sudo find -P "${root}" -xdev ! -user "${expected_owner}" -print -quit)"; then
    printf 'Could not verify %s ownership\n' "${label}" >&2
    exit 1
  fi
  if [[ -n "${foreign_path}" ]]; then
    printf '%s contains a path not owned by %s: ' "${label}" "${expected_owner}" >&2
    path_metadata "${foreign_path}" >&2
    printf '\n' >&2
    exit 1
  fi
}

assert_runtime_tree_safe() {
  local root="$1"
  local label="$2"
  local invalid_path
  if [[ ! -d "${root}" || -L "${root}" ]]; then
    printf '%s must be a regular directory: %q\n' "${label}" "${root}" >&2
    exit 1
  fi
  if ! invalid_path="$(
    sudo find -P "${root}" -xdev \
      \( \( ! -type d ! -type f \) -o \( -type f -links +1 \) \) \
      -print -quit
  )"; then
    printf 'Could not validate %s filesystem entries\n' "${label}" >&2
    exit 1
  fi
  if [[ -n "${invalid_path}" ]]; then
    printf '%s contains an unsupported or multiply linked entry: ' "${label}" >&2
    path_metadata "${invalid_path}" >&2
    printf '\n' >&2
    exit 1
  fi
}

assert_active_runtime() {
  if [[ -e "${SOURCE_ROOT}/dist" || -L "${SOURCE_ROOT}/dist" ]]; then
    assert_runtime_tree_safe "${SOURCE_ROOT}/dist" "Active runtime"
    assert_tree_ownership "${SOURCE_ROOT}/dist" root "Active runtime"
  fi
}

assert_no_builder_processes() {
  if sudo /usr/bin/pgrep -u "${BUILD_USER}" >/dev/null 2>&1; then
    echo "The isolated builder still has running processes after validation" >&2
    exit 1
  fi
}

adopt_runtime_tree() {
  local root="$1"
  sudo find -P "${root}" -xdev -exec chown -h root:root {} +
  sudo find -P "${root}" -xdev -type d -exec chmod 0755 {} +
  sudo find -P "${root}" -xdev -type f -exec chmod 0644 {} +
}

prepare_builder_state() {
  local state_root="$1"
  local -a state_paths=("${state_root}")
  local state_directory
  for state_directory in "${TOOLCHAIN_STATE_SUBDIRECTORIES[@]}"; do
    state_paths+=("${state_root}/${state_directory}")
  done
  sudo -u "${BUILD_USER}" /usr/bin/mkdir -m 0700 -- "${state_paths[@]}"
}

run_builder() {
  sudo -u "${BUILD_USER}" -H /usr/bin/env -i "${builder_env[@]}" "$@"
}

restart_service() {
  sudo -v
  sudo systemctl daemon-reload
  sudo systemctl enable "${SERVICE_NAME}"
  sudo systemctl start "${SERVICE_NAME}"
  sudo systemctl is-active --quiet "${SERVICE_NAME}"
}

rollback() {
  local status=$?
  if (( status == 0 || committed == 1 )); then
    return
  fi
  set +e
  if [[ -n "${original_head}" ]]; then
    git -C "${SOURCE_ROOT}" reset --hard "${original_head}" >/dev/null 2>&1
  fi
  if [[ -n "${stage}" ]]; then
    sudo rm -rf -- "${stage}" >/dev/null 2>&1
  fi
  if [[ -n "${activation_stage}" ]]; then
    sudo rm -rf -- "${activation_stage}" >/dev/null 2>&1
  fi
  if [[ -n "${build_workspace}" ]]; then
    sudo rm -rf -- "${build_workspace}" >/dev/null 2>&1
  fi
  if [[ -n "${builder_state}" ]]; then
    sudo rm -rf -- "${builder_state}" >/dev/null 2>&1
  fi
  if (( dist_swapped == 1 )); then
    sudo rm -rf -- "${SOURCE_ROOT}/dist" >/dev/null 2>&1
    if [[ -n "${previous_dist}" && -d "${previous_dist}" ]]; then
      sudo mv -- "${previous_dist}" "${SOURCE_ROOT}/dist" >/dev/null 2>&1
    fi
  elif [[ -n "${previous_dist}" && -d "${previous_dist}" && ! -d "${SOURCE_ROOT}/dist" ]]; then
    sudo mv -- "${previous_dist}" "${SOURCE_ROOT}/dist" >/dev/null 2>&1
  fi
  if (( service_was_active == 1 )); then
    restart_service >/dev/null 2>&1
  fi
  sudo -k >/dev/null 2>&1
  exit "${status}"
}
trap rollback EXIT

if (( $# != 0 )); then
  echo "update.sh does not accept arguments" >&2
  exit 1
fi
if [[ "$(id -u)" == "0" ]]; then
  echo "Run update.sh as the normal Debian administrator, not root" >&2
  exit 1
fi
if [[ "${SCRIPT_ROOT}" != "${SOURCE_ROOT}" ]]; then
  echo "The repository must be checked out at ${SOURCE_ROOT}" >&2
  exit 1
fi

if [[ "${AGENT_RELAY_UPDATE_PHASE:-}" == reexec ]]; then
  original_head="${AGENT_RELAY_ORIGINAL_HEAD:-}"
  [[ "${original_head}" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid update rollback state" >&2; exit 1; }
  [[ "${AGENT_RELAY_SERVICE_WAS_ACTIVE:-0}" =~ ^[01]$ ]] \
    || { echo "Invalid service rollback state" >&2; exit 1; }
  service_was_active="${AGENT_RELAY_SERVICE_WAS_ACTIVE}"
  reexec_phase=1
  unset AGENT_RELAY_UPDATE_PHASE AGENT_RELAY_ORIGINAL_HEAD AGENT_RELAY_SERVICE_WAS_ACTIVE
elif [[ -n "${AGENT_RELAY_UPDATE_PHASE:-}" ]]; then
  echo "Unsupported update phase" >&2
  exit 1
fi

assert_admin_state_file
expected_admin="$(tr -d '\r\n' < "${ADMIN_FILE}")"
[[ "${expected_admin}" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]] || { echo "Invalid administrator state" >&2; exit 1; }
[[ "$(id -un)" == "${expected_admin}" ]] || { echo "update.sh must be run by ${expected_admin}" >&2; exit 1; }
[[ "$(ps -p 1 -o comm= | tr -d '[:space:]')" == "systemd" ]] || { echo "systemd must run as PID 1; run wsl --shutdown first" >&2; exit 1; }
[[ -d "${SOURCE_ROOT}/.git" ]] || { echo "${SOURCE_ROOT} must be a Git checkout" >&2; exit 1; }

sudo -v
assert_secure_storage_root
assert_private_directory "${BUILD_ROOT}" "${BUILD_USER}" "${BUILD_USER}" "Build root"
assert_private_directory "${BUILD_HOME}" "${BUILD_USER}" "${BUILD_USER}" "Builder home"
assert_source_ownership
assert_active_runtime
git -C "${SOURCE_ROOT}" config core.fileMode false
git_status=""
if ! git_status="$(git -C "${SOURCE_ROOT}" status --porcelain --untracked-files=all)"; then
  echo "Could not inspect the source checkout status" >&2
  exit 1
fi
if [[ -n "${git_status}" ]]; then
  echo "The source checkout must be clean before update" >&2
  exit 1
fi
if sudo -u "${RUNNER_USER}" -H sudo -n true >/dev/null 2>&1; then
  echo "${RUNNER_USER} must not have passwordless sudo access" >&2
  exit 1
fi
if sudo -u "${BUILD_USER}" -H sudo -n true >/dev/null 2>&1; then
  echo "${BUILD_USER} must not have passwordless sudo access" >&2
  exit 1
fi

cd "${SOURCE_ROOT}"
if (( reexec_phase == 1 )); then
  git -C "${SOURCE_ROOT}" cat-file -e "${original_head}^{commit}" 2>/dev/null \
    || { echo "The rollback commit is unavailable" >&2; exit 1; }
else
  original_head="$(git -C "${SOURCE_ROOT}" rev-parse HEAD)"
  if sudo systemctl is-active --quiet "${SERVICE_NAME}"; then
    service_was_active=1
    sudo systemctl stop "${SERVICE_NAME}"
  fi

  git -C "${SOURCE_ROOT}" -c core.hooksPath=/dev/null pull --ff-only
  updated_head="$(git -C "${SOURCE_ROOT}" rev-parse HEAD)"
  if [[ "${updated_head}" != "${original_head}" ]]; then
    AGENT_RELAY_UPDATE_PHASE=reexec \
    AGENT_RELAY_ORIGINAL_HEAD="${original_head}" \
    AGENT_RELAY_SERVICE_WAS_ACTIVE="${service_was_active}" \
      exec /bin/bash "${SOURCE_ROOT}/update.sh"
  fi
fi

validate_source_entrypoints
source "${SOURCE_ROOT}/scripts/toolchain-environment.sh"

build_workspace="${BUILD_ROOT}/workspace.$$"
stage="${BUILD_ROOT}/dist.$$"
builder_state="${BUILD_ROOT}/state.$$"
sudo rm -rf -- "${build_workspace}" "${stage}" "${builder_state}"
sudo -u "${BUILD_USER}" /usr/bin/mkdir -m 0700 -- "${build_workspace}" "${stage}"
prepare_builder_state "${builder_state}"
toolchain_environment_build "${BUILD_USER}" "${BUILD_HOME}" "${builder_state}" builder_env

run_builder cp "${SOURCE_ROOT}/package.json" "${SOURCE_ROOT}/package-lock.json" "${build_workspace}/"
run_builder npm ci --prefix "${build_workspace}"
run_builder "${build_workspace}/node_modules/.bin/tsc" -p "${SOURCE_ROOT}/tsconfig.json" --outDir "${stage}"

run_builder node --test \
  --test-concurrency=1 \
  --experimental-test-coverage \
  --test-coverage-include="${stage}/src/**/*.js" \
  --test-coverage-lines=100 \
  --test-coverage-branches=100 \
  --test-coverage-functions=100 \
  "${stage}/test/**/*.test.js"

run_builder bash -n \
  "${SOURCE_ROOT}/install.sh" \
  "${SOURCE_ROOT}/update.sh" \
  "${SOURCE_ROOT}/runner/finalize.sh" \
  "${SOURCE_ROOT}/scripts/codex-run" \
  "${SOURCE_ROOT}/scripts/toolchain-environment.sh" \
  "${SOURCE_ROOT}/scripts/toolchain-smoke.sh" \
  "${SOURCE_ROOT}/test-system/install-script.integration.sh" \
  "${SOURCE_ROOT}/test-system/update-script.integration.sh"

run_builder node --check "${SOURCE_ROOT}/runner/resolve-pr.mjs"
run_builder node --check "${SOURCE_ROOT}/runner/resolve-plan.mjs"
run_builder node --check "${SOURCE_ROOT}/runner/resolve-request.mjs"
run_builder node --check "${SOURCE_ROOT}/runner/run-codex.mjs"

run_builder \
  EXPECTED_TYPESCRIPT_VERSION=5.8.3 \
  EXPECTED_CODEX_VERSION=0.144.4 \
  EXPECTED_GO_VERSION=1.24.5 \
  EXPECTED_TOOLCHAIN_STATE_ROOT="${builder_state}" \
  "${SOURCE_ROOT}/scripts/toolchain-smoke.sh"

assert_no_builder_processes
sudo rm -rf -- "${builder_state}"
builder_state=""
sudo -v
assert_secure_storage_root
assert_private_directory "${BUILD_ROOT}" "${BUILD_USER}" "${BUILD_USER}" "Build root"
assert_private_directory "${BUILD_HOME}" "${BUILD_USER}" "${BUILD_USER}" "Builder home"
assert_source_ownership
assert_active_runtime
assert_runtime_tree_safe "${stage}" "Staged runtime"

activation_stage="${STORAGE_ROOT}/.agent-relay-dist.stage.$$"
previous_dist="${STORAGE_ROOT}/.agent-relay-dist.previous.$$"
sudo rm -rf -- "${activation_stage}" "${previous_dist}"
sudo mv -- "${stage}" "${activation_stage}"
stage=""
sudo chown -h root:root "${activation_stage}"
sudo chmod 0700 "${activation_stage}"
assert_runtime_tree_safe "${activation_stage}" "Staged runtime"
adopt_runtime_tree "${activation_stage}"
assert_tree_ownership "${activation_stage}" root "Staged runtime"

if [[ -e "${SOURCE_ROOT}/dist" || -L "${SOURCE_ROOT}/dist" ]]; then
  assert_active_runtime
  sudo mv -- "${SOURCE_ROOT}/dist" "${previous_dist}"
fi
if ! sudo mv -- "${activation_stage}" "${SOURCE_ROOT}/dist"; then
  if [[ -d "${previous_dist}" ]]; then
    sudo mv -- "${previous_dist}" "${SOURCE_ROOT}/dist"
  fi
  exit 1
fi
activation_stage=""
dist_swapped=1
sudo rm -rf -- "${build_workspace}"
build_workspace=""

sudo find -P "${SOURCE_ROOT}" -xdev -path "${SOURCE_ROOT}/dist" -prune -o \
  -type d -exec chmod u+rwx,go+rx,go-w {} +
sudo find -P "${SOURCE_ROOT}" -xdev -path "${SOURCE_ROOT}/dist" -prune -o \
  -type f -exec chmod a+r,go-w {} +
sudo chmod 0755 \
  "${SOURCE_ROOT}/install.sh" \
  "${SOURCE_ROOT}/update.sh" \
  "${SOURCE_ROOT}/runner/finalize.sh" \
  "${SOURCE_ROOT}/runner/resolve-pr.mjs" \
  "${SOURCE_ROOT}/runner/resolve-plan.mjs" \
  "${SOURCE_ROOT}/runner/resolve-request.mjs" \
  "${SOURCE_ROOT}/runner/run-codex.mjs" \
  "${SOURCE_ROOT}/scripts/codex-run" \
  "${SOURCE_ROOT}/scripts/toolchain-smoke.sh" \
  "${SOURCE_ROOT}/test-system/install-script.integration.sh" \
  "${SOURCE_ROOT}/test-system/update-script.integration.sh"

restart_service
sudo systemctl --no-pager --full status "${SERVICE_NAME}"
sudo rm -rf -- "${previous_dist}"
previous_dist=""
committed=1
sudo -k
printf 'Agent Relay updated successfully: %s\n' "$(git -C "${SOURCE_ROOT}" rev-parse --short HEAD)"
