# Native GitHub Runner and Codex Technical Specification

## Scope and authority

Agent Relay runs on a dedicated Debian 13 (Trixie) x86-64 systemd host. Host provisioning, runtime deployment, and GitHub runner connection are declarative Ansible operations with two disjoint entrypoints.

`ansible/playbooks/host.yml` owns the complete host and Agent Relay installation. `ansible/playbooks/github-connect.yml` owns only organization runner registration, listener activation, and managed label reconciliation. Neither playbook imports or includes the other.

There is no Relay HTTP service, polling daemon, separate updater, WSL path, host migration framework, `.env`, Compose deployment of Agent Relay, or `/opt/agent-relay` copy.

## Responsibility boundaries

### Host playbook and role

`playbooks/host.yml` applies `agent_relay_host`. The role:

- bootstraps Python 3 over root SSH;
- installs sudo, system packages, runner dependencies, Docker, and toolchains;
- creates `agent-relay-admin`, `github-runner`, and `agent-relay-builder`;
- creates and reconciles declared secure directories;
- configures Docker Engine and containerd data roots;
- configures `/run/docker.sock` and the dedicated Codex Docker socket;
- installs official GitHub Runner binaries when absent;
- installs the runner systemd unit;
- clones or updates the configured repository revision with `umask 0022`;
- removes group and other write bits from managed checkout files and directories;
- builds and atomically activates the Agent Relay runtime;
- restarts the runner listener only when complete registration already exists.

The host role has no GitHub credential variable, makes no GitHub runner API request, and performs no runner registration. On a fresh unregistered host it leaves the runner unit disabled and stopped after installation.

### GitHub connection playbook and role

`playbooks/github-connect.yml` applies `agent_relay_github_connection`. The role:

- requires `AGENT_RELAY_GITHUB_CREDENTIAL` on the control machine;
- verifies that host installation already produced runner binaries, runtime, and the systemd unit;
- invokes `scripts/github-connect` as `agent-relay-admin`;
- registers the organization runner only when registration is absent;
- enables and starts the runner listener;
- finds exactly one organization runner named `gh-runner`;
- adds `agent-relay` through the additive runner-label endpoint;
- reads the labels back and verifies the managed label.

The connection role does not install packages, users, Docker, toolchains, source code, runner binaries, systemd units, or runtime files. It does not invoke `install.sh`, `host.yml`, or `agent_relay_host`.

A fine-grained PAT needs `Self-hosted runners: Read and write`. A classic PAT needs `admin:org`. The credential is passed through standard input and authenticated API headers, is hidden from Ansible output, and is never stored on the target.

### Host installer

`install.sh` is invoked only by the host role. It:

- validates host state prepared by Ansible;
- downloads and verifies the official runner archive when runner binaries are absent;
- preserves the Ansible-managed runner directory mode;
- installs the root-owned runner systemd unit;
- builds Agent Relay as `agent-relay-builder` into an adjacent private stage;
- validates the stage before listener shutdown;
- atomically replaces the active runtime;
- restarts the listener only when protected registration files are already complete;
- disables and stops the unit when registration is absent.

It never reads a GitHub credential, obtains a registration token, or invokes `config.sh` for registration.

### GitHub connection script

`scripts/github-connect` is invoked only by the connection role. It:

- acquires the same installation lock used by `install.sh`;
- validates complete runner binaries, active runtime files, and the service unit;
- validates absent, complete, or partial registration state;
- obtains a short-lived organization registration token only when registration is absent;
- invokes `config.sh` as `github-runner`;
- protects `.runner`, `.credentials`, and `.credentials_rsaparams` with mode `0600`;
- enables and restarts the service;
- waits for `Runner.Listener` readiness.

It never installs or updates host packages, Docker, toolchains, runner binaries, source checkout, service unit content, or runtime files.

## Fixed paths

```text
/srv/github-runner/storage/agent-relay  administrator-owned source; root-owned dist
/srv/github-runner/storage/work         github-runner-owned workflow workspaces
/srv/github-runner/storage/runner       official GitHub Actions runner
/srv/github-runner/storage/home         github-runner home and Codex authentication
/srv/github-runner/storage/build-home   builder home and temporary build state
/srv/github-runner/storage/docker/engine
/srv/github-runner/storage/docker/containerd
/srv/github-runner/storage/docker-socket/docker.sock
/var/lib/agent-relay/install.lock
```

`/srv/github-runner/storage/runner/_work` is a managed symlink to `../work`. Runtime stages are adjacent to `dist`; `dist.previous` exists only during a successful swap or interrupted recovery.

## Accounts and privilege boundary

- `agent-relay-admin` owns the checkout, performs Ansible-managed Git operations, and invokes trusted lifecycle scripts with passwordless sudo.
- `agent-relay-builder` has a locked password, `/usr/sbin/nologin`, no sudo, a private build home, and temporary stage ownership.
- `github-runner` has a locked password and no sudo. It runs the official listener and Codex.
- `github-runner` belongs to `docker`; this is intentional root-equivalent host trust.
- Activated runtime files are `root:root`; directories are `0755`, and regular files are `0644`.

