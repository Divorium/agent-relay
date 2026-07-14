# Minimize and align Codex context

This ExecPlan is a living document and must remain current while the work proceeds.

## Purpose / Big Picture

Codex should receive only the repository instructions and task context required to implement the requested change. The repository must not give Codex conflicting commands, duplicate the same rule across multiple sources, assign runner or operator responsibilities to Codex, or expose operational and security data that is not required by the Codex CLI.

After this work, each context source has one narrow owner. `AGENTS.md` contains durable engineering constraints. `.agent/PLANS.md` contains reusable ExecPlan lifecycle rules. `src/execution/prompt.ts` contains the task location, execution mode, commit-creation prohibition, and structured result contract. GitHub authentication, Relay authentication, runner registration, Relay state, host Codex history, and workflow metadata remain outside the Codex task boundary.

## Progress

- [x] (2026-07-15) Created this plan before implementation changes.
- [x] (2026-07-15) Inventoried repository instructions, prompt construction, job request fields, child environment, workflow inputs, checkout authentication, finalization authentication, Compose mounts, container users, Relay state, runner files, and operations documentation.
- [x] (2026-07-15) Classified each discovered item as required task context, durable repository rule, runner-owned control, operator-only information, duplicate instruction, or inappropriate exposure.
- [x] (2026-07-15) Prepared a reduced runtime prompt and removed the unused `reviewFindings` instruction channel.
- [x] (2026-07-15) Replaced inherited process environment with an explicit Codex tool-runtime allowlist.
- [x] (2026-07-15) Prepared checkout and finalization changes so GitHub credentials are absent while Codex runs and supplied only to the push step.
- [x] (2026-07-15) Prepared separate `relay` and `agent` users, a fixed sanitized Codex launcher, a Relay-only state directory, and an `auth.json`-only host mount.
- [x] (2026-07-15) Added focused tests for prompt contents, request shape, environment filtering, isolated invocation, workflow credential lifetime, packaging mounts, Relay state ownership, and push authentication.
- [ ] Apply the prepared implementation tree to the branch and run automated validation.
- [ ] Perform a second audit from process launch to result finalization without relying on the first findings list.
- [ ] Fix every additional finding from the second pass and repeat until a full pass produces no new issues.
- [ ] Run the full repository and image validation and record exact results.
- [ ] Move this plan to `docs/exec-plans/completed/` only after the final audit and validation are complete.

## Surprises & Discoveries

- Observation: telling Codex not to access GitHub credentials did not create a security boundary.
  Evidence: both workflow copies used `persist-credentials: true`, leaving checkout authentication in local Git configuration inside the shared workspace.

- Observation: the complete host `.codex` directory was mounted into the execution container.
  Evidence: `compose.yml` mounted `HOST_CODEX_DIR` at `/home/agent/.codex`, exposing host configuration, history, sessions, logs, rules, and any other files beside the required authentication file.

- Observation: Relay and Codex ran as the same Unix user.
  Evidence: the image used `USER agent` for both the HTTP service and spawned Codex process, while `/var/lib/agent-relay` was available in the same container. Environment filtering alone could not prevent access to Relay process and state data.

- Observation: the environment boundary was a one-item denylist.
  Evidence: `createCodexEnvironment()` removed only `AGENT_RELAY_TOKEN` and inherited every other service, workflow, credential, and operator variable present in the parent process.

- Observation: the prompt repeated repository governance and described unavailable credentials.
  Evidence: it explicitly told Codex to read the complete instruction chain, explained runner ownership, mentioned GitHub credentials, allowed Git inspection commands, and referenced the removed `shouldCommit` field.

- Observation: `reviewFindings` was an unused secondary instruction channel.
  Evidence: the HTTP contract and prompt accepted it, but the runner client and workflow never supplied it. Keeping it increased instruction ambiguity without supporting a real execution path.

