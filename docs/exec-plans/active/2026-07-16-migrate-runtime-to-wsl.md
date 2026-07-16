# Migrate Agent Relay runtime from Docker Compose to native WSL

This ExecPlan is a living implementation document maintained according to `.agent/PLANS.md`.

## Purpose / Big Picture

Replace the two-container Docker Compose deployment with a native installation inside the dedicated Debian WSL2 distribution named `gh-runner`.

The one-time migration may require installation credentials, one GitHub runner registration token, and an interactive Codex login. After migration, starting the distribution with:

    wsl -d gh-runner

must cause systemd to start both Agent Relay and the repository-scoped GitHub Actions runner automatically. The runner must appear online with the `agent-relay` label and must be able to execute the existing workflow through a locally running Agent Relay and Codex without Docker, Docker Compose, Docker Desktop integration, or a new registration token.

## User-visible outcome

After the implementation and one-time setup:

1. `wsl` continues to start the user's original default Debian distribution.
2. `wsl -d gh-runner` starts the dedicated runner distribution.
3. systemd automatically starts `agent-relay.service` and the official GitHub Actions runner service.
4. Agent Relay listens only on `127.0.0.1:8080`.
5. the runner client connects to `http://127.0.0.1:8080`.
6. GitHub runner registration survives WSL shutdowns and Windows restarts because the runner is installed in the WSL filesystem.
7. Codex authentication survives restarts in the default WSL user's home directory.
8. no `docker compose up`, `docker compose down`, image build, Docker volume, Docker socket, or container registration token flow remains.

## Existing WSL environment

The implementation must target the WSL environment already prepared outside this repository:

- distribution name: `gh-runner`;
- distribution: Debian on WSL2;
- maximum virtual disk size: 50 GB;
- systemd enabled through `/etc/wsl.conf`;
- Windows interop disabled;
- Windows PATH injection disabled;
- automatic Windows drive mounting disabled;
- `/etc/fstab` mounts only `F:\Projects\github-runner` at `/srv/github-runner`;
- the distribution has one normal default non-root user with sudo access.

The repository must not create Docker-style `runner` or `agent` accounts, reproduce container UID/GID mapping, or attempt to manage the WSL distribution from inside Linux. Installation and both services use the existing default WSL user.

## Scope

### Native filesystem layout

Use the following target layout:

- `/srv/github-runner/agent-relay` — source checkout used to run the installer and update the deployment;
- `/srv/github-runner/_work` — GitHub Actions work directory on the only mounted Windows folder;
- `/opt/agent-relay` — installed, built Agent Relay application copied from the source checkout;
- `/usr/local/bin/codex-run` — installed fixed Codex launcher;
- `$HOME/.local/share/actions-runner` — official GitHub runner installation, registration state, updater, and diagnostics;
- `$HOME/.local/state/agent-relay` — Agent Relay jobs and logs;
- `$HOME/.codex/auth.json` — Codex authentication created by `codex login` inside `gh-runner`;
- `/etc/agent-relay/agent-relay.env` — root-owned systemd environment file for Agent Relay configuration.

Do not place runner registration state or Codex authentication in `/srv/github-runner`. The Windows-mounted directory is workspace and source storage, not secret storage.

### Standard WSL user model

Run the official GitHub runner service and Agent Relay under the existing default WSL user. Do not preserve the Docker-specific separation between the `runner` and `agent` accounts.

Keep the following practical boundaries:

- Agent Relay application files under `/opt/agent-relay` and `/usr/local/bin/codex-run` are installed by sudo and are not modified by workflow jobs;
- runtime state and Codex authentication remain in the default WSL user's Linux home and state directories;
- Agent Relay binds to loopback only;
- the current workflow rejection of fork-origin pull requests remains unchanged;
- no Docker socket, Windows interop, additional Windows mount, host network bridge, or privileged container equivalent is introduced.

Because runner jobs, Agent Relay, and Codex share one WSL user, the dedicated `gh-runner` distribution and the existing workflow trust gates become the runtime security boundary. Document this explicitly instead of claiming the former two-container account boundary still exists.

### Toolchain installation

