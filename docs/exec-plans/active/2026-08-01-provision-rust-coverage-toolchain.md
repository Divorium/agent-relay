# Provision the Rust branch-coverage toolchain on the Agent Relay host

This ExecPlan is maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

Codex runs inside a sandbox where `/opt/rust` is intentionally read-only. Consumer repositories can therefore use only Rust toolchains and Cargo utilities installed by the Agent Relay host role. Monify requires Rust branch coverage through `cargo-llvm-cov --branch`, which needs an exact nightly toolchain and `llvm-tools-preview`; the current host contract provisions only Rust `1.97.0` and `wasm32-unknown-unknown`.

After this change, `ansible/playbooks/host.yml` installs and validates `nightly-2026-07-31`, `llvm-tools-preview`, and `cargo-llvm-cov 0.8.6` before restoring the runner. The Codex sandbox remains unable to mutate `/opt/rust`.

## Progress

- [x] (2026-08-01 18:30Z) Declared the exact coverage toolchain, component, and Cargo utility version in `config/runner-host.json`.
- [x] (2026-08-01 18:35Z) Added idempotent Ansible installation tasks and exposed the contract through role variables.
- [x] (2026-08-01 18:40Z) Extended the post-install host validator and deployment environment.
- [x] (2026-08-01 18:45Z) Added static regression coverage for declaration, ordering, and validation wiring.
- [ ] (2026-08-01 18:50Z) Obtain green repository CI and review the final pull-request diff.

## Surprises & Discoveries

- Observation: ordinary pull-request CI runs before the branch's Ansible changes are deployed, so it must not require the new nightly toolchain from the existing host.
  Evidence: `scripts/ci-toolchain-smoke.sh` validates the currently deployed runner, while `ansible/roles/agent_relay_host/tasks/deployment-prepare.yml` validates host state after `toolchains.yml` has reconciled it.

## Decision Log

- Decision: keep `/opt/rust` read-only for Codex and provision coverage dependencies as root through `host.yml`.
  Rationale: allowing the agent to install its own compiler would weaken reproducibility and the existing sandbox boundary.
  Date/Author: 2026-08-01 / ChatGPT

- Decision: validate the coverage toolchain in `scripts/host-toolchain-check.sh`, not in pre-deployment CI smoke.
  Rationale: host deployment can install the declared state before validating it; pull-request CI cannot.
  Date/Author: 2026-08-01 / ChatGPT

## Outcomes & Retrospective

Implementation is complete but remains active until repository CI passes and the pull-request diff receives final review.

## Context and Orientation

`config/runner-host.json` is the shared host contract. `ansible/roles/agent_relay_host/vars/main.yml` maps that contract into Ansible variables. `ansible/roles/agent_relay_host/tasks/toolchains.yml` owns root-managed toolchain installation. `ansible/roles/agent_relay_host/tasks/deployment-prepare.yml` invokes `scripts/host-toolchain-check.sh` after installation and before runtime deployment.

The Codex launcher continues to expose `/opt/rust` read-only. This plan does not change `scripts/codex-run`, sandbox permissions, GitHub workflows, runner registration, or the GitHub connection playbook.

## Plan of Work

Keep the exact stable toolchain and WASM target unchanged. Add one exact nightly coverage toolchain, its required LLVM component, and one exact `cargo-llvm-cov` version to `config/runner-host.json`. Install them in `ansible/roles/agent_relay_host/tasks/toolchains.yml` only when missing or mismatched. Pass their expected values to `scripts/host-toolchain-check.sh` from `ansible/roles/agent_relay_host/tasks/deployment-prepare.yml`. Add static tests proving the contract and task order.

## Concrete Steps

Use the repository root as the working directory.

Run the focused static test after installing dependencies:

    npm ci
    npm run build
    node --test dist/test/host-deployment.test.js

Run repository validation:

    npm run check

After merge, reconcile the host with the existing PAT-free entrypoint:

    cd ansible
    ANSIBLE_CONFIG="$PWD/ansible.cfg" ANSIBLE_ROLES_PATH="$PWD/roles" ansible-playbook --inventory "$PWD/inventory/example.ini" "$PWD/playbooks/host.yml"

Do not run `github-connect.yml`; registration and labels are unchanged.

## Validation and Acceptance

The focused host-deployment test must pass. Pull-request CI must pass without requiring the new nightly toolchain to be preinstalled. A later `host.yml` execution must install the declared nightly toolchain, component, and Cargo utility, then pass `scripts/host-toolchain-check.sh` before restarting the runner.

Acceptance requires `rustup toolchain list` to include `nightly-2026-07-31`, the installed component list for that toolchain to include LLVM tools, and `cargo-llvm-cov --version` to return `cargo-llvm-cov 0.8.6`.

## Idempotence and Recovery

Repeated `host.yml` runs skip the nightly installation when present, tolerate the LLVM component already being current, and skip `cargo-llvm-cov` installation when the exact version is installed. A failed download or build stops host reconciliation before runtime activation; the previous runtime remains available under the existing deployment rollback rules.

## Artifacts and Notes

The production failure was:

    rustup attempted to create /opt/rust/rustup/tmp/... and received Read-only file system

This is expected sandbox behavior. The fix is host provisioning, not writable sandbox access.

## Interfaces and Dependencies

The host contract adds `rust_coverage_toolchain`, `rust_coverage_component`, and `cargo_llvm_cov_version`. No public API, network protocol, service, database, workflow, GitHub Actions workflow, or runner registration contract changes.

## Plan Revision Notes

2026-08-01 / ChatGPT: Created the active implementation record after confirming that branch coverage requires nightly Rust and that the existing read-only `/opt/rust` boundary is correct.
