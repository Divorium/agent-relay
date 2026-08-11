# Align Agent Relay provisioning with Ansible state management

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Maintain this document in accordance with `.agent/PLANS.md` from the repository root.

## Purpose / Big Picture

Running `ansible/playbooks/host.yml` must reconcile the Agent Relay host without rejecting an otherwise valid installation because a second script has its own version contract. In particular, an installed Codex CLI version such as `codex-cli 0.146.0` must not cause provisioning to fail. Every `host.yml` run must ask npm to install `@openai/codex@latest`, and the npm task result must be the only host-provisioning result for that installation.

The same change must leave the complete `ansible/` tree consistent with Ansible's desired-state model. Native `ansible.builtin` modules own files, packages, users, services, templates, downloads, and other state they can represent. Commands remain only for tools without a suitable built-in module or for the existing atomic runtime directory swap. Those commands must have task-local conditions or accurate changed-state handling. The result is observable by running the normal host playbook twice: both runs succeed, the toolchain validator task is absent, the second run does not report false drift when external package state has not changed, and the registered runner listener remains active.

## Progress

- [x] (2026-08-11 19:59Z) Read the complete `.agent/PLANS.md`, PR #65 diff, repository instructions, every file under `ansible/`, and every repository script directly invoked by Ansible.
- [ ] Remove the duplicate host toolchain validation path while retaining the required latest-Codex installation behavior.
- [ ] Reconcile the remaining PR #65 Ansible changes against the necessity rules in this plan, including privilege scope and deletion of completed one-time work.
- [ ] Reduce tests and documentation to the contracts required by this plan.
- [ ] Run local Ansible and repository validation.
- [ ] Run the real host acceptance scenario twice and record the observed recaps and listener state.

## Surprises & Discoveries

- Observation: The reported failure occurs after Ansible has already installed the configured tools. `ansible/roles/agent_relay_host/tasks/deployment-prepare.yml` then invokes `scripts/host-toolchain-check.sh`, which independently interprets version and environment requirements. This creates a second source of truth and can reject the state Ansible just reconciled.
  Evidence: The failing task is `Validate configured host toolchains`; the script exits before deployment with `EXPECTED_CODEX_VERSION is required` or an exact-version mismatch.

- Observation: Version inspection is not universally wrong. The GitHub runner archive, Go archive, Rust toolchain, TypeScript compiler, and built runtime are externally managed artifacts without one built-in Ansible module that expresses each complete contract. Their local checks decide whether a specific command must run and therefore belong next to the task they control.
  Evidence: `ansible/roles/agent_relay_host/tasks/deploy.yml` uses `Runner.Listener --version` to decide whether to extract the pinned runner payload, and the runtime revision marker decides whether the checked-out source must be rebuilt.

- Observation: `ansible/playbooks/github-connect.yml` had `become: false` before the current PR. Changing it to play-wide `become: true` escalates controller-side GitHub API tasks and non-privileged logic even though only target service, registration, and protected-file tasks require another user or root.
  Evidence: GitHub API calls use `ansible.builtin.uri` with `delegate_to: localhost`; target registration uses the official runner `config.sh`, and service management uses `ansible.builtin.systemd_service`.

- Observation: `ansible/playbooks/replace-runner-workspace.yml` performed a one-time replacement that has already been executed on the installed host. It is not part of the permanent desired state.
  Evidence: The permanent role already declares `runner/_work` as a real `github-runner`-owned directory in `ansible/roles/agent_relay_host/tasks/filesystem.yml`.

## Decision Log

- Decision: Remove `scripts/host-toolchain-check.sh` from host provisioning instead of weakening or repairing its Codex comparison.
  Rationale: `toolchains.yml` owns installation. A second script duplicates that responsibility and caused the reported failure. The npm command already fails the Ansible task if installation itself fails.
  Date/Author: 2026-08-11 / Codex

