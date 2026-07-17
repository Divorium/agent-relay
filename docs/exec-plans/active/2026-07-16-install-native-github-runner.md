# Install a native organization GitHub runner that executes Codex directly

This ExecPlan is maintained according to `.agent/PLANS.md` and must be implemented together with `docs/native-github-runner-specification.md`.

## Purpose / Big Picture

Replace the current two-container Docker Compose deployment with one fresh native Debian installation created and maintained by one repository script.

The target runtime has one long-lived service: the official GitHub Actions runner. Workflow jobs invoke a root-owned installed Codex harness directly in the checked-out repository. Remove the Agent Relay HTTP server, bearer token, polling client, queue, persisted Relay state, and second application service because the runner and Codex execute in the same operating-system environment.

This is not a migration or cutover procedure. The implementation must not inspect, stop, unregister, copy from, clean, or modify the previous Docker environment. Existing runner registration, volumes, Relay state, logs, and Codex authentication from that environment are not inputs.

The only setup and update entrypoint is:

```bash
./install.sh
```

The completed installer performs all installation and configuration. Its only interactive behavior is:

- invoking `codex login` when the current user is not authenticated;
- reading a time-limited GitHub organization runner registration token without echo when no registration exists.

These are runtime interactions of the completed installer, not manual implementation or acceptance tasks.

## Behavior to preserve

Preserve the useful behavior of the current system:

- reject fork-origin pull requests before untrusted repository code runs;
- resolve an open, ready pull request and its exact head SHA/ref;
- checkout that SHA with `persist-credentials: false`;
- verify that checkout credentials are absent before Codex starts;
- select exactly one regular, non-symlink active ExecPlan;
- give Codex only `.agent/PLANS.md` and the selected plan as task context;
- prevent Codex from committing or pushing;
- retain workspace containment, symlink protection, restricted filesystem access, and required network access;
- retain timeout, SIGTERM, delayed SIGKILL, output cap, streaming redaction, and non-zero failure behavior;
- treat a clean worktree as a successful no-op;
- validate, commit, and push a changed worktree through the trusted finalizer;
- keep redacted Codex output visible in GitHub Actions and upload it even when execution fails.

## Scope

### 1. Replace Relay transport with direct execution

Add `src/run-codex.ts` as a strict TypeScript CLI installed outside pull-request workspaces.

It must:

- validate `GITHUB_WORKSPACE`, `GITHUB_OUTPUT`, `CODEX_PLAN_PATH`, and `CODEX_WORKSPACE_ROOT`;
- parse optional positive `CODEX_TIMEOUT_MS` and `MAX_OUTPUT_BYTES` values;
- enforce realpath workspace containment and active-plan symlink protections;
- derive the commit message before Codex starts;
- build the existing minimal prompt;
- invoke `/usr/local/bin/codex-run` through the retained executor;
- stream redacted stdout and stderr;
- enforce the current timeout and output cap;
- append `commit_message` to `GITHUB_OUTPUT` only after successful execution;
- return non-zero on validation, spawn, timeout, or Codex failure.

Remove HTTP requests, request IDs, job IDs, polling, HTTP response validation, persisted job DTOs, persisted Relay logs/state, and restart recovery.

Adapt rather than redesign the existing executor. Retain prompt construction, workspace checks, redaction, timeout, force-kill, output cap, and truncation behavior. Remove only Relay DTO, persistence, and HTTP-oriented error dependencies.

### 2. Adapt the Codex launcher safely

Rewrite `scripts/codex-run` so it never deletes, copies, moves, rewrites, or symlinks files in the real user home.

The launcher must:

- refuse root execution;
- use `umask 0077`;
- verify `$HOME/.codex/auth.json`;
- create one private execution directory with `mktemp`;
- clean only that directory on exit;
- invoke Codex through `env -i` with explicit locale, current user identity, real `HOME`, native Java/Go/Rust paths, private cargo/temp paths, and `GIT_OPTIONAL_LOCKS=0`.

Keep `HOME` pointed at the real home for Codex authentication. Deny that entire home to model-controlled tools through a neutral permission profile such as `agent`.

The profile must deny the trusted installation, Rust installation, runner workspace root, and general temporary roots before re-allowing only the selected repository, its `.git` read access, and the private execution directory. Keep required network access and never use `danger-full-access`.

