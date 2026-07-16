# Native GitHub Runner and Codex Technical Specification

## 1. Purpose

Replace the Docker Compose deployment and the Agent Relay HTTP transport with one native GitHub Actions runner installation that launches Codex directly in the checked-out repository.

This is a fresh installation design. It must not inspect, stop, copy from, modify, or clean the previous Docker deployment. Docker registration state, Docker volumes, Relay state, and Codex authentication from the previous environment are not migration inputs.

The repository continues to provide the trusted execution harness around Codex. It does not add new product behavior.

## 2. Target runtime

The runtime host provides:

- Debian;
- systemd;
- one existing non-root user with sudo access;
- a writable GitHub Actions work root at `/srv/github-runner/_work`;
- outbound access required by package installers, GitHub Actions, and Codex.

The installer must not detect or configure WSL, Windows drives, mount sources, virtual-disk limits, or host lifecycle. Those are host prerequisites outside this repository.

Normal runtime contains one long-lived process managed by the repository installation:

- the official GitHub Actions runner service.

Codex is a child process of a workflow step. There is no Agent Relay server, API, bearer token, polling client, persisted job queue, or Agent Relay systemd service.

## 3. User interaction

The supported setup entrypoint is:

```bash
./install.sh
```

The script performs every installation and configuration operation. The user provides only interactive credentials that cannot be generated or stored by the repository:

1. The script runs `codex login` when `codex login status` is not authenticated. The user completes that login.
2. The script prompts without echo for a repository-scoped GitHub runner registration token only when the runner has no existing `.runner` registration.

The script derives the target repository URL from the checkout's `origin` remote. It uses fixed defaults for the runner name and label and does not ask for routine configuration values.

Subsequent executions must not prompt for a registration token or repeat Codex login while the existing runner registration and Codex authentication remain valid.

## 4. Installed layout

Use these locations:

- source checkout: the directory containing `install.sh`; no fixed checkout path is required;
- trusted installed harness: `/opt/agent-relay`;
- Codex launcher: `/usr/local/bin/codex-run`;
- GitHub runner installation and registration: `$HOME/.local/share/actions-runner`;
- GitHub Actions work root: `/srv/github-runner/_work`;
- Codex authentication: `$HOME/.codex/auth.json`;
- per-execution temporary state: a private directory created with `mktemp` below `/tmp` or `${RUNNER_TEMP}`.

`/opt/agent-relay` and `/usr/local/bin/codex-run` are installed through sudo, owned by root, and not writable by workflow jobs. The official runner directory remains writable by the runtime user so the runner can maintain credentials, diagnostics, and built-in updates.

No registration state, authentication file, or persistent application state is stored in the repository checkout or work root.

## 5. Installer contract

### 5.1 Invocation and preflight

`install.sh` must:

- run as the existing non-root user and use sudo only for system changes;
- resolve the repository root from the script location;
- verify Debian, systemd, sudo, a writable `$HOME`, and a writable `/srv/github-runner` parent;
- create `/srv/github-runner/_work` when absent;
- fail clearly when `origin` cannot be normalized to the current GitHub repository URL;
- never invoke Docker, Docker Compose, WSL commands, PowerShell, or commands targeting the previous environment.

It must not require environment files or positional arguments for the normal path.

### 5.2 Toolchain installation

Install the capabilities currently supplied by the Docker images:

- Node.js 22 and npm;
- TypeScript 5.8.3;
- Codex CLI 0.144.3;
- Java 21 using the same Temurin distribution family used by the current image;
- Go 1.24.5;
- Rust stable through rustup for the runtime user;
- Python 3 with pip and venv;
- Git and Git LFS;
- C/C++ build tools, clang, cmake, pkg-config;
- curl, wget, jq, zip, unzip, xz, zstd, rsync, file, findutils, and diffutils;
- the Debian runtime libraries required by GitHub Actions Runner 2.325.0.

Use the existing version policy rather than inventing tighter guarantees:

- Node and Java are major-version requirements;
- TypeScript, Codex, and Go use the versions already pinned in the repository;
- GitHub Runner 2.325.0 is the bootstrap archive for a new installation;
- an existing runner may be newer because the official runner updater remains enabled and must not be downgraded.

Do not run a general distribution upgrade. Install only missing required packages and configured upstream packages.

Update `scripts/toolchain-smoke.sh` for the native host. It validates required tools and versions but must not reject unrelated packages such as OpenSSH or .NET.

### 5.3 Repository validation and harness installation

Before changing the installed harness, run from the source checkout:

```bash
npm ci
npm run check
```

Use the build produced by the successful check. Install only runtime files required for direct execution:

- compiled direct-runner entrypoint and its imported modules;
- `runner/resolve-pr.mjs`;
- `runner/finalize.sh`;
- `scripts/codex-run` as `/usr/local/bin/codex-run`.

Install through a staging directory and replace `/opt/agent-relay` only after all source validation and staging checks pass. Preserve the previous installed harness if validation or staging fails.

