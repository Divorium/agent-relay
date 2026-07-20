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

[[ "$(docker_host_daemon_content)" == $'{\n  "data-root": "/srv/github-runner/storage/docker/engine"\n}' ]] \
  || fail "managed Docker configuration content is wrong"
[[ "$(docker_host_containerd_content)" == $'version = 2\nroot = "/srv/github-runner/storage/docker/containerd"' ]] \
  || fail "managed containerd configuration content is wrong"
mkdir -p "${TMP}/empty" "${TMP}/populated"
printf 'state\n' > "${TMP}/populated/entry"
docker_host_directory_empty "${TMP}/empty" || fail "empty managed directory was rejected"
if docker_host_directory_empty "${TMP}/populated"; then fail "populated unmanaged directory was accepted"; fi
ln -s "${TMP}/missing" "${TMP}/dangling-directory"
if docker_host_directory_empty "${TMP}/dangling-directory"; then fail "dangling data-root link was treated as absent"; fi

DOCKER_HOST_RUNNER_HOME=${TMP}/runner-home
mkdir -p "${DOCKER_HOST_RUNNER_HOME}/.docker/cli-plugins"
docker_host_local_plugin_overrides_absent || fail "empty local plugin state was rejected"
printf '#!/bin/sh\n' > "${DOCKER_HOST_RUNNER_HOME}/.docker/cli-plugins/docker-compose"
if docker_host_local_plugin_overrides_absent; then fail "user Compose plugin shadowing was accepted"; fi
rm "${DOCKER_HOST_RUNNER_HOME}/.docker/cli-plugins/docker-compose"
printf '{}\n' > "${DOCKER_HOST_RUNNER_HOME}/.docker/config.json"
if docker_host_local_plugin_overrides_absent; then fail "user Docker CLI configuration was accepted"; fi
rm "${DOCKER_HOST_RUNNER_HOME}/.docker/config.json"
ln -s "${TMP}/missing-plugin" "${DOCKER_HOST_RUNNER_HOME}/.docker/cli-plugins/docker-buildx"
if docker_host_local_plugin_overrides_absent; then fail "dangling user plugin shadow was accepted"; fi
rm "${DOCKER_HOST_RUNNER_HOME}/.docker/cli-plugins/docker-buildx"

DOCKER_HOST_UNIT_ROOTS=("${TMP}/units-etc" "${TMP}/units-run")
mkdir -p "${DOCKER_HOST_UNIT_ROOTS[@]}"
docker_host_direct_unit_state_absent || fail "empty direct unit state was rejected"
printf '[Unit]\n' > "${DOCKER_HOST_UNIT_ROOTS[1]}/docker.service"
if docker_host_direct_unit_state_absent; then fail "direct Docker unit leftover was accepted"; fi
rm "${DOCKER_HOST_UNIT_ROOTS[1]}/docker.service"
mkdir "${DOCKER_HOST_UNIT_ROOTS[0]}/containerd.service.d"
if docker_host_direct_unit_state_absent; then fail "direct containerd drop-in leftover was accepted"; fi
rm -rf "${DOCKER_HOST_UNIT_ROOTS[0]}/containerd.service.d"
ln -s "${TMP}/missing-unit" "${DOCKER_HOST_UNIT_ROOTS[0]}/docker.socket"
if docker_host_direct_unit_state_absent; then fail "dangling Docker unit was accepted"; fi
rm "${DOCKER_HOST_UNIT_ROOTS[0]}/docker.socket"