- Decision: Keep Codex unpinned and execute `/usr/bin/npm install --global --prefix /usr/local @openai/codex@latest` on every `host.yml` run.
  Rationale: This is an explicit host contract. Codex must track the newest published CLI, while the build toolchains and GitHub runner remain pinned where reproducibility requires it.
  Date/Author: 2026-08-11 / Codex

- Decision: Keep `scripts/toolchain-smoke.sh` outside host provisioning.
  Rationale: It verifies that the runner environment and Codex command-line interface remain compatible with CI consumers. It does not decide whether Ansible accepts the installed host state.
  Date/Author: 2026-08-11 / Codex

- Decision: Preserve task-local inspection for opaque external tools and the atomic `dist` activation sequence.
  Rationale: Ansible modules cannot infer the installed GitHub runner version, Rust targets, npm global package version, or source revision represented by built output, and `ansible.builtin.file` cannot atomically rename the active runtime with rollback.
  Date/Author: 2026-08-11 / Codex

- Decision: Restore `become: false` in `ansible/playbooks/github-connect.yml` and enable privilege escalation only on target tasks that require root or the runner account.
  Rationale: GitHub HTTP requests execute on the control machine and need no privilege escalation. Service management and access below the mode `0700` runner root do.
  Date/Author: 2026-08-11 / Codex

- Decision: Delete the completed one-time workspace replacement playbook from the PR.
  Rationale: The operation has already run. Keeping it would present historical cleanup as a supported permanent entrypoint.
  Date/Author: 2026-08-11 / Codex

- Decision: Do not add or change GitHub Actions workflows in this task.
  Rationale: The reported failure and the desired-state correction are entirely inside host provisioning. Existing local repository commands and the real Ansible entrypoint provide the required proof.
  Date/Author: 2026-08-11 / Codex

## Outcomes & Retrospective

Implementation has not started under this ExecPlan. At completion, record whether both live `host.yml` runs succeeded, whether the second run was stable, whether the registered listener remained active, and any remaining command task that could not be represented by an `ansible.builtin` module.

## Context and Orientation

PR #65 is based on `main` and uses branch `agent/replace-runner-work-symlink`. The repository supports one organization-level GitHub Actions runner named by `config/runner-host.json`. Supporting multiple runners per virtual machine is not part of this task.

`ansible/playbooks/host.yml` is the credential-free host entrypoint. It bootstraps Python, verifies the supported operating system, and applies the `agent_relay_host` role. That role installs packages, users, filesystem state, Docker and containerd configuration, language toolchains, the GitHub runner payload, the Agent Relay source checkout, the compiled runtime, the systemd unit, and the final listener state.

`ansible/playbooks/github-connect.yml` is a separate entrypoint. It reads a GitHub credential from the control machine, registers the already prepared runner through the official `config.sh`, reconciles its organization label through GitHub HTTP endpoints, and starts the service. Host provisioning must not read this credential or perform GitHub registration.

`ansible/roles/agent_relay_host/tasks/toolchains.yml` is the authoritative tool installation path. Node and Java come from configured APT repositories; Go, Rust, and TypeScript use explicit repository contract versions; Codex deliberately uses `@openai/codex@latest`. The reported failure is caused by a later command in `ansible/roles/agent_relay_host/tasks/deployment-prepare.yml` that calls `scripts/host-toolchain-check.sh` and revalidates the same tools through environment variables such as `EXPECTED_CODEX_VERSION`.

`scripts/toolchain-smoke.sh` has a different responsibility. It runs in the controlled runner or CI environment and checks that consumer commands and Codex CLI flags are usable. It may continue to test CLI compatibility, but no Ansible task may invoke it as a provisioning gate.

The current PR also contains an Ansible-wide refactor. Review it as part of this plan, but retain only changes required to establish a single owner for state or to preserve existing safety. In particular, native handlers are appropriate for restarting Docker and containerd after template changes; task-local inspection is appropriate for runner registration, runner payload version, and runtime source revision; the official runner `config.sh`, compiler invocation, and atomic runtime `mv` operations remain commands because no built-in module owns those actions. A global `agent_relay_deployment_required` fact, a repository-specific lifecycle lock for hypothetical parallel manual playbooks, wrapper scripts that orchestrate Ansible-owned steps, and post-provision validators are not required.

