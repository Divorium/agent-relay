# Install a native organization GitHub runner that executes Codex directly

This ExecPlan is maintained according to `.agent/PLANS.md` and implemented together with `docs/native-github-runner-specification.md`.

## Purpose / Big Picture

Replace the former two-process container deployment with one fresh native Debian installation managed by one repository script.

The target runtime has one long-lived service: the official GitHub Actions runner. Workflow jobs invoke a root-owned installed Codex harness directly in the checked-out pull-request workspace. There is no Agent Relay HTTP server, bearer token, polling client, queue, persisted Relay state, or second application service.

This is not a migration or cutover procedure. The implementation does not inspect, stop, unregister, copy from, clean, or modify the previous environment.

The source checkout in WSL is:

```text
/srv/github-runner/storage/agent-relay
```

The only installation and update entrypoint is:

```bash
cd /srv/github-runner/storage/agent-relay
./install.sh
```

## User-visible result

The completed installer:

- configures WSL systemd when required and stops before continuing until WSL is restarted;
- installs the required native toolchain;
- validates the repository before replacing trusted runtime files;
- installs the trusted harness under `/opt/agent-relay`;
- invokes `codex login` only when authentication is absent;
- asks once for a GitHub PAT only when no runner registration exists;
- exchanges the PAT for GitHub's short-lived organization runner registration token;
- installs and registers one organization runner named `gh-runner` with work directory `_work` and no custom labels;
- installs, starts, and verifies the official runner systemd service.

The installer asks for no repository URL, organization name, runner name, labels, workspace path, Relay credential, authentication-file path, UID, GID, environment file, service setting, or manually generated runner registration token.

## Behavior preserved

- reject fork-origin pull requests before untrusted repository code runs;
- resolve an open, ready pull request and its exact head SHA/ref;
- checkout the resolved SHA with `persist-credentials: false`;
- verify that checkout credentials are absent before Codex starts;
- select exactly one regular, non-symlink active ExecPlan;
- give Codex only `.agent/PLANS.md` and the selected plan as task context;
- prevent Codex from committing or pushing;
- enforce workspace containment, symlink protection, restricted filesystem access, and required network access;
- enforce timeout, process-group `SIGTERM`, delayed `SIGKILL`, output cap, streaming redaction, and non-zero failure behavior;
- treat a clean worktree as a successful no-op;
- validate, commit, and push a changed worktree through the trusted finalizer;
- keep redacted Codex output visible in GitHub Actions and upload it even when execution fails.

## Implemented architecture

### Direct Codex execution

`src/run-codex.ts` is the installed direct entrypoint. It validates `GITHUB_WORKSPACE`, `GITHUB_OUTPUT`, `CODEX_PLAN_PATH`, `CODEX_WORKSPACE_ROOT`, and `HOME`; validates optional positive execution limits; resolves the real workspace; validates the active plan; derives the commit message before execution; invokes the retained executor; and writes `commit_message` only after successful execution.

`src/execution/codex-executor.ts` retains the useful executor behavior without Relay DTOs or persistence. It starts the launcher in a detached process group, streams redacted stdout and stderr, caps output, sends `SIGTERM` on timeout, sends delayed `SIGKILL`, and returns non-zero failure through minimal execution errors.

The Codex permission profile:

- disables memories;
- denies the real home, `/opt/agent-relay`, `/opt/rust`, `/tmp`, `/var/tmp`, and the complete runner workspace root;
- re-allows writes only to the selected repository and private runtime directory;
- grants read access to the selected repository `.git` directory;
- enables required network access;
- never uses `danger-full-access`.

### Native launcher

`scripts/codex-run`:

- refuses root execution;
- verifies `$HOME/.codex/auth.json`;
- creates one private per-run directory;
- replaces the child environment through `env -i`;
- exposes only the real `HOME`, current user identity, locale, deterministic toolchain paths, private Cargo/temp paths, and `GIT_OPTIONAL_LOCKS=0`;
- forwards termination signals;
- removes only its private directory.