unit_enable=${TMP}/enable-units
unit_package=${TMP}/package-units
mkdir -p "${unit_enable}/multi-user.target.wants" "${unit_enable}/sockets.target.wants" "${unit_package}"
printf '[Unit]\n' > "${unit_package}/docker.service"
printf '[Unit]\n' > "${unit_package}/docker.socket"
printf '[Unit]\n' > "${unit_package}/containerd.service"
DOCKER_HOST_ENABLE_ROOT=${unit_enable}
DOCKER_HOST_UNIT_ROOTS=("${unit_enable}" "${unit_package}")
DOCKER_HOST_OVERRIDE_UNIT_ROOTS=("${unit_enable}")
DOCKER_HOST_PACKAGE_UNIT_ROOTS=("${unit_package}")
docker_debian_command_owner() { [[ "$1" == *containerd.service ]] && printf 'containerd.io\n' || printf 'docker-ce\n'; }
ln -s "${unit_package}/containerd.service" "${unit_enable}/multi-user.target.wants/containerd.service"
docker_host_activation_links_validate subset || fail "exact partial activation link was rejected"
if docker_host_activation_links_validate exact; then fail "partial activation links were accepted as complete"; fi
ln -s "${unit_package}/docker.service" "${unit_enable}/multi-user.target.wants/docker.service"
ln -s "${unit_package}/docker.socket" "${unit_enable}/sockets.target.wants/docker.socket"
docker_host_activation_links_validate exact || fail "exact managed activation links were rejected"
mkdir "${unit_enable}/multi-user.target.requires"
ln -s "${unit_package}/docker.service" "${unit_enable}/multi-user.target.requires/docker.service"
if docker_host_activation_links_validate exact; then fail "unexpected additional activation link was accepted"; fi
rm -rf "${unit_enable}/multi-user.target.requires"
rm "${unit_enable}/sockets.target.wants/docker.socket"
printf 'not-a-link\n' > "${unit_enable}/sockets.target.wants/docker.socket"
if docker_host_activation_links_validate subset; then fail "non-symlink activation entry was accepted"; fi

for active_mask in 1 2 3 4 5 6 7; do
  [[ "$(docker_host_service_recovery_action "$((active_mask & 1))" "$(((active_mask >> 1) & 1))" "$(((active_mask >> 2) & 1))")" == stop-all ]] \
    || fail "partial activation combination ${active_mask} was not normalized"
done
[[ "$(docker_host_service_recovery_action 0 0 0)" == none ]] || fail "inactive services requested recovery"

DOCKER_HOST_DEFAULT_ENGINE_ROOT=${TMP}/default-docker
DOCKER_HOST_DEFAULT_CONTAINERD_ROOT=${TMP}/default-containerd
mkdir "${DOCKER_HOST_DEFAULT_ENGINE_ROOT}" "${DOCKER_HOST_DEFAULT_CONTAINERD_ROOT}"
printf 'state\n' > "${DOCKER_HOST_DEFAULT_ENGINE_ROOT}/state"
if docker_host_directory_empty "${DOCKER_HOST_DEFAULT_ENGINE_ROOT}"; then fail "populated default Docker data was accepted"; fi
rm "${DOCKER_HOST_DEFAULT_ENGINE_ROOT}/state"
docker_host_remove_empty_default_data
[[ ! -e "${DOCKER_HOST_DEFAULT_ENGINE_ROOT}" && ! -e "${DOCKER_HOST_DEFAULT_CONTAINERD_ROOT}" ]] \
  || fail "empty default data directories were not removed before activation"

[[ "$(docker_host_membership_actions 0 0)" == add-runner ]] || fail "runner membership action missing"
[[ "$(docker_host_membership_actions 1 1)" == remove-builder ]] || fail "builder removal action missing"
[[ -z "$(docker_host_membership_actions 1 0)" ]] || fail "idempotent memberships emitted actions"

docker_host_client_environment "${TMP}/runner-client"
[[ " ${DOCKER_HOST_CLIENT_ENVIRONMENT[*]} " == *" HOME=${TMP}/runner-client "* ]] || fail "client HOME missing"
[[ " ${DOCKER_HOST_CLIENT_ENVIRONMENT[*]} " == *" DOCKER_CONFIG=${TMP}/runner-client "* ]] || fail "client DOCKER_CONFIG missing"
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
printf 'docker-ce|1.0\n' > "${TMP}/transaction-packages"
printf '%s\n' 'docker-ce|iF |1.0' 'man-db|it |2.12' 'libc-bin|iW |2.41' > "${TMP}/trigger-packages"
docker_debian_recovery_dpkg_state_allowed "${TMP}/trigger-packages" "${TMP}/transaction-packages" \
  || fail "owned transaction trigger states were rejected"
printf '%s\n' 'docker-ce|iF |1.0' 'unrelated|iF |9' > "${TMP}/trigger-packages"
if docker_debian_recovery_dpkg_state_allowed "${TMP}/trigger-packages" "${TMP}/transaction-packages"; then
  fail "unrelated half-configured package was accepted during recovery"
fi

printf 'sl|5.02-1+b1\n' > "${TMP}/requested"
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

printf '%s\n' 'docker-ce|1' 'docker-ce-cli|1' > "${TMP}/closure-requested"
printf '%s\n' 'docker-ce|1' 'docker-ce-cli|1' 'libgood|1' > "${TMP}/closure-selected"
printf '%s\n' \
  'docker-ce|1|libgood' \
  'docker-ce-cli|1|libalternative' \
  'docker-ce-cli|1|libgood' > "${TMP}/closure-edges"
