# Persist GitHub runner registration across Compose recreation

This ExecPlan is a living implementation document maintained according to `.agent/PLANS.md`. Implementation must not start until the user explicitly approves this plan.

## Purpose / Big Picture

Make the existing repository-scoped, persistent GitHub Actions runner survive container recreation without requiring a new registration token after routine deployment operations such as `docker compose down`, `docker compose up`, image rebuilds, or replacement of the runner container.

The current runner stores its registration and credentials inside `/actions-runner` in the container writable layer. Compose persists only `/runner/_work`. Restarting the same container works, but deleting and recreating the container removes `.runner`, `.credentials`, and related state. The entrypoint then requires a new short-lived `RUNNER_TOKEN` and registers the runner again.

The implementation will give the runner installation and registration state an explicit lifecycle independent of the Compose project by mounting a pre-created external named volume at `/actions-runner`. The volume will not be removed by `docker compose down` or `docker compose down -v`. The runner remains the same persistent self-hosted runner; this plan does not introduce ephemeral runners, automatic registration through the GitHub API, a GitHub App, a PAT, OAuth changes, an init container, Docker socket access, or a second runtime account.

## Progress

- [x] (2026-07-16) Confirmed that current `docker-compose.yml` persists only `/runner/_work` for the runner service.
- [x] (2026-07-16) Confirmed that `Dockerfile.runner` installs the GitHub Actions runner under `/actions-runner` and that `runner/entrypoint.sh` treats `/actions-runner/.runner` as the registration marker.
- [x] (2026-07-16) Selected a pre-created external named volume so registration state survives both container replacement and `docker compose down -v`.
- [x] (2026-07-16) Kept the design within the existing persistent-runner architecture and rejected API-driven or ephemeral re-registration.
- [ ] Obtain explicit user approval of this plan before implementation.
- [ ] Add and wire the external runner volume in Compose.
- [ ] Update runner startup validation and repository-owned tests for persistent state behavior.
- [ ] Update operational documentation with first-registration, normal-restart, recovery, deletion, and upgrade behavior.
- [ ] Run the complete repository validation and record its evidence.
- [ ] Review the implementation against every acceptance criterion, complete Outcomes & Retrospective, and move this plan to `docs/exec-plans/completed/`.

## Surprises & Discoveries

- Observation: `restart: unless-stopped` protects the existing container across Docker daemon or host restarts, but it does not preserve the container writable layer after `docker compose down` or another recreation operation.
- Observation: the workspace volume does not contain runner registration state. GitHub stores runner configuration and credentials next to the runner installation under `/actions-runner`.
- Observation: the current runner is not configured with `--ephemeral` or `--disableupdate`. It is a persistent runner and GitHub Runner manages its own in-place updates.
- Observation: project-owned helper programs are outside `/actions-runner`: the entrypoint is `/entrypoint.sh` and workflow helpers are under `/runner`. Mounting `/actions-runner` therefore does not hide project-owned helper changes.
- Observation: a normal Compose-managed named volume would survive `docker compose down` but would be deleted by `docker compose down -v`. The repeated token problem must remain fixed even when other disposable project volumes are recreated.

## Decision Log

- Decision: use an external named volume with a stable explicit name for `/actions-runner`.
  Rationale: the complete persistent runner installation, including registration credentials and GitHub-managed updates, must survive container replacement. An external volume has a lifecycle independent of the Compose project and is not removed by `down -v`.
  Date/Author: 2026-07-16 / user direction and repository review.

- Decision: persist the complete `/actions-runner` directory rather than introducing per-file symlinks for `.runner` and credential files.
  Rationale: GitHub Runner stores several related configuration, credential, RSA, migration, diagnostic, and update files in its installation root and may replace those files during its own lifecycle. Persisting the root follows the runner's native storage model and avoids a custom list of symlinks that could become incomplete or be replaced by runner updates.
  Date/Author: 2026-07-16 / implementation planning.

- Decision: keep `/runner/_work` as the existing separate workspace volume.
  Rationale: checkout/workspace lifecycle is distinct from runner registration and already shared with Agent Relay. The new volume must not merge credentials with repository workspaces.
  Date/Author: 2026-07-16 / existing architecture.

- Decision: require one explicit `docker volume create` command before first deployment of this change.
  Rationale: Compose must fail visibly rather than silently create a new empty registration store after accidental deletion or a project-name change.
  Date/Author: 2026-07-16 / external-volume lifecycle.

- Decision: do not automate token acquisition or runner registration through GitHub APIs.
  Rationale: that would require a long-lived PAT or GitHub App permission solely to replace local persistent state, expand the credential model, and change the project architecture without solving an additional current requirement.
  Date/Author: 2026-07-16 / scope control.

- Decision: do not add an init container or a root startup process to repair ownership.
  Rationale: the runner image already creates `/actions-runner` with the configured runner UID/GID. Docker initializes an empty volume from the image directory, preserving the intended initial contents and ownership. The implementation will validate this definition without introducing a recurring privileged component.
  Date/Author: 2026-07-16 / project constraints.

## Outcomes & Retrospective

Pending implementation and validation.

## Context and Orientation

`Dockerfile.runner` downloads and extracts the GitHub Actions runner into `/actions-runner`, changes ownership to the non-root `runner` account, sets `WORKDIR /actions-runner`, and starts `/entrypoint.sh`.

`runner/entrypoint.sh` currently checks for `.runner`. If the file does not exist, it requires `RUNNER_TOKEN`, `RUNNER_REPOSITORY_URL`, and `RUNNER_NAME`, then executes `config.sh --unattended --replace`. When `.runner` exists, it skips registration, removes `RUNNER_TOKEN` from the environment, and starts `run.sh`.