After installation, run the native toolchain smoke check and direct-runner fixture check before configuring or starting the GitHub runner service.

### 5.4 Codex authentication

Run:

```bash
codex login status
```

When unauthenticated, invoke `codex login` interactively and then recheck status. Do not accept an authentication-file path, copy authentication from another environment, or persist credentials anywhere except the Codex-owned location created by the login command in the current user's home.

### 5.5 GitHub runner installation

For a new runner directory:

1. Download the pinned Linux x64 runner archive and verify its pinned SHA-256 value.
2. Extract it into `$HOME/.local/share/actions-runner`.
3. Prompt for the registration token without echo.
4. Normalize the checkout's `origin` remote to `https://github.com/<owner>/<repository>`.
5. Run `config.sh --unattended --replace` with:
   - the normalized repository URL;
   - the process-local registration token;
   - runner name `gh-runner` unless `RUNNER_NAME` is explicitly supplied;
   - label `agent-relay`;
   - work directory `/srv/github-runner/_work`.
6. Unset the registration token immediately after `config.sh` returns.
7. Install and start the official service with `svc.sh` for the current user.

On rerun:

- preserve an existing `.runner`, `.credentials`, and runner-managed files;
- do not call `config.sh` or request a token when `.runner` exists;
- do not reinstall or downgrade an existing newer runner archive;
- ensure the official service is installed, enabled, and started;
- update the root-owned execution harness independently of runner registration.

The token must never be written to a file, command log, shell profile, environment file, systemd unit, repository file, or GitHub Actions configuration.

## 6. Direct Codex execution

### 6.1 Trusted entrypoint

Replace `src/server.ts` with a direct CLI entrypoint compiled into the installed harness. The production workflow invokes the installed entrypoint, not a script from the pull-request checkout.

Required environment:

- `GITHUB_WORKSPACE` — exact checked-out repository path;
- `GITHUB_OUTPUT` — GitHub Actions output file;
- `CODEX_PLAN_PATH` — selected active ExecPlan path;
- `CODEX_WORKSPACE_ROOT` — `/srv/github-runner/_work` in production.

Optional validated environment:

- `CODEX_TIMEOUT_MS`, default `21600000`;
- `MAX_OUTPUT_BYTES`, default `10000000`.

The CLI must:

1. resolve the real workspace root and workspace;
2. reject a workspace outside the configured root, including symlink escapes;
3. accept only a regular, non-symlink Markdown file directly under `docs/exec-plans/active`;
4. read and normalize the commit message from the first non-empty level-one plan heading before Codex runs;
5. construct the existing minimal Codex prompt pointing to `.agent/PLANS.md` and the selected plan;
6. execute Codex through `/usr/local/bin/codex-run`;
7. stream redacted stdout and stderr to the workflow log;
8. retain the existing timeout, graceful termination, force-kill, output-byte limit, and exit-code behavior;
9. append `commit_message=<value>` to `GITHUB_OUTPUT` only after successful execution;
10. return non-zero on validation, spawn, timeout, or Codex failure.

There is no request ID, HTTP request, job ID, polling state, job result DTO, persisted log file, or server-side recovery state.

### 6.2 Codex launcher

Rewrite `scripts/codex-run` for the native runtime without cleaning the actual user's home directory.

The launcher must:

- refuse root execution;
- use `umask 0077`;
- resolve the real runtime user's home and verify `$HOME/.codex/auth.json` exists;
- create a private temporary runtime directory and temporary Codex home;
- expose the current environment's Codex authentication to that temporary home without modifying the real authentication file;
- clean only the temporary runtime directory on exit;
- start Codex with `env -i` and an explicit locale, HOME, PATH, Java, Go, Rust, cargo, and temporary-directory environment;
- never delete or rewrite files in the real user's home, runner installation, repository checkout, or work root.

The executable and tool paths must match the native toolchain installed by `install.sh`.

### 6.3 Codex permissions

Adapt `createCodexArgs` to native paths and remove container-only names and paths. The permissions profile must:

- disable memories;
- deny the real Codex credential directory;
- deny `/opt/agent-relay`;
- deny the GitHub runner installation directory;
- deny the complete shared work root before re-allowing the selected repository;
- deny general temporary roots before re-allowing only the private per-execution runtime directory;
- allow writes to the selected repository;
- allow reads from the selected repository's `.git` directory;
- retain network access required by repository work;
- never use `danger-full-access`.

Use a neutral profile name such as `agent`; do not retain a `relay` profile after Relay is removed.

## 7. GitHub Actions workflow

Keep the existing orchestration and trust gates:

