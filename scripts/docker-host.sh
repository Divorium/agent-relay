#!/usr/bin/env bash
set -euo pipefail
umask 0077

DOCKER_HOST_SCRIPT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
DOCKER_HOST_ADAPTER=${DOCKER_HOST_SCRIPT_ROOT}/docker-host-debian.sh
DOCKER_HOST_RUNNER_USER=github-runner
DOCKER_HOST_BUILD_USER=agent-relay-builder
DOCKER_HOST_SOCKET=/var/run/docker.sock
DOCKER_HOST_STATE_CONTAINER=
DOCKER_HOST_STATE_ROOT=
DOCKER_HOST_FRESH=0

docker_host_fail() {
  printf 'Docker provisioning failed in phase %s: %s\n' "$1" "$2" >&2
  exit 1
}

docker_host_cleanup() {
  if [[ -n "${DOCKER_HOST_STATE_CONTAINER}" ]]; then
    /usr/bin/rm -rf --one-file-system -- "${DOCKER_HOST_STATE_CONTAINER}" || true
  fi
}

docker_host_component_command() {
  case "$1" in
    docker-ce) printf '/usr/bin/dockerd|--version|\n' ;;
    docker-ce-cli) printf '/usr/bin/docker|--version|\n' ;;
    containerd.io) printf '/usr/bin/containerd|--version|\n' ;;
    docker-buildx-plugin) printf '/usr/bin/docker|buildx|version\n' ;;
    docker-compose-plugin) printf '/usr/bin/docker|compose|version\n' ;;
    *) return 1 ;;
  esac
}

docker_host_component_compatible() {
  local package="$1" specification path owner arg
  local -a arguments=()
  specification="$(docker_host_component_command "${package}")"
  IFS='|' read -r path arg1 arg2 <<< "${specification}"
  [[ -f "${path}" && ! -L "${path}" && -x "${path}" ]] || return 1
  for arg in "${arg1}" "${arg2}"; do
    [[ -z "${arg}" ]] || arguments+=("${arg}")
  done
  /usr/bin/env -i HOME=/root DOCKER_CONFIG="${DOCKER_HOST_STATE_ROOT}/client" PATH=/usr/bin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8 \
    "${path}" "${arguments[@]}" >/dev/null 2>&1 || return 1
  if [[ "${package}" == docker-buildx-plugin ]]; then
    path="$(docker_debian_plugin_path "${package}" docker-buildx)" || return 1
  elif [[ "${package}" == docker-compose-plugin ]]; then
    path="$(docker_debian_plugin_path "${package}" docker-compose)" || return 1
  fi
  owner="$(docker_debian_command_owner "${path}")" || return 2
  [[ "${owner}" == "${package}" ]] || return 2
}

