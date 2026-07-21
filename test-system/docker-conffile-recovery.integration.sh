#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/agent-relay-dpkg-conffile.XXXXXXXX")"
trap 'chmod -R u+rwx "${TMP}" 2>/dev/null || true; rm -rf -- "${TMP}"' EXIT

fail() {
  printf 'docker-conffile-recovery.integration.sh: %s\n' "$1" >&2
  exit 1
}

for command in dpkg dpkg-deb find grep; do
  command -v "${command}" >/dev/null 2>&1 || fail "missing required command: ${command}"
done

export DOCKER_HOST_LIBRARY_ONLY=1
# shellcheck source=scripts/docker-host.sh
source "${ROOT}/scripts/docker-host.sh"
# shellcheck source=scripts/docker-host-debian.sh
source "${ROOT}/scripts/docker-host-debian.sh"

DOCKER_HOST_STATE_ROOT=${TMP}/state
DOCKER_HOST_STORAGE_ROOT=${TMP}/srv/github-runner/storage/docker
DOCKER_HOST_ENGINE_ROOT=${DOCKER_HOST_STORAGE_ROOT}/engine
DOCKER_HOST_CONTAINERD_ROOT=${DOCKER_HOST_STORAGE_ROOT}/containerd
DOCKER_HOST_DAEMON_DIRECTORY=${TMP}/etc/docker
DOCKER_HOST_DAEMON_CONFIG=${DOCKER_HOST_DAEMON_DIRECTORY}/daemon.json
DOCKER_HOST_OWNER_UID=$(/usr/bin/id -u)
DOCKER_HOST_OWNER_GID=$(/usr/bin/id -g)

DPKG_ROOT=${TMP}/dpkg
DPKG_ADMIN=${DPKG_ROOT}/var/lib/dpkg
DPKG_TARGET=${DPKG_ROOT}/root
DOCKER_HOST_CONTAINERD_DIRECTORY=${DPKG_TARGET}/etc/containerd
DOCKER_HOST_CONTAINERD_CONFIG=${DOCKER_HOST_CONTAINERD_DIRECTORY}/config.toml
DOCKER_HOST_MARKER=${TMP}/docker-host-state-v1

mkdir -p "${DOCKER_HOST_STATE_ROOT}" "${DPKG_ADMIN}/updates" "${DPKG_TARGET}"
: > "${DPKG_ADMIN}/status"

build_package() {
  local version="$1" content="$2" output="$3" package_root
  package_root=${DPKG_ROOT}/package-${version}
  mkdir -p "${package_root}/DEBIAN" "${package_root}/etc/containerd"
  chmod 0755 "${package_root}" "${package_root}/DEBIAN" "${package_root}/etc" "${package_root}/etc/containerd"
  cat > "${package_root}/DEBIAN/control" <<EOF_CONTROL
Package: containerd.io
Version: ${version}
Section: misc
Priority: optional
Architecture: all
Maintainer: Agent Relay Test <test@example.invalid>
Description: real interrupted dpkg conffile regression fixture
EOF_CONTROL
  printf '/etc/containerd/config.toml\n' > "${package_root}/DEBIAN/conffiles"
  printf '%s\n' "${content}" > "${package_root}/etc/containerd/config.toml"
  chmod 0644 "${package_root}/DEBIAN/control" "${package_root}/DEBIAN/conffiles" "${package_root}/etc/containerd/config.toml"
  /usr/bin/dpkg-deb --root-owner-group --build "${package_root}" "${output}" >/dev/null
}

build_package 1.0 package-v1 "${DPKG_ROOT}/containerd-v1.deb"
build_package 2.0 package-v2 "${DPKG_ROOT}/containerd-v2.deb"
/usr/bin/dpkg --force-not-root --root="${DPKG_TARGET}" --admindir="${DPKG_ADMIN}" \
  --log="${DPKG_ROOT}/dpkg.log" -i "${DPKG_ROOT}/containerd-v1.deb" >/dev/null

docker_host_containerd_content > "${DOCKER_HOST_CONTAINERD_CONFIG}"
managed_content="$(cat "${DOCKER_HOST_CONTAINERD_CONFIG}")"
set +e
printf '' | /usr/bin/dpkg --force-not-root --root="${DPKG_TARGET}" --admindir="${DPKG_ADMIN}" \
  --log="${DPKG_ROOT}/dpkg.log" -i "${DPKG_ROOT}/containerd-v2.deb" \
  > "${TMP}/interrupted.out" 2> "${TMP}/interrupted.err"
