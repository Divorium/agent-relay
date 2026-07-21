#!/usr/bin/env bash

# Debian package adapter for scripts/docker-host.sh. This file is sourced by the
# host orchestrator and intentionally has no standalone entrypoint.

DOCKER_DEBIAN_PACKAGES=(docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin)
DOCKER_DEBIAN_CORE_PACKAGES=(docker-ce docker-ce-cli containerd.io)
DOCKER_DEBIAN_PLUGIN_PACKAGES=(docker-buildx-plugin docker-compose-plugin)
DOCKER_DEBIAN_CONFLICTS=(docker.io docker-compose docker-doc podman-docker containerd runc)
DOCKER_DEBIAN_KEY_FINGERPRINT=9DC858229FC7DD38854AE2D88D81803C0EBFCD88
DOCKER_DEBIAN_MANAGED_KEY=/etc/apt/keyrings/docker.asc
DOCKER_DEBIAN_MANAGED_SOURCE=/etc/apt/sources.list.d/agent-relay-docker.sources
DOCKER_DEBIAN_MANAGED_KEY_STAGE_GLOB=/etc/apt/keyrings/.agent-relay-docker.asc.tmp.
DOCKER_DEBIAN_MANAGED_SOURCE_STAGE_GLOB=/etc/apt/sources.list.d/.agent-relay-docker.sources.tmp.
DOCKER_DEBIAN_RESIDUAL_PURGE_TIMEOUT_SECONDS=120
DOCKER_DEBIAN_APT_DIRECTORY=/etc/apt
DOCKER_DEBIAN_DPKG_CONFFILE_OPTIONS=(--force-confdef --force-confold)
DOCKER_DEBIAN_APT_CONFFILE_OPTIONS=(
  -o Dpkg::Options::=--force-confdef
  -o Dpkg::Options::=--force-confold
)

docker_debian_require_host() {
  [[ "$(/usr/bin/uname -m)" == x86_64 ]] \
    || docker_host_fail preflight "The Docker package adapter supports x86-64 only"
  [[ -r /etc/os-release ]] || docker_host_fail preflight "Missing /etc/os-release"
  local distribution codename
  distribution="$(. /etc/os-release; printf '%s' "${ID:-}")"
  codename="$(. /etc/os-release; printf '%s' "${VERSION_CODENAME:-}")"
  [[ "${distribution}" == debian && -n "${codename}" ]] \
    || docker_host_fail preflight "Docker provisioning requires Debian with VERSION_CODENAME"
  DOCKER_DEBIAN_CODENAME=${codename}
}

docker_debian_package_status() {
  /usr/bin/env LC_ALL=C LANG=C /usr/bin/dpkg-query -W -f='${db:Status-Abbrev}|${Version}\n' "$1" 2>/dev/null \
    || printf 'not-installed|\n'
}

docker_debian_package_installed() {
  [[ "$1" == 'ii '* ]]
}

docker_debian_package_absent() {
  local abbreviation=${1%%|*} current
  [[ "$1" == not-installed* ]] && return 0
  current=${abbreviation:1:1}
  [[ "${current}" == n || "${current}" == c ]]
}

docker_debian_conffile_digest() {
  local package="$1" conffile="$2" admindir="${3:-/var/lib/dpkg}"
  /usr/bin/env LC_ALL=C LANG=C /usr/bin/dpkg-query --admindir="${admindir}" -W -f='${Conffiles}\n' "${package}" \
    | /usr/bin/awk -v conffile="${conffile}" '
        $1 == conffile && $2 ~ /^[0-9a-f]{32}$/ { count += 1; digest = $2 }
        END { if (count == 1) print digest; else exit 1 }
      '
}

docker_debian_remove_discarded_conffile() {
  local package="$1" conffile="$2" host_path="$3" admindir="${4:-/var/lib/dpkg}"
  local artifact="${host_path}.dpkg-dist" expected_digest actual_digest
  docker_host_path_absent "${artifact}" && return 0
  docker_host_exact_metadata "${artifact}" file "${DOCKER_HOST_OWNER_UID}:${DOCKER_HOST_OWNER_GID}|644" \
    || docker_host_fail configuration "Discarded package conffile is unsafe: ${artifact}"
  expected_digest="$(docker_debian_conffile_digest "${package}" "${conffile}" "${admindir}")" \
    || docker_host_fail configuration "Could not verify discarded package conffile ownership: ${artifact}"
  actual_digest="$(/usr/bin/md5sum -- "${artifact}")" \
    || docker_host_fail configuration "Could not digest discarded package conffile: ${artifact}"
  actual_digest=${actual_digest%% *}
  [[ "${actual_digest}" == "${expected_digest}" ]] \
    || docker_host_fail configuration "Discarded package conffile differs from the package record: ${artifact}"
  /usr/bin/rm -f -- "${artifact}" \
    || docker_host_fail configuration "Could not remove discarded package conffile: ${artifact}"
  docker_host_path_absent "${artifact}" \
    || docker_host_fail configuration "Discarded package conffile remained after removal: ${artifact}"
}

docker_debian_reconcile_conffile_artifacts() {
  local admindir="${1:-/var/lib/dpkg}"
  docker_debian_remove_discarded_conffile containerd.io /etc/containerd/config.toml \
    "${DOCKER_HOST_CONTAINERD_CONFIG}" "${admindir}"
}

docker_debian_related_package_records() {
  local package_file="$1"
  /usr/bin/awk -F'|' '
    function related(name) {
      return name ~ /(^|[-+.])(docker|moby|containerd|runc|rootlesskit|buildx)([-+.]|$)/ \
        || name ~ /(^|[-+.])compose-switch([-+.]|$)/
    }
    length($2) >= 3 {
      current=substr($2,2,1)
      if (current!="n" && related($1)) print $1 "|" $2 "|" $3
    }
  ' "${package_file}"
}

docker_debian_related_package_inventory() {
  local packages=${DOCKER_HOST_STATE_ROOT}/related-package-database.txt
  /usr/bin/env LC_ALL=C LANG=C /usr/bin/dpkg-query -W -f='${Package}|${db:Status-Abbrev}|${Version}\n' \
    > "${packages}" 2> "${DOCKER_HOST_STATE_ROOT}/related-package-database.err" \
    || docker_host_fail inspection "Could not inventory Docker-related package state"
  docker_debian_related_package_records "${packages}"
}

