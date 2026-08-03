#!/usr/bin/env bash
set -euo pipefail

script_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
toolchain_profile="${script_root}/toolchain-environment.sh"
if [[ ! -f "${toolchain_profile}" || -L "${toolchain_profile}" ]]; then
  echo "Toolchain environment must be a regular non-symlink file" >&2
  exit 1
fi
source "${toolchain_profile}"

: "${EXPECTED_NODE_MAJOR:=22}"
: "${EXPECTED_JAVA_MAJOR:=21}"
: "${EXPECTED_RUST_TOOLCHAIN:=stable}"
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

for command in \
  node npm java javac go rustc cargo rustup tsc codex \
  python3 git gcc g++ clang make cmake pkg-config bash curl wget jq \
  zip unzip tar gzip xz zstd file find diff; do
  command -v "${command}" >/dev/null 2>&1 || {
    echo "Required toolchain command is missing: ${command}" >&2
    exit 1
  }
done

for command in npm rustc cargo gcc g++ clang make cmake pkg-config bash curl wget jq zip unzip tar gzip xz zstd file find diff; do
  "${command}" --version >/dev/null 2>&1 || true
done

[[ "$(command -v java)" == "${TOOLCHAIN_JAVA_HOME}/bin/java" ]] || {
  echo 'Managed Java must be first on PATH' >&2
  exit 1
}
[[ "$(command -v go)" == "${TOOLCHAIN_GO_ROOT}/bin/go" ]] || {
  echo 'Managed Go must be first on PATH' >&2
  exit 1
}
[[ "$(command -v rustc)" == "${TOOLCHAIN_RUST_BIN}/rustc" ]] || {
  echo 'Managed Rust must be first on PATH' >&2
  exit 1
}
[[ "$(readlink -f "${TOOLCHAIN_JAVA_HOME}/bin/java")" == "$(readlink -f "$(command -v java)")" ]] || {
  echo 'JAVA_HOME does not match the Java executable' >&2
  exit 1
}

node_version="$(node --version)"
java_version="$(java -version 2>&1 | head -n 1)"
go_version="$(go version)"
tsc_version="$(tsc --version)"

[[ "${node_version}" == v"${EXPECTED_NODE_MAJOR}".* ]] || {
  echo "Node.js ${EXPECTED_NODE_MAJOR} is required: ${node_version}" >&2
  exit 1
}
[[ "${java_version}" == *'version "'"${EXPECTED_JAVA_MAJOR}"'.'* || "${java_version}" == *" ${EXPECTED_JAVA_MAJOR} "* ]] || {
  echo "Java ${EXPECTED_JAVA_MAJOR} is required: ${java_version}" >&2
  exit 1
}
[[ "${go_version}" == "go version go${EXPECTED_GO_VERSION} linux/amd64" ]] || {
  echo "Unexpected Go version: ${go_version}" >&2
  exit 1
}
[[ "${tsc_version}" == "Version ${EXPECTED_TYPESCRIPT_VERSION}" ]] || {
  echo "Unexpected TypeScript version: ${tsc_version}" >&2
  exit 1
}
RUSTUP_HOME="${TOOLCHAIN_RUSTUP_HOME}" CARGO_HOME="${TOOLCHAIN_RUST_CARGO_HOME}" \
  rustup show active-toolchain | grep -Eq "^${EXPECTED_RUST_TOOLCHAIN}(-|[[:space:]])" || {
    echo "Rust ${EXPECTED_RUST_TOOLCHAIN} toolchain is not active" >&2
    exit 1
  }

git lfs version >/dev/null
python3 -m pip --version >/dev/null
python3 -m venv --help >/dev/null

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
