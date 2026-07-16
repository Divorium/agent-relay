# Install a native GitHub runner that executes Codex directly

This ExecPlan is maintained according to `.agent/PLANS.md` and must be implemented together with `docs/native-github-runner-specification.md`.

## Purpose / Big Picture

Replace the current Docker Compose deployment with a fresh native installation created by one repository script.

The target runtime has one long-lived service: the official GitHub Actions runner. Workflow jobs invoke a root-owned installed Codex harness directly. The Agent Relay HTTP server, bearer token, polling client, queue, persisted job state, and second service are removed because runner and Codex now execute in the same environment.

This is not a migration or cutover procedure. Do not stop, inspect, copy from, clean, unregister, or modify the old Docker environment. The new and old environments are independent.

The setup entrypoint is:

    ./install.sh

The installer performs all installation and configuration. The only user interactions are completing `codex login` when needed and pasting an initial GitHub runner registration token when the new runner is unregistered.

## Required behavior to preserve

- same-repository pull-request gate;
- open, ready PR validation and exact head SHA/ref resolution;
- checkout with `persist-credentials: false`;
- explicit checkout credential cleanup verification;
- exactly one selected active ExecPlan;
- minimal prompt pointing only to `.agent/PLANS.md` and that plan;
- Codex cannot commit or push;
- current filesystem restrictions, network access, timeout, output cap, streaming redaction, and failure behavior;
- clean worktree succeeds without a commit;
- changed worktree is committed and pushed by the finalizer using the normalized plan heading;
- console output is visible and uploaded even when Codex fails.

## Scope

### 1. Direct Codex execution

Add `src/run-codex.ts` as the strict CLI entrypoint installed outside the pull-request workspace.

It must validate `GITHUB_WORKSPACE`, `GITHUB_OUTPUT`, `CODEX_PLAN_PATH`, and `CODEX_WORKSPACE_ROOT`; preserve workspace and plan symlink protections; capture the commit message before execution; build the existing prompt; run `/usr/local/bin/codex-run`; stream redacted output; enforce timeout and output limits; write `commit_message` only on success; and return non-zero on failure.

Remove HTTP requests, request IDs, job IDs, polling, job DTOs, persisted Relay logs/state, and restart recovery.

### 2. Native Codex launcher and sandbox

Rewrite `scripts/codex-run` so it never cleans, copies, moves, or rewrites files in the real user home.

The wrapper must keep HOME pointed at the real home for Codex authentication, create and clean only a private runtime directory, use `env -i`, and set explicit native toolchain paths. Rust is installed system-wide under `/opt/rust`; writable cargo state is per execution.

Adapt the Codex permission profile to deny the complete real home, trusted installation, system-wide Rust, work root, and general temp roots before re-allowing only the selected repository, its `.git` read access, and the private runtime directory. Keep network access and never use danger-full-access.

### 3. One installer

Add root-level `install.sh` as the only installation and update path.

It must:

- run as the existing non-root Debian user and use sudo only for system changes;
- derive its source root and GitHub repository URL from the Git `origin` remote;
- verify Debian, systemd, sudo, the user home, and `/srv/github-runner`;
- create `/srv/github-runner/_work`;
- install the full toolchain currently provided by the images;
- run `npm ci` and `npm run check` before replacing installed files;
- atomically install the trusted harness under `/opt/agent-relay`;
- install `/usr/local/bin/codex-run` and system-wide Rust under `/opt/rust`;
- run the native toolchain smoke check;
- invoke `codex login` only when status is unauthenticated;
- install and checksum-verify the official runner bootstrap archive when absent;
- prompt without echo for the registration token only when `.runner` is absent;
- register runner name `gh-runner`, labels `agent-relay,gh-runner`, and work directory `/srv/github-runner/_work`;
- install, enable, and start the official service through `svc.sh`;
- preserve registration, authentication, workspaces, and a newer self-updated runner on rerun;
- verify that existing registration matches the repository derived from `origin`;
- never persist the registration token;
- never invoke Docker, Compose, WSL, PowerShell, or old-environment operations.

The normal path asks for no URL, runner name, label, path, Relay credential, auth-file path, UID, GID, environment file, or service value.

### 4. Isolate new jobs from the old runner

