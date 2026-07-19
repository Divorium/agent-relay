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
# shellcheck source=scripts/docker-host.sh
source "${ROOT}/scripts/docker-host.sh"
# shellcheck source=scripts/docker-host-debian.sh
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
[[ "${list_output}" == 'conflicting|' ]] || fail "insecure list source was accepted"
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

PRIMARY=9DC858229FC7DD38854AE2D88D81803C0EBFCD88
SUBKEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
cat > "${TMP}/valid-key.txt" <<EOF
tru::1:1:0:0:0:0:0:0:
pub:-:4096:1:1111111111111111:0:0::::::scESC::::::23::0:
fpr:::::::::${PRIMARY}:
uid:-::::0::hash::Docker Release::::::::::0:
sub:-:4096:1:2222222222222222:0:0::::::e::::::23:
fpr:::::::::${SUBKEY}:
EOF
[[ "$(docker_debian_primary_fingerprint_from_colons "${TMP}/valid-key.txt")" == "${PRIMARY}" ]] \
  || fail "valid primary key with subkey was rejected"

cat > "${TMP}/two-primary.txt" <<EOF
pub:::::::::
fpr:::::::::${PRIMARY}:
pub:::::::::
fpr:::::::::${SUBKEY}:
EOF
if docker_debian_primary_fingerprint_from_colons "${TMP}/two-primary.txt" >/dev/null; then fail "multiple primary keys were accepted"; fi
cat > "${TMP}/missing-primary-fpr.txt" <<EOF
pub:::::::::
uid:::::::::
EOF
if docker_debian_primary_fingerprint_from_colons "${TMP}/missing-primary-fpr.txt" >/dev/null; then fail "missing primary fingerprint was accepted"; fi
cat > "${TMP}/duplicate-primary-fpr.txt" <<EOF
pub:::::::::
fpr:::::::::${PRIMARY}:
fpr:::::::::${PRIMARY}:
EOF
if docker_debian_primary_fingerprint_from_colons "${TMP}/duplicate-primary-fpr.txt" >/dev/null; then fail "duplicate primary fingerprint was accepted"; fi
cat > "${TMP}/sub-before-primary.txt" <<EOF
sub:::::::::
fpr:::::::::${SUBKEY}:
pub:::::::::
fpr:::::::::${PRIMARY}:
EOF
if docker_debian_primary_fingerprint_from_colons "${TMP}/sub-before-primary.txt" >/dev/null; then fail "subkey before primary key was accepted"; fi

: > "${TMP}/audit"
printf '%s\n' 'docker-ce|ii |1.0' 'old-package|rc |0.1' > "${TMP}/packages"
docker_debian_dpkg_state_clean "${TMP}/audit" "${TMP}/packages" || fail "clean dpkg state was rejected"
printf 'pending configuration\n' > "${TMP}/audit"
if docker_debian_dpkg_state_clean "${TMP}/audit" "${TMP}/packages"; then fail "dpkg audit output was ignored"; fi
: > "${TMP}/audit"
printf 'broken|iF |1.0\n' > "${TMP}/packages"
if docker_debian_dpkg_state_clean "${TMP}/audit" "${TMP}/packages"; then fail "broken dpkg state was accepted"; fi

printf 'sl\n' > "${TMP}/requested"
printf '%s\n' sl libncurses6 > "${TMP}/allowed"
printf '%s\n' 'base-files|ii |13' > "${TMP}/installed"
docker_debian_parse_simulation \
  "${ROOT}/test-system/fixtures/apt-simulation-new-dependency.txt" \
  "${TMP}/requested" "${TMP}/allowed" "${TMP}/installed" "${TMP}/accepted" \
  || fail "approved dependency closure was rejected"
printf 'libncurses6|ii |old\n' > "${TMP}/installed"
if docker_debian_parse_simulation \
  "${ROOT}/test-system/fixtures/apt-simulation-new-dependency.txt" \
  "${TMP}/requested" "${TMP}/allowed" "${TMP}/installed" "${TMP}/accepted"; then
  fail "installed dependency modification was accepted"
fi
printf '%s\n' sl libncurses6 unrelated-agent > "${TMP}/allowed"
: > "${TMP}/installed"
if docker_debian_parse_simulation \
  "${ROOT}/test-system/fixtures/apt-simulation-unrelated-package.txt" \
  "${TMP}/requested" "${TMP}/allowed" "${TMP}/installed" "${TMP}/accepted"; then
  fail "unrelated package installation was accepted"
fi

for path in "${ROOT}/scripts/docker-host.sh" "${ROOT}/scripts/docker-host-debian.sh"; do
  ! grep -Eqi 'data-root|/var/lib/docker|/var/lib/containerd|daemon\.json|containerd/config\.toml|\brsync\b' "${path}" \
    || fail "forbidden Docker state migration or configuration logic found in ${path}"
done

grep -Fq '/usr/bin/docker|--version|' "${ROOT}/scripts/docker-host.sh" || fail "supported daemon-independent Docker CLI probe is missing"
! grep -Fq 'version|--client' "${ROOT}/scripts/docker-host.sh" || fail "unsupported docker version --client probe remains"
grep -Fq 'GNUPGHOME="${home}"' "${ROOT}/scripts/docker-host-debian.sh" || fail "isolated GnuPG home is missing"
grep -Fq 'docker_debian_recover_key_stage' "${ROOT}/scripts/docker-host-debian.sh" || fail "managed key recovery is missing"
grep -Fq 'docker_debian_recover_source_stage' "${ROOT}/scripts/docker-host-debian.sh" || fail "managed source recovery is missing"
grep -Fq 'docker_debian_candidate_is_unambiguously_official' "${ROOT}/scripts/docker-host-debian.sh" || fail "candidate-origin validation is missing"

printf 'Docker repository-safe helper tests passed\n'