docker_debian_residual_package_records() {
  /usr/bin/awk -F'|' '$2 == "rc " {print}' "$1"
}

docker_debian_active_package_records() {
  /usr/bin/awk -F'|' '$2 != "rc " {print}' "$1"
}

docker_debian_run_residual_purge() {
  /usr/bin/timeout --signal=TERM --kill-after=10s "${DOCKER_DEBIAN_RESIDUAL_PURGE_TIMEOUT_SECONDS}s" \
    /usr/bin/dpkg --purge -- "$@"
}

docker_debian_purge_residual_packages() {
  local records="$1" package status version
  local -a packages=()
  while IFS='|' read -r package status version; do
    [[ -n "${package}" ]] || continue
    [[ "${package}" =~ ^[a-z0-9][a-z0-9.+-]*$ && "${status}" == 'rc ' && -n "${version}" ]] \
      || docker_host_fail package "Residual package cleanup input is malformed"
    [[ "$(docker_debian_package_status "${package}")" == "${status}|${version}" ]] \
      || docker_host_fail package "Residual package state changed before cleanup: ${package}"
    packages+=("${package}")
  done < "${records}"
  (( ${#packages[@]} > 0 )) || docker_host_fail package "Residual package cleanup has no exact targets"
  DEBIAN_FRONTEND=noninteractive LC_ALL=C LANG=C docker_debian_run_residual_purge "${packages[@]}" \
    || docker_host_fail package "Could not purge exact residual Docker package configuration"
  for package in "${packages[@]}"; do
    [[ "$(docker_debian_package_status "${package}")" == not-installed\|* ]] \
      || docker_host_fail package "Residual package remains after cleanup: ${package}"
  done
}

docker_debian_command_owner() {
  local owner status
  set +e
  owner="$(/usr/bin/env LC_ALL=C LANG=C /usr/bin/dpkg-query -S "$1" 2>/dev/null)"
  status=$?
  set -e
  (( status == 0 )) || return 1
  [[ "${owner}" != *$'\n'* ]] || return 1
  printf '%s\n' "${owner%%:*}"
}

docker_debian_plugin_path() {
  local listing status
  set +e
  listing="$(/usr/bin/env LC_ALL=C LANG=C /usr/bin/dpkg-query -L "$1" 2>/dev/null)"
  status=$?
  set -e
  (( status == 0 )) || return 1
  /usr/bin/awk -v suffix="/$2" 'substr($0, length($0)-length(suffix)+1)==suffix {print; found++} END{exit found != 1}' <<< "${listing}"
}

docker_debian_dpkg_state_clean() {
  local audit_file="$1" package_file="$2"
  [[ ! -s "${audit_file}" ]] || return 1
  /usr/bin/awk -F'|' '
    length($2) >= 3 {
      current=substr($2,2,1); error=substr($2,3,1)
      if ((current != "n" && current != "c" && $2 != "ii ") || error != " ") bad=1
    }
    END {exit bad}
  ' "${package_file}"
}

docker_debian_recovery_dpkg_state_allowed() {
  local package_file="$1" marker_packages="$2"
  /usr/bin/awk -F'|' '
    FILENAME==ARGV[1] {owned[$1]=1; next}
    length($2) >= 3 {
      current=substr($2,2,1); error=substr($2,3,1)
      clean=((current=="n"||current=="c"||$2=="ii ")&&error==" ")
      trigger=($2=="iW "||$2=="it ")
      if(!clean && !trigger && !($1 in owned)) bad=1
    }
    END {exit bad}
  ' "${marker_packages}" "${package_file}"
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
  docker_debian_reconcile_conffile_artifacts
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
  docker_debian_reconcile_conffile_artifacts
}

docker_debian_parse_list_source() {
  local path="$1"
  /usr/bin/awk -v suite="${DOCKER_DEBIAN_CODENAME}" '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ {next}
    {
      line=$0; sub(/[[:space:]]+#.*/, "", line)
      if (line !~ /download\.docker\.com\/linux\/debian/) next
      ok=1; key=""; arch=""; sub(/^[[:space:]]*/, "", line)
      if (line !~ /^deb[[:space:]]+\[/) ok=0
      if (ok) {sub(/^deb[[:space:]]+\[/, "", line); closing=index(line,"]"); if (!closing) ok=0}
      if (ok) {
        options=substr(line,1,closing-1); line=substr(line,closing+1)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
        count=split(options,option,/[[:space:]]+/)
        for (i=1;i<=count;i++) {
          if (option[i]=="arch=amd64" && arch=="") arch="amd64"
          else if (option[i] ~ /^signed-by=\/etc\/apt\/keyrings\/docker\.(asc|gpg)$/ && key=="") key=substr(option[i],11)
          else ok=0
        }
        count=split(line,field,/[[:space:]]+/)
        if (count!=3 || field[1]!="https://download.docker.com/linux/debian" || field[2]!=suite || field[3]!="stable" || arch!="amd64" || key=="") ok=0
      }
      print (ok ? "compatible" : "conflicting") "|" key
    }
  ' "${path}"
}

docker_debian_parse_deb822_source() {
  local path="$1"
  /usr/bin/awk -v suite="${DOCKER_DEBIAN_CODENAME}" '
    function reset(){types="";uris="";suites="";components="";arch="";signed="";enabled="";unsafe=0;duplicate=0;delete seen;current=""}
    function assign(key,value,append,prior){
      if (!append && seen[key]++) duplicate=1
      if (key=="types") {prior=types;types=(append&&prior!=""?prior" "value:value)}
      else if(key=="uris") {prior=uris;uris=(append&&prior!=""?prior" "value:value)}
      else if(key=="suites") {prior=suites;suites=(append&&prior!=""?prior" "value:value)}
      else if(key=="components") {prior=components;components=(append&&prior!=""?prior" "value:value)}
      else if(key=="architectures") {prior=arch;arch=(append&&prior!=""?prior" "value:value)}
      else if(key=="signed-by") {prior=signed;signed=(append&&prior!=""?prior" "value:value)}
      else if(key=="enabled") enabled=value
      else if(key ~ /^(trusted|allow-insecure|allow-weak|allow-downgrade-to-insecure)$/) {v=tolower(value);gsub(/^[[:space:]]+|[[:space:]]+$/, "", v);if(v!=""&&v!~ /^(no|false|0|off)$/) unsafe=1}
    }
    function emit(ok,enabled_value){
      if (uris !~ /(^|[[:space:]])https:\/\/download\.docker\.com\/linux\/debian($|[[:space:]])/) {reset();return}
      enabled_value=tolower(enabled);gsub(/^[[:space:]]+|[[:space:]]+$/, "", enabled_value)
      ok=(types=="deb" && uris=="https://download.docker.com/linux/debian" && suites==suite && components=="stable" && arch=="amd64" && signed ~ /^\/etc\/apt\/keyrings\/docker\.(asc|gpg)$/ && !duplicate && !unsafe && (enabled_value=="" || enabled_value ~ /^(yes|true|1|on)$/))
      print (ok?"compatible":"conflicting") "|" signed; reset()
    }
    BEGIN{reset()} /^[[:space:]]*#/{next} /^[[:space:]]*$/{emit();next}
    /^[[:space:]]+/{value=$0;gsub(/^[[:space:]]+|[[:space:]]+$/, "", value);if(current!=""&&value!="")assign(current,value,1);next}
    /^[^[:space:]][^:]*:/{key=tolower(substr($0,1,index($0,":")-1));value=substr($0,index($0,":")+1);gsub(/^[[:space:]]+|[[:space:]]+$/, "", value);current=key;assign(key,value,0)}
    END{emit()}
  ' "${path}"
}

docker_debian_secure_path() {
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

docker_debian_mode_has_other_bit() {
  local path="$1" bit="$2" mode
  mode="$(/usr/bin/stat -c '%a' -- "${path}")" || return 1
  [[ "${mode}" =~ ^[0-7]{3,4}$ ]] || return 1
  (( (8#${mode} & bit) == bit ))
}

docker_debian_readable_file_secure() {
  local path="$1" directory
  docker_debian_secure_path "${path}" file || return 1
  docker_debian_mode_has_other_bit "${path}" 4 || return 1
  directory="$(/usr/bin/dirname -- "${path}")"
  while [[ "${directory}" != / ]]; do
    docker_debian_secure_path "${directory}" directory || return 1
    docker_debian_mode_has_other_bit "${directory}" 1 || return 1
    directory="$(/usr/bin/dirname -- "${directory}")"
  done
}

docker_debian_apt_key_secure() {
  local key="$1"
  [[ "${key}" == /etc/apt/keyrings/docker.asc || "${key}" == /etc/apt/keyrings/docker.gpg ]] || return 1
  docker_debian_readable_file_secure "${key}"
}

docker_debian_repository_records_acceptable() {
  local records="$1" kind key path count=0
  DOCKER_DEBIAN_REPOSITORY_KEY_PATH=
  DOCKER_DEBIAN_REPOSITORY_SOURCE_PATH=
  while IFS='|' read -r kind key path; do
    [[ -n "${kind}" ]] || continue
    ((count += 1))
    [[ "${kind}" == compatible ]] || return 1
    DOCKER_DEBIAN_REPOSITORY_KEY_PATH=${key}
    DOCKER_DEBIAN_REPOSITORY_SOURCE_PATH=${path}
  done < "${records}"
  (( count <= 1 )) || return 1
  DOCKER_DEBIAN_REPOSITORY_DEFINITION_COUNT=${count}
}

docker_debian_inventory_repository_definitions() {
  local records=${DOCKER_HOST_STATE_ROOT}/repository-definitions.txt path output listing status record
  local -a sources=()
  : > "${records}"
  for path in /etc /etc/apt /etc/apt/sources.list.d; do
    docker_host_path_absent "${path}" || docker_debian_secure_path "${path}" directory \
      || docker_host_fail repository "Unsafe apt source directory: ${path}"
  done
  docker_host_path_absent /etc/apt/sources.list || sources+=(/etc/apt/sources.list)
  if [[ -d /etc/apt/sources.list.d ]]; then
    listing=${DOCKER_HOST_STATE_ROOT}/apt-source-paths.bin
    set +e
    /usr/bin/find -P /etc/apt/sources.list.d -maxdepth 1 \( -name '*.list' -o -name '*.sources' \) -print0 > "${listing}"
    status=$?
    set -e
    (( status == 0 )) || docker_host_fail repository "Could not completely inspect apt source definitions"
    while IFS= read -r -d '' path; do sources+=("${path}"); done < "${listing}"
  fi
  for path in "${sources[@]}"; do
    docker_debian_readable_file_secure "${path}" || docker_host_fail repository "Unsafe or unreadable apt source file: ${path}"
    if [[ "${path}" == *.sources ]]; then
      output="$(docker_debian_parse_deb822_source "${path}")"
    else
      output="$(docker_debian_parse_list_source "${path}")"
    fi
    while IFS= read -r record; do
      [[ -z "${record}" ]] || printf '%s|%s\n' "${record}" "${path}" >> "${records}"
    done <<< "${output}"
  done
}

docker_debian_inspect_repository_definitions() {
  docker_debian_inventory_repository_definitions
  docker_debian_repository_records_acceptable "${DOCKER_HOST_STATE_ROOT}/repository-definitions.txt" \
    || docker_host_fail repository "Docker apt source definitions are conflicting, duplicate, ambiguous, disabled, or insecure"
}

docker_debian_inventory_cleanup_repository_files() {
  local records=${DOCKER_HOST_STATE_ROOT}/repository-definitions.txt path listing=${DOCKER_HOST_STATE_ROOT}/cleanup-repository-stages.bin
  docker_debian_inventory_cleanup_apt_roots
  docker_debian_inventory_repository_definitions
  /usr/bin/awk -F'|' 'NF >= 3 && !seen[$3]++ {print $3}' "${records}" \
    > "${DOCKER_HOST_STATE_ROOT}/cleanup-repository-files"
  while IFS= read -r path; do
    [[ "${path}" != *.sources ]] || docker_debian_sources_docker_stanzas_cleanup_safe "${path}" || return 1
  done < "${DOCKER_HOST_STATE_ROOT}/cleanup-repository-files"
  : > "${listing}"
  path=${DOCKER_DEBIAN_APT_DIRECTORY}
  if ! docker_host_path_absent "${path}"; then
    docker_debian_secure_path "${path}" directory || return 1
    /usr/bin/find -P "${path}" -mindepth 1 -maxdepth 1 \
      -name '.agent-relay-docker-cleanup.tmp.*' -print0 >> "${listing}" || return 1
  fi
  for path in "${DOCKER_DEBIAN_APT_DIRECTORY}/keyrings" "${DOCKER_DEBIAN_APT_DIRECTORY}/sources.list.d"; do
    docker_host_path_absent "${path}" && continue
    docker_debian_secure_path "${path}" directory || return 1
    /usr/bin/find -P "${path}" -mindepth 1 -maxdepth 1 \
      \( -name '.agent-relay-docker.asc.tmp.*' -o -name '.agent-relay-docker.sources.tmp.*' \
      -o -name '.agent-relay-docker-cleanup.tmp.*' \) -print0 >> "${listing}" || return 1
  done
  while IFS= read -r -d '' path; do docker_debian_secure_path "${path}" file || return 1; done < "${listing}"
}

docker_debian_inventory_cleanup_apt_roots() {
  local root roots=${DOCKER_HOST_STATE_ROOT}/cleanup-apt-roots.bin
  : > "${roots}"
  for root in "${DOCKER_DEBIAN_APT_DIRECTORY}" \
    "${DOCKER_DEBIAN_APT_DIRECTORY}/keyrings" "${DOCKER_DEBIAN_APT_DIRECTORY}/sources.list.d"; do
    docker_host_path_absent "${root}" && continue
    [[ -d "${root}" && ! -L "${root}" ]] || return 1
    docker_host_assert_cleanup_tree_unmounted "${root}"
    docker_debian_secure_path "${root}" directory || return 1
    printf '%s\0' "${root}" >> "${roots}"
  done
}

docker_debian_assert_cleanup_apt_roots_unmounted() {
  docker_host_assert_recorded_cleanup_roots_unmounted "${DOCKER_HOST_STATE_ROOT}/cleanup-apt-roots.bin"
}

docker_debian_sources_docker_stanzas_cleanup_safe() {
  /usr/bin/awk '
    BEGIN {RS=""}
    {
      lowered=tolower($0)
      if (!(lowered ~ /(^|\n)[[:space:]]*uris[[:space:]]*:/ && lowered ~ /download\.docker\.com\/linux\/debian/)) next
      remainder=lowered; urls=0
      while (match(remainder, /https?:\/\/[^[:space:]]+/)) {urls++; remainder=substr(remainder, RSTART+RLENGTH)}
      if (urls != 1) bad=1
    }
    END {exit bad}
  ' "$1"
}

docker_debian_list_source_is_dedicated_docker() {
  /usr/bin/awk '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ {next}
    /download\.docker\.com\/linux\/debian/ {docker++; next}
    {other++}
    END {exit !(docker > 0 && other == 0)}
  ' "$1"
}

docker_debian_filter_list_source() {
  /usr/bin/awk '/^[[:space:]]*#/ || $0 !~ /download\.docker\.com\/linux\/debian/ {print}' "$1"
}

docker_debian_sources_file_is_dedicated_docker() {
  /usr/bin/awk '
    BEGIN {RS=""; docker=0; other=0}
    {
      lowered=tolower($0)
      if (lowered ~ /(^|\n)[[:space:]]*uris[[:space:]]*:/ && lowered ~ /download\.docker\.com\/linux\/debian/) docker++
      else if ($0 !~ /^[[:space:]#]*$/) other++
    }
    END {exit !(docker > 0 && other == 0)}
  ' "$1"
}

docker_debian_filter_sources_file() {
  /usr/bin/awk '
    BEGIN {RS=""; ORS=""; first=1}
    {
      lowered=tolower($0)
      if (lowered ~ /(^|\n)[[:space:]]*uris[[:space:]]*:/ && lowered ~ /download\.docker\.com\/linux\/debian/) next
      if (!first) printf "\n\n"
      printf "%s", $0
      first=0
    }
    END {if (!first) printf "\n"}
  ' "$1"
}

docker_debian_rewrite_shared_source() {
  local source="$1" filtered=${DOCKER_HOST_STATE_ROOT}/filtered-source mode stage directory
  directory="$(/usr/bin/dirname -- "${source}")"
  mode="$(/usr/bin/stat -c '%a' -- "${source}")" || return 1
  [[ "${mode}" =~ ^[0-7]{3,4}$ ]] || return 1
  if [[ "${source}" == *.sources ]]; then
    docker_debian_filter_sources_file "${source}" > "${filtered}" || return 1
  else
    docker_debian_filter_list_source "${source}" > "${filtered}" || return 1
  fi
  stage="$(/usr/bin/mktemp "${directory}/.agent-relay-docker-cleanup.tmp.XXXXXXXX")" || return 1
  /usr/bin/install -o root -g root -m "0${mode}" "${filtered}" "${stage}" || return 1
  /usr/bin/mv -T -- "${stage}" "${source}"
}

docker_debian_remove_cleanup_repository_files() {
  local source
  while IFS= read -r source; do
    [[ -n "${source}" ]] || continue
    docker_debian_readable_file_secure "${source}" || docker_host_fail repository "Docker cleanup source became unsafe: ${source}"
    case "${source}" in
      *.sources)
        docker_debian_assert_cleanup_apt_roots_unmounted
        if docker_debian_sources_file_is_dedicated_docker "${source}"; then
          /usr/bin/rm -f -- "${source}" || docker_host_fail repository "Could not remove dedicated Docker apt source: ${source}"
        else
          docker_debian_rewrite_shared_source "${source}" \
            || docker_host_fail repository "Could not preserve shared apt source while removing Docker: ${source}"
        fi ;;
      /etc/apt/sources.list|*.list)
        docker_debian_assert_cleanup_apt_roots_unmounted
        if docker_debian_list_source_is_dedicated_docker "${source}"; then
          /usr/bin/rm -f -- "${source}" || docker_host_fail repository "Could not remove dedicated Docker apt source: ${source}"
        else
          docker_debian_rewrite_shared_source "${source}" \
            || docker_host_fail repository "Could not preserve shared apt source while removing Docker: ${source}"
        fi ;;
      *) docker_host_fail repository "Docker cleanup selected an unsupported apt source path: ${source}" ;;
    esac
  done < "${DOCKER_HOST_STATE_ROOT}/cleanup-repository-files"
  while IFS= read -r -d '' source; do
    docker_debian_assert_cleanup_apt_roots_unmounted
    /usr/bin/rm -f -- "${source}" || docker_host_fail repository "Could not remove Docker repository cleanup stage: ${source}"
  done \
    < "${DOCKER_HOST_STATE_ROOT}/cleanup-repository-stages.bin"
}

docker_debian_repository_content() {
  printf 'Types: deb\nURIs: https://download.docker.com/linux/debian\nSuites: %s\nComponents: stable\nArchitectures: amd64\nSigned-By: /etc/apt/keyrings/docker.asc\n' "${DOCKER_DEBIAN_CODENAME}"
}

docker_debian_primary_fingerprint_from_colons() {
  local records="$1"
  /usr/bin/awk -F: '
    BEGIN {pubs=0; primary=""; waiting=""; bad=0}
    $1=="pub" {if(pubs!=0 || waiting!="") bad=1; pubs++; waiting="pub"; next}
    $1=="sub" {if(pubs!=1 || waiting!="" || primary=="") bad=1; waiting="sub"; next}
    $1=="fpr" {
      value=toupper($10)
      if(length(value)!=40 || value !~ /^[0-9A-F]+$/) bad=1
      if(waiting=="pub") {if(primary!="") bad=1; primary=value; waiting=""; next}
      if(waiting=="sub") {waiting=""; next}
      bad=1; next
    }
    {if(waiting!="") bad=1}
    END {if(!bad && pubs==1 && primary!="" && waiting=="") print primary; else exit 1}
  ' "${records}"
}

docker_debian_key_fingerprint() {
  local key="$1" home=${DOCKER_HOST_STATE_ROOT}/gnupg records=${DOCKER_HOST_STATE_ROOT}/key-colons.txt fingerprint
  /usr/bin/install -d -o root -g root -m 0700 "${home}"
  /usr/bin/env -i HOME="${home}" GNUPGHOME="${home}" PATH=/usr/bin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8 \
    /usr/bin/gpg --batch --no-options --no-default-keyring --show-keys --with-colons -- "${key}" \
    > "${records}" 2> "${DOCKER_HOST_STATE_ROOT}/key-gpg.err" || return 1
  fingerprint="$(docker_debian_primary_fingerprint_from_colons "${records}")" || return 1
  printf '%s\n' "${fingerprint}"
}

docker_debian_key_bytes_valid() {
  local key="$1" fingerprint
  fingerprint="$(docker_debian_key_fingerprint "${key}")" || return 1
  [[ "${fingerprint}" == "${DOCKER_DEBIAN_KEY_FINGERPRINT}" ]]
}

docker_debian_published_key_valid() {
  local key="$1"
  docker_debian_apt_key_secure "${key}" \
    && docker_host_exact_metadata "${key}" file "${DOCKER_HOST_OWNER_UID}:${DOCKER_HOST_OWNER_GID}|644" \
    && docker_debian_key_bytes_valid "${key}"
}

docker_debian_staged_key_valid() {
  local key="$1"
  [[ "${key}" == "${DOCKER_DEBIAN_MANAGED_KEY_STAGE_GLOB}"* ]] || return 1
  docker_debian_readable_file_secure "${key}" \
    && docker_host_exact_metadata "${key}" file "${DOCKER_HOST_OWNER_UID}:${DOCKER_HOST_OWNER_GID}|644" \
    && docker_debian_key_bytes_valid "${key}"
}

docker_debian_managed_source_valid() {
  local source="$1" expected=${DOCKER_HOST_STATE_ROOT}/expected-docker.sources
  [[ "${source}" == "${DOCKER_DEBIAN_MANAGED_SOURCE}" || "${source}" == "${DOCKER_DEBIAN_MANAGED_SOURCE_STAGE_GLOB}"* ]] || return 1
  docker_debian_readable_file_secure "${source}" || return 1
  docker_host_exact_metadata "${source}" file "${DOCKER_HOST_OWNER_UID}:${DOCKER_HOST_OWNER_GID}|644" || return 1
  docker_debian_repository_content > "${expected}"
  /usr/bin/cmp -s -- "${expected}" "${source}"
}

docker_debian_prepare_repository_directories() {
  local directory
  for directory in /etc/apt/keyrings /etc/apt/sources.list.d; do
    if docker_host_path_occupied "${directory}"; then
      docker_debian_secure_path "${directory}" directory \
        || docker_host_fail repository "Unsafe managed apt directory: ${directory}"
      docker_debian_mode_has_other_bit "${directory}" 1 \
        || docker_host_fail repository "Managed apt directory is not traversable by apt: ${directory}"
    else
      /usr/bin/install -d -o root -g root -m 0755 "${directory}"
    fi
  done
}

docker_debian_remove_orphan_stages() {
  local directory path listing=${DOCKER_HOST_STATE_ROOT}/repository-stages.bin
  : > "${listing}"
  for directory in /etc/apt/keyrings /etc/apt/sources.list.d; do
    [[ -d "${directory}" ]] || continue
    /usr/bin/find -P "${directory}" -mindepth 1 -maxdepth 1 -name '.agent-relay-docker.*.tmp.*' -print0 >> "${listing}" \
      || docker_host_fail repository "Could not inspect interrupted Docker repository publications"
  done
  while IFS= read -r -d '' path; do
    case "${path}" in
      "${DOCKER_DEBIAN_MANAGED_KEY_STAGE_GLOB}"*|"${DOCKER_DEBIAN_MANAGED_SOURCE_STAGE_GLOB}"*) ;;
      *) docker_host_fail repository "Unexpected Docker repository staging file: ${path}" ;;
    esac
    docker_debian_secure_path "${path}" file || docker_host_fail repository "Interrupted Docker repository publication is unsafe: ${path}"
    /usr/bin/rm -f -- "${path}"
  done < "${listing}"
}

docker_debian_validate_repository_boundary() {
  local phase="$1" managed_key=0 managed_source=0 directory path listing=${DOCKER_HOST_STATE_ROOT}/repository-boundary-stages.bin
  docker_debian_inspect_repository_definitions
  docker_host_path_absent "${DOCKER_DEBIAN_MANAGED_KEY}" || managed_key=1
  docker_host_path_absent "${DOCKER_DEBIAN_MANAGED_SOURCE}" || managed_source=1
  if (( managed_key == 1 )); then docker_debian_published_key_valid "${DOCKER_DEBIAN_MANAGED_KEY}" || return 1; fi
  if (( managed_source == 1 )); then docker_debian_managed_source_valid "${DOCKER_DEBIAN_MANAGED_SOURCE}" || return 1; fi
  (( managed_source <= managed_key )) || return 1
  if [[ "${phase}" == fresh ]] && (( managed_key != 0 || managed_source != 0 || DOCKER_DEBIAN_REPOSITORY_DEFINITION_COUNT != 0 )); then return 1; fi
  if (( DOCKER_DEBIAN_REPOSITORY_DEFINITION_COUNT == 1 )); then
    [[ "${DOCKER_DEBIAN_REPOSITORY_SOURCE_PATH}" == "${DOCKER_DEBIAN_MANAGED_SOURCE}" \
      && "${DOCKER_DEBIAN_REPOSITORY_KEY_PATH}" == "${DOCKER_DEBIAN_MANAGED_KEY}" ]] || return 1
  else
    (( DOCKER_DEBIAN_REPOSITORY_DEFINITION_COUNT == 0 )) || return 1
    (( managed_source == 0 )) || return 1
  fi
  : > "${listing}"
  for directory in /etc/apt/keyrings /etc/apt/sources.list.d; do
    docker_host_path_absent "${directory}" && continue
    [[ -d "${directory}" && ! -L "${directory}" ]] || return 1
    /usr/bin/find -P "${directory}" -mindepth 1 -maxdepth 1 -name '.agent-relay-docker.*.tmp.*' -print0 >> "${listing}" || return 1
  done
  while IFS= read -r -d '' path; do
    [[ "${phase}" != fresh ]] || return 1
    [[ "${phase}" == preparing ]] || return 1
    case "${path}" in
      "${DOCKER_DEBIAN_MANAGED_KEY_STAGE_GLOB}"*) docker_debian_staged_key_valid "${path}" || return 1 ;;
      "${DOCKER_DEBIAN_MANAGED_SOURCE_STAGE_GLOB}"*) docker_debian_managed_source_valid "${path}" || return 1 ;;
      *) return 1 ;;
    esac
  done < "${listing}"
  if [[ "${phase}" != preparing && "${phase}" != fresh ]]; then (( managed_key == 1 && managed_source == 1 && DOCKER_DEBIAN_REPOSITORY_DEFINITION_COUNT == 1 )) || return 1; fi
}

docker_debian_publish_key() {
  local source="$1" stage
  docker_host_path_absent "${DOCKER_DEBIAN_MANAGED_KEY}" \
    || docker_host_fail repository "Managed Docker key paths are already occupied"
  stage="$(/usr/bin/mktemp "${DOCKER_DEBIAN_MANAGED_KEY_STAGE_GLOB}XXXXXXXX")" \
    || docker_host_fail repository "Could not stage Docker signing key"
  /usr/bin/install -o root -g root -m 0644 "${source}" "${stage}"
  docker_debian_staged_key_valid "${stage}" \
    || docker_host_fail repository "Staged Docker signing key is invalid"
  /usr/bin/mv -T -- "${stage}" "${DOCKER_DEBIAN_MANAGED_KEY}"
  DOCKER_DEBIAN_REPOSITORY_CHANGED=1
}

docker_debian_publish_source() {
  local source=${DOCKER_HOST_STATE_ROOT}/docker.sources stage
  docker_host_path_absent "${DOCKER_DEBIAN_MANAGED_SOURCE}" \
    || docker_host_fail repository "Managed Docker source paths are already occupied"
  docker_debian_repository_content > "${source}"
  stage="$(/usr/bin/mktemp "${DOCKER_DEBIAN_MANAGED_SOURCE_STAGE_GLOB}XXXXXXXX")" \
    || docker_host_fail repository "Could not stage Docker source definition"
  /usr/bin/install -o root -g root -m 0644 "${source}" "${stage}"
  docker_debian_managed_source_valid "${stage}" \
    || docker_host_fail repository "Staged Docker source definition is invalid"
  /usr/bin/mv -T -- "${stage}" "${DOCKER_DEBIAN_MANAGED_SOURCE}"
  DOCKER_DEBIAN_REPOSITORY_CHANGED=1
}

docker_debian_download_key() {
  local key=${DOCKER_HOST_STATE_ROOT}/docker.asc
  /usr/bin/curl -fsSL --proto '=https' --tlsv1.2 https://download.docker.com/linux/debian/gpg -o "${key}" \
    || docker_host_fail repository "Could not download Docker's signing key"
  /usr/bin/chmod 0600 "${key}"
  docker_debian_key_bytes_valid "${key}" || docker_host_fail repository "Docker signing key fingerprint did not match"
  printf '%s\n' "${key}"
}

docker_debian_ensure_repository() {
  local managed_key=0 managed_source=0 downloaded_key
  DOCKER_DEBIAN_REPOSITORY_CHANGED=0
  docker_debian_inspect_repository_definitions
  docker_debian_prepare_repository_directories
  docker_debian_remove_orphan_stages
  docker_debian_inspect_repository_definitions

  docker_host_path_absent "${DOCKER_DEBIAN_MANAGED_KEY}" || managed_key=1
  docker_host_path_absent "${DOCKER_DEBIAN_MANAGED_SOURCE}" || managed_source=1
  if (( managed_key == 1 )); then
    docker_debian_published_key_valid "${DOCKER_DEBIAN_MANAGED_KEY}" \
      || docker_host_fail repository "Managed Docker signing key is unsafe or unexpected"
  fi
  if (( managed_source == 1 )); then
    docker_debian_managed_source_valid "${DOCKER_DEBIAN_MANAGED_SOURCE}" \
      || docker_host_fail repository "Managed Docker source definition is unsafe or unexpected"
  fi
  if (( DOCKER_DEBIAN_REPOSITORY_DEFINITION_COUNT == 1 )); then
    [[ "${DOCKER_DEBIAN_REPOSITORY_SOURCE_PATH}" == "${DOCKER_DEBIAN_MANAGED_SOURCE}" \
      && "${DOCKER_DEBIAN_REPOSITORY_KEY_PATH}" == "${DOCKER_DEBIAN_MANAGED_KEY}" ]] \
      || docker_host_fail repository "The managed Docker source is ambiguous"
  elif (( managed_source == 1 )); then
    docker_host_fail repository "Managed Docker source was not recognized as the exact active definition"
  fi
  (( DOCKER_DEBIAN_REPOSITORY_DEFINITION_COUNT == 0 || managed_source == 1 )) \
    || docker_host_fail repository "An unmanaged Docker apt source already exists"

  if (( managed_key == 0 )); then
    downloaded_key="$(docker_debian_download_key)"
    docker_debian_publish_key "${downloaded_key}"
    managed_key=1
  fi
  if (( managed_source == 0 )); then
    docker_debian_publish_source
    managed_source=1
  fi
  (( managed_key == 1 && managed_source == 1 )) \
    || docker_host_fail repository "Managed Docker repository publication is incomplete"
}

docker_debian_validate_repository() {
  docker_debian_inspect_repository_definitions
  (( DOCKER_DEBIAN_REPOSITORY_DEFINITION_COUNT == 1 )) \
    && [[ "${DOCKER_DEBIAN_REPOSITORY_SOURCE_PATH}" == "${DOCKER_DEBIAN_MANAGED_SOURCE}" \
      && "${DOCKER_DEBIAN_REPOSITORY_KEY_PATH}" == "${DOCKER_DEBIAN_MANAGED_KEY}" ]] \
    || docker_host_fail repository "Completed managed Docker repository is not exact"
  docker_debian_published_key_valid "${DOCKER_DEBIAN_MANAGED_KEY}" \
    || docker_host_fail repository "Completed managed Docker signing key is unsafe or unexpected"
  docker_debian_managed_source_valid "${DOCKER_DEBIAN_MANAGED_SOURCE}" \
    || docker_host_fail repository "Completed managed Docker source is unsafe or unexpected"
  local directory orphan listing=${DOCKER_HOST_STATE_ROOT}/completed-repository-stages.bin
  : > "${listing}"
  for directory in /etc/apt/keyrings /etc/apt/sources.list.d; do
    [[ -d "${directory}" ]] || docker_host_fail repository "Completed managed apt directory is absent"
    /usr/bin/find -P "${directory}" -mindepth 1 -maxdepth 1 -name '.agent-relay-docker.*.tmp.*' -print0 >> "${listing}" \
      || docker_host_fail repository "Could not inspect completed repository staging state"
  done
  while IFS= read -r -d '' orphan; do
    docker_host_fail repository "Interrupted repository publication remains after completion: ${orphan}"
  done < "${listing}"
}

docker_debian_candidate_is_unambiguously_official() {
  local package="$1" candidate="$2"
  /usr/bin/env LC_ALL=C LANG=C /usr/bin/apt-cache madison "${package}" | /usr/bin/awk -F'|' -v version="${candidate}" '
    {
      found_version=$2; gsub(/^[[:space:]]+|[[:space:]]+$/, "", found_version)
      if(found_version!=version) next
      rows++
      source=$3
      if(source !~ /download\.docker\.com\/linux\/debian/) bad=1
    }
    END{exit !(rows>=1 && !bad)}
  '
}

docker_debian_parse_simulation() {
  local simulation="$1" requested="$2" allowed="$3" installed="$4" accepted="$5" line package version
  : > "${accepted}"
  /usr/bin/grep -Eq '^(Remv|Purg) |DOWNGRADED|unauthenticated' "${simulation}" && return 1
  while IFS= read -r line; do
    case "${line}" in
      Inst\ *)
        package=${line#Inst }; package=${package%% *}; package=${package%%:*}
        [[ "${line}" =~ \ \(([^[:space:]\)]+)\  ]] || return 1
        version=${BASH_REMATCH[1]}
        ;;
      Conf\ *) continue ;;
      *) [[ ! "${line}" =~ ^[[:alpha:]]+[[:space:]][^[:space:]]+[[:space:]]\( ]] || return 1; continue ;;
    esac
    /usr/bin/grep -Fxq "${package}" "${allowed}" || return 1
    if /usr/bin/awk -F'|' -v package="${package}" '$1==package && $2=="ii "{found=1} END{exit !found}' "${installed}"; then
      return 1
    fi
    printf '%s|%s\n' "${package}" "${version}" >> "${accepted}"
  done < "${simulation}"
  /usr/bin/sort -u -o "${accepted}" "${accepted}"
  while IFS='|' read -r package version; do
    /usr/bin/grep -Fxq "${package}|${version}" "${accepted}" || return 1
  done < "${requested}"
}

docker_debian_dependency_edges() {
  local selected="$1" edges="$2" package version detail
  : > "${edges}"
  while IFS='|' read -r package version; do
    [[ -n "${package}" ]] || continue
    detail=${DOCKER_HOST_STATE_ROOT}/depends-${package//[^a-zA-Z0-9]/_}.txt
    /usr/bin/env LC_ALL=C LANG=C /usr/bin/apt-cache depends --important --no-recommends --no-suggests \
      --no-conflicts --no-breaks --no-replaces --no-enhances "${package}=${version}" > "${detail}" \
      || return 1
    /usr/bin/awk -v parent="${package}" '
      /^[[:space:]]*[|]?(Pre)?Depends:/ {
        line=$0
        pipe=(line ~ /^[[:space:]]*[|]/)
        sub(/^[[:space:]]*[|]?(Pre)?Depends:[[:space:]]*/, "", line)
        gsub(/[<>]/, "", line); sub(/:.*/, "", line); sub(/[[:space:]].*/, "", line)
        if(line=="") next
        if(pipe) {if(!alternative) group++; alternative=1}
        else if(alternative) alternative=0
        else group++
        print parent "|" group "|" line
      }
    ' "${detail}" >> "${edges}"
  done < "${selected}"
}

docker_debian_selected_dependency_closure() {
  local requested="$1" selected="$2" edges="$3"
  /usr/bin/awk -F'|' '
    FILENAME==ARGV[1] {requested[$1]=1; reachable[$1]=1; next}
    FILENAME==ARGV[2] {selected[$1]=1; next}
    {
      edge_parent[++edges]=$1; edge_group[edges]=$2; edge_child[edges]=$3
    }
    END {
      changed=1
      while(changed) {
        changed=0
        delete group_count; delete group_child
        for(i=1;i<=edges;i++) if(reachable[edge_parent[i]] && (edge_child[i] in selected)) {
          key=edge_parent[i] SUBSEP edge_group[i]
          group_count[key]++; group_child[key]=edge_child[i]
        }
        for(key in group_count) {
          if(group_count[key]!=1) exit 1
          child=group_child[key]
          if(!reachable[child]) {reachable[child]=1; changed=1}
        }
      }
      for(package in selected) if(!reachable[package]) exit 1
    }
  ' "${requested}" "${selected}" "${edges}"
}

docker_debian_install_exact_packages() {
  (( $# > 0 )) || return 0
  DEBIAN_FRONTEND=noninteractive LC_ALL=C LANG=C /usr/bin/apt-get \
    --yes --no-install-recommends "${DOCKER_DEBIAN_APT_CONFFILE_OPTIONS[@]}" install "$@" \
    || return $?
  docker_debian_reconcile_conffile_artifacts
}

docker_debian_configure_pending_packages() {
  DEBIAN_FRONTEND=noninteractive LC_ALL=C LANG=C /usr/bin/dpkg \
    "${DOCKER_DEBIAN_DPKG_CONFFILE_OPTIONS[@]}" --configure -a
}

docker_debian_install_components() {
  (( $# > 0 )) || return 0
  docker_debian_assert_clean_dpkg
  docker_debian_ensure_repository
  /usr/bin/env LC_ALL=C LANG=C /usr/bin/apt-get update \
    || docker_host_fail package "Could not refresh the Docker apt metadata snapshot"
  local package candidate status installed_version
  local -a exact=()
  : > "${DOCKER_HOST_STATE_ROOT}/requested.txt"
  /usr/bin/env LC_ALL=C LANG=C /usr/bin/dpkg-query -W -f='${Package}|${db:Status-Abbrev}|${Version}\n' > "${DOCKER_HOST_STATE_ROOT}/packages-before.txt"
  for package in "$@"; do
    candidate="$(/usr/bin/env LC_ALL=C LANG=C /usr/bin/apt-cache policy "${package}" | /usr/bin/awk '$1=="Candidate:"{count++;value=$2} END{if(count==1&&value!="(none)")print value}')"
    [[ -n "${candidate}" ]] || docker_host_fail package "No Docker apt candidate is available for ${package}"
    docker_debian_candidate_is_unambiguously_official "${package}" "${candidate}" \
      || docker_host_fail package "Candidate ${package}=${candidate} is absent from or ambiguous outside Docker's official repository"
    exact+=("${package}=${candidate}")
    status="$(docker_debian_package_status "${package}")"
    if docker_debian_package_installed "${status}"; then
      installed_version=${status#*|}; installed_version=${installed_version%$'\n'}
      [[ "${installed_version}" == "${candidate}" ]] || docker_host_fail package "Partially installed managed package differs from the exact candidate: ${package}"
    else
      docker_debian_package_absent "${status}" || docker_host_fail package "Managed package is in a partial state: ${package}"
      printf '%s|%s\n' "${package}" "${candidate}" >> "${DOCKER_HOST_STATE_ROOT}/requested.txt"
    fi
  done
  /usr/bin/env LC_ALL=C LANG=C /usr/bin/apt-get --simulate --no-install-recommends install "${exact[@]}" > "${DOCKER_HOST_STATE_ROOT}/simulation.txt" 2>&1 \
    || docker_host_fail package "Docker package simulation failed"
  /usr/bin/awk '/^Inst /{name=$2;sub(/:.*/,"",name);print name}' "${DOCKER_HOST_STATE_ROOT}/simulation.txt" \
    | /usr/bin/sort -u > "${DOCKER_HOST_STATE_ROOT}/selected-names.txt"
  docker_debian_parse_simulation "${DOCKER_HOST_STATE_ROOT}/simulation.txt" "${DOCKER_HOST_STATE_ROOT}/requested.txt" "${DOCKER_HOST_STATE_ROOT}/selected-names.txt" "${DOCKER_HOST_STATE_ROOT}/packages-before.txt" "${DOCKER_HOST_STATE_ROOT}/accepted.txt" \
    || docker_host_fail package "Docker package simulation contains an unapproved change"
  docker_debian_dependency_edges "${DOCKER_HOST_STATE_ROOT}/accepted.txt" "${DOCKER_HOST_STATE_ROOT}/dependency-edges.txt" \
    || docker_host_fail package "Could not inspect resolver-selected package dependencies"
  docker_debian_selected_dependency_closure "${DOCKER_HOST_STATE_ROOT}/requested.txt" "${DOCKER_HOST_STATE_ROOT}/accepted.txt" "${DOCKER_HOST_STATE_ROOT}/dependency-edges.txt" \
    || docker_host_fail package "Resolver selected a package outside the requested dependency closure"
  local selected_package selected_version
  local -a selected_exact=()
  while IFS='|' read -r selected_package selected_version; do
    selected_exact+=("${selected_package}=${selected_version}")
  done < "${DOCKER_HOST_STATE_ROOT}/accepted.txt"
  /usr/bin/install -o root -g root -m 0600 "${DOCKER_HOST_STATE_ROOT}/accepted.txt" "${DOCKER_HOST_STATE_ROOT}/resolved-packages.txt"
  docker_host_publish_marker transaction "${DOCKER_HOST_STATE_ROOT}/resolved-packages.txt"
  if (( ${#selected_exact[@]} > 0 )); then
    docker_debian_install_exact_packages "${selected_exact[@]}" \
      || docker_host_fail package "Docker package installation failed; rerun ./update.sh to resume the recorded transaction"
  fi
  : > "${DOCKER_HOST_STATE_ROOT}/resolved-packages.txt"
  for package in "${DOCKER_DEBIAN_PACKAGES[@]}"; do
    status="$(docker_debian_package_status "${package}")"
    docker_debian_package_installed "${status}" || docker_host_fail package "Docker package was not installed: ${package}"
    installed_version=${status#*|}; installed_version=${installed_version%$'\n'}
    printf '%s|%s\n' "${package}" "${installed_version}" >> "${DOCKER_HOST_STATE_ROOT}/resolved-packages.txt"
  done
  while IFS='|' read -r selected_package selected_version; do
    local installed_status installed_version
    installed_status="$(docker_debian_package_status "${selected_package}")"
    docker_debian_package_installed "${installed_status}" || docker_host_fail package "Resolved package was not installed: ${selected_package}"
    installed_version=${installed_status#*|}; installed_version=${installed_version%$'\n'}
    [[ "${installed_version}" == "${selected_version}" ]] || docker_host_fail package "Installed version differs from resolved transaction for ${selected_package}"
    case " ${DOCKER_DEBIAN_PACKAGES[*]} " in *" ${selected_package} "*) ;; *) printf '%s|%s\n' "${selected_package}" "${selected_version}" >> "${DOCKER_HOST_STATE_ROOT}/resolved-packages.txt" ;; esac
  done < "${DOCKER_HOST_STATE_ROOT}/accepted.txt"
  /usr/bin/sort -u -o "${DOCKER_HOST_STATE_ROOT}/resolved-packages.txt" "${DOCKER_HOST_STATE_ROOT}/resolved-packages.txt"
}
