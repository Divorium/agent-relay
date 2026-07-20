#!/usr/bin/env bash
set -euo pipefail
umask 0077

DOCKER_HOST_SCRIPT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
DOCKER_HOST_ADAPTER=${DOCKER_HOST_SCRIPT_ROOT}/docker-host-debian.sh
DOCKER_HOST_RUNNER_USER=github-runner
DOCKER_HOST_BUILD_USER=agent-relay-builder
DOCKER_HOST_SOCKET=/var/run/docker.sock
DOCKER_HOST_STORAGE_ROOT=/srv/github-runner/storage/docker
DOCKER_HOST_ENGINE_ROOT=${DOCKER_HOST_STORAGE_ROOT}/engine
DOCKER_HOST_CONTAINERD_ROOT=${DOCKER_HOST_STORAGE_ROOT}/containerd
DOCKER_HOST_DAEMON_DIRECTORY=/etc/docker
DOCKER_HOST_CONTAINERD_DIRECTORY=/etc/containerd
DOCKER_HOST_DAEMON_CONFIG=${DOCKER_HOST_DAEMON_DIRECTORY}/daemon.json
DOCKER_HOST_CONTAINERD_CONFIG=${DOCKER_HOST_CONTAINERD_DIRECTORY}/config.toml
DOCKER_HOST_MARKER=/etc/agent-relay/docker-host-state-v1
DOCKER_HOST_POLICY=/usr/sbin/policy-rc.d
DOCKER_HOST_RUNNER_HOME=/srv/github-runner/storage/home
DOCKER_HOST_OWNER_UID=0
DOCKER_HOST_OWNER_GID=0
DOCKER_HOST_DEFAULT_ENGINE_ROOT=/var/lib/docker
DOCKER_HOST_DEFAULT_CONTAINERD_ROOT=/var/lib/containerd
DOCKER_HOST_UNIT_ROOTS=(/etc/systemd/system /run/systemd/system /usr/local/lib/systemd/system /usr/lib/systemd/system /lib/systemd/system)
DOCKER_HOST_OVERRIDE_UNIT_ROOTS=(/etc/systemd/system /run/systemd/system /usr/local/lib/systemd/system)
DOCKER_HOST_PACKAGE_UNIT_ROOTS=(/usr/lib/systemd/system /lib/systemd/system)
DOCKER_HOST_ENABLE_ROOT=/etc/systemd/system
DOCKER_HOST_CODEX_PATH=/opt/java/openjdk/bin:/usr/local/go/bin:/opt/rust/cargo/bin:/usr/local/bin:/usr/bin:/bin
DOCKER_HOST_CTR_TIMEOUT_SECONDS=10
DOCKER_HOST_STATE_CONTAINER=
DOCKER_HOST_STATE_ROOT=
DOCKER_HOST_FRESH=0
DOCKER_HOST_POLICY_REMOVE_ON_EXIT=0

docker_host_fail() { printf 'Docker provisioning failed in phase %s: %s\n' "$1" "$2" >&2; exit 1; }

docker_host_path_occupied() { [[ -e "$1" || -L "$1" ]]; }
docker_host_path_absent() { ! docker_host_path_occupied "$1"; }

docker_host_cleanup() {
  (( DOCKER_HOST_POLICY_REMOVE_ON_EXIT == 0 )) || docker_host_path_absent "${DOCKER_HOST_POLICY}" || {
    docker_host_policy_valid "${DOCKER_HOST_POLICY}" && /usr/bin/rm -f -- "${DOCKER_HOST_POLICY}" || true
  }
  [[ -z "${DOCKER_HOST_STATE_CONTAINER}" ]] || /usr/bin/rm -rf --one-file-system -- "${DOCKER_HOST_STATE_CONTAINER}" || true
}