Ansible changes only declared host paths and checkout permissions. It does not recursively rewrite runner-generated state, workspaces, runner home, Docker data, or activated runtime contents.

## Docker socket boundary

Docker starts through `dockerd -H fd://`. The managed `docker.socket` listener set contains:

```text
/run/docker.sock
/srv/github-runner/storage/docker-socket/docker.sock
```

The dedicated directory is `github-runner`-owned mode `0700`. The socket is `root:docker` mode `0660`. When the socket drop-in changes, Ansible stops `docker.service`, restarts `docker.socket`, and starts Docker so the old daemon cannot retain inherited descriptors during rebinding.

`scripts/codex-run` validates the directory and socket without following symlinks, exposes only the directory as a writable Codex filesystem root, and sets:

```text
DOCKER_HOST=unix:///srv/github-runner/storage/docker-socket/docker.sock
```

Neither `/run` nor either socket file is a writable Codex root.

## Host toolchains

The host role owns:

- Node.js 22;
- Java 21 under `/opt/java/openjdk`;
- Go 1.24.5 under `/usr/local/go`;
- stable Rust under `/opt/rust`;
- TypeScript 5.8.3;
- Codex CLI 0.144.4;
- Docker Engine, containerd, Buildx, Compose, Git LFS, and native runner dependencies.

`scripts/toolchain-environment.sh` defines the trusted runtime path layout.

## Runner binary and registration state

Runner binary state is independent from GitHub registration state.

Binary state:

- absent: no required payload markers; `host.yml` downloads and verifies the runner archive;
- complete: all required executable files exist with safe ownership and mode;
- partial: installation fails without deleting state.

Registration state:

- absent: `.runner`, `.credentials`, and `.credentials_rsaparams` are all absent;
- complete: all three are runner-owned regular files mode `0600`;
- partial or unsafe: both host and connection operations fail without mutation.

This separation allows `host.yml` to finish before GitHub credentials exist and allows every later release to run without a PAT.

## Runtime activation

On every required host deployment, `install.sh`:

1. rejects unresolved `dist.previous`;
2. removes only validated installer-owned stale stages;
3. creates a private adjacent stage owned by `agent-relay-builder`;
4. compiles `tsconfig.runtime.json` through a clean environment;
5. rejects symlinks, special files, mount crossings, and path escapes;
6. imports staged `src/run-codex.js` without invoking `main`;
7. finalizes the stage as root-owned read-only runtime state;
8. stops an active listener and waits for `Runner.Worker` processes;
9. renames current `dist` to `dist.previous` and the stage to `dist`;
10. restores `dist.previous` when the second rename fails;
11. removes `dist.previous` after success;
12. restarts the listener only for complete registration.

Build or import failure leaves the current runtime and listener untouched. An unregistered host remains ready for `github-connect.yml` without an active listener.

## Operational sequence

First installation:

```text
host.yml
  -> github-connect.yml
  -> explicit Codex login
  -> Monify consumer acceptance
```

Later releases:

```text
host.yml
```

`github-connect.yml` is rerun only for connection or managed-label recovery. It is not a release deployment step.

## GitHub request flow

The consumer workflow:

1. resolves an open same-repository pull request and exact head SHA;
2. checks out with `persist-credentials: false`;
3. resolves exactly one active ExecPlan or performs the defined no-plan skip;
4. runs repository validation;
5. invokes the installed Agent Relay runtime;
6. runs Codex through `scripts/codex-run` with normalized JSONL output;
7. accepts zero exit only after at least one first-seen `command_execution` or `file_change` event;
8. uploads the normalized transcript;
9. delegates commit and push to the trusted finalizer.

Codex receives no GitHub push token and must not perform Git operations.

## Codex boundary

The launcher:

- refuses root execution;
- requires explicit Codex authentication for `github-runner`;
- uses a clean environment;
- denies runner home, trusted source, workspace root, `/tmp`, and `/var/tmp` to model-controlled tools;
- exposes `/opt/rust` read-only;
- grants writes only to the selected repository, private runtime state, and the dedicated Docker socket directory;
- keeps the selected `.git` directory read-only;
- enables network access and disables memories.

## Validation contract

CI runs:

- strict TypeScript typechecking;
- Node tests with mandatory 100 percent line, branch, and function coverage;
- production runtime compilation;
- shell and Node syntax checks;
- host toolchain smoke;
- behavioral lifecycle tests for host installation and GitHub connection;
- static assertions that the two Ansible playbooks and roles are disjoint;
- installer and system integration tests.

Post-deployment acceptance additionally requires:

- both Docker sockets;
- Docker access as `github-runner` through the dedicated endpoint;
- the `agent-relay` label on `gh-runner`;
- Monify PR execution of `pwd`, all Token Minify helpers, `docker version`, and `docker compose version`;
- successful no-change and changed-worktree finalization;
- a later PAT-free `host.yml` run.
