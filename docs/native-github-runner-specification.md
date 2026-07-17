# Native GitHub Runner and Codex Technical Specification

## Goal

Replace the former container and Agent Relay runtime with one fresh native Debian installation.

The official GitHub Actions runner is the only long-lived service. It invokes a trusted, root-owned Codex harness directly in the checked-out pull-request workspace. The implementation must not inspect, stop, unregister, copy from, clean, or modify the previous environment.

## Runtime contract

The target is Debian x86-64 with one non-root user, `sudo`, a writable home, outbound HTTPS, and systemd.

The repository checkout in WSL is:

```text
/srv/github-runner/storage/agent-relay
```

The installer resolves its source root from its own path. Runtime behavior does not depend on the repository being under `$HOME`.

When WSL does not run systemd as PID 1, the installer updates only the `[boot]` systemd setting in `/etc/wsl.conf`, exits, and instructs the user to run `wsl --shutdown` before rerunning it.

Install one organization runner with:

- URL `https://github.com/Divorium`;
- name `gh-runner`;
- directory `$HOME/.local/share/actions-runner`;
- work directory `_work`;
- no custom labels;
- workflow routing `runs-on: [self-hosted]`.

Runner-group access remains an existing organization policy and is not managed by this repository.

## User flow

The only setup and update entrypoint is:

```bash
cd /srv/github-runner/storage/agent-relay
./install.sh
```

The user only:

1. runs the installer;
2. restarts WSL when the installer has enabled systemd and reruns it;
3. completes `codex login` when invoked;
4. pastes one GitHub PAT into a hidden prompt when no runner registration exists.

The installer exchanges the PAT for GitHub's short-lived organization runner registration token. A classic PAT requires `admin:org` and also `repo` when private repositories are involved. A fine-grained PAT requires organization `Self-hosted runners` write permission.

The installer asks for no repository URL, organization name, runner name, labels, workspace path, Relay credential, authentication path, UID, GID, environment file, service setting, or manually generated registration token.

## Installed layout

```text
/srv/github-runner/storage/agent-relay       source checkout
/opt/agent-relay                             trusted root-owned harness
/usr/local/bin/codex-run                     root-owned Codex launcher
$HOME/.local/share/actions-runner            official runner
$HOME/.local/share/actions-runner/_work      runner workspaces
$HOME/.codex/auth.json                       current user's Codex authentication
$HOME/.cache/agent-relay-runtime             parent for private per-run state
/opt/java/openjdk                            Java 21 compatibility link
/usr/local/go                                Go toolchain
/opt/rust                                    root-owned Rust toolchain
```

The source checkout is not a runner workspace. Workflow jobs must not modify it.

## Installer contract

`install.sh` must:

- be executable in Git;
- refuse root execution and use `sudo` only for system changes;
- resolve its source root from `BASH_SOURCE`;
- verify Debian x86-64, `sudo`, a readable and writable source checkout, a writable home, systemd, and outbound HTTPS;
- configure WSL systemd before requiring an active `systemctl` environment;
- require no `.env` and no arguments;
- avoid a general distribution upgrade;
- never invoke old-environment or host-lifecycle operations;
- install system Node.js 22 and npm, TypeScript 5.8.3, Codex CLI 0.144.4, Temurin Java 21, Go 1.24.5, Rust stable, Python, Git, Git LFS, build tools, and runner dependencies;
- checksum-verify the Go and runner archives;
- run `npm ci`, `npm run check`, and the toolchain/Codex-profile smoke test before replacing trusted files;
- stage `/opt/agent-relay` on the same filesystem and restore the previous harness if the swap or launcher installation fails;
- install `/usr/local/bin/codex-run` root-owned;
- invoke Codex login only when authentication is absent;
- preserve an existing complete runner installation, registration, `_work`, diagnostics, and newer self-updated runner;
- reject an existing `.runner` registration when `bin/Runner.Listener` is missing instead of destroying it;
- request a short-lived organization registration token only when `.runner` is absent;
- register without custom labels;
- install, start, and verify the official runner service;
- install GitHub's Debian `needrestart` override.

Fresh downloads are pinned to:

- GitHub Actions Runner `2.335.1`, SHA-256 `4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf`;
- Go `1.24.5`, SHA-256 `10ad9e86233e74c0f6590fe5426895de6bf388964210eac34a6d83f38918ecdc`;
- TypeScript `5.8.3`;
- Codex CLI `0.144.4`.

The PAT stays in shell memory, is not placed in process arguments, and is unset immediately after the API call. The short-lived registration token is passed only to the official `config.sh --token` argument and unset immediately afterward. Neither token is persisted in files, services, profiles, installed payloads, or retained child environments.

