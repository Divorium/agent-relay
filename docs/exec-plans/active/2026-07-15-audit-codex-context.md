# Minimize and align Codex context

This ExecPlan is a living document and must remain current while the work proceeds.

Any work item that the agent cannot complete must remain unchecked and be marked `[blocked]` in `Progress`. The same entry must state the cause, impact, evidence, and the concrete condition that will unblock it. A blocker is plan documentation only: it is not a Codex result status, not a Relay job status, and it must not prevent completed work from being preserved. Remove `[blocked]` as soon as the condition is resolved and continue the item.

## Purpose / Big Picture

Codex should receive only the repository instructions and task context required to implement the requested change. The repository must not give Codex conflicting commands, duplicate the same rule across multiple sources, assign runner or operator responsibilities to Codex, or expose operational and security data that is not required by the Codex CLI.

After this work, each context source has one narrow owner. `AGENTS.md` contains durable engineering constraints. `.agent/PLANS.md` contains reusable ExecPlan lifecycle rules, including how unresolved blockers are recorded. `src/execution/prompt.ts` contains only the task location, execution mode, the prohibition against creating or publishing commits, and the minimal structured result contract. GitHub authentication, Relay authentication, runner registration, Relay state, host Codex history, workflow metadata, commit decisions, commit-message creation, and publication remain outside the Codex task boundary.

The structured result is evidence from a completed process, not a model-selected outcome. It contains no top-level `status`, `blockers`, `limitations`, `shouldCommit`, or `commitMessage`. Relay derives technical job state from process execution and result validation. Incomplete work and real blockers are recorded in the active ExecPlan, while Git determines whether the runner has changes to preserve.

## Progress

- [x] (2026-07-15) Created this plan before implementation changes.
- [x] (2026-07-15) Inventoried repository instructions, prompt construction, job request fields, child environment, workflow inputs, checkout authentication, finalization authentication, Compose mounts, container users, Relay state, runner files, operations documentation, and result-state handling.
- [x] (2026-07-15) Classified each discovered item as required task context, durable repository rule, runner-owned control, operator-only information, duplicate instruction, or inappropriate exposure.
- [x] (2026-07-15) Prepared a reduced runtime prompt and removed the unused `reviewFindings` instruction channel.
- [x] (2026-07-15) Replaced inherited process environment with an explicit Codex tool-runtime allowlist.
- [x] (2026-07-15) Prepared checkout and finalization changes so GitHub credentials are absent while Codex runs and supplied only to the push step.
- [x] (2026-07-15) Prepared separate `relay` and `agent` users, a fixed sanitized Codex launcher, a Relay-only state directory, and an `auth.json`-only host mount.
- [x] (2026-07-15) Added focused tests for prompt contents, request shape, environment filtering, isolated invocation, workflow credential lifetime, packaging mounts, Relay state ownership, and push authentication.
- [x] (2026-07-15) Found that the result contract lets Codex choose `completed` or `blocked`, and that a `blocked` choice converts useful partial work into a failed run after the model has already completed execution.
- [ ] Remove model-controlled outcome fields from the result contract: `status`, `blockers`, `limitations`, and `commitMessage`.
- [ ] Remove `blocked` from `JobStatus`, persistence, API handling, runner handling, tests, examples, and documentation. Preserve only Relay-owned technical terminal states such as `completed`, `failed`, `timed_out`, and `interrupted`.
- [ ] Make a successful Codex process with a valid minimal result produce Relay status `completed`; process, timeout, persistence, or invalid-result failures remain Relay-owned failures.
- [ ] Derive the runner commit message deterministically from the active ExecPlan title, with a validated fixed fallback when the plan has no usable heading.
- [ ] Add the `[blocked]` living-plan rule to `.agent/PLANS.md` and update the active plan continuously whenever a real blocker is discovered or cleared.
- [ ] Apply the prepared context-boundary implementation tree to the branch and run automated validation.
- [ ] Perform a fresh audit from workflow dispatch through result finalization without relying on the first findings list.
- [ ] Fix every additional finding and repeat the audit until a complete pass produces no new conflict, duplicate instruction, runner-owned responsibility, unnecessary context item, or model-controlled outcome.
- [ ] Run full repository and image validation and record exact results.
- [ ] Move this plan to `docs/exec-plans/completed/` only after the final audit and validation are complete and no item remains unchecked or `[blocked]`.

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

- Observation: Codex currently owns a terminal business decision that Relay should derive.
  Evidence: `CodexResult.status` allows `completed` or `blocked`; the prompt asks the model to choose the field; validators accept both; `JobService` copies the choice into `JobRecord.status`; and the runner throws after receiving `blocked`.

- Observation: `blockers` and `limitations` duplicate the active ExecPlan and make the result file another state document.
  Evidence: the active plan is already required to remain current, but the result contract separately asks Codex to summarize blockers and limitations at exit. The two sources can disagree.

