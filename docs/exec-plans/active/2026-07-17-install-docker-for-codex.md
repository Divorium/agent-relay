# Install Docker for Codex with persistent host storage

This ExecPlan follows `.agent/PLANS.md` and is the only active plan for this pull request.

## Purpose

Make `./update.sh` install and maintain rootful Docker Engine, Buildx, and Compose v2 for `github-runner`, so Codex can use the ordinary `/usr/bin/docker` CLI and the local Unix socket.

Docker Engine and containerd must use permanent state below `/srv/github-runner/storage/docker` from their first start:

- Docker Engine: `/srv/github-runner/storage/docker/engine`;
- containerd: `/srv/github-runner/storage/docker/containerd`.

The supported initial state includes either a clean host or an unmarked host that contains only safely removable dpkg residual-configuration records from an earlier Docker/container runtime installation. The provisioner must clean that residual package state, rerun the full fresh-host preflight, create the final storage directories directly, and configure both daemons before their first activation.

Package-created default data directories are valid only when empty and are removed before startup. Populated Docker or containerd data is never deleted or migrated by this PR. Later updates may reuse only the exact managed installation created by this feature.

Agent Relay exposes the ordinary host CLI and socket. Codex owns application-container lifecycle decisions.

## Current Baseline

The branch is based on `main` commit `7c148c242feb421b59647f144ab6b78fe691af28`. Preserve its normalized Codex output, transcript, timeout, finalization, workflow, API, routing, and sandbox behavior.

The existing `.github/workflows/codex.yml` supports manual dispatch and direct Codex execution. No workflow change is required.

Codex revision `34d4d2bd2d6b367908ade9a284d126c522c8cdf7` implemented the exact package, plugin-entry, systemd alias/activation-link, unit-root, service/socket, phase-recovery, sudo, process-group, repository, and storage checks described below. Revision `ce9e3cc6fa0e86cf5db554e3fa69ebed9916600c` made residual-config records visible but rejected them in every phase. That behavior conflicts with the revised requirement for an unmarked host: safe residual package configuration must be removed automatically before normal installation.

## Scope and Trust Model

- The target is a dedicated external Debian VM.
- There is no hostile local-user threat model for this PR.
- Codex intentionally receives root-equivalent authority through membership in the rootful Docker group.
- The operating system's standard root-owned filesystem hierarchy is trusted.
- The provisioner may clean dpkg residual configuration for Docker/containerd/runc/rootless/Buildx/Compose-related packages when no Agent Relay Docker marker exists and no active installation or Docker data exists.
- The provisioner must not take over an installed or partially installed foreign runtime, delete populated Docker data, or silently adopt unknown active service state.
- This PR does not attempt to make every trusted path durable against a concurrent privileged or local filesystem attacker.

## Binding Decisions

