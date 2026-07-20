#!/usr/bin/env bash
set -euo pipefail

source_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
runtime_root="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:?TMPDIR is required when RUNNER_TEMP is unset}}/agent-relay-runtime.XXXXXX")"

cleanup() {
  rm -rf -- "${runtime_root}"
}
trap cleanup EXIT

tsc \
  -p "${source_root}/tsconfig.runtime.json" \
  --outDir "${runtime_root}"

test -f "${runtime_root}/src/run-codex.js"
