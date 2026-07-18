# Agent Relay

Agent Relay runs on a dedicated Debian 13 systemd virtual machine under Hyper-V. The virtual machine is the production containment boundary; the deployment does not depend on shared Windows folders.

This README describes the currently implemented repository and host behavior. Active ExecPlans describe proposed work. Completed ExecPlans are historical records and are not current architecture specifications.

## Filesystem layout

All Agent Relay and GitHub Runner application data is grouped under `/srv/github-runner/storage`:

```text
/srv/github-runner/storage/agent-relay  administrator-owned source and root-owned compiled runtime
/srv/github-runner/storage/work         github-runner-owned workflow workspaces
/srv/github-runner/storage/runner       official GitHub Actions runner
/srv/github-runner/storage/home         github-runner home and Codex authentication
/srv/github-runner/storage/build        disposable update leftovers
/srv/github-runner/storage/build-home   builder home
```

The current ownership and runtime contracts are specified in `docs/native-github-runner-specification.md`. Operator procedures are in `docs/operations/README.md`.

The source checkout is owned by the Debian administrator. The `github-runner` service account can read it but cannot modify it and has no sudo access. Runtime compilation runs as the separate no-sudo `agent-relay-builder` account. The activated `dist` tree is owned by root.

## First installation

```bash
cd /srv/github-runner/storage/agent-relay
./install.sh
./update.sh
```

`install.sh` performs one-time host and runner setup: it installs system dependencies, creates the isolated service accounts, registers the organization runner, configures the root-owned systemd unit, and performs Codex login for `github-runner`.

The production VM already uses systemd as PID 1. The installer retains WSL compatibility; only a WSL installation on which it newly enables systemd requires `wsl --shutdown` before `./update.sh` is run.

## Updates

For every later release, update the checkout explicitly and then rebuild the runtime:

```bash
cd /srv/github-runner/storage/agent-relay
git pull --ff-only
./update.sh
```

The repository pipeline performs dependency installation, type checking, tests, coverage, syntax checks, system tests, production-runtime compilation validation, and the host toolchain smoke test. `update.sh` does not repeat that validation and performs no Git commands. It stops the runner listener, waits for the current `Runner.Worker` to finish, deletes the previous `dist`, compiles a new production runtime directly into `dist`, applies root ownership, and starts the runner.

There is no runtime rollback or recovery transaction. If an update fails, correct the cause and run `./update.sh` again; every invocation deletes `dist` and builds it again from zero.

## Proposed changes

Only the selected file under `docs/exec-plans/active/` is an implementation instruction for Codex. A proposed feature must not be described here as currently available until its ExecPlan is complete and the implementation has been validated.
