# Install Docker for Codex with persistent host storage

This ExecPlan follows `.agent/PLANS.md` and is the only active plan for this pull request.

## Purpose

Make `./update.sh` install and maintain rootful Docker Engine, Buildx, and Compose v2 for `github-runner`, so Codex can use the ordinary `/usr/bin/docker` CLI and the local Unix socket.

Docker Engine and containerd must use permanent state below `/srv/github-runner/storage/docker` from their first start:

- Docker Engine: `/srv/github-runner/storage/docker/engine`;
- containerd: `/srv/github-runner/storage/docker/containerd`.

The supported initial state is a fresh host without an existing or previously removed Docker/container runtime installation and without Docker data. The provisioner creates the final storage directories directly and configures both daemons before their first activation. Package-created default directories are valid only when empty and are removed before startup. Later updates may reuse only the exact managed installation created by this feature.

Agent Relay exposes the ordinary host CLI and socket. Codex owns application-container lifecycle decisions.

## Current Baseline

The branch is based on `main` commit `7c148c242feb421b59647f144ab6b78fe691af28`. Preserve its normalized Codex output, transcript, timeout, finalization, workflow, API, routing, and sandbox behavior.

The existing `.github/workflows/codex.yml` supports manual dispatch and direct Codex execution. No workflow change is required.

Codex revision `34d4d2bd2d6b367908ade9a284d126c522c8cdf7` implemented the exact related-package, plugin-entry, systemd alias/activation-link, unit-root, service/socket, phase-recovery, sudo, process-group, repository, and storage checks described below. Workflow run `29747072289` passed the complete repository-safe validation. Independent review leaves one implementation blocker: residual-config related packages are omitted from the package-state boundary.

## Scope and Trust Model

- The target is a dedicated external Debian VM.
- There is no hostile local-user threat model for this PR.
- Codex intentionally receives root-equivalent authority through membership in the rootful Docker group.
- The operating system's standard root-owned filesystem hierarchy is trusted.
- The provisioner must reject conflicting or stale Docker state visible through its defined package, command, plugin-entry, repository, configuration, unit, activation, socket, process, and data inventories.
- This PR does not attempt to make every trusted path durable against a concurrent privileged or local filesystem attacker.

## Binding Decisions

