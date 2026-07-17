# Install a native organization GitHub runner that executes Codex directly

This ExecPlan follows `.agent/PLANS.md` and is implemented together with `docs/native-github-runner-specification.md`.

## Purpose / Big Picture

Replace the former container and Agent Relay runtime with one fresh native Debian installation managed by one script.

The official GitHub Actions runner is the only long-lived service. It invokes a trusted, root-owned Codex harness directly in the selected pull-request workspace. The implementation does not inspect, stop, unregister, copy from, clean, or modify the previous environment.

The WSL source checkout is:

```text
/srv/github-runner/storage/agent-relay
```

The only setup and update entrypoint is:

```bash
cd /srv/github-runner/storage/agent-relay
./install.sh
```

## Implemented result

The repository now provides:

- one executable, argument-free installer;
- automatic WSL systemd configuration when required;
- system Node.js 22, TypeScript 5.8.3, Codex CLI 0.144.4, Java 21, Go 1.24.5, Rust stable, Python, Git, build tools, and runner dependencies;
- checksum verification for downloaded Go and GitHub Runner archives;
- validation before transactional replacement of `/opt/agent-relay`;
- rollback when the trusted harness swap or launcher installation fails;
- conditional `codex login`;
- one hidden GitHub PAT prompt only when runner registration is absent;
- automatic exchange of that PAT for GitHub's short-lived organization registration token;
- one `Divorium` organization runner named `gh-runner`, work directory `_work`, and no custom labels;
- direct Codex execution without Relay HTTP, polling, queue, or persisted job state;
- trusted pull-request resolution, checkout, output capture, and commit/push finalization.

## Runtime boundaries

The Codex execution path:

- validates the real runner workspace and one direct active ExecPlan;
- builds only the plan-based prompt;
- runs through `/usr/local/bin/codex-run`;
- disables memories;
- denies the real home, `/opt/agent-relay`, runner workspace root, `/tmp`, and `/var/tmp` to model-controlled tools;
- exposes `/opt/rust` read-only so Cargo and Rust remain usable but immutable;
- allows writes only to the selected repository and one private per-run directory;
- keeps the selected repository's `.git` directory read-only;
- redirects Cargo, npm, pip, Go, Gradle, XDG, and temporary state into the private directory;
- prevents model-controlled Git from reading `$HOME/.gitconfig`;
- enables required network access;
- streams redacted output;
- enforces a combined output limit, process-group timeout, `SIGTERM`, and delayed `SIGKILL`.

The workflow gives no GitHub token to Codex. GitHub credentials remain limited to pull-request resolution, checkout, and finalization.

## Installer and service security

The installer:

- resolves its source from `BASH_SOURCE` and does not depend on `$HOME` placement;
- performs source and toolchain checks before root-owned installation;
- installs Codex and TypeScript at deterministic `/usr/local/bin` paths;
- preserves Codex authentication, runner registration, `_work`, diagnostics, and newer runner updates on rerun;
- never passes the PAT in process arguments and unsets it immediately after the registration-token API call;
- passes the short-lived registration token only to official `config.sh --token` and unsets it after configuration;
- executes `installdependencies.sh` as root only immediately after checksum-verified extraction;
- executes `svc.sh install` as root only after a runner extraction or registration completed in the current installer process;
- manages an existing service through a validated `.service` name and `systemctl`, not through user-writable runner scripts;
- supports rerunning after an interrupted or failed initial registration;
- does not perform any action against the previous environment.

## Removed elements

- Dockerfiles, Compose, `.dockerignore`, and `.env.example`;
- runner container entrypoint and Relay client;
- Relay HTTP server, health endpoint, bearer secret, polling, request/job DTOs, queue, persisted state, and restart recovery;
- current tests and operations instructions that covered only the removed runtime.

Historical completed ExecPlans were not modified.

## Progress

