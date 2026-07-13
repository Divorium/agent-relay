#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TOKEN:?RUNNER_TOKEN is required}"
: "${RUNNER_REPOSITORY_URL:?RUNNER_REPOSITORY_URL is required}"
: "${RUNNER_NAME:?RUNNER_NAME is required}"

cleanup() {
  ./config.sh remove --unattended --token "${RUNNER_TOKEN}" || true
}
trap cleanup EXIT INT TERM

./config.sh \
  --unattended \
  --replace \
  --url "${RUNNER_REPOSITORY_URL}" \
  --token "${RUNNER_TOKEN}" \
  --name "${RUNNER_NAME}" \
  --labels "${RUNNER_LABELS:-agent-relay}" \
  --work /runner/_work

exec ./run.sh
