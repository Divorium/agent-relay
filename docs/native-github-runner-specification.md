# Native GitHub Runner and Codex Technical Specification

## Goal

Run Agent Relay directly in one fresh Debian WSL installation. The official organization-level GitHub Actions runner is the only long-lived service. It executes the trusted Agent Relay runtime from the administrator-owned repository checkout and gives Codex access only to the selected workflow workspace.

There is no Relay HTTP service, queue, polling loop, persisted job state, Docker image, Compose deployment, `.env`, or `/opt/agent-relay` copy.

## Fixed paths

All Agent Relay and GitHub Runner data is grouped below the single root-controlled root `/srv/github-runner/storage`. This is an explicit architecture decision shared by the ExecPlan, README files, installer, updater, and tests.

```text
/srv/github-runner/storage/agent-relay  administrator-owned source and compiled runtime
/srv/github-runner/storage/work         github-runner-owned workflow workspaces
/srv/github-runner/storage/runner       official GitHub Actions runner
/srv/github-runner/storage/home         github-runner home and Codex authentication
/srv/github-runner/storage/build        temporary isolated builds and per-update tool state
/srv/github-runner/storage/build-home   builder home
```

The storage root itself is a regular `root:root` directory and is not writable by group or other identities. Transaction paths placed directly below it therefore cannot be created or replaced by the administrator, builder, or runner without sudo. The `build` and `build-home` children are regular `agent-relay-builder:agent-relay-builder` directories with mode `0700`.

The runner is configured with work name `_work`. `/srv/github-runner/storage/runner/_work` is a symlink to `../work`, so GitHub's official runner resolves its normal relative work path to `/srv/github-runner/storage/work`.

The six child directories are separated by responsibility and ownership: source/runtime, workflow workspaces, runner binaries and registration state, runner home and Codex authentication, disposable build staging and state, and builder home.

Every workflow checkout selected below `/srv/github-runner/storage/work` is treated as a trusted Codex project. The runtime uses the canonical exact checkout path rather than a wildcard, so the first invocation in each new workspace is non-interactive and project-local Codex configuration, hooks, and execution policies are enabled for that checkout.

## Accounts and privilege boundary

Three identities are used:

- the Debian administrator owns the source checkout, performs the one-time installation, and runs updates;
- `agent-relay-builder` has a locked password, no interactive shell, and no sudo access; it performs dependency installation, compilation, tests, syntax validation, and toolchain smoke checks;
- `github-runner` has a locked password and no sudo access; systemd runs the official runner and Codex as this account.

The source checkout is readable and executable by the two service accounts but writable only by the administrator. The activated `dist` directory is a regular tree containing only directories and singly linked regular files; every entry is owned by root and is read-only to the service accounts. The workflow workspace is owned by `github-runner`.

`/etc/agent-relay/administrator` is a regular, non-symlink `root:root` trust-anchor file that is not writable by group or other identities. Its content selects the only administrator account permitted to execute updates.

Neither Codex nor code executed during a build can use the administrator's cached sudo authentication because they run as different accounts which are explicitly verified not to have passwordless sudo.

## User flow

### First installation

```bash
cd /srv/github-runner/storage/agent-relay
./install.sh
```

`install.sh` performs one-time host setup. If it enables systemd in `/etc/wsl.conf`, the user then runs `wsl --shutdown` from Windows and starts Debian again.

The installation is activated with:

```bash
cd /srv/github-runner/storage/agent-relay
./update.sh
```

The installer is not rerun after the WSL restart and is not used for normal releases.

### Later releases

```bash
cd /srv/github-runner/storage/agent-relay
./update.sh
```

No runner re-registration, PAT prompt, Codex re-login, or WSL shutdown is expected during an ordinary update.

## Installer contract

`install.sh` must:

- accept no arguments and refuse root execution;
- require Debian x86-64 and the exact source location `/srv/github-runner/storage/agent-relay`;
- configure only the `[boot] systemd=true` setting when WSL does not yet run systemd;
- validate and source the trusted `scripts/toolchain-environment.sh` profile before installing or checking host toolchains;
- install the pinned system toolchains and build dependencies at the immutable roots defined by that profile;
- create the locked `github-runner` and `agent-relay-builder` accounts and remove them from the `sudo` group if necessary;
- verify that neither service account can run `sudo -n true`;
- prepare all six fixed directories below `/srv/github-runner/storage` with the required ownership;
- reject trusted entrypoints and the toolchain profile when they are symlinks, and update ownership without dereferencing repository symlinks;
- download and SHA-256 verify the official GitHub Actions runner archive;
- request one hidden organization PAT only when registration is absent;
- exchange that PAT for a short-lived organization runner registration token without placing the PAT in process arguments or files;
- register `gh-runner` for `https://github.com/Divorium`, with `_work` and no custom labels;
- create a root-owned systemd unit that runs as `github-runner`;
- install the root-owned administrator trust file;
- perform Codex login as `github-runner` only when authentication is absent;
- prepare, but not enable or start, the service. Activation belongs to a successful `update.sh` transaction.

