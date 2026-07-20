# Install Docker for Codex with persistent host storage

This ExecPlan follows `.agent/PLANS.md` and is the only active plan for this pull request.

## Purpose

Make `./update.sh` install and maintain rootful Docker Engine, Buildx, and Compose v2 for `github-runner`, so Codex can use the ordinary `/usr/bin/docker` CLI and the local Unix socket.

Docker Engine and containerd must use permanent state below `/srv/github-runner/storage/docker` from their first start:

- Docker Engine: `/srv/github-runner/storage/docker/engine`;
- containerd: `/srv/github-runner/storage/docker/containerd`.

The supported initial state is a fresh host without an existing Docker installation or Docker data. The provisioner creates the final storage directories directly and configures both daemons to use them before their first activation. Package-created default directories are valid only when empty and are removed before startup. Later updates may reuse only the exact managed installation created by this feature.

Agent Relay remains the execution bridge. Codex decides when to run Docker and Compose commands, inspect logs, execute commands in containers, restart services, and clean up application resources.

## Current Baseline

The branch is based on `main` commit `7c148c242feb421b59647f144ab6b78fe691af28`. Preserve its normalized Codex output, transcript, timeout, finalization, workflow, API, and routing behavior.

The existing `.github/workflows/codex.yml` supports manual dispatch and direct Codex execution. No workflow change is required.

Codex implemented the first version of the persistent-storage design in commit `f0131c2d535050b7f73705d55f7868786b31ac0e`. Repository validation passed locally, but independent review found unresolved production and acceptance blockers below. Treat the current implementation as incomplete.

## Binding Decisions

