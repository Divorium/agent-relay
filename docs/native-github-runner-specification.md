# Native GitHub Runner and Codex Technical Specification

## Scope and authority

Agent Relay runs on a dedicated Debian 13 (Trixie) x86-64 systemd host. Host initialization and deployment orchestration are declarative Ansible state; runner installation and runtime activation are performed by one reusable `install.sh` invoked by Ansible.

The Ansible entrypoints are deliberately separate. `ansible/playbooks/install.yml` performs the complete host play with runner lifecycle management enabled and requires a GitHub organization PAT. `ansible/playbooks/host.yml` reconciles an already registered host without runner API access or a PAT.

There is no Relay HTTP service, polling daemon, separate updater, WSL compatibility path, host migration framework, `.env`, Compose deployment of Agent Relay, or `/opt/agent-relay` copy.

## Responsibility boundary

### Ansible

The repository role:

- bootstraps Python 3 over root SSH;
- installs sudo, system packages, native runner libraries, and toolchains;
- creates the administrator, `github-runner`, and `agent-relay-builder`;
- creates and reconciles named secure directories;
- configures Docker Engine and containerd data roots and services;
- configures the ordinary Docker socket and a dedicated Codex Docker socket under the runner storage root;
- clones or updates the configured Agent Relay revision as the administrator with `umask 0022`;
- removes group and other write bits from managed checkout files and directories without changing executable bits;
- previews deployment changes, stops the listener, and drains active workers when deployment is required;
- passes the first-registration GitHub credential from the control process to `install.sh` through standard input without persisting it;
- invokes `install.sh` as the administrator;
- reconciles the managed `agent-relay` organization-runner label only when runner lifecycle management is enabled;
- provides `agent_relay_extra_apt_packages` for ordinary additional packages.

`playbooks/install.yml` imports `playbooks/host.yml` with `agent_relay_manage_runner_lifecycle=true`. The default is false, so the recurring host playbook cannot register a missing runner or call the GitHub runner-label API. If registration is absent, `host.yml` fails and directs the operator to `install.yml`.

The role does not authenticate Codex, build `dist` itself, implement runner registration itself, or duplicate installer runtime logic.

### Installer

`install.sh`:

- validates the host prepared by Ansible, including Python 3 and administrator passwordless sudo;
- installs and registers the official organization runner only when the corresponding state is absent;
- installs the root-owned runner systemd unit;
- builds Agent Relay as `agent-relay-builder` into an adjacent stage;
- dynamically imports the compiled entrypoint before listener shutdown;
- atomically replaces `dist` and starts or restarts the runner.

It performs no package installation, user creation, Ansible execution, Docker provisioning, runner dependency helper execution, Git synchronization, repository test suite, or Codex authentication.

## Bootstrap and administrator

The fresh target initially requires Debian 13 x86-64, network access, and root SSH. Ansible bootstraps `/usr/bin/python3`, installs sudo, and creates a configurable administrator with:

- a locked password;
- configured SSH public keys;
- membership in `sudo`;
- a validated root-owned `sudoers.d` rule granting passwordless sudo.

The administrator is a trusted full-host account. The example inventory contains no credential material.

## Fixed paths

```text
/srv/github-runner/storage/agent-relay  administrator-owned source; root-owned dist
/srv/github-runner/storage/work         github-runner-owned workflow workspaces
/srv/github-runner/storage/runner       official GitHub Actions runner
/srv/github-runner/storage/home         github-runner home and Codex authentication
/srv/github-runner/storage/build-home   agent-relay-builder home and writable build state
/srv/github-runner/storage/docker/engine
/srv/github-runner/storage/docker/containerd
/srv/github-runner/storage/docker-socket/docker.sock
/var/lib/agent-relay/install.lock
```

`/srv/github-runner/storage/runner/_work` is a managed symlink to `../work`. Runtime stages are created adjacent to `dist`; the previous `/srv/github-runner/storage/build` path is removed.

The Docker socket directory is owned by `github-runner` and mode `0700`. The socket is created by the root-owned `docker.socket` unit as `root:docker` mode `0660`. The standard `/run/docker.sock` remains available for host operators. The dedicated socket path is defined in `config/runner-host.json` and is the only Docker filesystem root exposed as writable to Codex.

## Accounts and privilege boundary

- The Ansible-created administrator owns the checkout; Ansible performs Git operations and invokes `install.sh` under this account.
- `agent-relay-builder` has a locked password, `/usr/sbin/nologin`, no sudo, a private build home, and temporary ownership of a staged runtime.
- `github-runner` has a locked password and no sudo. It runs the official runner and Codex.
- `github-runner` belongs to the Docker group. This is root-equivalent host trust and is intentional.
- Activated runtime files are root-owned; directories are `0755` and regular files are `0644`.

