# Install Docker for Codex with persistent host storage

This ExecPlan follows `.agent/PLANS.md` and is the only active plan for this pull request.

## Purpose

Make `./update.sh` install and maintain rootful Docker Engine, Buildx, and Compose v2 for `github-runner`, so Codex can use the ordinary `/usr/bin/docker` CLI and the local Unix socket.

Docker Engine and containerd must use permanent state below `/srv/github-runner/storage/docker` from their first start:

- Docker Engine: `/srv/github-runner/storage/docker/engine`;
- containerd: `/srv/github-runner/storage/docker/containerd`.

The supported initial state includes a clean host or an unmarked host containing only safely removable Docker/containerd configuration remnants from an earlier installation. These remnants may include dpkg residual-configuration records and allowlisted Docker-specific configuration artifacts not owned by dpkg. The provisioner must clean that state, rerun the full fresh-host preflight, create the final storage directories directly, and configure both daemons before their first activation.

Package-created default data directories are valid only when empty and are removed before startup. Populated Docker or containerd data is never deleted or migrated by this PR. Later updates may reuse only the exact managed installation created by this feature.

Agent Relay exposes the ordinary host CLI and socket. Codex owns application-container lifecycle decisions.

## Current Baseline

The branch is based on `main` commit `7c148c242feb421b59647f144ab6b78fe691af28`. Preserve its normalized Codex output, transcript, timeout, finalization, workflow, API, routing, and sandbox behavior.

The existing `.github/workflows/codex.yml` supports manual dispatch and direct Codex execution. No workflow change is required.

Codex revision `34d4d2bd2d6b367908ade9a284d126c522c8cdf7` implemented the exact package, plugin-entry, systemd alias/activation-link, unit-root, service/socket, phase-recovery, sudo, process-group, repository, and storage checks described below. Revision `ce9e3cc6fa0e86cf5db554e3fa69ebed9916600c` made residual-config records visible but rejected them. Revision `f38f03e9e6ee59d8ade208c9632acbf5d20db5f2` added exact bounded `dpkg --purge` and full post-purge reclassification, but permits cleanup only when the two managed config targets are package-owned. Independent review found that this still rejects ordinary remnants from a previous Docker installation.

## Scope and Trust Model

- The target is a dedicated external Debian VM.
- There is no hostile local-user threat model for this PR.
- Codex intentionally receives root-equivalent authority through membership in the rootful Docker group.
- The operating system's standard root-owned filesystem hierarchy is trusted.
- The provisioner may clean allowlisted Docker/containerd configuration artifacts when no Agent Relay Docker marker exists and no active installation or Docker data exists.
- The provisioner must not take over an installed or partially installed foreign runtime, delete populated Docker data, delete unrelated/global configuration, or silently adopt active service state.
- This PR does not attempt to make every trusted path durable against a concurrent privileged or local filesystem attacker.

## Binding Decisions

