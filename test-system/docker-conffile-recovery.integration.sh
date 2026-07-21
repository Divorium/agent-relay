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
Description: real dpkg conffile regression fixture
EOF_CONTROL
  printf '/etc/containerd/config.toml\n' > "${package_root}/DEBIAN/conffiles"
  printf '%s\n' "${content}" > "${package_root}/etc/containerd/config.toml"
  chmod 0644 "${package_root}/DEBIAN/control" "${package_root}/DEBIAN/conffiles" "${package_root}/etc/containerd/config.toml"
  /usr/bin/dpkg-deb --root-owner-group --build "${package_root}" "${output}" >/dev/null
}

build_package 1.0 package-v1 "${DPKG_ROOT}/containerd-v1.deb"
build_package 2.0 package-v2 "${DPKG_ROOT}/containerd-v2.deb"
/usr/bin/dpkg --force-not-root --root="${DPKG_TARGET}" --admindir="${DPKG_ADMIN}" \
  --log="${DPKG_ROOT}/dpkg.log" --force-confdef --force-confold -i "${DPKG_ROOT}/containerd-v1.deb" >/dev/null

docker_host_containerd_content > "${DOCKER_HOST_CONTAINERD_CONFIG}"
managed_content="$(cat "${DOCKER_HOST_CONTAINERD_CONFIG}")"
/usr/bin/dpkg --force-not-root --root="${DPKG_TARGET}" --admindir="${DPKG_ADMIN}" \
  --log="${DPKG_ROOT}/dpkg.log" --force-confdef --force-confold -i "${DPKG_ROOT}/containerd-v2.deb" >/dev/null

artifact=${DOCKER_HOST_CONTAINERD_CONFIG}.dpkg-dist
[[ -f "${artifact}" ]] || fail "real dpkg upgrade did not create config.toml.dpkg-dist"
[[ "$(cat "${DOCKER_HOST_CONTAINERD_CONFIG}")" == "${managed_content}" ]] \
  || fail "real dpkg upgrade replaced the managed config.toml"

/usr/bin/install -d -m 0711 "${DOCKER_HOST_STORAGE_ROOT}"
/usr/bin/install -d -m 0700 "${DOCKER_HOST_ENGINE_ROOT}" "${DOCKER_HOST_CONTAINERD_ROOT}"
/usr/bin/install -d -m 0755 "${DOCKER_HOST_DAEMON_DIRECTORY}"
docker_host_daemon_content > "${DOCKER_HOST_DAEMON_CONFIG}"
chmod 0644 "${DOCKER_HOST_DAEMON_CONFIG}"

docker_debian_remove_containerd_dpkg_dist
docker_host_validate_storage_and_configuration
[[ ! -e "${artifact}" && ! -L "${artifact}" ]] \
  || fail "real config.toml.dpkg-dist was not removed"
[[ "$(cat "${DOCKER_HOST_CONTAINERD_CONFIG}")" == "${managed_content}" ]] \
  || fail "cleanup changed the managed config.toml"

printf 'arbitrary discarded package content\n' > "${artifact}"
chmod 0644 "${artifact}"
printf 'unmanaged\n' > "${DOCKER_HOST_CONTAINERD_DIRECTORY}/rogue.conf"
chmod 0644 "${DOCKER_HOST_CONTAINERD_DIRECTORY}/rogue.conf"
docker_debian_remove_containerd_dpkg_dist
set +e
(docker_host_validate_storage_and_configuration) 2> "${TMP}/rogue.err"
rogue_status=$?
set -e
(( rogue_status == 1 )) || fail "unmanaged containerd entry was accepted"
[[ ! -e "${artifact}" && ! -L "${artifact}" ]] \
  || fail "arbitrary config.toml.dpkg-dist was not removed"
[[ -f "${DOCKER_HOST_CONTAINERD_DIRECTORY}/rogue.conf" ]] \
  || fail "cleanup removed an unrelated containerd entry"
grep -Fxq 'Docker provisioning failed in phase configuration: containerd configuration directory contains unmanaged entries' \
  "${TMP}/rogue.err" \
  || fail "unrelated entry did not retain strict directory validation"

printf 'Docker real dpkg conffile recovery integration passed\n'
