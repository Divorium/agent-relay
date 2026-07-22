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
fixture_patch = r'''import re
stat_helpers = r''' + "'''" + r'''stat_uid() {
  case "$1" in
    "${LOCK_ROOT}"|"${LOCK_FILE}") echo 1000 ;;
    "${SOURCE_ROOT}/dist"|"${SOURCE_ROOT}/dist/"*|"${SOURCE_ROOT}/.dist.stage."*|"${SOURCE_ROOT}/.dist.stage."*/*) echo 0 ;;
    "${SOURCE_ROOT}"|"${SOURCE_ROOT}/"*) echo 1000 ;;
    "${RUNNER_DIR}"|"${RUNNER_DIR}/"*|"${WORK_ROOT}"|"${WORK_ROOT}/"*|"${RUNNER_HOME}"|"${RUNNER_HOME}/"*) echo 2001 ;;
    "${BUILD_HOME}"|"${BUILD_HOME}/"*) echo 2002 ;;
    *) /usr/bin/stat -c '%u' -- "$1" ;;
  esac
}
stat_gid() {
  case "$1" in
    "${LOCK_ROOT}"|"${LOCK_FILE}") echo 1000 ;;
    "${SOURCE_ROOT}/dist"|"${SOURCE_ROOT}/dist/"*|"${SOURCE_ROOT}/.dist.stage."*|"${SOURCE_ROOT}/.dist.stage."*/*) echo 0 ;;
    "${SOURCE_ROOT}"|"${SOURCE_ROOT}/"*) echo 1000 ;;
    "${RUNNER_DIR}"|"${RUNNER_DIR}/"*|"${WORK_ROOT}"|"${WORK_ROOT}/"*|"${RUNNER_HOME}"|"${RUNNER_HOME}/"*) echo 2001 ;;
    "${BUILD_HOME}"|"${BUILD_HOME}/"*) echo 2002 ;;
    *) /usr/bin/stat -c '%g' -- "$1" ;;
  esac
}
stat_mode() { /usr/bin/stat -c '%a' -- "$1"; }
sudo_stat_uid() { stat_uid "$1"; }
sudo_stat_gid() { stat_gid "$1"; }
sudo_stat_mode() { stat_mode "$1"; }
''' + "'''" + r'''
pattern = re.compile(
    r"stat_uid\(\) \{[^\n]*\}\n"
    r"stat_gid\(\) \{[^\n]*\}\n"
    r"stat_mode\(\) \{[^\n]*\}\n"
    r"sudo_stat_uid\(\) \{[^\n]*\}\n"
    r"sudo_stat_gid\(\) \{[^\n]*\}\n"
    r"sudo_stat_mode\(\) \{[^\n]*\}\n"
)
source, helper_count = pattern.subn(stat_helpers, source, count=1)
if helper_count != 1:
    raise SystemExit("installer stat helpers no longer match the expected shape")
path.write_text(source)
PY'''
staged_path.write_text(source.replace(write_marker, fixture_patch))
PY

chmod 0755 "${staged_test}"
bash "${staged_test}"
