# Native GitHub Runner and Codex Technical Specification

## Scope and authority

This document describes the currently implemented production architecture. The current production host is a dedicated Debian 13 systemd virtual machine under Hyper-V. Active ExecPlans describe proposed changes; completed ExecPlans are historical records and are not current architecture specifications.

The virtual machine is the production containment boundary. It does not depend on shared Windows folders. The official organization-level GitHub Actions runner is the only long-lived Agent Relay service. It executes the trusted runtime from the administrator-owned repository checkout and gives Codex direct access only to the selected workflow workspace.

There is currently no Relay HTTP service, queue, polling loop, persisted job state, Docker integration, Compose deployment, `.env`, or `/opt/agent-relay` copy.

## Fixed paths

All Agent Relay and GitHub Runner application data is grouped below `/srv/github-runner/storage`:

```text
/srv/github-runner/storage/agent-relay  administrator-owned source and root-owned compiled runtime
/srv/github-runner/storage/work         github-runner-owned workflow workspaces
/srv/github-runner/storage/runner       official GitHub Actions runner
/srv/github-runner/storage/home         github-runner home and Codex authentication
/srv/github-runner/storage/build        disposable update leftovers
/srv/github-runner/storage/build-home   builder home
```

The storage root is a regular `root:root` directory not writable by group or other identities. `build` and `build-home` are private `agent-relay-builder:agent-relay-builder` directories with mode `0700`. The updater may delete and recreate `build`; no persistent update state is stored there.

The runner is configured with work name `_work`. `/srv/github-runner/storage/runner/_work` is a symlink to `../work`, so the official runner resolves its relative work path to `/srv/github-runner/storage/work`.

Every workflow checkout below `/srv/github-runner/storage/work` is treated as a trusted Codex project only after canonical path validation. The exact selected checkout is trusted, not a wildcard or textual prefix.

## Accounts and privilege boundary

Three identities are used:

- the Debian administrator owns the source checkout, performs one-time installation, updates the checkout explicitly, and invokes `update.sh`;
- `agent-relay-builder` has a locked password, no interactive shell, and no sudo access; during update it compiles the production runtime directly into the `dist` directory created for that identity;
- `github-runner` has a locked password and no sudo access; systemd runs the official runner and Codex as this account, and GitHub Actions pipeline commands execute in its workflow workspaces.

The source checkout is readable by both service accounts but writable only by the administrator. During compilation `dist` is temporarily builder-owned and mode `0700`. After compilation every runtime entry is changed to `root:root`; directories are mode `0755` and regular files are mode `0644`.

`/etc/agent-relay/administrator` is a regular non-symlink `root:root` trust-anchor file not writable by group or other identities. Its content selects the only administrator account permitted to run updates.

Neither service account can use the administrator's cached sudo authentication. Both accounts are explicitly kept out of sudo and are verified not to have passwordless sudo access.

## User flow

### First installation

```bash
cd /srv/github-runner/storage/agent-relay
./install.sh
./update.sh
```

`install.sh` performs one-time host, service-account, runner, systemd-unit, toolchain, and Codex-authentication setup. The production Debian VM already runs systemd as PID 1.

The installer retains WSL compatibility. When it detects WSL without systemd, it may configure `[boot] systemd=true`; only that compatibility path requires `wsl --shutdown` before `./update.sh`.

The installer is not rerun for ordinary releases.

### Later releases

```bash
cd /srv/github-runner/storage/agent-relay
git pull --ff-only
./update.sh
```

Git synchronization is always an explicit operator action. `update.sh` performs no Git command and does not require a clean checkout.

## Installer contract

`install.sh` must:

- accept no arguments and refuse root execution;
- require Debian x86-64 and `/srv/github-runner/storage/agent-relay`;
- require systemd for the production VM and retain the explicit WSL compatibility path described above;
- validate and source `scripts/toolchain-environment.sh` before installing or checking host toolchains;
- install the pinned system toolchains and build dependencies;
- create locked `github-runner` and `agent-relay-builder` accounts and remove sudo access;
- prepare all six fixed storage paths with their required ownership;
- reject symlinked trusted entrypoints and change source ownership without following repository symlinks;
- download and SHA-256 verify the official runner archive;
- request an organization PAT only when runner registration is absent and exchange it for a short-lived registration token;
- register `gh-runner` for `https://github.com/Divorium` with `_work` and no custom labels;
- install a root-owned systemd unit with `KillMode=process` so stopping the listener does not terminate an already running `Runner.Worker`;
- install the root-owned administrator trust file;
- perform Codex login as `github-runner` only when authentication is absent;
- prepare, but not enable or start, the service. The first `update.sh` builds and activates the runtime.

Pinned versions are GitHub Actions Runner `2.335.1`, Go `1.24.5`, TypeScript `5.8.3`, Codex CLI `0.144.4`, Node.js 22, and Java 21.

## Toolchain environment contract

`scripts/toolchain-environment.sh` defines immutable host toolchain roots and executable ordering:

```text
JAVA_HOME       /opt/java/openjdk
Go root         /usr/local/go
Rust Cargo root /opt/rust/cargo
RUSTUP_HOME     /opt/rust/rustup
PATH            /opt/java/openjdk/bin:/usr/local/go/bin:/opt/rust/cargo/bin:/usr/local/bin:/usr/bin:/bin
```

