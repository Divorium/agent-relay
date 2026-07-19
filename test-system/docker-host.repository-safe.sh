#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
test_root="$(mktemp -d)"
cleanup() { rm -rf -- "${test_root}"; }
trap cleanup EXIT

export DOCKER_HOST_LIBRARY_ONLY=1
source "${repository_root}/scripts/docker-host.sh"
source "${repository_root}/scripts/docker-host-debian.sh"

write_records() {
  local core="$1" buildx="$2" compose="$3" compatibility="${4:-0}" file="$5" package
  : > "${file}"
  for package in "${DOCKER_DEBIAN_CONFLICTS[@]}"; do printf 'conflict:%s|not-installed|0\n' "${package}" >> "${file}"; done
  for package in "${DOCKER_DEBIAN_CORE_PACKAGES[@]}"; do printf '%s|%s|%s\n' "${package}" "${core}" "${compatibility}" >> "${file}"; done
  printf 'docker-buildx-plugin|%s|%s\n' "${buildx}" "${compatibility}" >> "${file}"
  printf 'docker-compose-plugin|%s|%s\n' "${compose}" "${compatibility}" >> "${file}"
}

# Fresh classification requests exactly the five official packages.
write_records not-installed not-installed not-installed 0 "${test_root}/fresh"
docker_host_classify_records "${test_root}/fresh"
test "${DOCKER_HOST_CLASSIFICATION}" = fresh
test "${#DOCKER_HOST_MISSING[@]}" -eq 5
test "${DOCKER_HOST_MISSING[*]}" = 'docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin'

# A complete compatible installation is a no-op for package selection, while
# either missing plugin selects only that plugin. This is also the repeated-run
# no-registry decision: hello-world is tied only to DOCKER_HOST_FRESH.
write_records 'ii ' 'ii ' 'ii ' 0 "${test_root}/complete"
docker_host_classify_records "${test_root}/complete"
test "${DOCKER_HOST_CLASSIFICATION}" = complete-compatible
test "${#DOCKER_HOST_MISSING[@]}" -eq 0
test "${DOCKER_HOST_FRESH}" -eq 1 # classification itself never widens this execution flag
DOCKER_HOST_FRESH=0
write_records 'ii ' not-installed 'ii ' 0 "${test_root}/missing-buildx"
docker_host_classify_records "${test_root}/missing-buildx"
test "${DOCKER_HOST_CLASSIFICATION}" = missing-plugin
test "${DOCKER_HOST_MISSING[*]}" = docker-buildx-plugin
write_records 'ii ' 'ii ' not-installed 0 "${test_root}/missing-compose"
docker_host_classify_records "${test_root}/missing-compose"
test "${DOCKER_HOST_MISSING[*]}" = docker-compose-plugin

# Conflicts, partial package states, broken commands, and unknown ownership are
# rejected by the same production classifier before apt mutation.
write_records 'ii ' 'ii ' 'ii ' 2 "${test_root}/broken"
if docker_host_classify_records "${test_root}/broken"; then echo 'broken command state accepted' >&2; exit 1; fi
write_records 'iU ' 'ii ' 'ii ' 0 "${test_root}/partial"
if docker_host_classify_records "${test_root}/partial"; then echo 'partial package state accepted' >&2; exit 1; fi
cp "${test_root}/complete" "${test_root}/conflict"
sed -i '1s/not-installed/ii /' "${test_root}/conflict"
if docker_host_classify_records "${test_root}/conflict"; then echo 'conflicting package accepted' >&2; exit 1; fi

# Dirty global dpkg state is rejected without recovery behavior.
: > "${test_root}/audit-clean"
printf 'docker-ce|ii |1\n' > "${test_root}/packages-clean"
docker_debian_dpkg_state_clean "${test_root}/audit-clean" "${test_root}/packages-clean"
printf 'pending configuration\n' > "${test_root}/audit-dirty"
if docker_debian_dpkg_state_clean "${test_root}/audit-dirty" "${test_root}/packages-clean"; then echo 'dirty dpkg audit accepted' >&2; exit 1; fi
printf 'docker-ce|iU |1\n' > "${test_root}/packages-dirty"
if docker_debian_dpkg_state_clean "${test_root}/audit-clean" "${test_root}/packages-dirty"; then echo 'partial dpkg package accepted' >&2; exit 1; fi