docker_host_secure_path() {
  local path="$1" kind="$2" metadata mode
  if [[ "${kind}" == directory ]]; then [[ -d "${path}" && ! -L "${path}" ]]; else [[ -f "${path}" && ! -L "${path}" ]]; fi || return 1
  [[ "$(/usr/bin/readlink -f -- "${path}")" == "${path}" ]] || return 1
  metadata="$(/usr/bin/stat -c '%u:%g|%a' -- "${path}")" || return 1
  mode=${metadata#*|}
  [[ "${metadata%%|*}" == "${DOCKER_HOST_OWNER_UID}:${DOCKER_HOST_OWNER_GID}" \
    && "${mode}" =~ ^[0-7]{3,4}$ && $((8#${mode} & 8#022)) == 0 ]]
}

docker_host_exact_metadata() {
  local path="$1" kind="$2" expected="$3"
  docker_host_secure_path "${path}" "${kind}" \
    && [[ "$(/usr/bin/stat -c '%u:%g|%a' -- "${path}")" == "${expected}" ]]
}

docker_host_atomic_publish() {
  local source="$1" target="$2" mode="$3" expected_mode directory stage orphan listing=${DOCKER_HOST_STATE_ROOT}/atomic-stages.bin
  expected_mode=${mode#0}
  directory="$(/usr/bin/dirname -- "${target}")"
  if docker_host_path_occupied "${directory}"; then
    docker_host_secure_path "${directory}" directory || docker_host_fail configuration "Unsafe publication directory: ${directory}"
  else
    /usr/bin/install -d -o root -g root -m 0755 "${directory}"
  fi
  /usr/bin/find -P "${directory}" -mindepth 1 -maxdepth 1 -name ".agent-relay-$(/usr/bin/basename -- "${target}").tmp.*" -print0 > "${listing}" \
    || docker_host_fail configuration "Could not inspect interrupted publication for ${target}"
  while IFS= read -r -d '' orphan; do
    docker_host_exact_metadata "${orphan}" file "${DOCKER_HOST_OWNER_UID}:${DOCKER_HOST_OWNER_GID}|${expected_mode}" \
      && /usr/bin/cmp -s -- "${source}" "${orphan}" \
      || docker_host_fail configuration "Unsafe or unexpected interrupted publication: ${orphan}"
    /usr/bin/rm -f -- "${orphan}"
  done < "${listing}"
  stage="$(/usr/bin/mktemp "${directory}/.agent-relay-$(/usr/bin/basename -- "${target}").tmp.XXXXXXXX")" \
    || docker_host_fail configuration "Could not create same-directory staging file for ${target}"
  /usr/bin/install -o root -g root -m "${mode}" "${source}" "${stage}"
  /usr/bin/cmp -s -- "${source}" "${stage}" || docker_host_fail configuration "Staged content differs for ${target}"
  /usr/bin/mv -T -- "${stage}" "${target}"
}

docker_host_daemon_content() { printf '{\n  "data-root": "%s"\n}\n' "${DOCKER_HOST_ENGINE_ROOT}"; }
docker_host_containerd_content() { printf 'version = 2\nroot = "%s"\n' "${DOCKER_HOST_CONTAINERD_ROOT}"; }
docker_host_policy_content() {
  printf '%s\n' '#!/bin/sh' \
    'case "${1:-}" in' \
    '  docker|docker.service|docker.socket|containerd|containerd.service) exit 101 ;;' \
    '  *) exit 0 ;;' \
    'esac'
}

docker_host_exact_content() {
  local producer="$1" path="$2" expected=${DOCKER_HOST_STATE_ROOT}/expected
  "${producer}" > "${expected}"
  docker_host_secure_path "${path}" file && /usr/bin/cmp -s -- "${expected}" "${path}"
}

docker_host_policy_valid() { docker_host_exact_content docker_host_policy_content "$1"; }

docker_host_marker_valid() {
  local marker=${1:-${DOCKER_HOST_MARKER}}
  docker_host_secure_path "${marker}" file || return 1
  /usr/bin/awk -F= '
    $1=="schema"&&$2=="1"{schema++}
    $1=="phase"&&($2=="preparing"||$2=="transaction"||$2=="installed"||$2=="complete"){phase++;phase_value=$2}
    $1=="package"&&$2~/^[a-z0-9.+-]+:[^[:space:]]+$/{packages++;name=$2;sub(/:.*/,"",name);if(seen[name]++)bad=1}
    !($1=="schema"||$1=="phase"||$1=="package"){bad=1}
    END{shape=(phase_value=="preparing"?packages==0:packages>0);exit !(schema==1&&phase==1&&shape&&!bad)}
  ' "${marker}"
}

docker_host_marker_phase() { /usr/bin/awk -F= '$1=="phase"{print $2}' "${1:-${DOCKER_HOST_MARKER}}"; }

docker_host_marker_packages() {
  /usr/bin/awk -F'[=:]' '$1=="package"{print $2 "|" substr($0,index($0,":")+1)}' "${DOCKER_HOST_MARKER}"
}

docker_host_publish_marker() {
  local phase="$1" packages_file="${2:-}" content=${DOCKER_HOST_STATE_ROOT}/marker
  printf 'schema=1\nphase=%s\n' "${phase}" > "${content}"
  [[ -z "${packages_file}" ]] || /usr/bin/awk -F'|' '{print "package=" $1 ":" $2}' "${packages_file}" >> "${content}"
  docker_host_atomic_publish "${content}" "${DOCKER_HOST_MARKER}" 0600
  docker_host_marker_valid || docker_host_fail state "Published managed-state marker is invalid"
}

docker_host_validate_publication_stages() {
  local phase="$1" directory path staged_phase listing=${DOCKER_HOST_STATE_ROOT}/managed-publication-stages.bin
  : > "${listing}"
  for directory in "${DOCKER_HOST_DAEMON_DIRECTORY}" "${DOCKER_HOST_CONTAINERD_DIRECTORY}" "$(/usr/bin/dirname -- "${DOCKER_HOST_MARKER}")"; do
    docker_host_path_absent "${directory}" && continue
    [[ -d "${directory}" && ! -L "${directory}" ]] || return 1
    /usr/bin/find -P "${directory}" -mindepth 1 -maxdepth 1 \
      \( -name '.agent-relay-daemon.json.tmp.*' -o -name '.agent-relay-config.toml.tmp.*' \
      -o -name '.agent-relay-docker-host-state-v1.tmp.*' \) -print0 >> "${listing}" || return 1
  done
  while IFS= read -r -d '' path; do
    case "${path}" in
      "${DOCKER_HOST_DAEMON_DIRECTORY}/.agent-relay-daemon.json.tmp."*)
        [[ "${phase}" == preparing || "${phase}" == fresh ]] \
          && docker_host_exact_metadata "${path}" file "${DOCKER_HOST_OWNER_UID}:${DOCKER_HOST_OWNER_GID}|644" \
          && docker_host_exact_content docker_host_daemon_content "${path}" || return 1 ;;
      "${DOCKER_HOST_CONTAINERD_DIRECTORY}/.agent-relay-config.toml.tmp."*)
        [[ "${phase}" == preparing || "${phase}" == fresh ]] \
          && docker_host_exact_metadata "${path}" file "${DOCKER_HOST_OWNER_UID}:${DOCKER_HOST_OWNER_GID}|644" \
          && docker_host_exact_content docker_host_containerd_content "${path}" || return 1 ;;
      */.agent-relay-docker-host-state-v1.tmp.*)
        docker_host_exact_metadata "${path}" file "${DOCKER_HOST_OWNER_UID}:${DOCKER_HOST_OWNER_GID}|600" \
          && docker_host_marker_valid "${path}" || return 1
        staged_phase="$(docker_host_marker_phase "${path}")"
        case "${phase}:${staged_phase}" in
          fresh:preparing|preparing:transaction|transaction:installed|installed:complete) ;;
          *) return 1 ;;
        esac ;;
      *) return 1 ;;
    esac
  done < "${listing}"
}

docker_host_remove_publication_stages() {
  local path listing=${DOCKER_HOST_STATE_ROOT}/managed-publication-stages.bin
  [[ -f "${listing}" ]] || return 0
  while IFS= read -r -d '' path; do /usr/bin/rm -f -- "${path}"; done < "${listing}"
}

docker_host_directory_empty() {
  local path="$1" first
  docker_host_path_absent "${path}" && return 0
  [[ -d "${path}" && ! -L "${path}" ]] || return 1
  first="$(/usr/bin/find -P "${path}" -mindepth 1 -maxdepth 1 -print -quit)"
  [[ -z "${first}" ]]
}

docker_host_configuration_directory_exact() {
  local directory="$1" expected="$2" entry listing=${DOCKER_HOST_STATE_ROOT}/configuration-entries.bin
  [[ -d "${directory}" && ! -L "${directory}" ]] || return 1
  /usr/bin/find -P "${directory}" -mindepth 1 -maxdepth 1 -print0 > "${listing}" || return 1
  while IFS= read -r -d '' entry; do [[ "${entry}" == "${expected}" ]] || return 1; done < "${listing}"
}

docker_host_storage_directory_exact() {
  local entry listing=${DOCKER_HOST_STATE_ROOT}/storage-entries.bin seen_engine=0 seen_containerd=0
  /usr/bin/find -P "${DOCKER_HOST_STORAGE_ROOT}" -mindepth 1 -maxdepth 1 -print0 > "${listing}" || return 1
  while IFS= read -r -d '' entry; do
    case "${entry}" in
      "${DOCKER_HOST_ENGINE_ROOT}") ((seen_engine += 1)) ;;
      "${DOCKER_HOST_CONTAINERD_ROOT}") ((seen_containerd += 1)) ;;
      *) return 1 ;;
    esac
  done < "${listing}"
  (( seen_engine == 1 && seen_containerd == 1 ))
}

docker_host_validate_storage_and_configuration() {
  docker_host_exact_metadata "${DOCKER_HOST_STORAGE_ROOT}" directory "${DOCKER_HOST_OWNER_UID}:${DOCKER_HOST_OWNER_GID}|711" \
    || docker_host_fail configuration "Managed Docker storage root metadata differs"
  docker_host_exact_metadata "${DOCKER_HOST_ENGINE_ROOT}" directory "${DOCKER_HOST_OWNER_UID}:${DOCKER_HOST_OWNER_GID}|700" \
    || docker_host_fail configuration "Managed Docker Engine storage metadata differs"
  docker_host_exact_metadata "${DOCKER_HOST_CONTAINERD_ROOT}" directory "${DOCKER_HOST_OWNER_UID}:${DOCKER_HOST_OWNER_GID}|700" \
    || docker_host_fail configuration "Managed containerd storage metadata differs"
  docker_host_storage_directory_exact \
    || docker_host_fail configuration "Managed Docker storage root contains unexpected entries"
  docker_host_exact_metadata "${DOCKER_HOST_DAEMON_DIRECTORY}" directory "${DOCKER_HOST_OWNER_UID}:${DOCKER_HOST_OWNER_GID}|755" \
    || docker_host_fail configuration "Docker configuration directory metadata differs"
  docker_host_exact_metadata "${DOCKER_HOST_CONTAINERD_DIRECTORY}" directory "${DOCKER_HOST_OWNER_UID}:${DOCKER_HOST_OWNER_GID}|755" \
    || docker_host_fail configuration "containerd configuration directory metadata differs"
  docker_host_exact_metadata "${DOCKER_HOST_DAEMON_CONFIG}" file "${DOCKER_HOST_OWNER_UID}:${DOCKER_HOST_OWNER_GID}|644" \
    && docker_host_exact_content docker_host_daemon_content "${DOCKER_HOST_DAEMON_CONFIG}" \
    || docker_host_fail configuration "Docker daemon configuration differs from managed content or metadata"
  docker_host_exact_metadata "${DOCKER_HOST_CONTAINERD_CONFIG}" file "${DOCKER_HOST_OWNER_UID}:${DOCKER_HOST_OWNER_GID}|644" \
    && docker_host_exact_content docker_host_containerd_content "${DOCKER_HOST_CONTAINERD_CONFIG}" \
    || docker_host_fail configuration "containerd configuration differs from managed content or metadata"
  docker_host_configuration_directory_exact "${DOCKER_HOST_DAEMON_DIRECTORY}" "${DOCKER_HOST_DAEMON_CONFIG}" \
    || docker_host_fail configuration "Docker configuration directory contains unmanaged entries"
  docker_host_configuration_directory_exact "${DOCKER_HOST_CONTAINERD_DIRECTORY}" "${DOCKER_HOST_CONTAINERD_CONFIG}" \
    || docker_host_fail configuration "containerd configuration directory contains unmanaged entries"
}