interrupted_status=$?
set -e
(( interrupted_status != 0 )) || fail "unforced conffile upgrade unexpectedly succeeded"
grep -Fq 'end of file on stdin at conffile prompt' "${TMP}/interrupted.err" \
  || fail "interrupted fixture did not reproduce the runner conffile failure"
[[ -f "${DOCKER_HOST_CONTAINERD_CONFIG}.dpkg-new" ]] \
  || fail "interrupted dpkg upgrade did not leave config.toml.dpkg-new"

/usr/bin/dpkg --force-not-root --root="${DPKG_TARGET}" --admindir="${DPKG_ADMIN}" \
  --log="${DPKG_ROOT}/dpkg.log" --force-confdef --force-confold --configure -a >/dev/null
[[ -f "${DOCKER_HOST_CONTAINERD_CONFIG}.dpkg-dist" ]] \
  || fail "real recovery did not create config.toml.dpkg-dist"
[[ "$(cat "${DOCKER_HOST_CONTAINERD_CONFIG}")" == "${managed_content}" ]] \
  || fail "real recovery replaced the managed config.toml"

# Repeated interrupted package attempts can accumulate other dpkg sidecars.
for suffix in new old tmp; do
  printf 'stale-%s\n' "${suffix}" > "${DOCKER_HOST_CONTAINERD_CONFIG}.dpkg-${suffix}"
  chmod 0644 "${DOCKER_HOST_CONTAINERD_CONFIG}.dpkg-${suffix}"
done

/usr/bin/install -d -m 0711 "${DOCKER_HOST_STORAGE_ROOT}"
/usr/bin/install -d -m 0700 "${DOCKER_HOST_ENGINE_ROOT}" "${DOCKER_HOST_CONTAINERD_ROOT}"
/usr/bin/install -d -m 0755 "${DOCKER_HOST_DAEMON_DIRECTORY}"
docker_host_daemon_content > "${DOCKER_HOST_DAEMON_CONFIG}"
chmod 0644 "${DOCKER_HOST_DAEMON_CONFIG}"

# Use the production clean-state boundary, not the cleanup helper directly.
docker_debian_assert_clean_dpkg
for artifact in "${DOCKER_HOST_CONTAINERD_CONFIG}.dpkg-"*; do
  [[ ! -e "${artifact}" && ! -L "${artifact}" ]] \
    || fail "production boundary left a dpkg sidecar: ${artifact}"
done
docker_host_validate_storage_and_configuration
[[ "$(cat "${DOCKER_HOST_CONTAINERD_CONFIG}")" == "${managed_content}" ]] \
  || fail "cleanup changed the managed config.toml"

# The transaction boundary must perform the same cleanup.
printf '%s\n' 'schema=1' 'phase=transaction' 'package=containerd.io:2.0' > "${DOCKER_HOST_MARKER}"
printf 'again\n' > "${DOCKER_HOST_CONTAINERD_CONFIG}.dpkg-new"
docker_debian_assert_recovery_dpkg_bounded
[[ ! -e "${DOCKER_HOST_CONTAINERD_CONFIG}.dpkg-new" ]] \
  || fail "transaction boundary left config.toml.dpkg-new"

printf 'unmanaged\n' > "${DOCKER_HOST_CONTAINERD_DIRECTORY}/rogue.conf"
chmod 0644 "${DOCKER_HOST_CONTAINERD_DIRECTORY}/rogue.conf"
set +e
(
  docker_debian_assert_clean_dpkg
  docker_host_validate_storage_and_configuration
) 2> "${TMP}/rogue.err"
rogue_status=$?
set -e
(( rogue_status == 1 )) || fail "unmanaged containerd entry was accepted"
[[ -f "${DOCKER_HOST_CONTAINERD_DIRECTORY}/rogue.conf" ]] \
  || fail "cleanup removed an unrelated containerd entry"
grep -Fq "Unmanaged containerd configuration entry remains: ${DOCKER_HOST_CONTAINERD_DIRECTORY}/rogue.conf" \
  "${TMP}/rogue.err" \
  || fail "diagnostic did not identify the actual unmanaged entry"
grep -Fxq 'Docker provisioning failed in phase configuration: containerd configuration directory contains unmanaged entries' \
  "${TMP}/rogue.err" \
  || fail "unrelated entry did not retain strict directory validation"

printf 'Docker interrupted dpkg conffile recovery integration passed\n'