Add one idempotent WSL installer script. It must install and validate the toolchain currently supplied by the Docker images, using the repository's pinned versions where they already exist:

- Debian runtime libraries required by the GitHub runner;
- Node.js 22;
- npm;
- TypeScript 5.8.3;
- Codex CLI 0.144.3;
- Java 21;
- Go 1.24.5;
- Rust stable through rustup for the default WSL user;
- Git, Git LFS, curl, wget, jq, Python 3, build tools, archive tools, rsync, file, findutils, and diffutils;
- GitHub Actions runner 2.325.0.

Do not create a separate script per dependency. The installer is the single supported installation and update entrypoint and must be safe to rerun.

The installer must fail clearly when:

- it is not running inside the `gh-runner` WSL distribution;
- systemd is not active;
- `/srv/github-runner` is not mounted;
- `/srv/github-runner` is not the configured work root;
- Node, Java, Go, Rust, Codex, or the GitHub runner does not match the expected version after installation;
- the source checkout is not located at `/srv/github-runner/agent-relay`;
- required configuration is absent.

### Agent Relay installation and service

The installer must:

1. run `npm ci`, `npm run check`, and `npm run build` from the source checkout before installing;
2. install only the files required at runtime into `/opt/agent-relay`;
3. install `scripts/codex-run` as root-owned executable `/usr/local/bin/codex-run`;
4. create `$HOME/.local/state/agent-relay`;
5. create `/etc/agent-relay/agent-relay.env` without storing the GitHub runner registration token;
6. install and enable `agent-relay.service`;
7. run the service as the default WSL user;
8. configure:
   - `AGENT_RELAY_HOST=127.0.0.1`;
   - `AGENT_RELAY_PORT=8080`;
   - `SHARED_WORKSPACE_ROOT=/srv/github-runner/_work`;
   - `AGENT_RELAY_STATE_DIR=$HOME/.local/state/agent-relay`;
   - the existing timeout and output limits;
9. use `Restart=on-failure` and normal systemd logging through journald;
10. expose a systemd health check or reproducible `curl -fsS http://127.0.0.1:8080/health` validation.

Refactor Docker-specific application assumptions:

- `src/server.ts` must not depend on a container-only user or home path;
- `scripts/codex-run` must use the actual WSL service user's home instead of `/home/agent`;
- the Docker-specific `id -u agent` guard must be removed or replaced with a native invariant that rejects root and is meaningful for a systemd service running as the configured WSL user;
- Java, Go, Rust, npm, and Codex paths must match the native installation;
- the environment-clearing and generated-home cleanup behavior of `codex-run` must remain covered by behavioral tests.

### GitHub Actions runner installation and service

Use the official GitHub Actions runner distribution and its supplied service installer instead of a custom runner daemon.

The installer must:

1. download and verify the pinned runner release into `$HOME/.local/share/actions-runner` when it is not already installed;
2. preserve an existing valid `.runner` registration on subsequent installer runs;
3. require `RUNNER_TOKEN`, repository URL, runner name, and labels only when `.runner` does not exist;
4. run `config.sh --unattended --replace` with work directory `/srv/github-runner/_work` and label `agent-relay` during first registration;
5. never write `RUNNER_TOKEN` to an environment file, systemd unit, shell profile, repository file, or persistent state;
6. install and enable the official service through `svc.sh install` for the default WSL user;
7. add only the minimal systemd dependency needed so the runner starts after `agent-relay.service` is healthy;
8. retain the runner's normal built-in update behavior;
9. make rerunning the installer leave the existing registration intact.

The workflow runner client must default to `http://127.0.0.1:8080`, not the removed Compose DNS name `http://agent-relay:8080`.

### Codex setup

Install Codex CLI at the pinned version and preserve the existing fixed launcher model.

The one-time installer must check `codex login status` for the default WSL user. When authentication is absent, it must stop before enabling the GitHub runner and instruct the operator to run `codex login` inside `gh-runner`, then rerun the same installer. Do not copy authentication from the original WSL distribution, a Docker volume, or the Windows-mounted workspace.

