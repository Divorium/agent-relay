# Separate host initialization from reusable runner installation

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current while work proceeds. Maintain it according to `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

The reviewed baseline is `main` commit `e9ec636e5abf383f8831fc126b99f04e2e005a3c`. Before implementation starts, verify that commit remains an ancestor of `HEAD` and recheck every current-state claim against the rebased repository.

Codex may implement repository scripts, tests, Ansible files, and documentation. No GitHub workflow change is required: existing CI already executes `npm run check`, and the package scripts must be updated to reflect the new file set.

## Purpose / Big Picture

Separate two responsibilities that are currently mixed in `install.sh` and `update.sh`:

1. **Host initialization** belongs to a manually executed Ansible playbook stored under a new `ansible/` tree. It prepares operating-system state such as service users, protected directories, packages, toolchains, and Docker.
2. **Agent Relay runner installation and reconciliation** belongs to one reusable `install.sh`. It configures the official GitHub runner and repository-specific runtime using an already prepared host.

`install.sh` must not install Ansible, invoke `ansible-playbook`, check an Ansible execution marker, or require proof that the supplied playbook was used. A host prepared manually or by another configuration-management system is acceptable when its actual users, paths, permissions, binaries, and services satisfy the same prerequisites.

The separate `update.sh` is removed. Its useful runtime compilation, safe replacement, and runner restart behavior moves into `install.sh`. The operator flow becomes:

    # Optional repository-provided host initialization, executed manually.
    ansible-playbook -i ansible/inventory/example.ini ansible/playbooks/host.yml

    # Initial runner installation or any later reconciliation after git pull.
    cd /srv/github-runner/storage/agent-relay
    ./install.sh

For ordinary releases:

    cd /srv/github-runner/storage/agent-relay
    git pull --ff-only
    ./install.sh

Repeated `install.sh` runs are normal and supported. The script inspects current state, skips already-correct one-time operations, replaces managed files only when content differs, rebuilds the runtime safely, and restarts the runner only when required. It must never run a command merely because a previous invocation already succeeded when that command would fail or corrupt existing state.

## Progress

Keep append-only. Checked implementation items require a code reference plus passing evidence. Ansible execution is explicitly excluded from automated acceptance.

- [x] (2026-07-21) Reviewed current `install.sh`, `update.sh`, package scripts, installer and updater tests, Docker provisioner scripts, current documentation, and runner workflows on baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- [x] (2026-07-21) Confirmed current `install.sh` mixes host package/toolchain/user/filesystem initialization with runner registration and service setup.
- [x] (2026-07-21) Confirmed current `update.sh` separately owns runtime build, runner stop/wait, runtime replacement, and service restart.
- [x] (2026-07-21) Confirmed the production Docker path is disabled while a large dormant Docker provisioner and its regression suite remain in the repository.
- [x] (2026-07-21) Recorded that `install.sh` must neither install Ansible nor depend on an Ansible marker or playbook execution.
- [ ] Revalidate the baseline immediately before implementation.
- [ ] Add the standalone `ansible/` host-initialization structure and operator documentation.
- [ ] Move host users, protected directory creation, operating-system packages, toolchains, WSL compatibility, and Docker setup out of `install.sh` and into Ansible.
- [ ] Merge the useful runtime-update behavior into idempotent `install.sh`.
- [ ] Delete `update.sh`, dormant Docker provisioner scripts, obsolete tests, and stale current documentation references.
- [ ] Update package scripts and focused tests for the new single-script contract.
- [ ] Run non-Ansible repository validation and independently review the final diff.
- [ ] Update `Outcomes & Retrospective` and move this same plan to `completed` only after every item is checked.

## Surprises & Discoveries

- Observation: `install.sh` currently performs broad host initialization.
  Evidence: it runs apt, configures Node and Java repositories, downloads Go and Rust, installs TypeScript and Codex, creates users and directories, edits WSL configuration, and installs system-level Git LFS state.

- Observation: `update.sh` is now mostly duplicate lifecycle orchestration around a small runtime build.
  Evidence: Docker execution returns early because `DOCKER_PROVISIONING_ENABLED=0`; the active path stops the runner, waits for workers, rebuilds `dist`, fixes metadata, and starts the runner.

- Observation: the dormant Docker implementation is no longer part of any production path but still carries substantial scripts and tests.
  Evidence: `scripts/docker-host.sh`, `scripts/docker-host-debian.sh`, `scripts/docker-host-debian-core.sh`, and their system tests exist only to preserve a disabled implementation.

- Observation: requiring an Ansible marker would create an unnecessary coupling.
  Evidence: the runner needs concrete host state, not knowledge of which tool produced it. `install.sh` should validate prerequisites directly and accept any compliant host.

- Observation: blindly moving the old updater body into `install.sh` would not satisfy safe reuse.
  Evidence: the current updater deletes active `dist` before compilation and always manipulates the service. The merged implementation needs staged runtime creation and change-aware service reconciliation.

## Decision Log

- Decision: keep `install.sh` as the single repository operational entrypoint and delete `update.sh`.
  Rationale: the same command should support first runner setup and every later reconciliation after a checkout update.
  Date/Author: 2026-07-21 / operator requirement.

- Decision: `install.sh` does not install Ansible and never calls Ansible.
  Rationale: Ansible is an independently operated host-initialization tool, not a runtime dependency of Agent Relay installation.
  Date/Author: 2026-07-21 / operator correction.

- Decision: do not create or inspect an Ansible completion marker.
  Rationale: actual host state is authoritative. Hosts prepared by another correct method must remain supported.
  Date/Author: 2026-07-21 / operator correction.

- Decision: add one repository-local `ansible/` tree for optional manual host initialization.
  Rationale: the repository should provide a repeatable reference implementation for packages, users, secure paths, toolchains, and Docker without mixing those tasks into runner installation.
  Date/Author: 2026-07-21 / operator requirement.

- Decision: Ansible owns host users and directory roots; `install.sh` validates them but does not create or repair them.
  Rationale: user and protected-filesystem provisioning is host initialization. Silent installer repair would reintroduce the responsibility split this work removes.
  Date/Author: 2026-07-21 / scope clarification.

- Decision: Ansible owns operating-system packages and host toolchains, including Docker.
  Rationale: package repositories, package installation, toolchain roots, service groups, storage directories, and daemon configuration are host state.
  Date/Author: 2026-07-21 / operator requirement.

- Decision: runner archive installation, runner registration, `_work` configuration, runner systemd unit, Codex authentication, repository protection, runtime compilation, and runner activation remain in `install.sh`.
  Rationale: these items are specific to the repository and official runner rather than generic host initialization.
  Date/Author: 2026-07-21 / responsibility split.

- Decision: Ansible files are not executed in CI and no Ansible test suite is required.
  Rationale: the operator explicitly excluded Ansible testing. CI still validates all shell, TypeScript, and simulated installer behavior.
  Date/Author: 2026-07-21 / operator requirement.

- Decision: completed ExecPlans remain historical records and are not rewritten or deleted.
  Rationale: `.agent/PLANS.md` defines completed plans as history rather than current contracts. Current scripts, tests, and documentation must not rely on them.
  Date/Author: 2026-07-21 / repository convention.

## Outcomes & Retrospective

The plan is active and plan-only. PR #47 was closed without merge because it addressed a different two-runner deployment design. No production script or host behavior has changed yet.

Update this section after implementation with the final responsibility boundary, removed files, installer idempotence evidence, and any host-state assumptions discovered during implementation.

## Context and Orientation

Current files relevant to this change:

- `install.sh` installs host packages and toolchains, creates accounts and directories, downloads and registers the runner, installs the service, records the administrator, and performs Codex login.
- `update.sh` stops the runner, waits for `github-runner` workers, compiles `dist`, applies production ownership and modes, and starts the service. A disabled Docker branch and process-control implementation remain after the active return path.
- `scripts/docker-host.sh`, `scripts/docker-host-debian.sh`, and `scripts/docker-host-debian-core.sh` implement the dormant Docker host provisioner.
- `test-system/install-script.integration.sh` tests the existing one-time installer.
- `test-system/update-script.integration.sh` tests the separate updater and transformed dormant Docker path.
- `test-system/docker-host.repository-safe.sh` and `test-system/docker-conffile-recovery.integration.sh` test the dormant Docker provisioner.
- `test/installer.test.ts` and `test/update-regression.test.ts` encode the old two-script contract.
- `package.json` explicitly includes both installer/updater and Docker tests.
- `README.md`, `docs/operations/README.md`, and `docs/native-github-runner-specification.md` tell operators to run `install.sh` once and `update.sh` for every release.

The existing source checkout remains `/srv/github-runner/storage/agent-relay`. The current runner, work, home, build, and build-home paths remain unless implementation discovers a concrete conflict. This task changes ownership of responsibilities, not the public Codex request, result, finalizer, output, or workspace contracts.

## Plan of Work

### Milestone 1: Add the standalone Ansible structure

Add:

    ansible/
      README.md
      ansible.cfg
      inventory/example.ini
      playbooks/host.yml
      roles/agent_relay_host/
        defaults/main.yml
        handlers/main.yml
        tasks/main.yml
        tasks/packages.yml
        tasks/users.yml
        tasks/filesystem.yml
        tasks/toolchains.yml
        tasks/docker.yml
        templates/

The exact split may be simplified when adjacent task files would contain only trivial imports, but responsibilities must remain obvious.

The playbook is run manually by an operator and must not be called by `install.sh`, package scripts, CI, or GitHub workflows. It must not register a GitHub runner, request a PAT, perform Codex login, compile repository runtime, clone or update the repository, or run `install.sh`.

The role should idempotently declare the existing supported host state currently embedded in shell scripts:

- locked `github-runner` and `agent-relay-builder` accounts without sudo;
- required `/srv/github-runner/storage` directory structure, ownership, and restrictive modes;
- required base packages and build tools;
- Node.js, Java, Go, Rust, TypeScript, Codex CLI, Git LFS, and their fixed roots/versions;
- needrestart or equivalent host policy needed by the runner service;
- optional retained WSL systemd compatibility, isolated from normal Linux behavior;
- Docker engine, Compose plugin, containerd, storage roots, daemon configuration, runner group access, and services based on the desired state represented by the current dormant provisioner.

Do not copy the procedural recovery machinery of the Docker shell scripts into Ansible. Express desired package, file, directory, group, and service state using normal Ansible tasks and handlers. Preserve intentional pinned versions and security-relevant ownership/mode requirements, but remove update-specific process-group, temporary-marker, and dpkg transaction code that existed only to make a shell provisioner recoverable.

`ansible/README.md` must state that:

- the operator supplies and maintains Ansible independently;
- running the repository playbook is optional from `install.sh`'s perspective;
- the playbook is the supported reference method for preparing a host;
- inventory and required variables are documented without committing credentials;
- after host preparation and repository checkout, the operator runs `./install.sh`.

### Milestone 2: Define installer prerequisite validation

Before any mutation, `install.sh` performs a complete preflight of host state needed for runner installation and runtime build. It does not check how that state was created.

Validate at least:

- supported architecture and systemd availability;
- exact source checkout location and administrator write access;
- required runner and builder accounts, expected homes/shells, locked status, and absence of sudo access;
- required directory roots, canonical paths, ownership, modes, and absence of unsafe symlinks;
- required commands and pinned toolchain versions;
- Docker command, Compose plugin, socket access for `github-runner`, daemon activity, and configured storage roots when Docker remains part of the runner capability;
- trusted repository entrypoints and configuration files.

Accumulate actionable missing or conflicting prerequisites where practical, then fail before runner registration, service changes, runtime replacement, or Codex login. Error messages may recommend the repository Ansible playbook but must not state that Ansible execution itself is mandatory.

Delete from `install.sh`:

- apt repository and package installation;
- `apt-get`, `dpkg`, and WSL configuration mutation;
- `useradd`, password locking, sudo-group repair, and directory-root creation;
- Node, Java, Go, Rust, TypeScript, Codex, and Git LFS installation;
- Docker provisioning or Docker package logic.

### Milestone 3: Make runner installation and managed files idempotent

Retain or improve:

- pinned runner archive download with SHA-256 verification only when runner binaries are absent or an explicit supported runner-version reconciliation is needed;
- clear rejection of partial or conflicting runner installation;
- `_work` symlink validation and creation only when absent;
- PAT prompt and registration-token exchange only when `.runner` registration is absent;
- memory-only handling and clearing of PAT and short-lived token;
- service unit generation and root-owned installation;
- runner-specific needrestart configuration;
- protected administrator metadata only if still needed by the merged single-script design;
- Codex login only when `codex login status` reports authentication missing.

For every managed file, render expected content to a temporary file and compare it with the current regular non-symlink file. Replace atomically only when content or required metadata differs. Call `systemctl daemon-reload` only when a unit changed.

Do not use commands whose normal second execution fails when the desired state is already present. Detect existing state first, validate it, and either skip, reconcile a safely managed difference, or fail on a conflict.

### Milestone 4: Merge runtime reconciliation into `install.sh`

After runner setup and preflight, execute the operational runtime path on every invocation:

1. acquire a nonblocking installer lock;
2. stop the runner listener if active;
3. wait for any `Runner.Worker` owned by `github-runner` to finish, preserving the existing `KillMode=process` contract;
4. create a clean private build/stage directory owned by `agent-relay-builder`;
5. compile `tsconfig.runtime.json` into the stage through `env -i` and the pinned TypeScript compiler;
6. require `src/run-codex.js` and reject unsafe stage entries;
7. apply final root ownership and read-only runtime modes to the stage;
8. compare the staged runtime to active `dist` using deterministic filesystem content and mode checks;
9. if identical, discard the stage and avoid an unnecessary service restart;
10. if different, preserve active `dist` until the new stage is complete, then replace it through same-filesystem rename operations;
11. enable/start the service when inactive, or restart only after runner binaries, service definition, or runtime changed;
12. verify systemd reports the runner active and the listener belongs to `github-runner`.

A build failure must leave the previous active runtime intact. Service restoration must be attempted when the service was active before a failed non-activation step. Avoid introducing a general rollback framework; one retained previous runtime during a local replacement is sufficient for safe script reuse.

`install.sh` continues to perform no Git synchronization, dependency installation, repository tests, coverage, or Ansible execution. The operator or workflow updates the checkout before invoking it.

### Milestone 5: Remove obsolete implementation and tests

Delete:

- `update.sh`;
- `scripts/docker-host.sh`;
- `scripts/docker-host-debian.sh`;
- `scripts/docker-host-debian-core.sh`;
- `test-system/update-script.integration.sh`;
- `test-system/docker-host.repository-safe.sh`;
- `test-system/docker-conffile-recovery.integration.sh`;
- `test/update-regression.test.ts` after moving still-relevant single-installer assertions.

Remove all active references to these files from `install.sh`, `package.json`, current tests, current documentation, and trusted-entrypoint lists.

Do not delete completed ExecPlans solely because they mention the historical updater or Docker provisioner. They remain non-authoritative history.

### Milestone 6: Rebuild test coverage around the new contract

Refactor `test-system/install-script.integration.sh` to cover at minimum:

- preflight succeeds on a fully prepared simulated host;
- missing user, directory, tool, version, permission, Docker capability, or systemd state fails before mutation;
- existing runner binaries and registration skip download and PAT prompt;
- absent registration prompts once and registers once;
- a second identical invocation performs no duplicate registration, user creation, package installation, Ansible execution, or unnecessary unit replacement;
- changed managed unit content is replaced and triggers one daemon reload;
- runtime build uses the builder identity and clean environment;
- failed build preserves old `dist` and restores the prior service state;
- changed runtime is activated and restarts the service;
- identical runtime avoids replacement and unnecessary restart;
- active workers are waited for by numeric UID;
- Docker provisioning scripts are absent and never invoked.

Update `test/installer.test.ts` or split focused static tests under a new accurate name. Preserve useful security assertions, but remove tests whose only purpose was the dormant Docker process-control implementation or the deleted two-script boundary.

Update `package.json`:

- remove `update.sh` and deleted Docker files from `check:shell`;
- remove deleted system tests from `check:system`;
- retain runtime, Node, shell, toolchain, and single-installer system validation;
- do not add Ansible execution, `ansible-lint`, or an Ansible dependency.

### Milestone 7: Update current documentation

Update `README.md`, `docs/operations/README.md`, and `docs/native-github-runner-specification.md` only after implementation is accepted.

Document:

- host initialization is separate from runner installation;
- `ansible/` is the repository-provided manual reference implementation;
- the operator must supply Ansible independently when choosing that path;
- `install.sh` neither invokes nor verifies Ansible;
- actual host prerequisites are authoritative;
- first install and later releases both use `./install.sh`;
- later releases remain `git pull --ff-only` followed by `./install.sh`;
- there is no `update.sh`;
- users, packages, toolchains, protected root directories, and Docker belong to host initialization;
- runner registration, service configuration, Codex login, runtime build, activation, and service reconciliation belong to `install.sh`.

No workflow, public Agent Relay API, Codex request/result contract, routing behavior, or output contract changes are required.

## Concrete Steps

Revalidate baseline:

    git cat-file -e e9ec636e5abf383f8831fc126b99f04e2e005a3c^{commit}
    git merge-base --is-ancestor e9ec636e5abf383f8831fc126b99f04e2e005a3c HEAD
    git status --short
    git diff --name-status e9ec636e5abf383f8831fc126b99f04e2e005a3c...HEAD

Inspect active references before deletion:

    git grep -n -e 'update\.sh' -e 'docker-host' -e 'DOCKER_PROVISIONING_ENABLED'
    git grep -n -e 'apt-get' -e 'useradd' -e 'rustup' -e 'nodesource' -- install.sh

Expected final file checks:

    test ! -e update.sh
    test ! -e scripts/docker-host.sh
    test ! -e scripts/docker-host-debian.sh
    test ! -e scripts/docker-host-debian-core.sh
    test -f ansible/playbooks/host.yml
    test -f ansible/roles/agent_relay_host/tasks/main.yml
    ! grep -Eq 'ansible-playbook|apt-get|useradd|rustup|nodesource|DOCKER_PROVISIONING_ENABLED' install.sh

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

- `install.sh` contains no Ansible installation or execution and no playbook marker dependency;
- `install.sh` contains no host package, user, toolchain, WSL, or Docker provisioning;
- the repository contains a documented standalone `ansible/` structure for manual host initialization;
- the Ansible structure does not register/configure the GitHub runner or invoke `install.sh`;
- `update.sh` and dormant Docker provisioner implementation are removed;
- first installation and later reconciliation use the same idempotent `install.sh`;
- repeated installer execution skips already-correct registration and managed state;
- runtime compilation cannot destroy the previous active runtime before a valid replacement exists;
- service reload/restart occurs only when needed, while an inactive service is started;
- all non-Ansible repository checks pass;
- final independent review finds no stale active reference to the removed updater or Docker provisioner.

The plan is complete only when every `Progress` item is checked and supported by code plus passing evidence.

## Idempotence and Recovery

Ansible desired state is expected to be idempotent, but Ansible execution is not tested by this task.

`install.sh` must classify each managed item as absent, correct, safely reconcilable, or conflicting:

- absent: create or install only when the item belongs to runner/repository responsibility;
- correct: skip;
- safely reconcilable: atomically replace managed content or metadata;
- conflicting: fail with the exact path and expected state rather than deleting unknown state.

Runner registration is never repeated while a valid `.runner` exists. A partial registration fails closed. PAT and short-lived registration token remain memory-only.

Runtime build occurs in a fresh stage. Active `dist` remains untouched until stage validation succeeds. Interrupted or failed stage creation can be deleted on the next run. Replacement is same-filesystem and keeps one immediately previous runtime until service activation succeeds; successful completion removes stale stages and applies the documented retention rule.

A nonblocking lock prevents concurrent `install.sh` runs. Unknown or unsafe path, ownership, registration, service, or runtime state blocks mutation.

## Artifacts and Notes

Keep append-only.

- 2026-07-21: closed PR #47 without merge because it addressed a different automatic two-runner deployment design.
- 2026-07-21: reviewed current installer, updater, Docker provisioner, tests, package scripts, workflows, and current documentation.
- 2026-07-21: corrected initial draft assumption: `install.sh` neither installs Ansible nor requires the playbook to have run.

Future evidence: final file list; deleted-reference grep; installer preflight fixtures; idempotent second-run command log; registration prompt count; runtime stage failure/success/unchanged cases; unit comparison and restart counts; package-script output; complete CI result; independent final review.

## Interfaces and Dependencies

Host initialization reference:

    ansible-playbook -i ansible/inventory/example.ini ansible/playbooks/host.yml

This command is operator documentation only. It is not executed or required by `install.sh`.

Repository operational interface:

    ./install.sh

`install.sh` accepts no arguments and runs as the normal host administrator, not root. It obtains sudo only for its bounded runner/repository operations.

The playbook uses variables for administrator identity and any host-specific choices. No PAT, GitHub token, Codex credential, private key, vault secret, or inventory secret is committed.

Existing fixed runner identities and paths remain the default contract unless implementation evidence requires a recorded change:

- runner: `github-runner`;
- builder: `agent-relay-builder`;
- source: `/srv/github-runner/storage/agent-relay`;
- work: `/srv/github-runner/storage/work`;
- runner: `/srv/github-runner/storage/runner`;
- home: `/srv/github-runner/storage/home`;
- build: `/srv/github-runner/storage/build`;
- build home: `/srv/github-runner/storage/build-home`;
- service: `actions.runner.Divorium.gh-runner.service`.

Use existing Bash, systemd, Git, curl, jq, TypeScript, and official GitHub Actions runner dependencies supplied by the prepared host. Add no new runtime dependency to `install.sh`.