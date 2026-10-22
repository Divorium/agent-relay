# Antigravity Docker sandbox on Agent Relay

Antigravity runs in a Docker container, with an independent persistent state directory for each account.
Do not mount the Docker socket into the container.

## Host provisioning

Set `agent_relay_antigravity_enabled: true` for the desired host in Ansible inventory.
Run `ansible/playbooks/host.yml`; the host builds and verifies `antigravity-sandbox:latest`,
installs `/usr/local/bin/antigravity`, and writes a root-owned readiness marker.
Run `ansible/playbooks/github-connect.yml` with a PAT to reconcile the `antigravity` label.
Repeat label reconciliation after disabling or removing Antigravity.

## SSH, accounts and skills

Create `/srv/github-runner/storage/home/.ssh/antigravity.priv` as a private key owned
by `github-runner` (0600). Register only the public key with an appropriately scoped
GitHub deploy key. The mounted private key is read-only, but the agent can read it.

From a project directory (as the runner account):
```bash
antigravity personal
antigravity client-a --continue
antigravity --list
```

Each account's persistent state lives in
`/srv/github-runner/storage/antigravity/accounts/<account>/state` and is mounted
at `/tmp/antigravity-home`; the current project becomes `/workspace`.
Shared skills under `skills/` are mounted both as `/shared-skills` and
in the Antigravity CLI's native skills directory.

UE5 is optional. Set `ANTIGRAVITY_UE5_DIR=/absolute/host/path` to mount an
existing engine read-only; the default is an empty directory.
`ANTIGRAVITY_SSH_KEY` overrides the runner's default private key.

The supplied README mentioned `sync-settings.sh` and a launcher not included
in the attachments. This repository provides the launcher; account-wide
settings synchronization is not part of this change.
The runner label reflects the installed image, not whether an account is authenticated.
