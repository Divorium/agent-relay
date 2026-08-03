# Disable Docker provisioning during Agent Relay updates

## Purpose

Restore the application update boundary: `./update.sh` must rebuild the Agent Relay runtime and restore the GitHub runner without installing, validating, repairing, or otherwise touching Docker.

The existing Docker provisioner remains in the repository unchanged. This change disables only its invocation from the production updater so later infrastructure work can decide whether to retain it, invoke it separately, or replace it with Ansible.

## Scope

- Keep the current runner stop, worker wait, runtime compilation, entrypoint validation, root adoption, mode application, and runner restoration flow unchanged.
- Set a non-configurable production constant `DOCKER_PROVISIONING_ENABLED=0`.
- Stop requiring or normalizing the Docker provisioner and Debian adapter during updater preflight.
- Restore the runner and return success immediately after runtime finalization.
- Keep the dormant Docker process-control implementation unchanged to avoid a broad rollback.
- Keep Docker scripts, Docker tests, workflows, request handling, Codex execution, output handling, and public interfaces unchanged.

## Progress

- [x] Add the production-disabled boundary before Docker provisioning.
- [x] Remove Docker-script and Docker-only executable requirements from active updater preflight.
- [x] Update static updater contracts to require runtime finalization and runner restoration before the dormant Docker block.
- [x] Update the system integration so the production path proves Docker is neither invoked nor inspected.
- [x] Retain regression coverage for the dormant provisioner process-control code through an explicitly transformed test-only copy.
- [x] Run shell syntax validation for the changed scripts.
- [x] Run the updater system integration as a non-root user.
- [x] Compile TypeScript and run the focused installer/updater regression tests.
- [ ] Run `git pull --ff-only && ./update.sh` on the affected runner after merge and record the operational result.

## Acceptance criteria

- Production `update.sh` contains the literal assignment `DOCKER_PROVISIONING_ENABLED=0` and no runtime input can enable it.
- Missing, group-writable, or otherwise invalid Docker provisioner scripts cannot block an Agent Relay runtime update.
- A successful update stops the runner, waits for the active worker, rebuilds and secures `dist`, restores the runner, and exits zero without creating a Docker provisioner process or control directory.
- A missing compiled runtime entrypoint still leaves the runner stopped and exits nonzero before runtime adoption or restoration.
- No Docker package, configuration, storage, group, socket, or service state is read or changed by the production update path.
- Existing non-Docker behavior remains unchanged.

## Validation evidence

- `bash -n update.sh test-system/update-script.integration.sh`: passed.
- `bash test-system/update-script.integration.sh` as a non-root user: passed.
- `tsc -p tsconfig.json`: passed.
- `node --test dist/test/installer.test.js dist/test/update-regression.test.js`: 19 passed.

The full Node suite was also attempted in the extracted repository snapshot. Eight unrelated executor fixture tests failed because their generated child executables were unavailable in that snapshot environment; all updater-specific and installer-specific tests passed.

## Superseded

Retired on 2026-07-30 without completing the remaining checklist items. This plan describes `install.sh` and `update.sh`, which no longer exist: `update.sh` was removed by the Ansible migration in #48 and `install.sh` by the sandbox boundary fix in #58. Deployment and host preparation are now owned by `ansible/`. The unchecked items are moot against the current tree; nothing here should be used as a current instruction. Kept under `completed/` as a historical record per `AGENTS.md`.
