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

Codex pushed the second implementation revision in commit `0dd18030803d0be2481d99fce33aeb73cc2d3470`. Its repository-safe validation passed inside the Codex run. Independent review found the unresolved blockers below, so the implementation is not accepted.

## Binding Decisions

- Provision Docker only from `update.sh`.
- Support Debian x86-64 through Docker's official apt repository.
- Install `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, and `docker-compose-plugin` with the resolver-selected dependency closure.
- Create the final Engine and containerd roots before first activation.
- Recognize only a fresh supported state, an interrupted owned transaction, or the exact completed managed state.
- Reject unknown pre-existing Docker packages, effective commands, CLI plugins, configuration, service activation links, units, sockets, or data before package mutation.
- Ensure `github-runner` belongs to `docker`; ensure `agent-relay-builder` does not.
- Validate the effective official CLI and plugins, local socket, service enablement and activity, storage roots, package ownership, unit ownership, and group boundaries.
- Run `hello-world` on the first successful installation or explicit host acceptance. A completed repeated update must not require registry access.
- Docker group membership is intentionally root-equivalent on the dedicated runner VM.
- Keep application-container lifecycle under Codex control.
- Keep current GitHub Actions workflows unchanged.

## Current Independent Review Findings

1. **The sudo keepalive uses the wrong timestamp scope.** `sudo -v` runs with the main update shell as parent, while `sudo -n true` runs from a background subshell. On the default Debian `timestamp_type=tty`, a non-TTY session behaves like `ppid`; the background sudo process therefore does not share the main shell's timestamp and can fail even though the authenticated main shell still has valid authority. Refresh credentials from the main shell's control loop while waiting for `Runner.Worker` and while polling the provisioner, or install an explicit validated sudoers contract that makes the scope shared. Test real parent-PID-scoped timestamp behavior instead of a fake global boolean.

2. **An interruption after partial service activation is not recoverable.** Phase `installed` requires all Docker units to be inactive. If containerd, docker.socket, or docker.service starts and the provisioner exits, is killed, or loses the host before the `complete` marker is published, the next run rejects the owned state. Add a deterministic recovery contract for every activation boundary: either stop and verify all managed units before resuming activation, or validate an already active exact managed state and complete it. Cover each partially active combination and interruption after final validation but before marker publication.

3. **Owned dpkg recovery rejects legitimate trigger states.** An interrupted Docker transaction can leave already-installed packages such as trigger processors in `triggers-pending` or `triggers-awaited` state even though they were not `Inst` rows in the simulation. The current recovery rejects every non-clean package not listed in the marker, which can require manual repair after an interruption caused by this update. Distinguish safe trigger states caused by the owned transaction, complete them through the bounded recovery path, and continue to reject unrelated unpacked, half-configured, or otherwise dirty packages. Add exact dpkg-status fixtures and recovery behavior.

4. **A hard interruption before the transaction marker can strand `policy-rc.d`.** The managed policy is installed while the marker still says `preparing`; the transaction marker is published only after apt metadata refresh, simulation, and dependency analysis. SIGKILL or host loss in that interval leaves an exact managed policy that the next `preparing` run rejects. Treat an exact managed policy in the owned preparing phase as recoverable, remove it after confirming services remain inactive, and restart the transaction. Reject any non-exact policy.

5. **Absence checks ignore dangling symlinks.** Several predicates use `-e`, so dangling links at configuration files/directories, storage roots, default data roots, unit files, plugin paths, the socket, marker, or `policy-rc.d` can be treated as absent and mutated only after the fresh-state decision. Every managed or prohibited path must treat `-L` as existing and reject a symlink before package or managed-state mutation. Add behavioral cases for representative files, directories, unit paths, and data roots.

6. **Effective command validation does not use Codex's real PATH.** The implementation checks only `/usr/local/bin:/usr/bin:/bin`, while Codex receives the shared toolchain PATH with Java, Go, and Rust bin directories before `/usr/local/bin`. Resolve `docker`, `dockerd`, `containerd`, and `ctr` against the exact production toolchain PATH in both fresh-state rejection and completed-state validation. Add a shadowing command in each earlier path class.

7. **Completed state does not validate systemd enablement.** Runtime commands and the socket can work while one or more managed units are disabled, which breaks the installation after reboot. In completed state require `containerd.service`, `docker.socket`, and `docker.service` to be enabled and active, with the exact official fragments and no unsupported overrides. Do not silently repair completed-state drift.

8. **Fresh-state unit inspection misses activation links.** Direct unit files and drop-in directories are checked, but stale `*.wants` or `*.requires` links for the managed service/socket names can survive and become effective after package installation. Inspect future-active systemd activation links under the supported unit roots and reject unknown links before apt mutation. Validate the exact managed enablement links after activation.

9. **Containerd inspection should be explicit and bounded.** Run `ctr` in a clean environment against the explicit local `/run/containerd/containerd.sock` address with a bounded command timeout, then parse the single metadata plugin root. Do not rely on ambient client state or an unbounded default client timeout.

10. **Repository-safe tests do not cover these boundaries.** Add deterministic behavioral tests for ppid-scoped sudo timestamps, preparing-phase policy recovery, trigger-pending recovery, every partial-service activation state, dangling symlinks, exact production PATH shadowing, activation links, completed-state enablement, and explicit bounded `ctr` invocation. Static source assertions may supplement but not replace these cases.

## Implementation Work

1. Replace the background sudo timestamp refresher with a control path that demonstrably shares the authenticated timestamp scope on Debian without a TTY.
2. Make preparing, transaction, installed, and complete phases restartable across all policy, dpkg, service-start, validation, and marker-publication boundaries.
3. Extend fresh and completed path validation to reject symlinks and inspect activation links.
4. Resolve effective commands with the exact shared toolchain PATH used by Codex.
5. Validate exact service enablement and activity without repairing completed-state drift.
6. Make containerd inspection explicit, clean, and bounded.
7. Add production-helper behavioral tests for every current finding.
8. Keep current-state README, specification, and operator documentation at the accepted `main` contract until all acceptance evidence is complete.
9. Run one complete `npm run check` after the final production edit, then review the final diff point by point against this plan.

## Repository-Safe Tests

Required coverage includes:

- fresh classification, interrupted owned recovery, and exact completed-state validation;
- rejection of pre-existing effective commands, local/user CLI plugins, service activation links, units, drop-ins, sockets, configuration, managed storage, and default data;
- dangling symlink rejection before mutation;
- exact canonical storage directories and configuration metadata;
- no service activation before post-package revalidation;
- recovery from every partial managed service activation state;
- completed-state corruption and disabled-unit drift failing without repair;
- atomic repository/configuration/marker publication and deterministic interruption recovery;
- preparing-phase and transaction-phase managed `policy-rc.d` recovery;
- clean dpkg validation plus owned trigger-pending and trigger-awaited recovery;
- one apt metadata refresh, exact candidates, official requested-package origin, and independently validated selected dependency closure;
- effective command resolution through the exact production toolchain PATH;
- explicit local bounded `ctr plugins ls -d` execution and exact root parsing;
- runner Docker membership, builder exclusion, local socket metadata, Buildx, Compose, and first-install `hello-world` policy;
- parent-PID-scoped sudo expiry, signal-delivery failure, descendant survival, provisioner deadline, TERM/KILL escalation, bounded reaping, and runner restoration ordering;
- repository bind mounts used by Codex leaving the workspace fully owned by `github-runner`;
- all current-main output, transcript, executor, finalizer, workflow, and sandbox regressions;
- exactly one active ExecPlan and no workflow changes.

## Real-Host Acceptance

Repository-safe tests cannot prove privileged apt, dpkg, systemd, daemon, socket, group, storage-root, registry, or real Compose behavior.

The automated disposable or designated Debian 13 x86-64 systemd host lifecycle must cover:

- a clean host with no Docker installation or data;
- first installation without premature activation;
- effective Engine and containerd roots below `/srv/github-runner/storage/docker`;
- absence of data written to default roots;
- first-install `hello-world`;
- a repeated update with registry access disabled;
- package, repository, configuration, unit, activation-link, socket, ownership, and group evidence;
- interruption and rerun at repository, configuration, marker, policy, apt, dpkg-trigger, service-start, validation, and completion-marker boundaries;
- non-TTY sudo timestamp behavior plus TERM, INT, HUP, timeout, and failed-signal behavior;
- a real Agent Relay request where Codex starts Compose, reads logs, executes a command, leaves the workspace runner-owned, and shuts the project down.

If this lifecycle is unavailable, keep the item blocked with its exact cause and unblock condition. Do not claim host acceptance.

## Acceptance Criteria

- The existing GitHub Action validates the exact final head and runs Codex directly.
- `update.sh` installs the exact managed Docker stack on the supported fresh host.
- Engine and containerd use the required permanent roots from their first start.
- Interrupted owned phases resume without an undocumented manual repair step.
- Completed updates validate rather than repair managed state, including service enablement.
- A repeated update performs no unnecessary package mutation or registry access.
- Unknown pre-existing Docker state, symlinks, activation links, and command/plugin shadowing fail before package mutation.
- Package selection uses one apt snapshot and cannot admit an unselected alternative or unrelated package.
- The service-start policy cannot remain after an owned interruption or completed transaction.
- The updater cannot restore the runner while a root provisioner process may still be alive.
- `github-runner` can use the effective official Docker CLI, Buildx, Compose, and socket; `agent-relay-builder` cannot.
- Current documentation does not claim the feature before acceptance is complete.
- `npm run check` and normal CI pass on the exact final head.
- Independent final review finds no unresolved correctness, security, restartability, maintainability, or current-main regression issue.

## Progress

- [x] Confirmed that the existing workflow can run Codex without workflow changes.
- [x] Established and clarified the fresh-host permanent-storage architecture.
- [x] Corrected the initial system-test harness and restored the complete validation gate.
- [x] Reviewed Codex revision `f0131c2d535050b7f73705d55f7868786b31ac0e` and recorded its blockers.
- [x] Ran Codex again on the corrected plan; it pushed `0dd18030803d0be2481d99fce33aeb73cc2d3470` after a complete local repository check.
- [x] Completed the second independent code and job-log review and recorded the current blockers above.
- [ ] Implement the current review fixes and behavioral tests.
- [ ] Run exact-head repository validation and CI after the final production edit.
- [ ] Complete another independent final diff and job-log review.
- [blocked] Run automated privileged real-host acceptance if no disposable or designated host lifecycle is available.

## Surprises & Discoveries

- Default sudo timestamps are parent-process scoped when no terminal is present, so a background subshell is not a valid credential keeper for the main update shell.
- A transaction can be package-clean but still leave owned service activation incomplete, and it can be package-dirty only because existing packages have pending triggers.
- Shell `-e` does not detect dangling symlinks.
- Systemd activation state includes enablement links in addition to unit fragments and drop-ins.

## Decision Log

- Use one permanent managed storage tree below `/srv/github-runner/storage/docker`.
- Create both final roots before first activation and revalidate them after package work.
- Permit mutation only while completing an owned initial transaction; completed state is validation-only.
- Use one apt metadata snapshot and independently prove the selected dependency closure.
- Refresh sudo authority only through a demonstrably shared timestamp scope.
- Confirm the full provisioner group is gone before runner restoration.
- Keep current-state documentation unchanged until exact-head CI, independent review, and privileged host acceptance are complete.

## Outcomes & Retrospective

Not complete. Keep this plan active until implementation, exact-head CI, independent final review, and privileged real-host acceptance satisfy the criteria above.