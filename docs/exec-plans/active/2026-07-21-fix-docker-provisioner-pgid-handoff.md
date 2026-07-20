# Fix Docker provisioner PGID handoff across the sudo boundary

## Purpose

`update.sh` finalizes the replacement runtime and then launches the root Docker provisioner in a dedicated process group. The updater currently creates the PGID handoff file as the recorded administrator directly in the sticky temporary directory, then asks a root shell to truncate and write that existing file. On the production Debian host this fails with `Permission denied` before `scripts/docker-host.sh` is executed, so Docker provisioning returns status 1 even though runtime finalization succeeds.

This change must reproduce that exact boundary in automated tests, replace the unsafe direct sticky-directory handoff with a private control directory, and validate the full Docker-related repository test surface before merge.

## Current State

- `update.sh` creates `provisioner_pgid_file` with bare `/usr/bin/mktemp`, normally producing an administrator-owned regular file directly under `/tmp`.
- The root process launched through `sudo -n /usr/bin/setsid` executes `printf ... > "$1"` against that existing file before `exec`-ing the Docker provisioner.
- The production host returned `--: line 3: /tmp/tmp...: Permission denied`, followed by Docker provisioning status 1 and successful runner restoration.
- `scripts/docker-host.sh` was not reached by that failed invocation.
- The current updater integration mock writes the PGID as the same effective test user and therefore does not model the protected sticky-directory cross-identity failure.
- `test/update-regression.test.ts` still searches for the removed administrator-side runtime entrypoint check and is inconsistent with current production code.

## Scope and Decisions

- Reproduce the production failure in the transformed-real-updater integration harness before accepting the fix.
- Keep the process-group, deadline, signal, sudo-refresh, runtime-finalization, and runner-restoration contracts unchanged.
- Create one private administrator-owned control directory with mode `0700` and place the PGID file inside it.
- Do not weaken `/tmp`, disable kernel protections, make the PGID file world-writable, or move process control into `scripts/docker-host.sh`.
- Remove the complete private control directory on every exit path and after normal provisioner completion.
- Repair stale source-contract assertions so the normal test suite validates current production behavior.
- Run the full `npm run check`, inspect exact-head CI, and independently review all Docker-related changes before completion.
- No workflow, public API, routing, Codex execution, Docker package, repository, storage, or container-lifecycle contract change is required.

## Implementation

1. Extend the real-updater system harness with a sticky temporary root and a protected-regular simulation that rejects a privileged write to an administrator-owned file directly in that root.
2. Demonstrate that the current direct `mktemp` PGID handoff reproduces the production status-1 failure.
3. Change `update.sh` to create a private control directory, create the PGID file inside it, and clean the directory on normal and abnormal exits.
4. Update the TypeScript updater contract tests to require the nested control path and reject the former direct temporary-file handoff.
5. Run syntax, focused regression, the complete updater integration matrix, Docker repository-safe tests, and full `npm run check`.
6. Review the final diff and exact-head CI. Keep this plan active until all acceptance evidence is recorded.

## Acceptance Criteria

- The regression harness reproduces the production `Permission denied` behavior against the former direct sticky-directory handoff.
- The same harness succeeds with the private control-directory implementation.
- The privileged process publishes a numeric PGID before the Docker provisioner runs.
- No control directory or PGID file remains after success, Docker failure, timeout, sudo expiry, signal failure, or early updater exit.
- Docker provisioning still runs only after runtime finalization.
- Docker failure still restores the runner with the finalized runtime; unsafe surviving process groups still prevent restoration.
- Existing Docker host repository, package, storage, service, socket, group-membership, cleanup, and mount-boundary tests pass unchanged.
- `npm run check` and exact-head CI pass.
- Independent review finds no remaining Docker launch or provisioner regression.

## Progress

- [x] Capture the production symptom and locate the failing shell redirection before `docker-host.sh`.
- [x] Identify the missing protected-regular boundary in the existing integration mock.
- [x] Identify the stale runtime-entrypoint assertion in `test/update-regression.test.ts`.
- [ ] Add a regression that fails against the current direct PGID handoff.
- [ ] Implement the private control-directory handoff and cleanup.
- [ ] Repair source-contract tests.
- [ ] Run focused and full validation.
- [ ] Review exact-head CI and move this plan to `completed`.

## Surprises & Discoveries

- The runner restoration path behaved correctly: runtime finalization had completed, the Docker launch failed with status 1, and the finalized runtime was restored to service.
- The failure occurred before the Docker provisioner script itself, so changing Docker package or daemon logic would not address it.
- The updater integration harness intercepted `setsid` inside fake `sudo` but wrote the PGID under the same identity, masking the production ownership boundary.
- The merged private-runtime PR left an obsolete assertion in the broader updater contract test, demonstrating why full-suite evidence must be collected on the final head.

## Decision Log

- Use a private non-sticky control directory rather than changing kernel settings or file permissions.
- Keep the parent updater responsible for process-group observation and termination.
- Extend the existing transformed-updater harness instead of testing a copied launch command.
- Treat full current-head validation as mandatory before this plan can be completed.

## Outcomes & Retrospective

Implementation and validation are in progress. This section will be updated only with captured test and CI evidence.