The one-time file `ansible/playbooks/replace-runner-workspace.yml` stopped the service, removed the former workspace layout, created the real `runner/_work` directory, and restarted the service. That action has already completed. Permanent workspace state belongs only in `ansible/roles/agent_relay_host/tasks/filesystem.yml`.

## Plan of Work

Start by re-reading every file under `ansible/` and every script referenced by an Ansible `command`, `shell`, `raw`, `script`, or `include` task at the current PR head. Classify each non-module operation into one of three groups: an operation that a built-in module can own, an external tool invocation with no suitable built-in module, or a read-only observation needed to decide whether the external invocation is necessary. Replace the first group with the built-in module. Keep the second and third groups only when they directly support the existing host or connection flow, and give every retained command accurate `when`, `creates`, `removes`, `changed_when`, and `failed_when` behavior as applicable. Do not create a new wrapper, validation framework, custom module, collection dependency, or global deployment decision.

In `ansible/roles/agent_relay_host/tasks/deployment-prepare.yml`, leave only the preparation required before mutating a registered runner: stop its systemd service and wait for existing `Runner.Worker` processes to exit. Remove the `Validate configured host toolchains` task and any Docker post-validation from this path. Tool installation failures must be reported by the installation tasks that own them.

In `ansible/roles/agent_relay_host/tasks/toolchains.yml`, preserve pinned reconciliation for Node, Java, Go, Rust, Rust targets, and TypeScript. Preserve one unconditional Codex installation command targeting `@openai/codex@latest`; it must not read or compare a configured Codex version. Its command exit status determines failure. Its changed result may distinguish npm's unchanged response, but provisioning must not run `codex --version`, `command -v codex`, or any exact-version comparison afterward.

Remove `scripts/host-toolchain-check.sh`. Remove its entry from `package.json` shell validation and remove every environment variable or parser field that existed only to supply that script. `config/runner-host.json`, `ansible/roles/agent_relay_host/vars/main.yml`, and `scripts/host-config.sh` must contain no Codex version pin. Keep `scripts/toolchain-smoke.sh` and `scripts/ci-toolchain-smoke.sh` as the consumer compatibility path.

Review `ansible/roles/agent_relay_host/tasks/deploy.yml`, `runtime-deployment.yml`, `runner-installation.yml`, `listener-state.yml`, `containers.yml`, and `handlers/main.yml` as one control flow. The checkout module result must directly drive source revision handling. Runner installation may be gated by required payload files and `Runner.Listener --version`. Runtime build may be gated by the checked-out revision and the deployed revision marker. Service preparation must execute only when runner payload, runtime, or unit state actually changes. Template changes must notify handlers instead of manually reconstructing changed-state branching. Preserve the stopped-service build window and atomic `dist` replacement with rollback. Remove only preview facts, aggregate global decisions, duplicate validators, shell-based file reconciliation that a built-in module safely replaces, and the unused lifecycle lock.

Review the GitHub connection boundary separately. In `ansible/playbooks/github-connect.yml`, set `become: false`. In `ansible/roles/agent_relay_github_connection/tasks/main.yml`, apply `become: true` to target-side prerequisite and registration-file inspection when access below the protected runner directory requires it, to `systemd_service`, and to file ownership tasks. Run the official `config.sh` with `become: true` and `become_user` set to the configured runner user. Keep GitHub API `uri` tasks delegated to `localhost` with `become: false`. Assertions and facts must not acquire broad privilege. Keep the host and GitHub connection roles separate.

Delete `scripts/github-connect` and its dedicated shell integration test after the connection role directly owns registration, service state, and label reconciliation. Keep only the official `config.sh` invocation as a command. Remove the deleted files from `package.json` validation instead of replacing them with another orchestration script.

