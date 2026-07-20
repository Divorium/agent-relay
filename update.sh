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
DOCKER_PROVISIONER=${SOURCE_ROOT}/scripts/docker-host.sh
DOCKER_ADAPTER=${SOURCE_ROOT}/scripts/docker-host-debian.sh
PROCESS_GROUP_WAIT_STEPS=300
PROCESS_GROUP_WAIT_SECONDS=0.1

runner_needs_restore=0
runtime_finalized=0
active_launcher_pid=
active_child_pgid=
provisioner_pgid_file=

protected_source_file() {
  local path="$1" metadata mode owner_uid
  [[ -f "${path}" && ! -L "${path}" && -x "${path}" ]] || return 1
  metadata="$(/usr/bin/stat -c '%u|%a' -- "${path}")" || return 1
  owner_uid=${metadata%%|*}
  mode=${metadata#*|}
  [[ "${owner_uid}" == "$(/usr/bin/id -u)" && "${mode}" =~ ^[0-7]{3,4}$ && $((8#${mode} & 8#022)) == 0 ]]
}

restore_runner() {
  sudo -n systemctl enable "${SERVICE_NAME}" \
    && sudo -n systemctl start "${SERVICE_NAME}" \
    && sudo -n systemctl is-active --quiet "${SERVICE_NAME}"
}

cleanup_update() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [[ -n "${provisioner_pgid_file}" ]]; then
    /usr/bin/rm -f -- "${provisioner_pgid_file}" || true
  fi
  if (( runner_needs_restore == 1 )); then
    if (( runtime_finalized == 1 )); then
      if ! restore_runner; then
        printf 'Runner restoration failed after update status %s. The finalized runtime remains at %s. Rerun ./update.sh after correcting the service failure.\n' "${status}" "${SOURCE_ROOT}/dist" >&2
        status=70
      fi
    else
      printf 'Runner remains stopped because the replacement runtime was not fully finalized. Correct the update failure and rerun ./update.sh.\n' >&2
    fi
  fi
  sudo -k >/dev/null 2>&1 || true
  exit "${status}"
}
trap cleanup_update EXIT

process_group_signal() {
  local signal="$1" pgid="$2"
  /usr/bin/kill -s "${signal}" -- "-${pgid}" 2>/dev/null \
    || sudo -n /usr/bin/kill -s "${signal}" -- "-${pgid}" 2>/dev/null \
    || true
}

launcher_running() {
  local state
  [[ -n "${active_launcher_pid}" ]] || return 1
  state="$(/usr/bin/ps -o stat= -p "${active_launcher_pid}" 2>/dev/null | /usr/bin/awk 'NR==1{print substr($1,1,1)}')"
  [[ -n "${state}" && "${state}" != Z ]]
}

process_group_running() {
  local pgid="$1"
  /usr/bin/ps -e -o pgid=,stat= | /usr/bin/awk -v pgid="${pgid}" '$1==pgid && substr($2,1,1)!="Z"{found=1} END{exit !found}'
}

wait_for_operation_bounded() {
  local pgid="${1:-}" step
  for ((step = 0; step < PROCESS_GROUP_WAIT_STEPS; step += 1)); do
    if [[ -n "${pgid}" ]]; then
      process_group_running "${pgid}" || return 0
    else
      launcher_running || return 0
    fi
    /usr/bin/sleep "${PROCESS_GROUP_WAIT_SECONDS}"
  done
  return 1
}

terminate_active_operation() {
  local signal="$1" status="$2"
  trap - HUP INT TERM
  if [[ -n "${active_child_pgid}" ]]; then
    process_group_signal TERM "${active_child_pgid}"
    if ! wait_for_operation_bounded "${active_child_pgid}"; then
      process_group_signal KILL "${active_child_pgid}"
      wait_for_operation_bounded "${active_child_pgid}" || true
    fi
  elif [[ -n "${active_launcher_pid}" ]]; then
    /usr/bin/kill -TERM "${active_launcher_pid}" 2>/dev/null || true
    if ! wait_for_operation_bounded; then
      /usr/bin/kill -KILL "${active_launcher_pid}" 2>/dev/null || true
      wait_for_operation_bounded || true
    fi
  fi
  if [[ -n "${active_launcher_pid}" ]] && ! launcher_running; then
    wait "${active_launcher_pid}" 2>/dev/null || true
  fi
  active_launcher_pid=
  active_child_pgid=
  printf 'Update interrupted by %s\n' "${signal}" >&2
  exit "${status}"
}
trap 'terminate_active_operation HUP 129' HUP
trap 'terminate_active_operation INT 130' INT
trap 'terminate_active_operation TERM 143' TERM

if (( $# != 0 )); then
  echo "update.sh does not accept arguments" >&2
  exit 1
fi
if [[ "$(/usr/bin/id -u)" == 0 ]]; then
  echo "Run update.sh as the recorded Debian administrator, not root" >&2
  exit 1
fi
if [[ "$(pwd -P)" != "${SOURCE_ROOT}" ]]; then
  echo "Run update.sh from ${SOURCE_ROOT}" >&2
  exit 1
fi
if [[ ! -f "${ADMIN_FILE}" || -L "${ADMIN_FILE}" ]]; then
  echo "Missing protected administrator identity file: ${ADMIN_FILE}" >&2
  exit 1
fi
admin_metadata="$(/usr/bin/stat -c '%u:%g|%a' "${ADMIN_FILE}")"
admin_mode=${admin_metadata#*|}
if [[ "${admin_metadata%%|*}" != 0:0 || ! "${admin_mode}" =~ ^[0-7]{3,4}$ || $((8#${admin_mode} & 8#022)) != 0 ]]; then
  echo "Administrator identity file must be root-owned and not writable by group or others" >&2
  exit 1
fi
mapfile -t admin_lines < "${ADMIN_FILE}"
if (( ${#admin_lines[@]} != 1 )) || [[ -z "${admin_lines[0]}" || "${admin_lines[0]}" != "$(/usr/bin/id -un)" ]]; then
  echo "Only the administrator recorded by install.sh may run update.sh" >&2
  exit 1
fi
if [[ "$(/usr/bin/ps -p 1 -o comm= | /usr/bin/tr -d '[:space:]')" != systemd ]]; then
  echo "systemd must run as PID 1 before update.sh" >&2
  exit 1
fi
for command in /usr/bin/flock /usr/bin/kill /usr/bin/ps /usr/bin/setsid /usr/bin/sleep /usr/bin/stat /usr/local/bin/tsc; do
  [[ -x "${command}" ]] || { echo "Missing required update command: ${command}" >&2; exit 1; }
done
[[ -f "${SOURCE_ROOT}/tsconfig.runtime.json" && ! -L "${SOURCE_ROOT}/tsconfig.runtime.json" ]] || {
  echo "Missing trusted runtime TypeScript configuration" >&2
  exit 1
}
protected_source_file "${DOCKER_PROVISIONER}" || { echo "Docker provisioner must be a protected executable regular file" >&2; exit 1; }
protected_source_file "${DOCKER_ADAPTER}" || { echo "Docker adapter must be a protected executable regular file" >&2; exit 1; }
/usr/bin/id -u "${BUILD_USER}" >/dev/null 2>&1 || { echo "Missing build account: ${BUILD_USER}" >&2; exit 1; }
/usr/bin/id -u "${RUNNER_USER}" >/dev/null 2>&1 || { echo "Missing runner account: ${RUNNER_USER}" >&2; exit 1; }

exec 9<"${ADMIN_FILE}"
if ! /usr/bin/flock --nonblock 9; then
  echo "Another Agent Relay update is already in progress" >&2
  exit 75
fi

sudo -v
runner_needs_restore=1
sudo -n systemctl stop "${SERVICE_NAME}"
runner_uid="$(/usr/bin/id -u "${RUNNER_USER}")"
while true; do
  if ! process_table="$(/usr/bin/ps -e -o euid=,comm=)"; then
    echo "Could not inspect runner worker processes; the runner remains stopped" >&2
    exit 1
  fi
  if ! /usr/bin/awk -v uid="${runner_uid}" '$1 == uid && $2 == "Runner.Worker" { found=1 } END { exit !found }' <<< "${process_table}"; then
    break
  fi
  echo "Waiting for current GitHub Actions job to finish..."
  /usr/bin/sleep 5
done

# The worker wait can outlive sudo's credential timestamp. Refresh it once,
# then require every remaining privileged operation to be non-interactive.
sudo -v

sudo -n /usr/bin/rm -rf --one-file-system -- "${BUILD_ROOT}"
sudo -n /usr/bin/install -d -o "${BUILD_USER}" -g "${BUILD_USER}" -m 0700 "${BUILD_ROOT}"
sudo -n /usr/bin/rm -rf --one-file-system -- "${SOURCE_ROOT}/dist"
sudo -n /usr/bin/install -d -o "${BUILD_USER}" -g "${BUILD_USER}" -m 0700 "${SOURCE_ROOT}/dist"
sudo -n -u "${BUILD_USER}" /usr/bin/env -i \
  HOME="${BUILD_HOME}" \
  USER="${BUILD_USER}" \
  LOGNAME="${BUILD_USER}" \
  LANG=C.UTF-8 \
  LC_ALL=C.UTF-8 \
  PATH=/usr/local/bin:/usr/bin:/bin \
  /usr/local/bin/tsc -p "${SOURCE_ROOT}/tsconfig.runtime.json" --outDir "${SOURCE_ROOT}/dist"
[[ -f "${SOURCE_ROOT}/dist/src/run-codex.js" ]] || {
  echo "Compiled runtime entrypoint is missing; the runner remains stopped" >&2
  exit 1
}
sudo -n /usr/bin/find -P "${SOURCE_ROOT}/dist" -xdev -exec /usr/bin/chown -h root:root {} +
sudo -n /usr/bin/find -P "${SOURCE_ROOT}/dist" -xdev -type d -exec /usr/bin/chmod 0755 {} +
sudo -n /usr/bin/find -P "${SOURCE_ROOT}/dist" -xdev -type f -exec /usr/bin/chmod 0644 {} +
runtime_finalized=1

provisioner_pgid_file="$(/usr/bin/mktemp)"
/usr/bin/chmod 0600 "${provisioner_pgid_file}"
/usr/bin/setsid --wait /bin/bash -c '
  set -euo pipefail
  printf "%s\n" "$$" > "$1"
  exec /usr/bin/sudo -n -- "$2"
' -- "${provisioner_pgid_file}" "${DOCKER_PROVISIONER}" &
active_launcher_pid=$!

for ((step = 0; step < 200; step += 1)); do
  if [[ -s "${provisioner_pgid_file}" ]]; then
    IFS= read -r active_child_pgid < "${provisioner_pgid_file}"
    break
  fi
  if ! launcher_running; then
    break
  fi
  /usr/bin/sleep 0.05
done

if [[ -n "${active_child_pgid}" ]]; then
  if [[ ! "${active_child_pgid}" =~ ^[1-9][0-9]*$ ]]; then
    echo "Docker provisioner reported an invalid process group" >&2
    terminate_active_operation TERM 70
  fi
  observed_pgid="$(/usr/bin/ps -o pgid= -p "${active_child_pgid}" 2>/dev/null | /usr/bin/tr -d '[:space:]' || true)"
  if launcher_running && [[ "${observed_pgid}" != "${active_child_pgid}" ]]; then
    echo "Docker provisioner is running without an identifiable dedicated process group" >&2
    terminate_active_operation TERM 70
  fi
elif launcher_running; then
  echo "Docker provisioner did not publish its process group" >&2
  terminate_active_operation TERM 70
fi

set +e
wait "${active_launcher_pid}"
docker_status=$?
set -e
if [[ -n "${active_child_pgid}" ]] && process_group_running "${active_child_pgid}"; then
  printf 'Docker provisioner launcher exited while descendants remained in process group %s\n' "${active_child_pgid}" >&2
  process_group_signal TERM "${active_child_pgid}"
  if ! wait_for_operation_bounded "${active_child_pgid}"; then
    process_group_signal KILL "${active_child_pgid}"
    wait_for_operation_bounded "${active_child_pgid}" || true
  fi
  docker_status=70
fi
active_launcher_pid=
active_child_pgid=
/usr/bin/rm -f -- "${provisioner_pgid_file}"
provisioner_pgid_file=

set +e
restore_runner
runner_status=$?
set -e
if (( runner_status == 0 )); then
  runner_needs_restore=0
else
  printf 'Runner restoration failed after Docker provisioning status %s. The finalized runtime remains at %s. Rerun ./update.sh after correcting the service failure.\n' "${docker_status}" "${SOURCE_ROOT}/dist" >&2
  exit 70
fi
if (( docker_status != 0 )); then
  printf 'Docker provisioning failed with status %s after runtime finalization; the runner was restored with the finalized runtime.\n' "${docker_status}" >&2
  exit "${docker_status}"
fi

printf 'Update completed. Runner is active with the finalized runtime and Docker access.\n'
