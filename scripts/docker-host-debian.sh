#!/usr/bin/env bash

# Debian package adapter for scripts/docker-host.sh. This file is sourced by the
# host orchestrator and intentionally has no standalone entrypoint.

DOCKER_DEBIAN_PACKAGES=(docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin)
DOCKER_DEBIAN_CORE_PACKAGES=(docker-ce docker-ce-cli containerd.io)
DOCKER_DEBIAN_PLUGIN_PACKAGES=(docker-buildx-plugin docker-compose-plugin)
DOCKER_DEBIAN_CONFLICTS=(docker.io docker-compose docker-doc podman-docker containerd runc)
DOCKER_DEBIAN_KEY_FINGERPRINT=9DC858229FC7DD38854AE2D88D81803C0EBFCD88

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
  local audit=${DOCKER_HOST_STATE_ROOT}/dpkg-audit.txt packages=${DOCKER_HOST_STATE_ROOT}/dpkg-packages.txt status
  set +e
  /usr/bin/env LC_ALL=C LANG=C /usr/bin/dpkg --audit > "${audit}" 2>&1
  status=$?
  /usr/bin/env LC_ALL=C LANG=C /usr/bin/dpkg-query -W -f='${Package}|${db:Status-Abbrev}|${Version}\n' \
    > "${packages}" 2> "${DOCKER_HOST_STATE_ROOT}/dpkg-query.err"
  local query_status=$?
  set -e
  (( status == 0 && query_status == 0 )) \
    || docker_host_fail package "Could not audit global dpkg state"
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
    function emit(ok){
      if (uris !~ /(^|[[:space:]])https:\/\/download\.docker\.com\/linux\/debian($|[[:space:]])/ || tolower(enabled)=="no") {reset();return}
      ok=(types=="deb" && uris=="https://download.docker.com/linux/debian" && suites==suite && components=="stable" && arch=="amd64" && signed ~ /^\/etc\/apt\/keyrings\/docker\.(asc|gpg)$/ && !duplicate && !unsafe)
      print (ok?"compatible":"conflicting") "|" signed; reset()
    }
    BEGIN{reset()} /^[[:space:]]*#/{next} /^[[:space:]]*$/{emit();next}
    /^[[:space:]]+/{value=$0;gsub(/^[[:space:]]+|[[:space:]]+$/, "", value);if(current!=""&&value!="")assign(current,value,1);next}
    /^[^[:space:]][^:]*:/{key=tolower(substr($0,1,index($0,":")-1));value=substr($0,index($0,":")+1);gsub(/^[[:space:]]+|[[:space:]]+$/, "", value);current=key;assign(key,value,0)}
    END{emit()}
  ' "${path}"
}

docker_debian_repository_records_acceptable() {
  local records="$1" kind key count=0
  DOCKER_DEBIAN_REPOSITORY_KEY_PATH=
  while IFS='|' read -r kind key; do
    [[ -n "${kind}" ]] || continue
    ((count += 1))
    [[ "${kind}" == compatible ]] || return 1
    DOCKER_DEBIAN_REPOSITORY_KEY_PATH=${key}
  done < "${records}"
  (( count <= 1 )) || return 1
  DOCKER_DEBIAN_REPOSITORY_DEFINITION_COUNT=${count}
}