Delete `ansible/playbooks/replace-runner-workspace.yml`. Do not move its historical cleanup into a permanent role. Keep only the permanent `ansible.builtin.file` declaration for `runner/_work` in `ansible/roles/agent_relay_host/tasks/filesystem.yml`.

Reduce `test/host-deployment.test.ts` to durable repository contracts that prevent this failure from returning. A focused regression must establish that host provisioning installs `@openai/codex@latest`, contains no Codex version pin, invokes no host toolchain validator, and keeps host and GitHub connection responsibilities separate. Do not add regex assertions for incidental task names, handler counts, exact formatting, deleted historical mechanisms, or other implementation details already proven by Ansible syntax and the live acceptance run. Update `README.md`, `ansible/README.md`, `docs/native-github-runner-specification.md`, and `docs/operations/README.md` only where the accepted implementation changes their current operator contract. Do not describe the change as complete until live acceptance succeeds.

Before editing any file, compare the PR head SHA with the SHA recorded when work starts. Before writing the final commit, fetch the PR head again. If it changed, re-read the changed files and reapply the necessity test rather than overwriting concurrent work. Do not execute Git commands; repository reads and writes must use the configured GitHub connector.

## Concrete Steps

Work from the repository root. Record the current PR head and inspect the complete Ansible surface:

    rg --files ansible | sort
    rg -n 'ansible\.builtin\.(command|shell|raw|script)|include|import_tasks|EXPECTED_|codex_version|host-toolchain-check|become:' ansible scripts config package.json test

After implementation, validate YAML and Ansible structure with the repository-supported Ansible version. Use the checked-in configuration and role path:

    ANSIBLE_CONFIG="$PWD/ansible/ansible.cfg" \
    ANSIBLE_ROLES_PATH="$PWD/ansible/roles" \
    ansible-playbook \
      --inventory "$PWD/ansible/inventory/example.ini" \
      --syntax-check \
      "$PWD/ansible/playbooks/host.yml"

    ANSIBLE_CONFIG="$PWD/ansible/ansible.cfg" \
    ANSIBLE_ROLES_PATH="$PWD/ansible/roles" \
    ansible-playbook \
      --inventory "$PWD/ansible/inventory/example.ini" \
      --syntax-check \
      "$PWD/ansible/playbooks/github-connect.yml"

Both commands must exit zero. Then run the repository validation without adding a workflow:

    npm run check

This command must exit zero. If `ansible-playbook` is unavailable, install the repository-supported `ansible-core >= 2.18` in an isolated temporary environment or mark syntax validation blocked. Do not replace `--syntax-check` with generic YAML parsing and do not declare completion while it is blocked.

For live acceptance, use the real inventory that targets the installed `runner-host`. Ensure the host checkout is directed at this PR branch so that it does not fetch the old script from `main`:

    cd ansible
    ANSIBLE_CONFIG="$PWD/ansible.cfg" \
    ANSIBLE_ROLES_PATH="$PWD/roles" \
    ansible-playbook \
      --inventory "$PWD/inventory/runners.ini" \
      "$PWD/playbooks/host.yml" \
      -e agent_relay_repository_version=agent/replace-runner-work-symlink

Expect `failed=0`. The task list must contain `Install latest Codex CLI` and must not contain `Validate configured host toolchains`. There must be no reference to `EXPECTED_CODEX_VERSION` and no failure caused by the Codex version that existed before the run.

Immediately run the same command a second time while the npm registry's latest Codex release remains unchanged. Expect `failed=0`; the Codex task must report no false failure and should report unchanged when npm reports the package is already up to date. The playbook must preserve the existing runner registration and finish with the listener active:

    ansible \
      --inventory "$PWD/inventory/runners.ini" \
      agent_relay \
      --become \
      --module-name ansible.builtin.command \
      --args "/usr/bin/systemctl is-active actions.runner.Divorium.gh-runner.service"

The expected output is:

    active