- Observation: `commitMessage` assigns a runner concern to Codex.
  Evidence: the runner already owns Git status, staging, commit, and push. A commit message can be derived from the active plan heading without adding Git-publication context to the model result.

## Decision Log

- Decision: keep each instruction in one canonical context layer.
  Rationale: durable engineering constraints belong in `AGENTS.md`; plan lifecycle belongs in `.agent/PLANS.md`; task execution and result shape belong in the runtime prompt. The prompt must not restate repository architecture or operational procedures.
  Date/Author: 2026-07-15 / repository audit.

- Decision: blockers live only in the active ExecPlan.
  Rationale: when an item cannot be completed, the agent leaves it unchecked and marks it `[blocked]` with cause, impact, evidence, and unblock condition. This preserves a restartable living document without converting partial progress into a failed result or creating a second blocker list.
  Date/Author: 2026-07-15 / repository audit.

- Decision: Codex does not choose a terminal outcome.
  Rationale: a process that exits successfully and writes a valid result has completed its execution. Relay alone classifies process failure, timeout, interruption, persistence failure, or invalid result. The result schema therefore has no top-level `status`.
  Date/Author: 2026-07-15 / repository audit.

- Decision: minimize the result to `schemaVersion`, `requestId`, `summary`, and `validation`.
  Rationale: blockers and incomplete work belong in the active plan; limitations are the same state expressed a second time; commit-message creation belongs to the runner. The remaining fields provide correlation, concise human output, and executable evidence.
  Date/Author: 2026-07-15 / repository audit.

- Decision: derive commit messages from the active plan title.
  Rationale: the runner already receives a validated plan path and owns all Git operations. It can read and normalize the first Markdown level-one heading, enforce the one-line length contract, and use a fixed fallback without asking Codex to reason about commits.
  Date/Author: 2026-07-15 / repository audit.

- Decision: enforce credential absence structurally rather than through model instructions.
  Rationale: checkout uses `persist-credentials: false`, the workflow verifies local Git configuration before Relay invocation, and the push token is scoped to finalization. The prompt no longer mentions GitHub credentials.
  Date/Author: 2026-07-15 / repository audit.

- Decision: run Relay and Codex as different local users.
  Rationale: Relay secrets and state cannot be isolated from a same-UID child with unrestricted workspace execution. The Relay process runs as `relay`; a fixed sudo rule starts only `/usr/local/bin/codex-run` as `agent`; Relay state is mode `0700`.
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

The result-state review found another context and ownership defect: Codex can declare `blocked`, causing Relay to reject the run after the model has already executed. The repaired design removes model-controlled outcome, blocker, limitation, and commit-message fields. A real blocker remains visible in the living ExecPlan, while Relay preserves valid work and owns only technical execution state.

The work is not complete until the implementation is committed, CI and image builds pass, the active plan contains no unresolved `[blocked]` entry, and a fresh audit finds no additional conflict, duplicate instruction, runner-owned responsibility, unnecessary exposure, or model-controlled outcome.

## Context and Orientation

The GitHub runner checks out a pull-request revision into a named workspace volume. Agent Relay mounts the same volume and launches Codex in that repository. The runtime prompt is created in `src/execution/prompt.ts`; the child process is created in `src/execution/codex-executor.ts`; the runner request and result validation are implemented in `runner/client.mjs`; result contracts are in `src/contracts/result.ts` and `src/contracts/validators.ts`; job terminal state is persisted through `src/contracts/job.ts` and `src/application/job-service.ts`.

Codex needs the repository, active plan, execution mode, minimal result contract, development toolchain, and its own authentication file. It does not need GitHub tokens, runner registration, Relay authentication, Relay state and logs, host Codex history or sessions, GitHub run metadata, detailed finalization mechanics, commit decisions, commit messages, or a terminal outcome choice.

## Plan of Work

First, repair the living-plan and result ownership contracts. Update `.agent/PLANS.md` with the `[blocked]` annotation rule. Remove `status`, `blockers`, `limitations`, and `commitMessage` from the Codex result interface, prompt, validators, runner validator, examples, tests, and documentation. Remove `blocked` from Relay `JobStatus`; set `completed` only after the Codex process exits successfully and the minimal result validates. Keep `failed`, `timed_out`, and `interrupted` as Relay-owned technical outcomes.

Change the runner so Git remains the only commit decision and the active plan supplies the commit message. Read the first valid `# ` heading from the validated plan file, normalize it to one line and the configured maximum length, and use a fixed fallback if no heading exists. Do not expose that derivation to Codex.

Then apply and validate the prepared context-boundary changes. The runtime prompt is reduced to task context, living-plan maintenance, validation, the commit-creation prohibition, and the minimal result shape. The create-job contract removes `reviewFindings`. The child environment changes from inheritance to an allowlist.

The container creates two users. The Relay service runs as `relay`. A fixed sudo rule allows it to launch only the sanitized Codex wrapper as `agent`. The wrapper clears the environment and reconstructs only stable toolchain variables. Relay state is owned by `relay` with mode `0700`. Compose mounts only the host `auth.json` into the agent home.

