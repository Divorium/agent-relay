# Install full Docker Engine access for Codex

This ExecPlan is maintained according to `.agent/PLANS.md`. It describes only the Docker capability being added. Current repository, runner, workflow, installation, and runtime-update behavior remains governed by the checked-out source and current technical documentation unless this plan explicitly changes it.

## Purpose / Big Picture

Agent Relay runs on a dedicated Debian 13 systemd virtual machine under Hyper-V. After this change, Codex running as `github-runner` can build, start, inspect, test, and stop applications through the complete local Docker CLI, Docker Buildx, and Docker Compose v2.

Docker is a host command-line tool, not an Agent Relay product feature. Do not add a Docker request type, capability flag, workflow mode, custom runner label, command broker, command allowlist, or Docker-specific routing.

The Debian virtual machine is the containment boundary. Access to the rootful Docker socket is root-equivalent inside that VM. The VM has no shared Windows folders, so root inside the guest is not direct access to the Windows host filesystem.

## Binding user decisions

- Install and configure Docker only through `./update.sh`.
- Keep `install.sh` Docker-free.
- Use rootful Docker Engine managed by systemd and enabled at boot.
- Use Docker's official Debian repository.
- On a Docker-absent Debian 13 amd64 host, install concrete pinned package versions.
- On a host with Docker already installed, preserve the installed engine, CLI, and containerd versions.
- Add `github-runner` to the `docker` group.
- Keep `agent-relay-builder` outside the `docker` group.
- Expose the full raw Docker CLI, including destructive global commands.
- Use Docker Compose v2 through `docker compose`; do not introduce `docker-compose`.
- Store Docker and containerd persistent data below `/srv/github-runner/docker`.
- Agent Relay may replace Docker and containerd configuration after preserving existing persistent data.
- Allow image pulls.
- Validate client/server access, `docker info`, Buildx, Compose v2, storage roots, group membership, systemd activation, and a real `hello-world` run as `github-runner`.
- Keep the GitHub Actions runner service independent from Docker service health.
- Require project-scoped Compose files, env files, project directories, and current directories to resolve inside the selected workflow workspace.
- Derive and inject deterministic Compose project names from effective project directories.
- Preserve enough private replay state to run later `logs` and `down -v` against the exact same Compose project.
- Collect Compose logs before cleanup.
- Run `docker compose down -v` after success, command failure, timeout, and handled interrupt.
- Send lifecycle output through the existing `agent-relay-console.log` stream.
- Add no stale-resource service, periodic pruning, global cleanup, resource limits, or special cache cleanup.
- Do not repair foreign-owned checkout paths automatically. Fail finalization before Git inspects the worktree.

## Explicit non-goals

- No Docker-specific GitHub Actions workflow changes.
- No change to pull-request request fields, plan selection, labels, runner selection, or generic job routing.
- No second Docker daemon, rootless Docker, Docker Desktop, TCP daemon listener, or Docker authorization proxy.
- No automatic engine upgrade or downgrade for an existing installation.
- No automatic deletion of old Docker/containerd data after migration.
- No automatic cleanup after an uncatchable `SIGKILL`, runner crash, VM crash, or host shutdown.
- No guarantee that Codex filesystem restrictions protect VM secrets after Docker socket access is granted.
- No rewrite of completed ExecPlans.

## Current integration boundary

Only these current interfaces are relevant to this change:

- `update.sh` is the required host entrypoint for Docker provisioning.
- `scripts/codex-run` owns disposable per-run state and starts Codex through a clean environment.
- `src/execution/codex-executor.ts` constructs Codex permissions and controls timeout termination.
- `runner/finalize.sh` performs worktree inspection, staging, commit, and push.
- `.github/workflows/codex.yml` already streams `run-codex.mjs` output through `tee` into `agent-relay-console.log` and uploads that file.

Do not restate or redesign unrelated update, CI, Git synchronization, installation, or workflow behavior.

## Progress

