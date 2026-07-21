# Prepare a fresh runner host with Ansible and one reusable installer

This ExecPlan is the implementation instruction for this task. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current according to `.agent/PLANS.md`.

The reviewed baseline is `main` commit `e9ec636e5abf383f8831fc126b99f04e2e005a3c`. Rebase on current `main` and recheck referenced files before implementation. Codex may change repository scripts, Ansible files, tests, and documentation. No GitHub workflow or public Agent Relay API change is required.

## Purpose / Big Picture

Prepare a fresh **Debian 13 (Trixie) x86-64 systemd host** for one Agent Relay GitHub Actions runner.

Responsibilities:

1. **Ansible initializes the host.** It bootstraps Python 3, installs sudo, packages and toolchains, creates the human administrator and service users, creates secure directories, and configures Docker and operating-system services.
2. **`install.sh` installs and refreshes the runner.** It validates the prepared host, installs and registers the official GitHub runner when needed, installs repository-specific files and the systemd unit, builds Agent Relay, atomically replaces `dist`, and starts or restarts the runner service.

The host may be rebuilt. There is no migration, WSL support, compatibility mode, host schema, general repair framework, or separate updater.

`install.sh` does not install Ansible, invoke a playbook, install packages, create host users or host directory roots, invoke the runner dependency helper, provision Docker, or authenticate Codex.

After implementation an operator can:

- add ordinary Debian packages through an Ansible variable;
- prepare a fresh host with the repository role;
- connect using the administrator created by Ansible;
- clone the repository;
- authenticate Codex manually as `github-runner`;
- install and register the runner with `./install.sh`;
- refresh Agent Relay later with the same installer.

## Operator Flow

Minimal target state before Ansible:

- Debian 13 x86-64 with network access;
- SSH access as `root`.

Neither Python 3, sudo, nor an administrator account is a precondition. The playbook bootstraps Python 3, installs sudo, and creates the administrator.

The control machine has the minimum `ansible-core` version documented by the implementation. Use only `ansible.builtin` modules unless an explicit collection dependency is added.

Run Ansible from its directory so its configuration, role path, inventory, and group variables resolve correctly:

    cd ansible
    ansible-playbook -i inventory/example.ini playbooks/host.yml

The example inventory uses the root bootstrap connection. Credentials and private keys are not committed.

After the playbook, connect as the configured administrator and clone the repository:

    git clone <repository-url> /srv/github-runner/storage/agent-relay

Authenticate Codex manually before starting the runner:

    sudo -u github-runner -H /usr/local/bin/codex login

Install the runner and runtime:

    cd /srv/github-runner/storage/agent-relay
    ./install.sh

A release must not change the trusted checkout while a workflow uses it. The supported release procedure is:

1. stop `actions.runner.Divorium.gh-runner.service`;
2. wait until no `Runner.Worker` owned by the numeric `github-runner` UID remains;
3. if host desired state changed, run the current Ansible playbook from the operator checkout;
4. run `git pull --ff-only` as the target checkout owner;
5. run `./install.sh`.

Document exact commands and failure recovery in `docs/operations/README.md`. Do not add another updater or deployment controller.

## Progress

Keep append-only. Checked implementation items require code plus passing evidence. Ansible execution and Ansible linting are outside automated acceptance.