- Provision Docker only from `update.sh`.
- Support the current Debian x86-64 package adapter through Docker's official apt repository.
- Install `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, and `docker-compose-plugin` with the resolver-selected dependency closure.
- Create the final Engine and containerd storage directories directly under `/srv/github-runner/storage/docker` before first service activation.
- Recognize only a fresh supported state or the exact managed state produced by this feature.
- Reject unknown pre-existing Docker packages, effective commands, CLI plugins, configuration, units, sockets, or data before package mutation.
- Ensure `github-runner` belongs to `docker`; ensure `agent-relay-builder` does not.
- Validate the ordinary Docker CLI, Buildx, Compose, local socket, effective storage roots, package ownership, unit ownership, and group boundaries.
- Run `hello-world` on the first successful installation or explicit host acceptance. A completed repeated update must not require registry access.
- Docker group membership is intentionally root-equivalent on the dedicated runner VM.
- Keep application-container lifecycle under Codex control.
- Keep the current GitHub Actions workflows unchanged.

## Current Independent Review Findings

1. **Configuration can change after the last validation.** The implementation validates `daemon.json`, `config.toml`, and their directories before apt package work, then starts services without validating them again. Package post-install scripts can replace files or add entries before the first start. Revalidate exact file bytes, canonical paths, ownership, modes, directory contents, and storage-directory metadata after package or recovery work and immediately before service activation. Add a behavioral case where package work mutates each managed file or directory and prove no service starts.

2. **Completed managed state is repaired instead of verified.** With a `complete` marker, missing configuration or storage directories are recreated. A completed update must fail before mutation unless the exact managed files and directories already exist with the required canonical paths and metadata. Controlled creation is valid only while completing the recorded initial transaction.

3. **The managed service-start policy can remain globally installed.** Transaction recovery publishes phase `installed` before removing `/usr/sbin/policy-rc.d`. Interruption at that boundary leaves the policy on a later `installed` or `complete` run, where it is never removed. Remove the exact managed policy before publishing the post-transaction phase, and validate on every non-transaction run that no managed policy remains. Add interruption tests on both sides of this boundary.

4. **Fresh-state inspection misses effective command and plugin shadowing.** The implementation checks selected `/usr/bin` paths but not earlier PATH entries such as `/usr/local/bin`, nor Docker CLI plugin override directories. Codex uses a PATH where `/usr/local/bin` precedes `/usr/bin`; Buildx and Compose also have documented user/local plugin search locations. Reject any pre-existing effective Docker/containerd command or Buildx/Compose plugin that could shadow the official package files. After installation, prove the effective CLI and plugins are the managed package files.

5. **Fresh-state inspection misses filesystem unit leftovers and default data.** `systemctl show` alone can miss unit files or drop-ins added after the manager last loaded them. Inspect the future-active service/socket files and drop-in locations directly before apt mutation. Also reject populated `/var/lib/docker` or `/var/lib/containerd` state on the fresh path and verify that first startup did not write data outside the managed roots.

6. **Package selection is not one coherent apt snapshot.** Candidate lookup can execute `apt-get update` inside the per-package loop, after earlier candidates were already selected. Refresh apt metadata once before selecting any package whenever installation is required, then resolve every candidate, origin, simulation, and exact installation from that snapshot.

7. **Dependency validation is tautological.** `allowed.txt` is generated from the same simulation `Inst` rows that it is supposed to validate, so an injected unrelated package is automatically allowed. Independently prove that every selected package is reachable from the exact requested packages through the resolver-selected dependency alternatives. Do not derive the allowlist from the rows being checked. Test the production transaction helper with a valid dependency, an unselected alternative, and an unrelated package.

8. **Root authority can expire while the runner is stopped.** A single `sudo -v` after the worker wait does not keep noninteractive authority valid during long package work. Signal delivery and runner restoration can later fail because the provisioner is root-owned. Maintain bounded noninteractive authority for the full privileged operation, verify TERM and KILL delivery, and never restore the runner while the provisioner process group may still be alive. A failed signal is a hard update failure, not success. Add long-wait and expired-credential behavioral tests.

9. **Provisioner completion remains unbounded.** The normal path waits indefinitely while the runner is stopped. Add a defined bounded provisioner deadline or bounded phase deadlines. On expiry, terminate the verified process group, reap it within bounded TERM/KILL grace periods, and restore the runner only after the group is confirmed gone.

10. **The containerd validation command is invalid.** Current containerd CLI exposes detailed plugin data through `ctr plugins ls -d`; `ctr plugins info io.containerd.metadata.v1.bolt` is not a supported command in the current 1.x or 2.x command surface. Use a supported command and parse one unambiguous metadata-plugin root export, or use another supported effective-configuration interface. Add an exact command/output behavioral test.

11. **Repository-safe tests do not exercise the failure boundaries above.** Current TypeScript tests mostly assert source strings, and the shell helper tests do not execute post-install mutation, policy interruption, effective command/plugin shadowing, direct unit leftovers, complete-state corruption, sudo expiry, signal failure, deadline expiry, or the actual containerd command. Add deterministic behavioral tests around production helpers and process/filesystem behavior.

12. **Current documentation claims unaccepted behavior.** `README.md`, `docs/native-github-runner-specification.md`, and `docs/operations/README.md` describe Docker as current host behavior while this active plan still lacks exact-head CI, independent acceptance, and privileged host acceptance. Restore current documentation to the accepted `main` contract. Keep the Docker behavior in this active plan and host-acceptance documentation until all acceptance criteria are complete.

## Implementation Work

1. Correct the phase model so fresh installation can create state, interrupted installation can recover only its recorded transaction, and completed state is validation-only.
2. Validate managed configuration and storage both before package mutation and after package work immediately before service activation.
3. Make `policy-rc.d` recovery interruption-safe and prove it cannot persist after transaction completion.
4. Inspect effective command resolution, Docker CLI plugin search paths, direct unit/drop-in files, sockets, managed storage, and default Docker/containerd data before package mutation.
5. Resolve one exact apt transaction from one metadata refresh and independently validate its selected dependency graph.
6. Replace the unsupported containerd command with a supported effective-root check.
7. Maintain noninteractive privileged control for the full update, verify signal delivery, enforce a bounded provisioner deadline, and confirm the process group is gone before runner restoration.
8. Preserve direct Docker access and Codex-owned application lifecycle. Keep the workspace ownership requirement before finalization.
9. Keep only the fresh-host installation path, interrupted managed-transaction recovery, and exact managed-state validation in production code, tests, and documentation.
10. Add behavioral coverage for every current independent finding. Static assertions may supplement but not replace behavioral evidence.
11. Restore current-state documentation until the feature has complete acceptance evidence.
12. Run one complete `npm run check` after the last production edit, then review the final diff point by point against this plan.

## Repository-Safe Tests

Required coverage includes:

- fresh classification and exact managed-state reuse;
- rejection of pre-existing effective commands, local/user CLI plugins, units, drop-ins, sockets, configuration, managed storage, and default data;
- exact canonical storage directories and configuration metadata;
- no service activation before configuration and post-package revalidation;
- completed-state corruption failing without repair;
- atomic repository/configuration/marker publication and deterministic interruption recovery;
- managed `policy-rc.d` removal across every phase boundary;
- one apt metadata refresh, exact candidates, official requested-package origin, and independently validated selected dependency closure;
- supported containerd effective-root inspection with exact command and output parsing;
- exact official CLI/plugin ownership and effective resolution;
- runner Docker membership, builder exclusion, local socket metadata, Buildx, Compose, and first-install `hello-world` policy;
- sudo expiry, signal-delivery failure, descendant survival, provisioner deadline, TERM/KILL escalation, bounded reaping, and runner restoration ordering;
- repository bind mounts used by Codex leaving the workspace fully owned by `github-runner`;
- all current-main output, transcript, executor, finalizer, workflow, and sandbox regressions;
- exactly one active ExecPlan and no workflow changes.

## Real-Host Acceptance

Repository-safe tests cannot prove privileged apt, dpkg, systemd, daemon, socket, group, storage-root, registry, or real Compose behavior.

The automated disposable or designated Debian 13 x86-64 systemd host lifecycle must cover:

- a clean host with no Docker installation or data;
- first installation without premature service activation;
- effective Engine and containerd roots below `/srv/github-runner/storage/docker`;
- absence of data written to default roots;
- first-install `hello-world`;
- a repeated update with registry access disabled;
- package, repository, configuration, unit, socket, ownership, and group evidence;
- interruption and rerun at repository, configuration, marker, policy, apt, dpkg, and post-install boundaries;
- expired sudo credentials and TERM, INT, HUP, timeout, and failed-signal behavior;
- a real Agent Relay request where Codex starts Compose, reads logs, executes a command, leaves the workspace runner-owned, and shuts the project down.

If this lifecycle is unavailable, keep the item blocked with its exact cause and unblock condition. Do not claim host acceptance.

## Acceptance Criteria

- The existing GitHub Action validates the exact final head and runs Codex directly.
- `update.sh` installs the exact managed Docker stack on the supported fresh host.
- Engine and containerd use the required permanent roots from their first start.
- Completed updates validate rather than repair the managed state.
- A repeated update performs no unnecessary package mutation or registry access.
- Unknown pre-existing Docker state fails before package mutation.
- Package selection uses one apt snapshot and cannot admit an unselected alternative or unrelated package.
- The service-start policy cannot persist after the managed transaction.
- The updater cannot restore the runner while a root provisioner process may still be alive.
- `github-runner` can use the effective official Docker CLI, Buildx, Compose, and socket; `agent-relay-builder` cannot.
- Current documentation does not claim the feature before acceptance is complete.
- `npm run check` and normal CI pass on the exact final head.
- Independent final review finds no unresolved correctness, security, restartability, maintainability, or current-main regression issue.

## Progress

- [x] Confirmed that the existing workflow can run Codex without workflow changes.
- [x] Established the fresh-host permanent-storage architecture.
- [x] Clarified that final storage directories are created directly before first activation and that only fresh or exact managed states are supported.
- [x] Corrected the initial system-test harness and restored the complete validation gate.
- [x] Ran Codex once on a green validated head; Codex pushed `f0131c2d535050b7f73705d55f7868786b31ac0e`.
- [x] Completed independent review of that implementation and recorded the unresolved findings above.
- [ ] Implement the current independent review fixes and behavioral tests.
- [ ] Run exact-head repository validation and CI after the final production edit.
- [ ] Complete another independent final diff and job-log review.
- [blocked] Run automated privileged real-host acceptance if no disposable or designated host lifecycle is available.

## Surprises & Discoveries

- Package post-install scripts create a second trust boundary after the pre-package configuration check.
- Docker command and plugin resolution can differ from the absolute paths used by the provisioner.
- A resolver simulation is authoritative output, but it cannot serve simultaneously as the independent allowlist validating itself.
- `ctr` is a debugging CLI with a version-dependent command surface; validation must use a command supported by the installed package.
- A sudo timestamp is not process authority and cannot guarantee later control over a root-owned process group.

## Decision Log

- Use one permanent managed storage tree below `/srv/github-runner/storage/docker`.
- Create both final roots directly before first service activation and revalidate them after package work.
- Permit mutation only while completing the recorded initial transaction; completed state is validation-only.
- Use one apt metadata snapshot and independently prove the selected dependency closure.
- Keep verified privileged control until the provisioner group is gone.
- Keep the Docker feature in the active plan until exact-head CI, independent review, and privileged host acceptance are complete.

## Outcomes & Retrospective

Not complete. Keep this plan active until implementation, exact-head CI, independent final review, and privileged real-host acceptance satisfy the criteria above.
