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
: "${GITHUB_PUSH_TOKEN:?GITHUB_PUSH_TOKEN is required when the worktree changed}"
if ! COMMIT_MESSAGE="$COMMIT_MESSAGE" node -e '
const message = process.env.COMMIT_MESSAGE ?? "";
if (Array.from(message).length > 120 || /[\u0000-\u001f\u007f]/u.test(message)) process.exit(1);
'; then
  echo "COMMIT_MESSAGE must be one line without control characters and at most 120 Unicode characters" >&2
  exit 1
fi

git diff --check
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add --all

if git diff --cached --quiet; then
  echo "No staged changes to commit"
  exit 0
fi

git diff --cached --check
original_head="$(git rev-parse HEAD)"
git commit -m "$COMMIT_MESSAGE"

askpass="$(mktemp)"
cleanup() {
  rm -f "$askpass"
}
trap cleanup EXIT
cat > "$askpass" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  *Username*) printf '%s\n' 'x-access-token' ;;
  *Password*) printf '%s\n' "${GITHUB_PUSH_TOKEN:?}" ;;
  *) exit 1 ;;
esac
SCRIPT
chmod 0700 "$askpass"

set +e
GIT_ASKPASS="$askpass" GIT_TERMINAL_PROMPT=0 git -c credential.helper= push origin "HEAD:${TARGET_BRANCH}"
push_status=$?
set -e
if (( push_status != 0 )); then
  git reset --mixed "$original_head"
  exit "$push_status"
fi