docker_debian_selected_dependency_closure \
  "${TMP}/closure-requested" "${TMP}/closure-selected" "${TMP}/closure-edges" \
  || fail "valid selected dependency closure was rejected"
printf '%s\n' 'docker-ce|1' 'docker-ce-cli|1' 'libgood|1' 'libalternative|1' > "${TMP}/closure-selected"
if docker_debian_selected_dependency_closure \
  "${TMP}/closure-requested" "${TMP}/closure-selected" "${TMP}/closure-edges"; then
  fail "unselected dependency alternative was accepted"
fi
printf '%s\n' 'docker-ce|1' 'docker-ce-cli|1' 'unrelated|1' > "${TMP}/closure-selected"
if docker_debian_selected_dependency_closure \
  "${TMP}/closure-requested" "${TMP}/closure-selected" "${TMP}/closure-edges"; then
  fail "unrelated selected package was accepted"
fi

printf '%s\n' \
  'Type:          io.containerd.metadata.v1' \
  'ID:            bolt' \
  'Platforms:     -' \
  'Exports:' \
  '               root      /srv/github-runner/storage/docker/containerd/io.containerd.metadata.v1.bolt' \
  '' \
  'Type:          io.containerd.snapshotter.v1' \
  'ID:            overlayfs' \
  'Exports:' \
  '               root      /srv/github-runner/storage/docker/containerd/io.containerd.snapshotter.v1.overlayfs' \
  > "${TMP}/ctr-plugins"
docker_host_containerd_metadata_root_exact "${TMP}/ctr-plugins" /srv/github-runner/storage/docker/containerd \
  || fail "supported ctr plugins ls -d output was rejected"
printf '%s\n' \
  'Type:          io.containerd.metadata.v1' \
  'ID:            bolt' \
  'Exports:' \
  '               root      /var/lib/containerd/io.containerd.metadata.v1.bolt' \
  > "${TMP}/ctr-plugins"
if docker_host_containerd_metadata_root_exact "${TMP}/ctr-plugins" /srv/github-runner/storage/docker/containerd; then
  fail "default containerd metadata root was accepted"
fi
docker_host_ctr_command
[[ " ${DOCKER_HOST_CTR_COMMAND[*]} " == *' /usr/bin/timeout --signal=TERM --kill-after=2s 10s /usr/bin/env -i '* ]] \
  || fail "ctr inspection is not bounded and environment-clean"
[[ " ${DOCKER_HOST_CTR_COMMAND[*]} " == *' /usr/bin/ctr --address /run/containerd/containerd.sock plugins ls -d '* ]] \
  || fail "ctr inspection does not use the explicit local socket"

shadow_java=${TMP}/shadow-java
shadow_go=${TMP}/shadow-go
shadow_rust=${TMP}/shadow-rust
mkdir "${shadow_java}" "${shadow_go}" "${shadow_rust}"
printf '#!/bin/sh\n' > "${shadow_java}/docker"
printf '#!/bin/sh\n' > "${shadow_go}/dockerd"
printf '#!/bin/sh\n' > "${shadow_rust}/ctr"
chmod 0755 "${shadow_java}/docker" "${shadow_go}/dockerd" "${shadow_rust}/ctr"
DOCKER_HOST_CODEX_PATH=${shadow_java}:${shadow_go}:${shadow_rust}:/usr/local/bin:/usr/bin:/bin
if docker_host_command_state_absent; then fail "production PATH command shadowing was accepted"; fi
DOCKER_HOST_CODEX_PATH=/opt/java/openjdk/bin:/usr/local/go/bin:/opt/rust/cargo/bin:/usr/local/bin:/usr/bin:/bin
# shellcheck source=scripts/toolchain-environment.sh
source "${ROOT}/scripts/toolchain-environment.sh"
[[ "${DOCKER_HOST_CODEX_PATH}" == "${TOOLCHAIN_PATH}" ]] || fail "Docker validation PATH drifted from Codex's production PATH"

