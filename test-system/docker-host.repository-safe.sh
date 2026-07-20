#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
TMP="$(mktemp -d)"
trap 'rm -rf -- "${TMP}"' EXIT

fail() {
  printf 'docker-host.repository-safe.sh: %s\n' "$1" >&2
  exit 1
}

export DOCKER_HOST_LIBRARY_ONLY=1
source "${ROOT}/scripts/docker-host.sh"
source "${ROOT}/scripts/docker-host-debian.sh"
DOCKER_HOST_STATE_ROOT=${TMP}/state
mkdir -p "${DOCKER_HOST_STATE_ROOT}"
DOCKER_DEBIAN_CODENAME=trixie

write_records() {
  local path="$1" core="$2" buildx="$3" compose="$4" package status
  : > "${path}"
  for package in "${DOCKER_DEBIAN_CONFLICTS[@]}"; do
    printf 'conflict:%s|not-installed|0\n' "${package}" >> "${path}"
  done
  for package in "${DOCKER_DEBIAN_CORE_PACKAGES[@]}"; do
    status=not-installed
    [[ "${core}" == installed ]] && status='ii '
    printf '%s|%s|0\n' "${package}" "${status}" >> "${path}"
  done
  printf 'docker-buildx-plugin|%s|0\n' "${buildx}" >> "${path}"
  printf 'docker-compose-plugin|%s|0\n' "${compose}" >> "${path}"
}

records=${TMP}/records
DOCKER_HOST_FRESH=0
write_records "${records}" absent not-installed not-installed
docker_host_classify_records "${records}"
[[ "${DOCKER_HOST_CLASSIFICATION}" == fresh ]] || fail "fresh classification failed"
[[ "${DOCKER_HOST_FRESH}" == 0 ]] || fail "classification must not mutate the initial fresh-install flag"
[[ "${DOCKER_HOST_MISSING[*]}" == "${DOCKER_DEBIAN_PACKAGES[*]}" ]] || fail "fresh package request is incomplete"

write_records "${records}" installed 'ii ' 'ii '
docker_host_classify_records "${records}"
[[ "${DOCKER_HOST_CLASSIFICATION}" == complete-compatible ]] || fail "compatible classification failed"
(( ${#DOCKER_HOST_MISSING[@]} == 0 )) || fail "compatible installation requested package mutation"

write_records "${records}" installed not-installed 'ii '
docker_host_classify_records "${records}"
[[ "${DOCKER_HOST_CLASSIFICATION}" == missing-plugin ]] || fail "missing Buildx classification failed"
[[ "${DOCKER_HOST_MISSING[*]}" == docker-buildx-plugin ]] || fail "wrong Buildx package request"

write_records "${records}" installed 'ii ' not-installed
docker_host_classify_records "${records}"
[[ "${DOCKER_HOST_CLASSIFICATION}" == missing-plugin ]] || fail "missing Compose classification failed"
[[ "${DOCKER_HOST_MISSING[*]}" == docker-compose-plugin ]] || fail "wrong Compose package request"

write_records "${records}" installed 'ii ' 'ii '
printf 'conflict:docker.io|ii |0\n' >> "${records}"
if docker_host_classify_records "${records}"; then fail "conflicting package was accepted"; fi

write_records "${records}" installed 'ii ' 'ii '
sed -i 's/^docker-ce-cli|ii |0$/docker-ce-cli|not-installed|0/' "${records}"
if docker_host_classify_records "${records}"; then fail "partial core was accepted"; fi

[[ "$(docker_host_membership_actions 0 0)" == add-runner ]] || fail "runner membership action missing"
[[ "$(docker_host_membership_actions 1 1)" == remove-builder ]] || fail "builder removal action missing"
[[ -z "$(docker_host_membership_actions 1 0)" ]] || fail "idempotent memberships emitted actions"

docker_host_client_environment /tmp/runner-client
[[ " ${DOCKER_HOST_CLIENT_ENVIRONMENT[*]} " == *" HOME=/tmp/runner-client "* ]] || fail "client HOME missing"
[[ " ${DOCKER_HOST_CLIENT_ENVIRONMENT[*]} " == *" DOCKER_CONFIG=/tmp/runner-client "* ]] || fail "client DOCKER_CONFIG missing"
[[ " ${DOCKER_HOST_CLIENT_ENVIRONMENT[*]} " == *" PATH=/usr/bin:/bin "* ]] || fail "client PATH is not explicit"

repo_records=${TMP}/repository-records
printf 'compatible|/etc/apt/keyrings/docker.asc|/etc/apt/sources.list.d/docker.sources\n' > "${repo_records}"
docker_debian_repository_records_acceptable "${repo_records}"
[[ "${DOCKER_DEBIAN_REPOSITORY_DEFINITION_COUNT}" == 1 ]] || fail "compatible repository count failed"
[[ "${DOCKER_DEBIAN_REPOSITORY_KEY_PATH}" == /etc/apt/keyrings/docker.asc ]] || fail "repository key path failed"
[[ "${DOCKER_DEBIAN_REPOSITORY_SOURCE_PATH}" == /etc/apt/sources.list.d/docker.sources ]] || fail "repository source path failed"
printf '%s\n' \
  'compatible|/etc/apt/keyrings/docker.asc|/etc/apt/sources.list.d/docker.sources' \
  'compatible|/etc/apt/keyrings/docker.gpg|/etc/apt/sources.list.d/docker.list' > "${repo_records}"
if docker_debian_repository_records_acceptable "${repo_records}"; then fail "duplicate Docker repositories were accepted"; fi
printf 'conflicting||/etc/apt/sources.list.d/docker.list\n' > "${repo_records}"
if docker_debian_repository_records_acceptable "${repo_records}"; then fail "conflicting Docker repository was accepted"; fi

list_output="$(docker_debian_parse_list_source "${ROOT}/test-system/fixtures/docker-source-compatible.list")"
[[ "${list_output}" == 'compatible|/etc/apt/keyrings/docker.gpg' ]] || fail "compatible list source parsing failed"
list_output="$(docker_debian_parse_list_source "${ROOT}/test-system/fixtures/docker-source-insecure.list")"
[[ "${list_output}" == 'conflicting|/etc/apt/keyrings/docker.gpg' ]] || fail "insecure list source parsing lost its referenced key path"
printf '%s|%s\n' "${list_output}" "${ROOT}/test-system/fixtures/docker-source-insecure.list" > "${repo_records}"
if docker_debian_repository_records_acceptable "${repo_records}"; then fail "insecure list source was accepted"; fi

deb822_output="$(docker_debian_parse_deb822_source "${ROOT}/test-system/fixtures/docker-source-compatible.sources")"
[[ "${deb822_output}" == 'compatible|/etc/apt/keyrings/docker.asc' ]] || fail "compatible deb822 source parsing failed"
cat > "${TMP}/disabled.sources" <<'EOF'
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: trixie
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
Enabled: no
EOF
deb822_output="$(docker_debian_parse_deb822_source "${TMP}/disabled.sources")"
[[ "${deb822_output}" == 'conflicting|/etc/apt/keyrings/docker.asc' ]] || fail "disabled Docker source was accepted"

printf 'Docker repository/classification diagnostics passed\n'