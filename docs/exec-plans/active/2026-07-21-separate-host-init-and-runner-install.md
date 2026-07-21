# Prepare a fresh runner host with Ansible and one reusable installer

This ExecPlan is a living implementation document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current according to `.agent/PLANS.md`. Only this file under `docs/exec-plans/active/` is the implementation instruction for this task.

The reviewed baseline is `main` commit `e9ec636e5abf383f8831fc126b99f04e2e005a3c`. Rebase on current `main` and recheck referenced files before implementation. Codex may change repository scripts, Ansible files, tests, and documentation. No GitHub workflow or public Agent Relay API change is required.

## Purpose / Big Picture

Prepare a fresh **Debian 13 (Trixie) x86-64 systemd host** for one Agent Relay GitHub Actions runner.

The responsibility split is intentionally small:

1. **Ansible initializes the host.** It installs packages and toolchains, creates users and secure directories, and configures Docker and other operating-system state.
2. **`install.sh` installs and refreshes the runner.** It installs and registers the official GitHub runner when needed, installs repository-specific files and the systemd unit, builds the Agent Relay runtime, activates it, and starts or restarts the service.

The host may be rebuilt from scratch. There is no migration, old-layout compatibility, WSL support, host schema, general repair framework, or separate updater.

`install.sh` does not install Ansible, invoke a playbook, install packages, create host users or root directory trees, invoke the runner dependency helper, provision Docker, or authenticate Codex.

After implementation, an operator must be able to:

- add ordinary Debian packages by extending an Ansible variable and rerunning the playbook;
- prepare a fresh host using the repository Ansible role;
- clone the repository on that host;
- manually authenticate Codex as `github-runner`;
- install and register the runner with `./install.sh`;
- refresh the repository runtime later with the same installer.

## Operator Flow

Minimal target state before Ansible:

- reachable by SSH;
- Python 3 installed;
- `sudo` installed;
- one existing sudo-capable administrator account.

From an operator-controlled checkout with Ansible already installed:

    ansible-playbook -i ansible/inventory/example.ini ansible/playbooks/host.yml

Then clone the repository on the target as the configured administrator:

    git clone <repository-url> /srv/github-runner/storage/agent-relay

Authenticate Codex manually before starting the runner:

    sudo -u github-runner -H /usr/local/bin/codex login

Then install the runner and runtime:

    cd /srv/github-runner/storage/agent-relay
    ./install.sh

A later release must not modify the trusted checkout while a job is using scripts from it. The supported release procedure is:

1. stop the listener;
2. wait until no `Runner.Worker` owned by `github-runner` remains;
3. run `git pull --ff-only` as the checkout owner;
4. run `./install.sh`.

Document the exact commands in `docs/operations/README.md`. Do not add another updater or deployment controller.

## Progress

Keep this section append-only. Checked implementation items require code plus passing evidence. Ansible execution and Ansible linting are explicitly outside automated acceptance.

- [x] (2026-07-21) Reviewed current installer, updater, Docker scripts, package commands, tests, documentation, and workflows at baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- [x] (2026-07-21) Confirmed the current installer mixes host initialization, runner setup, and Codex login.
- [x] (2026-07-21) Confirmed the current updater owns runtime build and service restart while its Docker path is disabled.
- [x] (2026-07-21) Selected a fresh Debian 13 host with no migration or WSL compatibility.
- [x] (2026-07-21) Removed Ansible installation/execution and Codex authentication from installer responsibility.
- [x] (2026-07-21) Added the package extension, runner dependency boundary, independent binary/registration states, adjacent runtime staging, and local activation fallback.
- [x] (2026-07-21) Added the safe release rule that the listener and active worker must be drained before `git pull` changes the trusted checkout.
- [x] (2026-07-21) Distinguished exact versions from configured major versions/channels and Docker `present` state.
- [ ] Rebase and revalidate the repository before implementation.
- [ ] Add the compact `ansible/` structure and host role.
- [ ] Move all host initialization out of `install.sh` into Ansible.
- [ ] Merge the useful runtime lifecycle into reusable `install.sh`.
- [ ] Delete the updater, dormant Docker provisioner, obsolete tests, and stale active references.
- [ ] Update package commands, `.gitignore`, focused tests, and current documentation.
- [ ] Run all non-Ansible repository checks and independently review the final diff.
- [ ] Complete the retrospective and move this same plan to `completed` only after all items pass.

