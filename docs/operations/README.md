# Native GitHub Runner Operations

## Filesystem layout

All application-owned paths are grouped under `/srv/github-runner/storage`:

```text
/srv/github-runner/storage/agent-relay  administrator-owned source and trusted runtime
/srv/github-runner/storage/work         github-runner-owned workflow workspaces
/srv/github-runner/storage/runner       official GitHub Actions runner
/srv/github-runner/storage/home         github-runner home and Codex authentication
/srv/github-runner/storage/build        isolated temporary build area
/srv/github-runner/storage/build-home   builder home and tool caches
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
./update.sh
```

The update is rejected when the checkout contains local changes. It stops the runner service, pulls with fast-forward only, re-executes the updater from the pulled revision, builds in an isolated no-sudo account, runs the complete test suite with 100% TypeScript runtime coverage, atomically publishes `dist`, and restarts the service. Failure restores the previous revision and runtime.

## Status

```bash
sudo systemctl status actions.runner.Divorium.gh-runner.service
```