- [x] (2026-07-21) Reviewed current installer, updater, Docker scripts, package commands, tests, documentation, and workflows at baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- [x] (2026-07-21) Selected fresh Debian 13 with no migration or WSL compatibility.
- [x] (2026-07-21) Removed Ansible installation/execution and Codex authentication from installer responsibility.
- [x] (2026-07-21) Added package extension, separate runner binary/registration states, native dependency ownership, adjacent runtime staging, and safe checkout update.
- [x] (2026-07-21) Added explicit version policy, non-recursive path management, Docker startup ordering, and removal of the unused build root.
- [x] (2026-07-21) Removed false service-based runtime rollback; listener status is not runtime validation.
- [x] (2026-07-21) Corrected bootstrap contract: Ansible connects as root, bootstraps Python 3 and sudo, and creates the sudo-capable administrator; `install.sh` verifies Python 3 and administrator privilege.
- [ ] Rebase and revalidate before implementation.
- [ ] Add the `ansible/` structure and host role.
- [ ] Move host initialization from `install.sh` into Ansible.
- [ ] Merge runtime build and activation into reusable `install.sh`.
- [ ] Delete updater, dormant Docker provisioner, obsolete tests, and stale active references.
- [ ] Update package commands, `.gitignore`, focused tests, and current documentation.
- [ ] Run all non-Ansible checks and independently review the final diff.
- [ ] Complete retrospective and move this plan to `completed` only after all items pass.

## Surprises & Discoveries

- The current installer provisions packages, toolchains, users, directories, WSL, Git LFS, the runner, and Codex authentication. Host initialization must move to Ansible.
- `bin/installdependencies.sh` installs host packages and therefore must not be called by `install.sh`; its Debian 13 dependencies belong in Ansible.
- Runner binaries and registration are independent states. Complete binaries without `.runner` must resume registration without another download.
- `git pull` can change trusted scripts while an active workflow is using them. Stop and drain before checkout mutation.
- Recursive ownership reconciliation can damage the checkout, installed runner, runtime, workspace, or Docker data. Manage named paths only.
- Docker packages may start daemons before managed configuration exists. Suppress package auto-start, publish configuration, then start services explicitly.
- Runner service readiness does not validate Agent Relay `dist`; the listener loads only the GitHub runner.
- A fresh Ansible target may not have Python. The playbook must bootstrap `/usr/bin/python3` before fact gathering and normal module execution.

## Decision Log

- Ansible is the only supported host initializer; `install.sh` never installs or invokes it.
- Codex authentication is manual and is neither checked nor performed by `install.sh`.
- The target is Debian 13 x86-64 with systemd. WSL and migration compatibility are excluded.
- Root SSH is the bootstrap access for Ansible. Python 3, sudo, and the operational administrator are produced by the playbook.
- Ansible creates a configurable administrator with SSH authorized keys and passwordless sudo. This is a trusted full-host administrator account.
- Ordinary extra packages use `agent_relay_extra_apt_packages`.
- Go, TypeScript, Codex CLI, and bootstrap runner use exact versions; Node and Java use configured major versions; Rust uses `stable`; Docker/containerd/Compose use `state: present` from signed repositories.
- `install.sh` is the only repository operational script. `update.sh` is deleted.
- Runtime is built and import-tested before listener shutdown.
- `dist.previous` is temporary filesystem-swap state only. Listener failure does not trigger runtime rollback.
- Ansible execution and linting are not added to repository CI for this task.

## Context and Orientation

Current state:

- `install.sh` performs host provisioning, runner setup, and Codex login;
- `update.sh` builds runtime and restarts the service;
- `scripts/docker-host.sh`, `scripts/docker-host-debian.sh`, and `scripts/docker-host-debian-core.sh` preserve disabled Docker provisioning;
- tests and documentation encode WSL, two operational scripts, the administrator trust file, and automated Codex login.

Fresh target paths:

    /srv/github-runner/storage/agent-relay
    /srv/github-runner/storage/work
    /srv/github-runner/storage/runner
    /srv/github-runner/storage/home
    /srv/github-runner/storage/build-home
    /srv/github-runner/storage/docker/engine
    /srv/github-runner/storage/docker/containerd
    /var/lib/agent-relay/install.lock

The old `/srv/github-runner/storage/build` path is removed because runtime staging is adjacent to `dist`.

Identities and service:

    administrator: configurable human account created by Ansible
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

`ansible/ansible.cfg` sets `roles_path` for the documented `cd ansible` invocation. Do not disable SSH host-key checking. Split `tasks/main.yml` only when useful.

Bootstrap sequence:

1. `playbooks/host.yml` starts with `gather_facts: false`.
2. Use a bounded `ansible.builtin.raw` task to install `python3` through APT only when `/usr/bin/python3` is absent.
3. Run `ansible.builtin.setup` after Python is available.
4. Assert Debian 13 `trixie`, x86-64, and systemd PID 1.
5. Apply the role as root.

Required variables:

    agent_relay_admin_user: "agent-relay-admin"
    agent_relay_admin_authorized_keys: []
    agent_relay_extra_apt_packages: []
    agent_relay_node_major: 22
    agent_relay_java_major: 21
    agent_relay_go_version: "1.24.5"
    agent_relay_rust_toolchain: "stable"
    agent_relay_typescript_version: "5.8.3"
    agent_relay_codex_version: "0.144.4"

Assert that the administrator name is valid and the authorized-key list is nonempty. Public keys may be provided in inventory variables; no private key, password, token, or vault secret is committed.

The role creates the administrator:

- normal login user with `/bin/bash` and a home directory;
- locked password;
- mode `0700` `.ssh` and mode `0600` `authorized_keys` rendered from the configured public-key list;
- membership in the `sudo` group;
- root-owned `/etc/sudoers.d/agent-relay-admin` mode `0440` granting passwordless sudo;
- validation through `visudo -cf` before the sudoers file is installed.

The role also declares:

- Python 3, sudo, base/build/runner-native packages, Git LFS, and extra packages;
- NodeSource, Adoptium, and Docker signed APT repositories without setup scripts;
- Docker/containerd/Compose with `state: present`;
- exact Go, TypeScript, and Codex versions;
- Rust from checksum-verified `rustup-init` with the `stable` toolchain;
- locked `github-runner` at `/srv/github-runner/storage/home`, shell `/bin/bash`;
- locked `agent-relay-builder` at `/srv/github-runner/storage/build-home`, shell `/usr/sbin/nologin`;
- no sudo access for service users;
- source root administrator-owned mode `0755`;
- runner, work, and runner home runner-owned mode `0700`;
- build home builder-owned mode `0700`;
- root-owned mode `0755` `/var/lib/agent-relay` and administrator-owned mode `0600` `install.lock`;
- Docker engine and containerd roots/configuration;
- Docker group membership for runner, documented as root-equivalent trust;
- ordered containerd-then-Docker handlers;
- needrestart policy preventing unexpected Actions runner restarts.

Inspect runner archive `2.335.1` and its dependency helper during implementation. Encode required Debian 13 native libraries in the role and never invoke the helper in production.

Suppress Docker/containerd auto-start during package installation with a temporary bounded policy. Always remove the temporary policy. Create data roots and configuration before explicitly enabling and starting services.

Directory tasks manage named entries only with no recursive ownership changes. Rerunning Ansible after installation must not modify checkout contents, runner payload, homes, workspace, Docker data, or runtime trees.

The role must not clone or update the repository, install or register the GitHub runner, request GitHub credentials, perform or check Codex login, build runtime, or invoke `install.sh`.

### Milestone 2: Reduce `install.sh` to runner responsibilities

Remove package/repository/toolchain installation, runner dependency helper execution, user/group creation, host directory creation, WSL, Docker provisioning, Git LFS installation, Codex authentication, administrator trust file, and old build-root behavior.

Before mutation, `install.sh` must:

- accept no arguments and refuse root execution;
- require invocation by `agent_relay_admin_user` and ownership of the exact canonical source root;
- verify `python3` exists and can execute a trivial command;
- verify `sudo` exists and `sudo -n true` succeeds for the administrator created by Ansible;
- validate `/var/lib/agent-relay` and `install.lock`, then hold a nonblocking `flock` for the full invocation;
- validate Debian 13 x86-64 and systemd;
- validate runner and builder users, homes, shells, locked status, and lack of sudo;
- validate required named directories, ownership, modes, and no unsafe symlinks;
- validate Node 22, Java 21, Go, Rust, TypeScript, Codex binary presence, Git LFS, Docker CLI, Compose, daemon, socket access as runner, and configured Docker/containerd roots;
- validate checkout write safety without recursively changing ownership;
- require trusted entrypoints/configuration to be administrator-owned regular non-symlink files;
- reject embedded credentials in the source Git remote URL;
- validate an existing `dist` as a root-owned safe regular-file tree.

