# Fix Docker provisioner PGID handoff across the sudo boundary

## Purpose

Before this PR, `update.sh` finalized the replacement runtime and then created the Docker provisioner PGID handoff file as the recorded administrator directly in sticky `/tmp`. A root shell launched through `sudo` attempted to truncate and write that existing file before executing `scripts/docker-host.sh`. The production Debian host rejected that cross-identity open with `Permission denied`, so Docker provisioning returned status 1 even though runtime finalization succeeded.

The change reproduces that boundary in the transformed-real-updater harness, replaces the unsafe direct sticky-directory handoff with a private control directory, and validates the complete Docker-related repository test surface.

## Current State

- `update.sh` creates a unique `/tmp/agent-relay-provisioner.*` directory and immediately enforces mode `0700`.
- The administrator creates the `pgid` file inside that private non-sticky directory with mode `0600`.
- The root process launched through `sudo -n /usr/bin/setsid` can publish its numeric process-group ID without weakening `/tmp` or the handoff file.
- The updater removes the complete control directory after normal provisioner completion and from the exit trap on abnormal paths.
- Process-group validation, bounded deadline handling, sudo refresh, signal escalation, runtime finalization, and runner restoration remain unchanged.
- `scripts/docker-host.sh` and `scripts/docker-host-debian.sh` are unchanged.
- Both stale TypeScript assertions that still expected the removed administrator-side runtime entrypoint check now match builder-context validation.

## Scope and Decisions

- Reproduce the production failure in the transformed-real-updater integration harness before accepting the fix.
- Keep the process-group, deadline, signal, sudo-refresh, runtime-finalization, and runner-restoration contracts unchanged.
- Create one private administrator-owned control directory with mode `0700` and place the PGID file inside it.
- Do not weaken `/tmp`, disable kernel protections, make the PGID file world-writable, or move process control into `scripts/docker-host.sh`.
- Remove the complete private control directory on every exit path and after normal provisioner completion.
- Repair stale source-contract assertions so the normal test suite validates current production behavior.
- No workflow, public API, routing, Codex execution, Docker package, repository, storage, or container-lifecycle contract change is required.

## Implementation

1. Extended the real-updater system harness with a sticky temporary root and a protected-regular simulation that rejects a privileged write to an administrator-owned file directly in that root.
2. Set `TMPDIR` to that sticky root so reverting to the former bare `mktemp` handoff reproduces the production status-1 failure and exact permission diagnostic.
3. Changed `update.sh` to create a private control directory, create the PGID file inside it, and clean the directory on normal and abnormal exits.
4. Updated both TypeScript updater contract suites to require current builder-context runtime validation and the nested PGID control path.
5. Ran the complete CI pipeline, including syntax, TypeScript tests and coverage, production runtime build, toolchain validation, updater integration scenarios, and Docker repository-safe tests.
6. Reviewed the final diff for permission weakening, cleanup gaps, sequencing changes, and modifications outside the Docker launch boundary.

## Acceptance Criteria

- [x] The regression harness fails the former direct sticky-directory handoff with the production-equivalent `Permission denied` diagnostic.
- [x] The same harness succeeds with the private control-directory implementation.
- [x] The privileged process publishes a numeric PGID before the Docker provisioner runs.
- [x] No control directory or PGID file remains after success, Docker failure, timeout, sudo expiry, signal failure, or early updater exit.
- [x] Docker provisioning still runs only after runtime finalization.
- [x] Docker failure still restores the runner with the finalized runtime; unsafe surviving process groups still prevent restoration.
- [x] Existing Docker host repository, package, storage, service, socket, group-membership, cleanup, and mount-boundary tests pass unchanged.
- [x] Full exact-head CI passes.
- [x] Independent review finds no remaining Docker launch or provisioner regression in the changed scope.

## Progress

- [x] Capture the production symptom and locate the failing shell redirection before `docker-host.sh`.
- [x] Identify the missing protected-regular boundary in the existing integration mock.
- [x] Identify both stale runtime-entrypoint assertions.
- [x] Add a regression that fails against the former direct PGID handoff.
- [x] Implement the private control-directory handoff and cleanup.
- [x] Repair source-contract tests.
- [x] Run focused and full validation.
- [x] Review exact-head CI and move this plan to `completed`.

## Surprises & Discoveries

- The runner restoration path behaved correctly: runtime finalization had completed, the Docker launch failed with status 1, and the finalized runtime was restored to service.
- The failure occurred before the Docker provisioner script itself, so changing Docker package or daemon logic would not address it.
- The updater integration harness intercepted `setsid` inside fake `sudo` but wrote the PGID under the same identity, masking the production ownership boundary.
- The first CI run, #895, exposed a stale assertion in `test/installer.test.ts` after `test/update-regression.test.ts` had already been repaired. This confirmed that all updater contract suites had to be searched rather than correcting only the initially identified file.
- CI run #896 on head `c89c12f431a20dfd1d66f5b1285f645f40ecd3d9` passed every workflow step, including `Validate system scripts`.

## Decision Log

- Use a private non-sticky control directory rather than changing kernel settings or file permissions.
- Keep the parent updater responsible for process-group observation and termination.
- Extend the existing transformed-updater harness instead of testing a copied launch command.
- Model the protected-regular boundary deterministically in the harness while continuing to execute the transformed production updater.
- Leave Docker package, daemon, storage, systemd, socket, group, and Codex lifecycle logic unchanged because the production failure occurred before that code executed.

## Outcomes & Retrospective

The production failure was reproduced as an ownership-boundary error in the PGID handoff, not as a Docker Engine or package-provisioning defect. The updater now uses a private `0700` control directory, preserving the administrator-owned readable handoff while allowing the privileged process to publish its PGID without triggering sticky-directory regular-file protection. Cleanup is verified across all updater completion and failure scenarios.

The first CI pass also found a second stale runtime-entrypoint contract test left by the prior change. After correcting both stale assertions, CI #896 passed typecheck, all Node tests with coverage, production runtime validation, shell syntax, Node script validation, toolchain validation, the complete updater integration matrix, and Docker repository-safe tests. Final review found no changes to the Docker provisioner implementation itself and no remaining regression in the Docker launch/control scope.
