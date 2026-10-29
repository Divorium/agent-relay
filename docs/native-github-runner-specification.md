# Native GitHub Runner and Codex Technical Specification

## Scope and authority

Agent Relay runs on a dedicated Debian 13 (Trixie) x86-64 systemd host. Host provisioning, runtime deployment, and GitHub runner connection are declarative Ansible operations with two disjoint entrypoints.

`ansible/playbooks/host.yml` owns the complete host and Agent Relay installation without a PAT. `ansible/playbooks/github-connect.yml` owns only organization runner registration, listener activation, and managed label reconciliation with a PAT. Neither playbook imports or includes the other. Codex CLI installation and authentication are workflow-owned as specified in [job-managed-codex.md](job-managed-codex.md).

There is no Relay HTTP service, polling daemon, separate updater, host installer script, WSL path, migration framework, `.env`, Compose deployment of Agent Relay, or `/opt/agent-relay` copy.

## Responsibility boundaries

### Host playbook and role

`playbooks/host.yml` applies `agent_relay_host`. The role:

- bootstraps Python 3 over SSH as `runneradmin` using play-level sudo escalation;
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

The host role contains no GitHub credential variable, makes no GitHub runner API request, invokes no registration command, and executes no installer script. On a fresh unregistered host it leaves the runner unit disabled and stopped. It no longer installs or updates Codex and does not remove an existing global installation during migration.

### GitHub connection playbook and role

`playbooks/github-connect.yml` applies `agent_relay_github_connection`. The role:

- requires `AGENT_RELAY_GITHUB_CREDENTIAL` on the control machine;
- verifies that host installation already produced runner binaries, runtime, and the systemd unit;
- obtains a short-lived organization registration token through `ansible.builtin.uri`;
- invokes the official runner `config.sh` as `github-runner`;
- registers the organization runner only when registration is absent;
- enables and starts the runner listener;
- reconciles the inventory-selected custom runner labels without changing GitHub-managed labels.

The connection role does not install packages, users, Docker, toolchains, source code, runner binaries, systemd units, or runtime files. It does not invoke `host.yml` or `agent_relay_host`.

A fine-grained PAT needs `Self-hosted runners: Read and write`. A classic PAT needs `admin:org`. GitHub API tasks are delegated to the control machine and use `no_log`; the PAT is never sent to the target, and neither credential is stored there.

## Fixed paths

```text
/srv/github-runner/storage/agent-relay  administrator-owned source; root-owned dist
/srv/github-runner/storage/agent-relay/dist/.agent-relay-source-revision
/srv/github-runner/storage/runner       official GitHub Actions runner
/srv/github-runner/storage/runner/_work github-runner-owned workflow workspaces
/srv/github-runner/storage/home         github-runner home, not job authentication
/srv/github-runner/storage/build-home   builder home and temporary build state
/srv/github-runner/storage/docker/engine
/srv/github-runner/storage/docker/containerd
/srv/github-runner/storage/docker-socket/docker.sock
/srv/github-runner/storage/.agent-relay-dist-stage
```

`/srv/github-runner/storage/runner/_work` is a real directory, not a symlink. Runner payload updates use a verified staging directory and a temporary backup while preserving `_work` and registration files. `dist.previous` exists only during a successful swap or interrupted recovery. The runtime revision marker contains the exact 40-character source commit used to build the active `dist` tree.

The Docker storage parent and containerd root are `root:root` mode `0711`. The daemon-owned Docker data root is `root:root` mode `0710`; Ansible declares this post-startup state rather than restoring a conflicting pre-startup mode.

## Accounts and privilege boundary

- `agent-relay-admin` owns the checkout.
- `agent-relay-builder` has a locked password, `/usr/sbin/nologin`, no sudo, a private build home, and temporary stage ownership.
- `github-runner` has a locked password and no sudo. It runs the official listener and Codex.
- `github-runner` belongs to `docker`; this is intentional root-equivalent host trust.
- Activated runtime files are `root:root`; directories are `0755`, and regular files are `0644`.

Ansible changes only declared host paths and checkout permissions. It declares `/srv/github-runner/storage/runner/_work` as a real runner-owned directory and does not recursively rewrite runner-generated workspace contents, registration state, runner home, Docker data, or activated runtime contents.

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

The launcher also sets `TOKEN_MINIFY_RUN_LOG_DIR` to a `worker-run` directory inside the per-execution private runtime. Neither `/run` nor either socket file is a writable Codex root. Docker-mediated host access is nevertheless outside this filesystem sandbox boundary.