- Observation: production request IDs exposed GitHub repository and workflow-run metadata to the result prompt.
  Evidence: the workflow constructed `AGENT_RELAY_REQUEST_ID` from repository ID, run ID, and attempt. The client can generate an opaque UUID instead.

- Observation: push authentication depended on checkout credential persistence.
  Evidence: `runner/finalize.sh` ran `git push` without its own credential source. Removing checkout credentials therefore required a finalization-only token and temporary askpass helper.

## Decision Log

- Decision: keep each instruction in one canonical context layer.
  Rationale: durable engineering constraints belong in `AGENTS.md`; plan lifecycle belongs in `.agent/PLANS.md`; task execution and result shape belong in the runtime prompt. The prompt must not restate repository architecture or operational procedures.
  Date/Author: 2026-07-15 / repository audit.

- Decision: enforce credential absence structurally rather than through model instructions.
  Rationale: checkout uses `persist-credentials: false`, the workflow verifies local Git configuration before Relay invocation, and the push token is scoped to finalization. The prompt no longer mentions GitHub credentials.
  Date/Author: 2026-07-15 / repository audit.

- Decision: run Relay and Codex as different local users.
  Rationale: Relay secrets and state cannot be isolated from a same-UID child with `danger-full-access`. The Relay process runs as `relay`; a fixed sudo rule starts only `/usr/local/bin/codex-run` as `agent`; Relay state is mode `0700`.
  Date/Author: 2026-07-15 / repository audit.

- Decision: use an explicit environment allowlist and a final `env -i` launcher.
  Rationale: denylisting known secrets cannot cover future service variables. The executor passes only tool-runtime variables, and the launcher reconstructs the final environment from fixed values.
  Date/Author: 2026-07-15 / repository audit.

- Decision: mount only the required Codex authentication file.
  Rationale: the CLI requires authentication, but it does not require host history, sessions, logs, rules, or arbitrary configuration. `HOST_CODEX_AUTH_FILE` replaces the complete directory mount.
  Date/Author: 2026-07-15 / repository audit.

- Decision: retain `auth.json` as an explicit necessary exposure.
  Rationale: the Codex CLI must read its authentication material. This PR minimizes the mount to that one file but cannot make the file unreadable to the same process that authenticates with it.
  Date/Author: 2026-07-15 / repository audit.

- Decision: remove `reviewFindings` and use opaque request IDs by default.
  Rationale: the active plan is the task authority, and the current workflow has no review-findings input. GitHub repository and run identifiers are not needed by Codex; the runner can generate a UUID while tests retain an explicit override.
  Date/Author: 2026-07-15 / repository audit.

## Outcomes & Retrospective

The first audit produced a concrete boundary redesign rather than additional warnings for Codex. The prepared changes remove persisted GitHub credentials from the workspace, limit push credentials to finalization, separate Relay and Codex users, protect Relay state, replace the full host `.codex` mount with `auth.json`, sanitize the child environment twice, remove an unused instruction channel, reduce the prompt, and use opaque production request IDs.

The work is not complete until the implementation is committed, CI and image builds pass, and a fresh second audit finds no additional conflict, duplicate instruction, runner-owned responsibility, or unnecessary exposure.

## Context and Orientation

The GitHub runner checks out a pull-request revision into a named workspace volume. Agent Relay mounts the same volume and launches Codex in that repository. The runtime prompt is created in `src/execution/prompt.ts`; the child process is created in `src/execution/codex-executor.ts`; the runner request is created in `runner/client.mjs`; checkout and finalization are defined in the production and example workflow files.

Codex needs the repository, active plan, execution mode, result contract, development toolchain, and its own authentication file. It does not need GitHub tokens, runner registration, Relay authentication, Relay state and logs, host Codex history or sessions, GitHub run metadata, or detailed descriptions of runner-owned finalization.

## Plan of Work

Apply the prepared file set as one implementation commit. The runtime prompt will be reduced to task context and one commit-creation prohibition. The create-job contract will remove `reviewFindings`. The child environment will change from inheritance to an allowlist.

