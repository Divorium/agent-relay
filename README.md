# Agent Relay

Agent Relay runs directly on one native Debian WSL installation.

## Filesystem layout

All Agent Relay and GitHub Runner data is grouped under `/srv/github-runner/storage`:

```text
/srv/github-runner/storage/agent-relay  administrator-owned source and trusted runtime
/srv/github-runner/storage/work         github-runner-owned workflow workspaces
/srv/github-runner/storage/runner       official GitHub Actions runner
/srv/github-runner/storage/home         github-runner home and Codex authentication
/srv/github-runner/storage/build        disposable update leftovers
/srv/github-runner/storage/build-home   builder home
```

This layout is an explicit architecture decision recorded in `docs/exec-plans/completed/2026-07-16-install-native-github-runner.md` and specified in `docs/native-github-runner-specification.md`.

The source checkout is owned by the Debian administrator. The `github-runner` service account can read it but cannot modify it and has no sudo access. Runtime compilation runs as the separate no-sudo `agent-relay-builder` account. The activated `dist` tree is owned by root.

## First installation

```bash
cd /srv/github-runner/storage/agent-relay
./install.sh
```

If the installer enables systemd, run `wsl --shutdown` from Windows and start Debian again. Then build and activate the checked-out revision:

```bash
cd /srv/github-runner/storage/agent-relay
./update.sh
```

`install.sh` is the one-time host and runner setup. It installs system dependencies, creates the isolated service accounts, registers the organization runner, configures the root-owned systemd unit, and performs Codex login for `github-runner`.

## Updates

For every later release, update the checkout explicitly and then rebuild the runtime:

```bash
cd /srv/github-runner/storage/agent-relay
git pull --ff-only
./update.sh
```

The repository pipeline performs dependency installation, type checking, tests, coverage, syntax checks, system tests, production-runtime compilation validation, and the host toolchain smoke test. `update.sh` does not repeat that validation and performs no Git commands. It stops the runner listener, waits for the current `Runner.Worker` to finish, deletes the previous `dist`, compiles a new production runtime directly into `dist`, applies root ownership, and starts the runner.

There is no rollback or recovery. If an update fails, run `./update.sh` again after correcting the cause. Every invocation deletes `dist` and builds it again from zero.
