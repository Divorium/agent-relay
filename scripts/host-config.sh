#!/usr/bin/env bash

host_config_load() {
  if (( $# != 1 )); then
    echo 'host_config_load requires one config path' >&2
    return 1
  fi

  local config_path=$1 assignments
  if [[ ! -f "${config_path}" || -L "${config_path}" ]]; then
    echo "Host config must be a regular non-symlink file: ${config_path}" >&2
    return 1
  fi
  command -v python3 >/dev/null 2>&1 || {
    echo 'python3 is required to read the host config' >&2
    return 1
  }

  assignments="$(python3 - "${config_path}" <<'PY'
import json
import shlex
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)

mapping = {
    "ORGANIZATION": "organization",
    "ORGANIZATION_URL": "organization_url",
    "RUNNER_NAME": "runner_name",
    "RUNNER_VERSION": "runner_version",
    "RUNNER_SHA256": "runner_sha256",
    "GITHUB_API_VERSION": "github_api_version",
    "NODE_MAJOR": "node_major",
    "JAVA_MAJOR": "java_major",
    "GO_VERSION": "go_version",
    "GO_SHA256": "go_sha256",
    "RUST_TOOLCHAIN": "rust_toolchain",
    "TYPESCRIPT_VERSION": "typescript_version",
    "CODEX_VERSION": "codex_version",
    "BASE_ROOT": "base_root",
    "DOCKER_SOCKET_PATH": "docker_socket_path",
    "RUNNER_USER": "runner_user",
    "BUILD_USER": "builder_user",
}

for shell_name, json_name in mapping.items():
    value = data.get(json_name)
    if isinstance(value, bool) or value is None or isinstance(value, (dict, list)):
        raise SystemExit(f"invalid host config value: {json_name}")
    text = str(value)
    if not text or "\n" in text or "\r" in text:
        raise SystemExit(f"invalid host config value: {json_name}")
    print(f"{shell_name}={shlex.quote(text)}")
PY
  )" || return 1

  eval "${assignments}"
}
