# Install a native organization GitHub runner that executes Codex directly

This ExecPlan is maintained according to `.agent/PLANS.md` and must be implemented together with `docs/native-github-runner-specification.md`.

## Purpose / Big Picture

Replace the current Docker Compose deployment with one fresh native Debian installation created and maintained by one repository script.

The target runtime has one long-lived service: the official GitHub Actions runner. Workflow jobs invoke a root-owned installed Codex harness directly in the checked-out repository. The Agent Relay HTTP server, bearer token, polling client, queue, persisted Relay state, and second application service are removed because the runner and Codex execute in the same operating-system environment.

This is not a migration or cutover procedure. The implementation must not stop, inspect, unregister, copy from, clean, or modify the previous Docker environment. Existing Docker runner registration, volumes, Relay state, logs, and Codex authentication are not inputs.

The setup and update entrypoint is:

```bash
./install.sh
```

The installer performs all package installation, repository validation, trusted-harness installation, Codex authentication checks, GitHub runner installation, organization registration, and service configuration. Its only interactive behavior is:

- invoking `codex login` when the current user is not authenticated;
- reading a time-limited GitHub organization runner registration token without echo when the runner is not registered.

These are interactions of the finished installer, not manual implementation or acceptance work.

## Required behavior to preserve

Preserve the current externally useful behavior while removing only Docker and Relay transport:

- same-repository pull-request gate before untrusted repository code runs;
- validation of an open, ready, non-fork pull request and exact head SHA/ref resolution;
- checkout of the resolved SHA with `persist-credentials: false`;
- explicit verification that checkout credentials are absent before Codex starts;
- exactly one selected regular, non-symlink active ExecPlan;
- minimal Codex prompt pointing only to `.agent/PLANS.md` and the selected plan;
- Codex cannot commit or push;
- workspace containment and symlink protections;
- restricted Codex filesystem permissions and required network access;
- timeout, SIGTERM, delayed SIGKILL, output cap, streaming redaction, and non-zero failure behavior;
- a clean worktree succeeds without creating a commit;
- a changed worktree is validated, committed, and pushed by the trusted finalizer using the normalized plan heading;
- redacted Codex output remains visible in GitHub Actions and is uploaded even when execution fails.

## Scope

### 1. Replace Relay transport with direct execution

Add `src/run-codex.ts` as a strict TypeScript CLI entrypoint installed outside the pull-request workspace.

The CLI must:

- validate `GITHUB_WORKSPACE`, `GITHUB_OUTPUT`, `CODEX_PLAN_PATH`, and `CODEX_WORKSPACE_ROOT`;
- parse optional positive `CODEX_TIMEOUT_MS` and `MAX_OUTPUT_BYTES` values;
- preserve realpath containment and active-plan symlink protections;
- derive the commit message before Codex runs;
- build the existing minimal prompt;
- invoke `/usr/local/bin/codex-run` through the retained executor behavior;
- stream redacted stdout and stderr directly to the workflow step;
- enforce the current timeout and output limit;
- write `commit_message` to `GITHUB_OUTPUT` only after successful Codex execution;
- exit non-zero on validation, spawn, timeout, or Codex failure.

Remove HTTP requests, request IDs, job IDs, polling, HTTP response validation, persisted job DTOs, persisted Relay logs/state, and restart recovery.

Adapt rather than rewrite the useful executor logic. Keep prompt construction, workspace checks, streaming redaction, timeout, force-kill, output-cap, and truncation behavior. Remove only the `CreateJobRequest`, persisted output file, and Relay-specific error metadata.

### 2. Make the Codex launcher safe for the existing Debian user

Rewrite `scripts/codex-run` so it never cleans, copies, moves, rewrites, or symlinks files in the real user home.

The launcher must:

- refuse root execution;
- use `umask 0077`;
- verify `$HOME/.codex/auth.json` exists;
- create one private per-execution directory through `mktemp`;
- initialize only temporary structures required by Codex;
- clean only that private directory on exit;
- invoke Codex through `env -i` with explicit locale, current user identity, real `HOME`, native Java/Go/Rust paths, per-execution cargo/temp paths, and `GIT_OPTIONAL_LOCKS=0`.

Keep `HOME` pointed at the real home so the Codex host process can use the existing login. The model-controlled permission profile must deny the complete real home.

Use a neutral Codex permissions profile such as `agent`. Remove container-only `/app`, `/runner`, `/home/agent`, and fixed `/tmp/agent-relay-runtime` assumptions. The profile must:

