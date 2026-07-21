# Prepare a fresh runner host with Ansible and one reusable installer

This ExecPlan is a living implementation document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current according to `.agent/PLANS.md`. Only this file under `docs/exec-plans/active/` is the implementation instruction for this task.

The reviewed baseline is `main` commit `e9ec636e5abf383f8831fc126b99f04e2e005a3c`. Rebase on current `main` and recheck referenced files before implementation. Codex may change repository scripts, Ansible files, tests, and documentation. No GitHub workflow or public Agent Relay API change is required.

## Purpose / Big Picture

Prepare a fresh **Debian 13 (Trixie) x86-64 systemd host** for one Agent Relay GitHub Actions runner.

The boundary is simple:

1. **Ansible initializes the host.** It installs packages and toolchains, creates users and secure directories, and configures Docker and other operating-system state.
2. **`install.sh` installs and refreshes the runner.** It installs and registers the official GitHub runner when needed, installs repository-specific files and the systemd unit, builds the Agent Relay runtime, activates it, and starts or restarts the service.

The host may be rebuilt from scratch. There is no migration, old-layout compatibility, WSL support, host schema, general repair framework, or separate updater.

`install.sh` does not install Ansible, invoke a playbook, install packages, create host users or host directory roots, invoke the runner dependency helper, provision Docker, or authenticate Codex.

After implementation, an operator must be able to:

- add ordinary Debian packages through an Ansible variable and rerun the playbook;
- prepare a fresh host using the repository Ansible role;
- clone the repository on that host;
- authenticate Codex manually as `github-runner`;
- install and register the runner with `./install.sh`;
- refresh the repository runtime later with the same installer.

## Operator Flow

Minimal target state before Ansible:

- SSH and network access;
- Python 3;
- `sudo`;
- one existing sudo-capable administrator account.

The control machine must have a documented minimum supported `ansible-core` version. Use only `ansible.builtin` modules unless implementation records and adds an explicit collection dependency.

From an operator-controlled checkout:

    ansible-playbook -i ansible/inventory/example.ini ansible/playbooks/host.yml

Then clone on the target as the configured administrator:

    git clone <repository-url> /srv/github-runner/storage/agent-relay

Authenticate Codex manually before starting the runner:

    sudo -u github-runner -H /usr/local/bin/codex login

Install the runner and runtime:

    cd /srv/github-runner/storage/agent-relay
    ./install.sh

A later release must not modify the trusted checkout while a job uses files from it. The supported release procedure is:

1. stop `actions.runner.Divorium.gh-runner.service`;
2. wait until no `Runner.Worker` owned by the numeric `github-runner` UID remains;
3. when host desired state changed, run the current Ansible playbook from the operator checkout;
4. run `git pull --ff-only` as the target checkout owner;
5. run `./install.sh`.

Document exact commands and failure recovery in `docs/operations/README.md`. If pull or installation fails after listener shutdown, the operator either reruns `./install.sh` from the current checkout or explicitly restarts the previous service. Do not add another updater or deployment controller.

## Progress

Keep this section append-only. Checked implementation items require code plus passing evidence. Ansible execution and Ansible linting are outside automated acceptance.

- [x] (2026-07-21) Reviewed current installer, updater, Docker scripts, package commands, tests, documentation, and workflows at baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- [x] (2026-07-21) Confirmed the current installer mixes host initialization, runner setup, and Codex login.
- [x] (2026-07-21) Confirmed the current updater owns runtime build and service restart while its Docker path is disabled.
- [x] (2026-07-21) Selected a fresh Debian 13 host with no migration or WSL compatibility.
- [x] (2026-07-21) Removed Ansible installation/execution and Codex authentication from installer responsibility.
- [x] (2026-07-21) Added package extension, runner dependency ownership, separate binary/registration states, adjacent runtime staging, and local activation fallback.
- [x] (2026-07-21) Added listener drain before checkout mutation and explicit exact/major/channel/package-state version policy.
- [x] (2026-07-21) Removed the unused build root and added non-recursive Ansible path management and Docker package auto-start control.
- [ ] Rebase and revalidate before implementation.
- [ ] Add the compact `ansible/` structure and host role.
- [ ] Move all host initialization out of `install.sh` into Ansible.
- [ ] Merge runtime lifecycle into reusable `install.sh`.
- [ ] Delete updater, dormant Docker provisioner, obsolete tests, and stale active references.
- [ ] Update package commands, `.gitignore`, focused tests, and current documentation.
- [ ] Run all non-Ansible checks and independently review the final diff.
- [ ] Complete the retrospective and move this plan to `completed` only after all items pass.

