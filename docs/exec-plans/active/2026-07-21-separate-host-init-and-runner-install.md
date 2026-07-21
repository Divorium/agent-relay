# Prepare a fresh runner host with Ansible and one reusable installer

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current while work proceeds. Maintain it according to `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

The reviewed baseline is `main` commit `e9ec636e5abf383f8831fc126b99f04e2e005a3c`. Before implementation starts, rebase on current `main` and recheck every referenced file.

Codex may implement repository scripts, Ansible files, tests, and documentation. No GitHub workflow or public Agent Relay API change is required.

## Purpose / Big Picture

Prepare a fresh **Debian 13 (Trixie) x86-64 systemd host** for one Agent Relay GitHub Actions runner.

Responsibilities are split into two parts:

1. **Ansible initializes the host.** It installs packages and pinned toolchains, creates system users and secure directories, and configures Docker and other operating-system state required by the runner.
2. **`install.sh` installs and refreshes the runner.** It installs or registers the official GitHub runner when absent, configures repository-specific files and the systemd service, builds the Agent Relay runtime, activates it, and starts or restarts the runner.

The host may be rebuilt from scratch. This task does not preserve or migrate the current installation. There is no migration script, compatibility mode, WSL support, host schema, general repair framework, or separate updater.

`install.sh` does not install Ansible, invoke `ansible-playbook`, inspect an Ansible marker, install operating-system packages, invoke the runner dependency installer, or perform Codex authentication.

The target host must initially provide only:

- network access and SSH;
- Python 3 required by Ansible;
- `sudo`;
- one existing sudo-capable administrator account.

The expected flow is:

1. On an operator-controlled machine with this repository checked out and Ansible already available, run the playbook against the fresh target:

       ansible-playbook -i ansible/inventory/example.ini ansible/playbooks/host.yml

2. Clone this repository on the prepared target into `/srv/github-runner/storage/agent-relay` as the configured administrator.
3. Authenticate Codex manually as `github-runner`. This is an operator action and is not checked or performed by `install.sh`.
4. Run:

       cd /srv/github-runner/storage/agent-relay
       ./install.sh

For every later repository release:

    cd /srv/github-runner/storage/agent-relay
    git pull --ff-only
    ./install.sh

Repeated `install.sh` runs are supported. One-time steps such as runner archive extraction and GitHub registration are skipped when already complete. Runtime build and service activation run safely on every invocation.

After implementation, operators can add ordinary host packages through Ansible variables without modifying `install.sh`.

## Progress

Keep this section append-only. Checked implementation items require a repository location and passing evidence. Ansible execution itself is outside automated acceptance.

- [x] (2026-07-21) Reviewed current `install.sh`, `update.sh`, Docker provisioning scripts, package scripts, tests, documentation, and workflows on baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- [x] (2026-07-21) Confirmed current `install.sh` mixes host initialization with runner installation.
- [x] (2026-07-21) Confirmed current `update.sh` separately owns runtime build and service restart while its Docker path is disabled.
- [x] (2026-07-21) Confirmed the new design may assume a fresh host and does not need migration or compatibility with the existing installation.
- [x] (2026-07-21) Confirmed `install.sh` must neither install nor execute Ansible.
- [x] (2026-07-21) Confirmed Codex login is a manual operator action and must be removed from `install.sh` and its tests.
- [x] (2026-07-21) Added fresh-host bootstrap order, package-extension variables, the runner dependency boundary, adjacent runtime staging, and narrow activation recovery.
- [x] (2026-07-21) Narrowed the target to Debian 13, specified the control/target prerequisites, and defined declarative repository, toolchain, Docker, runner-service, and native runner dependency contracts.
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
  Evidence: a build failure therefore causes avoidable runner downtime. The new installer builds and validates a staged runtime before stopping the service.

- Observation: the dormant Docker implementation is no longer needed.
  Evidence: production exits before it, while three large scripts and dedicated regression tests remain solely for unreachable code.

- Observation: a fresh target cannot run a repository playbook before that repository is available somewhere.
  Evidence: Ansible is run from an operator-controlled checkout; the target checkout is created only after host initialization.

- Observation: the official runner dependency helper performs host package installation.
  Evidence: retaining `bin/installdependencies.sh` would violate the Ansible package boundary. The pinned archive must be inspected during implementation and its Debian 13 native dependencies encoded in the role.

- Observation: staging under a generic build directory does not prove atomic activation.
  Evidence: the validated runtime stage must be adjacent to `dist`, so stage, active runtime, and `dist.previous` are on the same filesystem.

- Observation: generic package extensibility should not become arbitrary command execution.
  Evidence: an extra APT package list is sufficient for normal packages. Packages requiring another repository or custom configuration need explicit reviewed Ansible tasks.

## Decision Log

- Decision: Ansible is the repository-supported host initialization method.
  Rationale: users, packages, secure directories, toolchains, Docker, and daemon configuration are operating-system state.
  Date/Author: 2026-07-21 / operator requirement.

- Decision: `install.sh` does not install, execute, or verify Ansible.
  Rationale: Ansible is run separately by the human operator before runner installation.
  Date/Author: 2026-07-21 / operator correction.

- Decision: Codex authentication is entirely manual.
  Rationale: runner installation must neither prompt for it nor fail when authentication is absent.
  Date/Author: 2026-07-21 / operator requirement.

- Decision: support only fresh Debian 13 x86-64 hosts with systemd.
  Rationale: the environment may be rebuilt, so WSL, multi-distribution compatibility, and migration logic add no value.
  Date/Author: 2026-07-21 / operator clarification and review.

- Decision: keep `install.sh` as the only repository operational script and delete `update.sh`.
  Rationale: the same command performs initial runner setup and every later refresh after `git pull`.
  Date/Author: 2026-07-21 / operator requirement.

- Decision: Ansible creates `github-runner`, `agent-relay-builder`, the administrator-owned source directory, secure directory roots, packages, pinned toolchains, runner native dependencies, and Docker state.
  Rationale: these are host prerequisites, not GitHub runner registration operations.
  Date/Author: 2026-07-21 / responsibility split.

- Decision: `install.sh` owns runner archive extraction, registration, `_work`, source-checkout protection, `runsvc.sh`, systemd unit installation, runtime build, runtime replacement, and service activation.
  Rationale: these operations are specific to this repository and runner instance.
  Date/Author: 2026-07-21 / responsibility split.

- Decision: `install.sh` must not execute `bin/installdependencies.sh`.
  Rationale: that helper installs packages and would bypass Ansible.
  Date/Author: 2026-07-21 / adversarial review.

- Decision: retain the existing service semantics `KillMode=process`, `TimeoutStopSec=5min`, and `Restart=always`.
  Rationale: stopping the listener must not terminate a running `Runner.Worker`, and the service should recover from listener failure.
  Date/Author: 2026-07-21 / current contract review.

- Decision: build the runtime before stopping the runner.
  Rationale: compilation failure must not interrupt the currently working service.
  Date/Author: 2026-07-21 / review correction.

- Decision: always activate the new runtime and restart the service.
  Rationale: full runtime comparison and conditional restart add unnecessary complexity.
  Date/Author: 2026-07-21 / simplification.

- Decision: remove `/etc/agent-relay/administrator`.
  Rationale: it authorized a separate updater. The installer validates its non-root caller, source ownership, lock ownership, and sudo authority directly.
  Date/Author: 2026-07-21 / simplification.

- Decision: support ordinary additional packages through `agent_relay_extra_apt_packages`.
  Rationale: operators need an extension point without installer changes. New repositories and special configuration remain explicit role code.
  Date/Author: 2026-07-21 / operator goal and review.

- Decision: use declarative APT repository/key configuration and verified archives instead of setup scripts or `curl | shell`.
  Rationale: fresh-host provisioning should be reproducible, reviewable, and idempotent.
  Date/Author: 2026-07-21 / best-practice review.

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
- installer, updater, and Docker system tests encode the current two-script design.
- `test/installer.test.ts` and `test/update-regression.test.ts` encode the old responsibility boundary.
- current documentation describes `install.sh`, `update.sh`, WSL handling, and automated Codex login.

Fresh-host layout:

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
    runner user: github-runner
    builder user: agent-relay-builder
    runner name: gh-runner
    service: actions.runner.Divorium.gh-runner.service

These are fresh-host targets, not migration contracts.

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

Split `tasks/main.yml` only when implementation size makes separate files useful.

The role is run from an operator-controlled checkout. The target must already have SSH, Python 3, `sudo`, and one sudo-capable login. The role requires `agent_relay_admin_user` to name that existing account; it does not create or modify it.

Defaults must include at least:

    agent_relay_admin_user: ""
    agent_relay_extra_apt_packages: []
    agent_relay_node_major: 22
    agent_relay_java_major: 21
    agent_relay_go_version: "1.24.5"
    agent_relay_typescript_version: "5.8.3"
    agent_relay_codex_version: "0.144.4"

Keep required packages separate from `agent_relay_extra_apt_packages`. Install their unique union. Document that ordinary packages available from configured repositories are added through the extra list. Do not design a generic arbitrary-repository or arbitrary-shell-command interface.

The playbook must fail early unless the target is Debian 13 (`trixie`) x86-64 with systemd as PID 1.

Use declarative Ansible state:

- repository signing keys are stored in root-owned keyring files under `/etc/apt/keyrings`;
- repository definitions use explicit `signed-by` references;
- do not download and execute NodeSource, Docker, Java, or other repository setup scripts;
- downloaded archives and bootstrap binaries use pinned versions and SHA-256 checksums;
- Go installation replaces the managed version only when the configured version differs;
- Rust uses a pinned/verified bootstrap binary and configured toolchain, not an unverified pipe to shell;
- TypeScript and Codex CLI are installed at exact configured npm versions;
- commands are used only when no suitable module exists and include explicit idempotence checks.

During implementation, inspect the pinned GitHub Actions Runner `2.335.1` archive and its Debian dependency helper. Encode the required Debian 13 native libraries in Ansible. Do not invoke that helper in production.

The role declares:

- required APT repositories, keys, base packages, build tools, native runner libraries, and `agent_relay_extra_apt_packages`;
- Node.js 22, Java 21, Go `1.24.5`, Rust, TypeScript `5.8.3`, Codex CLI `0.144.4`, and Git LFS system state;
- locked `github-runner` with home `/srv/github-runner/storage/home` and shell `/bin/bash`;
- locked `agent-relay-builder` with home `/srv/github-runner/storage/build-home` and shell `/usr/sbin/nologin`;
- neither service account belongs to `sudo` or has passwordless sudo;
- `/srv/github-runner/storage/agent-relay` as an empty or existing directory owned by `agent_relay_admin_user` and its primary group;
- runner, work, home, build, and build-home directories with explicit owners and restrictive modes;
- `/var/lib/agent-relay/install.lock` as a regular non-symlink file owned by the administrator with mode `0600`;
- Docker Engine, Compose plugin, and containerd;
- Docker data root `/srv/github-runner/storage/docker/engine`;
- containerd root `/srv/github-runner/storage/docker/containerd`;
- `/etc/docker/daemon.json` and `/etc/containerd/config.toml` reflecting those roots;
- `github-runner` membership in the Docker group, accepting that Docker socket access is host-root-equivalent;
- enabled and active Docker, containerd, and Docker socket services;
- needrestart policy that does not unexpectedly restart the GitHub runner during package operations.

Do not include WSL support or preserve shell-provisioner recovery machinery. Use ordinary package, user, group, file, template, and service tasks.

The playbook must not clone/update the repository, install/extract/register the GitHub runner, request GitHub credentials, perform/validate Codex login, build `dist`, or invoke `install.sh`.

`ansible/README.md` documents the control machine, target prerequisites, inventory, variables, extra package example, manual playbook command, target checkout, manual Codex login, and subsequent `./install.sh`. No credentials are committed.

### Milestone 2: Reduce `install.sh` to runner and repository responsibilities

Remove all package/repository/toolchain installation, `installdependencies.sh`, user/group creation, protected root creation, WSL handling, Docker provisioning, Git LFS system installation, Codex login/status, and administrator trust-file logic.

At startup, acquire the installer lock and then validate before any other mutation:

- non-root execution by the source-directory owner and successful `sudo -v`;
- Debian 13 x86-64 with systemd PID 1;
- exact source path and canonical non-symlink parents;
- `/var/lib/agent-relay/install.lock` owned by the caller, regular, non-symlink, mode `0600`;
- required users, homes, shells, locked passwords, and lack of sudo;
- required directory ownership/modes and absence of unsafe symlinks;
- required commands and exact configured toolchain versions, including Codex binary availability but not authentication;
- Docker CLI, Compose plugin, daemon, socket access as `github-runner`, and exact Docker/containerd storage roots;
- trusted repository entrypoints after updater/Docker-script removal.

Missing/invalid prerequisites fail before runner extraction, registration, token prompting, service mutation, or runtime replacement. The installer does not repair host initialization.

### Milestone 3: Keep runner installation idempotent

`install.sh` must:

- accept no arguments and refuse root;
- acquire a nonblocking `flock` on `/var/lib/agent-relay/install.lock` for the complete run;
- distinguish only absent, complete, and partial/conflicting runner states;
- download and SHA-256 verify runner `2.335.1` only when binaries are absent;
- extract as `github-runner` without `installdependencies.sh`;
- reject partial/conflicting state without deletion;
- create `_work -> ../work` only when absent and validate it when present;
- prompt for the organization PAT and run registration only when `.runner` is absent;
- keep PAT and registration token memory-only, tracing-disabled, and unset immediately;
- leave default GitHub runner self-update enabled; the pinned archive is only the bootstrap version;
- copy/update top-level `runsvc.sh` from the installed runner's `bin/runsvc.sh` with mode `0755`;
- render and atomically install the root-owned systemd unit with `User=github-runner`, `WorkingDirectory=/srv/github-runner/storage/runner`, `ExecStart=/srv/github-runner/storage/runner/runsvc.sh`, `KillMode=process`, `TimeoutStopSec=5min`, `Restart=always`, and `RestartSec=5s`;
- run `systemctl daemon-reload` after installing the unit;
- protect the source checkout without following symlinks and without referencing deleted files;
- perform no Codex authentication or auth validation.

A second run with a complete registered runner does not redownload, prompt, register, or alter `.runner`. Unexpected state fails with an instruction to rebuild or deliberately remove the conflicting runner directory.

### Milestone 4: Build and activate runtime in the same installer

After preflight and runner setup, on every invocation:

1. fail if a pre-existing `dist.previous` exists; it indicates an interrupted activation requiring operator inspection rather than automatic deletion;
2. remove only validated installer-owned stale `.dist.stage.*` directories within the source root, never symlinks or mount points;
3. create a private stage adjacent to `dist`, assign it to `agent-relay-builder` mode `0700`;
4. compile `tsconfig.runtime.json` into the stage through `env -i` and the pinned TypeScript compiler;
5. require `stage/src/run-codex.js` and reject symlinks, special files, mount crossings, or paths outside the stage;
6. apply `root:root`, directory `0755`, and file `0644` to the stage;
7. only after validation, stop the listener if active;
8. wait without killing for every `Runner.Worker` owned by the numeric `github-runner` UID;
9. rename current `dist` to `dist.previous` when present;
10. rename the adjacent stage to `dist`;
11. enable and restart the service;
12. verify the service is active and a `Runner.Listener` owned by `github-runner` exists;
13. remove `dist.previous` after success.

Compilation/stage failure leaves service and active `dist` untouched.

Use a narrow cleanup trap with explicit stage/swap phases. If activation fails after replacement, stop the service, validate/remove the failed `dist`, restore `dist.previous` when present, restart/verify the previous service, and return the original activation error. On first installation, report that no prior runtime exists and leave the service failed/stopped.

This is local swap recovery only. Every successful run rebuilds and restarts; runtime comparison is out of scope. `install.sh` performs no Git synchronization, tests, Ansible, package installation, Docker provisioning, or Codex login.

### Milestone 5: Remove obsolete files

Delete:

- `update.sh`;
- `scripts/docker-host.sh`;
- `scripts/docker-host-debian.sh`;
- `scripts/docker-host-debian-core.sh`;
- `test-system/update-script.integration.sh`;
- `test-system/docker-host.repository-safe.sh`;
- `test-system/docker-conffile-recovery.integration.sh`;
- `test/update-regression.test.ts` after moving useful single-installer assertions.

Remove active updater, Docker-provisioner, WSL, administrator-trust-file, and automated Codex-login references from current scripts, package commands, tests, docs, and trusted-entrypoint lists. Completed ExecPlans remain historical.

### Milestone 6: Rebuild test coverage

Refactor `test-system/install-script.integration.sh` to simulate an initialized Debian 13 host and cover:

- complete prerequisite success and representative fail-before-mutation cases;
- no package/user/WSL/Docker/Ansible/runner-dependency-helper/Codex-login path in installer;
- absent/complete/partial runner states;
- one-time download and registration;
- no token persistence or output;
- exact `_work`, `runsvc.sh`, and systemd unit behavior;
- second-run idempotence for archive and registration;
- build before service stop;
- stage failure leaves runtime/service untouched;
- worker wait by numeric UID;
- adjacent atomic activation;
- activation rollback with previous runtime;
- first-install activation failure without fallback;
- successful cleanup;
- no Codex auth check.

Update static TypeScript tests accordingly. Remove obsolete updater/Docker/WSL/login assertions.

Update `package.json` to remove deleted scripts/tests from `check:shell` and `check:system`, retain all remaining runtime/Node/shell/toolchain/installer checks, and add no Ansible dependency or execution.

### Milestone 7: Update current documentation

After implementation acceptance, update current README, operations, and technical specification documents to describe:

- Debian 13 fresh-host target and minimal SSH/Python/sudo prerequisites;
- control-machine Ansible execution;
- extensible `agent_relay_extra_apt_packages`;
- declarative packages/toolchains/users/directories/Docker setup;
- target repository checkout after playbook execution;
- manual Codex login as a separate operator step;
- one reusable `install.sh` for first installation and later refresh;
- `git pull --ff-only && ./install.sh` for releases;
- no updater, WSL path, or shell Docker provisioner.

No workflow, public API, request/result, routing, or output contract changes are required.

## Concrete Steps

Rebase and inspect:

    git fetch origin
    git rebase origin/main
    git status --short
    git diff --name-status origin/main...HEAD
    git grep -n -e 'update\.sh' -e 'docker-host' -e 'DOCKER_PROVISIONING_ENABLED' -e 'codex login' -e 'installdependencies\.sh'

Expected final checks:

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

Do not run `ansible-playbook`, `ansible-lint`, or install Ansible for task validation.

## Validation and Acceptance

Acceptance requires:

- a documented Ansible role prepares the complete Debian 13 runner prerequisite state from the stated minimal host prerequisites;
- ordinary packages are added through `agent_relay_extra_apt_packages`;
- required runner native dependencies are encoded in Ansible after inspecting the pinned archive;
- Ansible owns repositories, packages, verified/pinned toolchains, users, secure directories, Docker, and host services;
- `install.sh` contains no host provisioning, Ansible execution, runner dependency helper, or Codex authentication;
- `install.sh` installs/registers the official runner on the prepared host;
- a second installer run does not repeat archive download or registration;
- the expected `runsvc.sh` and systemd service contract are installed;
- runtime compilation completes before shutdown;
- failed build leaves active runtime/service untouched;
- activation failure restores one previous runtime when available;
- updater and dormant Docker provisioner files are removed;
- all non-Ansible checks pass;
- final review finds no stale active updater, Docker provisioner, WSL, administrator trust-file, dependency-helper, or automated Codex-login reference.

The plan completes only when every `Progress` item is checked with code and passing evidence.

## Idempotence and Recovery

The Ansible role uses idempotent modules and guarded commands. A second playbook run should report no changes when desired state already exists, apart from package-cache/external-repository metadata behavior. Ansible execution is not tested in this task.

`install.sh` supports only absent and complete runner states; partial/conflicting state fails without destructive repair. Rebuild is the recovery path for unknown host/runner state.

The lock prevents concurrent installer runs. Existing `.runner` prevents repeat registration. Credentials remain memory-only.

Runtime build uses a fresh adjacent stage. Active `dist` is untouched until validation. A pre-existing `dist.previous` blocks the next run for operator inspection. During one activation, one prior runtime is retained and removed after success.

## Artifacts and Notes

Keep append-only.

- 2026-07-21: closed PR #47 without merge because it addressed a different design.
- 2026-07-21: reviewed current installer, updater, Docker provisioner, tests, package scripts, workflows, and current documentation.
- 2026-07-21: removed Ansible installation/execution requirements from installer responsibility.
- 2026-07-21: simplified the target to a fresh Debian host with no WSL or migration.
- 2026-07-21: removed Codex login from installer responsibility.
- 2026-07-21: added package variables, control-machine bootstrap, runner dependency boundary, adjacent staging, and swap recovery.
- 2026-07-21: narrowed support to Debian 13 and specified verified toolchain repositories/downloads, native runner dependency derivation, Docker roots, and exact service semantics.

Future evidence: final file list; grep results; Ansible variable/task review; pinned runner dependency list; installer preflight fixtures; repeated-run log; prompt/token checks; systemd contract; build-before-stop order; stage/swap/rollback cases; complete CI; independent review.

## Interfaces and Dependencies

Host initialization, run from the operator machine:

    ansible-playbook -i ansible/inventory/example.ini ansible/playbooks/host.yml

Required variable:

    agent_relay_admin_user: <existing sudo-capable target login>

Optional package extension:

    agent_relay_extra_apt_packages:
      - <additional-package>

Runner installation/refresh on target:

    ./install.sh

Manual Codex authentication:

    sudo -u github-runner -H /usr/local/bin/codex login

`install.sh` accepts no arguments and runs as the source owner, not root. It uses sudo only for bounded runner, runtime, ownership, and systemd operations.

Fresh-host paths:

- source: `/srv/github-runner/storage/agent-relay`;
- work: `/srv/github-runner/storage/work`;
- runner: `/srv/github-runner/storage/runner`;
- runner home: `/srv/github-runner/storage/home`;
- build: `/srv/github-runner/storage/build`;
- build home: `/srv/github-runner/storage/build-home`;
- Docker engine: `/srv/github-runner/storage/docker/engine`;
- containerd: `/srv/github-runner/storage/docker/containerd`;
- installer lock: `/var/lib/agent-relay/install.lock`;
- service: `actions.runner.Divorium.gh-runner.service`.

Use Bash, systemd, Git, curl, jq, TypeScript, Docker, and the official runner supplied by the prepared host. Add no runtime dependency to `install.sh`.