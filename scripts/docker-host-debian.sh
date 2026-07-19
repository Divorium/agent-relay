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
DOCKER_DEBIAN_MANAGED_KEY_STAGE=/etc/apt/keyrings/.agent-relay-docker.asc.new
DOCKER_DEBIAN_MANAGED_SOURCE_STAGE=/etc/apt/sources.list.d/.agent-relay-docker.sources.new

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
    [[ -f "${path}" && ! -L "${path}" && -r "${path}" ]] || return 1
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

docker_debian_apt_key_secure() {
  local key="$1" directory
  [[ "${key}" == /etc/apt/keyrings/docker.asc || "${key}" == /etc/apt/keyrings/docker.gpg ]] || return 1
  docker_debian_secure_path "${key}" file || return 1
  docker_debian_mode_has_other_bit "${key}" 4 || return 1
  for directory in /etc /etc/apt /etc/apt/keyrings; do
    docker_debian_secure_path "${directory}" directory || return 1
    docker_debian_mode_has_other_bit "${directory}" 1 || return 1
  done
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

docker_debian_inspect_repository_definitions() {
  local records=${DOCKER_HOST_STATE_ROOT}/repository-definitions.txt path output listing status
  local -a sources=()
  : > "${records}"
  for path in /etc /etc/apt /etc/apt/sources.list.d; do
    [[ ! -e "${path}" ]] || docker_debian_secure_path "${path}" directory \
      || docker_host_fail repository "Unsafe apt source directory: ${path}"
  done
  [[ ! -e /etc/apt/sources.list ]] || sources+=(/etc/apt/sources.list)
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
    docker_debian_secure_path "${path}" file || docker_host_fail repository "Unsafe apt source file: ${path}"
    if [[ "${path}" == *.sources ]]; then
      output="$(docker_debian_parse_deb822_source "${path}")"
    else
      output="$(docker_debian_parse_list_source "${path}")"
    fi
    while IFS= read -r record; do
      [[ -z "${record}" ]] || printf '%s|%s\n' "${record}" "${path}" >> "${records}"
    done <<< "${output}"
  done
  docker_debian_repository_records_acceptable "${records}" \
    || docker_host_fail repository "Docker apt source definitions are conflicting, duplicate, ambiguous, disabled, or insecure"
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
      if(value=="" || value !~ /^[0-9A-F]+$/) bad=1
      if(waiting=="pub") {if(primary!="" || length(value)!=40) bad=1; primary=value; waiting=""; next}
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
  docker_debian_apt_key_secure "${key}" && docker_debian_key_bytes_valid "${key}"
}

docker_debian_managed_source_valid() {
  local source="$1" expected=${DOCKER_HOST_STATE_ROOT}/expected-docker.sources
  docker_debian_secure_path "${source}" file || return 1
  docker_debian_mode_has_other_bit "${source}" 4 || return 1
  docker_debian_repository_content > "${expected}"
  /usr/bin/cmp -s -- "${expected}" "${source}"
}

docker_debian_reserved_stage_reset() {
  local path="$1"
  [[ ! -e "${path}" ]] && return 0
  docker_debian_secure_path "${path}" file \
    || docker_host_fail repository "Unsafe content occupies managed temporary path: ${path}"
  /usr/bin/rm -f -- "${path}"
}

docker_debian_publish_key() {
  local source="$1"
  [[ ! -e "${DOCKER_DEBIAN_MANAGED_KEY}" ]] || docker_host_fail repository "Managed Docker key path is already occupied"
  docker_debian_reserved_stage_reset "${DOCKER_DEBIAN_MANAGED_KEY_STAGE}"
  /usr/bin/install -o root -g root -m 0644 "${source}" "${DOCKER_DEBIAN_MANAGED_KEY_STAGE}"
  docker_debian_published_key_valid "${DOCKER_DEBIAN_MANAGED_KEY_STAGE}" \
    || docker_host_fail repository "Staged Docker signing key is invalid"
  /usr/bin/mv -T -- "${DOCKER_DEBIAN_MANAGED_KEY_STAGE}" "${DOCKER_DEBIAN_MANAGED_KEY}"
  DOCKER_DEBIAN_REPOSITORY_CHANGED=1
}

docker_debian_publish_source() {
  local source=${DOCKER_HOST_STATE_ROOT}/docker.sources
  [[ ! -e "${DOCKER_DEBIAN_MANAGED_SOURCE}" ]] || docker_host_fail repository "Managed Docker source path is already occupied"
  docker_debian_repository_content > "${source}"
  docker_debian_reserved_stage_reset "${DOCKER_DEBIAN_MANAGED_SOURCE_STAGE}"
  /usr/bin/install -o root -g root -m 0644 "${source}" "${DOCKER_DEBIAN_MANAGED_SOURCE_STAGE}"
  docker_debian_managed_source_valid "${DOCKER_DEBIAN_MANAGED_SOURCE_STAGE}" \
    || docker_host_fail repository "Staged Docker source definition is invalid"
  /usr/bin/mv -T -- "${DOCKER_DEBIAN_MANAGED_SOURCE_STAGE}" "${DOCKER_DEBIAN_MANAGED_SOURCE}"
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
  /usr/bin/install -d -o root -g root -m 0755 /etc/apt/keyrings /etc/apt/sources.list.d
  docker_debian_inspect_repository_definitions
  [[ ! -e "${DOCKER_DEBIAN_MANAGED_KEY}" ]] || managed_key=1
  [[ ! -e "${DOCKER_DEBIAN_MANAGED_SOURCE}" ]] || managed_source=1

  if (( managed_key == 1 )); then
    docker_debian_published_key_valid "${DOCKER_DEBIAN_MANAGED_KEY}" \
      || docker_host_fail repository "Managed Docker signing key is unsafe or unexpected"
  fi
  if (( managed_source == 1 )); then
    docker_debian_managed_source_valid "${DOCKER_DEBIAN_MANAGED_SOURCE}" \
      || docker_host_fail repository "Managed Docker source definition is unsafe or unexpected"
  fi

  if (( DOCKER_DEBIAN_REPOSITORY_DEFINITION_COUNT == 1 )) && [[ "${DOCKER_DEBIAN_REPOSITORY_SOURCE_PATH}" != "${DOCKER_DEBIAN_MANAGED_SOURCE}" ]]; then
    (( managed_source == 0 )) || docker_host_fail repository "A managed source conflicts with an external Docker source"
    [[ ! -e "${DOCKER_DEBIAN_MANAGED_KEY_STAGE}" && ! -e "${DOCKER_DEBIAN_MANAGED_SOURCE_STAGE}" ]] \
      || docker_host_fail repository "Managed temporary paths are occupied beside an external Docker source"
    docker_debian_published_key_valid "${DOCKER_DEBIAN_REPOSITORY_KEY_PATH}" \
      || docker_host_fail repository "The configured Docker signing key is missing, unreadable, unsafe, or unexpected"
    return
  fi

  if (( DOCKER_DEBIAN_REPOSITORY_DEFINITION_COUNT == 1 )); then
    [[ "${DOCKER_DEBIAN_REPOSITORY_SOURCE_PATH}" == "${DOCKER_DEBIAN_MANAGED_SOURCE}" && "${DOCKER_DEBIAN_REPOSITORY_KEY_PATH}" == "${DOCKER_DEBIAN_MANAGED_KEY}" ]] \
      || docker_host_fail repository "The managed Docker source is ambiguous"
  elif (( managed_source == 1 )); then
    docker_host_fail repository "Managed Docker source was not recognized as the exact active definition"
  fi

  docker_debian_reserved_stage_reset "${DOCKER_DEBIAN_MANAGED_KEY_STAGE}"
  docker_debian_reserved_stage_reset "${DOCKER_DEBIAN_MANAGED_SOURCE_STAGE}"

  if (( managed_key == 0 )); then
    downloaded_key="$(docker_debian_download_key)"
    docker_debian_publish_key "${downloaded_key}"
    managed_key=1
  fi
  if (( managed_source == 0 )); then
    docker_debian_publish_source
    managed_source=1
  fi
  (( managed_key == 1 && managed_source == 1 )) || docker_host_fail repository "Managed Docker repository publication is incomplete"
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
  local simulation="$1" requested="$2" allowed="$3" installed="$4" accepted="$5" line package
  : > "${accepted}"
  /usr/bin/grep -Eq '^(Remv|Purg) |DOWNGRADED|unauthenticated' "${simulation}" && return 1
  while IFS= read -r line; do
    case "${line}" in
      Inst\ *) package=${line#Inst }; package=${package%% *}; package=${package%%:*} ;;
      Conf\ *) continue ;;
      *) [[ ! "${line}" =~ ^[[:alpha:]]+[[:space:]][^[:space:]]+[[:space:]]\( ]] || return 1; continue ;;
    esac
    /usr/bin/grep -Fxq "${package}" "${allowed}" || return 1
    if /usr/bin/awk -F'|' -v package="${package}" '$1==package && $2=="ii "{found=1} END{exit !found}' "${installed}"; then
      return 1
    fi
    printf '%s\n' "${package}" >> "${accepted}"
  done < "${simulation}"
  /usr/bin/sort -u -o "${accepted}" "${accepted}"
  while IFS= read -r package; do
    /usr/bin/grep -Fxq "${package}" "${accepted}" || return 1
  done < "${requested}"
}