Pinned downloads and packages are:

- GitHub Actions Runner `2.335.1`, SHA-256 `4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf`;
- Go `1.24.5`, SHA-256 `10ad9e86233e74c0f6590fe5426895de6bf388964210eac34a6d83f38918ecdc`;
- TypeScript `5.8.3`;
- Codex CLI `0.144.4`;
- Node.js 22 and Java 21.

## Toolchain environment contract

`scripts/toolchain-environment.sh` is the sole source of the immutable host toolchain roots and canonical executable ordering:

```text
JAVA_HOME       /opt/java/openjdk
Go root         /usr/local/go
Rust Cargo root /opt/rust/cargo
RUSTUP_HOME     /opt/rust/rustup
PATH            /opt/java/openjdk/bin:/usr/local/go/bin:/opt/rust/cargo/bin:/usr/local/bin:/usr/bin:/bin
```

The profile has no side effects when sourced. It does not create directories or execute commands. Its environment constructor validates a target identity, home, and absolute writable state root, then returns an ordered Bash array suitable for `/usr/bin/env -i`.

The common clean environment contains explicit identity and locale values, the immutable Java and rustup bindings, canonical `PATH`, and state paths for Cargo, Go, Gradle, npm, pip, XDG, and temporary files. Every writable path is below the caller-supplied state root. Shared installations remain root-managed and readable; build and Codex processes never write caches or configuration into `/opt/java`, `/usr/local/go`, `/opt/rust/cargo`, or `/opt/rust/rustup`.

Caller-specific policy remains outside the profile. The updater adds expected-version inputs to the smoke command. The Codex launcher adds Git restrictions and its runtime permission configuration.

## Update transaction

`update.sh` must:

1. accept no arguments and refuse root execution;
2. when re-executed after a pull, validate and load the original revision and prior service-active state before any later preflight can fail, so rollback can still restore both;
3. require `/etc/agent-relay/administrator` to be a readable regular non-symlink `root:root` file not writable by group or others, then require the current account to match its validated content;
4. require systemd and service accounts without passwordless sudo;
5. before any worktree-inspecting Git command or service stop, require a regular root-owned storage root not writable by group or others, require `build` and `build-home` to be private `agent-relay-builder` directories, require every source path except `dist` to belong to the recorded administrator, and require any existing active `dist` to be a safe, entirely root-owned runtime tree;
6. inspect Git status with explicit command-failure handling and require a clean checkout;
7. stop the runner when it is active;
8. record the current Git revision, run `git pull --ff-only` with repository hooks disabled, and re-execute `update.sh` from the pulled revision;
9. reject a missing or symlinked shared toolchain profile, source it from the selected revision, and have `agent-relay-builder` create its own isolated build workspace, staged runtime, and private writable state hierarchy below `/srv/github-runner/storage/build`;
10. construct the builder environment once from the shared profile and execute every builder-owned copy, dependency, compilation, test, syntax, and smoke command through `sudo -u agent-relay-builder -H /usr/bin/env -i` with that environment;
11. run `npm ci`, TypeScript compilation, the full Node test suite, the 100% line/branch/function coverage gates, shell syntax checks, Node script syntax checks, and the Codex/toolchain smoke test;
12. require that no process owned by `agent-relay-builder` remains after validation, then repeat the fail-closed storage-root, builder-root, source-ownership, and active-runtime checks immediately before activation;
13. reject staged runtime symbolic links, special files, and regular files with multiple hard links;
14. move the validated staged runtime into a transaction path directly below `/srv/github-runner/storage`, immediately change the transaction root to `root:root` mode `0700`, adopt the complete tree with a physical, filesystem-bounded, non-dereferencing traversal, verify resulting root ownership, and retain the previous runtime in a separate root-controlled rollback path outside the source checkout;
15. atomically move the prepared runtime into the source checkout while keeping the previous runtime available for rollback;
16. reject symlinked trusted entrypoints and harden source permissions without following repository symlinks;
17. daemon-reload, enable, start, and verify the runner service;
18. delete the previous runtime only after the service is confirmed active.

Ownership and status checks are fail-closed. Failure of `git status`, `find`, `stat`, or another required ownership inspection is not interpreted as a clean or correctly owned state. An ownership mismatch reports the first offending path together with owner, group, mode, type, and link count before rollback can remove or relocate transient state.