If the execution environment does not have the real inventory, SSH access, or required privilege, record the missing capability in `Surprises & Discoveries`, mark the live acceptance progress item blocked, and stop. Do not substitute a regex test, a mock host, or a request for the operator to perform the required repository acceptance work.

## Validation and Acceptance

Acceptance is one normal end-to-end host reconciliation scenario. Begin with the installed Agent Relay runner, regardless of its currently installed Codex CLI version. Run `host.yml` from the PR branch. Ansible must reconcile the latest Codex package through npm, update runner or runtime state only when their task-local conditions require it, and complete with `failed=0`. The former toolchain validator task and `EXPECTED_CODEX_VERSION` failure must be absent. Run the same playbook again without changing inputs. It must complete with `failed=0`, preserve registration, and leave the listener service active. When npm reports that `@openai/codex@latest` is already installed, the Codex task must not report a change.

Local acceptance also requires zero exits from syntax checks for both permanent playbooks and from `npm run check`. The repository diff must contain no GitHub Actions workflow change, no Codex version pin, no host-side Codex validator, no global `become: true` in `github-connect.yml`, and no completed workspace replacement playbook.

## Idempotence and Recovery

All permanent file, directory, package, user, template, and service tasks must remain safely repeatable. Commands that install pinned external tools must run only when their adjacent observation shows a mismatch. The explicit exception is the Codex npm command, which runs on every host reconciliation by requirement and relies on npm to decide whether the installed package already matches `latest`.

Stopping the listener before runner or runtime mutation is safe to repeat. If runtime activation fails after preserving the previous `dist`, restore the preserved directory before reporting failure. If a host run fails before mutation, the existing registered listener must be restarted when the existing runtime is still safe. Do not restore `host-toolchain-check.sh`, a global lifecycle lock, or the one-time workspace cleanup as a recovery mechanism.

The plan does not authorize deleting registration files, unregistering the runner, changing the configured runner name, or replacing the existing `_work` directory. If repository evidence shows that satisfying the plan requires one of those actions, record the exact conflict and stop for a new user decision.

## Artifacts and Notes

The original failure to eliminate is:

    TASK [agent_relay_host : Validate configured host toolchains]
    ...
    EXPECTED_CODEX_VERSION is required

The intended host path is:

    toolchains.yml -> npm install @openai/codex@latest -> deploy.yml -> listener state

There is no host validation step after the npm installation. Consumer compatibility remains:

    scripts/ci-toolchain-smoke.sh -> scripts/toolchain-smoke.sh

The necessity rule for every retained non-module task is: without that task, the accepted host or connection flow cannot express an external tool action, an atomic filesystem transition, or the local state needed to decide whether that action is required. Remove a task that cannot satisfy this rule.

## Interfaces and Dependencies

Use only `ansible.builtin` modules, matching the existing repository contract. Do not add Galaxy collections or custom modules. Use `ansible.builtin.apt`, `file`, `get_url`, `git`, `group`, `template`, `unarchive`, `uri`, `user`, and `systemd_service` for the state they own. Use `ansible.builtin.command` only for the official GitHub runner CLI, npm global installation, rustup operations, compiler/import checks, version observations for opaque installed artifacts, Git LFS initialization, and atomic `mv` operations. The existing `shell` polling task may remain because it needs a pipeline to detect `Runner.Worker`; it must stay read-only with `changed_when: false`.

The authoritative configuration remains `config/runner-host.json`. It pins the GitHub runner and reproducible build toolchains but must not define `codex_version`. The public entrypoints remain `ansible/playbooks/host.yml` and `ansible/playbooks/github-connect.yml`. The formal boundary between them remains GitHub runner registration files and the installed systemd service; neither playbook imports the other's role.

Revision note: Created on 2026-08-11 to replace ad hoc Ansible refactoring with one bounded plan tied to the reported `EXPECTED_CODEX_VERSION` failure, the explicit latest-Codex requirement, the completed workspace cleanup, and least-privilege GitHub connection behavior.