docker_host_validate_preparing_paths() {
  local directory entry listing=${DOCKER_HOST_STATE_ROOT}/preparing-entries.bin
  if docker_host_path_occupied "${DOCKER_HOST_STORAGE_ROOT}"; then
    docker_host_exact_metadata "${DOCKER_HOST_STORAGE_ROOT}" directory "${DOCKER_HOST_OWNER_UID}:${DOCKER_HOST_OWNER_GID}|711" || return 1
    /usr/bin/find -P "${DOCKER_HOST_STORAGE_ROOT}" -mindepth 1 -maxdepth 1 -print0 > "${listing}" || return 1
    while IFS= read -r -d '' entry; do
      case "${entry}" in
        "${DOCKER_HOST_ENGINE_ROOT}"|"${DOCKER_HOST_CONTAINERD_ROOT}")
          docker_host_exact_metadata "${entry}" directory "${DOCKER_HOST_OWNER_UID}:${DOCKER_HOST_OWNER_GID}|700" || return 1 ;;
        *) return 1 ;;
      esac
    done < "${listing}"
  fi
  for directory in "${DOCKER_HOST_DAEMON_DIRECTORY}" "${DOCKER_HOST_CONTAINERD_DIRECTORY}"; do
    docker_host_path_absent "${directory}" && continue
    docker_host_exact_metadata "${directory}" directory "${DOCKER_HOST_OWNER_UID}:${DOCKER_HOST_OWNER_GID}|755" || return 1
    /usr/bin/find -P "${directory}" -mindepth 1 -maxdepth 1 -print0 > "${listing}" || return 1
    while IFS= read -r -d '' entry; do
      case "${entry}" in
        "${DOCKER_HOST_DAEMON_CONFIG}")
          docker_host_exact_metadata "${entry}" file "${DOCKER_HOST_OWNER_UID}:${DOCKER_HOST_OWNER_GID}|644" \
            && docker_host_exact_content docker_host_daemon_content "${entry}" || return 1 ;;
        "${DOCKER_HOST_CONTAINERD_CONFIG}")
          docker_host_exact_metadata "${entry}" file "${DOCKER_HOST_OWNER_UID}:${DOCKER_HOST_OWNER_GID}|644" \
            && docker_host_exact_content docker_host_containerd_content "${entry}" || return 1 ;;
        "${DOCKER_HOST_DAEMON_DIRECTORY}/.agent-relay-daemon.json.tmp."*|"${DOCKER_HOST_CONTAINERD_DIRECTORY}/.agent-relay-config.toml.tmp."*) ;;
        *) return 1 ;;
      esac
    done < "${listing}"
  done
}

docker_host_remove_empty_default_data() {
  local path
  for path in "${DOCKER_HOST_DEFAULT_ENGINE_ROOT}" "${DOCKER_HOST_DEFAULT_CONTAINERD_ROOT}"; do
    docker_host_directory_empty "${path}" || docker_host_fail configuration "Default Docker data path is populated"
    docker_host_path_absent "${path}" || /usr/bin/rmdir -- "${path}" \
      || docker_host_fail configuration "Could not remove empty default Docker data path: ${path}"
  done
}

docker_host_any_package_present() {
  local package status
  for package in "${DOCKER_DEBIAN_CONFLICTS[@]}" "${DOCKER_DEBIAN_PACKAGES[@]}"; do
    status="$(docker_debian_package_status "${package}")"
    docker_debian_package_absent "${status}" || return 0
  done
  return 1
}

docker_host_marker_package_contains() {
  local package="$1" marker_packages="$2"
  /usr/bin/grep -Eq "^${package//./\\.}\\|" "${marker_packages}"
}

docker_host_validate_phase_packages() {
  local phase="$1" package status version expected marker_packages=${DOCKER_HOST_STATE_ROOT}/boundary-marker-packages
  docker_host_marker_packages > "${marker_packages}"
  for package in "${DOCKER_DEBIAN_CONFLICTS[@]}"; do
    docker_debian_package_absent "$(docker_debian_package_status "${package}")" || return 1
  done
  if [[ "${phase}" == preparing ]]; then
    for package in "${DOCKER_DEBIAN_PACKAGES[@]}"; do
      docker_debian_package_absent "$(docker_debian_package_status "${package}")" || return 1
    done
    return 0
  fi
  while IFS='|' read -r package expected; do
    [[ -n "${package}" ]] || continue
    status="$(docker_debian_package_status "${package}")"
    docker_debian_package_absent "${status}" && { [[ "${phase}" == transaction ]] || return 1; continue; }
    version=${status#*|}; version=${version%$'\n'}
    [[ "${version}" == "${expected}" ]] || return 1
    if [[ "${phase}" != transaction ]]; then docker_debian_package_installed "${status}" || return 1; fi
  done < "${marker_packages}"
  if [[ "${phase}" == installed || "${phase}" == complete ]]; then
    for package in "${DOCKER_DEBIAN_PACKAGES[@]}"; do docker_host_marker_package_contains "${package}" "${marker_packages}" || return 1; done
  fi
}

docker_host_command_state_absent() {
  local command path
  for command in docker dockerd containerd ctr; do
    path="$(PATH="${DOCKER_HOST_CODEX_PATH}" command -v "${command}" 2>/dev/null || true)"
    [[ -z "${path}" ]] || return 1
  done
  return 0
}

docker_host_local_plugin_overrides_absent() {
  local directory plugin
  docker_host_path_absent "${DOCKER_HOST_RUNNER_HOME}/.docker/config.json" || return 1
  for directory in "${DOCKER_HOST_RUNNER_HOME}/.docker/cli-plugins" \
    /usr/local/lib/docker/cli-plugins /usr/local/libexec/docker/cli-plugins; do
    for plugin in docker-buildx docker-compose; do docker_host_path_absent "${directory}/${plugin}" || return 1; done
  done
}

docker_host_plugin_overrides_absent() {
  local directory plugin
  docker_host_local_plugin_overrides_absent || return 1
  for directory in /usr/lib/docker/cli-plugins /usr/libexec/docker/cli-plugins; do
    for plugin in docker-buildx docker-compose; do docker_host_path_absent "${directory}/${plugin}" || return 1; done
  done
}

docker_host_direct_unit_state_absent() {
  local root unit
  for root in "${DOCKER_HOST_UNIT_ROOTS[@]}"; do
    for unit in docker.service docker.socket containerd.service; do
      docker_host_path_absent "${root}/${unit}" && docker_host_path_absent "${root}/${unit}.d" || return 1
    done
  done
}

docker_host_override_unit_state_absent() {
  local root unit
  for root in "${DOCKER_HOST_OVERRIDE_UNIT_ROOTS[@]}"; do
    for unit in docker.service docker.socket containerd.service; do
      docker_host_path_absent "${root}/${unit}" && docker_host_path_absent "${root}/${unit}.d" || return 1
    done
  done
}

docker_host_unit_path_owned_by() {
  local path="$1" expected="$2" alias owner
  owner="$(docker_debian_command_owner "${path}" 2>/dev/null || true)"
  [[ "${owner}" == "${expected}" ]] && return 0
  case "${path}" in
    /usr/lib/systemd/system/*) alias=/lib/systemd/system/${path##*/} ;;
    /lib/systemd/system/*) alias=/usr/lib/systemd/system/${path##*/} ;;
    *) return 1 ;;
  esac
  owner="$(docker_debian_command_owner "${alias}" 2>/dev/null || true)"
  [[ "${owner}" == "${expected}" ]]
}