`docker-compose.yml` currently mounts only `workspace:/runner/_work` into the runner service. No mounted storage covers `/actions-runner`, so registration survives a restart of the same container but not recreation of that container.

The planned external volume will be declared with a stable name such as `agent-relay-runner-state` and mounted at `/actions-runner`. The operator will create it once before the first deployment. On its first empty mount, Docker will initialize it from the runner installation contained in the image. The first runner registration will then write `.runner`, `.credentials`, `.credentials_rsaparams`, and any related runner-managed files into the external volume. Later container recreations will mount the same configured runner installation.

## Plan of Work

First, update Compose so the runner service mounts an external volume at `/actions-runner` in addition to the existing workspace volume. Declare the volume as `external: true` with an explicit stable name that does not depend on the Compose project name.

Second, review `runner/entrypoint.sh` against the mounted-root lifecycle. Preserve the current contract: registration happens only when `.runner` is absent; `RUNNER_TOKEN` is required only for that first registration; and the token is removed before `run.sh`. Add only validation that is necessary to produce a clear error when the external volume is missing, empty in an unexpected way, or not writable by the configured runner UID. Do not add API registration or background repair behavior.

Third, extend repository-owned tests. The entrypoint tests must cover both an empty first-registration root and a preconfigured root where no `RUNNER_TOKEN` is present. Compose-definition tests must assert that `/actions-runner` uses the external runner-state volume, that `/runner/_work` remains separate, and that the external volume has a stable explicit name. Tests must not claim to execute Docker when Docker is unavailable.

Fourth, update operations documentation. Document the one-time volume creation, first registration, normal `down`/`up`, `down -v`, deliberate runner-state deletion, GitHub-side runner removal, and recovery from a stale or invalid registration. Explicitly distinguish disposable `workspace` and `relay-state` volumes from the durable runner registration volume.

Finally, run the complete repository validation, inspect the patch for credential exposure or lifecycle regressions, update this plan with evidence, and move it to completed only after every criterion passes.

## Concrete Steps

From the repository root, implementation will update these areas:

1. `docker-compose.yml`
   - mount `runner-state:/actions-runner` in the runner service;
   - declare `runner-state` as an external volume with the explicit name `agent-relay-runner-state`;
   - retain `workspace:/runner/_work` unchanged.

2. `runner/entrypoint.sh`
   - preserve existing first-registration and subsequent-start behavior;
   - add only startup checks required by the external-volume contract;
   - continue unsetting `RUNNER_TOKEN` before the runner process starts.

3. Repository tests
   - prove a configured runner starts without `RUNNER_TOKEN`;
   - prove an unconfigured runner still requires a token;
   - validate the external volume declaration and mount target;
   - verify credentials are not placed in the workspace volume or Agent Relay container.

4. `docs/operations/README.md` and related setup documentation
   - add the one-time command:

         docker volume create agent-relay-runner-state

   - document that the external volume survives `docker compose down -v`;
   - document deliberate removal and one-time re-registration;
   - remove any guidance implying a fresh token is expected after routine container recreation.

5. Validation

         npm ci
         npm run check

Docker runtime validation will be executed only if the available automated environment can run Docker. If it cannot, the plan will record that limitation explicitly and will not misrepresent static or shell-fixture checks as a running-container test.

## Validation and Acceptance

The implementation is accepted only when all of the following are true:

1. `docker-compose.yml` mounts one stable external volume at `/actions-runner` for the runner service.
2. The runner workspace remains a separate `workspace:/runner/_work` mount shared according to the existing architecture.
3. `docker compose down` followed by `docker compose up` is designed to reuse the same `.runner` and credential state without a new `RUNNER_TOKEN`.
4. `docker compose down -v` does not declare or remove the external runner-state volume.
5. First deployment with an empty external volume still performs exactly one token-based registration using the existing entrypoint contract.
6. A subsequent start with existing registration state succeeds without `RUNNER_TOKEN`.
7. The runner still executes as the configured non-root `runner` UID/GID.
8. `RUNNER_TOKEN` is unset before `run.sh` and is not persisted in the runner-state or workspace volumes.
9. No PAT, GitHub App credential, OAuth extension, automatic GitHub API registration, ephemeral runner, init container, Docker socket, or second runtime account is introduced.
10. Project-owned scripts and workflow helpers remain outside `/actions-runner` and continue to come from the current image after rebuilds.
11. Operational documentation clearly explains one-time creation, normal lifecycle, deliberate deletion, and recovery.
12. All repository validation passes, with unavailable Docker execution recorded as an explicit limitation rather than silently treated as complete runtime proof.

## Idempotence and Recovery

Creating the external volume is idempotent: `docker volume create agent-relay-runner-state` returns the existing volume when it already exists.

Routine Compose recreation is idempotent because the same external volume is mounted back at `/actions-runner`. The entrypoint sees `.runner` and skips registration.

Deliberate recovery from invalid or revoked registration consists of removing the runner from GitHub when necessary, stopping the stack, deleting only `agent-relay-runner-state`, creating it again, supplying a new short-lived registration token, and starting the stack. The implementation must not delete or recreate this volume automatically.

The existing `workspace` and `relay-state` volumes retain their current lifecycle. Deleting them must not delete runner registration. Deleting runner registration must not delete repository workspaces or Relay job state.

## Artifacts and Notes

Relevant current files:

- `docker-compose.yml`
- `Dockerfile.runner`
- `runner/entrypoint.sh`
- `test/runner-entrypoint.test.sh`
- `docs/operations/README.md`

The plan intentionally contains no implementation changes. User approval is the unblock condition for implementation.