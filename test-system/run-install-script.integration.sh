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
old = '    "${LOCK_FILE}") echo 1000 ;;'
new = '    "${LOCK_ROOT}"|"${LOCK_FILE}") echo 1000 ;;'
if source.count(old) != 2:
    raise SystemExit("installer integration ownership fixture no longer matches the expected shape")
staged_path.write_text(source.replace(old, new))
PY

chmod 0755 "${staged_test}"
bash "${staged_test}"
