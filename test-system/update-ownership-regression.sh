#!/usr/bin/env bash
set -euo pipefail

script="$(cat update.sh)"

[[ "${script}" == *'previous_dist="${STORAGE_ROOT}/.agent-relay-dist.previous.$$"'* ]]
[[ "${script}" == *'activation_stage="${STORAGE_ROOT}/.agent-relay-dist.stage.$$"'* ]]
[[ "${script}" != *'previous_dist="${SOURCE_ROOT}/.dist.previous.$$"'* ]]
[[ "${script}" != *'chown -R'* ]]
[[ "${script}" == *'find -P "${root}" -xdev -exec chown -h root:root {} +'* ]]
[[ "${script}" == *'-type f -links +1'* ]]

preflight="$(awk '
  /sudo -v/ { sudo_line = NR }
  /assert_source_ownership/ && NR > sudo_line && ! ownership_line { ownership_line = NR }
  /git -C "\$\{SOURCE_ROOT\}" config core.fileMode false/ { git_config_line = NR }
  /git_status="\$\(git -C "\$\{SOURCE_ROOT\}" status/ { status_line = NR }
  /sudo systemctl stop "\$\{SERVICE_NAME\}"/ { stop_line = NR }
  /pull --ff-only/ { pull_line = NR }
  END { print sudo_line, ownership_line, git_config_line, status_line, stop_line, pull_line }
' update.sh)"
read -r sudo_line ownership_line git_config_line status_line stop_line pull_line <<< "${preflight}"
(( sudo_line > 0 ))
(( ownership_line > sudo_line ))
(( git_config_line > ownership_line ))
(( status_line > git_config_line ))
(( stop_line > status_line ))
(( pull_line > stop_line ))

printf 'update ownership regression passed\n'