configure_exact_state() {
  DOCKER_HOST_OWNER_UID=$(/usr/bin/id -u)
  DOCKER_HOST_OWNER_GID=$(/usr/bin/id -g)
  DOCKER_HOST_STORAGE_ROOT=${TMP}/managed-storage
  DOCKER_HOST_ENGINE_ROOT=${DOCKER_HOST_STORAGE_ROOT}/engine
  DOCKER_HOST_CONTAINERD_ROOT=${DOCKER_HOST_STORAGE_ROOT}/containerd
  DOCKER_HOST_DAEMON_DIRECTORY=${TMP}/etc-docker
  DOCKER_HOST_CONTAINERD_DIRECTORY=${TMP}/etc-containerd
  DOCKER_HOST_DAEMON_CONFIG=${DOCKER_HOST_DAEMON_DIRECTORY}/daemon.json
  DOCKER_HOST_CONTAINERD_CONFIG=${DOCKER_HOST_CONTAINERD_DIRECTORY}/config.toml
  rm -rf -- "${DOCKER_HOST_STORAGE_ROOT}" "${DOCKER_HOST_DAEMON_DIRECTORY}" "${DOCKER_HOST_CONTAINERD_DIRECTORY}"
  mkdir -m 0711 "${DOCKER_HOST_STORAGE_ROOT}"
  mkdir -m 0700 "${DOCKER_HOST_ENGINE_ROOT}" "${DOCKER_HOST_CONTAINERD_ROOT}"
  mkdir -m 0755 "${DOCKER_HOST_DAEMON_DIRECTORY}" "${DOCKER_HOST_CONTAINERD_DIRECTORY}"
  docker_host_daemon_content > "${DOCKER_HOST_DAEMON_CONFIG}"
  docker_host_containerd_content > "${DOCKER_HOST_CONTAINERD_CONFIG}"
  chmod 0644 "${DOCKER_HOST_DAEMON_CONFIG}" "${DOCKER_HOST_CONTAINERD_CONFIG}"
}

assert_revalidation_blocks_activation() {
  local label="$1"
  : > "${TMP}/service-starts"
  if (docker_host_ensure_membership_and_services() { printf 'started\n' >> "${TMP}/service-starts"; }; docker_host_activate_after_revalidation); then
    fail "post-package ${label} mutation was accepted"
  fi
  [[ ! -s "${TMP}/service-starts" ]] || fail "services started after ${label} mutation"
}

configure_exact_state
docker_host_validate_storage_and_configuration
DOCKER_HOST_MARKER=${TMP}/agent-state/docker-host-state-v1
mkdir -p "$(dirname "${DOCKER_HOST_MARKER}")"
daemon_stage=${DOCKER_HOST_DAEMON_DIRECTORY}/.agent-relay-daemon.json.tmp.safe
docker_host_daemon_content > "${daemon_stage}"
chmod 0644 "${daemon_stage}"
docker_host_validate_publication_stages preparing || fail "exact interrupted configuration stage was rejected"
docker_host_validate_preparing_paths || fail "exact interrupted configuration publication was not restartable"
rm "${daemon_stage}"
mkdir "${daemon_stage}"
if docker_host_validate_publication_stages preparing; then fail "non-regular configuration stage was accepted"; fi
rm -rf "${daemon_stage}"
marker_stage=$(dirname "${DOCKER_HOST_MARKER}")/.agent-relay-docker-host-state-v1.tmp.safe
printf 'schema=1\nphase=preparing\n' > "${marker_stage}"
chmod 0600 "${marker_stage}"
docker_host_validate_publication_stages fresh || fail "exact interrupted marker stage was rejected"
rm "${marker_stage}"
ln -s "${TMP}/missing-marker-stage" "${marker_stage}"
if docker_host_validate_publication_stages fresh; then fail "dangling marker stage was accepted"; fi
rm "${marker_stage}"
printf 'schema=1\nphase=transaction\npackage=docker-ce:1\n' > "${DOCKER_HOST_MARKER}"
chmod 0600 "${DOCKER_HOST_MARKER}"
(
  docker_debian_package_status() {
    [[ "$1" == docker-ce ]] && printf 'iU |1\n' || printf 'not-installed|\n'
  }
  docker_host_validate_phase_packages transaction
) || fail "owned partial transaction package was rejected"
if (
  docker_debian_package_status() {
    case "$1" in docker-ce) printf 'iU |1\n' ;; docker.io) printf 'ii |99\n' ;; *) printf 'not-installed|\n' ;; esac
  }
  docker_host_validate_phase_packages transaction
); then
  fail "new conflicting package bypassed the transaction boundary"
