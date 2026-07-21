#!/usr/bin/env bash
set -euo pipefail

script_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
toolchain_profile="${script_root}/toolchain-environment.sh"
if [[ ! -f "${toolchain_profile}" || -L "${toolchain_profile}" ]]; then
  echo "Toolchain environment must be a regular non-symlink file" >&2
  exit 1
fi
source "${toolchain_profile}"

: "${EXPECTED_TOOLCHAIN_STATE_ROOT:?EXPECTED_TOOLCHAIN_STATE_ROOT is required}"
toolchain_validate_absolute_path 'expected toolchain state root' "${EXPECTED_TOOLCHAIN_STATE_ROOT}"

declare -a expected_environment
toolchain_environment_build \
  "${USER:?USER is required}" \
  "${HOME:?HOME is required}" \
  "${EXPECTED_TOOLCHAIN_STATE_ROOT}" \
  expected_environment
for assignment in "${expected_environment[@]}"; do
  key="${assignment%%=*}"
  expected_value="${assignment#*=}"
  actual_value="${!key-}"
  [[ "${actual_value}" == "${expected_value}" ]] || {
    echo "Unexpected ${key}: ${actual_value}" >&2
    exit 1
  }
done
for state_directory in "${TOOLCHAIN_STATE_SUBDIRECTORIES[@]}"; do
  state_path="${EXPECTED_TOOLCHAIN_STATE_ROOT}/${state_directory}"
  [[ -d "${state_path}" && -w "${state_path}" ]] || {
    echo "Toolchain state directory must be writable: ${state_path}" >&2
    exit 1
  }
done

TOOLCHAIN_JAVA_HOME="${TOOLCHAIN_JAVA_HOME}" \
TOOLCHAIN_GO_ROOT="${TOOLCHAIN_GO_ROOT}" \
TOOLCHAIN_RUST_BIN="${TOOLCHAIN_RUST_BIN}" \
TOOLCHAIN_RUSTUP_HOME="${TOOLCHAIN_RUSTUP_HOME}" \
TOOLCHAIN_RUST_CARGO_HOME="${TOOLCHAIN_RUST_CARGO_HOME}" \
"${script_root}/host-toolchain-check.sh"

codex --ask-for-approval never exec --help >/dev/null
smoke_root="$(/usr/bin/mktemp -d "${TMPDIR}/agent-relay-smoke.XXXXXX")"
cleanup_smoke() {
  /usr/bin/rm -rf -- "${smoke_root}"
}
trap cleanup_smoke EXIT

codex \
  --ask-for-approval never \
  -c 'features.memories=false' \
  -c 'default_permissions="agent"' \
  -c 'permissions.agent.extends=":workspace"' \
  -c "permissions.agent.filesystem={\"/tmp\"=\"deny\",\"${smoke_root}\"=\"write\"}" \
  -c 'permissions.agent.network.enabled=true' \
  exec --cd "${smoke_root}" --help >/dev/null

codex \
  --ask-for-approval never \
  -c "projects={\"${smoke_root}\"={trust_level=\"trusted\"}}" \
  exec --cd "${smoke_root}" --help >/dev/null