Only trusted organization repositories and workflows may use this runner because the Codex permission profile does not isolate arbitrary workflow steps from the runner user's account.

### 3. Add one idempotent installer

Add root-level `install.sh` as the only installation and update path.

The installer must:

- run as the existing non-root Debian user and use `sudo` only for system changes;
- resolve the source root from its own location;
- verify Debian, systemd, `sudo`, a writable home, and outbound HTTPS prerequisites;
- use fixed organization URL `https://github.com/Divorium`;
- require no `.env`, positional arguments, or routine configuration prompts;
- avoid a general distribution upgrade;
- install the toolchain currently supplied by the two Docker images;
- run `npm ci` and `npm run check` before replacing installed application files;
- stage and atomically install the trusted payload under `/opt/agent-relay`;
- install `/usr/local/bin/codex-run` and system-wide Rust under `/opt/rust`;
- run the native toolchain smoke test;
- invoke Codex login only when authentication is absent;
- install and checksum-verify the official GitHub runner archive when absent;
- prompt without echo for an organization runner registration token only when `.runner` is absent;
- register runner name `gh-runner`, work directory `_work`, and no custom labels;
- install, enable, start, and verify the official service through `svc.sh`;
- install GitHub's Debian `needrestart` service override;
- preserve registration, Codex authentication, `_work`, diagnostics, and a newer self-updated runner on rerun;
- never persist the registration token;
- never invoke Docker, Docker Compose, host-lifecycle commands, or operations against the previous environment.

The normal path asks for no repository URL, organization name, runner name, labels, workspace path, Relay credential, Codex auth path, UID, GID, environment file, or service setting.

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

The native smoke test must validate required tools without rejecting unrelated installed software such as OpenSSH or .NET.

Use GitHub Actions Runner `2.335.1` for a fresh installation and verify SHA-256:

```text
4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf
```

Keep the official updater enabled and never downgrade a newer runner.

### 4. Register one organization runner

Register against:

```text
https://github.com/Divorium
```

Do not pass `--labels`. Use runner name `gh-runner` and work directory `_work`.

The runner enters the organization's default runner group and follows the existing repository-access policy. The installer must not introduce another GitHub credential to manage runner groups.

Every maintained workflow job must use:

```yaml
runs-on: [self-hosted]
```

The user disables the old runner outside this repository. The implementation must not detect or manage it.

### 5. Preserve workflow orchestration without Relay

Update:

- `.github/workflows/agent-relay.yml`;
- `examples/github-actions/agent-relay.yml`;
- `.github/workflows/ci.yml`.

Use trusted installed helpers under `/opt/agent-relay`, never equivalent code from the pull-request checkout.

Retain existing triggers, manual inputs, fork gate, installed PR resolver, exact checkout, credential verification, active-plan selection, `pipefail`, output capture through `tee`, artifact upload with `if: always()`, delayed failure, and the installed finalizer.

Set `CODEX_WORKSPACE_ROOT` from `${{ runner.workspace }}`.

Remove `AGENT_RELAY_TOKEN`, `AGENT_RELAY_URL`, request IDs, polling variables, container service names, and `/runner` paths. The Codex step receives no GitHub token; the token remains explicit only in PR resolution, checkout, and finalization.

### 6. Remove superseded code only after replacements pass

Remove:

- `Dockerfile`, `Dockerfile.runner`, `compose.yml`, `.dockerignore`, and `.env.example`;
- the obsolete `.env` ignore entry;
- `runner/entrypoint.sh` and `runner/client.mjs`;
- `src/server.ts`;
- Relay HTTP server, configuration, job service, job store, and unused HTTP/job contracts;
- tests whose only subject is removed transport, polling, persistence, Docker packaging, or container startup.

Retain and adapt:

- `src/execution/codex-executor.ts`;
- `src/execution/prompt.ts`;
- `src/security/redaction.ts`;
- `src/security/workspace.ts`;
- `runner/resolve-pr.mjs`;
- `runner/finalize.sh`;
- `scripts/codex-run`;
- `scripts/toolchain-smoke.sh`;
- repository instructions, workflows, README, and operations documentation.

