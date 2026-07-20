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
DOCKER_HOST_STATE_CONTAINER=
DOCKER_HOST_STATE_ROOT=
DOCKER_HOST_FRESH=0
DOCKER_HOST_POLICY_REMOVE_ON_EXIT=0

docker_host_fail() { printf 'Docker provisioning failed in phase %s: %s\n' "$1" "$2" >&2; exit 1; }

docker_host_cleanup() {
  (( DOCKER_HOST_POLICY_REMOVE_ON_EXIT == 0 )) || [[ ! -e "${DOCKER_HOST_POLICY}" ]] || {
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
  local source="$1" target="$2" mode="$3" directory stage orphan listing=${DOCKER_HOST_STATE_ROOT}/atomic-stages.bin
  directory="$(/usr/bin/dirname -- "${target}")"
  if [[ -e "${directory}" ]]; then
    docker_host_secure_path "${directory}" directory || docker_host_fail configuration "Unsafe publication directory: ${directory}"
  else
    /usr/bin/install -d -o root -g root -m 0755 "${directory}"
  fi
  /usr/bin/find -P "${directory}" -maxdepth 1 -type f -name ".agent-relay-$(/usr/bin/basename -- "${target}").tmp.*" -print0 > "${listing}" \
    || docker_host_fail configuration "Could not inspect interrupted publication for ${target}"
  while IFS= read -r -d '' orphan; do
    docker_host_secure_path "${orphan}" file || docker_host_fail configuration "Unsafe interrupted publication: ${orphan}"
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
docker_host_policy_content() { printf '#!/bin/sh\nexit 101\n'; }

docker_host_exact_content() {
  local producer="$1" path="$2" expected=${DOCKER_HOST_STATE_ROOT}/expected
  "${producer}" > "${expected}"
  docker_host_secure_path "${path}" file && /usr/bin/cmp -s -- "${expected}" "${path}"
}

docker_host_policy_valid() { docker_host_exact_content docker_host_policy_content "$1"; }

docker_host_marker_valid() {
  docker_host_secure_path "${DOCKER_HOST_MARKER}" file || return 1
  /usr/bin/awk -F= '
    $1=="schema"&&$2=="1"{schema++}
    $1=="phase"&&($2=="preparing"||$2=="transaction"||$2=="installed"||$2=="complete"){phase++;phase_value=$2}
    $1=="package"&&$2~/^[a-z0-9.+-]+:[^[:space:]]+$/{packages++;name=$2;sub(/:.*/,"",name);if(seen[name]++)bad=1}
    !($1=="schema"||$1=="phase"||$1=="package"){bad=1}
    END{shape=(phase_value=="preparing"?packages==0:packages>0);exit !(schema==1&&phase==1&&shape&&!bad)}
  ' "${DOCKER_HOST_MARKER}"
}

docker_host_marker_phase() { /usr/bin/awk -F= '$1=="phase"{print $2}' "${DOCKER_HOST_MARKER}"; }

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

docker_host_directory_empty() {
  local path="$1" first
  [[ ! -e "${path}" ]] && return 0
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

docker_host_remove_empty_default_data() {
  local path
  for path in "${DOCKER_HOST_DEFAULT_ENGINE_ROOT}" "${DOCKER_HOST_DEFAULT_CONTAINERD_ROOT}"; do
    docker_host_directory_empty "${path}" || docker_host_fail configuration "Default Docker data path is populated"
    [[ ! -e "${path}" ]] || /usr/bin/rmdir -- "${path}" \
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

docker_host_command_state_absent() {
  local command path
  for command in docker dockerd containerd ctr; do
    path="$(PATH=/usr/local/bin:/usr/bin:/bin command -v "${command}" 2>/dev/null || true)"
    [[ -z "${path}" ]] || return 1
  done
  return 0
}

docker_host_local_plugin_overrides_absent() {
  local directory plugin
  [[ ! -e "${DOCKER_HOST_RUNNER_HOME}/.docker/config.json" ]] || return 1
  for directory in "${DOCKER_HOST_RUNNER_HOME}/.docker/cli-plugins" \
    /usr/local/lib/docker/cli-plugins /usr/local/libexec/docker/cli-plugins; do
    for plugin in docker-buildx docker-compose; do [[ ! -e "${directory}/${plugin}" ]] || return 1; done
  done
}

docker_host_plugin_overrides_absent() {
  local directory plugin
  docker_host_local_plugin_overrides_absent || return 1
  for directory in /usr/lib/docker/cli-plugins /usr/libexec/docker/cli-plugins; do
    for plugin in docker-buildx docker-compose; do [[ ! -e "${directory}/${plugin}" ]] || return 1; done
  done
}

docker_host_direct_unit_state_absent() {
  local root unit
  for root in "${DOCKER_HOST_UNIT_ROOTS[@]}"; do
    for unit in docker.service docker.socket containerd.service; do
      [[ ! -e "${root}/${unit}" && ! -e "${root}/${unit}.d" ]] || return 1
    done
  done
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

docker_host_classify() {
  if [[ -e "${DOCKER_HOST_MARKER}" ]]; then
    docker_host_marker_valid || docker_host_fail inspection "Managed Docker marker is unsafe or malformed"
    DOCKER_HOST_CLASSIFICATION=managed
    return
  fi
  docker_host_any_package_present && docker_host_fail inspection "Pre-existing Docker or container runtime package state is unsupported"
  docker_host_command_state_absent || docker_host_fail inspection "Pre-existing Docker or containerd command state is unsupported"
  docker_host_plugin_overrides_absent || docker_host_fail inspection "Pre-existing Docker CLI plugin override state is unsupported"
  [[ ! -e "${DOCKER_HOST_DAEMON_CONFIG}" && ! -e "${DOCKER_HOST_CONTAINERD_CONFIG}" ]] \
    || docker_host_fail inspection "Pre-existing Docker or containerd configuration is unsupported"
  docker_host_directory_empty "${DOCKER_HOST_DAEMON_DIRECTORY}" && docker_host_directory_empty "${DOCKER_HOST_CONTAINERD_DIRECTORY}" \
    || docker_host_fail inspection "Pre-existing Docker or containerd configuration directory content is unsupported"
  [[ ! -e /run/docker.sock && ! -e /var/run/docker.sock ]] || docker_host_fail inspection "Pre-existing Docker socket state is unsupported"
  docker_host_directory_empty "${DOCKER_HOST_STORAGE_ROOT}" || docker_host_fail inspection "Managed Docker storage is already populated without a marker"
  docker_host_directory_empty "${DOCKER_HOST_DEFAULT_ENGINE_ROOT}" && docker_host_directory_empty "${DOCKER_HOST_DEFAULT_CONTAINERD_ROOT}" \
    || docker_host_fail inspection "Pre-existing default Docker or containerd data is unsupported"
  docker_debian_inspect_repository_definitions
  (( DOCKER_DEBIAN_REPOSITORY_DEFINITION_COUNT == 0 )) || docker_host_fail inspection "Pre-existing Docker apt repository state is unsupported"
  [[ ! -e "${DOCKER_DEBIAN_MANAGED_KEY}" && ! -e /etc/apt/keyrings/docker.gpg ]] || docker_host_fail inspection "Pre-existing Docker apt key state is unsupported"
  docker_host_direct_unit_state_absent || docker_host_fail inspection "Pre-existing Docker unit or drop-in files are unsupported"
  local unit
  for unit in docker.service docker.socket containerd.service; do docker_host_unit_absent "${unit}" || docker_host_fail inspection "Pre-existing ${unit} is unsupported"; done
  [[ ! -e "${DOCKER_HOST_POLICY}" ]] || docker_host_fail inspection "A pre-existing policy-rc.d prevents controlled Docker installation"
  DOCKER_HOST_CLASSIFICATION=fresh
  DOCKER_HOST_FRESH=1
}

docker_host_prepare_storage_and_configuration() {
  /usr/bin/install -d -o root -g root -m 0711 "${DOCKER_HOST_STORAGE_ROOT}"
  /usr/bin/install -d -o root -g root -m 0700 "${DOCKER_HOST_ENGINE_ROOT}" "${DOCKER_HOST_CONTAINERD_ROOT}"
  docker_host_daemon_content > "${DOCKER_HOST_STATE_ROOT}/daemon.json"
  docker_host_containerd_content > "${DOCKER_HOST_STATE_ROOT}/config.toml"
  [[ ! -e "${DOCKER_HOST_DAEMON_CONFIG}" ]] \
    && docker_host_atomic_publish "${DOCKER_HOST_STATE_ROOT}/daemon.json" "${DOCKER_HOST_DAEMON_CONFIG}" 0644
  [[ ! -e "${DOCKER_HOST_CONTAINERD_CONFIG}" ]] \
    && docker_host_atomic_publish "${DOCKER_HOST_STATE_ROOT}/config.toml" "${DOCKER_HOST_CONTAINERD_CONFIG}" 0644
  docker_host_validate_storage_and_configuration
}

docker_host_install_policy() {
  if [[ -e "${DOCKER_HOST_POLICY}" ]]; then
    docker_host_policy_valid "${DOCKER_HOST_POLICY}" || docker_host_fail package "Unexpected policy-rc.d exists"
  else
    docker_host_policy_content > "${DOCKER_HOST_STATE_ROOT}/policy-rc.d"
    docker_host_atomic_publish "${DOCKER_HOST_STATE_ROOT}/policy-rc.d" "${DOCKER_HOST_POLICY}" 0755
  fi
  DOCKER_HOST_POLICY_REMOVE_ON_EXIT=1
}

docker_host_finish_package_transaction() {
  local packages="$1"
  docker_host_policy_valid "${DOCKER_HOST_POLICY}" || docker_host_fail package "Managed policy-rc.d changed during package work"
  /usr/bin/rm -f -- "${DOCKER_HOST_POLICY}"
  [[ ! -e "${DOCKER_HOST_POLICY}" ]] || docker_host_fail package "Managed policy-rc.d could not be removed"
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
  local package status exact_spec bad=${DOCKER_HOST_STATE_ROOT}/dpkg-nonclean.txt marker_packages=${DOCKER_HOST_STATE_ROOT}/marker-packages
  docker_host_marker_packages > "${marker_packages}"
  /usr/bin/env LC_ALL=C LANG=C /usr/bin/dpkg-query -W -f='${Package}|${db:Status-Abbrev}|${Version}\n' \
    | /usr/bin/awk -F'|' 'length($2)>=3{current=substr($2,2,1);error=substr($2,3,1);if((current!="n"&&current!="c"&&$2!="ii ")||error!=" ")print $1}' > "${bad}" \
    || docker_host_fail package "Could not inspect interrupted managed package state"
  while IFS= read -r package; do
    [[ -z "${package}" ]] || /usr/bin/grep -Eq "^${package//./\\.}\\|" "${marker_packages}" \
      || docker_host_fail package "Interrupted dpkg state includes a package outside the recorded Docker transaction: ${package}"
  done < "${bad}"
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
  local unit owner fragment dropins root path canonical official_path
  for unit in containerd.service docker.service docker.socket; do
    [[ "${unit}" == containerd.service ]] && owner=containerd.io || owner=docker-ce
    official_path=
    for root in "${DOCKER_HOST_UNIT_ROOTS[@]}"; do
      [[ ! -e "${root}/${unit}.d" ]] || docker_host_fail service "${unit} has an unsupported direct drop-in directory"
      path=${root}/${unit}
      [[ -e "${path}" ]] || continue
      canonical="$(/usr/bin/readlink -f -- "${path}")" || docker_host_fail service "Could not resolve direct unit file: ${path}"
      if [[ -z "${official_path}" ]]; then official_path=${canonical}; else [[ "${canonical}" == "${official_path}" ]] || docker_host_fail service "${unit} has multiple direct unit files"; fi
      [[ "$(docker_debian_command_owner "${canonical}")" == "${owner}" ]] || docker_host_fail service "${unit} direct file is not owned by ${owner}"
    done
    [[ -n "${official_path}" ]] || docker_host_fail service "Official ${unit} file is absent"
    fragment="$(/usr/bin/env LC_ALL=C LANG=C /usr/bin/systemctl show --property=FragmentPath --value "${unit}")"
    docker_host_secure_path "${fragment}" file || docker_host_fail service "Unsafe or absent official unit: ${unit}"
    [[ "$(docker_debian_command_owner "${fragment}")" == "${owner}" ]] || docker_host_fail service "${unit} is not owned by ${owner}"
    [[ "$(/usr/bin/readlink -f -- "${fragment}")" == "${official_path}" ]] || docker_host_fail service "${unit} manager fragment differs from the direct package file"
    dropins="$(/usr/bin/env LC_ALL=C LANG=C /usr/bin/systemctl show --property=DropInPaths --value "${unit}")"
    [[ -z "${dropins}" ]] || docker_host_fail service "${unit} has unsupported systemd drop-ins"
  done
}

docker_host_validate_components() {
  local package path owner effective expected_buildx expected_compose
  for package in docker-ce docker-ce-cli containerd.io; do
    case "${package}" in docker-ce) path=/usr/bin/dockerd ;; docker-ce-cli) path=/usr/bin/docker ;; containerd.io) path=/usr/bin/containerd ;; esac
    [[ -f "${path}" && ! -L "${path}" && -x "${path}" ]] || docker_host_fail validation "Missing official executable: ${path}"
    owner="$(docker_debian_command_owner "${path}")" || docker_host_fail validation "Could not identify package owner for ${path}"
    [[ "${owner}" == "${package}" ]] || docker_host_fail validation "${path} is not owned by ${package}"
  done
  for package in docker dockerd containerd ctr; do
    effective="$(PATH=/usr/local/bin:/usr/bin:/bin command -v "${package}" 2>/dev/null || true)"
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
    [[ ! -e "${path}" || "${path}" == "${expected_buildx}" || "${path}" == "${expected_compose}" ]] \
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

docker_host_activate_after_revalidation() {
  docker_host_validate_storage_and_configuration
  docker_host_ensure_membership_and_services
}

docker_host_client_environment() { local client="$1"; DOCKER_HOST_CLIENT_ENVIRONMENT=(/usr/bin/env -i "HOME=${client}" "DOCKER_CONFIG=${client}" PATH=/usr/bin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8); }
docker_host_create_runner_client() { local client; client="$(/usr/bin/mktemp -d "${DOCKER_HOST_STATE_CONTAINER}/client.XXXXXXXX")" || return 1; /usr/bin/chown "${DOCKER_HOST_RUNNER_USER}:${DOCKER_HOST_RUNNER_USER}" "${client}"; /usr/bin/chmod 0700 "${client}"; printf '%s\n' "${client}"; }

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
  /usr/bin/ctr plugins ls -d > "${containerd_info}" || docker_host_fail validation "Could not inspect effective containerd metadata root"
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
  for command in apt-cache apt-get awk basename chown chmod cmp curl dirname dpkg dpkg-query find getent gpasswd gpg grep id install kill mktemp mv ps readlink rm rmdir runuser sleep sort stat systemctl tr uname; do
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
    docker_host_publish_marker preparing
  fi
  phase="$(docker_host_marker_phase)"
  if [[ "${phase}" == complete ]]; then
    [[ ! -e "${DOCKER_HOST_POLICY}" ]] || docker_host_fail package "Managed policy-rc.d persisted after transaction completion"
    docker_host_validate_storage_and_configuration
    [[ ! -e "${DOCKER_HOST_DEFAULT_ENGINE_ROOT}" && ! -e "${DOCKER_HOST_DEFAULT_CONTAINERD_ROOT}" ]] \
      || docker_host_fail configuration "Completed managed state contains default Docker data paths"
    docker_host_validate_managed_packages || docker_host_fail inspection "Installed packages do not match the exact managed marker"
    docker_debian_validate_repository
    docker_host_inspect_official_units
    docker_host_validate
    printf 'Docker Engine, Buildx, and Compose provisioning completed successfully\n'
    return
  fi
  DOCKER_HOST_FRESH=1
  docker_host_services_inactive || docker_host_fail package "Docker services activated before managed installation completed"
  if [[ "${phase}" == preparing ]]; then
    [[ ! -e "${DOCKER_HOST_POLICY}" ]] || docker_host_fail package "Managed policy-rc.d exists outside a package transaction"
    docker_host_prepare_storage_and_configuration
  else
    docker_host_validate_storage_and_configuration
  fi
  if [[ "${phase}" == transaction ]]; then
    docker_host_services_inactive || docker_host_fail package "Docker services activated during an interrupted package transaction"
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
  [[ ! -e "${DOCKER_HOST_POLICY}" ]] || docker_host_fail package "Managed policy-rc.d persisted after package transaction"
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