- [x] Confirm the target host is the dedicated Debian 13 Hyper-V VM.
- [x] Confirm unrestricted rootful Docker access is acceptable inside that VM.
- [x] Confirm Docker installation belongs only to `update.sh`.
- [x] Confirm the existing workflow log stream is sufficient and no workflow edit is required.
- [x] Confirm the Compose lifecycle must survive normal workload timeout long enough to emit logs and run cleanup.
- [ ] Add trusted Docker host provisioning used only by `update.sh`.
- [ ] Install or adapt Docker without replacing an existing engine stack.
- [ ] Move or initialize persistent Docker and containerd data below `/srv/github-runner/docker`.
- [ ] Configure group membership, systemd units, and host smoke validation.
- [ ] Expose Docker socket access and private Docker client state to Codex.
- [ ] Add the Compose normalization, replay registry, log collection, and unconditional cleanup path.
- [ ] Refactor timeout supervision so cleanup has a separate bounded grace period.
- [ ] Add finalizer ownership validation before worktree-inspecting Git commands.
- [ ] Add deterministic repository coverage and complete target-host acceptance.
- [ ] Update current documentation after the Docker implementation is validated.
- [ ] Complete `Outcomes & Retrospective` and move this file to `docs/exec-plans/completed/` only when every acceptance item has evidence.

## Decision Log

### Docker installation

Use these initial Debian 13 amd64 pins for a Docker-absent host and fail if the official repository no longer exposes them:

```text
docker-ce=5:29.6.2-1~debian.13~trixie
docker-ce-cli=5:29.6.2-1~debian.13~trixie
containerd.io=2.2.6-1~debian.13~trixie
docker-buildx-plugin=0.35.0-1~debian.13~trixie
docker-compose-plugin=5.3.1-1~debian.13~trixie
```

For an existing installation, keep the installed engine, CLI, and containerd package versions. A missing Buildx or Compose plugin may be installed only when package-manager simulation proves that doing so will not replace those packages. Otherwise fail with an exact compatibility diagnostic.

### Persistent storage

Use:

```text
/srv/github-runner/docker/engine
/srv/github-runner/docker/containerd
```

Write Agent Relay-managed `/etc/docker/daemon.json` with Docker `data-root` set to the engine path. Generate a valid containerd v2 configuration with its persistent `root` set to the containerd path. Keep volatile containerd state under `/run`.

When an existing source root contains data and differs from the managed target:

1. stop Docker and containerd cleanly;
2. require the target to be empty or already equivalent;
3. copy metadata, ownership, hard links, ACLs, extended attributes, and numeric IDs;
4. validate the copy before starting services;
5. retain the old source data.

If both source and target contain different data, fail rather than merge them.

### Privilege model

Ensure the `docker` group exists. Add `github-runner` idempotently and remove `agent-relay-builder` if it is unexpectedly present. Verify exact membership.

Enable and start `containerd.service` and `docker.service`. Do not add Docker dependencies to `actions.runner.Divorium.gh-runner.service`.

### Workflow decision

Do not modify `.github/workflows/codex.yml` or `examples/github-actions/codex.yml` for this feature.

Rationale:

- Docker is installed on the self-hosted host and becomes available through the existing generic command path.
- Workspace identity is already available to the runtime and can be propagated internally.
- Compose lifecycle output written by `scripts/codex-run` already reaches the existing `tee` stream and artifact.
- No new secret, request field, runner label, permission, service container, or workflow environment contract is required.

A workflow change becomes valid only if implementation proves a concrete missing interface that cannot be supplied by the executor or launcher. Record that evidence before changing the workflow.

### Compose lifecycle

Ordinary Docker commands pass through unchanged to `/usr/bin/docker`.

For `docker compose`, normalize only what is required to reproduce project lifecycle operations. This is operational lifecycle handling, not a command security policy.

Treat top-level help/version and the explicit non-project operations `version`, `ls`, and `bridge` as global. They pass through without file discovery, project-name injection, replay registration, or cleanup.

Unknown Compose subcommands default to project-scoped handling so cleanup is not silently skipped.

For each project-scoped invocation:

1. require the canonical current directory to remain inside the canonical workflow workspace;
2. reject user-provided `-p`, `--project-name`, and `COMPOSE_PROJECT_NAME`;
3. resolve explicit and environment-derived Compose files, env files, and project directories canonically inside the workspace;
4. reject stdin, remote Git, OCI, or other non-local Compose definitions that cannot be replayed deterministically;
5. normalize `COMPOSE_FILE`, profiles, env-file controls, and project-directory semantics into explicit options;
6. preserve ordinary interpolation variables in a private environment snapshot without printing them;
7. derive the effective project directory;
8. derive and inject one deterministic project name;
9. register a private replay record before an operation that may create or retain resources;
10. forward the requested subcommand and remaining arguments without filtering destructive operations.