- Provision Docker only from `update.sh`.
- Support Debian x86-64 through Docker's official apt repository.
- Install `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, and `docker-compose-plugin` with the resolver-selected dependency closure.
- Create the final Engine and containerd roots before first activation.
- Do not copy or migrate Docker data. The final directories are created directly.
- Recognize a clean fresh host, a cleanable unmarked residual-config host, an interrupted transaction created by this feature, or the exact completed managed state.
- A dpkg `rc` record means the package payload was removed but residual package configuration remains. It is cleanable compatibility state, not an automatic rejection.
- On an unmarked host, permit automatic cleanup only when every present related package is in residual-config state and the existing non-package preflight proves there is no running runtime, socket, populated data root, active unit, or other unsupported installation state.
- Remove residual package configuration using a deterministic exact package list derived from dpkg. Do not use a broad name passed through a shell, dependency resolver, wildcard, or unconstrained purge.
- After cleanup, rerun the complete fresh-state inspection from the beginning. Continue only if the host now satisfies the normal fresh-state contract.
- Publish the exact managed Docker and containerd configuration after cleanup. Package-owned residual conffiles may be removed by the cleanup; the managed target files are then written atomically with Agent Relay's exact content.
- Unknown extra configuration files, populated default or managed data, foreign installed/partial package states, foreign commands, plugins, units, services, sockets, or processes remain unsupported and must not be deleted merely to force installation.
- Managed marker phases remain exact. Do not reinterpret an externally damaged completed installation as an unmarked fresh host.
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
11. Every direct entry in all supported Docker CLI plugin search directories is inventoried. Fresh/preparing state permits none; interrupted and complete state permits only the expected package-owned Buildx and Compose entries.
12. Systemd unit roots, direct units, drop-ins, aliases, `*.wants`, and `*.requires` entries are inventoried. Only the exact package units and three managed activation links are accepted.
13. Interrupted service state validates `LoadState`, `ActiveState`, `SubState`, fragment paths, socket presence, and Docker/containerd processes. Provably owned partial activation is stopped and proven absent before package recovery.
14. Completed state validates rather than repairs exact packages, repository, configuration, units, activation links, service activity and enablement, socket metadata, storage roots, CLI plugins, and group membership.
15. Containerd validation uses package-owned `/usr/bin/ctr`, a clean environment, the explicit local socket, a bounded timeout, and exact metadata-root parsing.
16. `github-runner` can run Docker, Buildx, Compose, logs, and exec through the ordinary host CLI and socket; `agent-relay-builder` remains outside the Docker group.
17. Existing API, routing, output, transcript, finalization, commit-decision, workflow, and sandbox contracts remain unchanged.

## Re-evaluated Review Notes

The previous plan version promoted plugin-root metadata and full ancestor-chain validation to merge blockers. They are not blockers under the agreed trust model.

- A blocker means an unresolved requirement that prevents accepting the PR; it does not mean the change is technically impossible.
- Full ancestor-chain validation can be implemented, but it hardens against writable-parent or local filesystem replacement attacks.
- This VM has no hostile local-user threat model, its standard root-owned operating-system hierarchy is trusted, and Codex intentionally receives root-equivalent Docker authority.
- A broad ancestor validator would add substantial complexity and false-rejection risk around legitimate Debian paths without materially improving the agreed deployment model.
- Keep the existing exact leaf, directory-entry, ownership, unit, repository, configuration, and service checks. Do not add a general parent-chain hardening framework in this PR.

## Current Independent Review Finding

1. **Residual-config compatibility is implemented as rejection instead of cleanup.** Revision `ce9e3cc6` retains related `rc` records in the inventory but `docker_host_validate_phase_packages` immediately rejects them. On an unmarked host where all related package records are `rc`, the provisioner must instead prove that the rest of the host is safe for cleanup, purge the exact residual package records, rerun the complete fresh-state preflight, and proceed with the ordinary managed installation. It must not delete populated data or take over active/partial package or service state.

Normal CI on the exact final production head is an acceptance step, not an implementation finding.

## Implementation Work

1. Split related package inventory into active/partial package state and residual-config-only state without losing exact package names, status, or versions.
2. Add an unmarked residual cleanup classification. It is valid only when every present related package record is `rc`; any installed, unpacked, half-configured, trigger, or other package state remains unsupported foreign state.
3. Before cleanup, run the non-destructive preflight needed to prove there is no active runtime, socket, process, populated Docker/containerd data, or other state that must not be deleted.
4. Purge the exact residual package list deterministically, without dependency resolution or wildcard expansion. Verify every targeted record is absent afterward.
5. Rerun the complete fresh classification after cleanup rather than continuing from stale inspection results.
6. Let the ordinary fresh installation publish Agent Relay's exact repository, configuration, storage, packages, units, services, and marker. Do not introduce data migration or generic cleanup of unknown files.
7. Preserve all previously implemented behavior listed in this plan. Do not add general ancestor-chain validation or unrelated hardening.
8. Add deterministic behavioral tests for cleanup eligibility, exact purge selection, cleanup failure, post-cleanup reclassification, and refusal to delete populated or active state.
9. Run one complete `npm run check` after the final production edit.
10. Review the final diff point by point against this plan.
11. Obtain normal CI evidence on a connector-authored exact final head after the Codex commit.

## Repository-Safe Tests

Required new coverage:

- related-package parsing retains `rc` records for Docker, containerd, runc, rootlesskit, Buildx, Compose, and related plugin packages;
- similarly named unrelated packages remain excluded;
- a clean host with no related package records still follows the ordinary fresh path;
- an unmarked host with one or several related `rc` records enters the cleanup path;
- the cleanup command receives exactly the recorded residual package names and no installed, unrelated, wildcard-expanded, or user-controlled values;
- cleanup failure stops before repository, configuration, package installation, or service mutation;
- after successful cleanup, every targeted package is verified absent and the complete fresh classification runs again;
- a mixture of `rc` and installed/partial related package states is rejected without cleanup;
- a residual-config host with an active service, socket, Docker/containerd process, populated default data, or populated managed data is rejected without deleting that state;
- package-owned residual configuration can be removed and the normal atomic Agent Relay configuration publication still succeeds;
- managed preparing, transaction, installed, and complete phases retain their existing exact recovery and validation behavior.

Required regression coverage:

- exact package and selected dependency closure;
- repository and key publication and validation;
- phase markers and interruption recovery;
- narrowly scoped `policy-rc.d`;
- dpkg trigger recovery and unrelated dirty-state rejection;
- storage and configuration exactness;
- effective production PATH command resolution;
- exact Docker CLI plugin-entry inventories;
- systemd unit, alias, activation-link, root metadata, enablement, and service-state checks;
- socket and process cleanup before recovery;
- bounded explicit containerd inspection;
- sudo timestamp, process-group, signal, timeout, runtime-finalization, and runner-restoration ordering;
- executor, finalizer, output, workflow, API, routing, sandbox, and workspace-ownership regressions;
- exactly one active ExecPlan and no workflow changes.

## Acceptance Criteria for This PR

- `update.sh` installs the exact managed Docker stack on a clean host and on an otherwise-safe unmarked host containing only related dpkg residual configuration.
- Residual package cleanup is exact, deterministic, bounded, verified, and followed by a full fresh-state reclassification.
- No Docker data migration or copying mechanism exists.
- Populated Docker or containerd data is never deleted to force installation.
- Engine and containerd use the required permanent roots from their first start.
- Interrupted owned phases resume without an undocumented manual repair step.
- Completed updates validate rather than repair managed state.
- A repeated update performs no unnecessary package mutation or registry access.
- Installed, partial, active, or mixed foreign runtime state still fails before destructive mutation.
- Package selection uses one apt snapshot and cannot admit an unselected alternative or unrelated dependency.
- The updater cannot restore the runner while a root provisioner process may still be alive.
- `github-runner` can use the effective official Docker CLI, Buildx, Compose, and socket; `agent-relay-builder` cannot.
- Current documentation does not claim the feature before acceptance is complete.
- `npm run check`, the Codex validation gate, and normal CI pass on the exact final head.
- Independent final review finds no unresolved correctness, restartability, maintainability, scope, or current-main regression issue.

## Post-Merge Manual Acceptance

Privileged real-host acceptance is intentionally manual and is not a blocker for this PR.

After merge, the operator will run `update.sh` on the designated Debian VM and manually confirm installation, residual-package cleanup where applicable, persistent storage roots, Docker/Buildx/Compose access, Compose startup, logs, exec, shutdown, repeated update behavior, and runner workspace ownership. If that manual acceptance finds a defect, open a new ExecPlan and follow-up PR. Do not keep this PR open solely because an automated disposable-host lifecycle is unavailable.

## Progress

- [x] Established the fresh-host permanent-storage architecture and direct final storage roots.
- [x] Confirmed that no Docker data migration or copying mechanism is needed.
- [x] Confirmed that the existing Codex workflow is sufficient and no workflow edit is required.
- [x] Implemented and independently reviewed four provisioner revisions.
- [x] Implemented phase recovery, sudo control, process-group cleanup, repository/key validation, package closure validation, service-start policy, exact storage, command/plugin inventories, systemd alias/activation validation, and service/socket normalization.
- [x] Codex revision `34d4d2bd2d6b367908ade9a284d126c522c8cdf7` passed the complete repository-safe validation in workflow run `29747072289`.
- [x] Re-evaluated plugin-root and ancestor-chain hardening against the actual dedicated-VM trust model; they are not merge blockers.
- [x] Revision `ce9e3cc6` made residual-config package records visible and added phase tests, but implemented rejection rather than the required cleanup compatibility path.
- [x] Implemented safe unmarked residual-package cleanup and full post-cleanup reclassification. The classifier now separates exact `rc` records from active or partial package state, completes the non-package safety inspection (including process absence), permits only package-owned residual copies of the two managed configuration targets, purges a sorted exact package-name list with a bounded direct `dpkg --purge`, verifies absence, and reruns classification from the beginning.
- [x] Added deterministic repository-safe coverage for parsing and split classification, clean and residual paths, mixed-state rejection, exact purge arguments, purge failure, post-cleanup reclassification, package-owned residual configuration, and refusal to clean hosts with commands, sockets, processes, populated managed/default data, or active units. Focused contract and repository-safe tests passed on 2026-07-20.
- [x] Ran final repository and Codex validation after the last production edit on 2026-07-20: `npm run check` passed with 137 tests, 100% source coverage, and all runtime-build, shell, Node-script, toolchain, and system-integration checks successful.
- [x] Reviewed the final local diff against this plan. The cleanup path is restartable, every destructive target comes from the exact validated dpkg inventory, unsafe foreign runtime/data/configuration state remains fail-closed, and no workflow, public API, request contract, installation argument, routing, README, or operator-documentation change is required.
- [blocked] Publish a connector-authored exact final head and require normal CI to pass. The current Codex sandbox exposes `.git` read-only (`git commit` failed creating `.git/index.lock`), while publishing through the connector before this workflow's finalizer would advance the branch and make its later push non-fast-forward. The concrete automated unblock is: let the workflow finalizer publish this validated Codex change, then create the connector-authored status commit and wait for normal CI on that exact head.
- [blocked] Complete independent final job-log review. The final local diff review passed and all 32 existing inline review threads are resolved, but exact-head normal-CI logs do not exist until the connector-authored head is published and CI completes.
- [blocked] Merge the PR after the acceptance criteria above pass. The concrete unblock condition is the connector-authored exact head, passing normal CI, and its successful job-log review.
- [post-merge] Perform manual privileged host acceptance; open a new plan only if it exposes a defect.

## Decision Log

- Use one permanent managed storage tree below `/srv/github-runner/storage/docker`.
- Create both final roots before first activation.
- Do not migrate or copy Docker data.
- Permit automatic cleanup of exact dpkg residual configuration on an otherwise-safe unmarked host.
- Do not delete populated data or take over active, installed, partial, or mixed foreign runtime state.
- Rerun the full fresh-state classification after cleanup.
- Permit mutation of a managed installation only while completing an exact owned initial transaction; completed state remains validation-only.
- Treat package, plugin-entry, repository, key, configuration, unit, alias, activation-link, socket, process, and data inventories as exact state within the defined deployment model.
- Trust the dedicated VM's standard root-owned operating-system hierarchy; do not add general ancestor-chain hardening in this PR.
- Confirm the full provisioner process group is gone before runner restoration.
- Keep application-container lifecycle under Codex control.
- Keep GitHub Actions workflows unchanged.
- Complete privileged real-host acceptance manually after merge; defects found there become a new plan.

## Surprises & Discoveries

- Default sudo timestamps are parent-process scoped in non-TTY use, so refresh must occur from the authenticated controlling shell.
- An interrupted apt transaction can leave unrelated trigger processors in trigger-pending or trigger-awaited state; bounded recovery must distinguish those states from unrelated dirty package work.
- Package installation can leave official unit files present while systemd still reports `LoadState=not-found` before its dpkg reload trigger; this is valid only in the transaction phase.
- Docker activation can be interrupted in multiple nonterminal systemd states; recovery must prove the exact fragment/socket/process relationship before stopping services.
- Docker CLI searches several plugin directories, so exact entry inventory must cover every configured search root rather than only known filenames.
- Dpkg residual-config state is globally clean and has no package payload, but it can retain package configuration. That makes it suitable for exact cleanup on an otherwise-safe unmarked host, not for silent omission or unconditional rejection.
- The first residual-host inspection must allow package-owned residual copies of `/etc/docker/daemon.json` or `/etc/containerd/config.toml`; rejecting those files before `dpkg --purge` would make the promised residual-configuration compatibility path unusable. The exception is limited to safe regular target files owned by an exact cleanup package, and the second fresh classification requires them to be gone.
- Codex-token pushes can leave normal CI as `action_required` with no jobs; a connector-authored final status commit is needed for exact-head CI evidence.

## Outcomes & Retrospective

Not complete. Keep this plan active until safe residual-package cleanup, complete repository validation, exact-head normal CI, and independent final review pass. Manual privileged host acceptance happens after merge and is not part of this PR's blocking acceptance.
