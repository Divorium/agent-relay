# Native GitHub Runner and Codex Technical Specification

## Goal

Replace the two-container Docker Compose runtime with one fresh native Debian installation.

The official GitHub Actions runner is the only long-lived service. It invokes a trusted installed Codex harness directly in the checked-out repository. The implementation does not inspect, stop, unregister, copy from, clean, or modify the previous environment.

Retain existing PR resolution, checkout safety, active ExecPlan selection, Codex restrictions, streaming redaction, execution limits, artifact output, and trusted commit/push finalization. Remove only Docker packaging and the Agent Relay transport/process.

## Runtime contract

The prepared runtime provides Debian, systemd, one non-root user with `sudo`, a writable home, and outbound HTTPS.

Install one organization-level runner with:

- registration URL: `https://github.com/Divorium`;
- runner name: `gh-runner`;
- installation directory: `$HOME/.local/share/actions-runner`;
- work directory: `_work`;
- custom labels: none;
- workflow routing: `runs-on: [self-hosted]`.

The runner uses the organization's existing runner-group access policy. The installer does not manage runner groups and does not require another GitHub credential for that purpose.

The old runner is disabled by the user outside this repository. Runtime code does not detect or manage it.

Implementation code must not depend on host virtualization, mounted drives, source-checkout location, or host lifecycle.

## User flow

The only setup and update entrypoint is:

```bash
./install.sh
```

The user only:

1. runs `./install.sh` from the copied or cloned repository;
2. completes `codex login` when the installer invokes it;
3. pastes a time-limited organization runner registration token into a hidden prompt when no runner registration exists.

The installer asks for no repository URL, organization name, runner name, labels, workspace path, Relay credential, authentication-file path, UID, GID, environment file, or service setting.

## Installed layout

- trusted runtime: `/opt/agent-relay`;
- Codex launcher: `/usr/local/bin/codex-run`;
- runner: `$HOME/.local/share/actions-runner`;
- workspaces: `$HOME/.local/share/actions-runner/_work`;
- Codex authentication: `$HOME/.codex/auth.json`;
- Go: `/usr/local/go`;
- Rust: `/opt/rust`;
- per-run state: one private directory created with `mktemp`.

The trusted runtime, launcher, and Rust installation are root-owned. The runner directory remains owned by the runtime user. No credentials or persistent runtime state are stored in the source checkout.

## Installer contract

`install.sh` must:

- refuse root execution and use `sudo` only for system changes;
- resolve the source root from its own path;
- verify Debian, systemd, `sudo`, a writable home, and download prerequisites;
- require no `.env` and no normal-path arguments;
- avoid a general distribution upgrade;
- never invoke Docker, Docker Compose, host-lifecycle commands, or previous-environment operations;
- install the capabilities currently supplied by the two Docker images;
- run `npm ci` and `npm run check` before replacing installed files;
- stage and atomically replace `/opt/agent-relay` only after validation succeeds;
- install `/usr/local/bin/codex-run` and system-wide Rust;
- run the native toolchain smoke test;
- invoke Codex login only when authentication is absent;
- install and checksum-verify the GitHub runner archive when absent;
- register only when `.runner` is absent;
- install, enable, start, and verify the official runner service through `svc.sh`;
- install GitHub's Debian `needrestart` service override;
- preserve registration, authentication, `_work`, diagnostics, and newer runner updates on rerun.

Retain these toolchain capabilities:

- Node.js 22 and npm;
- TypeScript 5.8.3;
- Codex CLI 0.144.3;
- Temurin Java 21;
- Go 1.24.5;
- Rust stable;
- Python 3 with pip and venv;
- Git and Git LFS;
- C/C++ tools, clang, cmake, and pkg-config;
- curl, wget, jq, archive tools, rsync, file, findutils, diffutils, and runner libraries.

The native smoke test validates required tools and retained pins. It must not reject unrelated installed programs such as OpenSSH or .NET.

For a fresh installation use GitHub Actions Runner `2.335.1`:

- archive: `actions-runner-linux-x64-2.335.1.tar.gz`;
- SHA-256: `4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf`.

Run `config.sh --unattended --replace` with the organization URL, name `gh-runner`, and work directory `_work`. Do not pass `--labels`. Disable shell tracing while reading and using the token, unset it immediately, and never persist it in files, logs, services, profiles, installed payloads, or retained child environments.

Keep the official automatic updater enabled and never downgrade a newer runner.

## Direct Codex execution

Add and compile `src/run-codex.ts`. Install it under `/opt/agent-relay`; workflows must not execute the runner from pull-request content.

Required environment:

- `GITHUB_WORKSPACE`;
- `GITHUB_OUTPUT`;
- `CODEX_PLAN_PATH`;
- `CODEX_WORKSPACE_ROOT=${{ runner.workspace }}`.

Optional positive integers:

- `CODEX_TIMEOUT_MS`, default `21600000`;
- `MAX_OUTPUT_BYTES`, default `10000000`.