- disable memories;
- deny the complete real user home;
- deny `/opt/agent-relay` and `/opt/rust`;
- deny the complete runner workspace root before re-allowing the selected repository;
- deny `/tmp` and `/var/tmp` before re-allowing only the private runtime directory;
- allow writes to the selected repository and private runtime directory;
- allow reads from the selected repository `.git` directory;
- retain network access;
- never use `danger-full-access`.

The sandbox constrains model-controlled Codex tools. It does not isolate arbitrary workflow steps from the runner user's home. Only trusted repositories and workflows may use this organization runner.

### 3. Add one idempotent installer

Add root-level `install.sh` as the only installation and update path.

The installer must:

- run as the existing non-root Debian user and use `sudo` only for system changes;
- resolve the source root from its own location and not require a Git remote;
- verify Debian, systemd, `sudo`, a writable user home, and outbound HTTPS prerequisites;
- use the fixed organization registration URL `https://github.com/Divorium`;
- install the complete toolchain currently supplied by the Docker images;
- avoid a general distribution upgrade;
- run `npm ci` and `npm run check` before replacing installed application files;
- atomically install the trusted payload under `/opt/agent-relay`;
- install `/usr/local/bin/codex-run` and system-wide Rust under `/opt/rust`;
- run the native toolchain smoke check;
- run `codex login status` and invoke `codex login` only when unauthenticated;
- install and checksum-verify the official GitHub runner archive when absent;
- prompt without echo for an organization runner registration token only when `.runner` is absent;
- register runner name `gh-runner` with work directory `_work` and no custom labels;
- install, enable, start, and verify the official service through `svc.sh`;
- install GitHub's Debian `needrestart` service override;
- preserve existing runner registration, Codex authentication, `_work`, diagnostics, and a newer self-updated runner on rerun;
- never persist the registration token;
- never invoke Docker, Docker Compose, WSL commands, PowerShell, or operations against the previous environment.

The normal path asks for no repository URL, organization name, runner name, label, workspace path, Relay credential, Codex auth path, UID, GID, environment file, or service setting.

Use GitHub Actions Runner `2.335.1` as the fresh bootstrap archive and verify SHA-256:

```text
4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf
```

Retain the official runner updater. Do not downgrade a newer runner or require exact version equality after registration.

The runner is added to the organization's default runner group. Repository access follows the existing `Divorium` runner-group policy. The installer must not introduce a PAT or GitHub App solely to manage runner groups.

### 4. Register one organization runner usable by multiple repositories

Register the runner against:

```text
https://github.com/Divorium
```

Do not pass `--labels`. GitHub supplies the default `self-hosted`, operating-system, and architecture labels.

Set every maintained workflow job to:

```yaml
runs-on: [self-hosted]
```

The old runner is disabled by the user outside this repository. The implementation must not detect, stop, unregister, or clean it.

### 5. Preserve workflow orchestration without Relay

Update:

- `.github/workflows/agent-relay.yml`;
- `examples/github-actions/agent-relay.yml`;
- `.github/workflows/ci.yml`.

Use trusted installed helpers under `/opt/agent-relay`. Do not execute resolver, Codex entrypoint, launcher, or finalizer code from the pull-request checkout.

Retain:

- existing triggers and manual inputs;
- same-repository fork gate;
- installed PR resolver;
- exact checkout;
- credential-free checkout verification;
- active-plan selection;
- `pipefail`;
- direct Codex output captured with `tee` into `${RUNNER_TEMP}/agent-relay-console.log`;
- artifact upload with `if: always()`;
- delayed failure after artifact upload;
- installed finalizer with the derived message, API-derived branch, and step-scoped `${{ github.token }}`.

Set `CODEX_WORKSPACE_ROOT` from `${{ runner.workspace }}`.

Remove:

- `AGENT_RELAY_TOKEN` and its repository-secret requirement;
- `AGENT_RELAY_URL`;
- request IDs and polling variables;
- container service names;
- `/runner` container paths.

The Codex step receives no GitHub token. The built-in token remains explicit only in PR resolution, checkout, and finalization.

### 6. Remove superseded repository code only after replacements pass

Remove:

- `Dockerfile`;
- `Dockerfile.runner`;
- `compose.yml`;
- `.dockerignore`;
- `.env.example` and the obsolete `.env` ignore entry;
- `runner/entrypoint.sh`;
- `runner/client.mjs`;
- `src/server.ts`;
- Relay HTTP server, configuration, job service, job store, and unused HTTP/job contracts;
- tests whose only subject is removed HTTP transport, polling, persistence, Docker packaging, or container startup.

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

