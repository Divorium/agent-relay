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
DOCKER_PROVISIONER=${SCRIPT_ROOT}/scripts/docker-host.sh
runner_needs_restore=0
runtime_finalized=0
active_child_pid=
active_child_pgid=

invalidate_sudo() {
  sudo -k >/dev/null 2>&1 || true
}

restore_runner_on_exit() {
  local original_status=$?
  local enable_status=0 start_status=0 active_status=0 restoration_failed=0
  set +e
  if (( runner_needs_restore == 1 && runtime_finalized == 1 )); then
    sudo /usr/bin/env LC_ALL=C LANG=C systemctl enable "${SERVICE_NAME}" >/dev/null 2>&1
    enable_status=$?
    sudo /usr/bin/env LC_ALL=C LANG=C systemctl start "${SERVICE_NAME}" >/dev/null 2>&1
    start_status=$?
    sudo /usr/bin/env LC_ALL=C LANG=C systemctl is-active --quiet "${SERVICE_NAME}"
    active_status=$?
    if (( enable_status != 0 || start_status != 0 || active_status != 0 )); then
      restoration_failed=1
      printf 'Agent Relay runner restoration failed during exit (primary status: %s; enable: %s; start: %s; active: %s)\n' \
        "${original_status}" "${enable_status}" "${start_status}" "${active_status}" >&2
    fi
  elif (( runner_needs_restore == 1 )); then
    echo "Agent Relay runner remains stopped because the runtime is incomplete; correct the build error and rerun ./update.sh" >&2
  fi
  invalidate_sudo
  trap - EXIT
  (( restoration_failed == 0 )) || exit 70
  exit "${original_status}"
}

terminate_active_operation() {
  local signal="$1" status=1 current_pgid
  trap - HUP INT TERM
  if [[ -n "${active_child_pid}" ]]; then
    if [[ -z "${active_child_pgid}" ]]; then
      active_child_pgid="$(/usr/bin/ps -o pgid= -p "${active_child_pid}" 2>/dev/null | /usr/bin/tr -d '[:space:]')"
    fi
    current_pgid="$(/usr/bin/ps -o pgid= -p "$$" 2>/dev/null | /usr/bin/tr -d '[:space:]')"
    if [[ "${active_child_pgid}" =~ ^[0-9]+$ && "${active_child_pgid}" != "${current_pgid}" ]]; then
      /usr/bin/kill -TERM -- "-${active_child_pgid}" 2>/dev/null || true
    fi
    set +e
    wait "${active_child_pid}"
    set -e
  fi
  case "${signal}" in HUP) status=129 ;; INT) status=130 ;; TERM) status=143 ;; esac
  exit "${status}"
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
  local process_table process_uid process_name worker_active

  while true; do
    if ! process_table="$(sudo /usr/bin/ps -e -o euid=,comm=)"; then
      echo "Could not inspect GitHub runner worker processes" >&2
      exit 1
    fi

    worker_active=0
    while read -r process_uid process_name; do
      [[ -n "${process_uid}" && -n "${process_name}" ]] || continue
      if [[ "${process_uid}" == "${RUNNER_UID}" && "${process_name}" == "Runner.Worker" ]]; then
        worker_active=1
        break
      fi
    done <<< "${process_table}"

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
[[ -f "${DOCKER_PROVISIONER}" && ! -L "${DOCKER_PROVISIONER}" && -x "${DOCKER_PROVISIONER}" ]] || {
  echo "Docker provisioner must be an executable regular non-symlink file: ${DOCKER_PROVISIONER}" >&2
  exit 1
}
id -u "${BUILD_USER}" >/dev/null 2>&1 || {
  echo "Missing build account: ${BUILD_USER}" >&2
  exit 1
}
if ! RUNNER_UID="$(id -u "${RUNNER_USER}")"; then
  echo "Missing runner account: ${RUNNER_USER}" >&2
  exit 1
fi
[[ "${RUNNER_UID}" =~ ^[0-9]+$ ]] || {
  echo "Runner account has an invalid UID: ${RUNNER_UID}" >&2
  exit 1
}

# util-linux flock documentation: the root-owned administrator state inode is
# stable and opened read-only for the complete update before any host mutation.
exec {UPDATE_LOCK_FD}< "${ADMIN_FILE}"
set +e
/usr/bin/flock --exclusive --nonblock --conflict-exit-code 75 "${UPDATE_LOCK_FD}"
lock_status=$?
set -e
if (( lock_status == 75 )); then
  echo "Another Agent Relay update owns the administrator-state lock; no changes were made"
  exit 0
fi
(( lock_status == 0 )) || { echo "Could not acquire the Agent Relay update lock" >&2; exit "${lock_status}"; }

sudo -v
trap restore_runner_on_exit EXIT
trap 'terminate_active_operation HUP' HUP
trap 'terminate_active_operation INT' INT
trap 'terminate_active_operation TERM' TERM

# Stop the listener before waiting so it cannot accept a new job.
runner_needs_restore=1
sudo /usr/bin/env LC_ALL=C LANG=C systemctl stop "${SERVICE_NAME}"
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

# Finalize the compiled runtime before the resumable Docker provisioner runs.
# The EXIT restoration path can therefore always execute a complete runtime
# after any Docker failure or interruption.
sudo find -P "${RUNTIME_ROOT}" -xdev -exec chown -h root:root {} +
sudo find -P "${RUNTIME_ROOT}" -xdev -type d -exec chmod 0755 {} +
sudo find -P "${RUNTIME_ROOT}" -xdev -type f -exec chmod 0644 {} +
runtime_finalized=1

set +e
/usr/bin/setsid --wait sudo "${DOCKER_PROVISIONER}" &
active_child_pid=$!
active_child_pgid="$(/usr/bin/ps -o pgid= -p "${active_child_pid}" | /usr/bin/tr -d '[:space:]')"
update_shell_pgid="$(/usr/bin/ps -o pgid= -p "$$" | /usr/bin/tr -d '[:space:]')"
if [[ ! "${active_child_pgid}" =~ ^[0-9]+$ || "${active_child_pgid}" == "${update_shell_pgid}" ]]; then
  wait "${active_child_pid}" 2>/dev/null
  active_child_pid=
  active_child_pgid=
  echo "Could not determine the Docker provisioner process group" >&2
  exit 1
fi
wait "${active_child_pid}"
docker_status=$?
active_child_pid=
active_child_pgid=
set -e

set +e
sudo /usr/bin/env LC_ALL=C LANG=C systemctl enable "${SERVICE_NAME}"
runner_enable_status=$?
sudo /usr/bin/env LC_ALL=C LANG=C systemctl start "${SERVICE_NAME}"
runner_start_status=$?
sudo /usr/bin/env LC_ALL=C LANG=C systemctl is-active --quiet "${SERVICE_NAME}"
runner_active_status=$?
sudo /usr/bin/env LC_ALL=C LANG=C systemctl --no-pager --full status "${SERVICE_NAME}"
runner_status_status=$?
set -e

if (( runner_enable_status != 0 || runner_start_status != 0 || runner_active_status != 0 || runner_status_status != 0 )); then
  echo "Agent Relay runner restoration failed (Docker provisioning status: ${docker_status})" >&2
  exit 70
fi
runner_needs_restore=0

if (( docker_status != 0 )); then
  echo "Agent Relay runtime is active, but Docker provisioning failed with status ${docker_status}" >&2
  exit "${docker_status}"
fi

printf 'Agent Relay runtime rebuilt and activated successfully\n'