# Apt simulation accepts only requested packages and their dependency closure.
fixture_root=${repository_root}/test-system/fixtures
printf 'sl\n' > "${test_root}/requested"
printf 'sl\nlibncurses6\n' > "${test_root}/allowed"
: > "${test_root}/installed"
docker_debian_parse_simulation "${fixture_root}/apt-simulation-new-dependency.txt" "${test_root}/requested" "${test_root}/allowed" "${test_root}/installed" "${test_root}/accepted"
grep -Fxq sl "${test_root}/accepted"
grep -Fxq libncurses6 "${test_root}/accepted"
if docker_debian_parse_simulation "${fixture_root}/apt-simulation-unrelated-package.txt" "${test_root}/requested" "${test_root}/allowed" "${test_root}/installed" "${test_root}/rejected"; then echo 'unapproved apt package accepted' >&2; exit 1; fi
printf 'libncurses6|ii |old\n' > "${test_root}/installed"
if docker_debian_parse_simulation "${fixture_root}/apt-simulation-new-dependency.txt" "${test_root}/requested" "${test_root}/allowed" "${test_root}/installed" "${test_root}/rejected"; then echo 'installed dependency change accepted' >&2; exit 1; fi

# Compatible official apt definitions are accepted; duplicate, conflicting,
# and insecure definitions are rejected.
DOCKER_DEBIAN_CODENAME=trixie
test "$(docker_debian_parse_list_source "${fixture_root}/docker-source-compatible.list")" = 'compatible|/etc/apt/keyrings/docker.gpg'
test "$(docker_debian_parse_deb822_source "${fixture_root}/docker-source-compatible.sources")" = 'compatible|/etc/apt/keyrings/docker.asc'
test "$(docker_debian_parse_list_source "${fixture_root}/docker-source-insecure.list")" = 'conflicting|/etc/apt/keyrings/docker.gpg'
printf 'compatible|/etc/apt/keyrings/docker.asc\n' > "${test_root}/one-source"
docker_debian_repository_records_acceptable "${test_root}/one-source"
printf 'compatible|/etc/apt/keyrings/docker.asc\ncompatible|/etc/apt/keyrings/docker.asc\n' > "${test_root}/duplicate-source"
if docker_debian_repository_records_acceptable "${test_root}/duplicate-source"; then echo 'duplicate apt source accepted' >&2; exit 1; fi
printf 'conflicting|/etc/apt/keyrings/docker.asc\n' > "${test_root}/bad-source"
if docker_debian_repository_records_acceptable "${test_root}/bad-source"; then echo 'conflicting apt source accepted' >&2; exit 1; fi

# Group decisions grant the runner access and remove it from the builder.
test "$(docker_host_membership_actions 0 0)" = add-runner
test "$(docker_host_membership_actions 1 1)" = remove-builder
test "$(docker_host_membership_actions 0 1)" = $'add-runner\nremove-builder'
test -z "$(docker_host_membership_actions 1 0)"

# Validation always uses a private per-run client directory, a clean
# environment, and the explicit local Unix socket.
docker_host_client_environment "${test_root}/private-client"
test "${DOCKER_HOST_CLIENT_ENVIRONMENT[*]}" = "/usr/bin/env -i HOME=${test_root}/private-client DOCKER_CONFIG=${test_root}/private-client PATH=/usr/bin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8"
grep -Fq -- '--host unix:///var/run/docker.sock' "${repository_root}/scripts/docker-host.sh"

# The production boundary contains no storage migration or configuration
# writer. Sentinel configuration bytes remain unchanged while all decision
# helpers execute.
printf '{"log-driver":"journald"}\n' > "${test_root}/daemon.json"
printf 'version = 2\n' > "${test_root}/config.toml"
sha_before="$(sha256sum "${test_root}/daemon.json" "${test_root}/config.toml")"
docker_host_classify_records "${test_root}/complete"
docker_host_membership_actions 1 0 >/dev/null
test "$(sha256sum "${test_root}/daemon.json" "${test_root}/config.toml")" = "${sha_before}"
if rg -n 'rsync|migration-stage|data-root|/var/lib/docker|/var/lib/containerd|daemon\.json|config\.toml' "${repository_root}/scripts/docker-host.sh" "${repository_root}/scripts/docker-host-debian.sh"; then
  echo 'Docker production source contains storage migration or configuration mutation logic' >&2
  exit 1
fi

printf 'Docker repository-safe tests passed\n'
