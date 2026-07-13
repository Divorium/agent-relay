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
gcc --version | head -n 1
g++ --version | head -n 1
clang --version | head -n 1
make --version | head -n 1
cmake --version | head -n 1
pkg-config --version
bash --version | head -n 1
curl --version | head -n 1
wget --version | head -n 1
jq --version
zip -v | head -n 2
unzip -v | head -n 1
tar --version | head -n 1
gzip --version | head -n 1
xz --version | head -n 1
zstd --version | head -n 1
rsync --version | head -n 1
file --version | head -n 1
find --version | head -n 1
diff --version | head -n 1
if command -v ssh >/dev/null 2>&1; then echo "OpenSSH must not be installed" >&2; exit 1; fi
if command -v dotnet >/dev/null 2>&1; then echo ".NET SDK must not be installed" >&2; exit 1; fi
