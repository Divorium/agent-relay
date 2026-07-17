# Native GitHub Runner and Codex Technical Specification

## Goal

Replace the two-container Docker Compose runtime with one fresh native Debian installation.

The official GitHub Actions runner is the only long-lived service. It invokes a trusted installed Codex harness directly in the checked-out repository. The implementation does not inspect, stop, unregister, copy from, clean, or modify the previous environment.

Retain PR resolution, checkout safety, active ExecPlan selection, Codex restrictions, streaming redaction, execution limits, artifact output, and trusted commit/push finalization. Remove only Docker packaging and the Agent Relay transport/process.

## Runtime contract

The target is Debian x86-64 with one non-root user, `sudo`, a writable home, outbound HTTPS, and systemd. Under WSL, the installer configures `/etc/wsl.conf` when systemd is disabled, then instructs the user to stop and restart WSL before rerunning the installer.

Install one organization-level runner with:

- registration URL: `https://github.com/Divorium`;
- runner name: `gh-runner`;
- installation directory: `$HOME/.local/share/actions-runner`;
- work directory: `_work`;
- custom labels: none;
- workflow routing: `runs-on: [self-hosted]`.

The runner uses the organization's existing runner-group access policy. The installer does not create or modify runner groups.

The old runner is disabled by the user outside this repository. Runtime code does not detect or manage it.

## User flow

The only setup and update entrypoint is:

```bash
./install.sh
```

The user only:

1. copies or clones the repository and runs `./install.sh`;
2. stops and restarts WSL if the installer has just enabled systemd, then reruns `./install.sh`;
3. completes `codex login` when the installer invokes it;
4. pastes one GitHub token into a hidden prompt when no runner registration exists.

The installer exchanges that GitHub token for GitHub's short-lived organization runner registration token. A classic PAT requires `admin:org`; a fine-grained token requires organization `Self-hosted runners` write permission. Neither token is persisted.

The installer asks for no repository URL, organization name, runner name, labels, workspace path, Relay credential, authentication-file path, UID, GID, environment file, service setting, or manually generated registration token.

## Installed layout

- trusted runtime: `/opt/agent-relay`;
- Codex launcher: `/usr/local/bin/codex-run`;
- runner: `$HOME/.local/share/actions-runner`;
- workspaces: `$HOME/.local/share/actions-runner/_work`;
- Codex authentication: `$HOME/.codex/auth.json`;
- Java compatibility link: `/opt/java/openjdk`;
- Go: `/usr/local/go`;
- Rust: `/opt/rust`;
- per-run state: one private directory under `$HOME/.cache/agent-relay-runtime`.

The trusted runtime, launcher, and Rust installation are root-owned. The runner directory remains owned by the runtime user. No credentials or persistent execution state are stored in the source checkout.

## Installer contract

`install.sh` must:

- refuse root execution and use `sudo` only for system changes;
- resolve the source root from its own path;
- verify Debian x86-64, `sudo`, a writable home, systemd, and outbound HTTPS;
- configure WSL systemd without replacing unrelated `/etc/wsl.conf` settings;
- require no `.env` and no arguments;
- avoid a general distribution upgrade;
- never invoke Docker, Docker Compose, host lifecycle commands, or previous-environment operations;
- install the retained toolchain capabilities;
- run `npm ci`, `npm run check`, and `npm run build` before replacing installed application files;
- stage and atomically replace `/opt/agent-relay` only after validation succeeds;
- install `/usr/local/bin/codex-run` and system-wide Rust;
- run the native toolchain smoke test;
- invoke Codex login only when authentication is absent;
- install and checksum-verify the GitHub runner archive only when the runner binary is absent;
- request a short-lived registration token through the GitHub organization API only when `.runner` is absent;
- register the runner without custom labels;
- install, start, and verify the official runner service through `svc.sh`;
- install GitHub's Debian `needrestart` service override;
- preserve registration, authentication, `_work`, diagnostics, and a newer self-updated runner on rerun.

Retain these toolchain capabilities:

- Node.js 22 and npm;
- TypeScript 5.8.3;
- Codex CLI 0.144.4;
- Temurin Java 21;
- Go 1.24.5;
- Rust stable;
- Python 3 with pip and venv;
- Git and Git LFS;
- C/C++ tools, clang, cmake, and pkg-config;
- curl, wget, jq, archive tools, rsync, file, findutils, diffutils, and official runner dependencies.

The smoke test validates required tools and retained pins. It must not reject unrelated installed programs such as OpenSSH or .NET.

For a fresh installation use GitHub Actions Runner `2.335.1`:

- archive: `actions-runner-linux-x64-2.335.1.tar.gz`;
- SHA-256: `4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf`.

Use Go `1.24.5` Linux x86-64 with SHA-256:

```text
10ad9e86233e74c0f6590fe5426895de6bf388964210eac34a6d83f38918ecdc
```

Run `config.sh --unattended --replace` with the organization URL, name `gh-runner`, and work directory `_work`. Do not pass `--labels`. Read the GitHub PAT without echo, keep it in shell memory only, avoid placing it in child-process arguments, unset it after the API call, unset the registration token after `config.sh`, and never place either token in files, logs, services, profiles, installed payloads, or retained child environments.

Keep the official automatic runner updater enabled. An existing runner binary is authoritative so the installer does not downgrade a newer self-updated runner.

## Direct Codex execution

Compile `src/run-codex.ts` and install it under `/opt/agent-relay`. Workflows must never execute equivalent harness code from pull-request content.

Required environment:

- `GITHUB_WORKSPACE`;
- `GITHUB_OUTPUT`;
- `CODEX_PLAN_PATH`;
- `CODEX_WORKSPACE_ROOT=${{ runner.workspace }}`;
- `HOME`.

Optional positive integers:

- `CODEX_TIMEOUT_MS`, default `21600000`;
- `MAX_OUTPUT_BYTES`, default `10000000`.

The CLI must:

- enforce realpath workspace containment below the runner workspace root;
- accept only a regular, non-symlink Markdown file directly under `docs/exec-plans/active`;
- derive the normalized commit message before execution;
- build the minimal prompt pointing only to `.agent/PLANS.md` and the selected plan;
- invoke `/usr/local/bin/codex-run` through the retained executor;
- stream redacted stdout and stderr to the workflow step;
- preserve timeout, process-group `SIGTERM`, delayed `SIGKILL`, output cap, truncation, and failure behavior;
- append `commit_message` only after successful execution;
- return non-zero on validation, spawn, timeout, or Codex failure.

Remove request IDs, HTTP calls, job IDs, polling, result DTOs, persisted Relay logs/state, and restart recovery. GitHub Actions logs and the uploaded artifact are the retained output.

## Minimal executor adaptation

Reuse prompt construction, workspace checks, redaction, timeout, force-kill, output-cap, and truncation logic. Do not redesign the executor or add a new result protocol.

Change only transport-specific parts:

- pass the plan path directly instead of a Relay job DTO;
- remove persisted output-file handling;
- stream output for workflow capture;
- replace HTTP-oriented errors with minimal execution errors;
- parameterize native permission paths.

## Codex launcher and permissions

`scripts/codex-run` must:

- refuse root;
- use `umask 0077`;
- verify `$HOME/.codex/auth.json`;
- create and clean only one private execution directory;
- never delete, copy, move, rewrite, or symlink real-home, auth, runner, source, or workspace files;
- invoke Codex through `env -i` with explicit locale, real HOME, current user identity, native toolchain paths, private cargo/temp paths, and `GIT_OPTIONAL_LOCKS=0`;
- forward termination signals to the Codex child.

Use a neutral permissions profile `agent`. It disables memories, denies the real home, trusted installation, Rust installation, workspace root, and general temporary roots, then re-allows only the selected repository, its `.git` read access, and the private runtime directory. Required network access remains enabled and `danger-full-access` is forbidden.

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

Preserve current triggers, same-repository gate, installed PR resolver, exact checkout, `persist-credentials: false`, credential verification, active-plan selection, direct output through `tee`, artifact upload with `if: always()`, delayed failure, and the installed finalizer.

Use installed helpers under `/opt/agent-relay`. Remove `/runner` container paths, Relay credentials, Relay URL, request IDs, and polling variables.

The Codex step receives no GitHub token. The token remains step-scoped to PR resolution, checkout, and finalization.

## Repository transformation

Add:

- executable `install.sh`;
- `src/run-codex.ts`;
- minimal execution errors;
- direct-execution, installer, launcher, and security regression tests.

Retain and adapt:

- executor, prompt, redaction, and workspace safety;
- resolver and finalizer;
- Codex launcher and toolchain smoke;
- workflows, repository instructions, README, and operations documentation.

Remove after replacement tests pass:

- both Dockerfiles, Compose, `.dockerignore`, `.env.example`, and obsolete `.env` ignore;
- runner container entrypoint and Relay client;
- server, API, configuration, bearer auth, job service, job store, and unused HTTP/job contracts;
- tests and operations material covering only removed transport, polling, persistence, Docker packaging, or container startup.

Update `package.json` to remove server and container-entrypoint commands while retaining strict type checking, build, coverage, shell validation, and `npm run check`.

Do not modify historical completed ExecPlans.

## Tests and acceptance

Tests use controlled command, filesystem, process, HTTP, and Git fixtures. They require no real credentials, downloads, systemd, Docker, or GitHub services.

Cover:

- direct CLI input validation, path boundaries, symlinks, integer parsing, commit-message normalization, success output, failure output, and plan movement;
- executor success, exit failure, spawn error, timeout, process-group termination, truncation, split UTF-8, split secrets, and live redaction;
- launcher preservation of home, authentication, runner, source, and unrelated workspaces;
- installer pins, checksum verification, WSL systemd configuration, validation-before-install ordering, hidden PAT input, registration-token API call, organization registration, `_work`, no custom labels, `svc.sh`, `needrestart`, and idempotent rerun conditions;
- workflow `[self-hosted]`, trusted installed paths, workspace propagation, token scoping, artifact upload, and finalization;
- absence of active Docker and Relay runtime artifacts;
- retained resolver/finalizer behavior and shell syntax.

Acceptance requires:

1. `npm ci` and `npm run check` pass.
2. Deterministic tests execute the real direct CLI, executor, launcher, resolver, finalizer, and shell parsers, while installer behavior is verified without mutating the CI host.
3. All maintained workflows use only `[self-hosted]`.
4. The installer registers against `https://github.com/Divorium`, requests no custom labels, and asks only for Codex login and one GitHub PAT when required.
5. The installer obtains the short-lived runner token itself; the user never generates or supplies it manually.
6. No Relay transport, secret, polling, persisted state, Docker deployment, or old-environment operation remains active.
7. No implementation code depends on host-specific source-checkout paths, mounted drives, host lifecycle, or the previous deployment.
8. Current documentation describes the organization runner and single installer.
9. Final file-by-file review finds no conflict with this specification.

Do not claim live credentials, runner-group policy, downloads, systemd, GitHub registration, or host lifecycle were exercised unless genuine evidence exists.