## Surprises & Discoveries

- Observation: the current installer provisions the host.
  Evidence: it installs packages and toolchains, creates users and directories, configures WSL, installs Git LFS, downloads and registers the runner, and performs Codex login.

- Observation: the active updater behavior is small enough to merge into the installer.
  Evidence: with Docker disabled, it waits for workers, builds `dist`, applies metadata, and restores the runner service.

- Observation: the current updater stops the runner before compiling.
  Evidence: a build failure causes avoidable downtime. The replacement runtime must be built and validated before listener shutdown.

- Observation: the Docker shell provisioner is unreachable production code.
  Evidence: production returns before it while three scripts and dedicated tests remain.

- Observation: the official runner dependency helper violates the new boundary.
  Evidence: `bin/installdependencies.sh` installs host packages. Dependencies from the pinned runner archive must be represented in the Ansible role instead.

- Observation: runner binaries and runner registration are separate states.
  Evidence: an interrupted first installation can leave complete binaries without `.runner`; the next invocation must register without downloading again.

- Observation: `git pull` can change trusted scripts while an active workflow is using them.
  Evidence: current workflows execute files directly from `/srv/github-runner/storage/agent-relay`. Listener shutdown and worker drain must precede checkout mutation.

- Observation: recursively changing ownership of the whole checkout would also change active `dist` and transient runtime trees.
  Evidence: source validation must not recursively chown the repository. Runtime trees have separate root/builder ownership contracts.

## Decision Log

- Decision: Ansible is the supported host initializer.
  Rationale: packages, users, secure directories, toolchains, Docker, and daemons are host state.
  Date/Author: 2026-07-21 / operator requirement.

- Decision: `install.sh` neither installs nor executes Ansible.
  Rationale: Ansible is an independent operator step.
  Date/Author: 2026-07-21 / operator correction.

- Decision: Codex authentication is manual only.
  Rationale: the installer must neither prompt, validate, nor fail because authentication is absent.
  Date/Author: 2026-07-21 / operator requirement.

- Decision: support only fresh Debian 13 x86-64 systemd hosts.
  Rationale: the environment may be rebuilt, so migration, WSL, and distribution abstraction are unnecessary.
  Date/Author: 2026-07-21 / operator clarification.

- Decision: keep `install.sh` as the only repository operational script and delete `update.sh`.
  Rationale: the same command handles initial runner setup and runtime refresh after a safe checkout update.
  Date/Author: 2026-07-21 / operator requirement.

- Decision: Ansible creates all host prerequisites, including native runner libraries.
  Rationale: the installer must not call package-installing helpers.
  Date/Author: 2026-07-21 / responsibility split.

- Decision: ordinary additional packages use `agent_relay_extra_apt_packages`.
  Rationale: package extensibility must not require installer changes or arbitrary shell execution.
  Date/Author: 2026-07-21 / operator goal.

- Decision: version policy is explicit rather than described generically as fully pinned.
  Rationale: Go, TypeScript, Codex CLI, and the bootstrap runner use exact versions; Node and Java use configured major versions; Rust uses the configured `stable` channel; Docker packages are installed with `state: present` from the official signed repository.
  Date/Author: 2026-07-21 / adversarial review.

- Decision: build before stopping the listener and always activate a valid new runtime.
  Rationale: compilation failure must not interrupt the working runner, and full runtime comparison is unnecessary.
  Date/Author: 2026-07-21 / simplification.

- Decision: release checkout mutation requires prior listener stop and worker drain.
  Rationale: the active workflows execute trusted files directly from the shared checkout.
  Date/Author: 2026-07-21 / adversarial review.

- Decision: do not execute or lint Ansible in CI for this task.
  Rationale: Ansible testing was explicitly excluded.
  Date/Author: 2026-07-21 / operator requirement.

## Outcomes & Retrospective

The plan is active and plan-only. PR #47 was closed without merge. No production behavior has changed yet.

After implementation, record the final file set, package extension example, runner installation behavior, removed legacy files, validation results, and any remaining manual assumptions.

## Context and Orientation

Current state:

- `install.sh` performs host provisioning, runner setup, and Codex login;
- `update.sh` builds runtime and restarts the service;
- `scripts/docker-host.sh`, `scripts/docker-host-debian.sh`, and `scripts/docker-host-debian-core.sh` preserve disabled Docker provisioning;
- current tests and documentation encode WSL, two operational scripts, the administrator trust file, and automated Codex login.

Fresh target paths:

    /srv/github-runner/storage/agent-relay
    /srv/github-runner/storage/work
    /srv/github-runner/storage/runner
    /srv/github-runner/storage/home
    /srv/github-runner/storage/build
    /srv/github-runner/storage/build-home
    /srv/github-runner/storage/docker/engine
    /srv/github-runner/storage/docker/containerd
    /var/lib/agent-relay/install.lock

Identities and service:

    administrator: existing sudo-capable account selected by Ansible variable
    runner: github-runner
    builder: agent-relay-builder
    runner name: gh-runner
    service: actions.runner.Divorium.gh-runner.service

These are fresh-host targets, not migration contracts.

## Plan of Work

### Milestone 1: Add the Ansible host role

Add:

    ansible/
      README.md
      ansible.cfg
      inventory/example.ini
      inventory/group_vars/all.yml.example
      playbooks/host.yml
      roles/agent_relay_host/
        defaults/main.yml
        tasks/main.yml
        handlers/main.yml
        templates/

Split `tasks/main.yml` only when implementation size makes it useful.

Control and target contract:

- the playbook runs from an operator-controlled checkout;
- the target already has SSH, Python 3, `sudo`, and an existing sudo-capable account;
- `agent_relay_admin_user` is required, asserted nonempty, and identifies that existing account;
- the playbook uses privilege escalation and does not create or modify the administrator account;
- fail early unless the target is Debian 13 `trixie`, x86-64, with systemd as PID 1.

Role defaults include:

    agent_relay_admin_user: ""
    agent_relay_extra_apt_packages: []
    agent_relay_node_major: 22
    agent_relay_java_major: 21
    agent_relay_go_version: "1.24.5"
    agent_relay_rust_toolchain: "stable"
    agent_relay_typescript_version: "5.8.3"
    agent_relay_codex_version: "0.144.4"

Required package lists remain internal to the role. Install the unique union of required packages and `agent_relay_extra_apt_packages` through the Ansible APT module. Packages that require another repository or special configuration require explicit reviewed role tasks.

Provisioning rules:

- use root-owned `/etc/apt/keyrings` and explicit `signed-by` repository definitions;
- do not run NodeSource, Docker, Java, or other repository setup scripts;
- use official signed APT repositories for Node, Java, Docker, and containerd;
- install Docker packages with `state: present`;
- use exact configured versions for Go archives, TypeScript, and Codex CLI;
- install Rust with a verified `rustup-init` binary and configure the `stable` toolchain;
- use checksum verification for downloaded archives and bootstrap binaries;
- use shell/command tasks only when no suitable module exists and provide explicit idempotence and `changed_when` behavior.

During implementation, inspect the pinned GitHub Actions runner `2.335.1` archive and its dependency helper. Encode the required Debian 13 native libraries in the Ansible package list. Never invoke `bin/installdependencies.sh` in production.

The role declares:

- base, build, native-runner, Docker, and additional APT packages;
- toolchains at the roots already defined by `scripts/toolchain-environment.sh`;
- locked `github-runner` with home `/srv/github-runner/storage/home` and shell `/bin/bash`;
- locked `agent-relay-builder` with home `/srv/github-runner/storage/build-home` and shell `/usr/sbin/nologin`;
- neither service user belongs to sudo or has passwordless sudo;
- `/srv/github-runner/storage/agent-relay` owned by the configured administrator and primary group;
- runner, work, home, build, and build-home directories with explicit ownership and restrictive modes;
- root-owned, non-group-writable `/var/lib/agent-relay` and administrator-owned mode `0600` `install.lock`;
- Docker engine root `/srv/github-runner/storage/docker/engine` and containerd root `/srv/github-runner/storage/docker/containerd` in managed configuration;
- `github-runner` membership in the Docker group, documented as root-equivalent host trust;
- enabled and active containerd, Docker socket, and Docker services;
- handlers that reload systemd when unit files change and restart containerd/Docker only when their managed configuration changes;
- needrestart policy that does not unexpectedly restart Actions runner services.