The old runner must remain untouched and must not receive jobs intended for the new runtime.

Register the new runner with labels `agent-relay,gh-runner`. Update production, example, and CI workflows to require:

    [self-hosted, agent-relay, gh-runner]

The old `agent-relay`-only runner then cannot match new jobs.

### 5. Preserve workflow orchestration without Relay

Update the production and example workflows to invoke installed files under `/opt/agent-relay`.

Retain resolver, exact checkout, credential verification, active-plan selection, `pipefail`, artifact upload, delayed failure, and finalizer behavior. Replace `runner/client.mjs` with the installed direct CLI.

Remove `AGENT_RELAY_TOKEN`, Relay URL, request IDs, polling variables, Compose service names, and container `/runner` paths. The Codex step receives no `${{ github.token }}`. The built-in token remains explicit only in resolution, checkout, and finalization.

### 6. Remove superseded repository code

After replacement tests pass, remove:

- Dockerfiles, Compose, `.dockerignore`, `.env.example`, and obsolete `.env` ignore;
- Docker runner entrypoint and Relay client;
- Relay server, API, config, job service, job store, and unused HTTP/job contracts;
- tests that only cover removed transport, persistence, Docker packaging, or container startup.

Keep repository/package/workflow names, the `agent-relay` compatibility label, and historical completed plans. Do not perform a broad rename or unrelated refactor.

### 7. Rewrite tests

Replace removed-layer tests with deterministic coverage of:

- direct CLI inputs, workspace/plan boundaries, commit-message normalization, and plan movement;
- actual executor success, failure, spawn error, timeout, force-kill, truncation, split UTF-8, split secrets, and live redaction;
- wrapper proof that real-home, auth, runner, and source fixtures remain unchanged;
- installer preflight, toolchain decisions, remote normalization, Codex-login branching, hidden token input, initial registration, dual labels, `svc.sh`, failure preservation, repository mismatch, and token-free rerun;
- proof that the token is absent from output, generated files, installed files, units, profiles, and child environments;
- workflow dual labels, trusted installed paths, GitHub-token scoping, artifact upload, and finalization;
- native packaging and absence of active Docker/Relay artifacts;
- retained resolver and finalizer behavior;
- shell syntax for every retained script.

Tests must not require real credentials, downloads, systemd, Docker, WSL, or GitHub services.

### 8. Rewrite current documentation

README and operations documentation must describe the fresh `./install.sh` flow, script-driven Codex login, hidden initial token prompt, fixed runner name and dual labels, direct workflow output, updates through the same installer, official re-registration, and uninstall of only the new installation.

Documentation may tell the user to start the prepared host with `wsl -d gh-runner`. Runtime code and installer must not call or detect WSL.

## Implementation sequence

1. Implement the direct CLI and adapt prompt, executor, error handling, workspace checks, and redaction integration.
2. Adapt `codex-run` and toolchain paths without touching the real home.
3. Update production and example workflows for direct installed execution.
4. Implement the single installer and dual-label runner registration.
5. Update CI to require the new runner labels.
6. Add replacement tests and make `npm run check` pass.
7. Remove obsolete Relay, Docker, environment, contracts, and tests.
8. Rewrite current documentation and package scripts.
9. Review every retained current behavior against `docs/native-github-runner-specification.md`; repair all gaps.
10. Move this plan to completed only after all repository-owned checks pass and every progress item is complete.

## Progress

- [x] (2026-07-16) Reviewed current packaging, workflows, runner helpers, Relay API/state, executor, launcher, permissions, tests, and operations documentation.
- [x] (2026-07-16) Produced and cross-checked the native runner technical specification.
- [x] (2026-07-16) Corrected old-runner job collision through dual labels and removed the unsafe temporary-auth-home design.
- [ ] Implement and test the direct Codex CLI.
- [ ] Adapt and test the native Codex launcher and permission profile.
- [ ] Implement and test the single idempotent installer.
- [ ] Update and test production, example, and CI workflows with dual labels.
- [ ] Remove superseded Relay and Docker code after replacements pass.
- [ ] Rewrite current documentation and package validation.
- [ ] Complete the final code/specification/plan consistency review.
- [ ] Archive this plan with validation evidence.

## Surprises & Discoveries

