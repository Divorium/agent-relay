# Install Docker for Codex with persistent host storage

This ExecPlan follows `.agent/PLANS.md` and is the only active plan for this pull request.

## Purpose

Make `./update.sh` install and maintain rootful Docker Engine, Buildx, and Compose v2 for `github-runner`, so Codex can use the ordinary `/usr/bin/docker` CLI and the local Unix socket.

Docker Engine and containerd must use permanent state below `/srv/github-runner/storage/docker` from their first start:

- Docker Engine: `/srv/github-runner/storage/docker/engine`;
- containerd: `/srv/github-runner/storage/docker/containerd`.

The supported initial state is a fresh host without an existing Docker installation or Docker data. The provisioner creates the final storage directories directly and configures both daemons before their first activation. Package-created default directories are valid only when empty and are removed before startup. Later updates may reuse only the exact managed installation created by this feature.

Agent Relay exposes the ordinary host CLI and socket. Codex owns application-container lifecycle decisions.

## Current Baseline

The branch is based on `main` commit `7c148c242feb421b59647f144ab6b78fe691af28`. Preserve its normalized Codex output, transcript, timeout, finalization, workflow, API, and routing behavior.

The existing `.github/workflows/codex.yml` supports manual dispatch and direct Codex execution. No workflow change is required.

Codex revision `34d4d2bd2d6b367908ade9a284d126c522c8cdf7` implemented exact related-package, plugin-entry, systemd alias/activation-link, unit-root, and service/socket inventories and passed a complete repository-safe validation in workflow run `29747072289`. Independent review found the remaining path-integrity blockers below. Treat the implementation as incomplete.

## Binding Decisions

