# Replace Docker Compose and Relay transport with a native GitHub runner and Codex runtime

This ExecPlan is a living implementation document maintained according to `.agent/PLANS.md`.

The implementation must also follow `docs/native-runner-technical-spec.md`. That specification defines the target architecture and file-level contracts; this plan defines the work and completion sequence.

## Purpose / Big Picture

Replace the current two-container deployment with one fresh native installation managed by a single repository installer.

The installed runtime has one long-lived service: the official repository-scoped GitHub Actions runner. When a selected workflow runs, the runner invokes the trusted installed Codex harness directly in the checked-out workspace. There is no Agent Relay HTTP server, bearer token, polling client, job queue, persisted Relay state, or second application service.

The implementation is a new installation path, not a migration procedure. It must not stop, inspect, copy from, clean, or modify the existing Docker environment. No old runner registration, Docker volume, Relay state, or Codex authentication is imported.

The user-facing setup is one command from the copied or cloned repository:

    ./install.sh

The installer performs all package installation, build, harness installation, Codex authentication checks, GitHub runner installation, registration, and service configuration. The only required user interactions are completing `codex login` when needed and pasting an initial GitHub runner registration token when no registration exists.

## Existing behavior that must remain

Preserve these observable contracts while removing the Relay transport:

- workflows run only on `[self-hosted, agent-relay]` and reject fork-origin pull requests;
- manual dispatch selects an open pull request and an active ExecPlan;
- ready-for-review execution resolves the exact open, non-draft, same-repository pull request through the GitHub API;
- checkout uses the resolved head SHA and `persist-credentials: false`;
- the workflow verifies that checkout credentials are absent before Codex starts;
- exactly one regular, non-symlink active ExecPlan is selected;
- Codex receives only the durable plan rules and selected active-plan pointer;
- Codex cannot commit or push; finalization remains runner-owned;
- Codex execution retains the current filesystem restrictions, network access, timeout, output cap, streaming redaction, and non-zero failure behavior;
- a clean worktree is a successful no-op;
- a changed worktree is validated, committed with the normalized plan heading, and pushed to the API-derived head branch;
- the Codex console log is visible in the workflow and uploaded even when execution fails.

## Scope

### 1. Replace Relay with direct execution

Add a strict TypeScript CLI entrypoint that runs from the trusted installation outside the pull-request workspace.

The CLI must:

- validate `GITHUB_WORKSPACE`, `GITHUB_OUTPUT`, `CODEX_PLAN_PATH`, and `CODEX_WORKSPACE_ROOT`;
- keep the existing workspace and active-plan symlink protections;
- derive the commit message before execution;
- build the existing minimal Codex prompt;
- invoke `/usr/local/bin/codex-run` through the existing executor behavior;
- stream redacted output to the workflow log;
- enforce the existing timeout and output limit;
- write the commit-message output only after successful execution;
- exit non-zero on validation, spawn, timeout, or Codex failure.

Remove the HTTP request/response path, job IDs, polling, persisted job states, request idempotency, and Relay process recovery. Those mechanisms existed only because runner and Codex were separated by containers.

### 2. Make Codex safe in the native user environment

Rewrite `scripts/codex-run` so it never cleans the real user's home directory.

It must create and remove only a private per-execution runtime directory, expose the current environment's Codex authentication to a temporary Codex home, start Codex through `env -i`, and provide explicit native toolchain paths.

Adapt the Codex permissions profile from container paths to:

- deny the real Codex credential directory;
- deny `/opt/agent-relay`;
- deny the GitHub runner installation;
- deny the shared work root except for the selected repository;
- deny general temporary roots except for the private runtime directory;
- allow writes only to the selected repository and runtime directory;
- allow reads from the selected repository's `.git` directory;
- retain required network access;
- never enable danger-full-access.

Use a neutral permissions-profile name rather than `relay`.

### 3. Add one idempotent installer

Add root-level `install.sh` as the only installation and update entrypoint.

The installer must:

- run as the existing non-root Debian user and use sudo for system changes;
- derive the source root from its own path;
- validate the native host prerequisites and `/srv/github-runner/_work`;
- install the complete toolchain currently supplied by the Docker images;
- run `npm ci` and `npm run check` before replacing installed files;
- install the trusted harness atomically under `/opt/agent-relay`;
- install the root-owned `/usr/local/bin/codex-run` launcher;
- run the native toolchain smoke check;
- run `codex login status` and invoke `codex login` when authentication is absent;
- derive the GitHub repository URL from the checkout's `origin` remote;
- install the official GitHub Actions runner when absent;
- prompt without echo for the registration token only when `.runner` is absent;
- register the runner with name `gh-runner`, label `agent-relay`, and work directory `/srv/github-runner/_work`;
- install, enable, and start the official runner service through `svc.sh`;
- preserve existing runner registration and Codex authentication on rerun;
- never persist the registration token;
- never invoke Docker, Docker Compose, WSL commands, PowerShell, or operations against the previous environment.

