# Native GitHub Runner and Codex Technical Specification

## 1. Goal

Replace Docker Compose and the Agent Relay HTTP transport with one fresh native Debian installation. The official GitHub Actions runner is the only long-lived service. A workflow job launches Codex directly through a trusted installed harness.

This is not a migration. The implementation must not inspect, stop, unregister, copy from, clean, or modify the previous Docker deployment. Existing Docker runner state, volumes, Relay state, logs, and Codex authentication are not inputs.

Keep the repository name, package name, workflow filenames, and living ExecPlan model. Remove only the Docker deployment and Relay process/transport. Do not perform a broad rename or unrelated refactor.

## 2. Runtime and GitHub scope

The prepared runtime provides Debian, systemd, one non-root user with working `sudo`, a writable user home, and outbound HTTPS access.

Register one organization-level runner against:

```text
https://github.com/Divorium
```

Use:

- runner name: `gh-runner`;
- runner work directory: `_work`;
- custom labels: none;
- workflow routing: `runs-on: [self-hosted]`.

The runner is added to the organization's default runner group. Repository access follows the existing `Divorium` runner-group policy. The installer does not manage runner groups or require another GitHub credential for them.

The old runner is disabled by the user outside the repository. Runtime code and the installer do not detect, stop, unregister, or clean it.

Repository code must not detect or configure host virtualization, mounted drives, source-checkout location, or host lifecycle.

## 3. User interaction

The only setup and update entrypoint is:

```bash
./install.sh
```

The script performs all installation and configuration. The user only:

1. runs `./install.sh` from the copied or cloned repository;
3. completes `codex login` when invoked;
4. pastes a time-limited organization runner registration token into a hidden prompt when the runner is not registered.

The script asks for no repository URL, organization name, runner name, labels, workspace path, Relay credential, Codex auth path, UID, GID, service value, or environment file.

## 4. Installed layout

- trusted application payload: `/opt/agent-relay`;
- Codex launcher: `/usr/local/bin/codex-run`;
- runner installation: `$HOME/.local/share/actions-runner`;
- runner workspace root: `$HOME/.local/share/actions-runner/_work`;
- Codex authentication: `$HOME/.codex/auth.json`;
- Go: `/usr/local/go`;
- Rust: `/opt/rust`;
- private execution state: one `mktemp` directory per Codex invocation.

`/opt/agent-relay`, `/usr/local/bin/codex-run`, and `/opt/rust` are root-owned and not writable by workflow jobs. The runner directory is owned by the runtime user for official runner maintenance and updates.

No credential or persistent runtime state is stored in the source checkout.

## 5. Installer

### 5.1 Preflight

`install.sh` must:

- refuse root execution;
- resolve the source root from the script location;
- verify Debian, systemd, `sudo`, a writable user home, and outbound HTTPS prerequisites;
- use fixed organization URL `https://github.com/Divorium`;
- require no `.env`, positional arguments, or routine configuration prompts;
- never invoke Docker, Docker Compose, host-lifecycle commands, or previous-environment operations.

### 5.2 Toolchain

Install the capabilities currently supplied by the two images:

- Node.js 22 and npm;
- TypeScript 5.8.3;
- Codex CLI 0.144.3;
- Temurin Java 21;
- Go 1.24.5;
- Rust stable under `/opt/rust`;
- Python 3, pip, and venv;
- Git and Git LFS;
- C/C++ build tools, clang, cmake, and pkg-config;
- curl, wget, jq, zip, unzip, xz, zstd, rsync, file, findutils, and diffutils;
- Debian libraries required by GitHub Actions Runner.

Do not run a general distribution upgrade. Install only required packages and configured upstream toolchains.

Adapt `scripts/toolchain-smoke.sh` to native requirements. It validates required tools and retained pins but does not reject unrelated installed software such as OpenSSH or .NET.

### 5.3 Repository validation and atomic installation

Before replacing installed files, run:

```bash
npm ci
npm run check
```

Use the successful build output. Stage a complete runtime payload and atomically replace `/opt/agent-relay` only after validation and staging checks pass.

Install:

- compiled direct Codex CLI and all imported compiled modules;
- `runner/resolve-pr.mjs`;
- `runner/finalize.sh`;
- native toolchain smoke script;
- `scripts/codex-run` as `/usr/local/bin/codex-run`.

Production TypeScript uses Node.js built-ins and requires no runtime `node_modules` directory.

### 5.4 Codex authentication

Run `codex login status`. When unauthenticated, invoke `codex login` interactively and verify status again. Do not accept an auth-file path, copy authentication from another environment, or create a second authentication store.

### 5.5 GitHub runner bootstrap and registration

For a fresh installation use GitHub Actions Runner `2.335.1`:

- archive: `actions-runner-linux-x64-2.335.1.tar.gz`;
- SHA-256: `4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf`.

Download and verify the archive before extraction.

For an unregistered runner:

1. read the organization registration token without echo and with shell tracing disabled;
2. execute `config.sh --unattended --replace` with URL `https://github.com/Divorium`, name `gh-runner`, and work directory `_work`;
3. do not pass `--labels`;
4. unset the token immediately;
5. install the service for the current user through `svc.sh`;
6. start the service and verify `svc.sh status`;
7. install the GitHub-recommended Debian `needrestart` override.

On rerun:

- preserve `.runner`, credentials, diagnostics, `_work`, and runner-managed update files;
- do not call `config.sh` or request a token when `.runner` exists;
- do not replace or downgrade a newer self-updated runner;
- ensure the service is installed, enabled, started, and active;
- update the root-owned application payload independently.

The registration token must never be written to files, output, profiles, units, repository content, installed payloads, or retained child-process environments.

## 6. Direct Codex CLI

Add `src/run-codex.ts`, compile it, and install it under `/opt/agent-relay`. Workflows invoke the installed CLI, never direct-execution code from the pull-request checkout.

Required environment:

- `GITHUB_WORKSPACE`;
- `GITHUB_OUTPUT`;
- `CODEX_PLAN_PATH`;
- `CODEX_WORKSPACE_ROOT`, set to `${{ runner.workspace }}`.

Optional positive integers:

- `CODEX_TIMEOUT_MS`, default `21600000`;
- `MAX_OUTPUT_BYTES`, default `10000000`.

The CLI:

1. resolves real workspace paths;
2. rejects workspace escape, including symlinks;
3. accepts only a regular, non-symlink Markdown file directly under `docs/exec-plans/active`;
4. derives the normalized commit message before Codex runs;
5. builds the existing minimal prompt;
6. invokes `/usr/local/bin/codex-run` through the retained executor;
7. streams redacted stdout/stderr;
8. preserves timeout, SIGTERM, delayed SIGKILL, output cap, truncation marker, and failure behavior;
9. appends `commit_message` only after successful execution;
10. exits non-zero on validation, spawn, timeout, or Codex failure.

Remove request IDs, HTTP calls, job IDs, polling, result DTOs, persisted Relay output, persisted job state, and restart recovery. GitHub Actions logs and the uploaded artifact are the retained output.

## 7. Executor adaptation

Reuse the current prompt, workspace checks, streaming redactor, timeout, force-kill, output-cap, and truncation logic.

Change only transport-specific parts:

- pass the plan path directly instead of `CreateJobRequest`;
- remove persisted `outputPath` and file appends;
- stream redacted output directly for workflow capture;
- replace HTTP-oriented Relay errors with the smallest internal execution error required by the CLI;
- replace container permission paths with runtime parameters.

## 8. Codex launcher and permissions

Rewrite `scripts/codex-run` so it:

- refuses root;
- uses `umask 0077`;
- verifies `$HOME/.codex/auth.json`;
- creates one private `mktemp` runtime directory;
- cleans only that directory;
- never deletes, copies, moves, rewrites, or symlinks real-home, auth, runner, source, or workspace files;
- invokes Codex through `env -i` with explicit locale, real `HOME`, current user identity, native Java/Go/Rust paths, private cargo/temp paths, and `GIT_OPTIONAL_LOCKS=0`.

Use a neutral permissions profile such as `agent`. It must:

- disable memories;
- deny the complete real user home;
- deny `/opt/agent-relay` and `/opt/rust`;
- deny the complete runner workspace root before re-allowing the selected repository;
- deny `/tmp` and `/var/tmp` before re-allowing the private runtime directory;
- allow writes to the selected repository and runtime directory;
- allow reads from the selected repository `.git` directory;
- retain required network access;
- never use `danger-full-access`.

