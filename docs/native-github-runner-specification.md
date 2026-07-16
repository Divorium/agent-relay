# Native GitHub Runner and Codex Specification

## Goal

Replace Docker Compose and the Agent Relay HTTP transport with one fresh native installation. The official GitHub Actions runner is the only long-lived service. A workflow job launches Codex directly through a trusted installed harness.

This is not a migration. The implementation must not inspect, stop, copy from, clean, unregister, or modify the previous Docker deployment. Existing Docker runner state, volumes, Relay state, logs, and Codex authentication are not inputs.

Keep the repository name, package name, workflow filenames, and `agent-relay` compatibility label. Remove only the Docker deployment and Relay process/transport. Do not perform a broad rename or unrelated refactor.

## Host contract

The prepared host provides Debian, systemd, one non-root user with sudo, and outbound network access.

Repository code must not detect or configure WSL, Windows, drive mounts, virtual-disk limits, source-checkout location, or host lifecycle.

The user may keep the trusted source checkout in the mounted host folder, but runner workspaces and runtime state remain in the Linux filesystem.

## User flow

The only setup entrypoint is:

```bash
./install.sh
```

The script performs all installation and configuration. The user only:

1. runs it from a checkout that retains the Git `origin` remote;
2. completes `codex login` when the script invokes it;
3. pastes a repository runner registration token into a hidden prompt when no registration exists.

The script does not ask for repository URL, runner name, labels, workspace, Relay credentials, Codex auth path, UID, GID, service values, or an environment file.

## Isolate the new runner from the old runner

Register the new runner with custom labels `agent-relay,gh-runner`.

Production and CI workflows require:

```yaml
runs-on: [self-hosted, agent-relay, gh-runner]
```

The untouched old runner has only `agent-relay`, so it cannot receive jobs requiring both labels. No old-environment shutdown or cleanup is needed.

Use the fixed runner name `gh-runner`.

## Installed layout

- trusted harness: `/opt/agent-relay`;
- Codex launcher: `/usr/local/bin/codex-run`;
- GitHub runner directory: `$HOME/.local/share/actions-runner`;
- GitHub runner work directory: `_work` relative to the runner directory;
- Codex authentication: `$HOME/.codex/auth.json`;
- system-wide Rust: `/opt/rust`;
- private execution temp: a directory created with `mktemp`.

`/opt/agent-relay`, `/usr/local/bin/codex-run`, and `/opt/rust` are root-owned and not writable by workflow jobs. The runner directory remains owned by the runtime user for official runner maintenance and updates.

No credentials or persistent runtime state are stored in the source checkout. Job workspaces remain under the runner installation in the Linux filesystem rather than the mounted Windows source folder.

## Single installer

`install.sh` must:

- refuse root execution and use sudo for system changes;
- resolve the repository root from its own location;
- verify Debian, systemd, sudo, and a writable user home;
- normalize HTTPS or SSH `origin` into `https://github.com/<owner>/<repository>`;
- fail when the remote is missing or unsupported rather than asking for a URL;
- never invoke Docker, Compose, WSL, PowerShell, or old-environment operations;
- require no `.env` or normal-path arguments.

Install the capabilities currently provided by the images:

- Node.js 22 and npm;
- TypeScript 5.8.3;
- Codex CLI 0.144.3;
- Temurin Java 21;
- Go 1.24.5;
- Rust stable under `/opt/rust`;
- Python 3 with pip and venv;
- Git and Git LFS;
- C/C++ tools, clang, cmake, and pkg-config;
- curl, wget, jq, zip, unzip, xz, zstd, rsync, file, findutils, and diffutils;
- Debian libraries required by Runner 2.325.0.

Node and Java are major-version requirements. TypeScript, Codex, and Go retain current pins. Runner 2.325.0 is only the bootstrap version; do not downgrade a newer self-updated runner. Do not perform a general distribution upgrade.

Update `scripts/toolchain-smoke.sh` for native requirements. It must not reject unrelated software such as OpenSSH or .NET.

Before replacing installed files, run:

```bash
npm ci
npm run check
```

Stage the runtime payload and replace `/opt/agent-relay` only after validation succeeds. Install the compiled direct CLI and its imported modules, `runner/resolve-pr.mjs`, `runner/finalize.sh`, and `/usr/local/bin/codex-run`. Production modules use Node built-ins and require no runtime `node_modules`.

Run `codex login status`. When unauthenticated, invoke `codex login` and verify status again. Do not copy auth from another environment or create a second auth file.

For a new runner directory:

1. Download and checksum-verify Runner 2.325.0.
2. Extract it under `$HOME/.local/share/actions-runner`.
3. Read the registration token without echo.
4. Run `config.sh --unattended --replace` with the derived repository URL, name `gh-runner`, labels `agent-relay,gh-runner`, and work directory `_work`.
5. Unset the token immediately.
6. Install and start the official service through `svc.sh` for the current user.

On rerun, preserve runner-managed files and Codex auth, do not request a token when `.runner` exists, do not downgrade the runner, validate that registration targets the repository derived from `origin`, and ensure the official service is enabled and active.

The registration token must not be stored in files, logs, profiles, units, repository content, installed harness content, or child-process environments.

## Trusted direct Codex CLI

Replace `src/server.ts` with a strict CLI compiled under `/opt/agent-relay`. Workflows invoke the installed CLI, never a direct-execution file from the pull-request checkout.

Required environment:

- `GITHUB_WORKSPACE`;
- `GITHUB_OUTPUT`;
- `CODEX_PLAN_PATH`;
- `CODEX_WORKSPACE_ROOT`, set by the workflow to `${{ runner.workspace }}`.

Optional positive integers:

- `CODEX_TIMEOUT_MS`, default `21600000`;
- `MAX_OUTPUT_BYTES`, default `10000000`.

The CLI must:

1. enforce real workspace-root containment and symlink safety;
2. accept only a regular, non-symlink Markdown file directly under `docs/exec-plans/active`;
3. derive the normalized commit message before Codex runs;
4. build the existing minimal prompt;
5. invoke `/usr/local/bin/codex-run` through the retained executor;
6. stream redacted output;
7. preserve timeout, SIGTERM, delayed SIGKILL, byte cap, truncation marker, and failure behavior;
8. append `commit_message` only after success;
9. return non-zero for validation, spawn, timeout, or Codex failure.

Remove request IDs, HTTP calls, job IDs, polling, result DTOs, persisted Relay logs, and restart state. Replace API-specific errors with a minimal execution error only where still required.

## Codex launcher and permissions

Rewrite `scripts/codex-run` so it never cleans the real home.

It must refuse root, use `umask 0077`, verify the real `$HOME/.codex/auth.json`, create and clean only a private temporary directory, keep HOME pointed at the real home, and invoke Codex through `env -i` with explicit locale, PATH, Java, Go, Rust, cargo cache, temp directories, and `GIT_OPTIONAL_LOCKS=0`.

Do not copy, move, rewrite, or symlink auth. Do not modify the real home, runner directory, source checkout, or workspaces from the wrapper.

Install Rust system-wide under `/opt/rust` and use a per-execution cargo cache so model-controlled work does not require access to the user home.

Use a neutral permissions profile such as `agent`. It must:

- disable memories;
- deny the complete real user home;
- deny `/opt/agent-relay` and `/opt/rust`;
- deny `${{ runner.workspace }}` before re-allowing `GITHUB_WORKSPACE`;
- deny `/tmp` and `/var/tmp` before re-allowing the private runtime directory;
- allow writes to the selected repository and runtime directory;
- allow reads from the selected repository's `.git`;
- retain network access;
- never use `danger-full-access`.

The deny rules constrain model-controlled tools. The Codex host process still receives the real HOME and uses its existing authentication.

## Workflows

Preserve current triggers, same-repository gate, exact PR resolution, exact checkout, `persist-credentials: false`, checkout credential verification, active-plan selection, artifact upload, failure propagation, and finalization.

Update:

- `.github/workflows/agent-relay.yml`;
- `examples/github-actions/agent-relay.yml`;
- `.github/workflows/ci.yml`.

All require `[self-hosted, agent-relay, gh-runner]`.

The Codex step sets `CODEX_WORKSPACE_ROOT` from `${{ runner.workspace }}`, invokes the installed CLI with `pipefail`, and pipes output into `${RUNNER_TEMP}/codex-console.log`. Upload the artifact with `if: always()`, then fail when Codex failed. Finalization uses the installed `finalize.sh`, derived message, API-derived branch, and step-scoped `${{ github.token }}`.

Remove `AGENT_RELAY_TOKEN`, Relay URL, request IDs, and polling variables. The Codex step receives no GitHub token. The built-in token remains explicit only for PR resolution, checkout, and finalization.

The GitHub Actions log and uploaded artifact are the retained Codex output. There is no additional API or state directory.

## Repository transformation

Add `install.sh`, `src/run-codex.ts`, and direct-execution/installer tests.

Retain and adapt executor, prompt, redaction, workspace checks, PR resolver, finalizer, Codex launcher, toolchain smoke, workflows, instructions, README, and operations documentation.

Remove after replacements pass:

- Dockerfiles, Compose, `.dockerignore`, `.env.example`, and obsolete `.env` ignore;
- runner entrypoint and Relay client;
- server, API, configuration, job service, job store, and unused HTTP/job contracts;
- tests that only cover removed transport, persistence, Docker packaging, or container startup.

Keep repository/package/workflow names, compatibility labels, and historical completed ExecPlans unchanged.

## Tests

Tests use controlled commands, filesystems, processes, and Git repositories. They must not require real credentials, downloads, systemd, Docker, WSL, or GitHub services.

Cover:

- direct CLI validation, `${{ runner.workspace }}` containment, plan boundaries, integer parsing, and commit-message normalization;
- actual executor success, failure, spawn error, timeout, force-kill, truncation, split UTF-8, split secrets, and live redaction;
- active-plan movement after the heading is captured;
- launcher proof that real-home, auth, runner, source, and other workspace fixtures are unchanged;
- installer preflight, toolchain decisions, remote normalization, login branching, hidden token input, first registration, `_work`, dual labels, `svc.sh`, failure preservation, repository mismatch, and token-free rerun;
- proof that the token is absent from output, files, units, profiles, and child environments;
- workflow dual labels, trusted installed paths, workspace-context propagation, token scoping, artifact upload, and finalization;
- native packaging and absence of active Docker/Relay artifacts;
- retained resolver and finalizer behavior;
- shell syntax for all retained scripts.

Test substitutions may use PATH and temporary roots. They must not create a second production installation path.

## Documentation and acceptance

Current documentation must describe `./install.sh`, script-driven Codex login, the initial hidden token prompt, fixed name and dual labels, direct Codex output, updates through the same installer, official re-registration, and uninstall of only the new installation.

It may recommend placing the source checkout under `/srv/github-runner` and may tell the user to start the prepared host with `wsl -d gh-runner`. Those are user instructions only. Runtime code and installer must not depend on that path or detect WSL.

Acceptance requires `npm ci` and `npm run check`, deterministic execution of the real CLI/launcher/installer/resolver/finalizer through fixtures, dual-label isolation from the old runner, no Relay transport or secret, no model-controlled access to the user home, idempotent installer behavior, no old-environment operations, and no broad unrelated refactor.