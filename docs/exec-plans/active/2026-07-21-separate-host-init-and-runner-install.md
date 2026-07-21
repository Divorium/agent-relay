# Prepare a fresh runner host with Ansible and one reusable installer

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current while work proceeds. Maintain it according to `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

The reviewed baseline is `main` commit `e9ec636e5abf383f8831fc126b99f04e2e005a3c`. Before implementation starts, rebase on current `main` and recheck every referenced file.

Codex may implement repository scripts, Ansible files, tests, and documentation. No GitHub workflow or public Agent Relay API change is required.

## Purpose / Big Picture

Prepare a fresh Debian x86-64 systemd host for one Agent Relay GitHub Actions runner.

Responsibilities are split into two explicit parts:

1. **Ansible initializes the host.** It installs packages and toolchains, creates system users and secure directories, and configures Docker and other operating-system state required by the runner.
2. **`install.sh` installs and refreshes the runner.** It installs or registers the official GitHub runner when absent, configures repository-specific files and the systemd service, builds the Agent Relay runtime, activates it, and starts or restarts the runner.

The host may be rebuilt from scratch. This task does not preserve or migrate the current installation. There is no migration script, compatibility mode, WSL support, host schema, general repair framework, or separate updater.

`install.sh` does not install Ansible, invoke `ansible-playbook`, inspect an Ansible marker, install operating-system packages, or perform Codex authentication.

The expected flow is:

1. On an operator-controlled machine with this repository checked out, run the playbook against the fresh target host:

       ansible-playbook -i ansible/inventory/example.ini ansible/playbooks/host.yml

2. Clone this repository on the prepared target host into `/srv/github-runner/storage/agent-relay` as the configured administrator.
3. Authenticate Codex manually as `github-runner`. This is an operator action and is not checked or performed by `install.sh`.
4. Run:

       cd /srv/github-runner/storage/agent-relay
       ./install.sh

For every later repository release:

    cd /srv/github-runner/storage/agent-relay
    git pull --ff-only
    ./install.sh

Repeated `install.sh` runs are supported. One-time steps such as runner archive extraction and GitHub registration are skipped when already complete. Runtime build and service activation run safely on every invocation.

After implementation, operators must be able to add ordinary host packages by extending Ansible variables rather than editing `install.sh`.

## Progress

Keep this section append-only. Checked implementation items require a repository location and passing evidence. Ansible execution itself is outside automated acceptance.

- [x] (2026-07-21) Reviewed current `install.sh`, `update.sh`, Docker provisioning scripts, package scripts, tests, documentation, and workflows on baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- [x] (2026-07-21) Confirmed current `install.sh` mixes host initialization with runner installation.
- [x] (2026-07-21) Confirmed current `update.sh` separately owns runtime build and service restart while its Docker path is disabled.
- [x] (2026-07-21) Confirmed the new design may assume a fresh host and does not need migration or compatibility with the existing installation.
- [x] (2026-07-21) Confirmed `install.sh` must neither install nor execute Ansible.
- [x] (2026-07-21) Confirmed Codex login is a manual operator action and must be removed from `install.sh` and its tests.
- [x] (2026-07-21) Reviewed the plan as an implementation agent and added the missing fresh-host bootstrap order, package-extension variables, runner dependency boundary, adjacent runtime staging, and narrow activation recovery contract.
- [ ] Rebase and revalidate the baseline before implementation.
- [ ] Add the compact `ansible/` host-initialization structure.
- [ ] Move all host initialization out of `install.sh` and into Ansible.
- [ ] Merge the useful runtime lifecycle into reusable `install.sh`.
- [ ] Delete `update.sh`, dormant Docker provisioning scripts, obsolete tests, and stale documentation references.
- [ ] Update package scripts and focused tests for the new contract.
- [ ] Run all non-Ansible repository checks and independently review the final diff.
- [ ] Update `Outcomes & Retrospective` and move this same plan to `completed` only after every item is checked.

## Surprises & Discoveries

- Observation: the current installer provisions much more than the runner.
  Evidence: `install.sh` installs operating-system packages and toolchains, creates users and directory roots, configures WSL, installs system Git LFS state, downloads the runner, registers it, and performs Codex login.

- Observation: the active part of `update.sh` is small enough to merge into `install.sh`.
  Evidence: with Docker disabled, it stops the service, waits for a `Runner.Worker`, rebuilds `dist`, applies ownership and modes, and restores the service.

- Observation: the current updater stops the runner before compiling.
  Evidence: a build failure therefore causes avoidable runner downtime. The new installer must build and validate a staged runtime before stopping the service.

- Observation: the dormant Docker implementation is no longer needed.
  Evidence: production exits before it, while three large scripts and dedicated regression tests remain solely for unreachable code.

- Observation: a fresh target host cannot execute a playbook stored only on that same host before the repository has been cloned there.
  Evidence: Ansible is therefore run from an operator-controlled checkout against the target host. Repository checkout on the target occurs after host initialization.

- Observation: the official runner dependency helper performs host package installation.
  Evidence: retaining `bin/installdependencies.sh` in `install.sh` would violate the Ansible boundary. Required runner libraries must be installed by the Ansible role.

- Observation: staging under a generic build directory does not prove that activation can use an atomic rename.
  Evidence: the validated runtime stage must be created adjacent to `dist` in the source checkout so stage, active runtime, and `dist.previous` are on the same filesystem.

## Decision Log

- Decision: Ansible is the repository-supported host initialization method.
  Rationale: users, packages, secure directories, toolchains, Docker, and daemon configuration are operating-system state.
  Date/Author: 2026-07-21 / operator requirement.

- Decision: `install.sh` does not install, execute, or verify Ansible.
  Rationale: Ansible is run separately by the human operator before runner installation.
  Date/Author: 2026-07-21 / operator correction.

- Decision: Codex authentication is entirely manual.
  Rationale: the operator will execute Codex login independently; runner installation must neither prompt for it nor fail when authentication is absent.
  Date/Author: 2026-07-21 / operator requirement.

- Decision: target a fresh Debian x86-64 systemd host and remove WSL and migration compatibility.
  Rationale: the environment may be rebuilt from scratch, so preserving historical setup branches adds no value.
  Date/Author: 2026-07-21 / operator clarification.

- Decision: keep `install.sh` as the only repository operational script and delete `update.sh`.
  Rationale: the same command should perform initial runner setup and every later refresh after `git pull`.
  Date/Author: 2026-07-21 / operator requirement.

- Decision: Ansible creates `github-runner`, `agent-relay-builder`, the configured administrator-owned source directory, all secure directory roots, packages, toolchains, runner native dependencies, and Docker state.
  Rationale: these are prerequisites for the runner and repository, not GitHub runner registration operations.
  Date/Author: 2026-07-21 / responsibility split.

- Decision: `install.sh` owns runner archive extraction, registration, `_work`, source-checkout protection, systemd unit installation, runtime build, runtime replacement, and service activation.
  Rationale: these operations are specific to this repository and runner instance.
  Date/Author: 2026-07-21 / responsibility split.

- Decision: `install.sh` must not execute the runner archive's `installdependencies.sh`.
  Rationale: that helper installs host packages and would bypass the Ansible-owned package boundary.
  Date/Author: 2026-07-21 / adversarial review.

- Decision: build the new runtime before stopping the runner.
  Rationale: compilation failure must not interrupt the currently working service.
  Date/Author: 2026-07-21 / review correction.

- Decision: always activate the newly built runtime and restart the service.
  Rationale: comparing complete runtime trees and conditionally skipping restart adds unnecessary complexity to a normal release operation.
  Date/Author: 2026-07-21 / simplification.

- Decision: remove `/etc/agent-relay/administrator`.
  Rationale: it existed to authorize a separate updater. The remaining installer validates that the invoking non-root user owns the source checkout and has sudo authority.
  Date/Author: 2026-07-21 / simplification.

- Decision: support additional ordinary host packages through `agent_relay_extra_apt_packages` with an empty default.
  Rationale: operators need a stable extension point without modifying installer logic. Packages requiring a new repository or special configuration should be added as explicit Ansible tasks rather than through an unsafe generic repository schema.
  Date/Author: 2026-07-21 / operator goal and review.

- Decision: do not execute or lint Ansible in CI for this task.
  Rationale: the operator explicitly excluded Ansible testing.
  Date/Author: 2026-07-21 / operator requirement.

## Outcomes & Retrospective

The plan is active and plan-only. PR #47 was closed without merge because it addressed a different two-runner deployment design. No production behavior has changed yet.

Update this section after implementation with the final file set, responsibility boundary, test results, and any prerequisite assumptions discovered while simplifying the installer.

## Context and Orientation

Current relevant files:

- `install.sh` performs host initialization, runner installation, and Codex login.
- `update.sh` builds runtime and restarts the service.
- `scripts/docker-host.sh`, `scripts/docker-host-debian.sh`, and `scripts/docker-host-debian-core.sh` implement unreachable Docker provisioning.
- `test-system/install-script.integration.sh` and `test-system/update-script.integration.sh` test the two-script model.
- `test-system/docker-host.repository-safe.sh` and `test-system/docker-conffile-recovery.integration.sh` test the dormant Docker implementation.
- `test/installer.test.ts` and `test/update-regression.test.ts` encode the old boundary.
- `README.md`, `docs/operations/README.md`, and `docs/native-github-runner-specification.md` document `install.sh` followed by `update.sh` and automated Codex login.

The intended clean-host layout is:

    /srv/github-runner/storage/agent-relay
    /srv/github-runner/storage/work
    /srv/github-runner/storage/runner
    /srv/github-runner/storage/home
    /srv/github-runner/storage/build
    /srv/github-runner/storage/build-home
    /var/lib/agent-relay/install.lock

with:

    administrator: existing sudo-capable operator selected by Ansible variable
    runner user: github-runner
    builder user: agent-relay-builder
    runner name: gh-runner
    service: actions.runner.Divorium.gh-runner.service

These names and paths are the fresh-host target, not a migration contract.

## Plan of Work

### Milestone 1: Add a compact Ansible host role

Add:

    ansible/
      README.md
      ansible.cfg
      inventory/example.ini
      playbooks/host.yml
      roles/agent_relay_host/
        defaults/main.yml
        tasks/main.yml
        handlers/main.yml
        templates/

Split `tasks/main.yml` only if implementation size makes separate task files useful.

The role is applied from an operator-controlled checkout to a fresh target host. It requires `agent_relay_admin_user` to name an existing sudo-capable login account on the target; it does not create or modify that administrator account.

The defaults must include at least:

    agent_relay_admin_user: ""
    agent_relay_extra_apt_packages: []

Keep required packages separate from the extension list inside the role. Install the unique union of required packages and `agent_relay_extra_apt_packages`. Document that operators add normal packages available from configured repositories through this variable. Do not design a generic arbitrary-repository or arbitrary-shell-command interface.

The playbook must prepare a fresh Debian x86-64 systemd host by declaring:

- required APT repositories, keys, base packages, build tools, and native libraries required by the official runner;
- pinned Node.js, Java, Go, Rust, TypeScript, Codex CLI, and Git LFS state;
- locked `github-runner` and `agent-relay-builder` users without sudo;
- `/srv/github-runner/storage/agent-relay` as an empty or existing administrator-owned source directory;
- runner, work, home, build, and build-home directories with explicit owners and restrictive modes;
- `/var/lib/agent-relay/install.lock` as an administrator-owned regular non-symlink lock file;
- Docker Engine, Compose plugin, containerd, storage roots, daemon configuration, `github-runner` Docker group membership, and active services;
- needrestart or equivalent service policy required by the runner.

Do not include WSL support. Do not preserve the procedural recovery, marker, process-group, or dpkg transaction machinery from the old Docker shell scripts. Use ordinary Ansible package, user, group, file, template, and service tasks. Commands or shell tasks are allowed only where no suitable module exists and must use `creates`, `removes`, `changed_when`, or equivalent state checks so a second playbook run is safe.

The playbook must not:

- clone or update the repository;
- download, extract, configure, or register the GitHub runner;
- request a PAT or registration token;
- perform or validate Codex login;
- build `dist`;
- invoke `install.sh`.

`ansible/README.md` documents:

- the control-machine and target-host roles;
- supported Debian architecture and privilege assumptions;
- inventory and `agent_relay_admin_user`;
- `agent_relay_extra_apt_packages` with an example;
- the manual playbook command;
- target-host repository checkout after the playbook;
- manual Codex authentication as `github-runner`;
- the subsequent `./install.sh` step;
- that no credentials belong in inventory or the repository.

### Milestone 2: Reduce `install.sh` to runner and repository responsibilities

Remove from `install.sh`:

- all apt, dpkg, repository, package, and toolchain installation;
- runner `bin/installdependencies.sh` execution;
- user and group creation or repair;
- protected directory-root creation;
- WSL detection and `/etc/wsl.conf` mutation;
- Docker installation or configuration;
- Git LFS system installation;
- all Codex login and `codex login status` calls;
- administrator trust-file creation and validation.

At startup, after acquiring the installer lock but before other mutation, validate concrete prerequisites needed for runner installation and runtime build:

- non-root execution by the configured source-directory owner with working noninteractive or interactive sudo acquisition;
- Debian x86-64 with systemd as PID 1;
- exact repository path, canonical non-symlink parent paths, and checkout ownership by the invoking administrator;
- protected regular lock file at `/var/lib/agent-relay/install.lock` owned by the invoking administrator and not writable by group or others;
- existing `github-runner` and `agent-relay-builder` accounts with expected homes, locked passwords, and no sudo access;
- existing directory tree with expected ownership, modes, and no unsafe symlinks;
- required commands and pinned toolchain versions, including `codex` availability but not authentication status;
- working Docker CLI, Compose plugin, daemon, socket access for `github-runner`, and expected Docker/containerd storage roots;
- trusted repository entrypoints and configuration files after removing deleted updater and Docker-script references.

Missing or invalid prerequisites produce direct errors before runner archive extraction, registration, service mutation, runtime replacement, or token prompting. The installer does not repair host initialization.

### Milestone 3: Keep runner installation idempotent

`install.sh` must:

- accept no arguments and refuse root execution;
- open `/var/lib/agent-relay/install.lock` and acquire one nonblocking `flock` for the full invocation;
- validate absent, complete, or partial runner state before mutation;
- download and SHA-256 verify the bootstrap runner archive only when runner binaries are absent;
- extract the archive as `github-runner` without invoking `installdependencies.sh`;
- reject partial or conflicting runner contents instead of guessing or deleting them;
- create `_work -> ../work` only when absent and validate the exact symlink when present;
- request a PAT, exchange it for a short-lived organization registration token, and run `config.sh` only when `.runner` is absent;
- keep PAT and registration token memory-only, disable shell tracing around them, and unset them immediately;
- leave the runner's default self-update behavior unchanged; the pinned archive version is the bootstrap version, not a permanent reconciliation target;
- render the expected systemd unit to a temporary file and atomically install it as root;
- call `systemctl daemon-reload` after unit installation;
- apply the repository source ownership and read-only-for-service-accounts contract without referencing deleted files;
- perform no Codex authentication or authentication validation.

A second run with an already registered runner must not download the runner archive, request a PAT, run `config.sh`, or alter the registration. No compatibility handling for an old or differently configured runner is required. Unexpected partial state fails with a clear instruction to rebuild the host or deliberately remove the conflicting runner state.

### Milestone 4: Build and activate runtime in the same installer

After successful preflight and runner setup, on every invocation:

1. remove only installer-owned stale `.dist.stage.*` entries after validating that each is a real directory within the source root and not a mount point or symlink;
2. create a fresh private stage adjacent to `dist`, for example `${SOURCE_ROOT}/.dist.stage.XXXXXXXX`, then assign it to `agent-relay-builder` mode `0700`;
3. compile `tsconfig.runtime.json` into that stage through `env -i` and the pinned TypeScript compiler;
4. require `stage/src/run-codex.js` and reject symlinks, special files, mount crossings, and entries outside the stage;
5. apply final `root:root` ownership, directory mode `0755`, and regular-file mode `0644` to the stage;
6. only after stage validation succeeds, stop the runner listener if active;
7. wait without killing for any existing `Runner.Worker` owned by the numeric `github-runner` UID to finish, preserving the existing `KillMode=process` behavior;
8. remove a stale installer-owned `dist.previous` only after validating its path, type, ownership, and containment;
9. atomically rename current `dist` to `dist.previous` when it exists;
10. atomically rename the validated adjacent stage to `dist`;
11. enable and restart the runner service;
12. verify the service is active and a `Runner.Listener` owned by `github-runner` is running;
13. remove `dist.previous` after successful activation.

If compilation or stage validation fails, the running service and active `dist` remain untouched.

Use a narrow cleanup trap with explicit phase flags only for the stage and swap window. If activation fails after replacement:

- stop the service;
- remove the failed new `dist` after validating it is the installer-owned activated tree;
- restore `dist.previous` when it existed;
- restart and verify the previous service;
- retain the original activation failure as the command failure even when restoration succeeds;
- report that no previous runtime existed on a first installation when restoration is impossible.

This is a local replacement fallback, not a general rollback system. Every successful run rebuilds `dist` and restarts the runner. Full runtime comparison and conditional restart are out of scope.

`install.sh` performs no Git synchronization, repository tests, coverage, Ansible execution, package installation, Docker provisioning, or Codex login.

### Milestone 5: Remove obsolete files

Delete:

- `update.sh`;
- `scripts/docker-host.sh`;
- `scripts/docker-host-debian.sh`;
- `scripts/docker-host-debian-core.sh`;
- `test-system/update-script.integration.sh`;
- `test-system/docker-host.repository-safe.sh`;
- `test-system/docker-conffile-recovery.integration.sh`;
- `test/update-regression.test.ts` after moving still-relevant single-installer assertions.

Remove active references to those files and to automated Codex login from:

- `install.sh`;
- `package.json`;
- `test/installer.test.ts`;
- remaining system tests;
- `README.md`;
- `docs/operations/README.md`;
- `docs/native-github-runner-specification.md`;
- trusted-entrypoint and shell-syntax lists.

Completed ExecPlans remain historical records and are not rewritten or deleted.

### Milestone 6: Rebuild test coverage around the new contract

Refactor `test-system/install-script.integration.sh` to simulate an already initialized host and cover at minimum:

- preflight succeeds with all required users, directories, commands, versions, Docker state, and lock file;
- each important missing or unsafe prerequisite fails before registration, service mutation, runtime swap, or token prompt;
- installer contains no apt, dpkg, user creation, WSL, Docker provisioning, Ansible execution, `installdependencies.sh`, or Codex login path;
- absent runner binaries download, verify, and extract exactly once;
- existing complete runner binaries skip download;
- partial runner state fails without deletion;
- absent registration prompts once and registers once;
- an existing `.runner` skips PAT prompt and `config.sh`;
- PAT and short-lived token are not persisted or printed;
- repeated invocation is safe and does not duplicate registration;
- runtime build occurs before `systemctl stop`;
- build or stage validation failure leaves active runtime and service untouched;
- active workers are waited for by numeric UID;
- changed runtime is activated through adjacent same-filesystem renames and restarts the service;
- activation failure restores `dist.previous` when present;
- first-install activation failure reports that no fallback exists;
- successful activation removes stage and previous runtime;
- Codex authentication is neither checked nor performed.

Update `test/installer.test.ts` or split focused static tests under an accurate name. Preserve useful ownership, token-handling, runner, runtime, and service assertions. Remove assertions whose only purpose was WSL, automatic Codex login, the separate updater, or dormant Docker process control.

Update `package.json`:

- remove `update.sh` and deleted Docker files from `check:shell`;
- remove deleted system tests from `check:system`;
- retain runtime, Node, shell, toolchain, and single-installer system validation;
- do not add Ansible execution, `ansible-lint`, or an Ansible dependency.

### Milestone 7: Update current documentation

Update `README.md`, `docs/operations/README.md`, and `docs/native-github-runner-specification.md` only after implementation is accepted.

Document:

- Ansible is run from an operator-controlled checkout against a fresh target host;
- the playbook prepares packages, extensible extra package lists, toolchains, users, directories, Docker, and services;
- the repository is cloned on the target after host initialization;
- Codex login is a separate manual operator command and is not part of installation acceptance;
- `install.sh` installs and registers only the GitHub runner plus repository-specific runtime and service state;
- first installation and later releases both use `./install.sh`;
- later releases remain `git pull --ff-only` followed by `./install.sh`;
- there is no `update.sh`;
- the system supports adding ordinary APT packages through `agent_relay_extra_apt_packages`;
- packages requiring new repositories or special configuration are added as explicit Ansible role tasks.

No workflow, public Agent Relay API, Codex request/result contract, routing behavior, or output contract changes are required.

## Concrete Steps

Rebase and inspect:

    git fetch origin
    git rebase origin/main
    git status --short
    git diff --name-status origin/main...HEAD
    git grep -n -e 'update\.sh' -e 'docker-host' -e 'DOCKER_PROVISIONING_ENABLED' -e 'codex login'

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

Do not run `ansible-playbook`, `ansible-lint`, or install Ansible as validation for this task.

## Validation and Acceptance

Acceptance requires:

- the repository contains a documented Ansible role that can prepare the complete fresh-host prerequisite state;
- adding ordinary packages requires only extending `agent_relay_extra_apt_packages` in inventory or variables;
- Ansible owns packages, repositories, toolchains, users, secure directories, Docker, native runner dependencies, and host services;
- `install.sh` contains no host provisioning, Ansible execution, runner dependency helper, or Codex authentication;
- `install.sh` can install and register the official runner on the prepared host;
- a second `install.sh` execution does not repeat archive download or registration;
- first installation and later runtime refresh use the same script;
- runtime compilation completes before runner shutdown;
- failed build leaves the currently active runtime and service untouched;
- activation failure restores one previous runtime when available;
- `update.sh` and dormant Docker provisioner implementation are removed;
- all non-Ansible repository checks pass;
- final independent review finds no stale active reference to the removed updater, Docker provisioner, WSL path, or automated Codex login.

The plan is complete only when every `Progress` item is checked and supported by code plus passing evidence.

## Idempotence and Recovery

The Ansible role declares desired state through idempotent modules. A second playbook run should report no changes when the host already matches the role, except where package metadata refresh or external repositories naturally report state. Ansible execution is not tested by this task.

`install.sh` supports two expected runner states:

- absent: install binaries and register;
- complete: reuse the existing binaries and registration.

Unexpected partial or conflicting state fails without destructive repair. Because the host may be rebuilt, recovery guidance is to remove or rebuild the fresh environment deliberately rather than infer how to migrate unknown state.

The installer lock prevents concurrent runs. Runner registration is never repeated while a valid `.runner` exists. PAT and short-lived registration tokens remain memory-only.

Runtime build occurs in a fresh adjacent stage. Active `dist` remains untouched until stage validation succeeds. The installer owns only `.dist.stage.*`, `dist`, and `dist.previous` within the exact source root and validates each before cleanup or rename. One previous runtime exists only during activation and is removed after success.

## Artifacts and Notes

Keep append-only.

- 2026-07-21: closed PR #47 without merge because it addressed a different automatic two-runner deployment design.
- 2026-07-21: reviewed current installer, updater, Docker provisioner, tests, package scripts, workflows, and current documentation.
- 2026-07-21: corrected initial draft assumption: `install.sh` neither installs Ansible nor requires an Ansible marker.
- 2026-07-21: simplified the target to a fresh Debian systemd host with no WSL or migration compatibility.
- 2026-07-21: removed Codex login from installer responsibility; authentication remains a manual operator action.
- 2026-07-21: adversarial review added package-extension variables, control-machine bootstrap order, prohibition of `installdependencies.sh`, adjacent runtime staging, and explicit narrow swap recovery.

Future evidence: final file list; deleted-reference grep; Ansible variable and task review; installer preflight fixtures; repeated-run command log; registration prompt count; token-leak checks; build-before-stop ordering; runtime stage failure/success/rollback cases; package-script output; complete CI result; independent final review.

## Interfaces and Dependencies

Host initialization interface, run from the operator machine:

    ansible-playbook -i ansible/inventory/example.ini ansible/playbooks/host.yml

Required role variables:

    agent_relay_admin_user: <existing sudo-capable target login>

Optional package extension:

    agent_relay_extra_apt_packages:
      - <additional-package>

Repository operational interface, run on the target host:

    ./install.sh

Manual Codex authentication, run separately by the operator:

    sudo -u github-runner -H /usr/local/bin/codex login

`install.sh` accepts no arguments and runs as the normal source-checkout owner, not root. It obtains sudo only for bounded runner, runtime, ownership, and systemd operations.

Fresh-host identities and paths:

- administrator: supplied by `agent_relay_admin_user`;
- runner: `github-runner`;
- builder: `agent-relay-builder`;
- source: `/srv/github-runner/storage/agent-relay`;
- work: `/srv/github-runner/storage/work`;
- runner directory: `/srv/github-runner/storage/runner`;
- runner home: `/srv/github-runner/storage/home`;
- build: `/srv/github-runner/storage/build`;
- build home: `/srv/github-runner/storage/build-home`;
- install lock: `/var/lib/agent-relay/install.lock`;
- service: `actions.runner.Divorium.gh-runner.service`.

Use existing Bash, systemd, Git, curl, jq, TypeScript, Docker, and official GitHub Actions runner dependencies supplied by the prepared host. Add no new runtime dependency to `install.sh`.