The active runtime and both transaction paths remain outside the builder-owned build root during privileged ownership adoption and activation. The rollback and activation names are private to the transaction and are created under the verified root-owned storage parent. Runtime ownership changes use `find -P -xdev` and `chown -h`; recursive dereferencing ownership changes are prohibited.

The builder environment must not depend on the administrator's shell profile, inherited environment, or the distribution-specific `sudo` secure path. It receives the same immutable Java, Go, and Rust configuration as the Codex runtime, but uses a separate per-update writable state root. An ordinary update must consume the existing host installations without reinstalling toolchains, creating repair symlinks, running `rustup default`, rerunning `install.sh`, or re-registering the runner.

Any failure before commit restores the original Git revision, removes staged build, activation, and state data, restores the previous `dist` when a swap occurred, and restarts a service that had been active before the update. Because re-execution state is loaded before ownership preflight, this rollback remains available when a newly pulled updater rejects existing host ownership.

## GitHub request flow

The workflow processes one request as follows:

1. `resolve-request.mjs` selects and validates the pull request number from `pull_request` or `workflow_dispatch` input.
2. `resolve-pr.mjs` queries GitHub, requires an open non-draft same-repository pull request, validates its head ref and exact SHA, and publishes checkout outputs.
3. `actions/checkout` checks out that exact SHA with `persist-credentials: false`.
4. `resolve-plan.mjs` requires exactly one added or modified active ExecPlan for a pull request, or validates the explicit dispatch path.
5. `run-codex.mjs` calls the compiled direct runtime.
6. `CodexExecutor` canonicalizes the selected workspace, applies `projects={"<workspace>"={trust_level="trusted"}}`, and invokes `scripts/codex-run` with timeout, process-group termination, output limits, streaming redaction, and filesystem/network permissions.
7. `finalize.sh` validates the branch and commit message, checks the diff, commits, and pushes through a temporary askpass helper. Codex receives no GitHub token.

The workflow runs only same-repository pull requests and uses `runs-on: [self-hosted]` without custom labels.

## Codex boundary

The launcher and runtime:

- refuse root execution;
- require the `github-runner` Codex authentication file;
- validate and source the same trusted toolchain profile used by installation and updates;
- build a private per-run state hierarchy and construct the common environment from that root;
- start Codex through `env -i` with explicit identity, locale, immutable toolchain configuration, and writable state paths;
- trust the exact canonical selected workspace before `exec`, including its first invocation;
- do not trust paths merely because they share a textual prefix; the existing realpath workspace validation must first prove that the checkout is below the configured runner workspace root;
- deny the runner home, trusted source checkout, entire runner workspace root, `/tmp`, and `/var/tmp` to model-controlled tools;
- expose `/opt/rust` read-only;
- grant writes only to the selected repository and private runtime directory;
- keep the selected repository's `.git` directory read-only;
- enable network access and disable memories;
- remove only their own private runtime directory.

## Validation contract

`npm run check` includes:

- strict TypeScript typechecking and compilation;
- all Node unit and integration tests;
- mandatory 100% line, branch, and function coverage for `src/**/*.ts` runtime code;
- exact canonical project trust verification before `exec`, including quoted paths and a mock launcher process;
- installed Codex CLI parsing of the inline trusted-project profile in the toolchain smoke test;
- shell and Node-script syntax validation, including the shared toolchain profile;
- fixed-layout, ownership-transaction, re-execution rollback, and toolchain-profile consistency checks across the ExecPlans, README files, installer, updater, launcher, and tests;
- focused regression tests for the administrator trust file, storage and builder roots, active runtime, builder process quiescence, builder-created staging paths, early re-execution state loading, and root-locking of the activation stage;
- a system-level mocked `install.sh` execution that verifies all six storage directories, the `runner/_work -> ../work` symlink, and that installation roots come from the trusted profile;
- a system-level mocked `update.sh` execution that models the root-owned trust anchors and runtime invariants, verifies transaction-path cleanup, and uses Java, Go, and Rust fixtures executable only when the clean environment provides their required configuration and writable state, while covering successful activation, pre-swap test and build failure rollback, and post-swap service-start failure rollback.

The full-flow integration test creates a real local Git remote and pull-request branch, serves a mock GitHub pull-request API, resolves the request and active plan, checks out the exact revision, invokes a mock Codex executable through the real runtime, finalizes the change, pushes it, and verifies the resulting remote commit.

The deterministic suite applies the 100% line, branch, and function gates to the TypeScript runtime. Bash installers and launchers plus the standalone Node runner scripts are validated through syntax checks and dedicated integration harnesses rather than being included in the TypeScript coverage denominator.

These deterministic tests do not replace target-host acceptance. Live WSL package installation, systemd activation, organization registration, Codex authentication, runner-group access, and a real GitHub-hosted request require the actual target machine and credentials.