## Host toolchains

The host role owns Node.js 22, Java 21 under `/opt/java/openjdk`, Go under `/usr/local/go`, Rust under `/opt/rust`, TypeScript, Docker Engine, containerd, Buildx, Compose, Git LFS and native runner dependencies. Pinned values remain in `config/runner-host.json`. Codex is not a host toolchain prerequisite: each workflow selects its exact cached CLI version.

`scripts/toolchain-environment.sh` defines the trusted runtime path layout. Every GitHub Actions workflow executes on the managed self-hosted runner, and CI runs `npm run check:toolchain` against that installed environment. Host provisioning relies on the Ansible installation tasks themselves. Removing the Codex prerequisite does not waive failures of the other managed toolchains.

## Runner binary and registration state

Runner binary state is independent from GitHub registration state. The host role inspects required executables and reads the installed version through `Runner.Listener --version`. Missing files, unsafe types, ownership drift or a version mismatch cause reconciliation from the checksum-verified archive. A non-directory or symlinked `bin` path is rejected before extraction.

Registration state is absent when `.runner`, `.credentials` and `.credentials_rsaparams` are all absent; complete when all three are runner-owned regular files mode `0600`; otherwise unsafe or partial and rejected without mutation. This permits host preparation before credentials exist and later releases without a PAT.

## Runtime activation

The reconciled checkout commit is compared with the active runtime revision marker. A missing, unsafe or mismatched marker requires a rebuild even when the checkout already points at the desired commit.

On a required deployment, the host role stops an active listener and waits for `Runner.Worker`, reconciles runner payloads, recovers `dist.previous`, removes stale staging, compiles `tsconfig.runtime.json` as `agent-relay-builder`, records the source revision, imports the staged entrypoint without invoking `main`, finalizes root-owned read-only runtime files and atomically swaps `dist`. Failed activation restores the preserved runtime when safe; success removes `dist.previous`. The listener starts only with complete registration.

Build/import failure leaves the active runtime unchanged. A previously active registered listener is restarted after failure when the old runtime remains valid. An unregistered host remains ready for `github-connect.yml` without an active listener. A workflow may separately use an exact pinned temporary runtime without claiming that the managed host deployment changed.

## Operational sequence

First installation is `host.yml`, then `github-connect.yml`, then consumer acceptance with a workflow-provided `CODEX_TOKEN`. No persistent `codex login` is required. Later host releases run only `host.yml`; `github-connect.yml` is rerun solely for connection/label recovery. CLI upgrades change the consumer's `CODEX_VERSION`, not host provisioning.

## GitHub request flow

The consumer resolves an open same-repository PR and exact head, checks out without credentials, validates its active ExecPlan and invokes a trusted native runtime through `scripts/run-job-codex`. The runtime accepts zero exit only after real command/file-change activity and emits normalized output. Commit/push belongs to the trusted finalizer. Per-PR concurrency prevents simultaneous branch writers.

Codex receives no GitHub push token and must not mutate Git metadata. Activity after the live transcript byte limit is still parsed and counted while further normalized output is discarded. Full application tests must validate the finalized SHA; a native smoke or Codex exit zero is not full-suite evidence.

## Codex boundary

The launcher refuses root execution, validates workflow-selected `CODEX_BINARY`, `CODEX_INSTALL_ROOT` and private `CODEX_HOME`, uses a clean environment, denies host HOME/trusted runtime/general temporary paths to model commands, grants the CLI installation read-only access, keeps authentication denied to model commands and `.git` read-only, and retains selected workspace/tool-state writes, Docker access and network access. Memories are disabled. Exact lifecycle and failure semantics are in [job-managed-codex.md](job-managed-codex.md).

## Validation contract

Self-hosted CI retains strict TypeScript checking, mandatory 100 percent production line/branch/function coverage, runtime compilation, shell/Node checks, complete non-Codex host toolchain validation, and deployment/connection/activation/PAT-isolation contracts. Native cache and launcher tests additionally exercise failure, concurrency, cancellation and cleanup.

Post-deployment acceptance still requires PAT-free host installation, both Docker sockets, Docker access as `github-runner`, correct inventory labels and consumer execution. The native job additionally proves real Codex execution with Docker/Compose, a warm CLI cache, synthetic permission denials and cleaned private state. Successful changed/no-change finalization and exact-SHA application validation remain separate requirements; no host deployment or full E2E pass is inferred from source tests.