Failure occurs before runner extraction, registration, token prompting, unit changes, service changes, or runtime replacement. The installer does not repair host initialization.

### Milestone 3: Install and register the runner idempotently

Binary states:

- **absent:** required payload markers are absent; download, verify, and extract;
- **complete:** required runner files are safe; reuse and tolerate safe runner-generated diagnostics/self-update state;
- **partial/conflicting:** fail without deletion.

Registration states:

- **absent:** all marker/credential files produced by pinned `config.sh` are absent; register;
- **complete:** the full expected marker set exists with safe runner ownership/modes; reuse;
- **partial/conflicting:** fail without deletion or registration.

Complete binaries plus absent registration are resumable. Derive and test expected marker sets from pinned archive behavior; do not require exact directory equality with the original archive.

Installer behavior:

- download bootstrap runner `2.335.1` with recorded SHA-256 only when binaries are absent;
- extract as `github-runner` without `installdependencies.sh`;
- create or validate `_work -> ../work`;
- prompt for a GitHub credential and exchange it for a short-lived organization runner registration token only when registration is absent;
- keep credentials memory-only, disable tracing, never print them, and unset them promptly;
- run `config.sh --unattended --replace --url https://github.com/Divorium --token <token> --name gh-runner --work _work`;
- leave default runner self-update enabled;
- refresh top-level `runsvc.sh` from `bin/runsvc.sh`, mode `0755`;
- atomically install a root-owned systemd unit with separate `After=network-online.target` and `Wants=network-online.target`, `User=github-runner`, runner `WorkingDirectory` and `ExecStart`, `KillMode=process`, `KillSignal=SIGTERM`, `TimeoutStopSec=5min`, `Restart=always`, `RestartSec=5s`, and `WantedBy=multi-user.target`;
- run `systemctl daemon-reload` after unit installation;
- perform no Codex authentication behavior.

A second complete run does not download, prompt, run `config.sh`, or alter registration.

### Milestone 4: Build and activate runtime

Every run after runner setup:

1. fail on pre-existing `dist.previous` for operator inspection;
2. remove only validated stale `.dist.stage.*` directories within the source root, owned by builder or root, and not links or mount points;
3. create an adjacent builder-owned mode `0700` stage;
4. compile `tsconfig.runtime.json` as `agent-relay-builder` through clean `env -i` with explicit build home, identity, locale, and `/usr/local/bin:/usr/bin:/bin`;
5. require `stage/src/run-codex.js`; reject symlinks, special files, mount crossings, and path escape;
6. as `agent-relay-builder` in the same clean environment, dynamically import staged `src/run-codex.js` without calling `main`;
7. finalize stage as root with directories `0755` and regular files `0644`;
8. stop the listener only after stage validation;
9. wait without killing until no runner-owned `Runner.Worker` remains;
10. rename current `dist` to `dist.previous` when present;
11. rename adjacent stage to `dist`;
12. if the second rename fails, restore `dist.previous` immediately and return failure;
13. after successful swap and validation of new `dist`, remove `dist.previous`;
14. enable or restart the service;
15. poll up to 60 seconds for the active unit and runner-owned `Runner.Listener`.

Build, import, or stage failure leaves the current service and runtime untouched. Listener startup failure is reported without runtime rollback because the listener does not load Agent Relay runtime.

Add `.dist.stage.*` and `dist.previous` to `.gitignore`. Document interrupted-swap recovery.

### Milestone 5: Remove obsolete implementation

Delete:

- `update.sh`;
- all `scripts/docker-host*.sh` files;
- updater and Docker-provisioner system tests;
- `test/update-regression.test.ts` after preserving relevant assertions.