Update `package.json` to remove the server start command and container-entrypoint checks while retaining strict type checking, build, Node test coverage, shell validation, and `npm run check`.

Do not modify historical files under `docs/exec-plans/completed/`.

### 7. Adapt tests without expanding product scope

Keep current behavioral tests for resolver, finalizer, prompt, redaction, workspace boundaries, executor process behavior, and Git publication where still applicable.

Add or adapt deterministic tests for:

- direct CLI validation, path boundaries, symlinks, integer parsing, commit-message normalization, and plan movement;
- executor success, clean no-op, exit failure, spawn error, timeout, delayed force-kill, truncation, split UTF-8, split secrets, and live redaction;
- launcher preservation of real home, authentication, runner, source, and unrelated workspaces;
- installer preflight, toolchain decisions, current runner checksum, login branching, hidden token input, organization registration, `_work`, no custom labels, `svc.sh`, `needrestart`, failure preservation, and token-free rerun;
- proof that the registration token is absent from output, generated files, installed files, units, profiles, and retained child environments;
- workflow `[self-hosted]`, trusted installed paths, workspace propagation, token scoping, artifact upload, and finalization;
- native packaging and absence of active Docker/Relay artifacts;
- shell syntax for retained scripts.

Tests must require no real credentials, downloads, systemd, Docker, or GitHub services.

### 8. Rewrite current documentation

README and operations documentation must describe:

- the organization-level `Divorium` runner;
- `./install.sh` as the only setup and update entrypoint;
- installer-driven Codex login;
- the hidden initial organization registration-token prompt;
- runner name `gh-runner` and `runs-on: [self-hosted]`;
- existing organization runner-group access;
- direct Codex output and uploaded artifact;
- updates through the same installer;
- official re-registration and uninstall of only the new installation.

Current documentation must not require a Relay secret, `.env`, copied auth file, UID/GID mapping, Docker command, custom labels, or manual service configuration.

## Implementation sequence

1. Implement the direct CLI and minimally adapt prompt, executor, errors, workspace checks, and redaction.
2. Adapt `codex-run` and native toolchain paths without modifying the real home.
3. Update production, example, and CI workflows for installed direct execution and `[self-hosted]` routing.
4. Implement the single installer with organization runner registration.
5. Add or adapt direct-execution, launcher, installer, workflow, and packaging tests.
6. Remove obsolete Relay and Docker code only after replacement tests pass.
7. Rewrite current README, operations documentation, package scripts, and ignore rules.
8. Run the complete repository suite.
9. Review every retained behavior against `docs/native-github-runner-specification.md` and repair all gaps.
10. Move this plan to `completed` only after every Progress and acceptance item is supported by repository-owned evidence.

## Progress

- [x] (2026-07-16) Reviewed Docker packaging, workflows, runner scripts, Relay HTTP/state code, Codex executor and launcher, security boundaries, package scripts, tests, and operations documentation.
- [x] (2026-07-16) Produced a technical specification for a fresh native organization runner installation.
- [x] (2026-07-17) Cross-checked the specification against current code and removed repository-scoped registration, custom-label routing, host-lifecycle dependencies, host-mounted workspaces, unsafe home cleanup, stale runner bootstrap, and unnecessary executor rewrites.
- [ ] Implement and test the direct Codex CLI.
- [ ] Adapt and test the native Codex launcher and permission profile.
- [ ] Implement and test the single idempotent installer.
- [ ] Update and test production, example, and CI workflows with `[self-hosted]` routing.
- [ ] Remove superseded Relay and Docker code after replacements pass.
- [ ] Rewrite current documentation, package scripts, and packaging checks.
- [ ] Run the complete suite and final code/specification/plan consistency review.
- [ ] Archive this ExecPlan with validation evidence.

## Surprises & Discoveries

- Relay transport, authentication, polling, and persistence exist because of the current two-container split and are unnecessary in direct execution.
- The current launcher deletes most of `/home/agent`; substituting the real user's home would destroy runner state and unrelated files.
- Useful executor behavior is independent from Relay and should be retained while DTO and persistence dependencies are removed.
- `/runner` paths and the `relay` permissions profile are container-specific details.
- The official runner `_work` directory and `${{ runner.workspace }}` provide the required workspace boundary without a host-specific path.
- Organization-level registration is required for one runner to serve multiple `Divorium` repositories.
- Custom labels are unnecessary because the user disables the old runner and maintained workflows use only `[self-hosted]`.
- OpenSSH and .NET exclusions are image policy, not native Debian requirements.
- Runner `2.325.0` is stale for a fresh bootstrap; use `2.335.1` and retain automatic updates.