The permission profile constrains model-controlled Codex tools, not arbitrary workflow steps. Runner-group access must therefore be limited to trusted repositories and workflows.

## 9. Workflows

Update:

- `.github/workflows/agent-relay.yml`;
- `examples/github-actions/agent-relay.yml`;
- `.github/workflows/ci.yml`.

Every job uses:

```yaml
runs-on: [self-hosted]
```

Preserve:

- current triggers and same-repository gate;
- installed PR resolver and exact head SHA/ref;
- checkout with `persist-credentials: false`;
- credential-free checkout verification;
- active-plan selection;
- installed direct CLI with `CODEX_WORKSPACE_ROOT: ${{ runner.workspace }}`;
- `pipefail` and `tee` to `${RUNNER_TEMP}/agent-relay-console.log`;
- artifact upload with `if: always()`;
- delayed failure after artifact upload;
- installed finalizer with derived message, target branch, and step-scoped `${{ github.token }}`.

Use installed paths under `/opt/agent-relay`. Remove `/runner` paths, `AGENT_RELAY_TOKEN`, Relay URL, request IDs, and polling variables.

The Codex step receives no GitHub token. The token remains explicit only in PR resolution, checkout, and finalization.

## 10. Repository transformation

Add:

- `install.sh`;
- `src/run-codex.ts`;
- direct-execution and installer regression tests.

Retain and adapt:

- executor, prompt, redaction, and workspace safety;
- resolver and finalizer;
- Codex launcher and toolchain smoke;
- workflows, repository instructions, README, and operations documentation.

Remove after replacement tests pass:

- Dockerfiles, Compose, `.dockerignore`, `.env.example`, and obsolete `.env` ignore;
- runner container entrypoint and Relay client;
- server, API, configuration, job service, job store, and unused HTTP/job contracts;
- tests that cover only removed transport, polling, persistence, Docker packaging, or container startup.

Update `package.json` to remove the server start command and container-entrypoint checks while retaining strict type checking, build, coverage, shell validation, and `npm run check`.

Do not modify historical completed ExecPlans.

## 11. Tests

Tests use controlled command, filesystem, process, HTTP, and Git fixtures. They require no real credentials, downloads, systemd, Docker, or GitHub services.

Cover:

- direct CLI inputs, integer parsing, workspace containment, plan boundaries, symlinks, commit-message normalization, and plan movement;
- actual executor success, no-op, exit failure, spawn error, timeout, delayed force-kill, truncation, split UTF-8, split secrets, and live redaction;
- launcher proof that real-home, auth, runner, source, and unrelated workspace fixtures remain unchanged;
- installer preflight, toolchain decisions, current runner checksum, login branching, hidden token input, organization registration, `_work`, no custom labels, `svc.sh`, `needrestart`, failure preservation, and token-free rerun;
- proof that the token is absent from output, generated files, installed files, units, profiles, and retained child environments;
- workflow `[self-hosted]`, trusted installed paths, workspace propagation, GitHub-token scoping, artifact upload, and finalization;
- native packaging and absence of active Docker/Relay artifacts;
- retained resolver/finalizer behavior and shell syntax.

## 12. Acceptance

Implementation is accepted when:

1. `npm ci` and `npm run check` pass.
2. Deterministic tests execute the real CLI, executor, launcher, installer, resolver, and finalizer.
3. All three workflows use only `[self-hosted]`.
4. The installer registers against `https://github.com/Divorium`, requests no custom labels, and asks only for Codex login and an organization registration token.
5. No Relay token, HTTP transport, polling client, persisted Relay state, Docker deployment, or old-environment operation remains active.
6. No implementation code depends on host-specific paths, source-checkout location, host lifecycle, or the previous deployment.
7. Current documentation accurately describes the organization runner and the single installer.
8. A final file-by-file comparison against this specification finds no uncovered behavior or conflicting instruction.

Do not claim live credentials, runner-group policy, package downloads, systemd, GitHub registration, or host lifecycle were exercised unless genuine evidence exists.
