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
fixture_patch = r'''source = source.replace(
    ''' + '"""    *) /usr/bin/stat -c \'%u\' -- "$1" ;;"""' + r''',
    ''' + '"""    "${LOCK_ROOT}") echo 1000 ;;\n    *) /usr/bin/stat -c \'%u\' -- "$1" ;;"""' + r'''
)
source = source.replace(
    ''' + '"""    *) /usr/bin/stat -c \'%g\' -- "$1" ;;"""' + r''',
    ''' + '"""    "${LOCK_ROOT}") echo 1000 ;;\n    *) /usr/bin/stat -c \'%g\' -- "$1" ;;"""' + r'''
)
path.write_text(source)
PY'''
staged_path.write_text(source.replace(write_marker, fixture_patch))
PY

chmod 0755 "${staged_test}"
bash "${staged_test}"
