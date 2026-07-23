from pathlib import Path


path = Path("install.sh")
source = path.read_text()

trusted_anchor = """    scripts/codex-run
    scripts/host-config.sh
"""
trusted_replacement = """    scripts/codex-run
    scripts/github-connect
    scripts/host-config.sh
"""
if trusted_replacement not in source:
    if source.count(trusted_anchor) != 1:
        raise SystemExit("trusted-file anchor changed")
    source = source.replace(trusted_anchor, trusted_replacement, 1)

registration_block = """registration="$(registration_state)"
case "${registration}" in
  absent)
    set +x
    printf 'GitHub credential authorized to create organization runner registration tokens: ' >&2
    IFS= read -r -s github_token
    printf '\\n' >&2
    [[ -n "${github_token}" ]] || fail "GitHub credential is required"
    if ! registration_response="$(
      printf 'Authorization: Bearer %s\\n' "${github_token}" \\
        | curl -fsSL --retry 3 -X POST \\
            -H 'Accept: application/vnd.github+json' \\
            -H @- \\
            -H "X-GitHub-Api-Version: ${GITHUB_API_VERSION}" \\
            "https://api.github.com/orgs/${ORGANIZATION}/actions/runners/registration-token"
    )"; then
      unset github_token
      fail "Could not obtain a GitHub runner registration token"
    fi
    unset github_token
    registration_token="$(jq -er '.token' <<<"${registration_response}")"
    unset registration_response
    sudo -n -u "${RUNNER_USER}" -H bash -c '
      set -euo pipefail
      umask 0077
      cd "$1"
      ./config.sh --unattended --replace --url "$2" --token "$3" --name "$4" --work _work
    ' -- "${RUNNER_DIR}" "${ORGANIZATION_URL}" "${registration_token}" "${RUNNER_NAME}"
    unset registration_token
    sudo -n -u "${RUNNER_USER}" chmod 0600 \\
      "${RUNNER_DIR}/.runner" \\
      "${RUNNER_DIR}/.credentials" \\
      "${RUNNER_DIR}/.credentials_rsaparams"
    [[ "$(registration_state)" == "complete" ]] || fail "Runner registration did not produce the complete protected state"
    ;;
  complete) ;;
  *) fail "Runner registration is partial or conflicting; rebuild the host or remove the state deliberately" ;;
esac
"""
registration_replacement = """registration="$(registration_state)"
case "${registration}" in
  absent|complete) ;;
  *) fail "Runner registration is partial or conflicting; rebuild the host or remove the state deliberately" ;;
esac
"""
if registration_block in source:
    source = source.replace(registration_block, registration_replacement, 1)
elif registration_replacement not in source:
    raise SystemExit("registration block changed")

activation_block = """sudo -n systemctl enable "${SERVICE_NAME}"
sudo -n systemctl restart "${SERVICE_NAME}"
ready=0
for _ in $(seq 1 60); do
  if sudo -n systemctl is-active --quiet "${SERVICE_NAME}" && listener_ready; then
    ready=1
    break
  fi
  sleep 1
done
(( ready == 1 )) || fail "Runner service did not become ready within 60 seconds"

printf 'Agent Relay runner installation is active: %s (%s)\\n' "${RUNNER_NAME}" "${ORGANIZATION_URL}"
"""
activation_replacement = """if [[ "${registration}" == "complete" ]]; then
  sudo -n systemctl enable "${SERVICE_NAME}"
  sudo -n systemctl restart "${SERVICE_NAME}"
  ready=0
  for _ in $(seq 1 60); do
    if sudo -n systemctl is-active --quiet "${SERVICE_NAME}" && listener_ready; then
      ready=1
      break
    fi
    sleep 1
  done
  (( ready == 1 )) || fail "Runner service did not become ready within 60 seconds"
  printf 'Agent Relay host runtime is active: %s (%s)\\n' "${RUNNER_NAME}" "${ORGANIZATION_URL}"
else
  sudo -n systemctl disable --now "${SERVICE_NAME}"
  printf 'Agent Relay host installation is complete; run ansible/playbooks/github-connect.yml once\\n'
fi
"""
if activation_block in source:
    source = source.replace(activation_block, activation_replacement, 1)
elif activation_replacement not in source:
    raise SystemExit("activation block changed")

path.write_text(source)