- Provision Docker only from `update.sh`.
- Support Debian x86-64 through Docker's official apt repository.
- Install `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, and `docker-compose-plugin` with the resolver-selected dependency closure.
- Create the final Engine and containerd roots before first activation.
- Recognize only a fresh supported state, an interrupted transaction created by this feature, or the exact completed managed state.
- Reject every unrecognized Docker, containerd, runc, CLI plugin, configuration, unit, alias, activation link, socket, policy, package, or data state before package or recovery mutation.
- Treat residual package configuration, writable search roots, and writable ancestor paths as occupied unsafe state.
- Ensure `github-runner` belongs to `docker`; ensure `agent-relay-builder` does not.
- Validate the effective official CLI and plugins, local socket, service enablement and activity, storage roots, package ownership, unit ownership, and group boundaries.
- Run `hello-world` on the first successful installation or explicit host acceptance. A completed repeated update must not require registry access.
- Docker group membership is intentionally root-equivalent on the dedicated runner VM.
- Keep application-container lifecycle under Codex control.
- Keep current GitHub Actions workflows unchanged.

## Current Independent Review Findings

1. **Docker CLI plugin search roots are not protected state.** `docker_host_plugin_inventory_validate` checks only that each search path is a non-symlink directory and inventories its entries. It does not validate owner, mode, canonical path, or ancestor traversal. A group/world-writable system plugin directory, or a secure leaf below a writable parent, can contain the exact package-owned plugins during validation and replace them before Codex executes Docker. Define metadata by directory class: system plugin roots must be canonical root-owned and not writable by group or others; any runner-owned plugin root must have the exact runner owner and restrictive mode. Validate the existing ancestor chain required to reach each root.

2. **Critical path validation stops at the leaf.** `docker_host_secure_path` validates one path but not its parent chain. `docker_host_unit_roots_safe` therefore accepts a secure unit or activation directory below a writable parent. The same weakness affects plugin roots and any publication/configuration path whose contents remain trusted after validation. Add one reusable canonical ancestor-chain validator. Apply it to systemd unit roots and activation directories, Docker CLI plugin roots, managed configuration and marker directories, storage roots, repository/key directories, and other trusted persistent paths. Reject symlinked, non-root-owned, or group/world-writable system ancestors. Preserve explicitly documented ownership boundaries for the runner home and per-run state.

3. **Residual-config related packages are treated as never installed.** `docker_debian_related_package_records` excludes every related package whose current dpkg state is `c`; the repository-safe test explicitly expects `runc|rc` to disappear from the inventory. A residual-config package can retain conffiles outside the currently enumerated paths. Fresh and completed exact state must reject Docker/containerd/runc/rootless/plugin-related packages in residual-config state. Interrupted transaction recovery may accept only package states that can be produced by the recorded owned apt transaction; it must not silently reinstall a package removed to residual-config state after marker publication.

4. **The final production head needs normal CI evidence.** Codex-token push run `29748504311` ended as `action_required` with zero jobs. After the final production fix and independent review, publish a connector-authored plan/status commit and require normal CI on that exact head.

## Implementation Work

1. Add exact metadata and ancestor-chain validation for every Docker CLI plugin search root, distinguishing system-owned and runner-owned roots.
2. Introduce one production ancestor-chain validator and apply it consistently to all persistent trusted path families before mutation and during completed-state validation.
3. Include residual-config related packages in phase inventories and reject them unless an exact documented owned transaction state proves they are valid; normal fresh and completed paths must reject them.
4. Add deterministic behavioral tests for unsafe plugin-root metadata, writable or symlinked ancestors, and related packages in residual-config state across fresh, interrupted, and completed phases.
5. Preserve the exact entry inventories, service/socket recovery model, direct Docker access, Codex-owned application lifecycle, current documentation boundaries, and unchanged workflows.
6. Run one complete `npm run check` after the last production edit.
7. Review the final diff point by point against this plan, then obtain normal CI evidence on a connector-authored exact final head.

## Repository-Safe Tests

Required coverage includes:

- root-owned safe system plugin roots and exact runner-owned plugin roots continuing to pass;
- group-writable, world-writable, noncanonical, symlinked, and wrong-owner plugin roots failing before mutation;
- writable, wrong-owner, or symlinked ancestors above systemd unit roots, activation directories, plugin roots, managed configuration, marker, storage, repository, and key directories;
- the legitimate runner-home ownership boundary passing without weakening system-owned ancestors;
- fresh-state rejection of `rc` Docker, containerd, runc, rootless, Buildx, Compose, and related plugin packages;
- interrupted transaction rejection of a marker package externally changed to residual-config state;
- completed-state rejection of any related residual-config package not represented by valid installed marker state;
- all previously implemented package, plugin-entry, repository, key, dependency, phase, policy, storage, sudo, process-group, systemd alias/activation, service/socket, executor, finalizer, workflow, and sandbox regressions;
- exactly one active ExecPlan and no workflow changes.

## Real-Host Acceptance

Repository-safe tests cannot prove privileged apt, dpkg, systemd, daemon, socket, group, storage-root, registry, or real Compose behavior.

The automated disposable or explicitly designated Debian 13 x86-64 systemd host lifecycle must cover:

- a clean host with no Docker installation, residual package configuration, or data;
- first installation without premature activation;
- effective Engine and containerd roots below `/srv/github-runner/storage/docker`;
- absence of data written to default roots;
- first-install `hello-world`;
- a repeated update with registry access disabled;
- exact package, plugin, repository, configuration, unit, alias, activation-link, socket, ownership, ancestor, and group evidence;
- interruption and rerun at repository, configuration, marker, policy, apt, dpkg-trigger, service-start, validation, and completion-marker boundaries;
- non-TTY sudo timestamp behavior plus TERM, INT, HUP, timeout, and failed-signal behavior;
- a real Agent Relay request where Codex starts Compose, reads logs, executes a command, leaves the workspace runner-owned, and shuts the project down.

If this lifecycle is unavailable, keep the item blocked with its exact cause and unblock condition. Do not claim host acceptance.

## Acceptance Criteria

- `update.sh` installs the exact managed Docker stack on the supported fresh host.
- Engine and containerd use the required permanent roots from their first start.
- Interrupted owned phases resume without an undocumented manual repair step.
- Completed updates validate rather than repair package, plugin, repository, configuration, unit, service, socket, group, and storage state.
- A repeated update performs no unnecessary package mutation or registry access.
- Every unrecognized related package state, unsafe plugin root, unsafe ancestor path, plugin entry, unit alias, activation link, or inconsistent socket/service state fails before package or recovery mutation.
- Package selection uses one apt snapshot and cannot admit an unselected alternative or unrelated dependency.
- The updater cannot restore the runner while a root provisioner process may still be alive.
- `github-runner` can use the effective official Docker CLI, Buildx, Compose, and socket; `agent-relay-builder` cannot.
- Current documentation does not claim the feature before acceptance is complete.
- `npm run check`, the Codex validation gate, and normal CI pass on the exact final head.
- Independent final review finds no unresolved correctness, security, restartability, maintainability, scope, or current-main regression issue.

## Progress

- [x] Established the fresh-host permanent-storage architecture and direct final storage roots.
- [x] Implemented and independently reviewed the first four provisioner revisions.
- [x] Codex revision `34d4d2bd2d6b367908ade9a284d126c522c8cdf7` passed its complete repository-safe validation in run `29747072289`.
- [x] Completed independent review of `34d4d2bd2d6b367908ade9a284d126c522c8cdf7` and recorded the current blockers above.
- [ ] Implement the current path-integrity and residual-package fixes with behavioral tests.
- [ ] Run final repository validation, Codex validation, and normal CI on the exact final head.
- [ ] Complete independent final diff and job-log review.
- [blocked] Run automated privileged real-host acceptance. Cause: no approved disposable or designated Debian 13 x86-64 systemd host lifecycle is available. Impact: repository-safe tests cannot prove privileged host behavior. Unblock condition: provide the automated lifecycle and captured evidence described above.

## Decision Log

- Use one permanent managed storage tree below `/srv/github-runner/storage/docker`.
- Create both final roots before first activation.
- Permit mutation only while completing an exact owned initial transaction; completed state is validation-only.
- Treat package, plugin, unit, alias, activation-link, socket, directory, and ancestor inventories as exact state.
- Treat residual package configuration as occupied state, not absence.
- Confirm the full provisioner process group is gone before runner restoration.
- Keep current-state documentation unchanged until exact-head CI, independent review, and privileged host acceptance are complete.

## Outcomes & Retrospective

Not complete. Keep this plan active until implementation, exact-head CI, independent final review, and privileged host acceptance satisfy the criteria above.