- Provision Docker only from `update.sh`.
- Support Debian x86-64 through Docker's official apt repository.
- Install `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, and `docker-compose-plugin` with the resolver-selected dependency closure.
- Create the final Engine and containerd roots before first activation.
- Do not copy or migrate Docker data. The final directories are created directly.
- Recognize a clean fresh host, a cleanable unmarked Docker-remnant host, an interrupted transaction created by this feature, or the exact completed managed state.
- A dpkg `rc` record means the package payload was removed but residual package configuration remains. It is cleanable compatibility state, not an automatic rejection.
- Cleanup eligibility requires no installed, unpacked, half-configured, trigger-state, or otherwise active/partial related package; no effective Docker/containerd command; no running Docker/containerd process; no active or nonterminal managed unit; and no populated managed or default data root.
- Remove residual package configuration using a deterministic exact package list derived from dpkg. Do not use a shell-expanded name, wildcard, dependency resolver, or unconstrained purge.
- Configuration cleanup must not depend on dpkg ownership. A previous Docker installation may leave manually created configuration, repository definitions, plugin entries, unit overrides, activation links, aliases, or a stale inactive socket.
- The cleanup allowlist is limited to Docker/containerd-specific state already covered by the provisioner's inventories:
  - `/etc/docker` and `/etc/containerd` configuration content;
  - Docker apt source definitions and Docker keyring files, without deleting unrelated repository content from a shared file;
  - direct entries in the supported Docker CLI plugin search directories;
  - Docker/containerd direct units, drop-ins, aliases, and activation links under the supported administrator/runtime unit roots;
  - `/run/docker.sock` and `/var/run/docker.sock` only when exact unit/process inspection proves them stale and inactive;
  - empty default or managed Docker/containerd directories already allowed by the fresh-state contract.
- Do not delete unrelated files from shared apt source files or systemd roots. A mixed shared file must be rewritten safely to remove only the Docker definition or rejected if exact preservation cannot be proven.
- Cleanup must be idempotent and restartable without relying on `rc` records remaining present. If package purge succeeds and execution stops before the configuration cleanup ends, the next run must still recognize the allowlisted unmarked remnants as cleanup state and finish them.
- After every cleanup attempt, rerun the complete fresh-state inspection from the beginning. Continue only if the host satisfies the ordinary fresh-state contract.
- Publish the exact managed Docker and containerd configuration only after the cleanup and fresh-state reclassification complete.
- Populated data, installed/partial packages, foreign effective commands, active/nonterminal units or processes, unrelated policy state, or configuration outside the allowlist remain unsupported and must not be deleted to force installation.
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
18. Revision `f38f03e9` separates exact `rc` records from active/partial package state, uses bounded direct `dpkg --purge -- <exact packages>`, verifies package absence, checks process absence, and reruns classification from the beginning.

## Re-evaluated Review Notes

The previous plan version promoted plugin-root metadata and full ancestor-chain validation to merge blockers. They are not blockers under the agreed trust model.

- A blocker means an unresolved requirement that prevents accepting the PR; it does not mean the change is technically impossible.
- Full ancestor-chain validation can be implemented, but it hardens against writable-parent or local filesystem replacement attacks.
- This VM has no hostile local-user threat model, its standard root-owned operating-system hierarchy is trusted, and Codex intentionally receives root-equivalent Docker authority.
- A broad ancestor validator would add substantial complexity and false-rejection risk around legitimate Debian paths without materially improving the agreed deployment model.
- Keep the existing exact leaf, directory-entry, ownership, unit, repository, configuration, and service checks. Do not add a general parent-chain hardening framework in this PR.

## Current Independent Review Finding

1. **The cleanup path still rejects common non-package-owned Docker remnants and is not restartable after package-only cleanup.** Revision `f38f03e9` accepts only package-owned copies of `/etc/docker/daemon.json` and `/etc/containerd/config.toml`; a manually created daemon configuration, stale dedicated Docker apt source/key, Docker CLI plugin, unit override/activation link, alias, or stale inactive socket still fails before cleanup. If `dpkg --purge` removes the final `rc` records and the process stops before those remnants are removed, the next run classifies the host as fresh packages plus unsupported configuration and cannot resume. Extend the unmarked compatibility state to inventory and remove allowlisted Docker-specific configuration artifacts independently of package ownership and independently of whether `rc` records still exist. Preserve the hard stop for populated data, active/partial packages, commands, processes, active units, and unrelated configuration.

Normal CI on the exact final production head is an acceptance step, not an implementation finding.

## Implementation Work

1. Replace the residual-package-only classification with an unmarked Docker-remnant classification that can be entered from exact `rc` records, allowlisted Docker-specific configuration artifacts, or both.
2. Run the complete non-destructive safety inspection before any cleanup mutation. Prove package payloads are absent, related package states are only `rc`, commands and processes are absent, managed units are inactive/not-found, and managed/default data roots are empty.
3. Inventory cleanup artifacts with exact paths and types. Do not infer cleanup targets from untrusted text or broad globs without validating each selected entry.
4. Purge exact `rc` package records using the existing bounded direct dpkg path.
5. Remove or safely rewrite allowlisted Docker/containerd configuration artifacts, including manually created files not owned by dpkg. Preserve unrelated content in shared files.
6. Make cleanup idempotent and restartable when interrupted before package purge, during package purge, after package purge, or during configuration cleanup.
7. Rerun the complete unmarked classification after cleanup. It must resolve to ordinary fresh state before repository, managed configuration, package installation, marker, or service mutation.
8. Preserve all previously implemented behavior listed in this plan. Do not add general ancestor-chain validation, data migration, or unrelated hardening.
9. Add deterministic behavioral tests for every cleanup artifact family, mixed/shared-file preservation, interruption after package purge, partial configuration cleanup, cleanup failure, and full post-cleanup reclassification.
10. Run one complete `npm run check` after the final production edit.
11. Review the final diff point by point against this plan.
12. Obtain normal CI evidence on a connector-authored exact final head after the Codex commit.

## Repository-Safe Tests

Required new coverage:

- a clean host with no related package or configuration remnants follows the ordinary fresh path;
- an unmarked host with only one or several exact related `rc` records enters cleanup;
- an unmarked host with no `rc` records but allowlisted Docker-specific configuration remnants enters cleanup, proving restartability after package purge;
- a host with both `rc` records and configuration remnants cleans both classes and becomes fresh;
- manually created files under `/etc/docker` and `/etc/containerd` are removed before exact managed configuration publication;
- dedicated Docker apt source files and Docker keyring files are removed; shared source files preserve every unrelated line/stanza while removing only exact Docker definitions;
- direct entries in every supported Docker CLI plugin search directory are removed on the safe unmarked cleanup path;
- direct units, drop-ins, aliases, and activation links targeting Docker/containerd are removed only from supported roots;
- a stale inactive Docker socket is removed only when exact unit/process inspection proves it is not active;
- cleanup targets are exact and validated; unrelated files in shared roots are not selected;
- interruption after all `rc` records are purged but before configuration cleanup completes resumes on the next run;
- interruption during partial configuration cleanup resumes idempotently;
- cleanup failure stops before repository publication, managed configuration publication, package installation, marker publication, or service activation;
- a mixture of `rc` and installed/partial related package states is rejected without cleanup;
- effective Docker/containerd commands, active/nonterminal units, running processes, populated default data, or populated managed data block cleanup without deletion;
- managed preparing, transaction, installed, and complete phases retain their exact recovery and validation behavior.

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

- `update.sh` installs the exact managed Docker stack on a clean host and on an otherwise-safe unmarked host containing only allowlisted Docker/containerd configuration remnants.
- Cleanup covers residual package configuration and non-package-owned Docker-specific configuration remnants.
- Cleanup is exact, deterministic, bounded, idempotent, restartable, verified, and followed by a full fresh-state reclassification.
- No Docker data migration or copying mechanism exists.
- Populated Docker or containerd data is never deleted to force installation.
- Unrelated configuration in shared files or roots is preserved.
- Engine and containerd use the required permanent roots from their first start.
- Interrupted owned phases resume without an undocumented manual repair step.
- Completed updates validate rather than repair managed state.
- A repeated update performs no unnecessary package mutation or registry access.
- Installed, partial, active, command-shadowed, or mixed foreign runtime state still fails before destructive mutation.
- Package selection uses one apt snapshot and cannot admit an unselected alternative or unrelated dependency.
- The updater cannot restore the runner while a root provisioner process may still be alive.
- `github-runner` can use the effective official Docker CLI, Buildx, Compose, and socket; `agent-relay-builder` cannot.
- Current documentation does not claim the feature before acceptance is complete.
- `npm run check`, the Codex validation gate, and normal CI pass on the exact final head.
- Independent final review finds no unresolved correctness, restartability, maintainability, scope, or current-main regression issue.

## Post-Merge Manual Acceptance

Privileged real-host acceptance is intentionally manual and is not a blocker for this PR.

After merge, the operator will run `update.sh` on the designated Debian VM and manually confirm installation, cleanup of prior Docker configuration where applicable, persistent storage roots, Docker/Buildx/Compose access, Compose startup, logs, exec, shutdown, repeated update behavior, and runner workspace ownership. If that manual acceptance finds a defect, open a new ExecPlan and follow-up PR. Do not keep this PR open solely because an automated disposable-host lifecycle is unavailable.

## Progress

- [x] Established the fresh-host permanent-storage architecture and direct final storage roots.
- [x] Confirmed that no Docker data migration or copying mechanism is needed.
- [x] Confirmed that the existing Codex workflow is sufficient and no workflow edit is required.
- [x] Implemented and independently reviewed four provisioner revisions.
- [x] Implemented phase recovery, sudo control, process-group cleanup, repository/key validation, package closure validation, service-start policy, exact storage, command/plugin inventories, systemd alias/activation validation, and service/socket normalization.
- [x] Codex revision `34d4d2bd2d6b367908ade9a284d126c522c8cdf7` passed the complete repository-safe validation in workflow run `29747072289`.
- [x] Re-evaluated plugin-root and ancestor-chain hardening against the actual dedicated-VM trust model; they are not merge blockers.
- [x] Revision `ce9e3cc6` made residual-config package records visible and added phase tests, but implemented rejection rather than cleanup.
- [x] Revision `f38f03e9` implemented exact package cleanup, bounded purge, process/data safety checks, and full post-purge reclassification with 137 passing tests and 100% source coverage.
- [x] Independently reviewed `f38f03e9`; package cleanup is correct but the configuration-remnant scope is incomplete and cannot resume after the final `rc` record disappears.
- [ ] Implement restartable cleanup of allowlisted Docker-specific configuration remnants independent of dpkg ownership.
- [ ] Run final repository validation and Codex validation.
- [ ] Publish a connector-authored exact final head and require normal CI to pass.
- [ ] Complete independent final diff and job-log review.
- [ ] Merge the PR after the acceptance criteria above pass.
- [post-merge] Perform manual privileged host acceptance; open a new plan only if it exposes a defect.

## Decision Log

- Use one permanent managed storage tree below `/srv/github-runner/storage/docker`.
- Create both final roots before first activation.
- Do not migrate or copy Docker data.
- Permit automatic cleanup of allowlisted Docker/containerd configuration state on an otherwise-safe unmarked host.
- Do not require cleanup files to be owned by an `rc` package.
- Do not delete populated data or take over active, installed, partial, command-shadowed, or mixed foreign runtime state.
- Preserve unrelated configuration in shared files and roots.
- Make cleanup state recognizable and restartable after package records have already disappeared.
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
- Dpkg residual-config state is globally clean and has no package payload, but it can retain package configuration. It is suitable for exact cleanup on an otherwise-safe unmarked host.
- Docker configuration commonly includes files not registered as package conffiles, such as a manually created `/etc/docker/daemon.json` and repository/key setup performed from Docker's installation instructions. Dpkg ownership cannot define the complete cleanup boundary.
- Cleanup detection cannot depend only on `rc`: an interruption after successful package purge can leave the same safe Docker-specific configuration remnants with no package record.
- Codex-token pushes can leave normal CI as `action_required` with no jobs; a connector-authored final status commit is needed for exact-head CI evidence.

## Outcomes & Retrospective

Not complete. Keep this plan active until restartable Docker-specific configuration cleanup, complete repository validation, exact-head normal CI, and independent final review pass. Manual privileged host acceptance happens after merge and is not part of this PR's blocking acceptance.