## Surprises & Discoveries

- Observation: the current installer provisions the host.
  Evidence: it installs packages and toolchains, creates users and directories, configures WSL, installs Git LFS, downloads/registers the runner, and performs Codex login.

- Observation: active updater behavior is small enough to merge.
  Evidence: with Docker disabled, it waits for workers, builds `dist`, applies metadata, and restores the service.

- Observation: current compilation occurs after shutdown.
  Evidence: build failure causes avoidable downtime; staging must finish before listener stop.

- Observation: the Docker shell provisioner is unreachable production code.
  Evidence: production returns before it while three scripts and dedicated tests remain.

- Observation: `bin/installdependencies.sh` violates the new boundary.
  Evidence: it installs host packages. Dependencies from the pinned runner archive must be encoded in Ansible.

- Observation: runner binaries and registration are independent states.
  Evidence: an interrupted first run can leave complete binaries without `.runner`; the next run must register without downloading again.

- Observation: `git pull` can change trusted scripts while an active workflow uses them.
  Evidence: current workflows execute files directly from `/srv/github-runner/storage/agent-relay`; listener stop and worker drain must precede checkout mutation.

- Observation: recursive ownership reconciliation is unsafe and unnecessary.
  Evidence: it could change active runtime ownership or repository contents. Ansible and installer must manage directory roots and explicit files without recursively touching checkout, runner payload, homes, workspaces, or runtime trees.

- Observation: Docker packages may auto-start services before managed configuration exists.
  Evidence: package installation must suppress service auto-start, publish Docker/containerd configuration and roots, then explicitly enable/start services.

## Decision Log

- Decision: Ansible is the supported host initializer and `install.sh` never invokes it.
  Rationale: packages, users, directories, toolchains, Docker, and daemons are host state managed separately by the operator.
  Date/Author: 2026-07-21 / operator requirement.

- Decision: Codex authentication is manual only.
  Rationale: installer must neither prompt, validate, nor fail because authentication is absent.
  Date/Author: 2026-07-21 / operator requirement.

- Decision: support only fresh Debian 13 x86-64 systemd hosts.
  Rationale: rebuild is allowed; WSL, migration, and distribution abstraction are unnecessary.
  Date/Author: 2026-07-21 / operator clarification.

- Decision: keep `install.sh` as the only repository operational script and delete `update.sh`.
  Rationale: one command handles initial runner setup and runtime refresh after a safe checkout update.
  Date/Author: 2026-07-21 / operator requirement.

- Decision: ordinary extra packages use `agent_relay_extra_apt_packages`.
  Rationale: package extensibility must not require installer changes or arbitrary command execution.
  Date/Author: 2026-07-21 / operator goal.

- Decision: version policy is explicit.
  Rationale: Go, TypeScript, Codex CLI, and bootstrap runner use exact versions; Node and Java use configured major versions; Rust uses the configured `stable` channel; Docker/containerd/Compose packages use `state: present` from signed repositories.
  Date/Author: 2026-07-21 / adversarial review.

- Decision: Node uses the NodeSource signed repository configured declaratively, Java uses the Adoptium signed repository, and Docker uses Docker's signed repository.
  Rationale: the required versions are not all supplied by Debian 13, but repository setup scripts remain unnecessary.
  Date/Author: 2026-07-21 / implementation review.