The role must not clone or update the repository, install or register the GitHub runner, request GitHub credentials, perform or check Codex login, build `dist`, or invoke `install.sh`.

`ansible/README.md` documents prerequisites, inventory, copying the example group variables, package extension, playbook execution, target checkout, manual Codex login, installer execution, and credential exclusion.

### Milestone 2: Reduce `install.sh` to runner responsibilities

Remove all package/repository/toolchain installation, runner dependency helper execution, user/group creation, root directory creation, WSL handling, Docker provisioning, Git LFS system installation, Codex authentication, and administrator trust-file behavior.

Before mutation, `install.sh` must:

- accept no arguments and refuse root execution;
- require the exact canonical source path and invocation by its owner;
- obtain sudo authority;
- validate `/var/lib/agent-relay` as a root-owned regular directory not writable by group or others;
- validate `install.lock` as a regular non-symlink file owned by the caller with mode `0600`, open it without truncation, and acquire a nonblocking `flock` for the full run;
- validate Debian 13 x86-64 and systemd;
- validate the runner and builder accounts, homes, shells, locked status, and lack of sudo;
- validate required directories, ownership, modes, and absence of unsafe symlinks;
- validate required commands and functional compatibility, including Node 22, Java 21, Go, Rust, TypeScript, Codex binary presence, Git LFS, Docker CLI, Compose, daemon availability, Docker socket access as `github-runner`, and configured Docker/containerd roots;
- validate trusted repository entrypoints as regular non-symlink files owned by the administrator and not writable by group or others.

Do not recursively chown or chmod the entire checkout. In particular, never change ownership of `dist`, `.dist.stage.*`, or `dist.previous` through source-checkout protection. Normalize only explicit installer-managed files where required.

Failure must occur before runner extraction, registration, token prompting, service mutation, or runtime replacement. The installer does not repair host initialization.

### Milestone 3: Install and register the runner idempotently

Treat binary and registration state independently.

Binary states:

- **absent:** required runner payload files are absent; download, verify, and extract;
- **complete:** required payload files from the pinned archive are present as safe regular executable files; reuse them;
- **partial/conflicting:** only part of the required payload exists or metadata is unsafe; fail without deleting it.

Registration states:

- **absent:** all registration marker and credential files expected from the pinned runner are absent; register;
- **complete:** the full expected marker set is present with safe runner ownership and modes; reuse it;
- **partial/conflicting:** only part of the marker set exists or metadata is unsafe; fail without deletion or registration.

Complete binaries with absent registration are resumable.

Installer behavior:

- use bootstrap runner version `2.335.1` and its recorded SHA-256 only when binary state is absent;
- extract as `github-runner` without running `installdependencies.sh`;
- create `_work -> ../work` only when absent and validate the exact symlink when present;
- prompt for a GitHub credential and exchange it for a short-lived organization runner registration token only when registration is absent;
- document that the credential must be authorized to create organization runner registration tokens;
- keep credentials memory-only, disable shell tracing around them, never print them, and unset them immediately;
- run `config.sh --unattended --replace --url https://github.com/Divorium --token <token> --name gh-runner --work _work`;
- leave the runner's default self-update behavior enabled; `2.335.1` is the bootstrap version, not a permanent reconciliation target;
- copy or refresh top-level `runsvc.sh` from `bin/runsvc.sh` and set mode `0755`;
- atomically install the root-owned systemd unit with `User=github-runner`, the runner working directory and `ExecStart`, `KillMode=process`, `TimeoutStopSec=5min`, `Restart=always`, and `RestartSec=5s`;
- run `systemctl daemon-reload` after installing the unit;
- perform no Codex authentication or authentication validation.

A second complete run must not download the archive, prompt for credentials, run `config.sh`, or alter registration.

### Milestone 4: Build and activate runtime

Every successful installer invocation after runner setup:

1. fail on a pre-existing `dist.previous` and report it for operator inspection;
2. remove only validated stale `.dist.stage.*` directories contained in the exact source root, owned by builder or root, and not symlinks or mount points;
3. create a fresh builder-owned mode `0700` stage adjacent to `dist`;
4. compile `tsconfig.runtime.json` into the stage through a clean `env -i`;
5. require `stage/src/run-codex.js` and reject symlinks, special files, mount crossings, and path escape;
6. apply final root ownership, directory mode `0755`, and regular-file mode `0644` to the stage;
7. only after stage validation succeeds, stop the listener if active;
8. wait without killing until no `Runner.Worker` owned by the numeric `github-runner` UID remains;
9. rename current `dist` to `dist.previous` when it exists;
10. atomically rename the adjacent stage to `dist`;
11. enable and restart the runner service;
12. poll for at most 60 seconds until systemd reports active and a runner-owned `Runner.Listener` exists;
13. remove `dist.previous` after successful activation.

Compilation or stage validation failure leaves the existing service and runtime untouched.

Use a narrow phase-aware cleanup trap only for the stage and swap window. If activation fails after replacement, stop the service, validate and remove the failed new runtime, restore `dist.previous` when it existed, restart and verify the previous service, and return the original activation failure. On first installation with no previous runtime, report that no fallback exists and leave the service stopped or failed.

Every successful run rebuilds `dist` and restarts the runner. There is no Git synchronization, repository test execution, package installation, Docker provisioning, Ansible execution, or Codex login in `install.sh`.

Add `.dist.stage.*` and `dist.previous` to `.gitignore`.

### Milestone 5: Remove obsolete implementation

Delete:

- `update.sh`;
- `scripts/docker-host.sh`;
- `scripts/docker-host-debian.sh`;
- `scripts/docker-host-debian-core.sh`;
- updater and Docker-provisioner system tests;
- `test/update-regression.test.ts` after preserving relevant installer assertions.

Remove active references to the updater, Docker provisioner, WSL, administrator trust file, runner dependency helper, and automated Codex login from scripts, package commands, tests, current documentation, and trusted-entrypoint lists. Completed ExecPlans remain historical records.

### Milestone 6: Rebuild focused tests

Refactor installer integration and static tests to cover:

- prepared-host success and representative fail-before-mutation prerequisites;
- no package, user, Docker, Ansible, dependency-helper, or Codex-auth path in the installer;
- binary absent, complete, and partial states;
- registration absent, complete, and partial states, including complete binaries without registration;
- one-time archive download and registration;
- exact registration arguments and token non-persistence/non-output;
- `_work`, `runsvc.sh`, and systemd unit contract;
- second-run idempotence;
- no recursive checkout chown and preserved runtime ownership boundary;
- build before listener stop;
- stage failure isolation;
- numeric-UID worker wait;
- adjacent same-filesystem activation and bounded listener readiness;
- activation restoration and first-install no-fallback behavior;
- successful cleanup;
- package script removal of deleted files and tests;
- static consistency between Ansible toolchain roots and `scripts/toolchain-environment.sh`.

Do not execute `ansible-playbook`, install Ansible, run `ansible-lint`, or add an Ansible dependency to repository validation.

### Milestone 7: Update current documentation

After implementation acceptance, update `README.md`, `docs/operations/README.md`, and `docs/native-github-runner-specification.md` to document:

- Debian 13 target and minimal pre-Ansible requirements;
- Ansible execution from an operator checkout;
- `agent_relay_extra_apt_packages` with an example;
- exact-versus-major/channel/package-state version policy;
- target repository clone after host initialization;
- manual Codex login outside the installer and acceptance;
- initial runner installation with `./install.sh`;
- safe later release procedure: stop listener, drain worker, pull, run installer;
- no updater, WSL, shell Docker provisioner, administrator trust file, dependency helper, or automated login;
- Docker group access as root-equivalent host trust.

No workflow, public API, request/result contract, routing, or output behavior changes are required.

## Concrete Steps

Rebase and inspect:

    git fetch origin
    git rebase origin/main
    git status --short
    git diff --name-status origin/main...HEAD
    git grep -n -e 'update\.sh' -e 'docker-host' -e 'DOCKER_PROVISIONING_ENABLED' -e 'codex login' -e 'installdependencies\.sh'

Expected final file checks:

    test ! -e update.sh
    test ! -e scripts/docker-host.sh
    test ! -e scripts/docker-host-debian.sh
    test ! -e scripts/docker-host-debian-core.sh
    test -f ansible/playbooks/host.yml
    test -f ansible/roles/agent_relay_host/defaults/main.yml
    test -f ansible/roles/agent_relay_host/tasks/main.yml
    ! grep -Eq 'ansible-playbook|apt-get|dpkg|useradd|rustup|nodesource|DOCKER_PROVISIONING_ENABLED|codex login|installdependencies\.sh' install.sh
    grep -q 'agent_relay_extra_apt_packages' ansible/roles/agent_relay_host/defaults/main.yml