It does not delete, copy, move, rewrite, or symlink user-home, authentication, runner, source, or workspace files.

### Installer

`install.sh`:

- runs as the existing non-root Debian user and uses `sudo` only for system changes;
- resolves `SOURCE_ROOT` from `BASH_SOURCE`, so `/srv/github-runner/storage/agent-relay` requires no configuration;
- verifies Debian x86-64, a writable home and source checkout, `sudo`, systemd, and outbound HTTPS;
- configures `/etc/wsl.conf` without replacing unrelated settings when WSL needs systemd enabled;
- installs system Node.js 22 and npm under `/usr/bin`;
- installs TypeScript 5.8.3 and Codex CLI 0.144.4 under `/usr/local`;
- installs Temurin Java 21, Go 1.24.5, Rust stable, Python, Git, Git LFS, build tools, archive utilities, and runner dependencies;
- checksum-verifies Go and GitHub Actions Runner archives;
- runs `npm ci`, `npm run check`, and the native toolchain/Codex-profile smoke test before replacing trusted files;
- stages `/opt/agent-relay` on the same filesystem and restores the previous harness when a swap or launcher installation is interrupted;
- preserves Codex authentication, runner registration, `_work`, diagnostics, and a newer runner version on rerun;
- rejects a registered runner directory whose listener binary is missing instead of destroying its registration;
- keeps the PAT out of command arguments, files, logs, services, profiles, installed payloads, and retained child environments;
- passes GitHub's short-lived registration token only to the official `config.sh --token` argument, then unsets it immediately after configuration.

Fresh installations pin:

- GitHub Actions Runner `2.335.1`, SHA-256 `4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf`;
- Go `1.24.5`, SHA-256 `10ad9e86233e74c0f6590fe5426895de6bf388964210eac34a6d83f38918ecdc`;
- TypeScript `5.8.3`;
- Codex CLI `0.144.4`.

### Workflows

The production workflow, example workflow, and CI use:

```yaml
runs-on: [self-hosted]
```

They use trusted helpers only from `/opt/agent-relay`, preserve exact pull-request resolution and credential-free checkout, pass `${{ runner.workspace }}` as the workspace root, capture output through `tee`, upload the output artifact with `if: always()`, delay failure until after upload, and use the trusted finalizer for commit/push.

The Codex step receives no GitHub token. GitHub credentials remain step-scoped to pull-request resolution, checkout, and finalization.

## Removed repository elements

- `Dockerfile` and `Dockerfile.runner`;
- `compose.yml` and `.dockerignore`;
- `.env.example` and the obsolete `.env` ignore entry;
- runner container entrypoint and Relay client;
- Relay HTTP API, health endpoint, bearer authentication, configuration, job service, job store, queue/state DTOs, and server entrypoint;
- persisted Relay log handling and polling/restart recovery;
- tests and current operations documentation that covered only removed transport, persistence, packaging, or container startup.

Historical completed ExecPlans were not changed.

## Progress

- [x] Reviewed the complete repository, current runtime, workflows, installer requirements, security boundaries, tests, and operations documentation.
- [x] Produced and cross-checked the native runner technical specification.
- [x] Implemented and tested the direct Codex CLI.
- [x] Adapted and tested the executor, permission profile, redaction, workspace validation, and execution limits.
- [x] Adapted and tested the native Codex launcher without destructive home operations.
- [x] Implemented and statically validated the idempotent WSL/Debian installer, archive pins, rollback, login path, PAT exchange, registration, and service commands.
- [x] Updated and tested production, example, and CI workflows with `[self-hosted]` routing and installed helpers.
- [x] Removed superseded Relay and container runtime code.
- [x] Rewrote current README, operations documentation, package scripts, and packaging checks.
- [x] Fixed the streaming redactor so token patterns without capture groups cannot duplicate or leak the matched text.
- [x] Added a real Codex CLI parser smoke command with a private existing workspace for the named permission profile before trusted harness replacement.
- [x] Made `install.sh` executable in the Git tree so `./install.sh` works after cloning.
- [x] Ran the complete repository validation suite from a clean `npm ci` as a non-root user.
- [x] Completed the final code/specification/plan consistency review.
- [ ] [blocked] Exercise the installer against the actual target WSL instance. Cause: this GitHub-connected execution environment has no access to the user's WSL, sudo session, Codex login, organization PAT, or systemd host. Impact: live package installation, Codex authentication, organization registration, service startup, runner-group visibility, and an end-to-end GitHub job are not evidenced here. Evidence: deterministic repository validation passes, but no target-host commands were run. Unblock condition: run `/srv/github-runner/storage/agent-relay/install.sh` in the target WSL environment with the required interactive credentials.