- Decision: build before stopping and always activate a valid new runtime.
  Rationale: compilation failure must not interrupt the working runner and full-tree comparison is unnecessary.
  Date/Author: 2026-07-21 / simplification.

- Decision: stop and drain before changing the trusted checkout.
  Rationale: current workflows execute trusted files directly from the shared checkout.
  Date/Author: 2026-07-21 / adversarial review.

- Decision: no Ansible execution or linting is added to CI for this task.
  Rationale: Ansible testing was explicitly excluded.
  Date/Author: 2026-07-21 / operator requirement.

## Outcomes & Retrospective

The plan is active and plan-only. PR #47 was closed without merge. No production behavior has changed.

After implementation, record final responsibilities, package extension evidence, runner installation behavior, removed files, validation results, and residual manual assumptions.

## Context and Orientation

Current state:

- `install.sh` performs host provisioning, runner setup, and Codex login;
- `update.sh` builds runtime and restarts the service;
- three Docker shell scripts and dedicated tests preserve disabled behavior;
- tests and docs encode WSL, two scripts, administrator trust file, and automated login.

Fresh target paths:

    /srv/github-runner/storage/agent-relay
    /srv/github-runner/storage/work
    /srv/github-runner/storage/runner
    /srv/github-runner/storage/home
    /srv/github-runner/storage/build-home
    /srv/github-runner/storage/docker/engine
    /srv/github-runner/storage/docker/containerd
    /var/lib/agent-relay/install.lock

The old `/srv/github-runner/storage/build` directory is removed because runtime staging is adjacent to `dist`.

Identities/service:

    administrator: existing sudo-capable account selected by Ansible variable
    runner: github-runner
    builder: agent-relay-builder
    runner name: gh-runner
    service: actions.runner.Divorium.gh-runner.service

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

Split `tasks/main.yml` only when useful.

Control/target contract:

- playbook runs from an operator-controlled checkout;
- target already has SSH, Python 3, `sudo`, and an existing sudo-capable account;
- `agent_relay_admin_user` is required, asserted nonempty, exists, and matches the target checkout owner;
- playbook uses privilege escalation and does not create or modify the administrator;
- fail early unless target is Debian 13 `trixie`, x86-64, with systemd PID 1;
- `ansible/README.md` records the minimum `ansible-core` version required by the implemented modules.

Defaults:

    agent_relay_admin_user: ""
    agent_relay_extra_apt_packages: []
    agent_relay_node_major: 22
    agent_relay_java_major: 21
    agent_relay_go_version: "1.24.5"
    agent_relay_rust_toolchain: "stable"
    agent_relay_typescript_version: "5.8.3"
    agent_relay_codex_version: "0.144.4"

Required package lists remain internal. Install the unique union with `agent_relay_extra_apt_packages` through `ansible.builtin.apt`. Packages needing another repository or special configuration require explicit reviewed tasks.

Provisioning rules:

- use only `ansible.builtin` modules unless a collection is explicitly declared;
- use root-owned `/etc/apt/keyrings` and explicit `signed-by` repository definitions;
- configure NodeSource, Adoptium, and Docker repositories without setup scripts;
- install Docker, containerd, and Compose packages with `state: present`;
- suppress Docker/containerd service auto-start during package installation using the APT module's service-start policy or an equivalently bounded Ansible mechanism;
- create storage roots and publish Docker/containerd configuration before explicitly enabling and starting services;
- install exact configured Go, TypeScript, and Codex versions;
- install Rust from a checksum-verified `rustup-init` binary and select the configured `stable` toolchain;
- use checksum verification for downloaded archives/bootstrap binaries;
- use command/shell only when modules are insufficient, with explicit idempotence and `changed_when` behavior.

Inspect runner archive `2.335.1` and its dependency helper during implementation. Encode required Debian 13 native libraries in the role and never invoke the helper in production.

The role declares:

- base, build, runner-native, Docker, and extra packages;
- toolchains at roots defined by `scripts/toolchain-environment.sh`;
- locked `github-runner` at `/srv/github-runner/storage/home` with `/bin/bash`;
- locked `agent-relay-builder` at `/srv/github-runner/storage/build-home` with `/usr/sbin/nologin`;
- no sudo access for service users;
- source directory owned by administrator and primary group;
- runner/work/home/build-home roots with explicit owners and restrictive modes;
- root-owned mode `0755` `/var/lib/agent-relay` and administrator-owned mode `0600` `install.lock`;
- Docker engine and containerd roots in managed configuration;
- Docker group membership for runner, documented as root-equivalent trust;
- enabled and active containerd, Docker socket, and Docker services;
- handlers that restart containerd/Docker only when managed configuration changes;
- needrestart policy preventing unexpected Actions runner service restarts.

Directory tasks manage only the named directory entry (`recurse: false`). Rerunning Ansible after repository clone or runner installation must not change ownership or modes inside the checkout, runner payload, runner home, build home, workspace, Docker data roots, or runtime trees.

The role must not clone/update repository, install/register runner, request GitHub credentials, perform/check Codex login, build runtime, or invoke installer.

`ansible/README.md` documents prerequisites, inventory, copying the example group variables, extra packages, playbook execution, target clone, manual Codex login, installer execution, version policy, and credential exclusion.

### Milestone 2: Reduce `install.sh`

Remove package/repository/toolchain installation, dependency helper, user/group creation, host directory creation, WSL, Docker provisioning, Git LFS system installation, Codex auth, administrator trust file, and old build-root behavior.

Before mutation:

- no arguments; refuse root;
- exact canonical source path; caller owns source root;
- source root owner UID equals `install.lock` owner UID;
- acquire sudo;
- validate `/var/lib/agent-relay` root-owned, mode `0755`, regular, non-symlink, and not group/other writable;
- validate `install.lock` caller-owned, mode `0600`, regular and non-symlink; open without truncation and hold nonblocking `flock` for full run;
- validate Debian 13 x86-64/systemd;
- validate users, homes, shells, locked status, and no sudo;
- validate directory roots, ownership, modes, and no unsafe symlinks;
- validate commands and functional compatibility: Node 22, Java 21, Go, Rust, TypeScript, Codex binary presence, Git LFS, Docker CLI, Compose, daemon, socket access as runner, and configured Docker/containerd roots;
- validate all checkout entries outside `.git`, `dist`, `.dist.stage.*`, and `dist.previous` are administrator-owned and not group/other writable using physical traversal;
- separately require trusted executable/config entrypoints to be regular non-symlink files;
- reject embedded credentials in the trusted source checkout's Git remote URL.

Do not recursively chown or chmod checkout, runner, home, workspace, Docker, or runtime trees. Normalize only explicit installer-managed files.

Fail before runner extraction, registration, token prompt, service mutation, or runtime replacement. Installer does not repair host initialization.

### Milestone 3: Install/register runner idempotently

Binary states:

- absent: required payload markers absent; download/verify/extract;
- complete: required pinned-archive files are safe; reuse;
- partial/conflicting: fail without deletion.

Registration states:

- absent: all marker/credential files produced by pinned `config.sh` absent; register;
- complete: full expected set exists with safe runner ownership/modes; reuse;
- partial/conflicting: fail without deletion or registration.

Complete binaries plus absent registration are resumable. Derive and test the exact expected marker sets from pinned archive behavior.

Installer:

- downloads bootstrap runner `2.335.1` with recorded SHA-256 only when binaries absent;
- extracts as runner without `installdependencies.sh`;
- creates/validates `_work -> ../work`;
- prompts/exchanges GitHub credential only when registration absent;
- documents required permission to create organization runner registration tokens;
- keeps credentials memory-only, disables tracing, never prints, and unsets promptly;
- runs `config.sh --unattended --replace --url https://github.com/Divorium --token <token> --name gh-runner --work _work`;
- leaves default runner self-update enabled;
- refreshes top-level `runsvc.sh` from `bin/runsvc.sh`, mode `0755`;
- atomically installs root-owned unit with `After/Wants=network-online.target`, `User=github-runner`, runner `WorkingDirectory`/`ExecStart`, `KillMode=process`, `KillSignal=SIGTERM`, `TimeoutStopSec=5min`, `Restart=always`, `RestartSec=5s`, and `WantedBy=multi-user.target`;
- runs `systemctl daemon-reload` after unit installation;
- performs no Codex auth behavior.

Second complete run does not download, prompt, configure, or alter registration.

### Milestone 4: Build and activate runtime

Every run after runner setup:

1. fail on pre-existing `dist.previous` for operator inspection;
2. remove only validated stale `.dist.stage.*` directories within source root, owned by builder/root, and not links/mounts;
3. create adjacent builder-owned mode `0700` stage;
4. compile `tsconfig.runtime.json` through clean `env -i` with explicit home, locale, and `/usr/local/bin:/usr/bin:/bin` path;
5. require `stage/src/run-codex.js`; reject symlinks, special files, mount crossings, and path escape;
6. finalize stage as root with directories `0755` and regular files `0644`;
7. stop listener only after stage validation;
8. wait without killing until no runner-owned `Runner.Worker` remains;
9. rename current `dist` to `dist.previous` when present;
10. rename adjacent stage to `dist`;
11. enable/restart service;
12. poll up to 60 seconds for active systemd unit and runner-owned `Runner.Listener`;
13. remove previous runtime after success.

Build/stage failure leaves current service/runtime untouched. A narrow phase-aware trap handles stage/swap only. Post-swap activation failure stops service, validates/removes failed runtime, restores previous when present, restarts/verifies it, and returns original failure. First install without previous runtime reports no fallback and leaves service stopped/failed.

Every successful run rebuilds/restarts. No Git sync, tests, package/Docker provisioning, Ansible, or Codex login.

Add `.dist.stage.*` and `dist.previous` to `.gitignore`.

### Milestone 5: Remove obsolete implementation

Delete:

- `update.sh`;
- all `scripts/docker-host*.sh` files;
- updater/Docker provisioner system tests;
- `test/update-regression.test.ts` after preserving relevant assertions.

Remove active references to updater, Docker provisioner, WSL, administrator trust file, dependency helper, automated Codex login, and `/srv/github-runner/storage/build` from scripts, package commands, tests, current docs, and trusted-entrypoint lists. Completed ExecPlans remain historical.

### Milestone 6: Tests

Refactor installer integration/static tests for:

- prepared-host success and representative fail-before-mutation prerequisites;
- no host provisioning/dependency-helper/Codex auth path;
- binary and registration absent/complete/partial matrices;
- complete binaries without registration;
- one-time archive and registration;
- exact registration args and token non-persistence/non-output;
- `_work`, `runsvc.sh`, exact unit;
- second-run idempotence;
- source tree write-safety validation and no recursive ownership changes;
- build before stop, stage isolation, UID worker wait;
- adjacent activation, bounded readiness, fallback, first-install failure, cleanup;
- removal of old build path/files/tests;
- static consistency between Ansible toolchain roots and `scripts/toolchain-environment.sh`.

Do not execute/install/lint Ansible or add an Ansible dependency.

### Milestone 7: Documentation

After acceptance, current docs describe:

- Debian 13 and minimal pre-Ansible requirements;
- minimum control-machine `ansible-core` version;
- operator-checkout playbook execution;
- extra package variable/example;
- exact/major/channel/package-state version policy;
- target clone after initialization;
- manual Codex login;
- initial `./install.sh`;
- safe release: stop, drain, optional Ansible reconciliation, pull, installer;
- no updater, WSL, shell Docker provisioner, administrator trust file, dependency helper, old build root, or automated login;
- Docker group root-equivalent trust.

No workflow/API/request/result/routing/output changes.