The installer must not ask for a repository URL, runner label, work path, Relay token, authentication-file path, UID, GID, or environment-file values.

### 4. Update workflow execution

Update the production and example workflows to invoke installed native files under `/opt/agent-relay`.

Retain the PR resolver, checkout verification, active-plan selection, artifact upload, failure propagation, and finalizer behavior. Replace `runner/client.mjs` with the direct TypeScript CLI.

Remove:

- `AGENT_RELAY_TOKEN` and its repository-secret requirement;
- `AGENT_RELAY_URL`;
- HTTP polling variables and request IDs;
- Compose service names and `/runner` container paths.

The Codex step must not receive `${{ github.token }}`. The token remains explicitly scoped to PR resolution, checkout, and finalization.

### 5. Remove obsolete runtime code and packaging

After direct execution and installer tests pass, remove repository artifacts used only by the former deployment:

- both Dockerfiles, Compose, `.dockerignore`, and `.env.example`;
- Docker runner entrypoint and Relay client;
- Relay HTTP server, configuration, job service, job persistence, and unused API/job contracts;
- container-specific packaging and behavior tests;
- obsolete `.env` ignore entry and Relay terminology in current documentation.

Do not keep Docker Compose or the HTTP Relay as a fallback or compatibility mode. The old external deployment remains untouched; only obsolete files in this repository are removed.

### 6. Rewrite tests around retained behavior

Replace tests of HTTP transport, polling, persistence, Docker packaging, and container startup with tests of:

- direct CLI input validation and active-plan/workspace boundaries;
- direct Codex execution with controlled children;
- live redacted stdout and stderr;
- timeout, force-kill, output limit, spawn failure, and non-zero exit;
- commit-message derivation when the active plan is moved during execution;
- temporary Codex home behavior without deleting the real home fixture;
- installer first run and idempotent rerun through command/filesystem fixtures;
- hidden registration-token input and proof that it is not persisted;
- origin URL normalization and official `config.sh`/`svc.sh` invocation;
- native packaging and absence of Docker/Relay artifacts;
- workflow credential scoping and direct installed execution;
- retained PR resolver and finalizer behavior.

Repository tests must not require real credentials, package downloads, systemd, Docker, WSL, or GitHub network access.

### 7. Rewrite current documentation

README and operations documentation must describe only the new runtime:

- copy or clone the repository into the prepared environment;
- run `./install.sh`;
- complete Codex login if requested;
- paste the initial registration token if requested;
- use the existing workflow without a Relay secret;
- inspect GitHub Actions logs and the uploaded Codex log artifact;
- update by pulling the trusted installation checkout and rerunning the same installer;
- deliberately re-register through the official runner flow;
- uninstall only the new native installation.

The operations guide may include the user's host-start command `wsl -d gh-runner`. Runtime code and the installer must not detect, configure, or manage WSL.

## Implementation sequence

1. Add the direct CLI and adapt prompt, executor, workspace validation, redaction integration, and Codex launcher.
2. Replace the Relay client step in both workflow files while retaining all current gates and finalization behavior.
3. Add the single installer and native toolchain smoke behavior.
4. Add direct-execution, launcher, installer, workflow, and native-packaging regression tests.
5. Remove the HTTP Relay, persistence, Docker packaging, obsolete contracts, and tests that have been replaced.
6. Rewrite README, operations documentation, package scripts, ignore rules, and durable repository instructions where old Relay assumptions remain.
7. Run the full repository suite, review the final repository against `docs/native-runner-technical-spec.md`, and repair every uncovered mismatch.
8. Move this plan to `completed` only after all repository-owned acceptance criteria pass and every item below is checked.

## Progress

- [x] (2026-07-16) Reviewed the current Docker packaging, workflows, runner helpers, Relay API and persistence, Codex executor and launcher, security boundaries, tests, and operations documentation.
- [x] (2026-07-16) Defined the direct-runner architecture and technical specification without WSL lifecycle or old-environment migration responsibilities.
- [ ] Implement and test the trusted direct Codex CLI.
- [ ] Adapt and test the Codex launcher and native permission paths.
- [ ] Implement and test the single idempotent installer.
- [ ] Update and test the production and example workflows.
- [ ] Remove superseded Relay, Docker, environment, and persistence code after replacements pass.
- [ ] Rewrite current documentation and package validation.
- [ ] Run the complete suite and perform a final plan/specification/code consistency review.
- [ ] Archive this ExecPlan with validation evidence.

## Surprises & Discoveries