## Decision Log

- Decision: remove Agent Relay as a process and transport while preserving workflow behavior.
  Rationale: direct execution makes HTTP transport, bearer authentication, polling, and persisted job state unnecessary.
  Date/Author: 2026-07-16 / user direction and repository review.

- Decision: install one organization-level runner for `Divorium`.
  Rationale: the same runner must serve multiple repositories.
  Date/Author: 2026-07-17 / user direction.

- Decision: use only `runs-on: [self-hosted]` and no custom labels.
  Rationale: the user disables the old runner outside the implementation.
  Date/Author: 2026-07-17 / user direction.

- Decision: use one installer and the existing Debian user.
  Rationale: this is a fresh native installation, not a container identity migration.
  Date/Author: 2026-07-16 / user direction.

- Decision: install the trusted harness root-owned outside Actions workspaces.
  Rationale: pull-request content must not replace the resolver, launcher, executor policy, or finalizer used to execute it.
  Date/Author: 2026-07-16 / security review.

- Decision: keep real `HOME` for the Codex host process but deny it to model-controlled tools.
  Rationale: Codex reuses the current login without copying credentials.
  Date/Author: 2026-07-16 / credential review.

- Decision: never operate on the previous Docker environment.
  Rationale: the new runtime is installed independently in a different environment.
  Date/Author: 2026-07-16 / user direction.

## Validation and Acceptance

Implementation is complete only when repository-owned evidence proves:

1. `npm ci` and `npm run check` pass.
2. The direct CLI and retained executor pass success, no-op, failure, timeout, force-kill, truncation, split-output redaction, and plan-movement tests.
3. The launcher changes only its private temporary fixture and preserves home, authentication, runner, source, and unrelated workspace fixtures.
4. The installer passes first-run and rerun fixture tests, including login branching, hidden token input, current archive/checksum, organization registration, `_work`, no custom labels, official service commands, `needrestart`, and token non-persistence.
5. Production, example, and CI workflows use exactly `[self-hosted]` and trusted installed helpers.
6. The Codex step receives `${{ runner.workspace }}`, uploads output on failure, and receives no GitHub token.
7. Resolver and finalizer behavioral tests remain passing.
8. Current documentation contains no Relay secret, `.env`, Docker command, copied auth file, UID/GID setup, custom-label requirement, or manual service configuration.
9. No active Docker deployment, Relay HTTP/client path, persisted Relay job model, or old-environment operation remains.
10. Final file-by-file comparison against the technical specification finds no uncovered behavior or conflicting instruction.

Do not claim live credentials, runner-group access, package downloads, systemd, GitHub registration, or host lifecycle were exercised unless genuine evidence is available.

## Idempotence and Recovery

Rerunning `install.sh` updates required packages and the root-owned harness while preserving runner registration, Codex authentication, `_work`, diagnostics, and a newer runner version.

Failed source validation or staged installation leaves the installed harness unchanged. Failed initial registration persists no token and can be retried through the same installer.

Recovery and uninstall apply only to the new installation and never read from or modify the previous Docker environment.

## Interfaces

Retained:

- workflow triggers and manual inputs;
- active ExecPlan semantics;
- exact PR/head resolution;
- checkout credential cleanup;
- GitHub Actions log and artifact output;
- runner-owned commit and push;
- repository, package, and workflow names.

Removed:

- Agent Relay HTTP API and health endpoint;
- Relay secret, URL, client, polling, IDs, and status DTOs;
- Relay state and persisted logs;
- Docker Compose and environment-file deployment;
- repository-scoped runner registration;
- custom runner labels.

Added:

- `./install.sh`;
- one `Divorium` organization runner named `gh-runner`;
- an installed direct Codex CLI;
- `[self-hosted]` workflow routing.

## Outcomes & Retrospective

Pending implementation and repository validation.