fi
printf 'changed\n' > "${DOCKER_HOST_DAEMON_CONFIG}"
assert_revalidation_blocks_activation daemon-file
configure_exact_state
printf 'changed\n' > "${DOCKER_HOST_CONTAINERD_CONFIG}"
assert_revalidation_blocks_activation containerd-file
configure_exact_state
printf 'extra\n' > "${DOCKER_HOST_DAEMON_DIRECTORY}/extra.json"
assert_revalidation_blocks_activation docker-directory
configure_exact_state
printf 'extra\n' > "${DOCKER_HOST_CONTAINERD_DIRECTORY}/extra.toml"
assert_revalidation_blocks_activation containerd-directory
configure_exact_state
chmod 0755 "${DOCKER_HOST_ENGINE_ROOT}"
assert_revalidation_blocks_activation storage-metadata
configure_exact_state
rm "${DOCKER_HOST_DAEMON_CONFIG}"
if (docker_host_validate_storage_and_configuration); then fail "completed-state corruption was accepted"; fi
[[ ! -e "${DOCKER_HOST_DAEMON_CONFIG}" ]] || fail "completed-state corruption was repaired"

DOCKER_HOST_POLICY=${TMP}/policy-rc.d
docker_host_policy_content > "${DOCKER_HOST_POLICY}"
chmod 0755 "${DOCKER_HOST_POLICY}"
set +e
"${DOCKER_HOST_POLICY}" docker.service start
policy_docker_status=$?
"${DOCKER_HOST_POLICY}" postgresql start
policy_unrelated_status=$?
set -e
(( policy_docker_status == 101 )) || fail "managed policy did not deny Docker activation"
(( policy_unrelated_status == 0 )) || fail "managed policy denied an unrelated package service"
(
  docker_host_services_inactive() { return 0; }
  docker_host_recover_preparing_policy
) || fail "exact preparing policy was not recoverable"
[[ ! -e "${DOCKER_HOST_POLICY}" ]] || fail "exact preparing policy was not removed before restart"
printf 'unexpected\n' > "${DOCKER_HOST_POLICY}"
chmod 0755 "${DOCKER_HOST_POLICY}"
if (docker_host_services_inactive() { return 0; }; docker_host_recover_preparing_policy); then
  fail "non-exact preparing policy was accepted"
fi
[[ -e "${DOCKER_HOST_POLICY}" ]] || fail "non-exact preparing policy was mutated"
docker_host_policy_content > "${DOCKER_HOST_POLICY}"
chmod 0755 "${DOCKER_HOST_POLICY}"
DOCKER_HOST_POLICY_REMOVE_ON_EXIT=1
docker_host_cleanup
[[ ! -e "${DOCKER_HOST_POLICY}" ]] || fail "managed policy survived interruption before phase publication"
docker_host_policy_content > "${DOCKER_HOST_POLICY}"
chmod 0755 "${DOCKER_HOST_POLICY}"
printf 'docker-ce|1\n' > "${TMP}/policy-packages"
: > "${TMP}/phase-publications"
docker_host_publish_marker() {
  [[ ! -e "${DOCKER_HOST_POLICY}" ]] || fail "installed phase published before managed policy removal"
  printf '%s\n' "$1" >> "${TMP}/phase-publications"
}
docker_host_finish_package_transaction "${TMP}/policy-packages"
[[ "$(<"${TMP}/phase-publications")" == installed ]] || fail "installed phase was not published"
[[ ! -e "${DOCKER_HOST_POLICY}" ]] || fail "managed policy survived installed phase publication"
printf '%s\n' sl libncurses6 > "${TMP}/allowed"
: > "${TMP}/installed"
if docker_debian_parse_simulation \
  "${ROOT}/test-system/fixtures/apt-simulation-unrelated-package.txt" \
  "${TMP}/requested" "${TMP}/allowed" "${TMP}/installed" "${TMP}/accepted"; then
  fail "unrelated package installation was accepted"
fi

grep -Fq 'GNUPGHOME="${home}"' "${ROOT}/scripts/docker-host-debian.sh" || fail "isolated GnuPG home is missing"
grep -Fq 'docker_debian_remove_orphan_stages' "${ROOT}/scripts/docker-host-debian.sh" || fail "interrupted publication cleanup is missing"
grep -Fq 'selected_exact+=("${selected_package}=${selected_version}")' "${ROOT}/scripts/docker-host-debian.sh" || fail "resolver-selected packages are not version-pinned"
grep -Fq 'docker_debian_candidate_is_unambiguously_official' "${ROOT}/scripts/docker-host-debian.sh" || fail "candidate-origin validation is missing"

printf 'Docker repository-safe helper tests passed\n'
