#!/usr/bin/env bash
set -euo pipefail

node --version
npm --version
python3 --version
python3 -m pip --version
python3 -m venv --help >/dev/null
java -version
rustc --version
cargo --version
go version
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
zip -v
unzip -v
tar --version
gzip --version
xz --version
zstd --version
rsync --version
file --version
find --version
diff --version

codex_version="$(codex --version)"
printf '%s\n' "$codex_version"
case "$codex_version" in
  *"${EXPECTED_CODEX_VERSION:?EXPECTED_CODEX_VERSION is required}"*) ;;
  *)
    echo "Unexpected Codex CLI version: $codex_version" >&2
    exit 1
    ;;
esac
codex --ask-for-approval never exec --help >/dev/null

if command -v ssh >/dev/null 2>&1; then
  echo "OpenSSH must not be installed" >&2
  exit 1
fi

if command -v dotnet >/dev/null 2>&1; then
  echo ".NET SDK must not be installed" >&2
  exit 1
fi