- [x] Reviewed the complete repository and previous runtime boundaries.
- [x] Produced and cross-checked the native runner specification.
- [x] Implemented direct Codex execution and removed Relay transport/state.
- [x] Preserved PR resolution, exact checkout, credential cleanup, artifact output, and trusted finalization.
- [x] Implemented the idempotent WSL/Debian installer.
- [x] Added transactional harness replacement and recovery.
- [x] Corrected token redaction, deterministic tool paths, executable file mode, and Codex permission-profile validation.
- [x] Preserved tool usability through read-only Rust access and private package/build caches.
- [x] Removed privileged rerun execution from existing user-owned runner scripts.
- [x] Added recovery after failed initial registration.
- [x] Updated README, operations documentation, workflows, package scripts, and tests.
- [x] Ran a clean non-root repository validation after the final code changes.
- [x] Reviewed the final implementation against this plan and the technical specification.
- [ ] [blocked] Exercise the installer on the actual target WSL instance. Cause: this environment has no access to the user's WSL, sudo session, Codex login, organization PAT, or systemd host. Impact: live package installation, Codex authentication, organization registration, service startup, runner-group visibility, and one end-to-end GitHub job are not evidenced. Evidence: repository-owned deterministic validation passes, while the GitHub CI job remains queued without an eligible runner. Unblock condition: run `/srv/github-runner/storage/agent-relay/install.sh` on the target WSL and allow the resulting runner to execute PR #16 CI.

## Surprises & Discoveries

- The useful executor logic was independent from Relay and could be retained without a broad refactor.
- The old launcher could not be adapted by substituting the real home because its cleanup would have destroyed unrelated state.
- Git file mode mattered: `install.sh` initially existed as `100644`, making the documented `./install.sh` command invalid.
- The original redaction replacement callback treated regex offsets as capture groups and could leak or duplicate token text.
- Denying `/opt/rust` would have protected the directory but broken Cargo/Rust toolchain reads; read-only access is required.
- Denying the real home requires explicit private cache/config paths for npm, pip, Go, Gradle, Cargo, XDG, and Git.
- Running `svc.sh start/status` or `installdependencies.sh` through `sudo` during reruns would trust user-owned files unnecessarily.
- A strict fresh-extraction-only service guard needed a second trusted state for recovery when registration succeeds on a later rerun.

## Decision Log

- Decision: remove Relay transport and state, but retain direct execution controls and workflow behavior.
  Rationale: runner and Codex now share one OS environment.

- Decision: use one organization runner and `runs-on: [self-hosted]` without custom labels.
  Rationale: the same runner must serve approved `Divorium` repositories and the old runner is disabled outside this repository.

- Decision: keep the harness root-owned outside runner workspaces.
  Rationale: pull-request content must not replace the resolver, executor policy, launcher, or finalizer used to execute it.

- Decision: preserve real `HOME` for the Codex host, deny it to model-controlled tools, and redirect tool state to a private runtime directory.
  Rationale: authentication remains available without exposing or modifying runner/user state.

- Decision: expose `/opt/rust` read-only.
  Rationale: Cargo and Rust need to read the installed toolchain, but model-controlled processes must not modify it.

- Decision: execute runner-owned root scripts only after current-process trust establishment and manage existing services through `systemctl`.
  Rationale: reruns must not promote mutable user-owned files to root execution.

- Decision: never interact with the previous environment.
  Rationale: this is an independent installation, not migration or cleanup.

## Validation Evidence

The final code was reconstructed in an isolated filesystem and validated as a non-root user with a writable private HOME:

```bash
npm ci
npm run check
```

Result:

```text
npm ci: passed, 0 vulnerabilities
TypeScript typecheck: passed
TypeScript build: passed
Node tests: 51 passed, 0 failed
Bash syntax validation: passed
Line coverage: 99.11%
Branch coverage: 86.06%
Function coverage: 98.63%
```

The suite covers direct CLI behavior, workspace/plan boundaries, executor failure and timeout, process-group termination, output truncation, split secret redaction, launcher environment isolation, private caches, installer ordering and rollback, PAT handling, registration recovery, service trust boundaries, workflow token scoping, resolver behavior, and finalizer push rollback/retry.

## Idempotence and Recovery

Rerunning `install.sh` updates packages and the trusted harness while preserving valid authentication, runner registration, `_work`, diagnostics, and newer runner updates.

Source validation and smoke failures occur before the harness swap. An interrupted swap restores the previous harness. Failed registration persists no token and can be retried. A later successful registration is considered trusted only for completing service installation in that same process.

## Outcomes & Retrospective

The repository implementation is complete and internally consistent. The remaining unchecked item is target-host acceptance, not missing repository code.

No claim is made that live downloads, Codex login, organization registration, runner-group policy, systemd installation, service startup, or an end-to-end self-hosted job were exercised from this environment.
