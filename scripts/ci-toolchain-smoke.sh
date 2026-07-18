#!/usr/bin/env bash
set -euo pipefail

script_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source "${script_root}/toolchain-environment.sh"

state_root="$(mktemp -d "${RUNNER_TEMP:-/tmp}/agent-relay-toolchain.XXXXXX")"
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
  EXPECTED_TYPESCRIPT_VERSION=5.8.3 \
  EXPECTED_CODEX_VERSION=0.144.4 \
  EXPECTED_GO_VERSION=1.24.5 \
  "EXPECTED_TOOLCHAIN_STATE_ROOT=${state_root}" \
  "${script_root}/toolchain-smoke.sh"
