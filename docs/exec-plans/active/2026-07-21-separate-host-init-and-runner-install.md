# Prepare a fresh runner host with Ansible and one reusable installer

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current while work proceeds. Maintain it according to `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

The reviewed baseline is `main` commit `e9ec636e5abf383f8831fc126b99f04e2e005a3c`. Before implementation starts, rebase on current `main` and recheck every referenced file.

Codex may implement repository scripts, Ansible files, tests, and documentation. No GitHub workflow or public Agent Relay API change is required.

## Purpose / Big Picture

Prepare a fresh **Debian 13 (Trixie) x86-64 systemd host** for one Agent Relay GitHub Actions runner.

Responsibilities:

1. **Ansible initializes the host.** It installs packages and toolchains, creates users and secure directories, and configures Docker and operating-system state.
2. **`install.sh` installs and refreshes the runner.** It installs/registers the official runner when needed, configures repository-specific files and systemd, builds the Agent Relay runtime, activates it, and starts/restarts the runner.

The host may be rebuilt. There is no migration, old-layout compatibility, WSL support, host schema, general repair framework, or separate updater.

`install.sh` does not install Ansible, invoke a playbook, inspect an Ansible marker, install packages, invoke the runner dependency helper, or authenticate Codex.

Minimal target prerequisites before Ansible:

- network and SSH;
- Python 3;
- `sudo`;
- one existing sudo-capable administrator account.

Operator flow:

1. From an operator-controlled checkout with Ansible already installed:

       ansible-playbook -i ansible/inventory/example.ini ansible/playbooks/host.yml

2. Clone this repository on the prepared target as the configured administrator into `/srv/github-runner/storage/agent-relay`.
3. Authenticate Codex manually as `github-runner`; this is outside `install.sh` and installation acceptance.
4. Run:

       cd /srv/github-runner/storage/agent-relay
       ./install.sh

Later releases:

    cd /srv/github-runner/storage/agent-relay
    git pull --ff-only
    ./install.sh

Repeated installer runs are supported. Binary extraction and GitHub registration are skipped independently when already complete. Runtime build and activation execute safely on every run.

Operators can add normal host packages through Ansible variables without editing `install.sh`.

## Progress

Keep append-only. Checked implementation items require code and passing evidence. Ansible execution itself is outside automated acceptance.

- [x] (2026-07-21) Reviewed installer, updater, Docker scripts, package commands, tests, documentation, and workflows at baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- [x] (2026-07-21) Confirmed the current installer mixes host initialization, runner installation, and Codex login.
- [x] (2026-07-21) Confirmed the updater owns runtime build/service restart and its Docker path is disabled.
- [x] (2026-07-21) Confirmed a fresh-host target with no migration or WSL compatibility.
- [x] (2026-07-21) Removed Ansible installation/execution and Codex authentication from installer responsibility.
- [x] (2026-07-21) Added control-machine bootstrap order, package variables, runner dependency boundary, adjacent runtime staging, and local activation recovery.
- [x] (2026-07-21) Narrowed support to Debian 13 and defined declarative repositories, verified toolchains, Docker roots, native runner dependencies, and service semantics.
- [x] (2026-07-21) Separated runner binary and registration states, removed duplicate exact-version validation from installer, and added safe lock-file opening and bounded listener readiness.
- [ ] Rebase and revalidate before implementation.
- [ ] Add the compact `ansible/` structure.
- [ ] Move host initialization out of `install.sh` into Ansible.
- [ ] Merge runtime lifecycle into reusable `install.sh`.
- [ ] Delete updater, dormant Docker provisioner, obsolete tests, and stale active references.
- [ ] Update package scripts and focused tests.
- [ ] Run all non-Ansible checks and independently review the final diff.
- [ ] Complete retrospective and move this same plan to `completed` only after all items pass.

## Surprises & Discoveries

- Observation: `install.sh` currently provisions the host.
  Evidence: it installs packages/toolchains, creates users/directories, configures WSL, installs Git LFS, downloads/registers the runner, and performs Codex login.

- Observation: active updater behavior is small enough to merge.
  Evidence: with Docker disabled, it waits for workers, builds `dist`, applies metadata, and restores the service.

- Observation: current compilation occurs after shutdown.
  Evidence: build failure causes avoidable downtime; staging must finish before listener stop.

- Observation: the Docker shell provisioner is unreachable production code.
  Evidence: production returns before it while three scripts and dedicated tests remain.

- Observation: the playbook must run from a control checkout.
  Evidence: a fresh target cannot run repository content before checkout; target checkout follows host initialization.

- Observation: `bin/installdependencies.sh` violates the responsibility split.
  Evidence: it installs host packages. Dependencies from the pinned runner archive must be encoded in Ansible.

- Observation: runner binary state and runner registration state are independent.
  Evidence: an interrupted first run may leave complete binaries but no `.runner`; the next run must register without redownloading.

- Observation: opening an unverified lock path can follow a symlink.
  Evidence: the installer must validate path metadata before open, compare device/inode after open, then hold `flock` on that exact file description.

- Observation: exact Ansible tool versions should not be duplicated as a second complete version manifest in Bash.
  Evidence: Ansible owns installation/pinning; installer should verify required commands and compatibility needed by runtime, not independently reconcile every package version.

## Decision Log

- Decision: Ansible is the supported host initializer.
  Rationale: packages, users, directories, toolchains, Docker, and daemons are host state.
  Date/Author: 2026-07-21 / operator requirement.

- Decision: `install.sh` neither installs nor executes Ansible.
  Rationale: Ansible is an independent operator step.
  Date/Author: 2026-07-21 / operator correction.

- Decision: Codex authentication is manual only.
  Rationale: installer must neither prompt, validate, nor fail due to absent auth.
  Date/Author: 2026-07-21 / operator requirement.

- Decision: support only fresh Debian 13 x86-64 systemd hosts.
  Rationale: rebuild is allowed; WSL, migration, and distribution abstraction are unnecessary.
  Date/Author: 2026-07-21 / operator clarification.

- Decision: keep `install.sh` as the only repository operational script and delete `update.sh`.
  Rationale: one command handles initial setup and refresh after `git pull`.
  Date/Author: 2026-07-21 / operator requirement.

- Decision: Ansible creates all host prerequisites, including native runner libraries.
  Rationale: the installer must not call package-installing helpers.
  Date/Author: 2026-07-21 / responsibility split.

- Decision: installer owns runner extraction, registration, `_work`, `runsvc.sh`, source protection, systemd unit, runtime build/swap, and service activation.
  Rationale: these are runner/repository operations.
  Date/Author: 2026-07-21 / responsibility split.

- Decision: preserve `KillMode=process`, `TimeoutStopSec=5min`, `Restart=always`, and `RestartSec=5s`.
  Rationale: listener stop must not kill a running worker.
  Date/Author: 2026-07-21 / current contract review.

- Decision: build before stopping and always activate/restart after a valid build.
  Rationale: avoid build downtime and unnecessary full-tree comparison logic.
  Date/Author: 2026-07-21 / simplification.

- Decision: remove `/etc/agent-relay/administrator`.
  Rationale: source owner, secure lock, non-root execution, and sudo validation replace the updater trust file.
  Date/Author: 2026-07-21 / simplification.

- Decision: support extra normal APT packages through `agent_relay_extra_apt_packages`.
  Rationale: package extensibility should not require installer changes or expose arbitrary command/repository injection.
  Date/Author: 2026-07-21 / operator goal.

- Decision: use declarative signed APT repositories and checksum-verified downloads; never repository setup scripts or unverified pipe-to-shell installation.
  Rationale: provisioning should be reviewable and repeatable.
  Date/Author: 2026-07-21 / best-practice review.

- Decision: installer validates functional compatibility, not every exact Ansible package version.
  Rationale: avoid two drifting version manifests. Ansible remains authoritative for pinned host state.
  Date/Author: 2026-07-21 / adversarial review.

- Decision: do not execute or lint Ansible in CI for this task.
  Rationale: Ansible testing was explicitly excluded.
  Date/Author: 2026-07-21 / operator requirement.

## Outcomes & Retrospective

Active plan only. PR #47 was closed without merge. No production behavior has changed.

After implementation, record final responsibilities, removed files, package extension evidence, runner installation evidence, test results, and residual assumptions.

## Context and Orientation

Current state:

- `install.sh` performs host provisioning, runner setup, and Codex login;
- `update.sh` builds runtime and restarts the service;
- three Docker shell scripts and dedicated tests preserve disabled behavior;
- current tests/docs encode WSL, two scripts, administrator trust file, and automated login.

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

Identities/service:

    administrator: existing sudo-capable account selected by variable
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
      playbooks/host.yml
      roles/agent_relay_host/
        defaults/main.yml
        tasks/main.yml
        handlers/main.yml
        templates/

Split tasks only when size warrants it.

Control/target contract:

- playbook runs from an operator checkout;
- target already has SSH, Python 3, `sudo`, and an existing sudo-capable account;
- `agent_relay_admin_user` is required, asserted nonempty, and must identify that existing account;
- playbook uses privilege escalation and does not create/modify the administrator.

Defaults include:

    agent_relay_admin_user: ""
    agent_relay_extra_apt_packages: []
    agent_relay_node_major: 22
    agent_relay_java_major: 21
    agent_relay_go_version: "1.24.5"
    agent_relay_typescript_version: "5.8.3"
    agent_relay_codex_version: "0.144.4"

Required package lists remain internal to the role. Install the unique union with `agent_relay_extra_apt_packages`. Packages needing another repository or special configuration require explicit reviewed tasks.

Fail early unless target is Debian 13 `trixie`, x86-64, with systemd PID 1.

Provisioning practices:

- keys in root-owned `/etc/apt/keyrings`;
- explicit `signed-by` repository definitions;
- no NodeSource/Docker/Java setup scripts;
- pinned/checksummed archives/bootstrap binaries;
- Go replaced only when configured version differs;
- Rust installed with a verified bootstrap and explicitly selected toolchain;
- TypeScript/Codex CLI installed at exact configured npm versions;
- commands only when modules are insufficient, with explicit idempotence controls.

During implementation, inspect runner archive `2.335.1` and its dependency helper, record the required Debian 13 native packages in the role, and never invoke the helper in production.

The role declares:

- repositories, base/build/native-runner packages, and extra packages;
- Node 22, Java 21, Go `1.24.5`, Rust toolchain, TypeScript `5.8.3`, Codex CLI `0.144.4`, Git LFS system state;
- locked `github-runner` (`/srv/github-runner/storage/home`, `/bin/bash`) and `agent-relay-builder` (`/srv/github-runner/storage/build-home`, `/usr/sbin/nologin`);
- no sudo group/passwordless sudo for service users;
- source directory owned by administrator and primary group;
- runner/work/home/build/build-home paths with explicit owners/modes;
- secure administrator-owned mode `0600` lock file;
- Docker Engine, Compose, containerd;
- Docker root `/srv/github-runner/storage/docker/engine` and containerd root `/srv/github-runner/storage/docker/containerd` in managed configs;
- Docker group membership for runner, explicitly documenting root-equivalent trust;
- active/enabled Docker/containerd/socket services;
- needrestart policy that will not unexpectedly restart Actions runner services.

No WSL or legacy shell-provisioner recovery machinery.

The playbook does not clone/update repository, install/register runner, request GitHub credentials, perform/check Codex login, build runtime, or invoke installer.

`ansible/README.md` documents prerequisites, inventory, variables, extra package example, playbook command, target clone, manual Codex login, installer command, and credential exclusion.

### Milestone 2: Reduce `install.sh`

Remove package/repository/toolchain installation, dependency helper, user/group creation, root directory creation, WSL, Docker provisioning, Git LFS system installation, Codex auth, and administrator trust-file behavior.

Lock acquisition before other mutation:

1. verify `/var/lib/agent-relay/install.lock` with `lstat`/`stat`: regular, non-symlink, caller-owned, mode `0600`;
2. capture path device/inode;
3. open the file without truncation;
4. compare opened descriptor device/inode through `/proc/self/fd/<fd>` with captured values;
5. acquire nonblocking `flock` and keep descriptor open for the full run.

Then validate:

- non-root source owner and successful `sudo -v`;
- Debian 13 x86-64/systemd;
- exact canonical source path and safe parents;
- required user homes/shells/locked passwords/no sudo;
- path ownership/modes/no unsafe symlinks;
- required commands and functional versions needed by repository runtime (for example Node 22 and Java 21), while Ansible remains authoritative for exact package pins;
- Codex binary presence only, not auth;
- Docker CLI/Compose/daemon/socket access as runner and exact configured storage roots;
- trusted repository entrypoints after file removal.

Failure occurs before runner extraction, registration, token prompt, service mutation, or runtime swap. Installer does not repair host state.

### Milestone 3: Idempotent runner installation

Treat binaries and registration separately.

Binary states:

- absent: no runner payload markers; download/verify/extract;
- complete: required runner files, including `bin/Runner.Listener`, `bin/runsvc.sh`, and `config.sh`, are regular non-symlink executable files; reuse;
- partial/conflicting: any payload presence without a complete set; fail without deletion.

Registration states:

- absent: `.runner`, `.credentials`, and `.credentials_rsaparams` all absent; prompt/register;
- complete: all required registration files exist as regular non-symlink files owned by runner and not group/other writable; reuse;
- partial/conflicting: only some exist or metadata is unsafe; fail without registration or deletion.

Thus complete binaries plus absent registration are explicitly resumable.

Installer requirements:

- no arguments, refuse root;
- bootstrap runner `2.335.1` only when binary state absent;
- verify SHA-256 and extract as runner, no dependency helper;
- exact `_work -> ../work` creation/validation;
- PAT prompt and organization token exchange only for absent registration;
- credentials memory-only, tracing disabled, unset promptly;
- default runner self-update remains enabled; archive version is bootstrap only;
- copy/update top-level `runsvc.sh` from `bin/runsvc.sh`, mode `0755`;
- atomically install root-owned systemd unit with `User=github-runner`, runner working directory/ExecStart, `KillMode=process`, `TimeoutStopSec=5min`, `Restart=always`, `RestartSec=5s`;
- daemon-reload after unit installation;
- protect source checkout without following symlinks or referencing deleted files;
- no Codex auth behavior.

### Milestone 4: Runtime build and activation

Every run after setup:

1. fail on pre-existing `dist.previous` for operator inspection;
2. remove only validated stale `.dist.stage.*` directories contained in source root, owned by builder or root, and not links/mounts;
3. create a builder-owned mode `0700` stage adjacent to `dist`;
4. compile runtime via clean `env -i`;
5. require `src/run-codex.js`; reject symlinks, special files, mount crossings, and escape paths;
6. finalize stage root ownership and `0755` directories/`0644` files;
7. stop listener only now;
8. wait without kill for workers by numeric runner UID;
9. rename current `dist` to `dist.previous` if present;
10. rename stage to `dist`;
11. enable/restart service;
12. poll for at most 60 seconds until systemd is active and a runner-owned `Runner.Listener` exists; fail otherwise;
13. remove previous runtime after success.

Build/stage failure leaves current service/runtime untouched.

A narrow phase-aware trap handles only stage/swap cleanup. Post-swap activation failure stops service, validates/removes failed new runtime, restores previous when present, restarts/verifies it, and returns original failure. First install without previous runtime reports no fallback and leaves service stopped/failed.

Every successful run rebuilds/restarts. No Git sync, tests, Ansible, package/Docker provisioning, or Codex login.

### Milestone 5: Remove obsolete implementation

Delete:

- `update.sh`;
- all three `scripts/docker-host*.sh` files;
- updater and Docker provisioner system tests;
- `test/update-regression.test.ts` after preserving useful installer assertions.

Remove active references to updater, Docker provisioner, WSL, administrator trust file, dependency helper, and automated Codex login from scripts, package commands, tests, docs, and trusted-entrypoint lists. Completed ExecPlans remain historical.

### Milestone 6: Tests

Refactor installer integration/static tests for:

- prepared-host success and representative fail-before-mutation prerequisites;
- lock path pre-open and post-open inode validation;
- no host provisioning/dependency-helper/Codex auth path;
- binary absent/complete/partial states;
- registration absent/complete/partial states, including complete binaries plus absent registration;
- one-time archive and registration;
- token non-persistence/non-output;
- `_work`, `runsvc.sh`, and exact unit contract;
- second-run idempotence;
- build before stop;
- stage failure isolation;
- numeric-UID worker wait;
- adjacent activation and bounded listener readiness;
- activation restoration and first-install no-fallback behavior;
- successful cleanup.

Update package commands to remove deleted files/tests, retain remaining checks, and add no Ansible execution/dependency.

### Milestone 7: Documentation

After acceptance, current docs describe:

- Debian 13 target and initial SSH/Python/sudo/admin requirements;
- operator-machine Ansible execution;
- extra package variable;
- declarative host provisioning and Docker trust boundary;
- target clone after playbook;
- manual Codex login outside installer/acceptance;
- one reusable installer for initial and later refresh;
- `git pull --ff-only && ./install.sh`;
- no updater, WSL, shell Docker provisioner, or automated login.

No workflow/API/request/result/routing/output changes.

## Concrete Steps

Rebase/inspect:

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

Non-Ansible validation:

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

Do not run/install Ansible or ansible-lint for task validation.

## Validation and Acceptance

Acceptance requires:

- documented Ansible role prepares complete Debian 13 prerequisites from stated minimal host state;
- ordinary packages are added through `agent_relay_extra_apt_packages`;
- required runner native dependencies are encoded after inspecting pinned archive;
- Ansible owns repositories/packages/toolchains/users/directories/Docker/services;
- installer contains no host provisioning, dependency helper, Ansible, or Codex auth;
- installer installs runner from absent binary state and registers from absent registration state;
- complete binaries without registration resume correctly;
- complete installation skips download/registration on second run;
- exact `runsvc.sh` and unit contract installed;
- build completes before shutdown;
- failed build leaves active runtime/service untouched;
- activation restores previous runtime when available;
- updater and dormant Docker files removed;
- all non-Ansible checks pass;
- final review finds no stale updater/Docker/WSL/trust-file/dependency-helper/automated-login reference.

Plan completes only with every Progress item checked and evidenced.

## Idempotence and Recovery

Ansible uses idempotent modules/guarded commands. A matching host should produce no material changes on a second run apart from repository/cache metadata behavior. Ansible execution is not tested here.

Installer separately reconciles binary and registration absence/completeness. Partial/conflicting state fails without destructive repair. Unknown host state is rebuilt rather than migrated.

Secure lock prevents concurrent runs. Credentials remain memory-only.

Runtime uses adjacent stage; active runtime remains until validation. Pre-existing previous runtime blocks a new run. One previous runtime exists only during activation and is deleted after success.

## Artifacts and Notes

Keep append-only.

- 2026-07-21: closed PR #47 without merge.
- 2026-07-21: reviewed current installation/update/Docker/test/doc state.
- 2026-07-21: removed Ansible and Codex login from installer responsibility.
- 2026-07-21: selected fresh Debian 13, no WSL/migration.
- 2026-07-21: added package extension, verified host provisioning, dependency derivation, Docker roots, exact service semantics, adjacent stage and local restoration.
- 2026-07-21: separated binary/registration state and added lock inode validation and bounded listener readiness.

Future evidence: file list/grep; Ansible variables/tasks; runner dependency list; preflight fixtures; binary/registration state matrix; token checks; unit contract; build/swap/restore cases; CI; independent review.

## Interfaces and Dependencies

From operator machine:

    ansible-playbook -i ansible/inventory/example.ini ansible/playbooks/host.yml

Required:

    agent_relay_admin_user: <existing sudo-capable target login>

Optional packages:

    agent_relay_extra_apt_packages:
      - <additional-package>

On target:

    ./install.sh

Manual authentication:

    sudo -u github-runner -H /usr/local/bin/codex login

Installer runs as source owner, not root, and uses sudo only for bounded runner/runtime/ownership/systemd work.

Paths:

- source `/srv/github-runner/storage/agent-relay`;
- work `/srv/github-runner/storage/work`;
- runner `/srv/github-runner/storage/runner`;
- runner home `/srv/github-runner/storage/home`;
- build `/srv/github-runner/storage/build`;
- build home `/srv/github-runner/storage/build-home`;
- Docker engine `/srv/github-runner/storage/docker/engine`;
- containerd `/srv/github-runner/storage/docker/containerd`;
- lock `/var/lib/agent-relay/install.lock`;
- service `actions.runner.Divorium.gh-runner.service`.

Use Bash, systemd, Git, curl, jq, TypeScript, Docker, and official runner supplied by the initialized host. Add no runtime dependency to installer.