# Prepare a fresh runner host with Ansible and one reusable installer

This ExecPlan records the implemented separation between host initialization and runner installation.

## Purpose

Prepare a fresh Debian 13 (Trixie) x86-64 systemd host for one Agent Relay GitHub Actions runner.

The final responsibility split is:

1. **Ansible initializes host state.** It bootstraps Python 3, installs sudo, creates the administrator and service accounts, creates their home and state directories, installs packages and toolchains, and configures Docker/containerd.
2. **`install.sh` installs and refreshes the runner.** It validates the prepared host, installs or reuses the official GitHub runner and registration, installs the systemd unit, builds Agent Relay into a validated stage, atomically replaces `dist`, and starts or restarts the runner service.

`install.sh` does not install or invoke Ansible, install packages, create users or home directories, provision Docker, invoke `installdependencies.sh`, or authenticate Codex.

## Operator flow

A fresh target initially requires Debian 13 x86-64 with systemd, network access and root SSH.

From the operator checkout:

    cd ansible
    cp inventory/group_vars/all.yml.example inventory/group_vars/all.yml
    ansible-playbook -i inventory/example.ini playbooks/host.yml

Then connect using the administrator created by Ansible, clone the repository, authenticate Codex manually as `github-runner`, and run `./install.sh`.

For a later release, stop the listener, wait for the current `Runner.Worker`, optionally reconcile host state with Ansible, run `git pull --ff-only`, and rerun `./install.sh`.

## Progress

- [x] Reviewed the original installer, updater, Docker provisioner, tests, package scripts and documentation.
- [x] Restricted the supported host to fresh Debian 13 x86-64 with systemd.
- [x] Added the standalone `ansible/` structure and `agent_relay_host` role.
- [x] Added Python bootstrap before Ansible fact gathering.
- [x] Moved package, repository, toolchain, user, filesystem and Docker initialization to Ansible.
- [x] Added `agent_relay_extra_apt_packages`.
- [x] Created the administrator with configured public keys and passwordless sudo.
- [x] Kept service-account and home-directory creation entirely in Ansible.
- [x] Reduced `install.sh` to prepared-host validation, runner installation/registration, runtime activation and service management.
- [x] Removed automated Codex authentication; login is manual.
- [x] Removed `update.sh`, the dormant Docker shell provisioner and obsolete tests.
- [x] Added independent runner-binary and registration state handling.
- [x] Added staged runtime compilation and module-import smoke before listener shutdown.
- [x] Added filesystem-bounded runtime activation and interrupted-swap recovery.
- [x] Added `config/runner-host.json` as the single source for runner, host and toolchain constants.
- [x] Added one shared host-toolchain validator used by the installer and toolchain smoke.
- [x] Removed duplicate bootstrap packages, `apt-transport-https`, duplicate container handlers and the unused default inventory.
- [x] Reduced builder state to the temporary directory required by the build.
- [x] Reduced root and Ansible README duplication; operations remains the procedure authority.
- [x] Replaced the source-matching installer system test with behavioral execution of `install.sh`.
- [x] Preserved the accepted registration behavior: `--replace`, current registration-state checks and current binary completeness checks.
- [x] Completed an independent adversarial review and applied the accepted findings.
- [ ] Move this ExecPlan to `completed/` after the PR is accepted.

## Implemented Ansible contract

The role:

- uses only `ansible.builtin` modules;
- preserves SSH host-key checking;
- bootstraps `python3` and `python3-apt` through one guarded raw task;
- installs sudo and creates the operational administrator;
- installs base, build, runner-native and configurable extra packages;
- loads fixed host and toolchain constants from `config/runner-host.json`;
- configures signed NodeSource, Adoptium and Docker repositories;
- installs Docker Engine, containerd, Buildx and Compose with `state: present`;
- prevents premature Docker/containerd startup and then starts or restarts each service once in order;
- creates named paths only and does not recursively alter installed contents;
- never clones the repository, installs/registers the runner, invokes `install.sh`, or performs Codex login.

## Implemented installer contract

`install.sh`:

- loads runner, toolchain and path constants from `config/runner-host.json`;
- accepts no arguments and refuses root execution;
- verifies Python 3 and noninteractive administrator sudo;
- validates the host, accounts, named directories, Docker and checkout ownership;
- delegates toolchain validation to `scripts/host-toolchain-check.sh`;
- downloads and verifies runner `2.335.1` only when binaries are absent;
- resumes complete runner binaries with absent registration;
- requests a GitHub credential only when registration is absent;
- preserves the accepted `--replace` registration behavior;
- installs the root-owned systemd unit;
- builds with a minimal builder environment using only its home, temporary directory and toolchain path;
- imports the staged runtime before listener shutdown;
- waits for a numeric-UID-owned `Runner.Worker` without killing it;
- atomically replaces `dist` and restores the previous tree when activation rename fails;
- performs no Git synchronization, Ansible execution, package installation, user creation, Docker provisioning or Codex login.

## Behavioral test coverage

`test-system/install-script.integration.sh` executes a transformed copy of the real installer against mocked host commands. It verifies:

- first runner download, registration, runtime build and service activation;
- a second invocation without another download, prompt or registration;
- build failure before listener shutdown;
- restoration of the previous runtime when activation rename fails;
- complete binaries with absent registration resume without another runner download.

Static TypeScript tests verify responsibility boundaries, shared configuration, runtime ordering and removed duplication.

## Validation evidence

Executed locally without Codex or a self-hosted runner:

- shell syntax validation: passed;
- `config/runner-host.json` parsing: passed;
- all changed Ansible YAML parsing with PyYAML: passed;
- focused TypeScript compilation and five installer tests: passed;
- behavioral installer integration test: passed.

Ansible execution and Ansible linting remain intentionally outside this task. No GitHub Actions result is claimed because no self-hosted runner is available.

## Decisions

- Ansible is the only host initializer.
- Service-account and home-directory creation belongs to Ansible, not `install.sh`.
- `install.sh` validates host state but does not repair or provision it.
- Codex login is manual.
- The host may be rebuilt; no migration or WSL compatibility is implemented.
- Additional ordinary packages are configured through `agent_relay_extra_apt_packages`.
- Fixed runner, host and toolchain constants live in `config/runner-host.json`.
- Docker group membership is treated as root-equivalent host trust.
- Runner self-update remains enabled.
- No workflow or public Agent Relay API change is part of this task.

## Outcomes

The repository contains a complete implementation for preparing a fresh runner host with Ansible and installing or refreshing the runner with one reusable `install.sh`. The remaining operator activities are supplying inventory/public keys, executing the playbook, manually authenticating Codex and supplying a GitHub credential during first runner registration.

## Superseded

Retired on 2026-07-30 without completing the remaining checklist items. This plan describes `install.sh` and `update.sh`, which no longer exist: `update.sh` was removed by the Ansible migration in #48 and `install.sh` by the sandbox boundary fix in #58. Deployment and host preparation are now owned by `ansible/`. The unchecked items are moot against the current tree; nothing here should be used as a current instruction. Kept under `completed/` as a historical record per `AGENTS.md`.