After authentication exists, run `scripts/toolchain-smoke.sh` through the installed native toolchain and verify `/usr/local/bin/codex --version` and `codex login status`.

### Startup and shutdown behavior

With systemd already enabled in `/etc/wsl.conf`, starting the distribution must be enough to start the services:

    wsl -d gh-runner

No shell profile hook, background `nohup`, `screen`, `tmux`, Windows startup script, scheduled task, Docker Desktop startup, or manual `systemctl start` command may be required for normal use.

Stopping or terminating the WSL distribution may interrupt an active job. On the next start:

- Agent Relay recovers in-flight jobs using its existing interrupted-job behavior;
- the GitHub runner reuses its existing registration;
- Codex reuses its existing authentication;
- no registration token is requested.

### Docker removal

Remove the Docker deployment only after the native WSL runtime passes the acceptance tests.

Delete or replace all Docker-only artifacts and documentation, including at least:

- `Dockerfile`;
- `Dockerfile.runner`;
- `compose.yml`;
- `.dockerignore`;
- Docker-specific `.env.example` fields such as `HOST_UID`, `HOST_GID`, and `HOST_CODEX_AUTH_FILE`;
- `runner/entrypoint.sh` and its Docker registration test when no longer used;
- operations documentation that instructs users to build, start, inspect, recover, or rotate the deployment through Docker Compose.

Do not leave Docker Compose as a second supported deployment mode. The completed repository must have one production deployment path: native `gh-runner` WSL services.

### Documentation

Rewrite the operational documentation around:

- the preconfigured `gh-runner` distribution;
- the fixed `/srv/github-runner` mount;
- the one-time installer;
- one-time runner registration;
- one-time Codex login;
- native systemd services;
- `journalctl` log inspection;
- health checks;
- updating by pulling the repository and rerunning the same installer;
- deliberate runner re-registration;
- recovery after `wsl --terminate gh-runner` and Windows restart;
- uninstalling the native services and installed files.

The primary start instruction must be exactly:

    wsl -d gh-runner

## Migration sequence

Implement and validate the migration in this order:

1. add the native installer, systemd definitions, path refactors, and native tests while the existing Docker deployment remains available;
2. install the branch checkout into `gh-runner` without enabling the native runner service yet;
3. perform `codex login` inside `gh-runner` when required;
4. validate Agent Relay natively on `127.0.0.1:8080`;
5. stop the Docker Compose runner to prevent duplicate execution;
6. register the native runner once using a fresh repository registration token and `--replace`;
7. enable and start both native services;
8. dispatch a real Agent Relay workflow against the branch and verify Codex execution, logging, commit, and push;
9. terminate the `gh-runner` distribution from Windows;
10. restart it with `wsl -d gh-runner` and verify both services return without a registration token;
11. only after those checks pass, remove Docker files, Docker tests, and Docker documentation;
12. rerun the complete repository validation and repeat the real workflow smoke test on the final branch head.

## Progress

- [x] (2026-07-16) Recorded the target WSL distribution, mount, lifecycle, and user-visible startup contract.
- [x] (2026-07-16) Reviewed the current Dockerfiles, Compose topology, runner entrypoint, Agent Relay configuration, Codex launcher, runner client, and production workflow.
- [ ] Implement the idempotent native WSL installer and pinned toolchain installation.
- [ ] Refactor container-only paths and identities for the default WSL user.
- [ ] Install and test native Agent Relay systemd service behavior.
- [ ] Install and test the official GitHub runner systemd service behavior.
- [ ] Complete one-time native Codex login and toolchain validation.
- [ ] Perform the real workflow cutover and restart acceptance test.
- [ ] Remove Docker Compose and every Docker-only artifact and instruction.
- [ ] Run final repository validation and archive this ExecPlan.

## Surprises & Discoveries

- Observation: the current runner client defaults to the Compose service hostname `http://agent-relay:8080`; native WSL must use loopback.
- Observation: the current Codex launcher hardcodes the Docker account name, `/home/agent`, and container toolchain paths; these are implementation assumptions, not public runtime contracts.
- Observation: the current GitHub runner registration state lives inside the runner container and is lost when that container is recreated. A native installation stores registration directly in the persistent WSL filesystem and therefore does not need a Docker volume or recurring token.
- Observation: the current Docker deployment separates runner credentials from Codex authentication through two containers. The requested single-user WSL design intentionally does not preserve that internal account boundary and must document the resulting trust model.

