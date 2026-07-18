# Native GitHub Runner Operations

## Filesystem layout

All application-owned paths are grouped under `/srv/github-runner/storage`:

```text
/srv/github-runner/storage/agent-relay  administrator-owned source and trusted runtime
/srv/github-runner/storage/work         github-runner-owned workflow workspaces
/srv/github-runner/storage/runner       official GitHub Actions runner
/srv/github-runner/storage/home         github-runner home and Codex authentication
/srv/github-runner/storage/build        disposable update leftovers
/srv/github-runner/storage/build-home   builder home
```

`/srv/github-runner/storage/runner/_work` is a managed symlink to `../work`.

The complete path decision and ownership model are recorded in `docs/exec-plans/completed/2026-07-16-install-native-github-runner.md`. `github-runner` and `agent-relay-builder` have locked passwords and no sudo access. The runner cannot modify the trusted source checkout or compiled runtime.

## Initial setup

```bash
cd /srv/github-runner/storage/agent-relay
./install.sh
```

When systemd is enabled for the first time, run `wsl --shutdown` from Windows and start Debian again. Finish by running:

```bash
cd /srv/github-runner/storage/agent-relay
./update.sh
```

Do not run `install.sh` for normal releases.

## Release update

```bash
cd /srv/github-runner/storage/agent-relay
git pull --ff-only
./update.sh
```

Git synchronization is always explicit and remains outside `update.sh`. The pipeline validates the revision before it reaches `main`. The updater stops the runner listener, waits for an existing `Runner.Worker`, removes the old runtime, compiles `dist` directly from the checked-out sources with the pinned global TypeScript compiler, applies root ownership and read-only runtime modes, and starts the service.

The updater does not require a clean checkout and does not run dependency installation, tests, coverage, syntax checks, or toolchain smoke. It does not retain or restore the old runtime. If an update fails, correct the cause and run `./update.sh` again; the next invocation deletes `dist` and rebuilds it from zero.

## Status

```bash
sudo systemctl status actions.runner.Divorium.gh-runner.service
```
