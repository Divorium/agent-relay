#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
source_test="${repository_root}/test-system/install-script.integration.sh"
staged_test="$(mktemp "${repository_root}/test-system/.install-script.integration.XXXXXX.sh")"
cleanup() {
  rm -f -- "${staged_test}"
}
trap cleanup EXIT

python3 - "${source_test}" "${staged_test}" <<'PY'
import pathlib
import sys

source_path = pathlib.Path(sys.argv[1])
staged_path = pathlib.Path(sys.argv[2])
source = source_path.read_text()
write_marker = "path.write_text(source)\nPY"
if source.count(write_marker) != 1:
    raise SystemExit("installer integration generator no longer matches the expected shape")
fixture_patch = r'''old_lock_case = '    "${LOCK_FILE}") echo 1000 ;;'
new_lock_case = '    "${LOCK_ROOT}"|"${LOCK_FILE}") echo 1000 ;;'
if source.count(old_lock_case) != 2:
    raise SystemExit("installer ownership fixture no longer matches the expected shape")
source = source.replace(old_lock_case, new_lock_case)
path.write_text(source)
PY'''
source = source.replace(write_marker, fixture_patch)
installer_call = 'bash "${source_root}/install.sh"'
if source.count(installer_call) != 2:
    raise SystemExit("installer invocation no longer matches the expected shape")
source = source.replace(installer_call, 'bash -x "${source_root}/install.sh"')
staged_path.write_text(source)
PY

chmod 0755 "${staged_test}"
bash "${staged_test}"