docker_host_package_unit_state_safe_partial() {
  local root unit path owner
  docker_host_override_unit_state_absent || return 1
  for root in "${DOCKER_HOST_PACKAGE_UNIT_ROOTS[@]}"; do
    for unit in docker.service docker.socket containerd.service; do
      docker_host_path_absent "${root}/${unit}.d" || return 1
      path=${root}/${unit}
      docker_host_path_absent "${path}" && continue
      [[ -f "${path}" && ! -L "${path}" ]] || return 1
      [[ "${unit}" == containerd.service ]] && owner=containerd.io || owner=docker-ce
      docker_host_unit_path_owned_by "${path}" "${owner}" || return 1
    done
  done
}

docker_host_expected_activation_link() {
  case "$1" in
    "${DOCKER_HOST_ENABLE_ROOT}/multi-user.target.wants/containerd.service") printf '%s\n' containerd.service ;;
    "${DOCKER_HOST_ENABLE_ROOT}/multi-user.target.wants/docker.service") printf '%s\n' docker.service ;;
    "${DOCKER_HOST_ENABLE_ROOT}/sockets.target.wants/docker.socket") printf '%s\n' docker.socket ;;
    *) return 1 ;;
  esac
}

docker_host_activation_links_validate() {
  local mode="$1" root path unit expected canonical listing=${DOCKER_HOST_STATE_ROOT}/activation-links.bin
  local seen_containerd=0 seen_docker=0 seen_socket=0
  : > "${listing}"
  for root in "${DOCKER_HOST_UNIT_ROOTS[@]}"; do
    docker_host_path_absent "${root}" && continue
    [[ -d "${root}" && ! -L "${root}" ]] || return 1
    /usr/bin/find -P "${root}" -mindepth 2 -maxdepth 2 \
      \( -path '*.wants/docker.service' -o -path '*.requires/docker.service' \
      -o -path '*.wants/docker.socket' -o -path '*.requires/docker.socket' \
      -o -path '*.wants/containerd.service' -o -path '*.requires/containerd.service' \) \
      -print0 >> "${listing}" || return 1
  done
  while IFS= read -r -d '' path; do
    if [[ "${mode}" == absent ]]; then return 1; fi
    unit="$(docker_host_expected_activation_link "${path}")" || return 1
    [[ -L "${path}" ]] || return 1
    canonical="$(/usr/bin/readlink -f -- "${path}")" || return 1
    expected="$(docker_host_official_unit_path "${unit}")" || return 1
    [[ "${canonical}" == "$(/usr/bin/readlink -f -- "${expected}")" ]] || return 1
    case "${unit}" in
      containerd.service) ((seen_containerd += 1)) ;;
      docker.service) ((seen_docker += 1)) ;;
      docker.socket) ((seen_socket += 1)) ;;
    esac
  done < "${listing}"
  if [[ "${mode}" == exact ]]; then
    (( seen_containerd == 1 && seen_docker == 1 && seen_socket == 1 ))
  else
    (( seen_containerd <= 1 && seen_docker <= 1 && seen_socket <= 1 ))
  fi
}

docker_host_official_unit_path() {
  local unit="$1" owner root path found= canonical
  [[ "${unit}" == containerd.service ]] && owner=containerd.io || owner=docker-ce
  for root in "${DOCKER_HOST_PACKAGE_UNIT_ROOTS[@]}"; do
    path=${root}/${unit}
    docker_host_path_occupied "${path}" || continue
    [[ -f "${path}" && ! -L "${path}" ]] || return 1
    docker_host_unit_path_owned_by "${path}" "${owner}" || return 1
    canonical="$(/usr/bin/readlink -f -- "${path}")" || return 1
    if [[ -z "${found}" ]]; then found=${path}; else [[ "$(/usr/bin/readlink -f -- "${found}")" == "${canonical}" ]] || return 1; fi
  done
  [[ -n "${found}" ]] || return 1
  printf '%s\n' "${found}"
}

docker_host_unit_absent() {
  local unit="$1" load
  load="$(/usr/bin/env LC_ALL=C LANG=C /usr/bin/systemctl show --property=LoadState --value "${unit}" 2>/dev/null)" || return 1
  [[ "${load}" == not-found ]]
}

docker_host_services_inactive() {
  local unit
  for unit in docker.service docker.socket containerd.service; do
    ! /usr/bin/env LC_ALL=C LANG=C /usr/bin/systemctl is-active --quiet "${unit}" || return 1
  done
}

docker_host_effective_components_safe_partial() {
  local command effective owner expected_owner
  for command in docker dockerd containerd ctr; do
    effective="$(PATH="${DOCKER_HOST_CODEX_PATH}" command -v "${command}" 2>/dev/null || true)"
    [[ -z "${effective}" ]] && continue
    [[ "${effective}" == "/usr/bin/${command}" && -f "${effective}" && ! -L "${effective}" && -x "${effective}" ]] || return 1
    case "${command}" in docker) expected_owner=docker-ce-cli ;; dockerd) expected_owner=docker-ce ;; *) expected_owner=containerd.io ;; esac
    owner="$(docker_debian_command_owner "${effective}")" || return 1
    [[ "${owner}" == "${expected_owner}" ]] || return 1
  done
}

docker_host_socket_safe_or_absent() {
  local metadata
  if docker_host_path_absent /run/docker.sock && docker_host_path_absent /var/run/docker.sock; then return 0; fi
  [[ -S /run/docker.sock ]] || return 1
  [[ "$(/usr/bin/readlink -f -- /var/run/docker.sock 2>/dev/null)" == /run/docker.sock ]] || return 1
  metadata="$(/usr/bin/stat -c '%U:%G|%a' -- /run/docker.sock)" || return 1
  [[ "${metadata}" == root:docker\|660 ]]
}

