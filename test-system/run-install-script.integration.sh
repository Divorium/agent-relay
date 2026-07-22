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
fixture_patch = r'''lock_file_case = '    "${LOCK_FILE}") echo 1000 ;;'
root_owned_case = (
    '    "${LOCK_ROOT}"|"${BASE_ROOT}"|"${STORAGE_ROOT}"|'
    '"${DOCKER_STORAGE_ROOT}"|"${DOCKER_ROOT}"|"${CONTAINERD_ROOT}"|'
    '*"/etc/docker/daemon.json"|*"/etc/containerd/config.toml") echo 0 ;;\n'
    + lock_file_case
)
if source.count(lock_file_case) != 2:
    raise SystemExit("installer ownership fixture no longer matches the expected shape")
source = source.replace(lock_file_case, root_owned_case)
path.write_text(source)
PY'''
source = source.replace(write_marker, fixture_patch)
sudo_marker = 'if [[ "\\${1:-}" == chown ]]; then exit 0; fi'
sudo_install = r'''if [[ "\${1:-}" == install ]]; then
  shift
  install_args=()
  while (( \$# > 0 )); do
    case "\$1" in
      -o|-g) shift 2 ;;
      *) install_args+=("\$1"); shift ;;
    esac
  done
  exec /usr/bin/install "\${install_args[@]}"
fi
if [[ "\${1:-}" == chown ]]; then exit 0; fi'''
if source.count(sudo_marker) != 1:
    raise SystemExit("installer sudo fixture no longer matches the expected shape")
source = source.replace(sudo_marker, sudo_install)
staged_path.write_text(source)
PY

chmod 0755 "${staged_test}"
bash "${staged_test}"
