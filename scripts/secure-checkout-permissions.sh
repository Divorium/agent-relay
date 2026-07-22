#!/usr/bin/env bash
set -euo pipefail

repository_root=${1:-}
if [[ -z "${repository_root}" ]]; then
  repository_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)"
fi
repository_root="$(cd -- "${repository_root}" && pwd -P)"

[[ -d "${repository_root}" && ! -L "${repository_root}" ]] \
  || { printf 'Checkout root must be a regular directory: %s\n' "${repository_root}" >&2; exit 1; }

find -P "${repository_root}" -xdev \
  \( -type f -o -type d \) \
  -perm /022 \
  -exec chmod go-w -- {} +

remaining="$(find -P "${repository_root}" -xdev \
  \( -type f -o -type d \) \
  -perm /022 \
  -print -quit)"
[[ -z "${remaining}" ]] \
  || { printf 'Checkout entry remains writable by group or others: %s\n' "${remaining}" >&2; exit 1; }
