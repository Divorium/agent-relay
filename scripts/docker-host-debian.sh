#!/usr/bin/env bash

# Secured entrypoint for the Debian Docker package adapter. The implementation
# remains in a non-executable sibling so update.sh can normalize this entrypoint
# while this file independently protects the sourced implementation.

DOCKER_DEBIAN_ADAPTER_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
DOCKER_DEBIAN_ADAPTER_CORE=${DOCKER_DEBIAN_ADAPTER_ROOT}/docker-host-debian-core.sh

docker_debian_secure_adapter_core() {
  local wrapper_owner core_metadata core_owner core_mode
  [[ -f "${DOCKER_DEBIAN_ADAPTER_CORE}" && ! -L "${DOCKER_DEBIAN_ADAPTER_CORE}" ]] || return 1
  wrapper_owner="$(/usr/bin/stat -c '%u' -- "${BASH_SOURCE[0]}")" || return 1
  core_metadata="$(/usr/bin/stat -c '%u|%a' -- "${DOCKER_DEBIAN_ADAPTER_CORE}")" || return 1
  core_owner=${core_metadata%%|*}
  [[ "${core_owner}" == "${wrapper_owner}" ]] || return 1
  /usr/bin/chmod 0644 -- "${DOCKER_DEBIAN_ADAPTER_CORE}" || return 1
  core_mode="$(/usr/bin/stat -c '%a' -- "${DOCKER_DEBIAN_ADAPTER_CORE}")" || return 1
  [[ "${core_mode}" == 644 ]]
}

docker_debian_secure_adapter_core \
  || docker_host_fail preflight "Docker Debian adapter implementation is missing or cannot be secured"

# shellcheck source=scripts/docker-host-debian-core.sh
source "${DOCKER_DEBIAN_ADAPTER_CORE}"

docker_debian_remove_containerd_dpkg_artifacts() {
  local artifact entry
  for artifact in "${DOCKER_HOST_CONTAINERD_CONFIG}.dpkg-"*; do
    docker_host_path_absent "${artifact}" && continue
    /usr/bin/rm -f -- "${artifact}" \
      || docker_host_fail configuration "Could not remove discarded containerd package configuration: ${artifact}"
    docker_host_path_absent "${artifact}" \
      || docker_host_fail configuration "Discarded containerd package configuration remained after removal: ${artifact}"
  done
  docker_host_path_absent "${DOCKER_HOST_CONTAINERD_DIRECTORY}" && return 0
  [[ -d "${DOCKER_HOST_CONTAINERD_DIRECTORY}" && ! -L "${DOCKER_HOST_CONTAINERD_DIRECTORY}" ]] || return 0
  while IFS= read -r -d '' entry; do
    [[ "${entry}" == "${DOCKER_HOST_CONTAINERD_CONFIG}" ]] && continue
    printf 'Unmanaged containerd configuration entry remains: %s\n' "${entry}" >&2
  done < <(/usr/bin/find -P "${DOCKER_HOST_CONTAINERD_DIRECTORY}" -mindepth 1 -maxdepth 1 -print0)
}

docker_debian_assert_clean_dpkg() {
  local audit=${DOCKER_HOST_STATE_ROOT}/dpkg-audit.txt packages=${DOCKER_HOST_STATE_ROOT}/dpkg-packages.txt status query_status
  set +e
  /usr/bin/env LC_ALL=C LANG=C /usr/bin/dpkg --audit > "${audit}" 2>&1
  status=$?
  /usr/bin/env LC_ALL=C LANG=C /usr/bin/dpkg-query -W -f='${Package}|${db:Status-Abbrev}|${Version}\n' \
    > "${packages}" 2> "${DOCKER_HOST_STATE_ROOT}/dpkg-query.err"
  query_status=$?
  set -e
  (( status == 0 && query_status == 0 )) || docker_host_fail package "Could not audit global dpkg state"
  docker_debian_dpkg_state_clean "${audit}" "${packages}" \
    || docker_host_fail package "Global dpkg state is not clean; an administrator must finish or repair pending package work, then rerun ./update.sh"
  docker_debian_remove_containerd_dpkg_artifacts
}

docker_debian_assert_recovery_dpkg_bounded() {
  local marker_packages=${DOCKER_HOST_STATE_ROOT}/recovery-boundary-marker-packages
  local packages=${DOCKER_HOST_STATE_ROOT}/recovery-boundary-packages query_status
  docker_host_marker_packages > "${marker_packages}"
  set +e
  /usr/bin/env LC_ALL=C LANG=C /usr/bin/dpkg-query -W -f='${Package}|${db:Status-Abbrev}|${Version}\n' \
    > "${packages}" 2> "${DOCKER_HOST_STATE_ROOT}/recovery-boundary-dpkg-query.err"
  query_status=$?
  set -e
  (( query_status == 0 )) || docker_host_fail package "Could not inspect interrupted dpkg state before recovery"
  docker_debian_recovery_dpkg_state_allowed "${packages}" "${marker_packages}" \
    || docker_host_fail package "Interrupted dpkg state includes unrelated non-trigger package work"
  docker_debian_remove_containerd_dpkg_artifacts
}

docker_debian_install_exact_packages() {
  (( $# > 0 )) || return 0
  DEBIAN_FRONTEND=noninteractive LC_ALL=C LANG=C /usr/bin/apt-get \
    --yes --no-install-recommends "${DOCKER_DEBIAN_APT_CONFFILE_OPTIONS[@]}" install "$@" || return $?
  docker_debian_remove_containerd_dpkg_artifacts
}

docker_debian_configure_pending_packages() {
  DEBIAN_FRONTEND=noninteractive LC_ALL=C LANG=C /usr/bin/dpkg \
    "${DOCKER_DEBIAN_DPKG_CONFFILE_OPTIONS[@]}" --configure -a || return $?
  docker_debian_remove_containerd_dpkg_artifacts
}

# Static contract markers implemented by docker-host-debian-core.sh:
# GNUPGHOME="${home}"
# docker_debian_remove_orphan_stages
# selected_exact+=("${selected_package}=${selected_version}")
# docker_debian_candidate_is_unambiguously_official
