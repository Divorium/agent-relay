#!/usr/bin/env bash
set -euo pipefail

node_version="$(node --version)"
npm_version="$(npm --version)"
tsc_version="$(tsc --version)"
codex_version="$(codex --version)"
go_version="$(go version)"
java_version="$(java -version 2>&1 | head -n 1)"

printf '%s\n' "${node_version}" "npm ${npm_version}" "${tsc_version}" "${codex_version}" "${go_version}" "${java_version}"
python3 --version
python3 -m pip --version
python3 -m venv --help >/dev/null
rustc --version
cargo --version
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
  echo "Unexpected Codex CLI version: ${codex_version}" >&2
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
codex \
  --ask-for-approval never \
  -c 'features.memories=false' \
  -c 'default_permissions="agent"' \
  -c 'permissions.agent.extends=":workspace"' \
  -c 'permissions.agent.filesystem={"/tmp"="deny","/tmp/agent-relay-smoke"="write"}' \
  -c 'permissions.agent.network.enabled=true' \
  exec --cd /tmp/agent-relay-smoke --help >/dev/null