docker_host_validate_phase_boundary() {
  local phase="$1"
  docker_host_validate_publication_stages "${phase}" || docker_host_fail inspection "${phase} state contains an unsafe managed publication stage"
  docker_host_validate_phase_packages "${phase}" || docker_host_fail inspection "${phase} package state is outside the owned Docker transaction"
  if [[ "${phase}" == transaction ]]; then docker_debian_assert_recovery_dpkg_bounded; else docker_debian_assert_clean_dpkg; fi
  docker_host_local_plugin_overrides_absent || docker_host_fail inspection "${phase} state contains a local or user Docker CLI override"
  docker_host_directory_empty "${DOCKER_HOST_DEFAULT_ENGINE_ROOT}" && docker_host_directory_empty "${DOCKER_HOST_DEFAULT_CONTAINERD_ROOT}" \
    || docker_host_fail inspection "${phase} state contains unsupported default Docker data"
  if [[ "${phase}" == preparing ]]; then
    docker_host_command_state_absent || docker_host_fail inspection "Preparing state contains an effective Docker or containerd command"
    docker_host_direct_unit_state_absent || docker_host_fail inspection "Preparing state contains a Docker unit or drop-in"
    docker_host_activation_links_validate absent || docker_host_fail inspection "Preparing state contains a Docker activation link"
    docker_host_path_absent /run/docker.sock && docker_host_path_absent /var/run/docker.sock \
      || docker_host_fail inspection "Preparing state contains a Docker socket"
    docker_host_validate_preparing_paths || docker_host_fail inspection "Preparing managed paths contain unexpected state"
    if docker_host_path_occupied "${DOCKER_HOST_POLICY}"; then
      docker_host_policy_valid "${DOCKER_HOST_POLICY}" || docker_host_fail inspection "Preparing policy-rc.d is not the exact managed policy"
    fi
  else
    docker_host_effective_components_safe_partial || docker_host_fail inspection "${phase} state contains an unexpected effective command"
    docker_host_package_unit_state_safe_partial || docker_host_fail inspection "${phase} state contains an unexpected unit or drop-in"
    docker_host_activation_links_validate subset || docker_host_fail inspection "${phase} state contains an unexpected activation link"
    docker_host_socket_safe_or_absent || docker_host_fail inspection "${phase} state contains an unexpected Docker socket"
    docker_host_validate_storage_and_configuration
    if [[ "${phase}" == transaction ]]; then
      if docker_host_path_occupied "${DOCKER_HOST_POLICY}"; then
        docker_host_policy_valid "${DOCKER_HOST_POLICY}" || docker_host_fail inspection "Transaction policy-rc.d is unexpected"
      fi
    else
      docker_host_path_absent "${DOCKER_HOST_POLICY}" || docker_host_fail inspection "${phase} state contains policy-rc.d"
    fi
  fi
  docker_debian_validate_repository_boundary "${phase}" || docker_host_fail inspection "${phase} repository state is outside the owned transaction"
}

docker_host_classify() {
  if docker_host_path_occupied "${DOCKER_HOST_MARKER}"; then
    docker_host_marker_valid || docker_host_fail inspection "Managed Docker marker is unsafe or malformed"
    DOCKER_HOST_CLASSIFICATION=managed
    return
  fi
  docker_host_any_package_present && docker_host_fail inspection "Pre-existing Docker or container runtime package state is unsupported"
  docker_host_command_state_absent || docker_host_fail inspection "Pre-existing Docker or containerd command state is unsupported"
  docker_host_plugin_overrides_absent || docker_host_fail inspection "Pre-existing Docker CLI plugin override state is unsupported"
  docker_host_path_absent "${DOCKER_HOST_DAEMON_CONFIG}" && docker_host_path_absent "${DOCKER_HOST_CONTAINERD_CONFIG}" \
    || docker_host_fail inspection "Pre-existing Docker or containerd configuration is unsupported"
  docker_host_directory_empty "${DOCKER_HOST_DAEMON_DIRECTORY}" && docker_host_directory_empty "${DOCKER_HOST_CONTAINERD_DIRECTORY}" \
    || docker_host_fail inspection "Pre-existing Docker or containerd configuration directory content is unsupported"
  docker_host_path_absent /run/docker.sock && docker_host_path_absent /var/run/docker.sock || docker_host_fail inspection "Pre-existing Docker socket state is unsupported"
  docker_host_directory_empty "${DOCKER_HOST_STORAGE_ROOT}" || docker_host_fail inspection "Managed Docker storage is already populated without a marker"
  docker_host_directory_empty "${DOCKER_HOST_DEFAULT_ENGINE_ROOT}" && docker_host_directory_empty "${DOCKER_HOST_DEFAULT_CONTAINERD_ROOT}" \
    || docker_host_fail inspection "Pre-existing default Docker or containerd data is unsupported"
  docker_debian_inspect_repository_definitions
  (( DOCKER_DEBIAN_REPOSITORY_DEFINITION_COUNT == 0 )) || docker_host_fail inspection "Pre-existing Docker apt repository state is unsupported"
  docker_host_path_absent "${DOCKER_DEBIAN_MANAGED_KEY}" && docker_host_path_absent /etc/apt/keyrings/docker.gpg || docker_host_fail inspection "Pre-existing Docker apt key state is unsupported"
  docker_debian_validate_repository_boundary fresh || docker_host_fail inspection "Pre-existing Docker repository staging state is unsupported"
  docker_host_direct_unit_state_absent || docker_host_fail inspection "Pre-existing Docker unit or drop-in files are unsupported"
  docker_host_activation_links_validate absent || docker_host_fail inspection "Pre-existing Docker activation links are unsupported"
  local unit
  for unit in docker.service docker.socket containerd.service; do docker_host_unit_absent "${unit}" || docker_host_fail inspection "Pre-existing ${unit} is unsupported"; done
  docker_host_path_absent "${DOCKER_HOST_POLICY}" || docker_host_fail inspection "A pre-existing policy-rc.d prevents controlled Docker installation"
  docker_host_validate_publication_stages fresh || docker_host_fail inspection "Pre-existing managed publication staging state is unsafe"
  DOCKER_HOST_CLASSIFICATION=fresh
  DOCKER_HOST_FRESH=1
}

docker_host_prepare_storage_and_configuration() {
  /usr/bin/install -d -o root -g root -m 0711 "${DOCKER_HOST_STORAGE_ROOT}"
  /usr/bin/install -d -o root -g root -m 0700 "${DOCKER_HOST_ENGINE_ROOT}" "${DOCKER_HOST_CONTAINERD_ROOT}"
  docker_host_daemon_content > "${DOCKER_HOST_STATE_ROOT}/daemon.json"
  docker_host_containerd_content > "${DOCKER_HOST_STATE_ROOT}/config.toml"
  docker_host_path_absent "${DOCKER_HOST_DAEMON_CONFIG}" \
    && docker_host_atomic_publish "${DOCKER_HOST_STATE_ROOT}/daemon.json" "${DOCKER_HOST_DAEMON_CONFIG}" 0644
  docker_host_path_absent "${DOCKER_HOST_CONTAINERD_CONFIG}" \
    && docker_host_atomic_publish "${DOCKER_HOST_STATE_ROOT}/config.toml" "${DOCKER_HOST_CONTAINERD_CONFIG}" 0644
  docker_host_validate_storage_and_configuration
}

docker_host_install_policy() {
  if docker_host_path_occupied "${DOCKER_HOST_POLICY}"; then
    docker_host_policy_valid "${DOCKER_HOST_POLICY}" || docker_host_fail package "Unexpected policy-rc.d exists"
  else
    docker_host_policy_content > "${DOCKER_HOST_STATE_ROOT}/policy-rc.d"
    docker_host_atomic_publish "${DOCKER_HOST_STATE_ROOT}/policy-rc.d" "${DOCKER_HOST_POLICY}" 0755
  fi
  DOCKER_HOST_POLICY_REMOVE_ON_EXIT=1
}