## Decision Log

- Decision: use the existing default WSL user for both systemd services.
  Rationale: the target is a standard dedicated WSL distribution, and the user explicitly rejected reproducing Docker-specific users, UID/GID mapping, and permission architecture.
  Date/Author: 2026-07-16 / user direction.

- Decision: use the official GitHub runner `svc.sh` service installation.
  Rationale: runner registration, startup, updates, and persistence should use the supported runner lifecycle rather than a repository-owned daemon or file-copy mechanism.
  Date/Author: 2026-07-16 / migration design.

- Decision: keep source and job workspace under the only Windows mount while keeping registration, state, and authentication in the WSL filesystem.
  Rationale: Windows access is deliberately limited to `F:\Projects\github-runner`; credentials must not be stored in that mounted workspace.
  Date/Author: 2026-07-16 / configured WSL boundary.

- Decision: remove Docker as a deployment mode after native acceptance.
  Rationale: the desired operating model is one command, `wsl -d gh-runner`, with no parallel Compose path or legacy packaging to maintain.
  Date/Author: 2026-07-16 / user direction.

## Validation and Acceptance

The implementation is complete only when all of the following are supported by captured commands and outcomes:

1. `npm ci` and `npm run check` pass on the final branch head.
2. the installer succeeds on the prepared Debian `gh-runner` distribution and succeeds again without changing registration or requesting a token.
3. `systemctl is-enabled agent-relay.service` and `systemctl is-active agent-relay.service` succeed.
4. the official actions runner service is enabled and active under the default WSL user.
5. `curl -fsS http://127.0.0.1:8080/health` succeeds.
6. Agent Relay does not listen on a non-loopback interface.
7. `findmnt /srv/github-runner` resolves to the configured `F:\Projects\github-runner` DrvFs mount, while `/mnt/c` and other Windows drive mounts remain absent.
8. `powershell.exe` and `cmd.exe` are unavailable inside `gh-runner`.
9. the runner appears online in the target repository with the `agent-relay` label.
10. a real workflow dispatch resolves a ready PR, checks out the exact head, invokes Agent Relay, runs Codex, persists logs, and performs the existing commit/push finalization.
11. after `wsl --terminate gh-runner`, running `wsl -d gh-runner` restores both services and the runner returns online without `RUNNER_TOKEN`.
12. `codex login status` remains authenticated after the WSL restart.
13. no Dockerfile, Compose file, Docker entrypoint, Docker volume instruction, or Docker-only environment field remains in the supported deployment.
14. README and operations documentation describe only the native WSL deployment.

## Idempotence and Recovery

The installer must be idempotent. Repeated execution updates packages and the installed application, validates versions, reloads systemd, and restarts services without deleting `.runner`, runner credentials, Agent Relay state, logs, or Codex authentication.

A registration token is required only when the official runner installation has no `.runner` file or when the operator deliberately requests re-registration. The token must remain process-local and must not be persisted.

If installation fails before cutover, the current Docker deployment remains the rollback path. After native acceptance and Docker removal, recovery consists of rerunning the installer from `/srv/github-runner/agent-relay`, checking journald and the health endpoint, and re-registering only when the runner's native registration was deliberately removed.

## Interfaces and dependencies

The public HTTP job API, workflow inputs, active ExecPlan contract, pull-request resolution, checkout credential cleanup, job outcome model, logging contract, and commit/push finalization remain unchanged.

Deployment interfaces change as follows:

- Compose DNS `agent-relay` becomes `127.0.0.1`;
- Docker volumes become native WSL paths;
- Docker environment configuration becomes a systemd environment file;
- Docker restart policies become enabled systemd services;
- image builds become one idempotent native installer;
- Docker logs become journald logs;
- container startup becomes WSL distribution startup.

## Outcomes & Retrospective

Pending implementation, native WSL acceptance, Docker removal, and final validation.
