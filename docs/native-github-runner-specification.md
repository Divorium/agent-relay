# Native GitHub Runner and Codex Technical Specification

## Scope and authority

Agent Relay runs on a dedicated Debian 13 (Trixie) x86-64 systemd host. Host provisioning, runtime deployment, and GitHub runner connection are declarative Ansible operations with two disjoint entrypoints.

`ansible/playbooks/host.yml` owns the complete host and Agent Relay installation without a PAT. `ansible/playbooks/github-connect.yml` owns only organization runner registration, listener activation, and managed label reconciliation with a PAT. Neither playbook imports or includes the other.

There is no Relay HTTP service, polling daemon, separate updater, host installer script, WSL path, migration framework, `.env`, Compose deployment of Agent Relay, or `/opt/agent-relay` copy.

## Responsibility boundaries

### Host playbook and role

`playbooks/host.yml` applies `agent_relay_host`. The role:

- bootstraps Python 3 over root SSH;
- installs sudo, system packages, runner dependencies, Docker, and toolchains;
- creates `agent-relay-admin`, `github-runner`, and `agent-relay-builder`;
- creates and reconciles declared secure directories;
- configures Docker Engine and containerd data roots;
- configures `/run/docker.sock` and the dedicated Codex Docker socket;
- downloads and verifies official GitHub Runner binaries;
- installs the runner systemd unit from a template;
- clones or updates the configured repository revision with `umask 0022`;
- removes group and other write bits from managed checkout files and directories;
- builds and atomically activates the Agent Relay runtime;
- restarts the runner listener only when complete registration already exists.

The host role contains no GitHub credential variable, makes no GitHub runner API request, invokes no registration command, and executes no installer script. On a fresh unregistered host it leaves the runner unit disabled and stopped.

### GitHub connection playbook and role

`playbooks/github-connect.yml` applies `agent_relay_github_connection`. The role:

- requires `AGENT_RELAY_GITHUB_CREDENTIAL` on the control machine;
- verifies that host installation already produced runner binaries, runtime, and the systemd unit;
- invokes `scripts/github-connect` as `agent-relay-admin`;
- registers the organization runner only when registration is absent;
- enables and starts the runner listener;
- finds exactly one organization runner named `gh-runner`;
- adds `agent-relay` through the additive runner-label endpoint;
- reads labels back and verifies the managed label.

The connection role does not install packages, users, Docker, toolchains, source code, runner binaries, systemd units, or runtime files. It does not invoke `host.yml` or `agent_relay_host`.

A fine-grained PAT needs `Self-hosted runners: Read and write`. A classic PAT needs `admin:org`. The credential is passed through standard input and authenticated API headers, is hidden from Ansible output, and is never stored on the target.

### GitHub connection script

`scripts/github-connect` is invoked only by the connection role. It:

- acquires `/var/lib/agent-relay/lifecycle/active` atomically;
- validates complete runner binaries, active runtime files, and the service unit;
- validates absent, complete, or partial registration state;
- obtains a short-lived organization registration token only when registration is absent;
- invokes `config.sh` as `github-runner`;
- protects `.runner`, `.credentials`, and `.credentials_rsaparams` with mode `0600`;
- enables and restarts the service;
- waits for `Runner.Listener` readiness;
- releases the lifecycle lock through an exit trap.

It never installs or updates host packages, Docker, toolchains, runner binaries, source checkout, service unit content, or runtime files.

## Fixed paths

```text
/srv/github-runner/storage/agent-relay  administrator-owned source; root-owned dist
/srv/github-runner/storage/agent-relay/dist/.agent-relay-source-revision
/srv/github-runner/storage/runner       official GitHub Actions runner
/srv/github-runner/storage/runner/_work github-runner-owned workflow workspaces
/srv/github-runner/storage/home         github-runner home and Codex authentication
/srv/github-runner/storage/build-home   builder home and temporary build state
/srv/github-runner/storage/docker/engine
/srv/github-runner/storage/docker/containerd
/srv/github-runner/storage/docker-socket/docker.sock
/srv/github-runner/storage/.agent-relay-dist-stage
/var/lib/agent-relay/lifecycle/active
```

`/srv/github-runner/storage/runner/_work` is a real directory, not a symlink. `dist.previous` exists only during a successful swap or interrupted recovery. The runtime revision marker contains the exact 40-character source commit used to build the active `dist` tree.

The Docker storage parent and containerd root are `root:root` mode `0711`. The daemon-owned Docker data root is `root:root` mode `0710`; Ansible declares this post-startup state rather than restoring a conflicting pre-startup mode.

## Accounts and privilege boundary

- `agent-relay-admin` owns the checkout and is the account used by the narrow GitHub connection script.
- `agent-relay-builder` has a locked password, `/usr/sbin/nologin`, no sudo, a private build home, and temporary stage ownership.
- `github-runner` has a locked password and no sudo. It runs the official listener and Codex.
- `github-runner` belongs to `docker`; this is intentional root-equivalent host trust.
- Activated runtime files are `root:root`; directories are `0755`, and regular files are `0644`.

Ansible changes only declared host paths and checkout permissions. During reconciliation it removes the obsolete `/srv/github-runner/storage/work` workspace path after the listener is stopped and workers are drained. Runner registration, runner home, Docker data, and activated runtime contents remain outside that disposable workspace.