The profile has no side effects when sourced. It constructs an ordered environment array with explicit identity, locale, immutable toolchain paths, and writable state paths below a caller-supplied root.

Installation, Codex execution, and the pipeline toolchain smoke use this profile. The simplified updater does not source it because runtime compilation requires only the pinned `/usr/local/bin/tsc`, the builder home, locale, and standard executable path.

## Runtime update contract

`update.sh` must:

1. accept no arguments and refuse root execution;
2. require the exact repository location, protected administrator file, recorded administrator identity, systemd as PID 1, builder and runner accounts, `/usr/local/bin/tsc`, `/usr/bin/ps`, and `tsconfig.runtime.json`;
3. perform no Git command and impose no clean-worktree requirement;
4. acquire sudo credentials and register only sudo-cache invalidation as process cleanup, never runtime or service rollback;
5. stop `actions.runner.Divorium.gh-runner.service` before waiting, preventing the listener from accepting another job;
6. resolve the numeric effective UID of `github-runner`, inspect the complete process table through `/usr/bin/ps -e -o euid=,comm=`, fail when that command fails, and wait without a timeout only while a row matches both that UID and `Runner.Worker`;
7. delete and recreate `/srv/github-runner/storage/build` as a private builder-owned directory, discarding previous update leftovers;
8. delete `/srv/github-runner/storage/agent-relay/dist` completely and recreate it as `agent-relay-builder:agent-relay-builder` mode `0700`;
9. invoke only `/usr/local/bin/tsc -p tsconfig.runtime.json --outDir dist` as `agent-relay-builder` through `env -i` with explicit identity, home, locale, and path;
10. require `dist/src/run-codex.js` to exist;
11. change the runtime tree to `root:root`, set directories to `0755`, and set regular files to `0644` through physical filesystem-bounded traversal;
12. enable and start the runner unit, require it to become active, and display its status.

The updater does not run `npm ci`, tests, coverage, shell checks, Node checks, system tests, or toolchain smoke. Those are pipeline responsibilities.

The updater has no stage, backup, activation move, transaction journal, recovery, or rollback. If any step fails, the service may remain stopped and `dist` may be absent or partial. The next invocation deletes `dist` and compiles it again from zero.

## GitHub request flow

The workflow is `.github/workflows/codex.yml` and processes one request as follows:

1. `resolve-request.mjs` selects and validates the pull request number from `pull_request` or `workflow_dispatch` input.
2. `resolve-pr.mjs` requires an open non-draft same-repository pull request, validates its head ref and exact SHA, and publishes checkout outputs.
3. `actions/checkout` checks out that exact SHA with `persist-credentials: false`.
4. `resolve-plan.mjs` requires exactly one added or modified active ExecPlan for a pull request, or validates the explicit dispatch path.
5. The validation job runs `npm ci` and `npm run check` before Codex execution.
6. `run-codex.mjs` calls the compiled direct runtime.
7. `CodexExecutor` canonicalizes the selected workspace and invokes `scripts/codex-run` with timeout, process-group termination, output limits, streaming redaction, and filesystem/network permissions.
8. Standard output and standard error pass through `tee` into `${RUNNER_TEMP}/agent-relay-console.log`, which is uploaded as the existing `agent-relay-output` artifact.
9. `finalize.sh` validates the branch and commit message, checks the diff, commits, and pushes through a temporary askpass helper. Codex receives no GitHub token.

The workflow runs only same-repository pull requests and uses `runs-on: [self-hosted]` without custom labels.

## Codex boundary

The launcher and runtime:

- refuse root execution;
- require the `github-runner` Codex authentication file;
- validate and source the trusted toolchain profile;
- build a private per-run state hierarchy and start Codex through `env -i`;
- trust only the exact canonical selected workspace;
- deny the runner home, trusted source checkout, entire runner workspace root, `/tmp`, and `/var/tmp` to model-controlled tools;
- expose `/opt/rust` read-only;
- grant writes only to the selected repository and private runtime directory;
- keep the selected repository's `.git` directory read-only;
- enable network access and disable memories;
- remove only their own private runtime directory.

## Validation contract

The GitHub Actions pipeline runs `npm ci` and `npm run check`. The check suite includes:

- strict TypeScript typechecking;
- compilation of source and tests followed by all Node tests;
- mandatory 100% line, branch, and function coverage for `src/**/*.ts`;
- production-only compilation through `tsconfig.runtime.json` into a disposable directory with `src/run-codex.js` required;
- shell and Node-script syntax checks;
- the real managed toolchain smoke with isolated writable state;
- system-level mocked installation and simplified update executions;
- updater contract checks proving there are no Git, validation-suite, staging, backup, recovery, or rollback operations;
- a system update test proving listener stop before worker inspection, idle and listener-only continuation, UID-scoped worker waiting, fail-closed process inspection before destructive work, dirty-checkout acceptance, complete runtime replacement, no rollback after build failure, and successful full rebuild on the next invocation.

The full-flow integration test creates a local Git remote and pull-request branch, serves a mock GitHub pull-request API, resolves the request and active plan, checks out the exact revision, invokes a mock Codex executable, and validates finalization behavior without granting GitHub credentials to Codex.