Effective project-directory precedence:

1. explicit `--project-directory`;
2. parent of the first explicit or `COMPOSE_FILE`-derived file;
3. directory containing the deterministically discovered default Compose file;
4. canonical current directory when the command does not require an existing file.

Normalize the directory basename by lowercasing ASCII, replacing runs outside `[a-z0-9_-]` with `-`, removing invalid leading characters, trimming trailing `-` and `_`, and failing if the result is empty or exceeds the installed Compose limit. Do not truncate ambiguously.

The replay record contains at least:

- project name;
- project directory;
- ordered Compose files;
- ordered env files;
- ordered profiles;
- private environment-snapshot path;
- canonical workspace identity;
- insertion order.

Deduplicate by the complete replay identity, not only project name.

### Timeout and cleanup supervision

Refactor `scripts/codex-run` into a supervisor. Start the actual Codex CLI in a separate workload process group. The supervisor must remain outside the process group terminated at normal Codex timeout.

Use two bounded periods:

- 5 seconds between workload `SIGTERM` and workload-only `SIGKILL`;
- 120 seconds for Compose log collection and cleanup after the workload exits.

On timeout or handled interrupt:

1. signal the supervisor;
2. the supervisor terminates the Codex workload group;
3. after 5 seconds, kill only remaining workload processes;
4. keep the supervisor alive for cleanup;
5. collect logs and run `down -v` for every replay record in reverse first-use order;
6. only after the cleanup deadline may the executor force-kill the supervisor and remaining cleanup descendants.

For each replay record:

1. print a bounded non-secret header;
2. restore the private replay environment;
3. run `docker compose ... logs --no-color --timestamps`;
4. run `docker compose ... down -v` regardless of log-command success;
5. print exit statuses and bounded diagnostics;
6. continue with remaining projects after an individual failure.

If Codex succeeded but required cleanup failed, fail the run. If Codex already failed or timed out, preserve that primary result and report cleanup failure separately.

### Finalization ownership

Immediately after canonical workspace validation in `runner/finalize.sh`, before `git status`, `git diff`, `git add`, or another worktree-inspecting Git command, scan the workspace without crossing filesystem boundaries or following symlinks.

Every checkout path must be owned by the current `github-runner` UID. On violation, print bounded path, UID, GID, and mode diagnostics and fail. Do not call sudo, chown, chmod, delete files, or invoke Docker as repair.

## Plan of Work

### 1. Add host provisioning

Create `scripts/docker-host.sh` as a trusted regular non-symlink Bash module with no side effects when sourced. Invoke it only from `update.sh` at the existing host-mutation boundary after the runner cannot accept or continue a job and before destructive runtime replacement.

The module owns detection, repository setup, package installation, storage migration, configuration, group membership, service activation, and smoke validation. Keep `update.sh` orchestration narrow.

### 2. Install or adapt Docker

For a Docker-absent Debian 13 amd64 host, add the official apt key and source, validate every pinned version, and install the exact package set with `--no-install-recommends`.

For an existing installation, inspect client, server, package ownership, Buildx, and Compose independently. Preserve the engine stack and augment only compatible missing plugins.

### 3. Configure storage and services

Create root-owned managed storage directories, preserve existing persistent data, write managed configuration, and start enabled services. Avoid unnecessary restarts when configuration and services are already correct.

Run smoke checks as `github-runner`:

```bash
docker version
docker info
docker buildx version
docker compose version
docker run --rm hello-world
```

Every successful provisioning execution includes the real `hello-world` run.

### 4. Expose Docker to Codex

Create private per-run directories for Docker client state, a copied launcher, Compose registry, and environment snapshots. Set `DOCKER_CONFIG` to private state. Do not set `DOCKER_HOST`; use the default local Unix socket.

Copy a trusted launcher into private per-run `bin/docker`, mode `0700`, prepend that directory to `PATH`, and have it execute absolute `/usr/bin/docker`.

Propagate internal canonical workspace and registry paths through the clean environment. Preserve supplementary groups. Do not use sudo or `newgrp` inside Codex.

Add exact Codex filesystem permission entries for `/var/run/docker.sock` and `/run/docker.sock`. Do not grant parent-directory access.

### 5. Implement Compose lifecycle and timeout supervision

Implement the normalization, replay registry, cleanup ordering, status propagation, and supervisor protocol defined above.

