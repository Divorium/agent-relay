# Native GitHub Runner Operations

These procedures describe the supported systemd-capable Linux runner host contract. The concrete Linux distribution, virtualization platform, cloud provider, or bare-metal placement is not part of the operating contract. Active ExecPlans may propose later behavior; do not operate the host as though a planned feature already exists.

## Filesystem layout

All Agent Relay and GitHub Runner application paths are grouped under `/srv/github-runner/storage`:

```text
/srv/github-runner/storage/agent-relay  administrator-owned source and root-owned compiled runtime
/srv/github-runner/storage/work         github-runner-owned workflow workspaces
/srv/github-runner/storage/runner       official GitHub Actions runner
/srv/github-runner/storage/home         github-runner home and Codex authentication
/srv/github-runner/storage/build        disposable update leftovers
/srv/github-runner/storage/build-home   builder home
```

`/srv/github-runner/storage/runner/_work` is a managed symlink to `../work`.

The current path, ownership, privilege, and update contracts are specified in `docs/native-github-runner-specification.md`. `github-runner` and `agent-relay-builder` have locked passwords and no sudo access. The runner cannot modify the trusted source checkout or compiled runtime.

## Initial setup

```bash
cd /srv/github-runner/storage/agent-relay
./install.sh
./update.sh
```

The host must run systemd as PID 1. The current installer implementation supports Debian x86-64 and retains a WSL compatibility path; only that WSL path may require `wsl --shutdown` after systemd is enabled. This compatibility limitation does not make WSL, a virtual machine, or any specific hypervisor part of the architecture.

Do not run `install.sh` for normal releases.

## Release update

```bash
cd /srv/github-runner/storage/agent-relay
git pull --ff-only
./update.sh
```

Git synchronization is explicit and remains outside `update.sh`. The pipeline validates the revision before it reaches `main`. The updater stops the runner listener, scans the complete process table for a `Runner.Worker` owned by the numeric `github-runner` UID, waits only while that worker exists, removes the old runtime, compiles `dist` directly from the checked-out sources with the pinned global TypeScript compiler, applies root ownership and read-only runtime modes, and starts the service. No processes owned by `github-runner`, or a listener without a worker, means the runner is idle and replacement continues.

The updater does not require a clean checkout and does not run dependency installation, tests, coverage, syntax checks, or toolchain smoke. It does not retain or restore the old runtime. If an update fails, correct the cause and run `./update.sh` again; the next invocation deletes `dist` and rebuilds it from zero.

## Status

```bash
sudo systemctl status actions.runner.Divorium.gh-runner.service
```

## Codex execution output

Codex progress is normalized, redacted, and streamed live in the Actions job log. After the Codex step, the workflow uploads `agent-relay-output`; its transcript contains the same bytes Relay accepted for the live log. Raw `codex exec --json` records are internal and are not an operator-facing log format. If `MAX_OUTPUT_BYTES` is reached after normalization and redaction, both views contain one `[OUTPUT TRUNCATED]` marker while Relay continues draining Codex and preserves the eventual step status.

The artifact is not available until its upload step runs. `${GITHUB_OUTPUT}` carries workflow outputs such as the commit message and is not a logging channel.

## Documentation authority

- `README.md`, this operations guide, the technical specification, and the current source describe implemented behavior.
- The selected file under `docs/exec-plans/active/` describes proposed implementation work.
- Files under `docs/exec-plans/completed/` are historical and must not be used as current operating instructions.