The container will create two users. The Relay service will run as `relay`. A fixed sudo rule will allow it to launch only the sanitized Codex wrapper as `agent`. The wrapper will clear the environment and reconstruct only stable toolchain variables. Relay state will be owned by `relay` with mode `0700`. Compose will mount only the host `auth.json` into the agent home.

Both workflow copies will disable persisted checkout credentials and verify the local repository configuration before Codex starts. The finalization step will receive the push token and use a temporary askpass helper. The workflow will stop constructing request IDs from GitHub metadata; the runner client will generate an opaque UUID by default.

After CI, start a second audit from `.github/workflows/agent-relay.yml` and `compose.yml`, then trace into the runner, Relay configuration, process creation, prompt, filesystem permissions, result handling, and documentation. Record and fix any new finding before completion.

## Concrete Steps

Run from the repository root:

    npm ci
    npm run check
    docker compose config
    docker build --tag agent-relay:local .
    docker build --file Dockerfile.runner --tag agent-relay-runner:local .
    docker run --rm --entrypoint /bin/bash agent-relay:local /app/scripts/toolchain-smoke.sh

The audit itself is a maintainer review. Do not add repository instructions that tell task-executing Codex to inspect or certify its own permissions, credentials, or Git ownership model.

## Validation and Acceptance

The runtime prompt contains the active plan, execution mode, validation requirement, commit-creation prohibition, and structured result contract. It does not mention the AGENTS instruction chain, GitHub credentials, runner ownership details, `shouldCommit`, or permission to inspect Git state.

The create-job request has no unused free-form instruction field. Production request IDs are opaque UUIDs.

The Codex process receives only the environment allowlist and then starts through an `env -i` wrapper as the `agent` user. The Relay service runs as `relay`; `/var/lib/agent-relay` is mode `0700`; the agent user cannot read it.

The shared worktree contains no persisted checkout credential. A push credential exists only in the finalization step and is consumed through a temporary askpass helper without changing the remote URL or local credential configuration.

Only `auth.json` is mounted under `/home/agent/.codex`. No host Codex configuration, history, session, log, or rule directory is mounted.

All automated checks and image builds pass. A second audit produces no new finding.

## Idempotence and Recovery

The audit can be repeated without changing repository state. The implementation uses fixed file paths and declarative Compose configuration. Rebuilding containers recreates the user and permission boundary. The temporary askpass file is removed on exit. Failed runs do not persist GitHub credentials in the repository configuration.

## Artifacts and Notes

Prepared implementation paths:

- `AGENTS.md`
- `src/execution/prompt.ts`
- `src/contracts/job.ts`
- `src/contracts/validators.ts`
- `src/execution/codex-executor.ts`
- `src/config/config.ts`
- `src/server.ts`
- `scripts/codex-run`
- `Dockerfile`
- `compose.yml`
- `.env.example`
- `.github/workflows/agent-relay.yml`
- `examples/github-actions/agent-relay.yml`
- `runner/client.mjs`
- `runner/finalize.sh`
- `README.md`
- `docs/operations/README.md`
- focused tests under `test/`

Validation evidence will be added after CI and image verification.

## Interfaces and Dependencies

No external application dependency is added. The image adds the Debian `sudo` package as the privilege-separation mechanism.

`CodexExecutor` accepts an optional `runAsUser` constructor argument. `createCodexInvocation()` produces a direct invocation in tests and a fixed `/usr/bin/sudo -H -u <user> -- <command>` invocation in packaged execution.

`createCodexEnvironment()` returns only approved tool-runtime variables. `/usr/local/bin/codex-run` then uses `env -i` to define the final Codex environment.

`AppConfig` gains optional `codexRunAsUser`, loaded from `CODEX_RUN_AS_USER`. Packaged Compose sets it to `agent` and uses `/usr/local/bin/codex-run` as `CODEX_COMMAND`.