docker_host_recover_preparing_policy() {
  docker_host_path_absent "${DOCKER_HOST_POLICY}" && return 0
  docker_host_policy_valid "${DOCKER_HOST_POLICY}" || docker_host_fail package "Unexpected preparing policy-rc.d"
  docker_host_services_inactive || docker_host_fail package "Docker services activated with a preparing policy-rc.d"
  /usr/bin/rm -f -- "${DOCKER_HOST_POLICY}"
  docker_host_path_absent "${DOCKER_HOST_POLICY}" || docker_host_fail package "Could not recover preparing policy-rc.d"
}

docker_host_finish_package_transaction() {
  local packages="$1"
  docker_host_policy_valid "${DOCKER_HOST_POLICY}" || docker_host_fail package "Managed policy-rc.d changed during package work"
  /usr/bin/rm -f -- "${DOCKER_HOST_POLICY}"
  docker_host_path_absent "${DOCKER_HOST_POLICY}" || docker_host_fail package "Managed policy-rc.d could not be removed"
  docker_host_publish_marker installed "${packages}"
}

docker_host_validate_managed_packages() {
  local phase package expected status actual marker_packages=${DOCKER_HOST_STATE_ROOT}/marker-packages
  phase="$(docker_host_marker_phase)"
  docker_host_marker_packages > "${marker_packages}"
  if [[ "${phase}" == installed || "${phase}" == complete ]]; then
    for package in "${DOCKER_DEBIAN_PACKAGES[@]}"; do /usr/bin/grep -Eq "^${package//./\\.}\\|" "${marker_packages}" || return 1; done
  fi
  while IFS='|' read -r package expected; do
    [[ -n "${package}" ]] || continue
    status="$(docker_debian_package_status "${package}")"
    docker_debian_package_installed "${status}" || return 1
    actual=${status#*|}; actual=${actual%$'\n'}
    [[ "${actual}" == "${expected}" ]] || return 1
  done < "${marker_packages}"
  local conflict
  for conflict in "${DOCKER_DEBIAN_CONFLICTS[@]}"; do docker_debian_package_absent "$(docker_debian_package_status "${conflict}")" || return 1; done
}

docker_host_recover_transaction() {
  local package status exact_spec package_state=${DOCKER_HOST_STATE_ROOT}/dpkg-recovery-packages.txt marker_packages=${DOCKER_HOST_STATE_ROOT}/marker-packages
  docker_host_marker_packages > "${marker_packages}"
  /usr/bin/env LC_ALL=C LANG=C /usr/bin/dpkg-query -W -f='${Package}|${db:Status-Abbrev}|${Version}\n' \
    > "${package_state}" \
    || docker_host_fail package "Could not inspect interrupted managed package state"
  docker_debian_recovery_dpkg_state_allowed "${package_state}" "${marker_packages}" \
    || docker_host_fail package "Interrupted dpkg state includes unrelated non-trigger package work"
  docker_host_install_policy
  DEBIAN_FRONTEND=noninteractive LC_ALL=C LANG=C /usr/bin/dpkg --configure -a \
    || docker_host_fail package "Could not resume configuration of the recorded Docker transaction"
  local -a exact=()
  while IFS='|' read -r package status; do exact+=("${package}=${status}"); done < "${marker_packages}"
  DEBIAN_FRONTEND=noninteractive LC_ALL=C LANG=C /usr/bin/apt-get --yes --no-install-recommends install "${exact[@]}" \
    || docker_host_fail package "Could not resume the recorded Docker package transaction"
  docker_debian_assert_clean_dpkg
  while IFS='|' read -r package status; do
    exact_spec="$(docker_debian_package_status "${package}")"
    docker_debian_package_installed "${exact_spec}" && [[ "${exact_spec#*|}" == "${status}" ]] \
      || docker_host_fail package "Recovered package does not match its recorded version: ${package}"
  done < "${marker_packages}"
  DOCKER_HOST_POLICY_REMOVE_ON_EXIT=1
  docker_host_finish_package_transaction "${marker_packages}"
}

docker_host_inspect_official_units() {
  local unit owner fragment dropins official_path
  docker_host_override_unit_state_absent || docker_host_fail service "Docker units have administrator, runtime, or local overrides"
  docker_host_package_unit_state_safe_partial || docker_host_fail service "Docker package unit locations are unsafe"
  for unit in containerd.service docker.service docker.socket; do
    [[ "${unit}" == containerd.service ]] && owner=containerd.io || owner=docker-ce
    official_path="$(docker_host_official_unit_path "${unit}")" || docker_host_fail service "Official ${unit} file is absent or unsafe"
    fragment="$(/usr/bin/env LC_ALL=C LANG=C /usr/bin/systemctl show --property=FragmentPath --value "${unit}")"
    docker_host_unit_path_owned_by "${fragment}" "${owner}" || docker_host_fail service "${unit} is not owned by ${owner}"
    [[ "$(/usr/bin/readlink -f -- "${fragment}")" == "$(/usr/bin/readlink -f -- "${official_path}")" ]] || docker_host_fail service "${unit} manager fragment differs from the direct package file"
    dropins="$(/usr/bin/env LC_ALL=C LANG=C /usr/bin/systemctl show --property=DropInPaths --value "${unit}")"
    [[ -z "${dropins}" ]] || docker_host_fail service "${unit} has unsupported systemd drop-ins"
  done
}

docker_host_validate_components() {
  local package path package_path owner effective expected_buildx expected_compose
  for package_path in docker-ce:/usr/bin/dockerd docker-ce-cli:/usr/bin/docker containerd.io:/usr/bin/containerd containerd.io:/usr/bin/ctr; do
    package=${package_path%%:*}
    path=${package_path#*:}
    [[ -f "${path}" && ! -L "${path}" && -x "${path}" ]] || docker_host_fail validation "Missing official executable: ${path}"
    owner="$(docker_debian_command_owner "${path}")" || docker_host_fail validation "Could not identify package owner for ${path}"
    [[ "${owner}" == "${package}" ]] || docker_host_fail validation "${path} is not owned by ${package}"
  done
  for package in docker dockerd containerd ctr; do
    effective="$(PATH="${DOCKER_HOST_CODEX_PATH}" command -v "${package}" 2>/dev/null || true)"
    [[ "${effective}" == "/usr/bin/${package}" ]] || docker_host_fail validation "Effective ${package} command is not the official package file"
  done
  docker_host_local_plugin_overrides_absent || docker_host_fail validation "Docker CLI has a local or user plugin override"
  expected_buildx="$(docker_debian_plugin_path docker-buildx-plugin docker-buildx)" || docker_host_fail validation "Could not locate official Buildx plugin"
  [[ -f "${expected_buildx}" && ! -L "${expected_buildx}" && -x "${expected_buildx}" ]] || docker_host_fail validation "Official Buildx plugin is not a regular executable"
  [[ "$(docker_debian_command_owner "${expected_buildx}")" == docker-buildx-plugin ]] || docker_host_fail validation "Buildx plugin has unexpected ownership"
  expected_compose="$(docker_debian_plugin_path docker-compose-plugin docker-compose)" || docker_host_fail validation "Could not locate official Compose plugin"
  [[ -f "${expected_compose}" && ! -L "${expected_compose}" && -x "${expected_compose}" ]] || docker_host_fail validation "Official Compose plugin is not a regular executable"
  [[ "$(docker_debian_command_owner "${expected_compose}")" == docker-compose-plugin ]] || docker_host_fail validation "Compose plugin has unexpected ownership"
  for path in \
    "${DOCKER_HOST_RUNNER_HOME}/.docker/cli-plugins/docker-buildx" \
    "${DOCKER_HOST_RUNNER_HOME}/.docker/cli-plugins/docker-compose" \
    /usr/local/lib/docker/cli-plugins/docker-buildx /usr/local/lib/docker/cli-plugins/docker-compose \
    /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-compose \
    /usr/lib/docker/cli-plugins/docker-buildx /usr/lib/docker/cli-plugins/docker-compose \
    /usr/libexec/docker/cli-plugins/docker-buildx /usr/libexec/docker/cli-plugins/docker-compose; do
    docker_host_path_absent "${path}" || [[ "${path}" == "${expected_buildx}" || "${path}" == "${expected_compose}" ]] \
      || docker_host_fail validation "Docker CLI plugin is shadowed by ${path}"
  done
}

docker_host_membership_actions() { (( $1 == 1 )) || printf 'add-runner\n'; (( $2 == 0 )) || printf 'remove-builder\n'; }

docker_host_ensure_membership_and_services() {
  local runner_has=0 builder_has=0 action unit
  /usr/bin/getent group docker >/dev/null || /usr/sbin/groupadd docker
  /usr/bin/id -nG "${DOCKER_HOST_RUNNER_USER}" | /usr/bin/tr ' ' '\n' | /usr/bin/grep -Fxq docker && runner_has=1 || true
  /usr/bin/id -nG "${DOCKER_HOST_BUILD_USER}" | /usr/bin/tr ' ' '\n' | /usr/bin/grep -Fxq docker && builder_has=1 || true
  while IFS= read -r action; do case "${action}" in add-runner) /usr/sbin/usermod -aG docker "${DOCKER_HOST_RUNNER_USER}" ;; remove-builder) /usr/bin/gpasswd --delete "${DOCKER_HOST_BUILD_USER}" docker >/dev/null ;; esac; done \
    < <(docker_host_membership_actions "${runner_has}" "${builder_has}")
  for unit in containerd.service docker.socket docker.service; do
    /usr/bin/env LC_ALL=C LANG=C /usr/bin/systemctl enable "${unit}" || docker_host_fail service "Could not enable ${unit}"
    /usr/bin/env LC_ALL=C LANG=C /usr/bin/systemctl start "${unit}" || docker_host_fail service "Could not start ${unit}"
    /usr/bin/env LC_ALL=C LANG=C /usr/bin/systemctl is-active --quiet "${unit}" || docker_host_fail service "${unit} is not active"
  done
}

