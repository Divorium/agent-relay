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
/srv/github-runner/storage/docker       root-owned Docker Engine and containerd state
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

The updater does not require a clean checkout and does not run repository dependency installation, tests, coverage, syntax checks, or toolchain smoke. It does not retain or restore the old runtime. It does provision the host's exact managed Docker package transaction when necessary. If an update fails, correct the cause and run `./update.sh` again; the next invocation deletes `dist`, rebuilds it from zero, and resumes only provisioner state identified by the protected marker.

## Docker host access

On the supported fresh Debian x86-64 host, `update.sh` installs `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, and `docker-compose-plugin` from Docker's official apt repository. Before package installation it publishes `/etc/docker/daemon.json` and `/etc/containerd/config.toml`, creates the managed storage directories, and prevents package post-install scripts from starting Docker or containerd. It then explicitly enables and starts `containerd.service`, `docker.socket`, and `docker.service`.

Docker Engine's effective root is `/srv/github-runner/storage/docker/engine`; containerd's effective root is `/srv/github-runner/storage/docker/containerd`. `github-runner` is a member of the root-equivalent `docker` group and uses `/var/run/docker.sock`; `agent-relay-builder` must not be a member. The first successful installation runs `hello-world`. Normal repeated updates validate the protected marker, exact package versions, configurations, roots, units, socket, plugins, and groups without requiring registry access or reinstalling packages.

The provisioner intentionally rejects Docker packages, commands, configuration, units, sockets, repository definitions, or populated managed storage that were not created by this feature. This is a fresh-host contract; it does not migrate an existing Docker installation. Codex owns Compose and application-container lifecycle. Docker bind mounts must use an appropriate container user or restore all repository paths to `github-runner` ownership before workflow finalization.

## Status

```bash
sudo systemctl status actions.runner.Divorium.gh-runner.service
```

## Codex execution output

Codex progress is normalized into `[codex] `-prefixed Actions-safe physical lines, redacted, and streamed live in the Actions job log through a bounded queue. After the Codex step, the workflow uploads `agent-relay-output`; its transcript contains the same bytes Relay accepted for the live log. Raw `codex exec --json` records are internal and are not an operator-facing log format. If the next complete physical line would exceed `MAX_OUTPUT_BYTES` after normalization and redaction, both views keep the same accepted complete-line prefix and contain one `[codex] [OUTPUT TRUNCATED]` line while Relay continues bounded transport validation and draining and preserves the eventual step status.

`MAX_JSONL_RECORD_BYTES` is a separate protocol limit. When unset, Relay derives `max(16 MiB, 8 * MAX_OUTPUT_BYTES + 1 MiB)` for JSON escaping and envelope headroom. An explicit value must be between 1 MiB and 256 MiB. JSONL framing is byte-oriented and rejects on the first byte over that limit. The default 256 KiB/128 KiB queue watermarks, hard queue maximum of less than 256 KiB plus one 32 KiB segment, one paused raw chunk per child source, 16 KiB stderr continuation bound, and lifecycle replay caps are runtime invariants rather than operator settings.

The artifact is not available until its upload step runs. `${GITHUB_OUTPUT}` carries workflow outputs such as the commit message and is not a logging channel.

## Post-deployment Codex output smoke

The branch implementation is proven pre-merge by exact-SHA CI with controlled child processes; the pull-request Codex job still runs the previously deployed trusted runtime. Only after the implementation is merged and the standard `./update.sh` deployment completes may a real Codex run count as transport smoke evidence.

Run the normal Codex workflow against a small active ExecPlan after deployment. The automated smoke evidence must record the merged SHA and deployed runtime revision, show normalized progress before Codex exits, confirm that every untrusted physical line is `[codex] `-prefixed, confirm exactly one bounded artifact transcript, and confirm successful finalization or the expected authoritative nonzero/timeout result. Store that evidence with the deployment record; do not describe a pre-merge run as final-SHA runtime evidence.

## Documentation authority

- `README.md`, this operations guide, the technical specification, and the current source describe implemented behavior.
- The selected file under `docs/exec-plans/active/` describes proposed implementation work.
- Files under `docs/exec-plans/completed/` are historical and must not be used as current operating instructions.