docker_debian_secure_path() {
  local path="$1" kind="$2" metadata mode
  if [[ "${kind}" == directory ]]; then [[ -d "${path}" && ! -L "${path}" ]]; else [[ -f "${path}" && ! -L "${path}" && -r "${path}" ]]; fi || return 1
  [[ "$(/usr/bin/readlink -f -- "${path}")" == "${path}" ]] || return 1
  metadata="$(/usr/bin/stat -c '%u:%g|%a' -- "${path}")" || return 1
  mode=${metadata#*|}
  [[ "${metadata%%|*}" == 0:0 && "${mode}" =~ ^[0-7]{3,4}$ && $((8#${mode} & 8#022)) == 0 ]]
}

docker_debian_inspect_repository_definitions() {
  local records=${DOCKER_HOST_STATE_ROOT}/repository-definitions.txt path output source_listing status
  local -a sources=()
  : > "${records}"
  for path in /etc /etc/apt /etc/apt/sources.list.d; do
    [[ ! -e "${path}" ]] || docker_debian_secure_path "${path}" directory \
      || docker_host_fail repository "Unsafe apt source directory: ${path}"
  done
  [[ ! -e /etc/apt/sources.list ]] || sources+=(/etc/apt/sources.list)
  if [[ -d /etc/apt/sources.list.d ]]; then
    set +e
    source_listing="$(/usr/bin/find -P /etc/apt/sources.list.d -maxdepth 1 \( -name '*.list' -o -name '*.sources' \) -print)"
    status=$?
    set -e
    (( status == 0 )) || docker_host_fail repository "Could not completely inspect apt source definitions"
    while IFS= read -r path; do [[ -z "${path}" ]] || sources+=("${path}"); done <<< "${source_listing}"
  fi
  for path in "${sources[@]}"; do
    docker_debian_secure_path "${path}" file || docker_host_fail repository "Unsafe apt source file: ${path}"
    if [[ "${path}" == *.sources ]]; then output="$(docker_debian_parse_deb822_source "${path}")"; else output="$(docker_debian_parse_list_source "${path}")"; fi
    [[ -z "${output}" ]] || printf '%s\n' "${output}" >> "${records}"
  done
  docker_debian_repository_records_acceptable "${records}" \
    || docker_host_fail repository "Docker apt source definitions are conflicting, duplicate, ambiguous, or insecure"
}

docker_debian_repository_content() {
  printf 'Types: deb\nURIs: https://download.docker.com/linux/debian\nSuites: %s\nComponents: stable\nArchitectures: amd64\nSigned-By: /etc/apt/keyrings/docker.asc\n' "${DOCKER_DEBIAN_CODENAME}"
}

docker_debian_key_valid() {
  local key="$1" output=${DOCKER_HOST_STATE_ROOT}/key.txt fingerprint
  docker_debian_secure_path "${key}" file || return 1
  /usr/bin/gpg --batch --show-keys --with-colons "${key}" > "${output}" 2>&1 || return 1
  fingerprint="$(/usr/bin/awk -F: '$1=="fpr"{count++;value=$10} END{if(count==1)print value}' "${output}")"
  [[ "${fingerprint}" == "${DOCKER_DEBIAN_KEY_FINGERPRINT}" ]]
}

docker_debian_ensure_repository() {
  docker_debian_inspect_repository_definitions
  if (( DOCKER_DEBIAN_REPOSITORY_DEFINITION_COUNT == 1 )); then
    docker_debian_secure_path "$(/usr/bin/dirname -- "${DOCKER_DEBIAN_REPOSITORY_KEY_PATH}")" directory \
      || docker_host_fail repository "The Docker signing-key directory is unsafe"
    docker_debian_key_valid "${DOCKER_DEBIAN_REPOSITORY_KEY_PATH}" \
      || docker_host_fail repository "The configured Docker signing key is missing, unsafe, or unexpected"
    return
  fi
  local key=${DOCKER_HOST_STATE_ROOT}/docker.asc source=${DOCKER_HOST_STATE_ROOT}/docker.sources
  [[ ! -e /etc/apt/sources.list.d/agent-relay-docker.sources && ! -e /etc/apt/keyrings/docker.asc ]] \
    || docker_host_fail repository "Inactive or unrelated content occupies an Agent Relay managed Docker apt path"
  /usr/bin/curl -fsSL --proto '=https' --tlsv1.2 https://download.docker.com/linux/debian/gpg -o "${key}" \
    || docker_host_fail repository "Could not download Docker's signing key"
  /usr/bin/chmod 0600 "${key}"
  # Validate the downloaded bytes before publishing either apt file.
  local fingerprint
  fingerprint="$(/usr/bin/gpg --batch --show-keys --with-colons "${key}" | /usr/bin/awk -F: '$1=="fpr"{count++;value=$10} END{if(count==1)print value}')"
  [[ "${fingerprint}" == "${DOCKER_DEBIAN_KEY_FINGERPRINT}" ]] || docker_host_fail repository "Docker signing key fingerprint did not match"
  docker_debian_repository_content > "${source}"
  /usr/bin/install -d -o root -g root -m 0755 /etc/apt/keyrings /etc/apt/sources.list.d
  /usr/bin/install -o root -g root -m 0644 "${key}" /etc/apt/keyrings/docker.asc
  /usr/bin/install -o root -g root -m 0644 "${source}" /etc/apt/sources.list.d/agent-relay-docker.sources
  DOCKER_DEBIAN_REPOSITORY_CHANGED=1
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
    ! /usr/bin/awk -F'|' -v package="${package}" '$1==package && $2=="ii "{found=1} END{exit !found}' "${installed}" || return 1
    printf '%s\n' "${package}" >> "${accepted}"
  done < "${simulation}"
  /usr/bin/sort -u -o "${accepted}" "${accepted}"
  while IFS= read -r package; do /usr/bin/grep -Fxq "${package}" "${accepted}" || return 1; done < "${requested}"
}

docker_debian_install_components() {
  (( $# > 0 )) || return 0
  docker_debian_assert_clean_dpkg
  docker_debian_ensure_repository
  (( ${DOCKER_DEBIAN_REPOSITORY_CHANGED:-0} == 0 )) || /usr/bin/env LC_ALL=C LANG=C /usr/bin/apt-get update
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
    [[ -n "${candidate}" ]] || docker_host_fail package "No official Docker apt candidate is available for ${package}"
    /usr/bin/env LC_ALL=C LANG=C /usr/bin/apt-cache madison "${package}" | /usr/bin/awk -F'|' -v version="${candidate}" '{value=$2;gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)} value==version && $3 ~ /download\.docker\.com\/linux\/debian/{found=1} END{exit !found}' \
      || docker_host_fail package "Candidate ${package}=${candidate} is not from Docker's official repository"
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