docker_host_stop_managed_services() {
  /usr/bin/env LC_ALL=C LANG=C /usr/bin/systemctl stop docker.service docker.socket containerd.service \
    || docker_host_fail service "Could not stop partially activated Docker services"
  docker_host_services_inactive || docker_host_fail service "Docker services remained active after recovery stop"
}

docker_host_service_recovery_action() {
  (( $1 == 0 && $2 == 0 && $3 == 0 )) && printf 'none\n' || printf 'stop-all\n'
}

docker_host_recover_services_if_needed() {
  local containerd=0 socket=0 engine=0 action
  /usr/bin/env LC_ALL=C LANG=C /usr/bin/systemctl is-active --quiet containerd.service && containerd=1 || true
  /usr/bin/env LC_ALL=C LANG=C /usr/bin/systemctl is-active --quiet docker.socket && socket=1 || true
  /usr/bin/env LC_ALL=C LANG=C /usr/bin/systemctl is-active --quiet docker.service && engine=1 || true
  action="$(docker_host_service_recovery_action "${containerd}" "${socket}" "${engine}")"
  [[ "${action}" == none ]] || docker_host_stop_managed_services
}

docker_host_validate_service_state() {
  local unit
  docker_host_activation_links_validate exact || docker_host_fail service "Managed Docker activation links are incomplete or unexpected"
  for unit in containerd.service docker.socket docker.service; do
    /usr/bin/env LC_ALL=C LANG=C /usr/bin/systemctl is-enabled --quiet "${unit}" \
      || docker_host_fail service "${unit} is not enabled"
    /usr/bin/env LC_ALL=C LANG=C /usr/bin/systemctl is-active --quiet "${unit}" \
      || docker_host_fail service "${unit} is not active"
  done
}

docker_host_activate_after_revalidation() {
  docker_host_validate_storage_and_configuration
  docker_host_ensure_membership_and_services
  docker_host_validate_service_state
}

docker_host_client_environment() { local client="$1"; DOCKER_HOST_CLIENT_ENVIRONMENT=(/usr/bin/env -i "HOME=${client}" "DOCKER_CONFIG=${client}" PATH=/usr/bin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8); }
docker_host_create_runner_client() { local client; client="$(/usr/bin/mktemp -d "${DOCKER_HOST_STATE_CONTAINER}/client.XXXXXXXX")" || return 1; /usr/bin/chown "${DOCKER_HOST_RUNNER_USER}:${DOCKER_HOST_RUNNER_USER}" "${client}"; /usr/bin/chmod 0700 "${client}"; printf '%s\n' "${client}"; }
docker_host_ctr_command() {
  DOCKER_HOST_CTR_COMMAND=(/usr/bin/timeout --signal=TERM --kill-after=2s "${DOCKER_HOST_CTR_TIMEOUT_SECONDS}s"
    /usr/bin/env -i PATH=/usr/bin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8
    /usr/bin/ctr --address /run/containerd/containerd.sock plugins ls -d)
}

docker_host_validate() {
  local client info containerd_info socket_metadata
  [[ -S "${DOCKER_HOST_SOCKET}" ]] || docker_host_fail validation "Docker Unix socket is unavailable: ${DOCKER_HOST_SOCKET}"
  [[ "$(/usr/bin/readlink -f -- "${DOCKER_HOST_SOCKET}")" == /run/docker.sock ]] || docker_host_fail validation "Docker socket does not resolve to /run/docker.sock"
  socket_metadata="$(/usr/bin/stat -c '%U:%G|%a' -- /run/docker.sock)" || docker_host_fail validation "Could not inspect Docker socket metadata"
  [[ "${socket_metadata}" == root:docker\|660 ]] || docker_host_fail validation "Docker socket must be root:docker mode 0660"
  docker_host_validate_components
  client="$(docker_host_create_runner_client)" || docker_host_fail validation "Could not create Docker client state"
  docker_host_client_environment "${client}"
  info=${DOCKER_HOST_STATE_ROOT}/docker-info
  /usr/sbin/runuser -u "${DOCKER_HOST_RUNNER_USER}" -- "${DOCKER_HOST_CLIENT_ENVIRONMENT[@]}" /usr/bin/docker --host unix:///var/run/docker.sock info --format '{{.DockerRootDir}}' > "${info}" \
    || docker_host_fail validation "github-runner cannot inspect the local Docker daemon"
  [[ "$(<"${info}")" == "${DOCKER_HOST_ENGINE_ROOT}" ]] || docker_host_fail validation "Effective Docker data-root is not managed"
  /usr/sbin/runuser -u "${DOCKER_HOST_RUNNER_USER}" -- "${DOCKER_HOST_CLIENT_ENVIRONMENT[@]}" /usr/bin/docker --host unix:///var/run/docker.sock buildx version >/dev/null || docker_host_fail validation "Docker Buildx validation failed"
  /usr/sbin/runuser -u "${DOCKER_HOST_RUNNER_USER}" -- "${DOCKER_HOST_CLIENT_ENVIRONMENT[@]}" /usr/bin/docker --host unix:///var/run/docker.sock compose version >/dev/null || docker_host_fail validation "Docker Compose validation failed"
  containerd_info=${DOCKER_HOST_STATE_ROOT}/containerd-info
  docker_host_ctr_command
  "${DOCKER_HOST_CTR_COMMAND[@]}" > "${containerd_info}" \
    || docker_host_fail validation "Could not inspect effective containerd metadata root"
  docker_host_containerd_metadata_root_exact "${containerd_info}" "${DOCKER_HOST_CONTAINERD_ROOT}" \
    || docker_host_fail validation "Effective containerd root is not managed"
  /usr/bin/id -nG "${DOCKER_HOST_RUNNER_USER}" | /usr/bin/tr ' ' '\n' | /usr/bin/grep -Fxq docker || docker_host_fail validation "github-runner is not in docker"
  ! /usr/bin/id -nG "${DOCKER_HOST_BUILD_USER}" | /usr/bin/tr ' ' '\n' | /usr/bin/grep -Fxq docker || docker_host_fail validation "agent-relay-builder must not be in docker"
  if (( DOCKER_HOST_FRESH == 1 || ${DOCKER_HOST_ACCEPTANCE:-0} == 1 )); then /usr/sbin/runuser -u "${DOCKER_HOST_RUNNER_USER}" -- "${DOCKER_HOST_CLIENT_ENVIRONMENT[@]}" /usr/bin/docker --host unix:///var/run/docker.sock run --rm hello-world; fi
  docker_host_directory_empty "${DOCKER_HOST_DEFAULT_ENGINE_ROOT}" && docker_host_directory_empty "${DOCKER_HOST_DEFAULT_CONTAINERD_ROOT}" \
    || docker_host_fail validation "Docker wrote data outside the managed storage roots"
  /usr/bin/rm -rf --one-file-system -- "${client}"
}

