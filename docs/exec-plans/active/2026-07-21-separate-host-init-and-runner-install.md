# Prepare a fresh runner host with Ansible and one reusable installer

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current while work proceeds. Maintain it according to `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

The reviewed baseline is `main` commit `e9ec636e5abf383f8831fc126b99f04e2e005a3c`. Before implementation starts, rebase on current `main` and recheck every referenced file.

Codex may implement repository scripts, Ansible files, tests, and documentation. No GitHub workflow or public Agent Relay API change is required.

## Purpose / Big Picture

Prepare a fresh Debian systemd host for one Agent Relay GitHub Actions runner.

Responsibilities are split simply:

1. **Ansible initializes the host.** It installs packages and toolchains, creates users and secure directories, and configures Docker and other operating-system state required by the repository.
2. **`install.sh` installs and refreshes the runner.** It installs or registers the official GitHub runner when absent, configures its repository-specific service and authentication, builds the Agent Relay runtime, replaces the active runtime, and starts or restarts the service.

The host may be rebuilt from scratch. This task does not preserve or migrate the current installation layout beyond retaining the established names and paths where they remain useful. There is no migration script, compatibility mode, WSL support, host schema, state repair framework, or separate updater.

`install.sh` does not install Ansible, invoke `ansible-playbook`, or inspect an Ansible marker. The expected operator flow is:

    ansible-playbook -i ansible/inventory/example.ini ansible/playbooks/host.yml

    cd /srv/github-runner/storage/agent-relay
    ./install.sh

For every later repository release:

    cd /srv/github-runner/storage/agent-relay
    git pull --ff-only
    ./install.sh

Repeated `install.sh` runs are supported. One-time steps such as runner registration and Codex login are skipped when already complete. Runtime build and service activation run safely on every invocation.

## Progress

Keep this section append-only. Checked implementation items require a repository location and passing evidence. Ansible execution itself is outside automated acceptance.

- [x] (2026-07-21) Reviewed current `install.sh`, `update.sh`, Docker provisioning scripts, package scripts, tests, documentation, and workflows on baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- [x] (2026-07-21) Confirmed current `install.sh` mixes host initialization with runner installation.
- [x] (2026-07-21) Confirmed current `update.sh` separately owns runtime build and service restart while its Docker path is disabled.
- [x] (2026-07-21) Confirmed the new design may assume a fresh host and does not need migration or compatibility with the existing installation.
- [x] (2026-07-21) Confirmed `install.sh` must neither install nor execute Ansible.
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
  Evidence: `install.sh` installs operating-system packages and toolchains, creates users and directory roots, configures WSL, installs system Git LFS state, downloads the runner, registers it, and configures Codex.

- Observation: the active part of `update.sh` is small enough to merge into `install.sh`.
  Evidence: with Docker disabled, it stops the service, waits for a `Runner.Worker`, rebuilds `dist`, applies ownership and modes, and restores the service.

- Observation: the current updater stops the runner before compiling.
  Evidence: a build failure therefore causes avoidable runner downtime. The new installer must build and validate a staged runtime before stopping the service.

- Observation: the dormant Docker implementation is no longer needed.
  Evidence: production exits before it, while three large scripts and dedicated regression tests remain solely for unreachable code.

## Decision Log

- Decision: Ansible is the repository-supported host initialization method.
  Rationale: users, packages, secure directories, toolchains, Docker, and daemon configuration are operating-system state.
  Date/Author: 2026-07-21 / operator requirement.

- Decision: `install.sh` does not install, execute, or verify Ansible.
  Rationale: Ansible is run separately by the human operator before runner installation.
  Date/Author: 2026-07-21 / operator correction.

- Decision: target a fresh Debian systemd host and remove WSL and migration compatibility.
  Rationale: the environment may be rebuilt from scratch, so preserving historical setup branches adds no value.
  Date/Author: 2026-07-21 / operator clarification.

- Decision: keep `install.sh` as the only repository operational script and delete `update.sh`.
  Rationale: the same command should perform initial runner setup and every later refresh after `git pull`.
  Date/Author: 2026-07-21 / operator requirement.

- Decision: Ansible creates `github-runner`, `agent-relay-builder`, all secure directory roots, packages, toolchains, and Docker state.
  Rationale: these are prerequisites for the runner, not runner registration operations.
  Date/Author: 2026-07-21 / responsibility split.

- Decision: `install.sh` owns runner archive installation, registration, `_work`, systemd unit, Codex login, runtime build, runtime replacement, and service activation.
  Rationale: these operations are specific to this repository and runner instance.
  Date/Author: 2026-07-21 / responsibility split.

- Decision: build the new runtime before stopping the runner.
  Rationale: compilation failure must not interrupt the currently working service.
  Date/Author: 2026-07-21 / review correction.

- Decision: always activate the newly built runtime and restart the service.
  Rationale: comparing complete runtime trees and conditionally skipping restart adds unnecessary complexity to a normal release operation.
  Date/Author: 2026-07-21 / simplification.

- Decision: remove `/etc/agent-relay/administrator` unless another current contract demonstrably requires it.
  Rationale: it existed to authorize a separate updater; the remaining installer already runs as the checkout-owning administrator with sudo.
  Date/Author: 2026-07-21 / simplification.

- Decision: do not execute or lint Ansible in CI for this task.
  Rationale: the operator explicitly excluded Ansible testing.
  Date/Author: 2026-07-21 / operator requirement.

## Outcomes & Retrospective

The plan is active and plan-only. PR #47 was closed without merge because it addressed a different two-runner deployment design. No production behavior has changed yet.

Update this section after implementation with the final file set, responsibility boundary, test results, and any prerequisite assumptions discovered while simplifying the installer.

## Context and Orientation

Current relevant files:

- `install.sh` performs host initialization and runner installation.
- `update.sh` builds runtime and restarts the service.
- `scripts/docker-host.sh`, `scripts/docker-host-debian.sh`, and `scripts/docker-host-debian-core.sh` implement unreachable Docker provisioning.
- `test-system/install-script.integration.sh` and `test-system/update-script.integration.sh` test the two-script model.
- `test-system/docker-host.repository-safe.sh` and `test-system/docker-conffile-recovery.integration.sh` test the dormant Docker implementation.
- `test/installer.test.ts` and `test/update-regression.test.ts` encode the old boundary.
- `README.md`, `docs/operations/README.md`, and `docs/native-github-runner-specification.md` document `install.sh` followed by `update.sh`.

The intended default layout is:

    /srv/github-runner/storage/agent-relay
    /srv/github-runner/storage/work
    /srv/github-runner/storage/runner
    /srv/github-runner/storage/home
    /srv/github-runner/storage/build
    /srv/github-runner/storage/build-home

with:

    runner user: github-runner
    builder user: agent-relay-builder
    runner name: gh-runner
    service: actions.runner.Divorium.gh-runner.service

These names are a clean-host target, not a migration contract.

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

The playbook must prepare a fresh Debian systemd host by declaring:

- required base packages and build tools;
- pinned Node.js, Java, Go, Rust, TypeScript, Codex CLI, and Git LFS state;
- locked `github-runner` and `agent-relay-builder` users without sudo;
- the fixed `/srv/github-runner/storage` directory tree with required ownership and modes;
- Docker Engine, Compose plugin, containerd, storage roots, daemon configuration, runner Docker group access, and active services;
- needrestart or equivalent service policy required by the runner.

Do not include WSL support. Do not preserve the procedural recovery, marker, process-group, or dpkg transaction machinery from the old Docker shell scripts. Use ordinary Ansible package, user, group, file, template, and service tasks.

The playbook must not:

- clone or update the repository;
- download or register the GitHub runner;
- request a PAT;
- perform Codex login;
- build `dist`;
- invoke `install.sh`.

`ansible/README.md` documents inventory, required variables, the manual playbook command, and the subsequent `./install.sh` step. It commits no credentials.

### Milestone 2: Reduce `install.sh` to runner and repository responsibilities

Remove from `install.sh`:

- all apt, dpkg, repository, package, and toolchain installation;
- user and group creation or repair;
- protected directory-root creation;
- WSL detection and `/etc/wsl.conf` mutation;
- Docker installation or configuration;
- Git LFS system installation.

At startup, validate only concrete prerequisites needed for the runner operation:

- Debian x86-64 with systemd as PID 1;
- exact repository path and checkout ownership by the invoking administrator;
- existing `github-runner` and `agent-relay-builder` accounts with expected homes and no sudo;
- existing directory tree with expected ownership and safe non-symlink paths;
- required pinned commands and toolchain versions;
- working Docker CLI, Compose plugin, daemon, socket access for `github-runner`, and expected storage roots;
- trusted repository entrypoints and configuration files.

Missing or invalid prerequisites produce direct errors before runner registration, Codex login, service mutation, or runtime replacement. The installer does not try to repair host initialization.

### Milestone 3: Keep runner installation idempotent

`install.sh` must:

- accept no arguments and refuse root execution;
- acquire one nonblocking installer lock;
- download and SHA-256 verify the pinned runner archive only when runner binaries are absent;
- reject a partial runner installation instead of guessing;
- create `_work -> ../work` only when absent and validate it when present;
- request a PAT and registration token only when `.runner` is absent;
- keep PAT and registration token memory-only and unset them immediately;
- install the expected root-owned systemd unit, overwriting its managed content when necessary;
- call `systemctl daemon-reload` after unit installation;
- perform Codex login only when `codex login status` reports missing authentication.

A second run with an already registered runner must not download the runner archive, request a PAT, or repeat registration.

No general compatibility handling for an old or differently configured runner is required. Unexpected partial state fails with a clear instruction to rebuild the host or remove the conflicting state deliberately.

### Milestone 4: Build and activate runtime in the same installer

On every successful invocation:

1. create a clean build stage under the prepared build filesystem as `agent-relay-builder`;
2. compile `tsconfig.runtime.json` into the stage through `env -i` and the pinned TypeScript compiler;
3. require `stage/src/run-codex.js` and validate that the stage contains only safe regular files and directories;
4. apply final `root:root` ownership, directory mode `0755`, and file mode `0644` to the stage;
5. only after the stage is complete, stop the runner listener if active;
6. wait for any existing `Runner.Worker` owned by the numeric `github-runner` UID to finish;
7. move current `dist` to one same-filesystem `dist.previous` when it exists;
8. atomically rename the validated stage to `dist`;
9. enable and restart the runner service;
10. verify the service is active and the listener belongs to `github-runner`;
11. remove `dist.previous` after successful activation.

If compilation or stage validation fails, the running service and active `dist` remain untouched.

If activation fails after replacement, stop the service, remove the failed `dist`, restore `dist.previous`, restart the service, and return nonzero. This is a local replacement fallback, not a general rollback system.

Every successful run may rebuild `dist` and restart the runner. Full runtime comparison and conditional restart are explicitly out of scope.

`install.sh` performs no Git synchronization, repository tests, coverage, Ansible execution, package installation, or Docker provisioning.

### Milestone 5: Remove obsolete files

Delete:

- `update.sh`;
- `scripts/docker-host.sh`;
- `scripts/docker-host-debian.sh`;
- `scripts/docker-host-debian-core.sh`;
- `test-system/update-script.integration.sh`;
- `test-system/docker-host.repository-safe.sh`;
- `test-system/docker-conffile-recovery.integration.sh`;
- `test/update-regression.test.ts` after moving relevant assertions.

Remove active references to those files from `install.sh`, `package.json`, tests, current documentation, and trusted-entrypoint lists.

Do not rewrite completed ExecPlans. They remain historical records.

### Milestone 6: Rebuild tests around the simple contract

Refactor `test-system/install-script.integration.sh` to cover:

- fully prepared fresh-host prerequisites;
- failure before mutation when a required user, path, tool, permission, Docker capability, or systemd state is missing;
- fresh runner binary installation and one-time registration;
- second run skips archive download, PAT prompt, and registration;
- managed service unit installation;
- Codex login only when absent;
- runtime compilation completes before service stop;
- failed build preserves active runtime and running service;
- changed runtime is atomically activated;
- active worker wait filters by numeric runner UID;
- activation failure restores `dist.previous` and the old service;
- successful activation removes `dist.previous`;
- no Ansible, package, user, WSL, or Docker provisioning command is invoked by `install.sh`.

Update `test/installer.test.ts` or replace it with accurately named focused static tests. Remove assertions that exist only for the deleted updater or Docker process-control implementation.

Update `package.json`:

- remove deleted files from `check:shell`;
- remove deleted system tests from `check:system`;
- retain the single installer system test and existing runtime, Node, shell, and toolchain checks;
- do not add Ansible execution, installation, or linting.

### Milestone 7: Update current documentation

After implementation acceptance, update `README.md`, `docs/operations/README.md`, and `docs/native-github-runner-specification.md` to describe:

- fresh Debian host initialization through the repository Ansible playbook;
- Ansible supplied and executed independently by the operator;
- one `install.sh` for initial runner setup and all later releases;
- `git pull --ff-only` followed by `./install.sh` for updates;
- no `update.sh`;
- no WSL compatibility;
- host packages, users, toolchains, secure directories, and Docker owned by Ansible;
- runner registration, service, Codex login, runtime build, activation, and restart owned by `install.sh`.

No workflow, request routing, Codex output, public API, or result-contract change is required.

## Concrete Steps

Revalidate baseline:

    git fetch origin main
    git rebase origin/main
    git status --short

Inspect references before deletion:

    git grep -n -e 'update\.sh' -e 'docker-host' -e 'DOCKER_PROVISIONING_ENABLED' -e 'wsl\.conf'
    git grep -n -e 'apt-get' -e 'useradd' -e 'rustup' -e 'nodesource' -- install.sh

Expected final file checks:

    test ! -e update.sh
    test ! -e scripts/docker-host.sh
    test ! -e scripts/docker-host-debian.sh
    test ! -e scripts/docker-host-debian-core.sh
    test -f ansible/playbooks/host.yml
    test -f ansible/roles/agent_relay_host/tasks/main.yml
    ! grep -Eq 'ansible-playbook|apt-get|dpkg|useradd|rustup|nodesource|wsl\.conf|DOCKER_PROVISIONING_ENABLED' install.sh

Run non-Ansible validation:

    bash -n install.sh runner/finalize.sh scripts/codex-run scripts/toolchain-environment.sh scripts/toolchain-smoke.sh scripts/ci-runtime-build.sh scripts/ci-toolchain-smoke.sh test-system/install-script.integration.sh
    npm ci
    npm run check
    git diff --check

Do not run or install Ansible as validation for this task.

## Validation and Acceptance

Acceptance requires:

- `ansible/` describes the complete fresh-host state required by the runner;
- Ansible contains no runner registration, Codex login, repository update, runtime build, or installer invocation;
- `install.sh` contains no Ansible, package, user, directory-root, toolchain, WSL, Git LFS system, or Docker provisioning;
- `install.sh` validates prepared host prerequisites;
- `update.sh` and dormant Docker shell provisioning are removed;
- fresh runner installation succeeds;
- second `install.sh` execution skips one-time operations;
- runtime build completes before the service is stopped;
- build failure leaves the current runner untouched;
- activation failure restores the previous runtime;
- successful execution restarts and verifies the runner;
- all non-Ansible repository checks pass;
- final review finds no active reference to the deleted updater, Docker provisioner, WSL path, or old two-script operator flow.

## Idempotence and Recovery

Ansible uses ordinary idempotent desired-state tasks, but its execution is not tested in this task.

`install.sh` has only three reusable state rules:

- runner binary, registration, and Codex authentication already exist: validate and skip the one-time operation;
- managed service file exists: overwrite with the expected content and reload systemd;
- runtime release: always build a complete stage, then perform one local atomic replacement and service restart.

Unknown partial runner registration or unsafe paths fail immediately. The supported recovery for a fundamentally inconsistent host is to rebuild it with the playbook rather than add migration logic.

A failed pre-activation build changes nothing. A failed post-replacement activation restores the immediately previous `dist` and attempts to restart the previous service.

## Artifacts and Notes

Keep append-only.

- 2026-07-21: closed PR #47 without merge because it addressed a different automatic two-runner deployment design.
- 2026-07-21: reviewed current installer, updater, Docker provisioner, tests, package scripts, workflows, and current documentation.
- 2026-07-21: removed the initial assumption that `install.sh` installs or requires Ansible.
- 2026-07-21: simplified the plan to a fresh Debian host with no migration, WSL, runtime comparison, or general reconciliation framework.

Future evidence: final file list, deleted-reference grep, prepared-host fixtures, second-run command log, registration prompt count, build-before-stop ordering, activation rollback test, complete `npm run check`, and independent final review.

## Interfaces and Dependencies

Host initialization:

    ansible-playbook -i ansible/inventory/example.ini ansible/playbooks/host.yml

Runner installation and every later refresh:

    ./install.sh

`install.sh` accepts no arguments and runs as the normal checkout-owning administrator, not root. It uses sudo only for runner files, runtime ownership, and systemd operations.

No PAT, GitHub token, Codex credential, SSH private key, vault secret, or inventory secret is committed.

Default identities and paths:

- runner user: `github-runner`;
- builder user: `agent-relay-builder`;
- source: `/srv/github-runner/storage/agent-relay`;
- work: `/srv/github-runner/storage/work`;
- runner: `/srv/github-runner/storage/runner`;
- home: `/srv/github-runner/storage/home`;
- build: `/srv/github-runner/storage/build`;
- build home: `/srv/github-runner/storage/build-home`;
- service: `actions.runner.Divorium.gh-runner.service`.

The prepared host supplies Bash, systemd, Git, curl, jq, TypeScript, Codex, Docker, and the other pinned toolchains. `install.sh` introduces no new runtime dependency.