# Install Docker for Codex with persistent host storage

This ExecPlan follows `.agent/PLANS.md` and is the only active plan for this pull request.

## Purpose

Make `./update.sh` install and maintain rootful Docker Engine, Buildx, and Compose v2 for `github-runner`, so Codex can use the ordinary `/usr/bin/docker` CLI and the local Unix socket.

Docker Engine and containerd must use permanent state below `/srv/github-runner/storage/docker` from their first start:

- Docker Engine: `/srv/github-runner/storage/docker/engine`;
- containerd: `/srv/github-runner/storage/docker/containerd`.

The supported initial state includes a clean host or an unmarked host containing only safely removable Docker/containerd configuration remnants from an earlier installation. These remnants may include dpkg residual-configuration records and allowlisted Docker-specific configuration artifacts not owned by dpkg. The provisioner cleans that state, reruns the complete fresh-host preflight, creates the final storage directories directly, and configures both daemons before their first activation.

Package-created default data directories are valid only when empty and are removed before startup. Populated Docker or containerd data, mounted content, and unrelated configuration are never deleted or migrated by this PR. Later updates may reuse only the exact managed installation created by this feature.

Agent Relay exposes the ordinary host CLI and socket. Codex owns application-container lifecycle decisions.

## Current Baseline

The branch is based on `main` commit `7c148c242feb421b59647f144ab6b78fe691af28`. Preserve its normalized Codex output, transcript, timeout, finalization, workflow, API, routing, and sandbox behavior.

The existing `.github/workflows/codex.yml` supports manual dispatch and direct Codex execution. No workflow change is required.

Implementation history:

- `34d4d2bd2d6b367908ade9a284d126c522c8cdf7` implemented exact package, plugin-entry, systemd alias/activation-link, unit-root, service/socket, phase-recovery, sudo, process-group, repository, and storage boundaries.
- `ce9e3cc6fa0e86cf5db554e3fa69ebed9916600c` made related dpkg residual-config records visible but rejected them.
- `f38f03e9e6ee59d8ade208c9632acbf5d20db5f2` added exact bounded `dpkg --purge`, package-remnant safety checks, and post-purge reclassification.
- `4da52b310deab6f69899e68f5fa5b04342e4cff3` added cleanup of non-package-owned Docker configuration, apt sources and keys, Docker CLI plugins, systemd units and links, inactive sockets, and stale systemd manager state.
- `270afa389a7b66ad68d581fc579e0e2b85495781` added complete reclassification between cleanup mutations, recovery of interrupted `/etc/apt/sources.list` rewrite stages, and cleanup of all direct Docker CLI plugin entry types. Its Codex run passed the complete repository check.

Independent review of `270afa3` found one remaining data-safety issue in recursive cleanup. Treat the implementation as incomplete until it is fixed and exact-head normal CI passes.

## Scope and Trust Model

- The target is a dedicated external Debian VM.
- There is no hostile local-user threat model for this PR.
- Codex intentionally receives root-equivalent authority through membership in the rootful Docker group.
- The operating system's standard root-owned filesystem hierarchy is trusted.
- The provisioner may clean allowlisted Docker/containerd configuration artifacts when no Agent Relay Docker marker exists and no active installation or Docker data exists.
- The provisioner must not take over an installed or partially installed foreign runtime, delete populated Docker data, traverse mounted cleanup content, delete unrelated/global configuration, or silently adopt active service state.
- This PR does not add a general ancestor-chain hardening framework. Mount-point protection is part of the explicit no-data-deletion contract, not concurrent-local-attacker hardening.

## Binding Decisions

