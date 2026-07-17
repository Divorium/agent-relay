#!/usr/bin/env bash

TOOLCHAIN_JAVA_HOME=/opt/java/openjdk
TOOLCHAIN_GO_ROOT=/usr/local/go
TOOLCHAIN_RUST_CARGO_HOME=/opt/rust/cargo
TOOLCHAIN_RUST_BIN=${TOOLCHAIN_RUST_CARGO_HOME}/bin
TOOLCHAIN_RUSTUP_HOME=/opt/rust/rustup
TOOLCHAIN_SYSTEM_PATH=/usr/local/bin:/usr/bin:/bin
TOOLCHAIN_PATH=${TOOLCHAIN_JAVA_HOME}/bin:${TOOLCHAIN_GO_ROOT}/bin:${TOOLCHAIN_RUST_BIN}:${TOOLCHAIN_SYSTEM_PATH}
TOOLCHAIN_STATE_SUBDIRECTORIES=(cargo go go-cache gradle npm pip cache config data tmp)

toolchain_validate_absolute_path() {
  local label="$1"
  local value="$2"
  if [[ -z "${value}" || "${value}" != /* || "${value}" == / || "${value}" == */ \
    || "${value}" == *//* || "${value}" == */./* || "${value}" == */../* \
    || "${value}" == *$'\n'* || "${value}" == *$'\r'* ]]; then
    printf 'Invalid %s: %s\n' "${label}" "${value}" >&2
    return 1
  fi
}

toolchain_environment_build() {
  if (( $# != 4 )); then
    echo 'toolchain_environment_build requires user, home, state root, and output array name' >&2
    return 1
  fi

  local target_user="$1"
  local target_home="$2"
  local state_root="$3"
  local output_name="$4"

  [[ "${target_user}" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]] || {
    echo "Invalid toolchain target user: ${target_user}" >&2
    return 1
  }
  toolchain_validate_absolute_path 'toolchain home' "${target_home}" || return 1
  toolchain_validate_absolute_path 'toolchain state root' "${state_root}" || return 1
  [[ "${output_name}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || {
    echo "Invalid toolchain output array name: ${output_name}" >&2
    return 1
  }

  local -n output_ref="${output_name}"
  output_ref=(
    "HOME=${target_home}"
    "USER=${target_user}"
    "LOGNAME=${target_user}"
    "SHELL=/bin/bash"
    "LANG=C.UTF-8"
    "LC_ALL=C.UTF-8"
    "JAVA_HOME=${TOOLCHAIN_JAVA_HOME}"
    "RUSTUP_HOME=${TOOLCHAIN_RUSTUP_HOME}"
    "CARGO_HOME=${state_root}/cargo"
    "GOPATH=${state_root}/go"
    "GOCACHE=${state_root}/go-cache"
    "GRADLE_USER_HOME=${state_root}/gradle"
    "NPM_CONFIG_CACHE=${state_root}/npm"
    "PIP_CACHE_DIR=${state_root}/pip"
    "XDG_CACHE_HOME=${state_root}/cache"
    "XDG_CONFIG_HOME=${state_root}/config"
    "XDG_DATA_HOME=${state_root}/data"
    "TMPDIR=${state_root}/tmp"
    "TMP=${state_root}/tmp"
    "TEMP=${state_root}/tmp"
    "PATH=${TOOLCHAIN_PATH}"
  )
}