docker_debian_install_components() {
  (( $# > 0 )) || return 0
  docker_debian_assert_clean_dpkg
  docker_debian_ensure_repository
  (( DOCKER_DEBIAN_REPOSITORY_CHANGED == 0 )) || /usr/bin/env LC_ALL=C LANG=C /usr/bin/apt-get update
  local package candidate
  local -a exact=()
  : > "${DOCKER_HOST_STATE_ROOT}/requested.txt"
  /usr/bin/env LC_ALL=C LANG=C /usr/bin/dpkg-query -W -f='${Package}|${db:Status-Abbrev}|${Version}\n' > "${DOCKER_HOST_STATE_ROOT}/packages-before.txt"
  for package in "$@"; do
    candidate="$(/usr/bin/env LC_ALL=C LANG=C /usr/bin/apt-cache policy "${package}" | /usr/bin/awk '$1=="Candidate:"{count++;value=$2} END{if(count==1&&value!="(none)")print value}')"
    if [[ -z "${candidate}" ]]; then
      /usr/bin/env LC_ALL=C LANG=C /usr/bin/apt-get update
      candidate="$(/usr/bin/env LC_ALL=C LANG=C /usr/bin/apt-cache policy "${package}" | /usr/bin/awk '$1=="Candidate:"{count++;value=$2} END{if(count==1&&value!="(none)")print value}')"
    fi
    [[ -n "${candidate}" ]] || docker_host_fail package "No Docker apt candidate is available for ${package}"
    docker_debian_candidate_is_unambiguously_official "${package}" "${candidate}" \
      || docker_host_fail package "Candidate ${package}=${candidate} is absent from or ambiguous outside Docker's official repository"
    exact+=("${package}=${candidate}")
    printf '%s\n' "${package}" >> "${DOCKER_HOST_STATE_ROOT}/requested.txt"
  done
  /usr/bin/env LC_ALL=C LANG=C /usr/bin/apt-cache depends --recurse --no-recommends --no-suggests --no-conflicts --no-breaks --no-replaces --no-enhances "${exact[@]}" \
    | /usr/bin/awk '/^[[:space:]]*(Pre)?Depends:/{value=$2;gsub(/[<>]/,"",value);sub(/:.*/,"",value);if(value!="")print value}' \
    | /usr/bin/sort -u > "${DOCKER_HOST_STATE_ROOT}/allowed.txt"
  printf '%s\n' "$@" >> "${DOCKER_HOST_STATE_ROOT}/allowed.txt"
  /usr/bin/sort -u -o "${DOCKER_HOST_STATE_ROOT}/allowed.txt" "${DOCKER_HOST_STATE_ROOT}/allowed.txt"
  /usr/bin/env LC_ALL=C LANG=C /usr/bin/apt-get --simulate --no-install-recommends install "${exact[@]}" > "${DOCKER_HOST_STATE_ROOT}/simulation.txt" 2>&1 \
    || docker_host_fail package "Docker package simulation failed"
  docker_debian_parse_simulation "${DOCKER_HOST_STATE_ROOT}/simulation.txt" "${DOCKER_HOST_STATE_ROOT}/requested.txt" "${DOCKER_HOST_STATE_ROOT}/allowed.txt" "${DOCKER_HOST_STATE_ROOT}/packages-before.txt" "${DOCKER_HOST_STATE_ROOT}/accepted.txt" \
    || docker_host_fail package "Docker package simulation contains an unapproved change"
  DEBIAN_FRONTEND=noninteractive LC_ALL=C LANG=C /usr/bin/apt-get --yes --no-install-recommends install "${exact[@]}" \
    || docker_host_fail package "Docker package installation failed; make dpkg clean before rerunning ./update.sh"
}