docker_host_classify_records() {
  local records="$1" package status compatible installed=0 absent=0
  local -a missing=()
  while IFS='|' read -r package status compatible; do
    [[ "${package}" == conflict:* ]] || continue
    docker_debian_package_absent "${status}|" || return 10
  done < "${records}"
  for package in "${DOCKER_DEBIAN_CORE_PACKAGES[@]}"; do
    IFS='|' read -r _ status compatible < <(/usr/bin/awk -F'|' -v package="${package}" '$1==package{print;found++} END{exit found!=1}' "${records}") || return 11
    status="${status}|"
    if docker_debian_package_installed "${status}"; then
      ((installed += 1))
      (( compatible == 0 )) || return 12
    elif docker_debian_package_absent "${status}"; then
      (( compatible == 0 )) || return 12
      ((absent += 1))
    else
      return 13
    fi
  done
  if (( installed == 0 && absent == ${#DOCKER_DEBIAN_CORE_PACKAGES[@]} )); then
    for package in "${DOCKER_DEBIAN_PLUGIN_PACKAGES[@]}"; do
      IFS='|' read -r _ status compatible < <(/usr/bin/awk -F'|' -v package="${package}" '$1==package{print;found++} END{exit found!=1}' "${records}") || return 11
      docker_debian_package_absent "${status}|" || return 14
    done
    DOCKER_HOST_CLASSIFICATION=fresh
    DOCKER_HOST_MISSING=("${DOCKER_DEBIAN_PACKAGES[@]}")
    return
  fi
  (( installed == ${#DOCKER_DEBIAN_CORE_PACKAGES[@]} )) || return 15
  for package in "${DOCKER_DEBIAN_PLUGIN_PACKAGES[@]}"; do
    IFS='|' read -r _ status compatible < <(/usr/bin/awk -F'|' -v package="${package}" '$1==package{print;found++} END{exit found!=1}' "${records}") || return 11
    status="${status}|"
    if docker_debian_package_installed "${status}"; then
      (( compatible == 0 )) || return 12
    elif docker_debian_package_absent "${status}"; then
      (( compatible == 0 )) || return 12
      missing+=("${package}")
    else
      return 13
    fi
  done
  DOCKER_HOST_MISSING=("${missing[@]}")
  if (( ${#missing[@]} == 0 )); then
    DOCKER_HOST_CLASSIFICATION=complete-compatible
  else
    DOCKER_HOST_CLASSIFICATION=missing-plugin
  fi
}

docker_host_classify() {
  local package status compatible records=${DOCKER_HOST_STATE_ROOT}/classification.txt
  : > "${records}"
  for package in "${DOCKER_DEBIAN_CONFLICTS[@]}"; do
    status="$(docker_debian_package_status "${package}")"
    printf 'conflict:%s|%s|0\n' "${package}" "${status%%|*}" >> "${records}"
  done
  for package in "${DOCKER_DEBIAN_PACKAGES[@]}"; do
    status="$(docker_debian_package_status "${package}")"
    compatible=0
    if docker_debian_package_installed "${status}"; then
      set +e
      docker_host_component_compatible "${package}"
      compatible=$?
      set -e
    elif [[ "${package}" == docker-ce || "${package}" == docker-ce-cli || "${package}" == containerd.io ]]; then
      local specification command_path
      specification="$(docker_host_component_command "${package}")"
      command_path=${specification%%|*}
      [[ ! -e "${command_path}" ]] || compatible=3
    elif [[ "${package}" == docker-buildx-plugin || "${package}" == docker-compose-plugin ]]; then
      local subcommand=${package#docker-}
      subcommand=${subcommand%-plugin}
      /usr/bin/env -i HOME=/root DOCKER_CONFIG="${DOCKER_HOST_STATE_ROOT}/client" PATH=/usr/bin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8 \
        /usr/bin/docker "${subcommand}" version >/dev/null 2>&1 && compatible=3
    fi
    printf '%s|%s|%s\n' "${package}" "${status%%|*}" "${compatible}" >> "${records}"
  done
  set +e
  docker_host_classify_records "${records}"
  local result=$?
  set -e
  case "${result}" in
    0) ;;
    10) docker_host_fail inspection "A conflicting distribution Docker package is present" ;;
    12) docker_host_fail inspection "A Docker component has a broken executable or unknown command ownership" ;;
    13) docker_host_fail inspection "A Docker component is in a partial or broken package state" ;;
    14) docker_host_fail inspection "A plugin package exists without the official Docker core" ;;
    15) docker_host_fail inspection "Docker core packages are only partially installed" ;;
    *) docker_host_fail inspection "Docker package observations are incomplete or ambiguous" ;;
  esac
}

docker_host_secure_path() {
  local path="$1" kind="$2" metadata mode
  if [[ "${kind}" == directory ]]; then
    [[ -d "${path}" && ! -L "${path}" ]] || return 1
  else
    [[ -f "${path}" && ! -L "${path}" ]] || return 1
  fi
  [[ "$(/usr/bin/readlink -f -- "${path}")" == "${path}" ]] || return 1
  metadata="$(/usr/bin/stat -c '%u:%g|%a' -- "${path}")" || return 1
  mode=${metadata#*|}
  [[ "${metadata%%|*}" == 0:0 && "${mode}" =~ ^[0-7]{3,4}$ && $((8#${mode} & 8#022)) == 0 ]]
}

docker_host_secure_unit_file() {
  local path="$1" expected_owner="${2:-}" owner
  docker_host_secure_path "${path}" file || return 1
  if [[ -n "${expected_owner}" ]]; then
    owner="$(docker_debian_command_owner "${path}")" || return 1
    [[ "${owner}" == "${expected_owner}" ]]
  fi
}

docker_host_inspect_admin_dropins() {
  local unit="$1" directory entry listing status
  for directory in "/etc/systemd/system/${unit}.d" "/run/systemd/system/${unit}.d"; do
    [[ ! -e "${directory}" ]] || docker_host_secure_path "${directory}" directory \
      || docker_host_fail inspection "${unit} has an unsafe drop-in directory: ${directory}"
    [[ -d "${directory}" ]] || continue
    set +e
    listing="$(/usr/bin/find -P "${directory}" -mindepth 1 -maxdepth 1 -print)"
    status=$?
    set -e
    (( status == 0 )) || docker_host_fail inspection "Could not inspect ${unit} drop-ins"
    while IFS= read -r entry; do
      [[ -z "${entry}" ]] && continue
      [[ "${entry}" == *.conf ]] || docker_host_fail inspection "${unit} has an unsupported drop-in entry: ${entry}"
      docker_host_secure_unit_file "${entry}" || docker_host_fail inspection "${unit} has an unsafe drop-in: ${entry}"
    done <<< "${listing}"
  done
}

docker_host_inspect_unit() {
  local unit="$1" requirement="$2" expected_owner load fragment dropins path output
  output=${DOCKER_HOST_STATE_ROOT}/${unit}.properties
  if [[ "${unit}" == docker.service ]]; then expected_owner=docker-ce; else expected_owner=containerd.io; fi
  docker_host_inspect_admin_dropins "${unit}"
  /usr/bin/env LC_ALL=C LANG=C /usr/bin/systemctl show --property=LoadState --property=FragmentPath --property=DropInPaths "${unit}" > "${output}" \
    || docker_host_fail inspection "Could not inspect ${unit}"
  load="$(/usr/bin/awk -F= '$1=="LoadState"{count++;value=$2} END{if(count==1)print value}' "${output}")"
  fragment="$(/usr/bin/awk -F= '$1=="FragmentPath"{count++;value=substr($0,index($0,"=")+1)} END{if(count==1)print value}' "${output}")"
  dropins="$(/usr/bin/awk -F= '$1=="DropInPaths"{count++;value=substr($0,index($0,"=")+1)} END{if(count==1)print value}' "${output}")"
  if [[ "${load}" == not-found && "${requirement}" == allow-absent ]]; then
    for path in "/etc/systemd/system/${unit}" "/run/systemd/system/${unit}"; do
      [[ ! -e "${path}" ]] || docker_host_fail inspection "${unit} has an unowned unit file before package installation: ${path}"
    done
    return
  fi
  [[ "${load}" == loaded && -n "${fragment}" ]] || docker_host_fail inspection "${unit} is absent, masked, or ambiguous"
  docker_host_secure_unit_file "${fragment}" "${expected_owner}" || docker_host_fail inspection "${unit} does not use its secure official package unit file"
  [[ "${dropins}" != *'\\'* && "${dropins}" != *'"'* ]] || docker_host_fail inspection "${unit} has an ambiguous drop-in path"
  for path in ${dropins}; do
    case "${path}" in
      /etc/systemd/system/"${unit}".d/*.conf|/run/systemd/system/"${unit}".d/*.conf)
        docker_host_secure_unit_file "${path}" || docker_host_fail inspection "${unit} has an unsafe drop-in: ${path}"
        ;;
      /usr/lib/systemd/system/"${unit}".d/*.conf|/lib/systemd/system/"${unit}".d/*.conf)
        docker_host_secure_unit_file "${path}" "${expected_owner}" || docker_host_fail inspection "${unit} has an unsafe package drop-in: ${path}"
        ;;
      *) docker_host_fail inspection "${unit} has a drop-in outside supported paths: ${path}" ;;
    esac
  done
}

docker_host_inspect_services() {
  local requirement=allow-absent
  [[ "${DOCKER_HOST_CLASSIFICATION}" == fresh ]] || requirement=require-loaded
  docker_host_inspect_unit containerd.service "${requirement}"
  docker_host_inspect_unit docker.service "${requirement}"
}

docker_host_membership_actions() {
  (( $1 == 1 )) || printf 'add-runner\n'
  (( $2 == 0 )) || printf 'remove-builder\n'
}

docker_host_ensure_membership_and_services() {
  local runner_has=0 builder_has=0 action unit
  if /usr/bin/id -nG "${DOCKER_HOST_RUNNER_USER}" | /usr/bin/tr ' ' '\n' | /usr/bin/grep -Fxq docker; then runner_has=1; fi
  if /usr/bin/id -nG "${DOCKER_HOST_BUILD_USER}" | /usr/bin/tr ' ' '\n' | /usr/bin/grep -Fxq docker; then builder_has=1; fi
  /usr/bin/getent group docker >/dev/null || /usr/sbin/groupadd docker
  while IFS= read -r action; do
    case "${action}" in
      add-runner) /usr/sbin/usermod -aG docker "${DOCKER_HOST_RUNNER_USER}" ;;
      remove-builder) /usr/bin/gpasswd --delete "${DOCKER_HOST_BUILD_USER}" docker >/dev/null ;;
    esac
  done < <(docker_host_membership_actions "${runner_has}" "${builder_has}")
  /usr/bin/id -nG "${DOCKER_HOST_RUNNER_USER}" | /usr/bin/tr ' ' '\n' | /usr/bin/grep -Fxq docker \
    || docker_host_fail group "github-runner is not a member of docker"
  ! /usr/bin/id -nG "${DOCKER_HOST_BUILD_USER}" | /usr/bin/tr ' ' '\n' | /usr/bin/grep -Fxq docker \
    || docker_host_fail group "agent-relay-builder must not belong to docker"
  for unit in containerd.service docker.service; do
    /usr/bin/env LC_ALL=C LANG=C /usr/bin/systemctl is-enabled --quiet "${unit}" \
      || /usr/bin/env LC_ALL=C LANG=C /usr/bin/systemctl enable "${unit}" \
      || docker_host_fail service "Could not enable ${unit}"
    /usr/bin/env LC_ALL=C LANG=C /usr/bin/systemctl is-active --quiet "${unit}" \
      || /usr/bin/env LC_ALL=C LANG=C /usr/bin/systemctl start "${unit}" \
      || docker_host_fail service "Could not start ${unit}"
  done
}

docker_host_client_environment() {
  local client="$1"
  DOCKER_HOST_CLIENT_ENVIRONMENT=(/usr/bin/env -i "HOME=${client}" "DOCKER_CONFIG=${client}" PATH=/usr/bin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8)
}

docker_host_create_runner_client() {
  local client
  client="$(/usr/bin/mktemp -d "${DOCKER_HOST_STATE_CONTAINER}/client.XXXXXXXX")" \
    || docker_host_fail validation "Could not create Docker client state"
  /usr/bin/chown "${DOCKER_HOST_RUNNER_USER}:${DOCKER_HOST_RUNNER_USER}" "${client}"
  /usr/bin/chmod 0700 "${client}"
  printf '%s\n' "${client}"
}

docker_host_validate() {
  [[ -S "${DOCKER_HOST_SOCKET}" ]] || docker_host_fail validation "Docker Unix socket is unavailable: ${DOCKER_HOST_SOCKET}"
  local client
  client="$(docker_host_create_runner_client)"
  docker_host_client_environment "${client}"
  /usr/sbin/runuser -u "${DOCKER_HOST_RUNNER_USER}" -- "${DOCKER_HOST_CLIENT_ENVIRONMENT[@]}" /usr/bin/docker --host unix:///var/run/docker.sock version >/dev/null \
    || docker_host_fail validation "github-runner cannot reach the local Docker daemon"
  /usr/sbin/runuser -u "${DOCKER_HOST_RUNNER_USER}" -- "${DOCKER_HOST_CLIENT_ENVIRONMENT[@]}" /usr/bin/docker --host unix:///var/run/docker.sock info >/dev/null \
    || docker_host_fail validation "github-runner cannot inspect the local Docker daemon"
  /usr/sbin/runuser -u "${DOCKER_HOST_RUNNER_USER}" -- "${DOCKER_HOST_CLIENT_ENVIRONMENT[@]}" /usr/bin/docker --host unix:///var/run/docker.sock buildx version >/dev/null \
    || docker_host_fail validation "Docker Buildx validation failed"
  /usr/sbin/runuser -u "${DOCKER_HOST_RUNNER_USER}" -- "${DOCKER_HOST_CLIENT_ENVIRONMENT[@]}" /usr/bin/docker --host unix:///var/run/docker.sock compose version >/dev/null \
    || docker_host_fail validation "Docker Compose validation failed"
  if (( DOCKER_HOST_FRESH == 1 || ${DOCKER_HOST_ACCEPTANCE:-0} == 1 )); then
    /usr/sbin/runuser -u "${DOCKER_HOST_RUNNER_USER}" -- "${DOCKER_HOST_CLIENT_ENVIRONMENT[@]}" /usr/bin/docker --host unix:///var/run/docker.sock run --rm hello-world
  fi
  /usr/bin/rm -rf --one-file-system -- "${client}"
}

docker_host_prepare_state() {
  DOCKER_HOST_STATE_CONTAINER="$(/usr/bin/mktemp -d)" || docker_host_fail preflight "Could not create provisioner state"
  /usr/bin/chown root:root "${DOCKER_HOST_STATE_CONTAINER}"
  /usr/bin/chmod 0711 "${DOCKER_HOST_STATE_CONTAINER}"
  DOCKER_HOST_STATE_ROOT=${DOCKER_HOST_STATE_CONTAINER}/private
  /usr/bin/install -d -o root -g root -m 0700 "${DOCKER_HOST_STATE_ROOT}" "${DOCKER_HOST_STATE_ROOT}/client"
}

docker_host_preflight() {
  [[ "$(/usr/bin/id -u)" == 0 ]] || docker_host_fail preflight "docker-host.sh must run as root through update.sh"
  [[ "$(/usr/bin/ps -p 1 -o comm= | /usr/bin/tr -d '[:space:]')" == systemd ]] || docker_host_fail preflight "systemd must run as PID 1"
  [[ -f "${DOCKER_HOST_ADAPTER}" && ! -L "${DOCKER_HOST_ADAPTER}" ]] || docker_host_fail preflight "Missing Debian Docker adapter"
  local command
  for command in apt-cache apt-get awk chown chmod cmp curl dirname dpkg dpkg-query find getent gpasswd gpg grep id install kill mktemp mv ps readlink rm runuser sleep sort stat systemctl tr uname; do
    [[ -x /usr/bin/${command} || -x /usr/sbin/${command} ]] || docker_host_fail preflight "Missing required host command: ${command}"
  done
  docker_debian_require_host
  docker_host_prepare_state
  trap docker_host_cleanup EXIT
}

docker_host_main() {
  (( $# == 0 )) || docker_host_fail preflight "docker-host.sh does not accept arguments"
  # shellcheck source=scripts/docker-host-debian.sh
  source "${DOCKER_HOST_ADAPTER}"
  docker_host_preflight
  docker_debian_assert_clean_dpkg
  docker_host_classify
  [[ "${DOCKER_HOST_CLASSIFICATION}" == fresh ]] && DOCKER_HOST_FRESH=1
  docker_host_inspect_services
  docker_debian_install_components "${DOCKER_HOST_MISSING[@]}"
  docker_host_classify
  [[ "${DOCKER_HOST_CLASSIFICATION}" == complete-compatible ]] || docker_host_fail inspection "Docker installation is incomplete after package work"
  docker_host_inspect_services
  docker_host_ensure_membership_and_services
  docker_host_validate
  printf 'Docker Engine, Buildx, and Compose provisioning completed successfully\n'
}

if [[ "${DOCKER_HOST_LIBRARY_ONLY:-0}" != 1 ]]; then
  docker_host_main "$@"
fi
