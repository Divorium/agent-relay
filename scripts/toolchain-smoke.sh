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

[[ "$(command -v java)" == "${TOOLCHAIN_JAVA_HOME}/bin/java" ]] || {
  echo "Managed Java must be first on PATH" >&2
  exit 1
}
[[ "$(command -v go)" == "${TOOLCHAIN_GO_ROOT}/bin/go" ]] || {
  echo "Managed Go must be first on PATH" >&2
  exit 1
}
[[ "$(command -v rustc)" == "${TOOLCHAIN_RUST_BIN}/rustc" ]] || {
  echo "Managed Rust must be first on PATH" >&2
  exit 1
}
[[ "$(readlink -f "${JAVA_HOME}/bin/java")" == "$(readlink -f "$(command -v java)")" ]] || {
  echo "JAVA_HOME does not match the Java executable" >&2
  exit 1
}

node_version="$(node --version)"
npm_version="$(npm --version)"
tsc_version="$(tsc --version)"
codex_version="$(codex --version)"
go_version="$(go version)"
java_version="$(java -version 2>&1 | head -n 1)"
rustc_version="$(rustc --version)"
cargo_version="$(cargo --version)"
rustup show active-toolchain >/dev/null

printf '%s\n' \
  "${node_version}" \
  "npm ${npm_version}" \
  "${tsc_version}" \
  "${codex_version}" \
  "${go_version}" \
  "${java_version}" \
  "${rustc_version}" \
  "${cargo_version}"
python3 --version
python3 -m pip --version
python3 -m venv --help >/dev/null
git --version
git lfs version
gcc --version
g++ --version
clang --version
make --version
cmake --version
pkg-config --version
bash --version
curl --version
wget --version
jq --version
zip -v >/dev/null
unzip -v >/dev/null
tar --version
gzip --version
xz --version
zstd --version
rsync --version
file --version
find --version
diff --version

[[ "${node_version}" == v22.* ]] || { echo "Node.js 22 is required" >&2; exit 1; }
[[ "${tsc_version}" == *"${EXPECTED_TYPESCRIPT_VERSION:?EXPECTED_TYPESCRIPT_VERSION is required}"* ]] || {
  echo "Unexpected TypeScript version: ${tsc_version}" >&2
  exit 1
}
[[ "${codex_version}" == *"${EXPECTED_CODEX_VERSION:?EXPECTED_CODEX_VERSION is required}"* ]] || {
  echo "Unexpected Codex version: ${codex_version}" >&2
  exit 1
}
[[ "${go_version}" == *"go${EXPECTED_GO_VERSION:?EXPECTED_GO_VERSION is required}"* ]] || {
  echo "Unexpected Go version: ${go_version}" >&2
  exit 1
}
[[ "${java_version}" == *'"21.'* || "${java_version}" == *' 21 '* ]] || {
  echo "Java 21 is required: ${java_version}" >&2
  exit 1
}

codex --ask-for-approval never exec --help >/dev/null
smoke_root="$(/usr/bin/mktemp -d /tmp/agent-relay-smoke.XXXXXX)"
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
