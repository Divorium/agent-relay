#!/usr/bin/env bash
set -euo pipefail

ORGANIZATION=Divorium
ORGANIZATION_URL=https://github.com/Divorium
RUNNER_VERSION=2.335.1
RUNNER_SHA256=4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf
GO_VERSION=1.24.5
GO_SHA256=10ad9e86233e74c0f6590fe5426895de6bf388964210eac34a6d83f38918ecdc
TYPESCRIPT_VERSION=5.8.3
CODEX_VERSION=0.144.4
INSTALL_ROOT=/opt/agent-relay
RUNNER_DIR="${HOME:?HOME is required}/.local/share/actions-runner"
SOURCE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

node_setup=""
java_key=""
go_archive=""
rustup_script=""
runner_archive=""
wsl_config_temp=""
stage=""
backup=""
install_swap_pending=0
runner_fresh=0
registration_fresh=0

cleanup() {
  rm -f -- \
    "${node_setup:-}" \
    "${java_key:-}" \
    "${go_archive:-}" \
    "${rustup_script:-}" \
    "${runner_archive:-}" \
    "${wsl_config_temp:-}"

  if [[ -n "${stage:-}" ]]; then
    sudo rm -rf -- "${stage}" >/dev/null 2>&1 || true
  fi

  if (( install_swap_pending == 1 )); then
    sudo rm -rf -- "${INSTALL_ROOT}" >/dev/null 2>&1 || true
    if [[ -n "${backup:-}" && -e "${backup}" ]]; then
      sudo mv -- "${backup}" "${INSTALL_ROOT}" >/dev/null 2>&1 || true
    fi
  fi
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

if (( $# != 0 )); then
  echo "install.sh does not accept arguments" >&2
  exit 1
fi
if [[ "$(id -u)" == "0" ]]; then
  echo "Run install.sh as the normal Debian user, not root" >&2
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
command -v sudo >/dev/null || { echo "sudo is required" >&2; exit 1; }
[[ -d "${HOME}" && -w "${HOME}" ]] || { echo "HOME must be writable" >&2; exit 1; }
[[ -d "${SOURCE_ROOT}" && -r "${SOURCE_ROOT}/package.json" && -w "${SOURCE_ROOT}" ]] || {
  echo "The source checkout must be readable and writable by the current user: ${SOURCE_ROOT}" >&2
  exit 1
}
sudo -v

if [[ "$(ps -p 1 -o comm= | tr -d '[:space:]')" != "systemd" ]]; then
  if grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null; then
    configure_wsl_systemd
    cat >&2 <<'MESSAGE'
Enabled systemd in /etc/wsl.conf.
Run `wsl --shutdown` from Windows, start Debian again, and rerun ./install.sh.
MESSAGE
    exit 2
  fi
  echo "systemd must run as PID 1" >&2
  exit 1
fi
command -v systemctl >/dev/null || { echo "systemctl is required" >&2; exit 1; }

sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  ca-certificates curl wget jq git git-lfs gnupg \
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

export PATH="/opt/java/openjdk/bin:/usr/local/go/bin:/opt/rust/cargo/bin:/usr/local/bin:/usr/bin:/bin"
cd "${SOURCE_ROOT}"
npm ci
npm run check

export EXPECTED_TYPESCRIPT_VERSION="${TYPESCRIPT_VERSION}"
export EXPECTED_CODEX_VERSION="${CODEX_VERSION}"
export EXPECTED_GO_VERSION="${GO_VERSION}"
"${SOURCE_ROOT}/scripts/toolchain-smoke.sh"

stage="/opt/.agent-relay.stage.$$"
backup="/opt/.agent-relay.previous.$$"
sudo rm -rf -- "${stage}" "${backup}"
sudo install -d -m 0755 "${stage}"
sudo rsync -a \
  package.json package-lock.json tsconfig.json dist runner scripts types \
  "${stage}/"
sudo chown -R root:root "${stage}"
sudo find "${stage}" -type d -exec chmod 0755 {} +
sudo find "${stage}" -type f -exec chmod 0644 {} +
sudo chmod 0755 "${stage}/runner/resolve-pr.mjs" "${stage}/runner/finalize.sh" \
  "${stage}/scripts/codex-run" "${stage}/scripts/toolchain-smoke.sh"

install_swap_pending=1
if [[ -e "${INSTALL_ROOT}" ]]; then
  sudo mv -- "${INSTALL_ROOT}" "${backup}"
fi
if ! sudo mv -- "${stage}" "${INSTALL_ROOT}"; then
  exit 1
fi
stage=""
if ! sudo install -o root -g root -m 0755 "${INSTALL_ROOT}/scripts/codex-run" /usr/local/bin/codex-run; then
  exit 1
fi
install_swap_pending=0
sudo rm -rf -- "${backup}"
backup=""

if ! codex login status >/dev/null 2>&1; then
  codex login
fi
codex login status >/dev/null

if [[ -f "${RUNNER_DIR}/.runner" && ! -x "${RUNNER_DIR}/bin/Runner.Listener" ]]; then
  echo "The existing runner registration is incomplete: ${RUNNER_DIR}" >&2
  exit 1
fi

if [[ ! -x "${RUNNER_DIR}/bin/Runner.Listener" ]]; then
  mkdir -p "${RUNNER_DIR}"
  runner_archive="$(mktemp)"
  curl -fsSL \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" \
    -o "${runner_archive}"
  printf '%s  %s\n' "${RUNNER_SHA256}" "${runner_archive}" | sha256sum -c -
  tar -C "${RUNNER_DIR}" -xzf "${runner_archive}"
  runner_fresh=1
  sudo "${RUNNER_DIR}/bin/installdependencies.sh"
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

  if ! registration_token="$(jq -er '.token' <<< "${registration_response}")"; then
    unset registration_response
    echo "GitHub returned an invalid runner registration response" >&2
    exit 1
  fi
  unset registration_response

  set +e
  (
    cd "${RUNNER_DIR}"
    ./config.sh --unattended --replace \
      --url "${ORGANIZATION_URL}" \
      --token "${registration_token}" \
      --name gh-runner \
      --work _work
  )
  registration_status=$?
  set -e
  unset registration_token
  if (( registration_status != 0 )); then
    echo "GitHub runner registration failed" >&2
    exit "${registration_status}"
  fi
  registration_fresh=1
fi

sudo install -d -m 0755 /etc/needrestart/conf.d
printf '%s\n' '$nrconf{override_rc}{qr(^actions\.runner\..+\.service$)} = 0;' \
  | sudo tee /etc/needrestart/conf.d/actions_runner_services.conf >/dev/null
cd "${RUNNER_DIR}"
if [[ ! -f .service ]]; then
  if (( runner_fresh != 1 && registration_fresh != 1 )); then
    echo "The existing runner installation has no service registration: ${RUNNER_DIR}" >&2
    exit 1
  fi
  sudo ./svc.sh install "$(id -un)"
fi
service_name="$(tr -d '\r\n' < .service)"
if [[ ! "${service_name}" =~ ^actions\.runner\.[A-Za-z0-9_.@-]+\.service$ ]]; then
  echo "The runner service name is invalid" >&2
  exit 1
fi
sudo systemctl start "${service_name}"
sudo systemctl is-active --quiet "${service_name}"
sudo systemctl --no-pager --full status "${service_name}"

printf 'Native runner installation is ready: %s (%s)\n' gh-runner "${ORGANIZATION_URL}"