- Relay transport and persistence are only required by the current container split; direct execution preserves required behavior without them.
- The current launcher deletes most of `/home/agent`; substituting a real user's home would destroy runner and user state.
- Putting copied or linked auth inside a writable temporary HOME could expose it to model-controlled tools. The correct native design keeps real HOME for the Codex host process and denies the complete home in the model permission profile.
- Reusing only the `agent-relay` label would allow the untouched old runner to receive new jobs. Requiring both `agent-relay` and `gh-runner` isolates the fresh installation without modifying the old environment.
- `/runner` helper paths and the `relay` Codex permission profile are container-specific implementation details.
- OpenSSH/.NET exclusion checks are image policy, not native host requirements.
- Runner 2.325.0 is a bootstrap pin; exact validation after self-update would be incorrect.

## Decision Log

- Decision: remove Relay as a process and transport, while preserving the repository identity and orchestration behavior.
  Rationale: the new runner can execute the trusted Codex harness directly.
  Date/Author: 2026-07-16 / user direction and code review.

- Decision: use one installer and the existing host user.
  Rationale: this is a fresh native installation, not a container-account migration.
  Date/Author: 2026-07-16 / user direction.

- Decision: require dual labels `agent-relay,gh-runner`.
  Rationale: the old environment remains untouched and must not match new jobs.
  Date/Author: 2026-07-16 / deployment consistency review.

- Decision: install the harness root-owned outside the Actions workspace.
  Rationale: pull-request content must not replace the resolver, executor policy, launcher, or finalizer used to execute it.
  Date/Author: 2026-07-16 / security review.

- Decision: keep real HOME for the Codex host process but deny the complete home to model-controlled tools.
  Rationale: Codex can use its current login without copying credentials, while the model cannot read auth or runner credentials.
  Date/Author: 2026-07-16 / credential-boundary review.

- Decision: never operate on the previous Docker environment.
  Rationale: new installation and old deployment are independent.
  Date/Author: 2026-07-16 / user direction.

## Validation and Acceptance

Completion requires repository-owned evidence that:

1. `npm ci` and `npm run check` pass.
2. The real direct CLI and executor pass success, no-op, failure, timeout, force-kill, truncation, redaction, and plan-movement tests.
3. The real launcher changes only its private temp fixture and preserves real-home, auth, runner, and source fixtures.
4. The real installer passes first-run and rerun fixture tests, including login branching, hidden token input, dual labels, official service commands, repository mismatch, and token non-persistence.
5. Production, example, and CI workflows require both labels and the old runner cannot match them.
6. The Codex step uses the installed trusted CLI, uploads output on failure, and receives no GitHub token.
7. Resolver and finalizer behavioral tests remain passing.
8. Current documentation contains no Relay secret, `.env`, Docker command, copied auth file, UID/GID setup, or manual service configuration.
9. No active Docker deployment, Relay HTTP/client path, persisted Relay model, or obsolete environment field remains.
10. A final file-by-file comparison against the specification finds no uncovered behavior or conflicting instruction.

Do not claim live credentials, downloads, systemd, GitHub registration, or WSL lifecycle were tested unless genuine evidence is available. Deterministic fixtures must still validate every script branch and command contract.

## Idempotence and Recovery

Rerunning `install.sh` updates required packages and the root-owned harness while preserving runner registration, Codex authentication, workspaces, and a newer runner version. Failed source validation or staging leaves the installed harness unchanged. Failed registration persists no token and is retried through the same installer.

Recovery and uninstall apply only to the new installation. They never read from or modify the old Docker environment.

## Interfaces

Retained:

- workflow triggers and inputs;
- active ExecPlan semantics;
- exact PR/head resolution;
- checkout credential cleanup;
- GitHub Actions log/artifact output;
- runner-owned commit and push;
- repository/package/workflow names and `agent-relay` compatibility label.

Removed:

- Agent Relay HTTP API and health endpoint;
- Relay secret, URL, client, polling, IDs, and status DTOs;
- Relay state and persisted logs;
- Docker Compose and environment-file deployment.

Added:

- `./install.sh`;
- `gh-runner` compatibility/isolation label;
- installed direct Codex CLI.

## Outcomes & Retrospective

Pending implementation and repository validation.