## Direct Codex execution

The installed `dist/src/run-codex.js` requires:

- `GITHUB_WORKSPACE`;
- `GITHUB_OUTPUT`;
- `CODEX_PLAN_PATH`;
- `CODEX_WORKSPACE_ROOT=${{ runner.workspace }}`;
- `HOME`.

Optional positive integers:

- `CODEX_TIMEOUT_MS`, default `21600000`;
- `MAX_OUTPUT_BYTES`, default `10000000`.

The direct CLI must:

- enforce realpath containment below the runner workspace root;
- accept only a regular, non-symlink Markdown file directly under `docs/exec-plans/active`;
- derive the normalized commit message before execution;
- build the minimal prompt pointing only to `.agent/PLANS.md` and the selected plan;
- invoke `/usr/local/bin/codex-run` through the retained executor;
- stream redacted stdout and stderr;
- enforce process-group timeout, delayed `SIGKILL`, output cap, truncation, and non-zero failure behavior;
- append `commit_message` only after successful execution.

There are no request IDs, HTTP calls, job IDs, polling, result DTOs, persisted Relay state, or restart recovery.

## Launcher and permission profile

`scripts/codex-run` must:

- refuse root;
- use `umask 0077`;
- verify `$HOME/.codex/auth.json`;
- create and remove only one private execution directory;
- never delete, copy, move, rewrite, or symlink real-home, auth, runner, source, or workspace files;
- invoke Codex through `env -i` with explicit locale, real HOME, current user identity, deterministic toolchain paths, and private runtime paths;
- forward termination signals.

The `agent` permission profile:

- disables memories;
- denies the real home, `/opt/agent-relay`, the complete runner workspace root, `/tmp`, and `/var/tmp`;
- grants read-only access to `/opt/rust` so `cargo`, `rustc`, and the root-owned Rust toolchain remain usable but immutable;
- grants write access only to the selected repository and private runtime directory;
- keeps the selected repository's `.git` directory read-only;
- enables required network access;
- never uses `danger-full-access`.

The launcher redirects Cargo, npm, pip, Go, Gradle, XDG, and temporary caches into the private runtime directory. It sets `GIT_CONFIG_GLOBAL=/dev/null` so model-controlled Git does not read the denied real home.

This profile constrains model-controlled Codex tools, not arbitrary workflow steps. Only trusted organization repositories and workflows may use the runner.

## Workflows

Maintain:

- `.github/workflows/agent-relay.yml`;
- `examples/github-actions/agent-relay.yml`;
- `.github/workflows/ci.yml`.

Every job uses:

```yaml
runs-on: [self-hosted]
```

Preserve the same-repository gate, installed PR resolver, exact checkout, `persist-credentials: false`, credential verification, active-plan selection, output capture through `tee`, artifact upload with `if: always()`, delayed failure, and installed finalizer.

The Codex step receives no GitHub token. GitHub credentials remain step-scoped to PR resolution, checkout, and finalization.

## Repository transformation

Retain and adapt the executor, prompt, redaction, workspace safety, resolver, finalizer, launcher, toolchain smoke, workflows, instructions, and current documentation.

Remove container packaging, environment-file configuration, runner container entrypoint, Relay client, HTTP API, server, bearer auth, job service, job store, persisted queue/state, and tests or current docs that cover only those removed components.

Historical completed ExecPlans remain unchanged.

## Tests and acceptance

Repository tests must cover:

- direct CLI validation, boundaries, symlinks, limits, commit-message normalization, success, failure, and plan movement;
- executor output, redaction, spawn failure, timeout, process-group termination, truncation, and permission profile;
- launcher preservation of real state, private cache routing, and environment isolation;
- installer pins, WSL systemd ordering, validation-before-swap, rollback, PAT exchange, organization registration, no labels, service commands, and rerun guards;
- workflow routing, installed helper paths, token scoping, artifact upload, resolver, and finalizer;
- absence of active Relay/container artifacts;
- current README and operations documentation.

Acceptance requires:

1. `npm ci` and `npm run check` pass as a non-root user.
2. All maintained workflows use only `[self-hosted]`.
3. The installer obtains the short-lived runner token itself from one hidden PAT.
4. No active Relay transport, secret, polling, persisted state, obsolete deployment, or previous-environment operation remains.
5. Runtime code is independent of the documented source checkout path.
6. Current documentation and implementation agree.

Do not claim live credentials, runner-group policy, package installation, systemd changes, GitHub registration, service startup, or host lifecycle were exercised without actual target-host evidence.
