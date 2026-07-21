# Prepare a fresh runner host with Ansible and one reusable installer

This ExecPlan records the implemented separation between host initialization and runner installation.

## Purpose

Prepare a fresh Debian 13 (Trixie) x86-64 systemd host for one Agent Relay GitHub Actions runner.

The final responsibility split is:

1. **Ansible initializes host state.** It bootstraps Python 3, installs sudo, creates the human administrator and service accounts, creates their home and state directories, installs packages and toolchains, and configures Docker/containerd.
2. **`install.sh` installs and refreshes the runner.** It validates the prepared host, installs or reuses the official GitHub runner and registration, installs the systemd unit, builds Agent Relay into a validated stage, atomically replaces `dist`, and starts or restarts the runner service.

`install.sh` does not install or invoke Ansible, install packages, create users or home directories, provision Docker, invoke `installdependencies.sh`, or authenticate Codex.

## Operator flow

A fresh target initially requires:

- Debian 13 x86-64 with systemd;
- network access;
- root SSH access.

From the operator checkout:

    cd ansible
    cp inventory/group_vars/all.yml.example inventory/group_vars/all.yml
    # configure the inventory and public SSH keys
    ansible-playbook -i inventory/example.ini playbooks/host.yml

Then connect using the administrator created by Ansible:

    git clone <repository-url> /srv/github-runner/storage/agent-relay
    sudo -u github-runner -H /usr/local/bin/codex login
    cd /srv/github-runner/storage/agent-relay
    ./install.sh

For a later release, stop the listener, wait for the current `Runner.Worker`, optionally reconcile host state with Ansible, run `git pull --ff-only`, and rerun `./install.sh`.

## Progress

- [x] Reviewed the original installer, updater, Docker provisioner, tests, package scripts and documentation.
- [x] Restricted the supported host to fresh Debian 13 x86-64 with systemd.
- [x] Added the standalone `ansible/` structure and `agent_relay_host` role.
- [x] Added Python bootstrap before Ansible fact gathering.
- [x] Moved package, repository, toolchain, user, home-directory, filesystem and Docker initialization to Ansible.
- [x] Added the configurable `agent_relay_extra_apt_packages` extension point.
- [x] Added explicit removal of packages conflicting with Docker Engine.
- [x] Created the administrator with configured public keys and passwordless sudo.
- [x] Created `github-runner` and `agent-relay-builder` accounts without home creation in the user task; their home directories are created separately by Ansible filesystem tasks.
- [x] Reduced `install.sh` to prepared-host validation, runner installation/registration, runtime activation and service management.
- [x] Removed automated Codex authentication; login is manual.
- [x] Removed `update.sh` and merged its necessary runtime activation into `install.sh`.
- [x] Removed the dormant shell Docker provisioner and obsolete tests.
- [x] Added independent runner-binary and registration state handling.
- [x] Added post-extraction and post-registration validation.
- [x] Protected `.runner`, `.credentials` and `.credentials_rsaparams` as runner-owned mode `0600` files.
- [x] Added exact runner, Go, TypeScript and Codex version checks; Node and Java major checks; Rust stable-channel validation.
- [x] Added staged runtime compilation and module-import smoke before listener shutdown.
- [x] Added filesystem-bounded runtime validation and interrupted-swap recovery.
- [x] Updated package scripts, current documentation and focused tests.
- [x] Completed an independent adversarial review and applied the findings.
- [x] Ran all available changed-file validation without installing or executing Ansible.
- [ ] Move this ExecPlan to `completed/` after the PR is accepted.

## Implemented Ansible contract

The role:

- uses only `ansible.builtin` modules;
- preserves SSH host-key checking;
- bootstraps `python3` and `python3-apt` through one guarded raw task;
- installs sudo and creates the operational administrator;
- installs configured SSH public keys and validates the sudoers file with `visudo`;
- installs base, build, runner-native and configurable extra packages;
- configures signed NodeSource, Adoptium and Docker repositories without setup scripts;
- installs Docker Engine, containerd, Buildx and Compose with `state: present`;
- blocks premature Docker/containerd service startup during package installation;
- writes Docker/containerd configuration before explicitly starting services;
- installs exact Go, TypeScript and Codex versions;
- installs the configured Rust stable channel from checksum-verified `rustup-init`;
- creates named paths only and does not recursively alter checkout, runner, workspace, home, runtime or Docker data contents;
- never clones the repository, installs/registers the runner, invokes `install.sh`, or performs Codex login.

## Implemented installer contract

`install.sh`:

- accepts no arguments and refuses root execution;
- requires the exact administrator-owned checkout path;
- verifies Python 3 and noninteractive administrator sudo;
- validates Debian 13, systemd, accounts, locked passwords, homes, named directories, modes, toolchains and Docker state;
- validates checkout ownership and rejects group/other-writable trusted input;
- rejects HTTP(S) Git remotes containing user information;
- acquires a nonblocking installation lock;
- downloads and SHA-256 verifies runner `2.335.1` only when the payload is absent;
- never invokes the runner dependency helper;
- resumes complete runner binaries with absent registration;
- requests a GitHub credential only when registration is absent and never persists it;
- verifies extraction and registration results before continuing;
- reuses complete registration without prompting;
- installs the root-owned systemd unit;
- builds into an adjacent builder-owned stage;
- dynamically imports the staged runtime before stopping the listener;
- waits for a numeric-UID-owned `Runner.Worker` without killing it;
- atomically replaces `dist` and restores the previous tree only when the second filesystem rename fails;
- treats listener readiness as runner readiness, not Agent Relay runtime validation;
- performs no Git synchronization, Ansible execution, package installation, user creation, Docker provisioning or Codex login.

## Removed implementation

Deleted:

- `update.sh`;
- `scripts/docker-host.sh`;
- `scripts/docker-host-debian.sh`;
- `scripts/docker-host-debian-core.sh`;
- updater and Docker-provisioner system tests;
- `test/update-regression.test.ts`.

Current documentation and package scripts no longer reference the removed operational model. Historical completed ExecPlans remain unchanged.

## Validation evidence

Executed locally against the final changed-file snapshot:

    bash -n install.sh test-system/install-script.integration.sh

Result: passed.

Parsed every Ansible YAML file with PyYAML and read every Jinja template.

Result: passed. This verifies syntax-level parseability only; the user explicitly excluded Ansible execution and Ansible linting.

Compiled the focused TypeScript contract test with TypeScript 5.8.3 and executed:

    node --test dist/test/installer.test.js

Result: 5 tests passed, 0 failed.

Executed:

    bash test-system/install-script.integration.sh

Result: `install.sh and Ansible contract checks passed`.

GitHub Actions is not acceptance evidence for this change because the repository currently has no available self-hosted runner. No CI result is claimed.

## Decisions

- Ansible is the only host initializer.
- Service-account and home-directory creation belongs to Ansible, not `install.sh`.
- `install.sh` validates host state but does not repair or provision it.
- Codex login is manual.
- The host may be rebuilt; no migration or WSL compatibility is implemented.
- Additional ordinary packages are configured through `agent_relay_extra_apt_packages`.
- Docker group membership is treated as root-equivalent host trust.
- Runner self-update remains enabled.
- No workflow or public Agent Relay API change is part of this task.

## Outcomes

The repository now contains a complete implementation for preparing a fresh runner host with Ansible and installing or refreshing the runner with one reusable `install.sh`.

The remaining operator-only activities are supplying inventory/public keys, executing the playbook on a fresh Debian 13 host, manually authenticating Codex, and supplying a GitHub credential during first runner registration.
