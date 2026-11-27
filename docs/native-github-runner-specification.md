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
- retires the legacy Agent Relay-specific socket override while preserving Docker Engine for other CI jobs;
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
- requires prior successful host installation; the required preflight covers runner binaries, runtime, and the systemd unit, but its current host-preparation check covers only the prepared runner `_work` directory before registration;
- obtains a short-lived organization registration token through `ansible.builtin.uri`;
- invokes the official runner `config.sh` as `github-runner`;
- registers the organization runner when the `.runner` marker is absent;
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
/srv/github-runner/storage/.agent-relay-dist-stage
```

`/srv/github-runner/storage/runner/_work` is a real directory, not a symlink. Runner payload updates use a verified staging directory and a temporary backup while preserving `_work` and registration files. `dist.previous` preserves the previous runtime during activation and may remain after interruption; its recovery and cleanup follow the [runtime deployment conditions](#runtime-activation). The runtime revision marker contains the exact 40-character source commit used to build the active `dist` tree.

The Docker storage parent and containerd root are `root:root` mode `0711`. The daemon-owned Docker data root is `root:root` mode `0710`; Ansible declares this post-startup state rather than restoring a conflicting pre-startup mode.

## Accounts and privilege boundary

- `agent-relay-admin` owns the checkout.
- `agent-relay-builder` has a locked password, `/usr/sbin/nologin`, no sudo, a private build home, and temporary stage ownership.
- `github-runner` has a locked password and no sudo. It runs the official listener and Codex.
- `github-runner` belongs to `docker`; this is intentional root-equivalent host trust.
- Activated runtime files are `root:root`; directories are `0755`, and regular files are `0644`.

Ansible changes only declared host paths and checkout permissions. It declares `/srv/github-runner/storage/runner/_work` as a real runner-owned directory and does not recursively rewrite runner-generated workspace contents, registration state, runner home, Docker data, or activated runtime contents.

## Docker Engine and native Codex

The host role retains Docker Engine and containerd for independent CI jobs. On reconciliation it removes the legacy systemd drop-in `/etc/systemd/system/docker.socket.d/agent-relay.conf` and restarts the packaged Docker socket/service if necessary. It no longer configures an Agent Relay-owned dedicated Docker socket.

Codex runs as a native host process. `scripts/codex-run` neither checks for a Docker socket nor configures `DOCKER_HOST`. The Codex filesystem policy does not grant dedicated socket-directory access. The `worker-run` log directory remains private to each invocation.

## Host toolchains

The host role owns Node.js 22, Java 21 under `/opt/java/openjdk`, Go under `/usr/local/go`, Rust under `/opt/rust`, TypeScript, Docker Engine, containerd, Buildx, Compose, Git LFS and native runner dependencies. Pinned values remain in `config/runner-host.json`. Codex is not a host toolchain prerequisite: each workflow selects its exact cached CLI version.

`scripts/toolchain-environment.sh` defines the trusted runtime path layout. GitHub Actions runs on the managed self-hosted runner. The complete provisioned-host diagnostic, `npm run check:toolchain`, runs independently through the manually dispatched `.github/workflows/host-toolchain.yml`. It is not a prerequisite for Codex execution or Agent Relay's Node.js/TypeScript CI. Host provisioning relies on the Ansible installation tasks themselves. When an application requires Rust, its own build/test job installs the repository-selected Rust toolchain, rather than requiring the Codex launcher to provision a compiler. Host diagnostic failures remain visible when that diagnostic is executed.

## Runner binary and registration state

Runner binary state is independent from GitHub registration state. The required contract checks all required executables, ownership, and version: missing files, unsafe payload types, ownership drift, or a version mismatch require reconciliation from the checksum-verified archive. A non-directory or symlinked `bin` path must be rejected before extraction.

The current host role checks `bin/Runner.Listener` as a regular, non-symlink executable and reads its version with `--version` when those checks pass. A missing or unusable listener, a failed version command, or a version mismatch selects runner payload reconciliation. The broader payload/ownership checks and unsafe `bin` rejection are implementation gaps; they are not established by a successful listener version check.

The required registration-state contract is that `.runner`, `.credentials`, and `.credentials_rsaparams` are either all absent or all runner-owned regular files mode `0600`; unsafe or partial state must be rejected without mutation.

Current host preparation uses `.runner` as the marker: it rejects an unsafe marker and, when present, requires both credential files to be regular non-symlink files, then reconciles ownership and mode. It does not inspect orphan credential files when `.runner` is absent. The connection role registers when the marker is absent, then checks all three file types and sets their ownership and mode. Complete absence detection and rejection rather than normalization of unsafe ownership/modes remain implementation gaps. Host preparation and later releases do not require a PAT.

The current checks are defined in [`deploy.yml`](../ansible/roles/agent_relay_host/tasks/deploy.yml), [`deployment-prepare.yml`](../ansible/roles/agent_relay_host/tasks/deployment-prepare.yml), and the [connection role](../ansible/roles/agent_relay_github_connection/tasks/main.yml).

## Runtime activation

The reconciled checkout commit is compared with the active runtime revision marker. A missing, unsafe or mismatched marker requires a rebuild even when the checkout already points at the desired commit.

After Python bootstrap, the host role stops a registered listener and waits for `Runner.Worker` before its package, toolchain, runner payload, and runtime reconciliation. Runner payload reconciliation is selected by the listener/version checks above. Runtime deployment runs when the entrypoint or revision marker is missing or invalid, or the marker differs from the reconciled source commit. That deployment recovers `dist.previous`, removes stale staging, compiles `tsconfig.runtime.json` as `agent-relay-builder`, records the source revision, imports the staged entrypoint without invoking `main`, finalizes root-owned read-only runtime files and promotes the staged `dist` tree. If the active runtime already matches, the runtime recovery and cleanup tasks are not invoked. Failed activation restores the preserved runtime when safe; success removes `dist.previous`. The listener starts only with complete registration.

Build/import failure leaves the active runtime unchanged. A previously active registered listener is restarted after failure when the old runtime remains valid. An unregistered host remains ready for `github-connect.yml` without an active listener. A workflow may separately use an exact pinned temporary runtime without claiming that the managed host deployment changed.

## Operational sequence

First installation is `host.yml`, then `github-connect.yml`, then consumer acceptance with a workflow-provided `CODEX_TOKEN`. No persistent `codex login` is required. Later host releases run only `host.yml`; `github-connect.yml` is rerun solely for connection/label recovery. CLI upgrades change the consumer's `CODEX_VERSION` and require a reviewed runtime revision with a corresponding trusted version/platform digest in `config/codex-integrity.json`, not host provisioning.

## GitHub request flow

The consumer resolves an open same-repository PR and exact head, checks out without credentials, validates its active ExecPlan and invokes a trusted native runtime through `scripts/run-job-codex`. The runtime accepts zero exit only after real command/file-change activity and emits normalized output. Commit/push belongs to the trusted finalizer. Per-PR concurrency prevents simultaneous branch writers.

Codex receives no GitHub push token and must not mutate Git metadata. Activity after the live transcript byte limit is still parsed and counted while further normalized output is discarded. Full application tests must validate the finalized SHA; a native smoke or Codex exit zero is not full-suite evidence.

## Codex boundary

The launcher refuses root execution, validates workflow-selected `CODEX_BINARY`, `CODEX_INSTALL_ROOT` and private `CODEX_HOME`, uses a clean environment, denies host HOME/trusted runtime/general temporary paths to model commands, grants the CLI installation read-only access, keeps authentication denied to model commands and `.git` read-only, and retains selected workspace/tool-state writes and network access. Memories are disabled. Exact lifecycle and failure semantics are in [job-managed-codex.md](job-managed-codex.md).

## Validation contract

Self-hosted application CI retains strict TypeScript checking, mandatory 100 percent production line/branch/function coverage, runtime compilation, shell/Node checks, and deployment/connection/activation/PAT-isolation contracts. The complete host toolchain validation remains available as a separate manual diagnostic and is not part of the Codex prerequisite gate. Native cache and launcher tests additionally exercise failure, concurrency, cancellation and cleanup.

Post-deployment acceptance requires PAT-free host installation, correct inventory labels and consumer execution. Native Codex acceptance proves successful execution without a Docker socket prerequisite, a warm CLI cache, permission boundaries and cleaned private state. Docker-dependent application CI remains a separate concern. Successful changed/no-change finalization and exact-SHA application validation remain separate requirements; no host deployment or full E2E pass is inferred from source tests.
