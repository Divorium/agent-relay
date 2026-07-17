#!/usr/bin/env bash
set -euo pipefail

ORGANIZATION=Divorium
ORGANIZATION_URL=https://github.com/Divorium
RUNNER_NAME=gh-runner
RUNNER_VERSION=2.335.1
RUNNER_SHA256=4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf
GO_VERSION=1.24.5
GO_SHA256=10ad9e86233e74c0f6590fe5426895de6bf388964210eac34a6d83f38918ecdc
TYPESCRIPT_VERSION=5.8.3
CODEX_VERSION=0.144.4
BASE_ROOT=/srv/github-runner
STORAGE_ROOT=${BASE_ROOT}/storage
EXPECTED_SOURCE_ROOT=${STORAGE_ROOT}/agent-relay
WORK_ROOT=${STORAGE_ROOT}/work
RUNNER_DIR=${STORAGE_ROOT}/runner
RUNNER_HOME=${STORAGE_ROOT}/home
BUILD_ROOT=${STORAGE_ROOT}/build
BUILD_HOME=${STORAGE_ROOT}/build-home
RUNNER_USER=github-runner
BUILD_USER=agent-relay-builder
SERVICE_NAME=actions.runner.Divorium.gh-runner.service
CONFIG_ROOT=/etc/agent-relay
SOURCE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

node_setup=""
java_key=""
go_archive=""
rustup_script=""
runner_archive=""
wsl_config_temp=""
service_temp=""
config_temp=""

cleanup() {
  rm -f -- \
    "${node_setup:-}" \
    "${java_key:-}" \
    "${go_archive:-}" \
    "${rustup_script:-}" \
    "${runner_archive:-}" \
    "${wsl_config_temp:-}" \
    "${service_temp:-}" \
    "${config_temp:-}"
}
trap cleanup EXIT

