#!/usr/bin/env bash
set -euo pipefail

: "${EXPECTED_NODE_MAJOR:?EXPECTED_NODE_MAJOR is required}"
: "${EXPECTED_JAVA_MAJOR:?EXPECTED_JAVA_MAJOR is required}"
: "${EXPECTED_GO_VERSION:?EXPECTED_GO_VERSION is required}"
: "${EXPECTED_RUST_TOOLCHAIN:?EXPECTED_RUST_TOOLCHAIN is required}"
: "${EXPECTED_RUST_COVERAGE_TOOLCHAIN:?EXPECTED_RUST_COVERAGE_TOOLCHAIN is required}"
: "${EXPECTED_RUST_COVERAGE_COMPONENT:?EXPECTED_RUST_COVERAGE_COMPONENT is required}"
: "${EXPECTED_CARGO_LLVM_COV_VERSION:?EXPECTED_CARGO_LLVM_COV_VERSION is required}"
: "${EXPECTED_TYPESCRIPT_VERSION:?EXPECTED_TYPESCRIPT_VERSION is required}"
: "${EXPECTED_CODEX_VERSION:?EXPECTED_CODEX_VERSION is required}"
: "${TOOLCHAIN_JAVA_HOME:?TOOLCHAIN_JAVA_HOME is required}"
: "${TOOLCHAIN_GO_ROOT:?TOOLCHAIN_GO_ROOT is required}"
: "${TOOLCHAIN_RUST_BIN:?TOOLCHAIN_RUST_BIN is required}"
: "${TOOLCHAIN_RUSTUP_HOME:?TOOLCHAIN_RUSTUP_HOME is required}"
: "${TOOLCHAIN_RUST_CARGO_HOME:?TOOLCHAIN_RUST_CARGO_HOME is required}"

for command in \
  node npm java javac go rustc cargo rustup cargo-llvm-cov tsc codex \
  python3 git gcc g++ clang make cmake pkg-config bash curl wget jq \
  zip unzip tar gzip xz zstd file find diff; do
  command -v "${command}" >/dev/null 2>&1 || {
    echo "Required toolchain command is missing: ${command}" >&2
    exit 1
  }
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
[[ "$(command -v cargo-llvm-cov)" == "${TOOLCHAIN_RUST_BIN}/cargo-llvm-cov" ]] || {
  echo 'Managed cargo-llvm-cov must be first on PATH' >&2
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
codex_version="$(codex --version)"
cargo_llvm_cov_version="$(cargo-llvm-cov --version)"

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
[[ "${codex_version}" =~ (^|[[:space:]])${EXPECTED_CODEX_VERSION//./\.}$ ]] || {
  echo "Unexpected Codex version: ${codex_version}" >&2
  exit 1
}
[[ "${cargo_llvm_cov_version}" == "cargo-llvm-cov ${EXPECTED_CARGO_LLVM_COV_VERSION}" ]] || {
  echo "Unexpected cargo-llvm-cov version: ${cargo_llvm_cov_version}" >&2
  exit 1
}
RUSTUP_HOME="${TOOLCHAIN_RUSTUP_HOME}" CARGO_HOME="${TOOLCHAIN_RUST_CARGO_HOME}" \
  rustup show active-toolchain | grep -Eq "^${EXPECTED_RUST_TOOLCHAIN}(-|[[:space:]])" || {
    echo "Rust ${EXPECTED_RUST_TOOLCHAIN} toolchain is not active" >&2
    exit 1
  }
RUSTUP_HOME="${TOOLCHAIN_RUSTUP_HOME}" CARGO_HOME="${TOOLCHAIN_RUST_CARGO_HOME}" \
  rustup toolchain list | grep -Eq "^${EXPECTED_RUST_COVERAGE_TOOLCHAIN}(-|[[:space:]])" || {
    echo "Rust coverage toolchain ${EXPECTED_RUST_COVERAGE_TOOLCHAIN} is not installed" >&2
    exit 1
  }
coverage_component_stem="${EXPECTED_RUST_COVERAGE_COMPONENT%-preview}"
RUSTUP_HOME="${TOOLCHAIN_RUSTUP_HOME}" CARGO_HOME="${TOOLCHAIN_RUST_CARGO_HOME}" \
  rustup component list --toolchain "${EXPECTED_RUST_COVERAGE_TOOLCHAIN}" --installed \
  | grep -Eq "^${coverage_component_stem}(-|[[:space:]])" || {
    echo "Rust coverage component ${EXPECTED_RUST_COVERAGE_COMPONENT} is not installed for ${EXPECTED_RUST_COVERAGE_TOOLCHAIN}" >&2
    exit 1
  }

git lfs version >/dev/null
python3 -m pip --version >/dev/null
python3 -m venv --help >/dev/null