- The HTTP Relay, bearer token, polling client, job store, and restart state are transport mechanisms for the current two-container split. They provide no required behavior when the official runner invokes Codex directly on the same host.
- `scripts/codex-run` currently deletes almost every top-level entry under `/home/agent`. Replacing that path with a real user's home would destroy runner state and user files; the native launcher must use a disposable temporary home instead.
- Current workflow helpers are installed at container-only `/runner` paths. Native workflow execution requires root-owned installed helper paths outside the pull-request checkout.
- The current toolchain smoke test rejects OpenSSH and .NET because of image policy. Those checks are not valid host requirements and must not be carried into the native installer.
- Runner version `2.325.0` can be a bootstrap pin, but exact-version validation on rerun would conflict with the official runner's built-in updater.

## Decision Log

- Decision: remove Agent Relay as a runtime process and invoke Codex directly from the GitHub Actions job.
  Rationale: runner and Codex are intentionally installed in the same environment; retaining HTTP transport, bearer authentication, polling, and persistence would add steps without preserving a needed boundary.
  Date/Author: 2026-07-16 / user direction and repository review.

- Decision: use one installer and the existing host user rather than recreating container accounts or UID/GID mapping.
  Rationale: this is a fresh standard Debian installation, not a container identity migration.
  Date/Author: 2026-07-16 / user direction.

- Decision: install the execution harness root-owned outside the Actions workspace.
  Rationale: pull-request content must not replace the resolver, Codex launcher, permission policy, or finalizer used to execute that same pull request.
  Date/Author: 2026-07-16 / security review.

- Decision: preserve workflow behavior but remove only the transport-specific API and state model.
  Rationale: exact PR resolution, credential cleanup, plan selection, Codex restrictions, logging, and finalization remain necessary.
  Date/Author: 2026-07-16 / compatibility review.

- Decision: do not perform any migration or cleanup of the existing Docker environment.
  Rationale: the new runtime is installed independently and the previous environment is outside this repository's implementation scope.
  Date/Author: 2026-07-16 / user direction.

## Validation and Acceptance

The implementation is complete only when repository-owned evidence proves all of the following:

1. `npm ci` and `npm run check` pass on the final branch head.
2. Tests execute the real direct CLI against controlled Codex child fixtures and cover success, no-op, failure, timeout, output truncation, redaction, and plan movement.
3. Tests prove that `codex-run` modifies only its private temporary directory and preserves a fixture representing the real home, Codex authentication, and runner installation.
4. Tests execute the real installer through command/filesystem fixtures and cover first installation, Codex-login branching, hidden token input, registration, service installation, and token-free rerun.
5. Tests prove the registration token is absent from generated files, installed files, logs, service definitions, repository files, and child environments after registration.
6. Both workflow files use the installed direct CLI, upload the redacted log on failure, retain exact checkout and credential verification, and scope `${{ github.token }}` away from Codex.
7. Resolver and finalizer behavioral tests remain passing.
8. Current README and operations documentation require no Relay secret, environment file, Docker command, copied authentication file, UID/GID value, or manual service configuration.
9. No Docker deployment file, Relay HTTP/client path, persisted Relay job model, or obsolete environment field remains.
10. A final file-by-file review confirms that every retained current behavior is represented either in implementation or an explicit test and that the code matches `docs/native-runner-technical-spec.md`.

Do not claim that a live host, real GitHub registration token, actual Codex account, systemd instance, or WSL lifecycle was exercised unless such evidence is genuinely available. The deterministic repository suite must still fully validate the script decisions and installed command contracts through fixtures.

## Idempotence and Recovery

`install.sh` is safe to rerun. It may update required packages and the root-owned harness, but it must preserve:

- `$HOME/.local/share/actions-runner/.runner` and runner-managed credentials;
- the official runner's newer self-updated version;
- `$HOME/.codex/auth.json`;
- the Actions work root and existing checkouts.

A failed source validation or staged installation leaves the currently installed harness unchanged. A failed initial runner registration leaves no persisted token and may be retried by rerunning the same installer. Recovery never reads from or modifies the previous Docker environment.

## Interfaces and dependencies

Retained external interfaces:

- workflow triggers and manual inputs;
- `[self-hosted, agent-relay]` runner label;
- active ExecPlan location and semantics;
- exact PR resolution and target-branch derivation;
- GitHub Actions log/artifact behavior;
- runner-owned commit and push behavior.

Removed interfaces:

- Agent Relay HTTP API and health endpoint;
- `AGENT_RELAY_TOKEN` secret;
- Relay URL, polling, request ID, job ID, and status DTOs;
- Relay state and persisted logs;
- Docker Compose and environment-file deployment.

New installation interface:

- `./install.sh`, with interactive Codex login when absent and a hidden initial runner-token prompt when unregistered.

## Outcomes & Retrospective

Pending implementation and repository validation.