configure_wsl_systemd() {
  wsl_config_temp="$(mktemp)"
  if [[ -f /etc/wsl.conf ]]; then
    awk '
      BEGIN { in_boot = 0; saw_boot = 0; wrote_systemd = 0 }
      /^\[boot\][[:space:]]*$/ {
        in_boot = 1
        saw_boot = 1
        print
        next
      }
      /^\[/ {
        if (in_boot && !wrote_systemd) {
          print "systemd=true"
          wrote_systemd = 1
        }
        in_boot = 0
      }
      in_boot && /^[[:space:]]*systemd[[:space:]]*=/ {
        if (!wrote_systemd) {
          print "systemd=true"
          wrote_systemd = 1
        }
        next
      }
      { print }
      END {
        if (in_boot && !wrote_systemd) {
          print "systemd=true"
        } else if (!saw_boot) {
          print ""
          print "[boot]"
          print "systemd=true"
        }
      }
    ' /etc/wsl.conf > "${wsl_config_temp}"
  else
    printf '[boot]\nsystemd=true\n' > "${wsl_config_temp}"
  fi
  sudo install -o root -g root -m 0644 "${wsl_config_temp}" /etc/wsl.conf
  rm -f -- "${wsl_config_temp}"
  wsl_config_temp=""
}

ensure_locked_user() {
  local user="$1"
  local home="$2"
  local shell="$3"
  if ! id -u "${user}" >/dev/null 2>&1; then
    sudo useradd --system --create-home --home-dir "${home}" --shell "${shell}" "${user}"
  fi
  [[ "$(getent passwd "${user}" | cut -d: -f6)" == "${home}" ]] || {
    echo "${user} has an unexpected home directory" >&2
    exit 1
  }
  sudo passwd --lock "${user}" >/dev/null
  if getent group sudo | awk -F: -v user="${user}" '$4 ~ "(^|,)" user "(,|$)" { found=1 } END { exit !found }'; then
    sudo gpasswd --delete "${user}" sudo >/dev/null
  fi
  if sudo -u "${user}" -H sudo -n true >/dev/null 2>&1; then
    echo "${user} must not have passwordless sudo access" >&2
    exit 1
  fi
}

secure_source_checkout() {
  local owner="$1"
  local group="$2"
  local path
  for path in \
    install.sh \
    update.sh \
    runner/finalize.sh \
    runner/resolve-pr.mjs \
    runner/resolve-plan.mjs \
    runner/resolve-request.mjs \
    runner/run-codex.mjs \
    scripts/codex-run \
    scripts/toolchain-smoke.sh; do
    if [[ ! -f "${SOURCE_ROOT}/${path}" || -L "${SOURCE_ROOT}/${path}" ]]; then
      echo "Required source file must be a regular non-symlink file: ${path}" >&2
      exit 1
    fi
  done
  sudo find -P "${SOURCE_ROOT}" -xdev -exec chown -h "${owner}:${group}" {} +
  sudo find -P "${SOURCE_ROOT}" -xdev -type d -exec chmod u+rwx,go+rx,go-w {} +
  sudo find -P "${SOURCE_ROOT}" -xdev -type f -exec chmod a+r,go-w {} +
  sudo chmod 0755 \
    "${SOURCE_ROOT}/install.sh" \
    "${SOURCE_ROOT}/update.sh" \
    "${SOURCE_ROOT}/runner/finalize.sh" \
    "${SOURCE_ROOT}/runner/resolve-pr.mjs" \
    "${SOURCE_ROOT}/runner/resolve-plan.mjs" \
    "${SOURCE_ROOT}/runner/resolve-request.mjs" \
    "${SOURCE_ROOT}/runner/run-codex.mjs" \
    "${SOURCE_ROOT}/scripts/codex-run" \
    "${SOURCE_ROOT}/scripts/toolchain-smoke.sh"
}

install_runner_service() {
  sudo -u "${RUNNER_USER}" cp "${RUNNER_DIR}/bin/runsvc.sh" "${RUNNER_DIR}/runsvc.sh"
  sudo -u "${RUNNER_USER}" chmod 0755 "${RUNNER_DIR}/runsvc.sh"
  service_temp="$(mktemp)"
  cat > "${service_temp}" <<EOF_SERVICE
[Unit]
Description=GitHub Actions Runner (${ORGANIZATION}.${RUNNER_NAME})
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${RUNNER_DIR}/runsvc.sh
User=${RUNNER_USER}
WorkingDirectory=${RUNNER_DIR}
KillMode=process
KillSignal=SIGTERM
TimeoutStopSec=5min
Restart=always
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF_SERVICE
  sudo install -o root -g root -m 0644 "${service_temp}" "/etc/systemd/system/${SERVICE_NAME}"
  rm -f -- "${service_temp}"
  service_temp=""
}

if (( $# != 0 )); then
  echo "install.sh does not accept arguments" >&2
  exit 1
fi
if [[ "$(id -u)" == "0" ]]; then
  echo "Run install.sh as the normal Debian administrator, not root" >&2
  exit 1
fi
if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "Only Linux x86_64 is supported" >&2
  exit 1
fi
if [[ ! -r /etc/os-release ]]; then
  echo "/etc/os-release is required" >&2
  exit 1
fi
. /etc/os-release
if [[ "${ID:-}" != "debian" ]]; then
  echo "This installer requires Debian" >&2
  exit 1
fi
if [[ "${SOURCE_ROOT}" != "${EXPECTED_SOURCE_ROOT}" ]]; then
  echo "The repository must be checked out at ${EXPECTED_SOURCE_ROOT}" >&2
  exit 1
fi
command -v sudo >/dev/null || { echo "sudo is required" >&2; exit 1; }
[[ -d "${HOME:?HOME is required}" && -w "${HOME}" ]] || { echo "HOME must be writable" >&2; exit 1; }
[[ -r "${SOURCE_ROOT}/package.json" && -w "${SOURCE_ROOT}" ]] || {
  echo "The source checkout must be readable and writable by the administrator: ${SOURCE_ROOT}" >&2
  exit 1
}

admin_user="$(id -un)"
admin_group="$(id -gn)"
sudo -v

systemd_active=1
if [[ "$(ps -p 1 -o comm= | tr -d '[:space:]')" != "systemd" ]]; then
  systemd_active=0
  if grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null; then
    configure_wsl_systemd
  else
    echo "systemd must run as PID 1" >&2
    exit 1
  fi
fi

sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  ca-certificates curl wget jq git git-lfs gnupg sudo \
  python3 python3-pip python3-venv \
  build-essential clang cmake pkg-config \
  zip unzip xz-utils zstd rsync file findutils diffutils
curl -fsS --max-time 20 https://api.github.com/meta >/dev/null

if [[ ! -x /usr/bin/node ]] || [[ "$(/usr/bin/node --version)" != v22.* ]]; then
  node_setup="$(mktemp)"
  curl -fsSL https://deb.nodesource.com/setup_22.x -o "${node_setup}"
  sudo -E bash "${node_setup}"
  sudo apt-get install -y nodejs
fi
[[ -x /usr/bin/npm ]] || { echo "System npm is required after Node.js installation" >&2; exit 1; }

if [[ ! -x /usr/bin/java || ! -x /usr/bin/javac ]] \
  || ! /usr/bin/java -version 2>&1 | /usr/bin/head -n 1 | grep -Eq 'version "21\.|openjdk 21'; then
  java_key="$(mktemp)"
  curl -fsSL https://packages.adoptium.net/artifactory/api/gpg/key/public -o "${java_key}"
  sudo install -d -m 0755 /etc/apt/keyrings
  gpg --dearmor < "${java_key}" | sudo tee /etc/apt/keyrings/adoptium.gpg >/dev/null
  printf 'deb [signed-by=/etc/apt/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb %s main\n' "${VERSION_CODENAME}" \
    | sudo tee /etc/apt/sources.list.d/adoptium.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y temurin-21-jdk
fi
java_home="$(dirname "$(dirname "$(readlink -f /usr/bin/javac)")")"
sudo install -d -m 0755 /opt/java
sudo ln -sfn "${java_home}" /opt/java/openjdk

if [[ ! -x /usr/local/go/bin/go ]] || [[ "$(/usr/local/go/bin/go version)" != *"go${GO_VERSION}"* ]]; then
  go_archive="$(mktemp)"
  curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -o "${go_archive}"
  printf '%s  %s\n' "${GO_SHA256}" "${go_archive}" | sha256sum -c -
  sudo rm -rf /usr/local/go
  sudo tar -C /usr/local -xzf "${go_archive}"
fi

if [[ ! -x /opt/rust/cargo/bin/rustc ]]; then
  rustup_script="$(mktemp)"
  curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs -o "${rustup_script}"
  sudo install -d -m 0755 /opt/rust/cargo /opt/rust/rustup
  sudo env CARGO_HOME=/opt/rust/cargo RUSTUP_HOME=/opt/rust/rustup \
    sh "${rustup_script}" -y --default-toolchain stable --profile minimal --no-modify-path
fi
for tool in cargo rustc rustdoc rustup; do
  sudo ln -sfn "/opt/rust/cargo/bin/${tool}" "/usr/local/bin/${tool}"
done

sudo /usr/bin/npm install --global --prefix /usr/local \
  "typescript@${TYPESCRIPT_VERSION}" \
  "@openai/codex@${CODEX_VERSION}"
[[ -x /usr/local/bin/codex ]] || { echo "Codex was not installed at /usr/local/bin/codex" >&2; exit 1; }
[[ -x /usr/local/bin/tsc ]] || { echo "TypeScript was not installed at /usr/local/bin/tsc" >&2; exit 1; }
sudo git lfs install --system

ensure_locked_user "${RUNNER_USER}" "${RUNNER_HOME}" /bin/bash
ensure_locked_user "${BUILD_USER}" "${BUILD_HOME}" /usr/sbin/nologin

sudo install -d -o root -g root -m 0755 "${BASE_ROOT}" "${STORAGE_ROOT}"
sudo install -d -o "${RUNNER_USER}" -g "${RUNNER_USER}" -m 0700 "${RUNNER_HOME}" "${RUNNER_DIR}" "${WORK_ROOT}"
sudo install -d -o "${BUILD_USER}" -g "${BUILD_USER}" -m 0700 "${BUILD_ROOT}" "${BUILD_HOME}"
git -C "${SOURCE_ROOT}" config core.fileMode false
secure_source_checkout "${admin_user}" "${admin_group}"

if [[ -f "${RUNNER_DIR}/.runner" && ! -x "${RUNNER_DIR}/bin/Runner.Listener" ]]; then
  echo "The existing runner registration is incomplete: ${RUNNER_DIR}" >&2
  exit 1
fi

if [[ ! -x "${RUNNER_DIR}/bin/Runner.Listener" ]]; then
  runner_archive="$(mktemp)"
  curl -fsSL \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" \
    -o "${runner_archive}"
  printf '%s  %s\n' "${RUNNER_SHA256}" "${runner_archive}" | sha256sum -c -
  sudo -u "${RUNNER_USER}" tar -C "${RUNNER_DIR}" -xzf "${runner_archive}"
  sudo "${RUNNER_DIR}/bin/installdependencies.sh"
fi
if [[ -L "${RUNNER_DIR}/_work" ]]; then
  [[ "$(readlink "${RUNNER_DIR}/_work")" == ../work ]] || {
    echo "The runner work link points to an unexpected location" >&2
    exit 1
  }
elif [[ -e "${RUNNER_DIR}/_work" ]]; then
  echo "The runner work path must be the managed symlink: ${RUNNER_DIR}/_work" >&2
  exit 1
else
  sudo -u "${RUNNER_USER}" ln -s ../work "${RUNNER_DIR}/_work"
fi

if [[ ! -f "${RUNNER_DIR}/.runner" ]]; then
  set +x
  printf 'GitHub token for organization runner registration: ' >&2
  IFS= read -r -s github_token
  printf '\n' >&2
  [[ -n "${github_token}" ]] || { echo "GitHub token is required" >&2; exit 1; }

  if ! registration_response="$(
    printf 'Authorization: Bearer %s\n' "${github_token}" \
      | curl -fsSL -X POST \
          -H 'Accept: application/vnd.github+json' \
          -H @- \
          -H 'X-GitHub-Api-Version: 2026-03-10' \
          "https://api.github.com/orgs/${ORGANIZATION}/actions/runners/registration-token"
  )"; then
    unset github_token
    echo "Could not obtain a GitHub runner registration token" >&2
    exit 1
  fi
  unset github_token
  registration_token="$(jq -er '.token' <<< "${registration_response}")"
  unset registration_response
  sudo -u "${RUNNER_USER}" -H bash -c '
    set -euo pipefail
    cd "$1"
    ./config.sh --unattended --replace --url "$2" --token "$3" --name "$4" --work _work
  ' -- "${RUNNER_DIR}" "${ORGANIZATION_URL}" "${registration_token}" "${RUNNER_NAME}"
  unset registration_token
fi

install_runner_service
sudo install -d -m 0755 /etc/needrestart/conf.d "${CONFIG_ROOT}"
printf '%s\n' '$nrconf{override_rc}{qr(^actions\.runner\..+\.service$)} = 0;' \
  | sudo tee /etc/needrestart/conf.d/actions_runner_services.conf >/dev/null
config_temp="$(mktemp)"
printf '%s\n' "${admin_user}" > "${config_temp}"
sudo install -o root -g root -m 0644 "${config_temp}" "${CONFIG_ROOT}/administrator"
rm -f -- "${config_temp}"
config_temp=""

if ! sudo -u "${RUNNER_USER}" -H /usr/local/bin/codex login status >/dev/null 2>&1; then
  sudo -u "${RUNNER_USER}" -H /usr/local/bin/codex login
fi
sudo -u "${RUNNER_USER}" -H /usr/local/bin/codex login status >/dev/null

if (( systemd_active == 1 )); then
  sudo systemctl daemon-reload
  printf 'Installation completed. Run `./update.sh` to validate and activate the runner.\n'
else
  cat >&2 <<'MESSAGE'
Installation completed and systemd was enabled in /etc/wsl.conf.
Run `wsl --shutdown` from Windows, start Debian again, and then run `./update.sh`.
MESSAGE
fi
sudo -k
printf 'Native runner installation is prepared: %s (%s)\n' "${RUNNER_NAME}" "${ORGANIZATION_URL}"