The CLI must:

- enforce realpath workspace containment;
- accept only a regular, non-symlink Markdown file directly under `docs/exec-plans/active`;
- derive the normalized commit message before execution;
- build the existing minimal prompt;
- invoke `/usr/local/bin/codex-run` through the retained executor;
- stream redacted stdout and stderr;
- preserve timeout, SIGTERM, delayed SIGKILL, output cap, truncation, and failure behavior;
- append `commit_message` only after successful execution;
- return non-zero on validation, spawn, timeout, or Codex failure.

Remove request IDs, HTTP calls, job IDs, polling, result DTOs, persisted Relay logs/state, and restart recovery. GitHub Actions logs and the uploaded artifact are the retained output.

## Minimal executor adaptation

Reuse the current prompt, workspace checks, redactor, timeout, force-kill, output-cap, and truncation logic. Do not redesign the executor or add a new result protocol.

Change only transport-specific parts:

- pass the plan path directly instead of a Relay job DTO;
- remove persisted output-file handling;
- stream output for workflow capture;
- replace HTTP-oriented errors with minimal execution errors;
- parameterize native permission paths.

## Codex launcher and permissions

Rewrite `scripts/codex-run` so it:

- refuses root;
- uses `umask 0077`;
- verifies `$HOME/.codex/auth.json`;
- creates and cleans only one private execution directory;
- never deletes, copies, moves, rewrites, or symlinks real-home, auth, runner, source, or workspace files;
- invokes Codex through `env -i` with explicit locale, real HOME, current user identity, native toolchain paths, private cargo/temp paths, and `GIT_OPTIONAL_LOCKS=0`.

Use a neutral permissions profile such as `agent`. It must disable memories, deny the real home, trusted installation, Rust installation, workspace root, and general temporary roots, then re-allow only the selected repository, its `.git` read access, and the private runtime directory. Required network access remains enabled and `danger-full-access` is forbidden.

This profile constrains model-controlled Codex tools, not arbitrary workflow steps. Only trusted organization repositories and workflows may use the runner.

## Workflows

Update:

- `.github/workflows/agent-relay.yml`;
- `examples/github-actions/agent-relay.yml`;
- `.github/workflows/ci.yml`.

Every job uses:

```yaml
runs-on: [self-hosted]
```

Preserve current triggers, same-repository gate, installed PR resolver, exact checkout, `persist-credentials: false`, credential verification, active-plan selection, direct output through `tee`, artifact upload on failure, delayed failure, and the installed finalizer.

Use installed helpers under `/opt/agent-relay`. Remove `/runner` paths, Relay credentials, Relay URL, request IDs, and polling variables.

The Codex step receives no GitHub token. The token remains step-scoped to PR resolution, checkout, and finalization.

## Repository transformation

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

- both Dockerfiles, Compose, `.dockerignore`, `.env.example`, and obsolete `.env` ignore;
- runner container entrypoint and Relay client;
- server, API, configuration, job service, job store, and unused HTTP/job contracts;
- tests covering only removed transport, polling, persistence, Docker packaging, or container startup.

Update `package.json` to remove server and container-entrypoint commands while retaining strict type checking, build, coverage, shell validation, and `npm run check`.

Do not modify historical completed ExecPlans.

## Tests and acceptance

Tests use controlled command, filesystem, process, HTTP, and Git fixtures. They require no real credentials, downloads, systemd, Docker, or GitHub services.

Cover:

- direct CLI input validation, path boundaries, symlinks, integer parsing, commit-message normalization, and plan movement;
- executor success, no-op, exit failure, spawn error, timeout, force-kill, truncation, split UTF-8, split secrets, and live redaction;
- launcher preservation of home, authentication, runner, source, and unrelated workspaces;
- installer preflight, toolchain decisions, runner checksum, login branching, hidden token input, organization registration, `_work`, no custom labels, `svc.sh`, `needrestart`, failure preservation, and token-free rerun;
- workflow `[self-hosted]`, trusted installed paths, workspace propagation, token scoping, artifact upload, and finalization;
- absence of active Docker and Relay runtime artifacts;
- retained resolver/finalizer behavior and shell syntax.

Acceptance requires:

1. `npm ci` and `npm run check` pass.
2. Deterministic tests execute the real CLI, executor, launcher, installer, resolver, and finalizer.
3. All maintained workflows use only `[self-hosted]`.
4. The installer registers against `https://github.com/Divorium`, requests no custom labels, and asks only for Codex login and an organization registration token.
5. No Relay transport, secret, polling, persisted state, Docker deployment, or old-environment operation remains active.
6. No implementation code depends on host-specific paths, source-checkout location, host lifecycle, or the previous deployment.
7. Current documentation describes the organization runner and the single installer.
8. Final file-by-file review finds no conflict with this specification.

Do not claim live credentials, runner-group policy, downloads, systemd, GitHub registration, or host lifecycle were exercised unless genuine evidence exists.