Run non-Ansible validation:

    bash -n install.sh runner/finalize.sh scripts/codex-run scripts/toolchain-environment.sh scripts/toolchain-smoke.sh scripts/ci-runtime-build.sh scripts/ci-toolchain-smoke.sh test-system/install-script.integration.sh
    npm ci
    npm run typecheck
    npm test
    npm run check:runtime
    npm run check:shell
    npm run check:node-scripts
    npm run check:toolchain
    npm run check:system
    npm run check
    git diff --check

## Validation and Acceptance

Acceptance requires:

- the repository contains a documented Ansible role that prepares the complete Debian 13 prerequisite state from the stated minimal host state;
- ordinary Debian packages can be added only by extending `agent_relay_extra_apt_packages` and rerunning the role;
- required native runner dependencies are encoded after inspecting the pinned archive;
- Ansible owns repositories, packages, configured toolchain versions/channels, users, secure directories, Docker, and host services;
- `install.sh` contains no host provisioning, dependency helper, Ansible execution, or Codex authentication;
- `install.sh` installs runner binaries from absent state and registers from absent registration state;
- complete binaries without registration resume correctly;
- a complete second invocation skips archive download and registration;
- the exact `runsvc.sh`, registration, and systemd contracts are installed;
- runtime compilation completes before listener shutdown;
- a failed build leaves active runtime and service untouched;
- activation failure restores one previous runtime when available;
- the supported release procedure prevents checkout mutation during an active job;
- `update.sh` and dormant Docker provisioner files are removed;
- all non-Ansible checks pass;
- final independent review finds no stale updater, Docker provisioner, WSL, trust-file, dependency-helper, recursive checkout ownership, or automated-login behavior.

The plan is complete only when every Progress item is checked and supported by code plus passing evidence.

## Idempotence and Recovery

The Ansible role uses idempotent modules and guarded commands. A matching host should produce no material changes on a second run apart from normal package metadata refresh. Ansible execution is not tested by this task.

`install.sh` separately handles absent and complete binary/registration states. Partial or conflicting state fails without destructive repair. Unknown host state is rebuilt rather than migrated.

The protected lock prevents concurrent installer runs. Credentials remain memory-only.

Runtime build occurs in an adjacent stage. Active runtime remains untouched until validation. One previous runtime exists only during activation and is deleted after success. A pre-existing previous runtime blocks a new run for operator inspection.

## Artifacts and Notes

Keep append-only.

- 2026-07-21: closed PR #47 without merge.
- 2026-07-21: reviewed current installer, updater, Docker, tests, package scripts, workflows, and documentation.
- 2026-07-21: removed Ansible installation and Codex login from installer responsibility.
- 2026-07-21: selected a fresh Debian 13 host with no WSL or migration compatibility.
- 2026-07-21: added package extension, runner state separation, native dependency derivation, adjacent staging, and local activation restoration.
- 2026-07-21: added safe checkout-update procedure, explicit version policy, protected lock parent, Docker handlers, source/runtime ownership separation, and group variable example.

Future evidence: final file list and grep; Ansible variables and task review; runner dependency list; installer prerequisite fixtures; binary/registration state matrix; token checks; systemd contract; safe release documentation; build/swap/restore cases; package script output; complete CI result; independent final review.

## Interfaces and Dependencies

From the operator machine:

    ansible-playbook -i ansible/inventory/example.ini ansible/playbooks/host.yml

Required role variable:

    agent_relay_admin_user: <existing sudo-capable target login>

Optional packages:

    agent_relay_extra_apt_packages:
      - <additional-package>

On the target:

    ./install.sh

Manual authentication:

    sudo -u github-runner -H /usr/local/bin/codex login

The installer runs as the source owner, not root, and uses sudo only for bounded runner, runtime, ownership, and systemd operations.

Use the existing Bash, systemd, Git, curl, jq, TypeScript, Docker, and official runner dependencies supplied by the initialized host. Add no runtime dependency to `install.sh`.