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
build_workspace=""
builder_state=""
previous_dist=""
original_head=""
service_was_active=0
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

prepare_builder_state() {
  local state_root="$1"
  local -a state_paths=("${state_root}")
  local state_directory
  for state_directory in "${TOOLCHAIN_STATE_SUBDIRECTORIES[@]}"; do
    state_paths+=("${state_root}/${state_directory}")
  done
  sudo install -d -o "${BUILD_USER}" -g "${BUILD_USER}" -m 0700 "${state_paths[@]}"
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
[[ -r "${ADMIN_FILE}" ]] || { echo "Run ./install.sh before ./update.sh" >&2; exit 1; }
expected_admin="$(tr -d '\r\n' < "${ADMIN_FILE}")"
[[ "${expected_admin}" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]] || { echo "Invalid administrator state" >&2; exit 1; }
[[ "$(id -un)" == "${expected_admin}" ]] || { echo "update.sh must be run by ${expected_admin}" >&2; exit 1; }
[[ "$(ps -p 1 -o comm= | tr -d '[:space:]')" == "systemd" ]] || { echo "systemd must run as PID 1; run wsl --shutdown first" >&2; exit 1; }
[[ -d "${SOURCE_ROOT}/.git" ]] || { echo "${SOURCE_ROOT} must be a Git checkout" >&2; exit 1; }
git -C "${SOURCE_ROOT}" config core.fileMode false
[[ -z "$(git -C "${SOURCE_ROOT}" status --porcelain --untracked-files=all)" ]] || {
  echo "The source checkout must be clean before update" >&2
  exit 1
}
if sudo -u "${RUNNER_USER}" -H sudo -n true >/dev/null 2>&1; then
  echo "${RUNNER_USER} must not have passwordless sudo access" >&2
  exit 1
fi
if sudo -u "${BUILD_USER}" -H sudo -n true >/dev/null 2>&1; then
  echo "${BUILD_USER} must not have passwordless sudo access" >&2
  exit 1
fi

cd "${SOURCE_ROOT}"
if [[ "${AGENT_RELAY_UPDATE_PHASE:-}" == reexec ]]; then
  original_head="${AGENT_RELAY_ORIGINAL_HEAD:-}"
  [[ "${original_head}" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid update rollback state" >&2; exit 1; }
  git -C "${SOURCE_ROOT}" cat-file -e "${original_head}^{commit}" 2>/dev/null \
    || { echo "The rollback commit is unavailable" >&2; exit 1; }
  [[ "${AGENT_RELAY_SERVICE_WAS_ACTIVE:-0}" =~ ^[01]$ ]] \
    || { echo "Invalid service rollback state" >&2; exit 1; }
  service_was_active="${AGENT_RELAY_SERVICE_WAS_ACTIVE}"
  unset AGENT_RELAY_UPDATE_PHASE AGENT_RELAY_ORIGINAL_HEAD AGENT_RELAY_SERVICE_WAS_ACTIVE
  sudo -v
else
  original_head="$(git -C "${SOURCE_ROOT}" rev-parse HEAD)"
  sudo -v
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
sudo install -d -o "${BUILD_USER}" -g "${BUILD_USER}" -m 0700 "${build_workspace}" "${stage}"
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

sudo rm -rf -- "${builder_state}"
builder_state=""
sudo -v
previous_dist="${SOURCE_ROOT}/.dist.previous.$$"
sudo rm -rf -- "${previous_dist}"
if [[ -d "${SOURCE_ROOT}/dist" ]]; then
  sudo mv -- "${SOURCE_ROOT}/dist" "${previous_dist}"
fi
if ! sudo mv -- "${stage}" "${SOURCE_ROOT}/dist"; then
  if [[ -d "${previous_dist}" ]]; then
    sudo mv -- "${previous_dist}" "${SOURCE_ROOT}/dist"
  fi
  exit 1
fi
stage=""
dist_swapped=1
sudo rm -rf -- "${build_workspace}"
build_workspace=""

if sudo find -P "${SOURCE_ROOT}" -xdev -path "${SOURCE_ROOT}/dist" -prune -o \
  ! -user "${expected_admin}" -print -quit | grep -q .; then
  echo "The source checkout contains files not owned by ${expected_admin}" >&2
  exit 1
fi
sudo find -P "${SOURCE_ROOT}" -xdev -path "${SOURCE_ROOT}/dist" -prune -o \
  -type d -exec chmod u+rwx,go+rx,go-w {} +
sudo find -P "${SOURCE_ROOT}" -xdev -path "${SOURCE_ROOT}/dist" -prune -o \
  -type f -exec chmod a+r,go-w {} +
sudo chown -R root:root "${SOURCE_ROOT}/dist"
sudo find "${SOURCE_ROOT}/dist" -type d -exec chmod 0755 {} +
sudo find "${SOURCE_ROOT}/dist" -type f -exec chmod 0644 {} +
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