Both workflow copies disable persisted checkout credentials and verify local repository configuration before Codex starts. The finalization step receives the push token and uses a temporary askpass helper. The workflow stops constructing request IDs from GitHub metadata; the runner client generates an opaque UUID by default.

After validation, start a new audit from `.github/workflows/agent-relay.yml` and `compose.yml`, then trace through the runner, request contract, Relay configuration, process creation, prompt, filesystem permissions, plan maintenance, result validation, job-state derivation, finalization, tests, examples, and documentation. Record each new finding in this plan, fix it, and repeat from a fresh entry point until one full pass produces no new finding.

## Concrete Steps

Run from the repository root:

    npm ci
    npm run check
    docker compose config
    docker build --tag agent-relay:local .
    docker build --file Dockerfile.runner --tag agent-relay-runner:local .
    docker run --rm --entrypoint /bin/bash agent-relay:local /app/scripts/toolchain-smoke.sh

Focused automated tests must cover:

- the minimal result schema and rejection of removed fields;
- Relay-owned job terminal state with no `blocked` value;
- useful work preserved when the plan contains an unchecked `[blocked]` item;
- plan-title commit-message derivation and fallback;
- prompt contents and absence of runner-owned details;
- request shape and opaque request IDs;
- environment filtering and isolated invocation;
- credential lifetime, mount boundaries, Relay state permissions, and push authentication.

The audit itself is a maintainer review. Do not add repository instructions that tell task-executing Codex to inspect or certify its own permissions, credentials, Git ownership model, result-state ownership, or context boundary.

## Validation and Acceptance

The active plan is the only location for blockers and incomplete work. `.agent/PLANS.md` requires an unchecked `[blocked]` item with cause, impact, evidence, and unblock condition, and requires the marker to be removed when resolved.

The runtime prompt contains the active plan, execution mode, living-plan maintenance requirement, validation requirement, commit-creation prohibition, and minimal result contract. It does not mention the AGENTS instruction chain, GitHub credentials, runner ownership details, Git inspection, `shouldCommit`, `status`, `blockers`, `limitations`, or `commitMessage`.

The Codex result accepts exactly `schemaVersion`, `requestId`, `summary`, and `validation`. Removed fields are rejected. A valid result after exit code zero leads to Relay status `completed`; Codex cannot select another terminal status. `blocked` does not exist in `JobStatus`, persisted records, API responses, runner logic, examples, tests, or current documentation.

The runner uses `git status --porcelain` to decide whether changes exist. When changes exist, it derives a validated commit message from the active plan title or a fixed fallback. No result field controls commit creation or publication.

The create-job request has no unused free-form instruction field. Production request IDs are opaque UUIDs.

The Codex process receives only the environment allowlist and starts through an `env -i` wrapper as the `agent` user. The Relay service runs as `relay`; `/var/lib/agent-relay` is mode `0700`; the agent user cannot read it.

The shared worktree contains no persisted checkout credential. A push credential exists only in the finalization step and is consumed through a temporary askpass helper without changing the remote URL or local credential configuration.

Only `auth.json` is mounted under `/home/agent/.codex`. No host Codex configuration, history, session, log, or rule directory is mounted.

All automated checks and image builds pass. A final audit produces no new finding. The plan contains no unresolved unchecked or `[blocked]` item before it is moved to `completed/`.

## Idempotence and Recovery

The audit can be repeated without changing repository state. The implementation uses fixed file paths and declarative Compose configuration. Rebuilding containers recreates the user and permission boundary. The temporary askpass file is removed on exit. Failed runs do not persist GitHub credentials in repository configuration.

A technical Relay failure leaves the active plan and any worktree changes available for diagnosis. A task-level blocker does not create a technical Relay failure: the agent records it in the active plan, preserves completed work, writes the minimal valid result, and exits normally.

## Artifacts and Notes

Implementation paths include:

- `.agent/PLANS.md`
- `AGENTS.md`
- `src/execution/prompt.ts`
- `src/contracts/result.ts`
- `src/contracts/job.ts`
- `src/contracts/validators.ts`
- `src/application/job-service.ts`
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

`CodexResult` becomes a fixed four-field evidence record: `schemaVersion`, `requestId`, `summary`, and `validation`. `JobStatus` remains a Relay-owned execution lifecycle and contains no `blocked` member.

`CodexExecutor` accepts an optional `runAsUser` constructor argument. `createCodexInvocation()` produces a direct invocation in tests and a fixed `/usr/bin/sudo -H -u <user> -- <command>` invocation in packaged execution.

`createCodexEnvironment()` returns only approved tool-runtime variables. `/usr/local/bin/codex-run` then uses `env -i` to define the final Codex environment.

`AppConfig` gains optional `codexRunAsUser`, loaded from `CODEX_RUN_AS_USER`. Packaged Compose sets it to `agent` and uses `/usr/local/bin/codex-run` as `CODEX_COMMAND`.