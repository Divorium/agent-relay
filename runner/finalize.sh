#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"
: "${TARGET_BRANCH:?TARGET_BRANCH is required}"

cd "$GITHUB_WORKSPACE"
git check-ref-format --branch "$TARGET_BRANCH" >/dev/null

if test -z "$(git status --porcelain)"; then
  echo "No changes to commit"
  exit 0
fi

: "${COMMIT_MESSAGE:?COMMIT_MESSAGE is required when the worktree changed}"
case "$COMMIT_MESSAGE" in
  *$'\n'*|*$'\r'*)
    echo "COMMIT_MESSAGE must be one line" >&2
    exit 1
    ;;
esac

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add --all

if git diff --cached --name-only | grep -q '^\.agent-relay/'; then
  echo "Relay artifact must not be committed" >&2
  exit 1
fi

if git diff --cached --quiet; then
  echo "No staged changes to commit"
  exit 0
fi

git commit -m "$COMMIT_MESSAGE"
git push origin "HEAD:${TARGET_BRANCH}"