- Provision Docker only from `update.sh`.
- Support Debian x86-64 through Docker's official apt repository.
- Install `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, and `docker-compose-plugin` with the resolver-selected dependency closure.
- Create the final Engine and containerd roots before first activation.
- Do not copy or migrate Docker data. The final directories are created directly.
- Recognize a clean fresh host, a cleanable unmarked Docker-remnant host, an interrupted transaction created by this feature, or the exact completed managed state.
- A dpkg `rc` record is cleanable compatibility state, not an automatic rejection.
- Cleanup eligibility requires no installed, unpacked, half-configured, trigger-state, or otherwise active/partial related package; no effective Docker/containerd command; no running Docker/containerd process; no active or nonterminal managed unit; and no populated managed or default data root.
- Remove residual package configuration using a deterministic exact package list derived from dpkg. Do not use wildcard expansion, a dependency resolver, shell-generated package expressions, or unconstrained purge.
- Configuration cleanup does not depend on dpkg ownership. A previous installation may leave manually created configuration, repository definitions, plugin entries, unit overrides, activation links, aliases, or a stale inactive socket.
- Cleanup is restricted to Docker/containerd-specific paths and entries already covered by the provisioner's inventories:
  - `/etc/docker` and `/etc/containerd` configuration content;
  - Docker apt source definitions and known Docker keyring files, preserving unrelated content in shared source files;
  - direct entries in supported Docker CLI plugin search directories;
  - Docker/containerd units, drop-ins, aliases, and activation links under supported roots;
  - `/run/docker.sock` and `/var/run/docker.sock` only after exact unit/process inspection proves they are stale and inactive;
  - empty default or managed Docker/containerd directories allowed by the fresh-state contract;
  - exact same-directory temporary files created by this cleanup implementation.
- Do not delete unrelated files from shared apt source files, systemd roots, or other shared directories.
- Cleanup must be idempotent and restartable before package purge, during package purge, after package purge, during source rewriting, and during removal of any other artifact family.
- Each destructive cleanup stage is separated by a complete unmarked-host reclassification. Do not reuse safety evidence gathered before a prior mutation.
- Before recursively removing an allowlisted directory, prove that neither the selected directory nor any descendant is a mount point or bind mount. `rm --one-file-system` alone is not sufficient because a command-line root may itself be mounted and same-device bind mounts do not create a device boundary.
- Mounted cleanup state is rejected without deletion. The operator must unmount it before rerunning `update.sh`; the provisioner does not unmount arbitrary filesystems.
- Continue to managed repository/configuration/package installation only after a complete classification resolves to ordinary fresh state.
- Populated data, mounted cleanup trees, installed/partial packages, foreign effective commands, active/nonterminal units or processes, unrelated policy state, or configuration outside the allowlist remain unsupported and must not be deleted to force installation.
- Managed marker phases remain exact. Do not reinterpret a damaged completed installation as an unmarked fresh host.
- Ensure `github-runner` belongs to `docker`; ensure `agent-relay-builder` does not.
- Validate the effective official CLI and plugins, local socket, service enablement and activity, storage roots, package ownership, unit ownership, and group boundaries.
- Run `hello-world` on the first successful installation or explicit host acceptance. A completed repeated update must not require registry access.
- Docker group membership is intentionally root-equivalent on the dedicated runner VM.
- Keep application-container lifecycle under Codex control.
- Keep current GitHub Actions workflows unchanged.

## Implemented Work That Must Be Preserved

The final change must retain all behavior already implemented and validated in prior iterations:

1. The updater authenticates sudo in the controlling shell, stops the runner, waits for active `Runner.Worker` processes, builds and finalizes the runtime, and restores the runner only after the complete root provisioner process group is gone.
2. TERM, INT, HUP, sudo-expiry, provisioner deadline, failed signal delivery, descendant survival, TERM/KILL escalation, and bounded reaping have deterministic behavior.
3. The Docker provisioner supports fresh, preparing, transaction, installed, and complete states with atomic markers and deterministic recovery of owned interrupted work.
4. The managed `policy-rc.d` blocks only Docker Engine, Docker socket, and containerd activation, is recoverable in the preparing phase, and cannot remain after package completion.
5. Dpkg recovery accepts only the recorded transaction plus safe trigger-pending or trigger-awaited states and rejects unrelated dirty package work.
6. Docker's apt source and key are exact, securely published, fingerprint-validated, and checked for duplicate, conflicting, disabled, or insecure repository definitions.
7. Package selection uses one apt metadata refresh, exact official candidates, a simulated resolver result, independently validated dependency closure, and exact version pins.
8. Engine and containerd configuration and state are created directly at the final `/srv/github-runner/storage/docker` paths before first activation.
9. Empty package-created default data directories are removed before activation; populated default directories are rejected.
10. Effective `docker`, `dockerd`, `containerd`, and `ctr` commands are resolved through the production Codex toolchain PATH and must be official package-owned executables.
11. Every direct entry in all supported Docker CLI plugin search directories is inventoried in managed phases. Fresh/preparing state permits none; interrupted and complete state permits only expected package-owned Buildx and Compose entries.
12. Systemd unit roots, direct units, drop-ins, aliases, `*.wants`, and `*.requires` entries are inventoried. Only the exact package units and three managed activation links are accepted in managed state.
13. Interrupted service state validates `LoadState`, `ActiveState`, `SubState`, fragment paths, socket presence, and Docker/containerd processes. Provably owned partial activation is stopped and proven absent before package recovery.
14. Completed state validates rather than repairs exact packages, repository, configuration, units, activation links, service activity and enablement, socket metadata, storage roots, CLI plugins, and group membership.
15. Containerd validation uses package-owned `/usr/bin/ctr`, a clean environment, the explicit local socket, a bounded timeout, and exact metadata-root parsing.
16. `github-runner` can run Docker, Buildx, Compose, logs, and exec through the ordinary host CLI and socket; `agent-relay-builder` remains outside the Docker group.
17. Existing API, routing, output, transcript, finalization, commit-decision, workflow, and sandbox contracts remain unchanged.
18. Exact related `rc` package records are separated from active/partial package state, purged with bounded direct `dpkg --purge -- <exact packages>`, and verified absent.
19. Non-package-owned Docker configuration, apt definitions, keyrings, plugin entries, unit artifacts, stale manager state, and inactive sockets can be classified as unmarked cleanup state independently of `rc` records.
20. Shared apt files are rewritten atomically to remove Docker definitions while preserving unrelated lines or deb822 stanzas; mixed-URI deb822 stanzas are rejected rather than partially deleted.
21. Configuration-only cleanup can resume after the final `rc` record has already disappeared.
22. Cleanup now runs as a classify -> one mutation stage -> classify loop, so package purge is followed by a complete safety reclassification before configuration deletion.
23. Exact `.agent-relay-docker-cleanup.tmp.*` stages under `/etc/apt`, `/etc/apt/keyrings`, and `/etc/apt/sources.list.d` are inventoried and removed without matching similarly named unrelated files.
24. Plugin cleanup inventories every direct entry and can remove regular files, executables, symlinks, dangling symlinks, FIFOs/devices, and directories while preserving the search directory.

## Re-evaluated Review Notes

The earlier proposal for broad plugin-root metadata and ancestor-chain validation is not a merge blocker under the agreed dedicated-VM trust model. Do not reintroduce it.

Manual privileged real-host acceptance is performed after merge. Lack of an automated disposable-host lifecycle is not a blocker for this PR.

## Current Independent Review Finding

1. **Recursive cleanup can erase a mounted filesystem.** `docker_host_remove_cleanup_remnants` uses `rm -rf --one-file-system` for configuration directories, direct plugin directories, and unit/drop-in directories. GNU `rm --one-file-system` uses the command-line directory as the starting filesystem. If that selected directory is itself a mount point or bind mount, its contents are on the starting filesystem and may be deleted before removal of the busy mount point fails. A same-device bind mount below a cleanup tree is also not protected by a device comparison. Add one exact, testable mount-boundary helper based on `/proc/self/mountinfo`, `findmnt`, or an equivalent deterministic source. Before recursively inventorying or deleting an allowlisted cleanup tree, reject the state if the tree root or any descendant is mounted. Apply the helper to `/etc/docker`, `/etc/containerd`, direct plugin directories selected for recursive removal, and unit/drop-in directories. Do not unmount or delete mounted content.

Normal CI on the exact final production head is an acceptance step, not an implementation finding.

## Implementation Work

1. Add a mount/bind-mount inspection helper with fixed absolute tooling and clean parsing. It must distinguish an ordinary directory from an exact mount point and detect descendant mount points, including bind mounts on the same device.
2. Call the helper during non-destructive cleanup inventory, before any recursive target is accepted. Recheck immediately before recursive deletion so stale pre-mutation evidence is not reused.
3. Apply the check to Docker/containerd configuration roots, direct plugin directories, and Docker/containerd unit/drop-in directories selected for recursive cleanup.
4. Keep direct unlinking of files, symlinks, sockets, FIFOs, and device nodes unchanged; the mount check is required only for recursive directory removal and any tree inventory that could cross a mount.
5. Reject mounted cleanup state with a precise inspection error and perform no cleanup mutation.
6. Add deterministic tests through a mount-inspection seam for mounted configuration roots, mounted plugin direct directories, mounted unit/drop-in directories, descendant bind mounts, ordinary safe directories, and recheck-before-delete behavior.
7. Preserve all prior cleanup and managed-state regression behavior.
8. Run one complete `npm run check` after the final production edit.
9. Review the final diff point by point against this plan.
10. Publish a connector-authored status commit on the exact final implementation tree and require normal CI to pass.
11. Complete independent final job-log and code review before merge.

## Repository-Safe Tests

Required new coverage:

- an ordinary configuration root with no mounted descendants remains cleanable;
- a configuration root that is itself a mount point is rejected before inventory/removal;
- a descendant mount or same-device bind mount under `/etc/docker` or `/etc/containerd` is rejected without deleting content;
- a direct plugin directory that is a mount point is rejected without deleting mounted content;
- a mounted descendant inside a direct plugin directory is rejected;
- a Docker/containerd unit or drop-in cleanup directory that is mounted or contains a mounted descendant is rejected;
- the mount helper is called again immediately before recursive deletion;
- direct non-directory plugin/unit/config artifacts remain removable;
- cleanup failure due to mounted state occurs before package/repository/configuration installation, marker publication, or service activation.

Required regression coverage:

- complete reclassification between cleanup mutation stages;
- exact `/etc/apt` cleanup-stage recovery;
- all direct plugin entry types;
- exact package and selected dependency closure;
- repository and key publication and validation;
- phase markers and interruption recovery;
- narrowly scoped `policy-rc.d`;
- dpkg trigger recovery and unrelated dirty-state rejection;
- storage and configuration exactness;
- effective production PATH command resolution;
- exact Docker CLI plugin inventories in managed state;
- systemd unit, alias, activation-link, root metadata, enablement, and service-state checks;
- socket and process cleanup before managed transaction recovery;
- bounded explicit containerd inspection;
- sudo timestamp, process-group, signal, timeout, runtime-finalization, and runner-restoration ordering;
- executor, finalizer, output, workflow, API, routing, sandbox, and workspace-ownership regressions;
- exactly one active ExecPlan and no workflow changes.

## Acceptance Criteria for This PR

- `update.sh` installs the exact managed Docker stack on a clean host and on an otherwise-safe unmarked host containing only allowlisted Docker/containerd remnants.
- Cleanup covers residual package configuration and non-package-owned Docker-specific configuration remnants.
- Cleanup is exact, deterministic, bounded, idempotent, restartable, verified, and separated by complete safety reclassification at every destructive mutation boundary.
- Recursive cleanup never inventories through or deletes a mounted filesystem or bind mount.
- No Docker data migration or copying mechanism exists.
- Populated Docker or containerd data is never deleted to force installation.
- Unrelated configuration in shared files or roots is preserved.
- Engine and containerd use the required permanent roots from their first start.
- Interrupted owned phases resume without an undocumented manual repair step.
- Completed updates validate rather than repair managed state.
- A repeated update performs no unnecessary package mutation or registry access.
- Installed, partial, active, command-shadowed, mounted, or mixed foreign runtime state fails before destructive mutation.
- Package selection uses one apt snapshot and cannot admit an unselected alternative or unrelated dependency.
- The updater cannot restore the runner while a root provisioner process may still be alive.
- `github-runner` can use the effective official Docker CLI, Buildx, Compose, and socket; `agent-relay-builder` cannot.
- Current documentation does not claim the feature before acceptance is complete.
- `npm run check`, the Codex validation gate, and normal CI pass on the exact final head.
- Independent final review finds no unresolved correctness, data-safety, restartability, maintainability, scope, or current-main regression issue.

## Post-Merge Manual Acceptance

Privileged real-host acceptance is intentionally manual and is not a blocker for this PR.

After merge, the operator will run `update.sh` on the designated Debian VM and manually confirm installation, cleanup of prior Docker configuration where applicable, persistent storage roots, Docker/Buildx/Compose access, Compose startup, logs, exec, shutdown, repeated update behavior, and runner workspace ownership. If that manual acceptance finds a defect, open a new ExecPlan and follow-up PR. Do not keep this PR open solely because an automated disposable-host lifecycle is unavailable.

## Progress

- [x] Established the fresh-host permanent-storage architecture and direct final storage roots.
- [x] Confirmed that no Docker data migration or copying mechanism is needed.
- [x] Confirmed that the existing Codex workflow is sufficient and no workflow edit is required.
- [x] Implemented and independently reviewed the original package, phase, process, storage, plugin, systemd, and service boundaries.
- [x] `34d4d2bd` passed complete repository-safe validation.
- [x] Re-evaluated broad ancestor-chain hardening against the actual dedicated-VM trust model; it is not a merge blocker.
- [x] `ce9e3cc6` made residual-config records visible.
- [x] `f38f03e9` implemented exact bounded package cleanup and post-purge reclassification.
- [x] `4da52b3` implemented non-package-owned Docker-remnant cleanup and shared-source preservation.
- [x] `270afa3` fixed complete post-purge reclassification, `/etc/apt` cleanup-stage recovery, and arbitrary direct plugin-entry cleanup; its Codex validation passed.
- [x] Independently reviewed `270afa3` and recorded the mounted-tree data-safety blocker.
- [ ] Implement mounted-tree rejection and recheck-before-recursive-delete with behavioral tests.
- [ ] Run final repository and Codex validation.
- [ ] Publish a connector-authored exact final status commit and require normal CI to pass.
- [ ] Complete independent final diff and job-log review.
- [ ] Merge the PR after the acceptance criteria pass.
- [post-merge] Perform manual privileged host acceptance; open a new plan only if it exposes a defect.

## Decision Log

- Use one permanent managed storage tree below `/srv/github-runner/storage/docker`.
- Create both final roots before first activation.
- Do not migrate or copy Docker data.
- Permit automatic cleanup of allowlisted Docker/containerd configuration state on an otherwise-safe unmarked host.
- Do not require cleanup files to be owned by an `rc` package.
- Do not delete populated or mounted data and do not take over active, installed, partial, command-shadowed, or mixed foreign runtime state.
- Preserve unrelated configuration in shared files and roots.
- Make cleanup recognizable after package records disappear.
- Rerun the complete unmarked classification after every destructive cleanup stage.
- Reject recursive cleanup targets that are mount points or contain mounted descendants; do not unmount them automatically.
- Permit mutation of a managed installation only while completing an exact owned initial transaction; completed state remains validation-only.
- Trust the dedicated VM's standard root-owned operating-system hierarchy; do not add general ancestor-chain hardening in this PR.
- Confirm the full provisioner process group is gone before runner restoration.
- Keep application-container lifecycle under Codex control.
- Keep GitHub Actions workflows unchanged.
- Complete privileged real-host acceptance manually after merge; defects found there become a new plan.

## Surprises & Discoveries

- Default sudo timestamps are parent-process scoped in non-TTY use, so refresh must occur from the authenticated controlling shell.
- An interrupted apt transaction can leave unrelated trigger processors in trigger-pending or trigger-awaited state; bounded recovery distinguishes them from unrelated dirty package work.
- Package installation can leave official unit files present while systemd still reports `LoadState=not-found` before its dpkg reload trigger; this is valid only in the transaction phase.
- Docker activation can be interrupted in multiple nonterminal systemd states; recovery proves the exact fragment/socket/process relationship before stopping services.
- Docker CLI searches several plugin directories, so exact inventory covers every configured search root rather than only known filenames.
- Dpkg residual-config state is globally clean and has no package payload, but can retain package configuration.
- Docker configuration commonly includes files not registered as package conffiles; dpkg ownership cannot define the complete cleanup boundary.
- Cleanup detection cannot depend only on `rc`: package purge can finish before configuration cleanup.
- Dpkg purge can remove unit files before systemd forgets inactive units, requiring an exact daemon-reload recovery path.
- Shared apt-source cleanup requires same-directory atomic rewriting and explicit recovery of the temporary file in every possible source directory, including `/etc/apt`.
- Direct plugin cleanup must support every filesystem entry type without deleting the plugin search root.
- `rm --one-file-system` protects crossings below an ordinary starting directory but does not protect a command-line target that is itself mounted; same-device bind mounts also require mount-table inspection.
- Codex-token pushes may leave normal CI as `action_required`; a connector-authored final status commit is needed for exact-head CI evidence.

## Outcomes & Retrospective

Not complete. Keep this plan active until mounted-tree cleanup protection, complete repository validation, exact-head normal CI, and independent final review pass. Manual privileged host acceptance happens after merge and is not part of this PR's blocking acceptance.