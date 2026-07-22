#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/agent-relay-permissions.XXXXXXXX")"
cleanup() {
  rm -rf -- "${test_root}"
}
trap cleanup EXIT

checkout="${test_root}/checkout"
mkdir -p "${checkout}/nested"
printf 'plain\n' >"${checkout}/plain.txt"
printf '#!/usr/bin/env bash\nexit 0\n' >"${checkout}/executable.sh"
chmod 0775 "${checkout}" "${checkout}/nested" "${checkout}/executable.sh"
chmod 0664 "${checkout}/plain.txt"

bash "${repository_root}/scripts/secure-checkout-permissions.sh" "${checkout}"

[[ "$(stat -c '%a' -- "${checkout}")" == 755 ]]
[[ "$(stat -c '%a' -- "${checkout}/nested")" == 755 ]]
[[ "$(stat -c '%a' -- "${checkout}/plain.txt")" == 644 ]]
[[ "$(stat -c '%a' -- "${checkout}/executable.sh")" == 755 ]]

if find -P "${checkout}" -xdev \( -type f -o -type d \) -perm /022 -print -quit | grep -q .; then
  printf 'checkout still contains group- or other-writable entries\n' >&2
  exit 1
fi

printf 'checkout permission repair checks passed\n'
