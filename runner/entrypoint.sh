#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TOKEN:?RUNNER_TOKEN is required}"
: "${RUNNER_REPOSITORY_URL:?RUNNER_REPOSITORY_URL is required}"
: "${RUNNER_NAME:?RUNNER_NAME is required}"

./config.sh \
  --unattended \
  --replace \
  --url "${RUNNER_REPOSITORY_URL}" \
  --token "${RUNNER_TOKEN}" \
  --name "${RUNNER_NAME}" \
  --labels "${RUNNER_LABELS:-agent-relay}" \
  --work /runner/_work

unset RUNNER_TOKEN
exec ./run.sh