Update `package.json` to remove the server start command, container runner-entrypoint test, and obsolete shell checks while preserving strict type checking, build, Node test coverage, shell validation, and the single `npm run check` entrypoint.

Do not modify historical files under `docs/exec-plans/completed/`.

### 7. Replace tests only where the architecture changed

Keep existing behavioral tests for resolver, finalizer, prompt, redaction, workspace boundaries, executor process behavior, and Git publication where still applicable.

Add or adapt deterministic tests for:

- direct CLI environment validation, positive integers, workspace containment, plan boundaries, symlinks, commit-message normalization, and active-plan movement;
- actual executor success, clean no-op, non-zero exit, spawn failure, timeout, delayed force-kill, output truncation, split UTF-8, split secrets, and live redaction;
- launcher proof that real-home, auth, runner, source, and unrelated workspace fixtures remain unchanged;
- installer preflight, toolchain decisions, current runner archive/checksum, Codex-login branching, hidden token input, organization registration, `_work`, no custom labels, `svc.sh`, `needrestart`, failure preservation, and token-free rerun;
- proof that the registration token is absent from output, generated files, installed files, units, profiles, and retained child environments;
- workflow `[self-hosted]` routing, trusted installed paths, runner workspace propagation, GitHub-token scoping, artifact upload, and finalization;
- native packaging and absence of active Docker/Relay runtime artifacts;
- shell syntax for every retained script.

Tests must not require real credentials, downloads, systemd, Docker, WSL, or GitHub services. Use controlled command, process, filesystem, HTTP, and Git fixtures.

### 8. Rewrite current documentation

README and operations documentation must describe:

- the organization-level `Divorium` runner;
- `./install.sh` as the only setup and update entrypoint;
- script-driven Codex login;
- the hidden initial organization registration-token prompt;
- runner name `gh-runner` and `runs-on: [self-hosted]`;
- existing organization runner-group access;
- direct Codex output and uploaded artifact;
- updates through the same installer;
- official re-registration and uninstall of only the new installation.

Current documentation must not require a Relay secret, `.env`, copied auth file, UID/GID mapping, Docker command, custom labels, or manual service configuration. Host lifecycle commands may be documented for the user, but runtime code and the installer must not depend on them.

## Implementation sequence

1. Implement the direct CLI and minimally adapt prompt, executor, errors, workspace checks, and redaction integration.
2. Adapt `codex-run` and native toolchain paths without modifying the real home.
3. Update production, example, and CI workflows for installed direct execution and `[self-hosted]` routing.
4. Implement the single installer with organization runner registration.
5. Add or adapt direct-execution, launcher, installer, workflow, and native-packaging tests.
6. Remove obsolete Relay and Docker code only after replacement tests pass.
7. Rewrite current README, operations documentation, package scripts, and ignore rules.
8. Run the complete repository suite.
9. Review every retained current behavior against `docs/native-github-runner-specification.md` and repair all gaps.
10. Move this plan to `completed` only after every acceptance item and Progress item is complete with repository-owned evidence.

## Progress

- [x] (2026-07-16) Reviewed current Docker packaging, workflow files, runner scripts, Relay HTTP/state code, Codex executor and launcher, security boundaries, package scripts, tests, and operations documentation.
- [x] (2026-07-16) Produced a technical specification for a fresh native organization runner installation.
- [x] (2026-07-17) Cross-checked the specification against current code and removed repository-scoped registration, custom-label routing, WSL dependencies, host-mounted workspaces, unsafe home cleanup, stale runner bootstrap, and unnecessary executor rewrites.
- [ ] Implement and test the direct Codex CLI.
- [ ] Adapt and test the native Codex launcher and permission profile.
- [ ] Implement and test the single idempotent installer.
- [ ] Update and test production, example, and CI workflows with `[self-hosted]` routing.
- [ ] Remove superseded Relay and Docker code after replacements pass.
- [ ] Rewrite current documentation, package scripts, and native packaging checks.
- [ ] Run the complete suite and perform the final code/specification/plan consistency review.
- [ ] Archive this ExecPlan with validation evidence.

## Surprises & Discoveries

