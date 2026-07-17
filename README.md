# Agent Relay

Agent Relay runs directly on one native Debian WSL installation.

## Paths

- trusted source checkout: `/srv/github-runner/storage/agent-relay`
- GitHub Actions work directory: `/srv/github-runner/storage/work`
- runner application: `/srv/github-runner/runner`
- runner home and Codex authentication: `/srv/github-runner/home`

The source checkout is owned by the Debian administrator. The `github-runner` service account can read it but cannot modify it and has no sudo access. Builds run as the separate no-sudo `agent-relay-builder` account.

## First installation

```bash
cd /srv/github-runner/storage/agent-relay
./install.sh
```

If the installer enables systemd, run `wsl --shutdown` from Windows and start Debian again. Then deploy and validate the checked-out revision:

```bash
cd /srv/github-runner/storage/agent-relay
./update.sh
```

`install.sh` is the one-time host and runner setup. It installs system dependencies, creates the isolated service accounts, registers the organization runner, configures the root-owned systemd unit, and performs Codex login for `github-runner`.

## Updates

For every later release run only:

```bash
cd /srv/github-runner/storage/agent-relay
./update.sh
```

`update.sh` requires a clean checkout, stops the runner, performs `git pull --ff-only`, re-executes the updater from the pulled revision, builds and tests that revision as `agent-relay-builder`, requires 100% TypeScript runtime coverage, atomically replaces `dist`, and starts the runner again. A failed update restores the previous Git revision and compiled runtime.