1. support `ready_for_review` and manual `workflow_dispatch`;
2. reject fork-origin pull requests;
3. run on `[self-hosted, agent-relay]`;
4. resolve an open, ready, same-repository pull request through the installed `resolve-pr.mjs`;
5. checkout the API-derived exact head SHA with `persist-credentials: false`;
6. verify the checkout contains no authorization header, credential helper, or credential-bearing remote;
7. select exactly one changed active ExecPlan for pull-request runs or validate the explicit manual plan path;
8. run the installed direct Codex CLI and pipe its redacted output through `tee` to `${RUNNER_TEMP}/codex-console.log` with `pipefail`;
9. upload that log artifact with `if: always()`;
10. fail after artifact upload when Codex failed;
11. run the installed `finalize.sh` with the derived commit message, API-derived target branch, and step-scoped `${{ github.token }}`.

Update both:

- `.github/workflows/agent-relay.yml`;
- `examples/github-actions/agent-relay.yml`.

Remove `AGENT_RELAY_TOKEN`, `AGENT_RELAY_URL`, client polling variables, and the `AGENT_RELAY_TOKEN` repository secret requirement. The Codex step receives no GitHub token. The built-in GitHub token remains limited to PR resolution, checkout, and finalization steps.

## 8. Repository changes

### 8.1 Add

- `install.sh`;
- `src/run-codex.ts`;
- direct-execution and installer regression tests.

### 8.2 Retain and adapt

- `src/execution/codex-executor.ts`;
- `src/execution/prompt.ts`;
- `src/security/redaction.ts`;
- `src/security/workspace.ts`;
- `runner/resolve-pr.mjs`;
- `runner/finalize.sh`;
- `scripts/codex-run`;
- `scripts/toolchain-smoke.sh`;
- both GitHub Actions workflow files;
- `AGENTS.md`, `.agent/PLANS.md`, README, and operations documentation;
- CI on `[self-hosted, agent-relay]`.

### 8.3 Remove after replacements are tested

- `Dockerfile`;
- `Dockerfile.runner`;
- `compose.yml`;
- `.dockerignore`;
- `.env.example` and obsolete `.env` ignore entry;
- `runner/entrypoint.sh`;
- `runner/client.mjs`;
- `src/server.ts`;
- `src/api/server.ts`;
- `src/application/job-service.ts`;
- `src/config/config.ts`;
- `src/persistence/job-store.ts`;
- HTTP/job DTOs, validators, and errors that become unused;
- tests whose only subject is the removed HTTP API, job queue, persistence, polling client, Docker packaging, or container entrypoint.

Do not preserve dead Relay terminology or a second deployment mode for compatibility.

## 9. Test design

The repository suite remains deterministic and does not require real credentials, package downloads, systemd, Docker, WSL, or GitHub network access.

Required coverage:

- direct CLI validates environment, workspace root, active-plan path, symlinks, timeout/output values, and commit-message normalization;
- direct CLI launches the actual executor against controlled fake Codex children;
- stdout and stderr are redacted and visible before process completion;
- non-zero exit, spawn failure, timeout, force-kill, and output truncation preserve the current observable behavior;
- the plan may be moved to completed during execution without losing the already-derived commit message;
- the launcher uses a temporary home and never deletes a fixture representing the real user home or runner directory;
- installer preflight, remote normalization, hidden token input, first registration, rerun without token, credential non-persistence, official `svc.sh` calls, and failure preservation are exercised through command and filesystem fixtures;
- packaging tests assert that Docker/Relay artifacts are absent and native files are present;
- workflow tests assert exact checkout, credential cleanup, direct installed execution, artifact upload, and finalization token scoping;
- existing resolver and finalizer behavioral tests continue to pass;
- `bash -n` covers every retained shell script.

The installer test must not weaken production behavior by adding a second installation path. Test substitutions may be injected through PATH and temporary filesystem roots, but the production script remains the single entrypoint.

## 10. Documentation

Rewrite README and operations documentation for:

- fresh native installation through `./install.sh`;
- interactive Codex login when required;
- initial runner token prompt and token-free reruns;
- fixed runner label and work root;
- direct Codex execution without Relay or an extra repository secret;
- GitHub Actions and artifact logs;
- updates by pulling the trusted installation checkout and rerunning `./install.sh`;
- explicit runner re-registration by using the official runner removal/configuration flow;
- uninstalling the new native installation without touching any previous Docker environment.

The operations guide may state that the prepared host is started by the user with:

```powershell
wsl -d gh-runner
```

That command is user documentation only. The installer and runtime code must not invoke it or depend on detecting WSL.

## 11. Acceptance

The implementation satisfies this specification when:

- `npm ci` and `npm run check` pass;
- the test suite proves first-install and rerun behavior of the single installer through fixtures;
- the installed workflow path has no Relay HTTP hop or Relay secret;
- all retained behavior listed in section 7 is covered;
- the repository contains one supported native installation path and no Docker deployment artifacts;
- no code path copies state or credentials from, stops, cleans, or otherwise modifies the previous environment;
- documentation accurately limits the user's manual work to starting the prepared environment, obtaining/pasting the initial runner token, completing Codex login, and running the installer.