## Concrete Steps

Rebase and inspect:

    git fetch origin
    git rebase origin/main
    git status --short
    git diff --name-status origin/main...HEAD

Final checks include:

    test ! -e update.sh
    test ! -e scripts/docker-host.sh
    test ! -e scripts/docker-host-debian.sh
    test ! -e scripts/docker-host-debian-core.sh
    test -f ansible/playbooks/host.yml
    test -f ansible/roles/agent_relay_host/defaults/main.yml
    test -f ansible/roles/agent_relay_host/tasks/main.yml
    ! grep -Eq 'ansible-playbook|apt-get|dpkg|useradd|DOCKER_PROVISIONING_ENABLED|codex login|installdependencies\.sh' install.sh
    grep -q 'agent_relay_extra_apt_packages' ansible/roles/agent_relay_host/defaults/main.yml

Search stale active references while excluding historical completed ExecPlans.

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

- documented role prepares complete Debian 13 prerequisite state from stated minimal host state;
- ordinary packages are added through `agent_relay_extra_apt_packages`;
- runner native dependencies are encoded from pinned archive inspection;
- Ansible owns repositories/packages/toolchains/users/directories/Docker/services and does not recursively alter installed contents;
- Docker packages cannot start services before managed configuration is installed;
- installer contains no host provisioning, dependency helper, Ansible, or Codex auth;
- installer installs binaries and registration from absent states and resumes complete binaries without registration;
- second complete run skips download/registration;
- exact registration, `runsvc.sh`, and unit contracts are installed;
- build completes before shutdown;
- failed build leaves active runtime/service untouched;
- activation restores previous runtime when available;
- safe release prevents checkout mutation during active job;
- old updater, Docker provisioner, build root, and stale active references are removed;
- all non-Ansible checks pass;
- final independent review finds no unresolved implementation decision.

Plan completes only when all Progress items are checked and evidenced.

## Idempotence and Recovery

Ansible uses idempotent modules and guarded commands. Repeating it on a matching host should make no material changes apart from normal package metadata behavior. It manages directory entries non-recursively.

Installer handles absent and complete binary/registration states separately. Partial/conflicting state fails without destructive repair. Unknown host state is rebuilt, not migrated.

Lock prevents concurrent installer runs. Credentials remain memory-only.

Runtime is built adjacent to `dist`; active runtime remains until validation. One previous runtime exists only during activation and is deleted after success. Pre-existing previous runtime blocks a new run for inspection.

## Artifacts and Notes

Keep append-only.

- 2026-07-21: closed PR #47 without merge.
- 2026-07-21: reviewed current installer/updater/Docker/tests/docs.
- 2026-07-21: removed Ansible installation and Codex login from installer responsibility.
- 2026-07-21: selected fresh Debian 13, no WSL/migration.
- 2026-07-21: added package extension, runner state separation, native dependency derivation, adjacent staging, and activation fallback.
- 2026-07-21: added safe checkout update, explicit version policy, non-recursive Ansible path management, Docker startup ordering, full source write-safety validation, exact unit contract, and removal of unused build root.

Future evidence: final file list/stale-reference search; role variables/tasks; runner dependency list; installer fixtures; binary/registration matrix; token checks; unit contract; safe release docs; build/swap/fallback tests; package scripts; CI; independent review.

## Interfaces and Dependencies

Control machine:

    ansible-playbook -i ansible/inventory/example.ini ansible/playbooks/host.yml

Required variable:

    agent_relay_admin_user: <existing sudo-capable target login>

Optional packages:

    agent_relay_extra_apt_packages:
      - <additional-package>

Target installer:

    ./install.sh

Manual authentication:

    sudo -u github-runner -H /usr/local/bin/codex login

Installer runs as source owner, not root, and uses sudo only for bounded runner/runtime/systemd operations. Use existing Bash, systemd, Git, curl, jq, TypeScript, Docker, and official runner dependencies supplied by Ansible. Add no runtime dependency to installer.