## Validation evidence

The current branch was reconstructed in an isolated filesystem and validated as a non-root user with a writable private HOME.

Command:

```bash
npm ci
npm run check
```

Result:

```text
npm ci: passed, 0 vulnerabilities
TypeScript typecheck: passed
TypeScript build: passed
Node test suites: 50 passed, 0 failed
Bash syntax validation: passed
Line coverage: 99.08%
Branch coverage: 86.69%
Function coverage: 98.62%
```

The passing tests include:

- direct CLI success, failure, active-plan movement, invalid limits, and symlink rejection;
- executor environment isolation, redaction, workspace editing, spawn failure, timeout/process-group termination, and output truncation;
- fixed token redaction including split UTF-8 and split secrets;
- workspace containment and active-plan realpath checks;
- launcher preservation of authentication, runner state, source files, unrelated workspaces, and environment isolation;
- toolchain pins and Codex named-permission-profile smoke invocation in a private workspace that is removed after validation;
- organization runner installer contracts, WSL systemd ordering, deterministic system paths, checksum verification, rollback, hidden PAT handling, registration arguments, no custom labels, service commands, and rerun guards;
- pull-request resolver behavior and workflow contracts;
- finalizer clean no-op, branch/message validation, whitespace validation, commit/push, rollback after rejected push, and retry;
- absence of active Relay transport and obsolete deployment artifacts;
- native-only README and operations documentation.

## Decisions

- Remove Agent Relay as a process and transport while preserving externally useful workflow behavior.
- Install one organization-level runner for `Divorium`.
- Use only `runs-on: [self-hosted]` and no custom labels.
- Use one installer and the existing Debian user.
- Keep the source checkout at `/srv/github-runner/storage/agent-relay` independent from the runner workspaces.
- Install the trusted harness root-owned outside Actions workspaces.
- Keep real `HOME` for Codex authentication while denying it to model-controlled tools.
- Install deterministic system toolchain paths rather than depending on NVM or user npm prefixes.
- Obtain the short-lived runner registration token inside the installer from one hidden PAT.
- Never operate on the previous environment.

## Idempotence and recovery

Rerunning `install.sh` updates required packages and the root-owned harness while preserving runner registration, Codex authentication, `_work`, diagnostics, and a newer runner version.

Failed source validation or smoke checks occur before the trusted harness swap. An interrupted swap or launcher installation restores the previous harness. Failed initial registration persists no token and can be retried through the same installer.

Recovery applies only to the new native installation and never reads from or modifies the previous environment.

## Outcomes & Retrospective

The repository implementation is complete and internally consistent. Direct execution replaces Relay without broad application refactoring. The main defects found during final review were stale operations documentation, non-transactional harness replacement, ambiguous system tool paths, a broken token-redaction replacement callback, an incomplete Codex-profile smoke check, and a missing executable bit on the installer; all were corrected and covered by automated or Git-tree validation.

The plan remains active only because live installation on the target WSL instance cannot be exercised from this environment. No claim is made that package downloads, interactive Codex login, GitHub organization registration, runner-group policy, systemd service installation, or an end-to-end self-hosted workflow were executed.
