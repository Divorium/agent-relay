#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f .runner ]]; then
  : "${RUNNER_TOKEN:?RUNNER_TOKEN is required for initial registration}"
  : "${RUNNER_REPOSITORY_URL:?RUNNER_REPOSITORY_URL is required for initial registration}"
  : "${RUNNER_NAME:?RUNNER_NAME is required for initial registration}"

  ./config.sh \
    --unattended \
    --replace \
    --url "${RUNNER_REPOSITORY_URL}" \
    --token "${RUNNER_TOKEN}" \
    --name "${RUNNER_NAME}" \
    --labels "${RUNNER_LABELS:-agent-relay}" \
    --work /runner/_work
fi

unset RUNNER_TOKEN
exec ./run.sh