docker_host_containerd_metadata_root_exact() {
  local output="$1" root="$2"
  /usr/bin/awk -v expected="${root}/io.containerd.metadata.v1.bolt" '
    function finish() {
      if(type=="io.containerd.metadata.v1" && id=="bolt") {
        metadata++
        if(export_root==expected) roots++
      }
    }
    /^Type:[[:space:]]+/ {finish(); type=$2; id=""; export_root=""; next}
    /^ID:[[:space:]]+/ {id=$2; next}
    /^[[:space:]]+root[[:space:]]+/ {if(export_root!="") duplicate=1; export_root=$2; next}
    END {finish(); exit !(metadata==1 && roots==1 && !duplicate)}
  ' "${output}"
}

docker_host_prepare_state() { DOCKER_HOST_STATE_CONTAINER="$(/usr/bin/mktemp -d)" || docker_host_fail preflight "Could not create provisioner state"; /usr/bin/chown root:root "${DOCKER_HOST_STATE_CONTAINER}"; /usr/bin/chmod 0711 "${DOCKER_HOST_STATE_CONTAINER}"; DOCKER_HOST_STATE_ROOT=${DOCKER_HOST_STATE_CONTAINER}/private; /usr/bin/install -d -o root -g root -m 0700 "${DOCKER_HOST_STATE_ROOT}" "${DOCKER_HOST_STATE_ROOT}/client"; }

docker_host_preflight() {
  [[ "$(/usr/bin/id -u)" == 0 ]] || docker_host_fail preflight "docker-host.sh must run as root through update.sh"
  [[ "$(/usr/bin/ps -p 1 -o comm= | /usr/bin/tr -d '[:space:]')" == systemd ]] || docker_host_fail preflight "systemd must run as PID 1"
  [[ -f "${DOCKER_HOST_ADAPTER}" && ! -L "${DOCKER_HOST_ADAPTER}" ]] || docker_host_fail preflight "Missing Debian Docker adapter"
  local command
  for command in apt-cache apt-get awk basename chown chmod cmp curl dirname dpkg dpkg-query find getent gpasswd gpg grep id install kill mktemp mv ps readlink rm rmdir runuser sleep sort stat systemctl timeout tr uname; do
    [[ -x /usr/bin/${command} || -x /usr/sbin/${command} ]] || docker_host_fail preflight "Missing required host command: ${command}"
  done
  docker_debian_require_host
  docker_host_prepare_state
  trap docker_host_cleanup EXIT
}

docker_host_main() {
  local phase
  (( $# == 0 )) || docker_host_fail preflight "docker-host.sh does not accept arguments"
  # shellcheck source=scripts/docker-host-debian.sh
  source "${DOCKER_HOST_ADAPTER}"
  docker_host_preflight
  docker_host_classify
  if [[ "${DOCKER_HOST_CLASSIFICATION}" == fresh ]]; then
    docker_debian_assert_clean_dpkg
    docker_host_remove_publication_stages
    docker_host_publish_marker preparing
  fi
  phase="$(docker_host_marker_phase)"
  docker_host_validate_phase_boundary "${phase}"
  docker_host_remove_publication_stages
  if [[ "${phase}" == complete ]]; then
    docker_host_path_absent "${DOCKER_HOST_POLICY}" || docker_host_fail package "Managed policy-rc.d persisted after transaction completion"
    docker_host_validate_storage_and_configuration
    docker_host_path_absent "${DOCKER_HOST_DEFAULT_ENGINE_ROOT}" && docker_host_path_absent "${DOCKER_HOST_DEFAULT_CONTAINERD_ROOT}" \
      || docker_host_fail configuration "Completed managed state contains default Docker data paths"
    docker_host_validate_managed_packages || docker_host_fail inspection "Installed packages do not match the exact managed marker"
    docker_debian_validate_repository
    docker_host_inspect_official_units
    docker_host_validate_service_state
    docker_host_validate
    printf 'Docker Engine, Buildx, and Compose provisioning completed successfully\n'
    return
  fi
  DOCKER_HOST_FRESH=1
  if [[ "${phase}" == transaction || "${phase}" == installed ]]; then
    docker_host_recover_services_if_needed
  else
    docker_host_services_inactive || docker_host_fail package "Docker services activated before managed installation completed"
  fi
  if [[ "${phase}" == preparing ]]; then
    docker_host_recover_preparing_policy
    docker_host_prepare_storage_and_configuration
  else
    docker_host_validate_storage_and_configuration
  fi
  if [[ "${phase}" == transaction ]]; then
    docker_debian_ensure_repository
    docker_host_recover_transaction
  else
    docker_debian_assert_clean_dpkg
  fi
  if [[ "$(docker_host_marker_phase)" == preparing ]]; then
    docker_host_services_inactive || docker_host_fail package "Docker services activated before package installation"
    docker_host_install_policy
    docker_debian_install_components "${DOCKER_DEBIAN_PACKAGES[@]}"
    docker_host_services_inactive || docker_host_fail package "Package installation activated Docker despite policy-rc.d"
    docker_host_finish_package_transaction "${DOCKER_HOST_STATE_ROOT}/resolved-packages.txt"
  fi
  docker_host_path_absent "${DOCKER_HOST_POLICY}" || docker_host_fail package "Managed policy-rc.d persisted after package transaction"
  docker_host_remove_empty_default_data
  docker_host_validate_managed_packages || docker_host_fail inspection "Installed packages do not match the exact managed marker"
  docker_host_inspect_official_units
  docker_host_activate_after_revalidation
  docker_host_validate
  if [[ "$(docker_host_marker_phase)" == installed ]]; then
    docker_host_marker_packages > "${DOCKER_HOST_STATE_ROOT}/resolved-packages.txt"
    docker_host_publish_marker complete "${DOCKER_HOST_STATE_ROOT}/resolved-packages.txt"
  fi
  printf 'Docker Engine, Buildx, and Compose provisioning completed successfully\n'
}

if [[ "${DOCKER_HOST_LIBRARY_ONLY:-0}" != 1 ]]; then docker_host_main "$@"; fi