## Lifecycle mutual exclusion

Host deployment and GitHub connection share one atomic directory lock. Ansible creates the lock before host mutation and removes it in an `always` block. `scripts/github-connect` creates the same lock before registration inspection and removes it in an exit trap.

A concurrent operation cannot acquire the directory and fails before mutation. An interrupted operation may leave an empty lock directory; recovery requires confirming that no lifecycle process is active before deliberate removal.

## Docker socket boundary

Docker starts through `dockerd -H fd://`. The managed `docker.socket` listener set contains:

```text
/run/docker.sock
/srv/github-runner/storage/docker-socket/docker.sock
```

The dedicated directory is `github-runner`-owned mode `0700`. The socket is `root:docker` mode `0660`. When the socket drop-in changes, Ansible stops Docker, restarts the socket unit, and starts Docker so the old daemon cannot retain inherited descriptors during rebinding.

`scripts/codex-run` validates the directory and socket without following symlinks, exposes only the directory as a writable Codex filesystem root, and sets:

```text
DOCKER_HOST=unix:///srv/github-runner/storage/docker-socket/docker.sock
```

The launcher also sets `TOKEN_MINIFY_RUN_LOG_DIR` to a `worker-run` directory inside the per-execution private runtime. Neither `/run` nor either socket file is a writable Codex root.

## Host toolchains

The host role owns:

- Node.js 22;
- Java 21 under `/opt/java/openjdk`;
- Go 1.24.5 under `/usr/local/go`;
- stable Rust under `/opt/rust`;
- TypeScript 5.8.3;
- Codex CLI 0.144.4;
- Docker Engine, containerd, Buildx, Compose, Git LFS, and native runner dependencies.

`scripts/toolchain-environment.sh` defines the trusted runtime path layout, while `scripts/host-toolchain-check.sh` validates the installed versions during host deployment. Every GitHub Actions workflow executes on the managed self-hosted runner, and CI runs `npm run check:toolchain` against that installed environment.

## Runner binary and registration state

Runner binary state is independent from GitHub registration state.

Binary state:

- absent: the runner directory is empty; `host.yml` downloads and verifies the configured archive;
- complete: all required executable files exist with safe ownership; the runner may perform its supported self-update independently;
- partial: host deployment fails without deleting ambiguous state.

Registration state:

- absent: `.runner`, `.credentials`, and `.credentials_rsaparams` are all absent;
- complete: all three are runner-owned regular files mode `0600`;
- partial or unsafe: both host and connection operations fail without mutation.

This separation allows `host.yml` to finish before GitHub credentials exist and allows every later release to run without a PAT.

## Runtime activation

Deployment preview compares the desired checkout commit with the active runtime revision marker. A missing, unsafe, or mismatched marker forces a rebuild even when the checkout already points at the desired commit. This prevents a failed build from leaving an old `dist` tree that a later run would incorrectly accept.

On every required host deployment, the host role:

1. acquires the lifecycle lock;
2. stops an active listener and waits for `Runner.Worker` processes;
3. reconciles source, runner payload, the real `_work` directory, service unit, toolchains, and Docker state;
4. rejects unresolved `dist.previous`;
5. removes only a validated non-mounted stage path;
6. creates a private stage owned by `agent-relay-builder`;
7. compiles `tsconfig.runtime.json` through a clean environment;
8. validates and records the exact source revision in the stage;
9. verifies the staged entrypoint and imports it without invoking `main`;
10. rejects symlinks and special files in the stage;
11. finalizes and revalidates the stage as root-owned read-only runtime state;
12. renames current `dist` to `dist.previous` and the stage to `dist`;
13. restores `dist.previous` when activation fails and restoration is safe;
14. removes `dist.previous` after success;
15. restarts the listener only for complete registration;
16. releases the lifecycle lock.

Build or import failure leaves the active runtime unchanged. A previously active registered listener is restarted after failure when the previous runtime remains valid. An unregistered host remains ready for `github-connect.yml` without an active listener.

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
7. accepts zero exit only after at least one completed command execution or completed non-empty file change;
8. uploads the normalized transcript;
9. delegates commit and push to the trusted finalizer.

Codex receives no GitHub push token and must not perform Git operations. Activity that appears only after the live transcript reaches its byte limit is still parsed and counted, while additional normalized output is discarded.

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

All GitHub Actions workflows run only on the managed self-hosted organization runner. Pull-request CI accepts same-repository pull requests only and includes:

- strict TypeScript typechecking;
- Node tests with mandatory 100 percent line, branch, and function coverage;
- production runtime compilation;
- shell and Node syntax checks;
- exact managed-host toolchain validation through `npm run check:toolchain`;
- behavioral GitHub connection tests;
- static assertions for direct Ansible host deployment, atomic activation, lifecycle locking, PAT isolation, and disjoint roles.

Post-deployment acceptance additionally requires:

- a successful PAT-free `host.yml` execution;
- both Docker sockets;
- Docker access as `github-runner` through the dedicated endpoint;
- the `agent-relay` label on `gh-runner`;
- Monify PR execution of `pwd`, all Token Minify helpers, `docker version`, and `docker compose version`;
- successful no-change and changed-worktree finalization;
- a later PAT-free `host.yml` run.
