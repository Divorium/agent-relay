# Install Docker for Codex with persistent host storage

This is the only active ExecPlan for PR #26.

## Purpose

Make `./update.sh` install and maintain rootful Docker Engine, Buildx, and Compose v2 for `github-runner`. Codex uses the ordinary `/usr/bin/docker` CLI and local Unix socket.

Permanent state is created directly before first activation:

- Engine: `/srv/github-runner/storage/docker/engine`
- containerd: `/srv/github-runner/storage/docker/containerd`

There is no data migration or copying path.

## Final Scope

Supported inputs:

- a clean Debian x86-64 host;
- an otherwise-safe unmarked host containing only allowlisted Docker/containerd remnants;
- an exact interrupted transaction created by this feature;
- the exact completed managed state.

An unmarked cleanup host may contain related dpkg `rc` records, manually created Docker/containerd configuration, old Docker apt definitions and keyrings, Docker CLI plugins, Docker/containerd unit artifacts, an inactive stale socket, or stale inactive systemd manager state.

Cleanup is allowed only after proving that there are no installed or partial related packages, effective foreign commands, running Docker/containerd processes, active or nonterminal managed units, populated managed data, or populated default data roots.

Populated data, active installations, unrelated configuration, and mounted cleanup content are never removed to force installation.

Operational work performed after merge is outside this ExecPlan and is not a required action item for this PR.

## Binding Decisions

