#!/usr/bin/env bash
set -euo pipefail

script_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repository_root="$(cd -- "${script_root}/.." && pwd -P)"
source "${script_root}/host-config.sh"
host_config_load "${repository_root}/config/runner-host.json"
source "${script_root}/toolchain-environment.sh"

state_root="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:?TMPDIR is required when RUNNER_TEMP is unset}}/agent-relay-toolchain.XXXXXX")"
cleanup() {
  rm -rf -- "${state_root}"
}
trap cleanup EXIT

for state_directory in "${TOOLCHAIN_STATE_SUBDIRECTORIES[@]}"; do
  mkdir -m 0700 -- "${state_root}/${state_directory}"
done

declare -a toolchain_environment
toolchain_environment_build "$(id -un)" "${HOME:?HOME is required}" "${state_root}" toolchain_environment

/usr/bin/env -i \
  "${toolchain_environment[@]}" \
  EXPECTED_NODE_MAJOR="${NODE_MAJOR}" \
  EXPECTED_JAVA_MAJOR="${JAVA_MAJOR}" \
  EXPECTED_TYPESCRIPT_VERSION="${TYPESCRIPT_VERSION}" \
  EXPECTED_GO_VERSION="${GO_VERSION}" \
  EXPECTED_RUST_TOOLCHAIN="${RUST_TOOLCHAIN}" \
  "EXPECTED_TOOLCHAIN_STATE_ROOT=${state_root}" \
  "${script_root}/toolchain-smoke.sh"
