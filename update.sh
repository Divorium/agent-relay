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
RUNTIME_CONFIG=${SOURCE_ROOT}/tsconfig.runtime.json
RUNTIME_ROOT=${SOURCE_ROOT}/dist
RUNTIME_ENTRYPOINT=${RUNTIME_ROOT}/src/run-codex.js
SCRIPT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

invalidate_sudo() {
  sudo -k >/dev/null 2>&1 || true
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
  [[ "${mode}" =~ ^[0-7]{3,4}$ ]] || {
    echo "Administrator state has an invalid mode: ${mode}" >&2
    exit 1
  }
  mode_value=$((8#${mode}))
  if [[ "${owner}" != root || "${group}" != root ]] || (( (mode_value & 0022) != 0 )); then
    echo "Administrator state must be root:root and not group/other-writable" >&2
    exit 1
  fi
}

wait_for_runner_worker() {
  local process_name process_names worker_active

  while true; do
    if ! process_names="$(sudo /usr/bin/ps -u "${RUNNER_USER}" -o comm=)"; then
      echo "Could not inspect GitHub runner worker processes" >&2
      exit 1
    fi

    worker_active=0
    while IFS= read -r process_name; do
      if [[ "${process_name}" == "Runner.Worker" ]]; then
        worker_active=1
        break
      fi
    done <<< "${process_names}"

    if (( worker_active == 0 )); then
      return
    fi

    echo "Waiting for the active GitHub runner job to finish..."
    sleep 5
  done
}

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

assert_admin_state_file
expected_admin="$(tr -d '\r\n' < "${ADMIN_FILE}")"
[[ "${expected_admin}" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]] || {
  echo "Invalid administrator state" >&2
  exit 1
}
[[ "$(id -un)" == "${expected_admin}" ]] || {
  echo "update.sh must be run by ${expected_admin}" >&2
  exit 1
}
[[ "$(ps -p 1 -o comm= | tr -d '[:space:]')" == "systemd" ]] || {
  echo "systemd must run as PID 1; run wsl --shutdown first" >&2
  exit 1
}
[[ -x /usr/local/bin/tsc ]] || {
  echo "Pinned TypeScript compiler is missing: /usr/local/bin/tsc" >&2
  exit 1
}
[[ -x /usr/bin/ps ]] || {
  echo "Process inspection is unavailable: /usr/bin/ps" >&2
  exit 1
}
[[ -f "${RUNTIME_CONFIG}" && ! -L "${RUNTIME_CONFIG}" ]] || {
  echo "Runtime compiler configuration must be a regular non-symlink file: ${RUNTIME_CONFIG}" >&2
  exit 1
}
id -u "${BUILD_USER}" >/dev/null 2>&1 || {
  echo "Missing build account: ${BUILD_USER}" >&2
  exit 1
}
id -u "${RUNNER_USER}" >/dev/null 2>&1 || {
  echo "Missing runner account: ${RUNNER_USER}" >&2
  exit 1
}

sudo -v
trap invalidate_sudo EXIT

# Stop the listener before waiting so it cannot accept a new job.
sudo systemctl stop "${SERVICE_NAME}"
wait_for_runner_worker
sudo -v

# Previous build output is disposable. Every update starts from zero.
sudo rm -rf -- "${BUILD_ROOT}"
sudo install -d -o "${BUILD_USER}" -g "${BUILD_USER}" -m 0700 "${BUILD_ROOT}"
sudo rm -rf -- "${RUNTIME_ROOT}"
sudo install -d -o "${BUILD_USER}" -g "${BUILD_USER}" -m 0700 "${RUNTIME_ROOT}"

sudo -u "${BUILD_USER}" -H /usr/bin/env -i \
  "HOME=${BUILD_HOME}" \
  "USER=${BUILD_USER}" \
  "LOGNAME=${BUILD_USER}" \
  "SHELL=/bin/bash" \
  "LANG=C.UTF-8" \
  "LC_ALL=C.UTF-8" \
  "PATH=/usr/local/bin:/usr/bin:/bin" \
  /usr/local/bin/tsc \
    -p "${RUNTIME_CONFIG}" \
    --outDir "${RUNTIME_ROOT}"

sudo test -f "${RUNTIME_ENTRYPOINT}" || {
  echo "Runtime compilation did not produce ${RUNTIME_ENTRYPOINT}" >&2
  exit 1
}

sudo find -P "${RUNTIME_ROOT}" -xdev -exec chown -h root:root {} +
sudo find -P "${RUNTIME_ROOT}" -xdev -type d -exec chmod 0755 {} +
sudo find -P "${RUNTIME_ROOT}" -xdev -type f -exec chmod 0644 {} +

sudo systemctl enable "${SERVICE_NAME}"
sudo systemctl start "${SERVICE_NAME}"
sudo systemctl is-active --quiet "${SERVICE_NAME}"
sudo systemctl --no-pager --full status "${SERVICE_NAME}"

printf 'Agent Relay runtime rebuilt and activated successfully\n'