Remove active references to updater, Docker provisioner, WSL, administrator trust file, dependency helper, automated Codex login, and `/srv/github-runner/storage/build` from scripts, package commands, tests, current docs, and trusted-entrypoint lists. Completed ExecPlans remain historical.

### Milestone 6: Tests

Refactor installer integration and static tests for:

- prepared-host success and fail-before-mutation prerequisites;
- Python 3 and noninteractive sudo validation;
- no host provisioning, dependency-helper, Ansible, or Codex-auth path;
- binary and registration absent/complete/partial matrices;
- complete binaries without registration;
- one-time archive download and registration;
- exact registration arguments and token non-persistence/output;
- `_work`, `runsvc.sh`, and exact systemd unit;
- second-run idempotence;
- checkout write safety and no recursive ownership changes;
- builder-owned build and module-import smoke before stop;
- stage isolation and numeric-UID worker wait;
- adjacent swap, second-rename restoration, bounded listener readiness, and interrupted-swap handling;
- removal of old build path/files/tests;
- static consistency between Ansible toolchain roots and `scripts/toolchain-environment.sh`;
- static checks that Ansible creates the administrator, authorized keys, sudoers file, Python 3, and sudo.

Do not execute or install Ansible, run `ansible-lint`, or add an Ansible dependency.

### Milestone 7: Documentation

Update current documentation to describe:

- Debian 13 and root SSH bootstrap requirement;
- Ansible bootstrap of Python 3 and sudo;
- administrator creation, public-key configuration, and passwordless-sudo trust;
- minimum `ansible-core` version;
- `cd ansible` execution and preserved SSH host-key checking;
- extra package variable and example;
- target clone after initialization;
- manual Codex login;
- initial `./install.sh`;
- safe release: stop, drain, optional Ansible reconciliation, pull, installer;
- interrupted runtime-swap recovery;
- no updater, WSL, shell Docker provisioner, trust file, dependency helper, old build root, automated login, or service-based runtime rollback;
- Docker group access as root-equivalent trust.

No workflow, API, request/result contract, routing, or output changes.

## Validation and Acceptance

Acceptance requires:

- the documented role bootstraps Python 3 on a root-accessible fresh Debian 13 host;
- the role installs sudo and creates the configured administrator with authorized keys and working passwordless sudo;
- ordinary packages are added through `agent_relay_extra_apt_packages`;
- runner native dependencies are encoded from pinned archive inspection;
- Ansible owns repositories, packages, toolchains, users, directories, Docker, and services without recursive changes to installed contents;
- Docker packages cannot start services before managed configuration is installed;
- `install.sh` verifies Python 3 and the created administrator's sudo capability;
- `install.sh` contains no host provisioning, dependency helper, Ansible execution, or Codex authentication;
- installer installs binaries and registration from absent states and resumes complete binaries without registration;
- a complete second run skips download and registration;
- staged runtime builds and imports as builder before listener shutdown;
- failed build/import leaves the active runtime and service untouched;
- incomplete filesystem swap restores the previous runtime immediately;
- listener failure is not represented as runtime validation or rollback;
- safe release prevents checkout mutation during an active job;
- old updater, Docker provisioner, build root, and stale active references are removed;
- all non-Ansible repository checks pass;
- final independent review finds no unresolved implementation decision.

## Idempotence and Recovery

The Ansible role uses idempotent modules and guarded commands. A matching host should produce no material changes on a second run apart from normal package metadata refresh.

`install.sh` separately handles absent and complete binary and registration states. Partial or conflicting state fails without destructive repair.

Runtime build uses an adjacent stage. Active `dist` is unchanged until build and import validation succeed. `dist.previous` exists only during the filesystem swap or after an interrupted swap and requires documented operator recovery.

## Outcomes & Retrospective

The plan is active and plan-only. PR #47 was closed without merge. No production behavior has changed.

After implementation, record final responsibilities, package extension evidence, administrator/bootstrap behavior, runner installation behavior, removed files, validation results, and residual manual assumptions.
