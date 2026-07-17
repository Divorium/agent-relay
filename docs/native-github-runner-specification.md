# Native GitHub Runner and Codex Technical Specification

## Goal

Run Agent Relay directly in one fresh Debian WSL installation. The official organization-level GitHub Actions runner is the only long-lived service. It executes the trusted Agent Relay runtime from the administrator-owned repository checkout and gives Codex access only to the selected workflow workspace.

There is no Relay HTTP service, queue, polling loop, persisted job state, Docker image, Compose deployment, `.env`, or `/opt/agent-relay` copy.

## Fixed paths

All Agent Relay and GitHub Runner data is grouped below the single administrator-controlled root `/srv/github-runner/storage`. This is an explicit architecture decision shared by the ExecPlan, README files, installer, updater, and tests.

```text
/srv/github-runner/storage/agent-relay  administrator-owned source and compiled runtime
/srv/github-runner/storage/work         github-runner-owned workflow workspaces
/srv/github-runner/storage/runner       official GitHub Actions runner
/srv/github-runner/storage/home         github-runner home and Codex authentication
/srv/github-runner/storage/build        temporary isolated builds
/srv/github-runner/storage/build-home   builder cache and home
```

The runner is configured with work name `_work`. `/srv/github-runner/storage/runner/_work` is a symlink to `../work`, so GitHub's official runner resolves its normal relative work path to `/srv/github-runner/storage/work`.

The six child directories are separated by responsibility and ownership: source/runtime, workflow workspaces, runner binaries and registration state, runner home and Codex authentication, disposable build staging, and builder home/caches.

Every workflow checkout selected below `/srv/github-runner/storage/work` is treated as a trusted Codex project. The runtime uses the canonical exact checkout path rather than a wildcard, so the first invocation in each new workspace is non-interactive and project-local Codex configuration, hooks, and execution policies are enabled for that checkout.

## Accounts and privilege boundary

Three identities are used:

- the Debian administrator owns the source checkout, performs the one-time installation, and runs updates;
- `agent-relay-builder` has a locked password, no interactive shell, and no sudo access; it performs dependency installation, compilation, tests, syntax validation, and toolchain smoke checks;
- `github-runner` has a locked password and no sudo access; systemd runs the official runner and Codex as this account.

The source checkout is readable and executable by the two service accounts but writable only by the administrator. The activated `dist` directory is owned by root and read-only to the service accounts. The workflow workspace is owned by `github-runner`.

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
- install the pinned system toolchains and build dependencies;
- create the locked `github-runner` and `agent-relay-builder` accounts and remove them from the `sudo` group if necessary;
- verify that neither service account can run `sudo -n true`;
- prepare all six fixed directories below `/srv/github-runner/storage` with the required ownership;
- reject trusted entrypoints that are symlinks and update ownership without dereferencing repository symlinks;
- download and SHA-256 verify the official GitHub Actions runner archive;
- request one hidden organization PAT only when registration is absent;
- exchange that PAT for a short-lived organization runner registration token without placing the PAT in process arguments or files;
- register `gh-runner` for `https://github.com/Divorium`, with `_work` and no custom labels;
- create a root-owned systemd unit that runs as `github-runner`;
- perform Codex login as `github-runner` only when authentication is absent;
- prepare, but not enable or start, the service. Activation belongs to a successful `update.sh` transaction.

Pinned downloads and packages are:

- GitHub Actions Runner `2.335.1`, SHA-256 `4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf`;
- Go `1.24.5`, SHA-256 `10ad9e86233e74c0f6590fe5426895de6bf388964210eac34a6d83f38918ecdc`;
- TypeScript `5.8.3`;
- Codex CLI `0.144.4`;
- Node.js 22 and Java 21.

## Update transaction

`update.sh` must:

1. accept no arguments, refuse root execution, and verify the administrator recorded by `install.sh`;
2. require systemd, a clean Git checkout, and service accounts without passwordless sudo;
3. stop the runner when it is active;
4. record the current Git revision, run `git pull --ff-only` with repository hooks disabled, and re-execute `update.sh` from the pulled revision;
5. create an isolated build workspace below `/srv/github-runner/storage/build` owned by `agent-relay-builder` and use `/srv/github-runner/storage/build-home` as its persistent home/cache root;
6. run `npm ci`, TypeScript compilation, the full Node test suite, the 100% line/branch/function coverage gates, shell syntax checks, Node script syntax checks, and the Codex/toolchain smoke test as `agent-relay-builder`;
7. leave the active `dist` untouched until all validation succeeds;
8. atomically move the staged `dist` into the source checkout while retaining the previous runtime;
9. reject symlinked trusted entrypoints, verify source ownership, and harden source and runtime permissions without following repository symlinks;
10. daemon-reload, enable, start, and verify the runner service;
11. delete the previous runtime only after the service is confirmed active.

Any failure before commit restores the original Git revision, removes staged build data, restores the previous `dist` when a swap occurred, and restarts a service that had been active before the update.

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
- build a private per-run cache/config/temp hierarchy;
- start Codex through `env -i` with deterministic toolchain paths;
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
- shell and Node-script syntax validation;
- fixed-layout consistency checks across the ExecPlan, README files, installer, updater, and tests;
- a system-level mocked `install.sh` execution that verifies all six storage directories and the `runner/_work -> ../work` symlink;
- a system-level mocked `update.sh` execution covering successful activation, pre-swap build failure rollback, and post-swap service-start failure rollback.

The full-flow integration test creates a real local Git remote and pull-request branch, serves a mock GitHub pull-request API, resolves the request and active plan, checks out the exact revision, invokes a mock Codex executable through the real runtime, finalizes the change, pushes it, and verifies the resulting remote commit.

The current deterministic suite contains 66 passing Node tests. The 100% line, branch, and function gates apply to the TypeScript runtime. Bash installers and launchers plus the standalone Node runner scripts are validated through syntax checks and dedicated integration harnesses rather than being included in the TypeScript coverage denominator.

These deterministic tests do not replace target-host acceptance. Live WSL package installation, systemd activation, organization registration, Codex authentication, runner-group access, and a real GitHub-hosted request require the actual target machine and credentials.