- Provision Docker only from `update.sh`.
- Support Debian x86-64 through Docker's official apt repository.
- Install `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, and `docker-compose-plugin` with the resolver-selected dependency closure.
- Create the final Engine and containerd roots before first activation.
- Do not copy or migrate Docker data. The final directories are created directly because Docker is being installed for the first time.
- Recognize only a fresh supported state, an interrupted transaction created by this feature, or the exact completed managed state.
- Reject every unrecognized installed or partially installed Docker, containerd, runc, rootless, Buildx, Compose, or related plugin package before repository, dpkg, apt, configuration, service, or recovery mutation.
- Treat a related package in dpkg residual-config state as evidence of a previous installation, not as absence.
- Reject unexpected effective commands, Docker CLI plugin entries, repository definitions, keys, configuration, units, aliases, activation links, sockets, policies, service states, processes, or data before mutation.
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

- A "blocker" means an unresolved requirement that prevents accepting the PR; it does not mean the change is technically impossible.
- Full ancestor-chain validation can be implemented, but it hardens against writable-parent or local filesystem replacement attacks.
- This VM has no hostile local-user threat model, its standard root-owned operating-system hierarchy is trusted, and Codex intentionally receives root-equivalent Docker authority.
- A broad ancestor validator would add substantial complexity and false-rejection risk around legitimate Debian paths without materially improving the agreed deployment model.
- Keep the existing exact leaf, directory-entry, ownership, unit, repository, configuration, and service checks. Do not add a general parent-chain hardening framework in this PR.

## Current Independent Review Finding

1. **Residual-config related packages are treated as never installed.** `docker_debian_related_package_records` excludes related packages whose dpkg current state is `c`. In a status such as `runc|rc |1.1`, `r` means the requested action was removal and `c` means only configuration files remain. The executable package payload is gone, but dpkg still records residual configuration and conffiles may remain outside the provisioner's explicitly enumerated paths. The current code can therefore classify a host with evidence of an earlier Docker/container runtime installation as fresh. Include related `rc` records in the inventory and reject them in fresh, preparing, installed, and complete state. Transaction recovery must also reject a marker package that was externally removed into `rc`; it must not silently reinstall or adopt that changed state.

Normal CI on the exact final production head is an acceptance step, not an implementation finding.

## Implementation Work

1. Change the related-package inventory so Docker/containerd/runc/rootless/Buildx/Compose/plugin-related `rc` records are visible rather than discarded.
2. Make phase validation reject every residual-config related package. In transaction state, a marker-recorded package changed externally to `rc` must fail before `dpkg --configure -a` or `apt-get` mutation.
3. Add deterministic behavioral tests for fresh, preparing, transaction, installed, and complete handling of residual-config related packages.
4. Preserve all previously implemented behavior listed in this plan. Do not add general ancestor-chain validation or unrelated hardening.
5. Run one complete `npm run check` after the final production edit.
6. Review the final diff point by point against this plan.
7. Obtain normal CI evidence on a connector-authored exact final head after the Codex commit.

## Repository-Safe Tests

Required new coverage:

- the related-package parser includes `rc` records for Docker, containerd, runc, rootlesskit, Buildx, Compose, and related plugin packages;
- similarly named unrelated packages remain excluded;
- fresh and preparing states reject every related residual-config package before mutation;
- transaction state rejects a marker package externally changed to `rc` before recovery mutation;
- transaction state rejects an unrecorded related residual-config package;
- installed and complete states reject related residual-config packages without repairing or reinstalling them.

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

- `update.sh` installs the exact managed Docker stack on the supported fresh host.
- Engine and containerd use the required permanent roots from their first start.
- No Docker data migration or copying mechanism exists.
- Interrupted owned phases resume without an undocumented manual repair step.
- Completed updates validate rather than repair managed state.
- A repeated update performs no unnecessary package mutation or registry access.
- Every related installed, partial, or residual-config package outside the exact phase contract fails before mutation.
- Package selection uses one apt snapshot and cannot admit an unselected alternative or unrelated dependency.
- The updater cannot restore the runner while a root provisioner process may still be alive.
- `github-runner` can use the effective official Docker CLI, Buildx, Compose, and socket; `agent-relay-builder` cannot.
- Current documentation does not claim the feature before acceptance is complete.
- `npm run check`, the Codex validation gate, and normal CI pass on the exact final head.
- Independent final review finds no unresolved correctness, restartability, maintainability, scope, or current-main regression issue.

## Post-Merge Manual Acceptance

Privileged real-host acceptance is intentionally manual and is not a blocker for this PR.

After merge, the operator will run `update.sh` on the designated Debian VM and manually confirm installation, persistent storage roots, Docker/Buildx/Compose access, Compose startup, logs, exec, shutdown, repeated update behavior, and runner workspace ownership. If that manual acceptance finds a defect, open a new ExecPlan and follow-up PR. Do not keep this PR open solely because an automated disposable-host lifecycle is unavailable.

## Progress

- [x] Established the fresh-host permanent-storage architecture and direct final storage roots.
- [x] Confirmed that no Docker data migration or copying mechanism is needed.
- [x] Confirmed that the existing Codex workflow is sufficient and no workflow edit is required.
- [x] Implemented and independently reviewed four provisioner revisions.
- [x] Implemented phase recovery, sudo control, process-group cleanup, repository/key validation, package closure validation, service-start policy, exact storage, command/plugin inventories, systemd alias/activation validation, and service/socket normalization.
- [x] Codex revision `34d4d2bd2d6b367908ade9a284d126c522c8cdf7` passed the complete repository-safe validation in workflow run `29747072289`.
- [x] Re-evaluated plugin-root and ancestor-chain hardening against the actual dedicated-VM trust model; they are not merge blockers.
- [ ] Implement the one remaining residual-config package-state fix with behavioral tests.
- [ ] Run final repository validation and Codex validation.
- [ ] Publish a connector-authored exact final head and require normal CI to pass.
- [ ] Complete independent final diff and job-log review.
- [ ] Merge the PR after the acceptance criteria above pass.
- [post-merge] Perform manual privileged host acceptance; open a new plan only if it exposes a defect.

## Decision Log

- Use one permanent managed storage tree below `/srv/github-runner/storage/docker`.
- Create both final roots before first activation.
- Do not migrate or copy Docker data.
- Permit mutation only while completing an exact owned initial transaction; completed state is validation-only.
- Treat package, plugin-entry, repository, key, configuration, unit, alias, activation-link, socket, process, and data inventories as exact state within the defined deployment model.
- Treat related residual package configuration as evidence of a previous installation, not absence.
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
- Codex-token pushes can leave normal CI as `action_required` with no jobs; a connector-authored final status commit is needed for exact-head CI evidence.

## Outcomes & Retrospective

Not complete. Keep this plan active until the residual-config fix, complete repository validation, exact-head normal CI, and independent final review pass. Manual privileged host acceptance happens after merge and is not part of this PR's blocking acceptance.