Ansible changes only declared host paths and the managed source checkout permission contract. It does not recursively rewrite checkout ownership, executable bits, runner payload contents, home, workspace, Docker data, or activated runtime contents. The installer validates these boundaries before mutation.

## Host toolchains and packages

The Ansible role owns package repositories and toolchains:

- Node.js 22 from NodeSource configured with a signed APT source;
- Java 21 from Adoptium with `/opt/java/openjdk` as the stable root;
- Go 1.24.5 from the checksum-verified official archive at `/usr/local/go`;
- Rust through checksum-verified `rustup-init`, using the `stable` toolchain under `/opt/rust`;
- TypeScript 5.8.3 and Codex CLI 0.144.4 under `/usr/local`;
- Docker Engine, containerd, Buildx, and Compose with `state: present` from Docker's signed repository;
- Git LFS and Debian 13 native dependencies required by runner 2.335.1.

Docker and containerd package auto-start is suppressed until their managed configuration, data roots, and socket listeners exist. Configuration changes restart containerd before Docker. A Docker socket drop-in change stops `docker.service`, restarts `docker.socket`, and then starts Docker, allowing `dockerd -H fd://` to receive both managed socket descriptors without a listener ownership race.

`scripts/toolchain-environment.sh` remains the authoritative runtime path layout:

```text
JAVA_HOME       /opt/java/openjdk
Go root         /usr/local/go
Rust Cargo root /opt/rust/cargo
RUSTUP_HOME     /opt/rust/rustup
PATH            /opt/java/openjdk/bin:/usr/local/go/bin:/opt/rust/cargo/bin:/usr/local/bin:/usr/bin:/bin
```

`scripts/codex-run` reads the trusted host contract, verifies the dedicated Docker socket directory and socket type, and adds `DOCKER_HOST=unix:///srv/github-runner/storage/docker-socket/docker.sock` to the clean Codex environment.

## Runner installation contract

Runner binary and registration state are independent.

Binary state is:

- absent: no runner payload markers exist; download and SHA-256 verify runner 2.335.1, then extract as `github-runner` without overwriting the Ansible-managed destination directory mode;
- complete: required executable payload exists and safe runner-generated/self-update state is tolerated;
- partial or conflicting: fail without deletion.

Registration state is:

- absent: `.runner`, `.credentials`, and `.credentials_rsaparams` are all absent;
- complete: all are safe runner-owned regular files;
- partial or conflicting: fail without registration or deletion.

Complete binaries without registration are resumable. Registration uses a short-lived organization registration token obtained from a GitHub credential exported only on the Ansible control machine. `playbooks/install.yml` passes the credential to the installer through standard input with task output suppressed; the credential is not persisted on the target. `playbooks/host.yml` never passes a credential and refuses absent registration.

The runner is configured for `https://github.com/Divorium`, name `gh-runner`, work name `_work`, and default runner self-update behavior.

The systemd unit is root-owned and contains separate `After=network-online.target` and `Wants=network-online.target`, `User=github-runner`, runner working directory and executable, `KillMode=process`, `KillSignal=SIGTERM`, `TimeoutStopSec=5min`, `Restart=always`, `RestartSec=5s`, and `WantedBy=multi-user.target`.

## Runtime activation contract

On every successful installer invocation:

1. reject unresolved `dist.previous`;
2. remove only validated installer-owned stale `.dist.stage.*` directories;
3. create a private adjacent stage owned by `agent-relay-builder`;
4. compile `tsconfig.runtime.json` through a clean environment;
5. reject symlinks, special files, mount crossings, and path escapes;
6. dynamically import staged `src/run-codex.js` as the builder without invoking `main`;
7. finalize the stage as a root-owned read-only runtime tree;
8. stop the listener and wait without killing until no runner-owned `Runner.Worker` remains;
9. rename current `dist` to `dist.previous`, then stage to `dist`;
10. restore `dist.previous` only if the second filesystem rename fails;
11. remove `dist.previous`, enable/restart the service, and wait up to 60 seconds for the runner listener.

Build or import failure leaves the runtime and service untouched by the installer. Listener startup failure is not treated as runtime validation and does not cause runtime rollback.

## Release procedure

First installation uses `ansible/playbooks/install.yml` with `AGENT_RELAY_GITHUB_CREDENTIAL`. Recurring releases use `ansible/playbooks/host.yml` without a PAT. The host role previews repository reconciliation, stops the listener and drains `Runner.Worker` when deployment is required, updates the managed checkout, and invokes `install.sh`. Manual `git pull` and direct installer invocation are not supported release steps.

## GitHub request flow

The workflow is `.github/workflows/codex.yml` and processes one request as follows:

1. `resolve-request.mjs` selects and validates the pull request number from `pull_request` or `workflow_dispatch` input.
2. `resolve-pr.mjs` requires an open non-draft same-repository pull request, validates its head ref and exact SHA, and publishes checkout outputs.
3. `actions/checkout` checks out that exact SHA with `persist-credentials: false`.
4. `resolve-plan.mjs` treats zero added or modified active ExecPlans in a pull request as a successful Codex skip, resolves exactly one, and rejects multiple candidates; manual dispatch continues to require and validate an explicit path.
5. The validation job runs `npm ci` and `npm run check` before Codex execution.
6. `run-codex.mjs` calls the compiled direct runtime.
7. `CodexExecutor` canonicalizes the selected workspace and invokes `scripts/codex-run` with `codex exec --json`, timeout, process-group termination, normalized-output limits, streaming redaction, and filesystem/network permissions.
8. Relay serializes callback-arrival chunks from stdout and stderr and applies bounded backpressure.
9. Relay writes accepted redacted segments to both the live log and `${RUNNER_TEMP}/agent-relay-console.log`; the workflow uploads the latter as `agent-relay-output`.
10. A zero exit is accepted only when the JSONL lifecycle contains at least one `command_execution` or `file_change` item.
11. `finalize.sh` validates the branch and commit message, checks the diff, commits, and pushes through a temporary askpass helper. Codex receives no GitHub token.

The workflow uses the self-hosted organization runner and accepts same-repository pull requests only.

## Codex boundary

The launcher and runtime:

- refuse root execution;
- require manual `github-runner` Codex authentication;
- validate and source the trusted toolchain and host configuration profiles;
- validate that the configured Docker socket root is a non-symlink directory and the socket is a non-symlink Unix socket;
- build a private per-run state hierarchy and start Codex through `env -i`;
- trust only the exact canonical selected workspace;
- deny runner home, trusted source checkout, workspace root, `/tmp`, and `/var/tmp` to model-controlled tools;
- expose `/opt/rust` read-only;
- expose only `/srv/github-runner/storage/docker-socket` as the writable Docker boundary and set `DOCKER_HOST` to its socket child;
- never expose `/run/docker.sock` or `/var/run/docker.sock` as writable filesystem roots;
- grant writes only to the selected repository, dedicated Docker socket directory, and private runtime directory;
- keep the selected repository `.git` directory read-only;
- enable network access and disable memories;
- remove only their own private runtime directory.

The dedicated socket directory is intentionally writable because current Codex bubblewrap creates protected `.codex`, `.git`, and `.agents` metadata targets below each writable root. A Unix socket file cannot be used directly as such a root. The runner already has intentional root-equivalent Docker group trust; this directory does not broaden write access to `/run` or Docker data roots.

## Codex output contract

Raw Codex JSONL is internal and never copied directly to the job log or artifact. Relay validates records across arbitrary byte chunks, normalizes supported item lifecycles, bounds unknown-event notices, and labels stderr diagnostics.

Every normalized physical line begins with `[codex] `. Unsafe controls are visibly encoded. Normalization precedes redaction and output-byte accounting. Transport splitting and queues are bounded and honor Node writable backpressure.

Successful live output and the uploaded transcript are byte-identical. When the normalized redacted budget cannot accept another complete line, Relay keeps the accepted prefix and writes one `[codex] [OUTPUT TRUNCATED]` line to both sinks while continuing bounded protocol validation and drain. Timeout or nonzero process exit remains authoritative.

A zero process exit is not sufficient for semantic success. Relay tracks first-seen `command_execution` and `file_change` lifecycle items. If neither occurs, execution fails with `CODEX_FAILED`, the workflow skips finalization, and the transcript remains available for diagnosis. Output truncation may clear replay/lifecycle state but does not erase the activity count.

`GITHUB_OUTPUT` contains workflow values only. Pre-merge tests exercise the branch runtime with controlled processes; the actual pull-request Codex workflow uses the currently deployed trusted runtime, so final runtime smoke evidence is post-merge and post-deployment.

## Validation contract

The pipeline runs `npm ci` and `npm run check`, including:

- strict TypeScript typechecking;
- Node tests with mandatory 100% coverage of `src/**/*.ts`;
- production runtime compilation;
- shell and Node-script syntax checks;
- host toolchain smoke;
- installer static and simulated system tests;
- static assertions covering the separate install/update playbooks, Ansible deployment, Docker socket, and runner-label contracts; no live Ansible execution or linting.

Post-deployment acceptance additionally requires a real consumer ExecPlan to run `pwd`, Token Minify helpers, `docker version`, `docker compose version`, no-change finalization, and changed-worktree finalization through the same Agent Relay sandbox and workflow path.
