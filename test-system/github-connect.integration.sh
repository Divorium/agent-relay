#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/agent-relay-github-connect.XXXXXX")"
cleanup() {
  rm -rf -- "${test_root}"
}
trap cleanup EXIT

base_root=${test_root}/srv/github-runner
storage_root=${base_root}/storage
source_root=${storage_root}/agent-relay
runner_root=${storage_root}/runner
runner_home=${storage_root}/home
lifecycle_root=${test_root}/var/lib/agent-relay/lifecycle
service_root=${test_root}/etc/systemd/system
service_name=actions.runner.Divorium.gh-runner.service
service_unit=${service_root}/${service_name}
fake_bin=${test_root}/bin
state_root=${test_root}/state

mkdir -p \
  "${source_root}/config" \
  "${source_root}/scripts" \
  "${source_root}/dist/src" \
  "${runner_root}/bin" \
  "${runner_home}" \
  "${lifecycle_root}" \
  "${service_root}" \
  "${fake_bin}" \
  "${state_root}"
chmod 0700 "${runner_root}" "${runner_home}"
chmod 0755 "${lifecycle_root}"

cp "${repository_root}/config/runner-host.json" "${source_root}/config/runner-host.json"
cp "${repository_root}/scripts/host-config.sh" "${source_root}/scripts/host-config.sh"
cp "${repository_root}/scripts/github-connect" "${source_root}/scripts/github-connect"
printf 'export {};\n' > "${source_root}/dist/src/run-codex.js"

python3 - "${source_root}/config/runner-host.json" "${base_root}" <<'PY'
import json
import pathlib
import sys
path = pathlib.Path(sys.argv[1])
data = json.loads(path.read_text())
data["base_root"] = sys.argv[2]
path.write_text(json.dumps(data, indent=2) + "\n")
PY

python3 - "${source_root}/scripts/github-connect" "${lifecycle_root}" "${service_root}" <<'PY'
import pathlib
import sys
path = pathlib.Path(sys.argv[1])
source = path.read_text()
source = source.replace("LIFECYCLE_ROOT=/var/lib/agent-relay/lifecycle", f"LIFECYCLE_ROOT={sys.argv[2]!r}")
source = source.replace("SERVICE_UNIT=/etc/systemd/system/${SERVICE_NAME}", f"SERVICE_UNIT={sys.argv[3]!r}/${{SERVICE_NAME}}")
source = source.replace(
    '''sudo_stat_uid() { sudo -n stat -c '%u' -- "$1"; }
sudo_stat_mode() { sudo -n stat -c '%a' -- "$1"; }''',
    '''sudo_stat_uid() {
  case "$1" in
    "${RUNNER_DIR}"|"${RUNNER_DIR}/"*) printf '2001\\n' ;;
    "${LIFECYCLE_ROOT}"|"${SERVICE_UNIT}") printf '0\\n' ;;
    *) stat -c '%u' -- "$1" ;;
  esac
}
sudo_stat_mode() { stat -c '%a' -- "$1"; }'''
)
path.write_text(source)
PY
chmod 0755 "${source_root}/scripts/github-connect"

for executable in Runner.Listener Runner.Worker runsvc.sh; do
  cat > "${runner_root}/bin/${executable}" <<'EOF_RUNNER'
#!/usr/bin/env bash
exit 0
EOF_RUNNER
  chmod 0755 "${runner_root}/bin/${executable}"
done
cat > "${runner_root}/runsvc.sh" <<'EOF_RUNSVC'
#!/usr/bin/env bash
exit 0
EOF_RUNSVC
chmod 0755 "${runner_root}/runsvc.sh"
cat > "${runner_root}/config.sh" <<EOF_CONFIG
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "\$*" >> "${state_root}/config.log"
printf '{}\n' > .runner
printf '{}\n' > .credentials
printf '{}\n' > .credentials_rsaparams
EOF_CONFIG
chmod 0755 "${runner_root}/config.sh"
printf '[Unit]\nDescription=test\n' > "${service_unit}"
chmod 0644 "${service_unit}"

cat > "${fake_bin}/id" <<'EOF_ID'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == -u && "${2:-}" == github-runner ]]; then
  printf '2001\n'
  exit 0
fi
if [[ "${1:-}" == -u && $# == 1 ]]; then
  printf '1000\n'
  exit 0
fi
exec /usr/bin/id "$@"
EOF_ID

cat > "${fake_bin}/sudo" <<'EOF_SUDO'
#!/usr/bin/env bash
set -euo pipefail
while (( $# > 0 )); do
  case "$1" in
    -n|-H) shift ;;
    -u) shift 2 ;;
    *) break ;;
  esac
done
exec "$@"
EOF_SUDO

cat > "${fake_bin}/curl" <<EOF_CURL
#!/usr/bin/env bash
set -euo pipefail
cat >/dev/null
printf '%s\n' "\$*" >> "${state_root}/curl.log"
printf '{"token":"registration-token"}\n'
EOF_CURL

cat > "${fake_bin}/jq" <<'EOF_JQ'
#!/usr/bin/env bash
set -euo pipefail
python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])'
EOF_JQ

cat > "${fake_bin}/systemctl" <<EOF_SYSTEMCTL
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "\$*" >> "${state_root}/systemctl.log"
case "\${1:-}" in
  is-active) test -f "${state_root}/service-active" ;;
  restart|start) touch "${state_root}/service-active" ;;
  stop) rm -f "${state_root}/service-active" ;;
  enable|disable|daemon-reload) exit 0 ;;
  *) exit 0 ;;
esac
EOF_SYSTEMCTL

cat > "${fake_bin}/ps" <<EOF_PS
#!/usr/bin/env bash
set -euo pipefail
if [[ -f "${state_root}/service-active" ]]; then
  printf ' 2001 Runner.Listener\n'
fi
EOF_PS

chmod 0755 "${fake_bin}"/*

run_connection() {
  local token=$1
  printf '%s\n' "${token}" | PATH="${fake_bin}:/usr/bin:/bin" bash "${source_root}/scripts/github-connect"
}

mv "${source_root}/dist/src/run-codex.js" "${source_root}/dist/src/run-codex.js.missing"
if run_connection first-token; then
  echo 'GitHub connection unexpectedly succeeded before host runtime existed' >&2
  exit 1
fi
mv "${source_root}/dist/src/run-codex.js.missing" "${source_root}/dist/src/run-codex.js"

run_connection first-token
[[ -f "${state_root}/service-active" ]]
[[ "$(grep -c registration-token "${state_root}/curl.log")" == 1 ]]
[[ "$(wc -l < "${state_root}/config.log")" == 1 ]]
[[ -f "${runner_root}/.runner" ]]
[[ "$(stat -c '%a' -- "${runner_root}/.runner")" == 600 ]]
[[ ! -e "${lifecycle_root}/active" ]]

run_connection second-token
[[ "$(grep -c registration-token "${state_root}/curl.log")" == 1 ]]
[[ "$(wc -l < "${state_root}/config.log")" == 1 ]]
[[ -f "${state_root}/service-active" ]]
[[ ! -e "${lifecycle_root}/active" ]]

mkdir "${lifecycle_root}/active"
if run_connection third-token; then
  echo 'GitHub connection unexpectedly ignored the active lifecycle lock' >&2
  exit 1
fi
rmdir "${lifecycle_root}/active"

printf 'GitHub connection integration checks passed\n'