### 6. Protect finalization

Implement the foreign-ownership scan before worktree inspection.

### 7. Add deterministic coverage

Repository validation must not require a live Docker daemon. Extend shell and TypeScript harnesses with fake package, systemd, filesystem, process, and Docker clients.

Cover at least:

- fresh pinned installation;
- existing complete Docker without engine replacement;
- compatible and incompatible plugin-only augmentation;
- data migration and conflicting target roots;
- exact group repair;
- enabled/active service behavior;
- every smoke failure stage and repeated `hello-world` execution;
- private launcher and Docker client state;
- exact socket permissions and preserved supplementary groups;
- transparent ordinary Docker pass-through;
- global and project-scoped Compose classification;
- workspace path rejection and deterministic project naming;
- complete private replay state without secret output;
- reverse-order logs then `down -v`;
- success, failure, timeout, interrupt, individual cleanup failure, and cleanup timeout;
- ownership failure before Git worktree inspection;
- absence of workflow, request-contract, label, or routing changes;
- absence of Docker installation in `install.sh`.

### 8. Target-host acceptance

On the Debian 13 Hyper-V VM, use the normal update entrypoint. Do not rerun installation, runner registration, or Codex login.

Verify services, group membership, storage roots, client/server access, Buildx, Compose, and `hello-world`. Verify `agent-relay-builder` cannot access Docker and stopping Docker does not stop the GitHub Actions runner.

Run real Codex tasks against a workspace-local Compose fixture that uses an env file, profile, named volume, interpolation variable, recognizable logs, and a directory name requiring normalization. Prove logs precede cleanup and resources are removed after success, intentional command failure, controlled timeout, and controlled interrupt.

Verify global Compose operations work without a Compose file or replay registration. Verify a controlled foreign-owned checkout file blocks finalization before Git worktree inspection.

## Validation and Acceptance

The implementation is accepted only when:

- Docker installation occurs only through `update.sh` and `install.sh` remains Docker-free;
- fresh installation uses the exact pinned official package set;
- an existing installation keeps its engine, CLI, and containerd versions;
- persistent data lives below `/srv/github-runner/docker` and existing data is preserved during migration;
- Docker and containerd are enabled and active;
- `github-runner` has Docker access and `agent-relay-builder` does not;
- the runner service has no Docker dependency;
- Codex receives full rootful Docker access without sudo or command filtering;
- Buildx and Compose v2 work and legacy `docker-compose` is absent;
- every successful provisioning run performs the complete smoke including `hello-world`;
- private workspace, launcher, registry, environment snapshot, and Docker client state survive the clean-environment boundary;
- global Compose operations do not register cleanup;
- project-scoped paths remain inside the canonical workspace;
- project identity and replay inputs are deterministic and reused for logs and cleanup;
- the cleanup supervisor survives workload termination and receives the separate cleanup grace period;
- logs are emitted before `docker compose down -v` after success, failure, timeout, and handled interrupt;
- lifecycle output reaches the existing `agent-relay-console.log` artifact without workflow changes;
- no stale cleanup, pruning policy, resource limit, authorization broker, or automatic ownership repair is added;
- foreign-owned checkout paths fail before worktree-inspecting Git commands;
- current documentation is updated only after implementation evidence proves Docker is available;
- deterministic validation and target-host acceptance evidence are recorded.

## Idempotency and recovery

Repeated provisioning must not reinstall or upgrade a complete Docker stack, duplicate membership, recopy equivalent data, or restart healthy correctly configured services unnecessarily. The complete smoke still runs on every successful invocation.

Partial package or data-copy work must be resumable. Never delete source data automatically. If an uncatchable kill or host crash leaves Docker resources, recovery is manual administration inside the VM.

Per-run Docker and Compose state remains available through cleanup and is removed after the supervisor finishes.

## Security model

Within the VM, Docker socket access makes `github-runner` and Codex root-equivalent. They can run privileged containers, mount VM filesystems, inspect runner credentials, change networking, and bypass direct filesystem denies. Workspace checks, exact socket entries, launcher normalization, and private replay state are operational correctness controls, not a security boundary against trusted code.

Do not expose Docker over TCP. Do not mount the socket into application containers by default. Do not claim that VM credentials or secrets remain protected from Docker-enabled Codex.

## Outcomes & Retrospective

Pending implementation and validation.