- Relay transport, authentication, polling, and persistence are consequences of the current two-container split. They provide no required behavior once the official runner launches the trusted Codex harness directly.
- `scripts/codex-run` currently deletes most of `/home/agent`; substituting a real user's home would destroy runner state and unrelated user files.
- The useful executor behavior is independent from Relay. It should be retained while its DTO and persisted-log dependencies are removed.
- `/runner` helper paths and the `relay` permissions profile are container-specific details.
- Runner workspaces do not need a host-mounted source folder. The official Linux `_work` directory and `${{ runner.workspace }}` provide the required boundary.
- Organization-level registration is required for one runner to serve multiple `Divorium` repositories.
- No custom labels are required. The user will disable the old runner, and all maintained workflows use only `[self-hosted]`.
- OpenSSH and .NET exclusion checks are image policy, not native Debian requirements.
- Runner `2.325.0` is stale as a fresh bootstrap. The current official release is `2.335.1`; preserve automatic updates.

## Decision Log

- Decision: remove Agent Relay as a process and transport while preserving existing workflow behavior.
  Rationale: the runner and Codex execute in the same operating-system environment, so HTTP transport, bearer authentication, polling, and persisted job state are unnecessary.
  Date/Author: 2026-07-16 / user direction and repository review.

- Decision: install one organization-level runner for `Divorium`.
  Rationale: the same runner must be usable by multiple repositories.
  Date/Author: 2026-07-17 / user direction.

- Decision: use only `runs-on: [self-hosted]` and no custom labels.
  Rationale: the user will disable the old runner outside the implementation, and additional routing labels add no value.
  Date/Author: 2026-07-17 / user direction.

- Decision: use one installer and the existing Debian user rather than recreating container accounts or UID/GID mapping.
  Rationale: this is a fresh native installation, not a container identity migration.
  Date/Author: 2026-07-16 / user direction.

- Decision: install the execution harness root-owned outside the Actions workspace.
  Rationale: pull-request content must not replace the resolver, Codex entrypoint, launcher, or finalizer used to execute it.
  Date/Author: 2026-07-16 / security review.

- Decision: keep real `HOME` for the Codex host process but deny the complete home to model-controlled tools.
  Rationale: Codex reuses the current login without copying credentials, while model tools cannot read the home directory.
  Date/Author: 2026-07-16 / credential review.

- Decision: use the official Linux `_work` directory and `${{ runner.workspace }}`.
  Rationale: this avoids host-specific paths and keeps runtime workspaces in the Linux filesystem.
  Date/Author: 2026-07-16 / path review.

- Decision: never operate on the previous Docker environment.
  Rationale: the new runtime is installed independently in a different environment.
  Date/Author: 2026-07-16 / user direction.

## Validation and Acceptance

Implementation is complete only when repository-owned evidence proves:

1. `npm ci` and `npm run check` pass on the final implementation head.
2. The real direct CLI and retained executor pass success, no-op, failure, timeout, force-kill, truncation, split-output redaction, and plan-movement tests.
3. The real launcher changes only its private temporary fixture and preserves real-home, authentication, runner, source, and unrelated workspace fixtures.
4. The real installer passes first-run and rerun fixture tests, including login branching, hidden token input, current archive/checksum, organization registration, `_work`, no custom labels, official service commands, `needrestart`, and token non-persistence.
5. Production, example, and CI workflows use exactly `[self-hosted]` and invoke only trusted installed runtime helpers.
6. The Codex step receives `${{ runner.workspace }}`, uploads output on failure, and receives no GitHub token.
7. Resolver and finalizer behavioral tests remain passing.
8. Current documentation contains no Relay secret, `.env`, Docker command, copied auth file, UID/GID setup, custom-label requirement, or manual service configuration.
9. No active Docker deployment, Relay HTTP/client path, persisted Relay job model, or old-environment operation remains.
10. A final file-by-file comparison against the technical specification finds no uncovered behavior or conflicting instruction.

Do not claim live credentials, runner-group policy, package downloads, systemd, GitHub registration, or host lifecycle were exercised unless genuine evidence is available. Deterministic repository tests must still validate every installer decision and installed command contract through fixtures.

## Idempotence and Recovery

Rerunning `install.sh` updates required packages and the root-owned harness while preserving runner registration, Codex authentication, `_work`, diagnostics, and a newer runner version.

A failed source validation or staged installation leaves the currently installed harness unchanged. A failed initial registration persists no token and can be retried by rerunning the installer.

Recovery and uninstall apply only to the new native installation. They never read from or modify the previous Docker environment.

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