- Provision Docker only through `update.sh`.
- Use Docker's official Debian apt repository.
- Install `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, and `docker-compose-plugin` with the validated resolver-selected dependency closure.
- Treat exact dpkg `rc` records as cleanable compatibility state.
- Purge only exact recorded related package names through a bounded direct dpkg operation.
- Clean allowlisted Docker-specific configuration independently of dpkg ownership.
- Preserve unrelated content in shared apt files and systemd roots.
- Run cleanup as classify -> one mutation stage -> classify. A destructive stage never reuses evidence collected before an earlier mutation.
- Recover interrupted same-directory apt source rewrites.
- Inventory every direct entry in supported Docker CLI plugin search roots.
- Reject mounted cleanup roots and mounted descendants, including same-device bind mounts.
- Parse `/proc/self/mountinfo` and decode its path escapes.
- Recheck recursive targets immediately before recursive removal.
- Record plugin, systemd, and apt cleanup roots during inventory and recheck them before direct-entry mutation.
- Recheck apt roots before source rewrite/removal, key removal, cleanup-stage removal, and apt key inventory.
- Recheck systemd roots before unit removal and before daemon reload.
- Keep `github-runner` in the Docker group and `agent-relay-builder` outside it.
- Keep application-container lifecycle under Codex control.
- Keep existing workflows, API, routing, output, finalization, and sandbox contracts unchanged.

## Implementation History

- `34d4d2bd2d6b367908ade9a284d126c522c8cdf7`: package, phase, sudo, process-group, repository, storage, plugin, unit, alias, activation-link, service, and socket boundaries.
- `ce9e3cc6fa0e86cf5db554e3fa69ebed9916600c`: related residual-package states became visible.
- `f38f03e9e6ee59d8ade208c9632acbf5d20db5f2`: bounded exact residual-package cleanup and post-cleanup classification.
- `4da52b310deab6f69899e68f5fa5b04342e4cff3`: cleanup of non-package-owned configuration, repository/key state, plugins, units, links, sockets, and stale manager state.
- `270afa389a7b66ad68d581fc579e0e2b85495781`: complete reclassification between mutations, `/etc/apt/sources.list` staging recovery, and all direct plugin-entry types.
- `24db7051e573beb3bbb7d2f565bc5bbfe30a767c`: mounted recursive-root and descendant protection with pre-delete rechecks.
- `af383c9fbc915e45f907f0b4b6ac23a1840ae71c`: mounted shared plugin, systemd, and apt root protection with direct-mutation and daemon-reload rechecks.

Codex workflow run `29756594484` completed successfully for `af383c9f`. Both the validation and implementation jobs passed.

## Implemented Contracts

1. The updater obtains sudo authority in its controlling shell, stops the runner, waits for active runner workers, finalizes the runtime, and restores the runner only after the full root provisioner process group has exited.
2. TERM, INT, HUP, sudo expiry, deadlines, failed signal delivery, descendant survival, and TERM/KILL escalation are bounded and deterministic.
3. Provisioning has exact fresh, preparing, transaction, installed, and complete states with atomic markers and owned recovery.
4. The temporary service-start policy covers only Docker Engine, Docker socket, and containerd and cannot remain after package completion.
5. Dpkg recovery is limited to the recorded transaction and acceptable trigger states.
6. Repository definitions, signing key, package candidates, dependency closure, and selected versions are validated before installation.
7. Engine and containerd are configured for their final storage roots before first activation.
8. Empty default data directories may be removed; populated ones are rejected.
9. Effective Docker/containerd commands and Buildx/Compose plugins must resolve to the expected package-owned artifacts.
10. Systemd direct units, drop-ins, aliases, activation links, fragment paths, activity, enablement, sockets, and processes are validated as exact state.
11. Completed state is validation-only; it is not silently repaired.
12. Related `rc` records are separated from active or partial package states, cleaned exactly, and verified absent.
13. Configuration-only cleanup remains restartable after all `rc` records disappear.
14. Shared apt files are rewritten atomically while preserving unrelated lines or stanzas. Ambiguous mixed repository stanzas are rejected.
15. Cleanup supports regular files, executables, symlinks, dangling symlinks, special entries, and directories in plugin roots while preserving the root itself.
16. Recursive and direct-entry cleanup does not traverse or mutate a selected root or descendant that is mounted.
17. Existing executor, finalizer, transcript, workflow, API, routing, sandbox, and workspace ownership behavior is preserved.

## Test Coverage

The repository-safe suite covers:

- clean, residual-package-only, configuration-only, and combined safe-remnant hosts;
- rejection of installed, partial, active, command-shadowed, process-bearing, mounted, and populated-data states;
- exact package cleanup and full reclassification between mutation stages;
- Docker/containerd configuration cleanup;
- apt source, keyring, and interrupted staging cleanup with unrelated-content preservation;
- all plugin-entry types;
- Docker/containerd units, drop-ins, aliases, activation links, sockets, and stale manager state;
- mounted recursive roots and descendants;
- mounted shared plugin, systemd, apt, keyring, and source roots;
- mount-after-inventory transitions and pre-mutation rechecks;
- mountinfo escape decoding and valid mounted ancestors above selected roots;
- exact package closure, repository, phase, service, storage, CLI, plugin, group, updater, signal, timeout, output, workflow, and sandbox regressions.

The final Codex run reported:

- 137 passing tests;
- 100% measured TypeScript source coverage;
- successful runtime, shell, Node-script, toolchain, installer, updater, and repository-safe checks.

## Independent Review

No unresolved correctness, data-safety, restartability, maintainability, scope, or current-main regression finding remains in `af383c9f`.

## Remaining Acceptance Work

Only automated repository acceptance remains:

1. normal CI must pass on this connector-authored exact head;
2. the resulting CI job log must be reviewed for hidden failures or skipped required checks.

No manual host task is required before merge.

## Acceptance Criteria

- Docker, Buildx, and Compose are installed and exposed to Codex through the ordinary host CLI and socket.
- Engine and containerd use the permanent roots from their first activation.
- Safe Docker-specific remnants, including `rc` state, are cleaned deterministically and restartably.
- Populated, active, partial, unrelated, or mounted state is not deleted or adopted.
- No migration or copying mechanism exists.
- Repeated updates validate the managed installation without unnecessary package mutation or registry access.
- `github-runner` can use Docker and `agent-relay-builder` cannot.
- Codex validation, `npm run check`, and normal exact-head CI pass.
- Independent final code and CI-log review finds no unresolved issue.

## Progress

- [x] Architecture and final storage roots established.
- [x] No-migration decision implemented.
- [x] Package, repository, phase, service, process, storage, plugin, systemd, cleanup, and mount boundaries implemented.
- [x] Exact `rc` and non-package-owned remnant cleanup implemented.
- [x] Complete reclassification between destructive stages implemented.
- [x] Atomic shared-source preservation and interrupted-stage recovery implemented.
- [x] Recursive-tree and shared-root mount protection implemented.
- [x] Codex workflow run `29756594484` passed.
- [x] `npm run check` passed with 137 tests and 100% measured TypeScript source coverage.
- [x] Independent implementation review found no remaining code issue.
- [ ] Normal CI passes on this connector-authored exact head.
- [ ] Exact-head normal-CI job log is reviewed.

## Decision Log

- Use direct final storage roots below `/srv/github-runner/storage/docker`.
- Do not migrate or copy Docker data.
- Automatically clean only allowlisted Docker/containerd remnants on an otherwise-safe unmarked host.
- Do not require cleanup files to be owned by a residual package.
- Preserve unrelated configuration.
- Reject populated, mounted, active, installed, partial, command-shadowed, or mixed foreign runtime state.
- Keep complete classification between destructive mutations.
- Protect recursive targets and shared roots using mount-table inspection and pre-mutation rechecks.
- Keep completed managed state validation-only.
- Trust the dedicated VM's standard root-owned operating-system hierarchy; general ancestor-chain hardening is outside this PR.
- Keep application-container lifecycle under Codex control.
- Keep workflows unchanged.
- Treat post-merge operational work as outside this plan, not as a blocking action item.

## Outcome

Implementation is complete. This connector-authored plan commit exists to obtain normal CI evidence on the exact final tree. After normal CI and its job-log review pass, PR #26 is ready to merge.