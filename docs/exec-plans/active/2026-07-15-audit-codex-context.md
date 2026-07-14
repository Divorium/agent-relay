# Minimize and align Codex context

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and validation evidence current while work proceeds.

When an item cannot be completed, leave it unchecked and mark it `[blocked]` in `Progress`. Record the cause, impact, evidence, and concrete unblock condition. Continue every unaffected item. A blocker is plan documentation only; it is not a Codex result or Relay job status and must not discard completed work. A plan with an unchecked or `[blocked]` item remains active.

## Purpose / Big Picture

Codex should receive only the repository instructions and task context required to implement this active ExecPlan. It must not receive conflicting commands, duplicate governance, runner or operator procedures, GitHub workflow metadata, Relay internals, host Codex history, or fields that ask the model to make control-plane decisions.

After this work:

- `AGENTS.md` contains only durable code rules;
- `.agent/PLANS.md` defines the reusable living-plan convention;
- the active ExecPlan is the sole task authority;
- the runtime prompt identifies the plan, requires plan maintenance and validation, and forbids commit/push;
- Relay derives technical execution state from the child process;
- Git and the runner own commit decisions and publication;
- task blockers and validation evidence remain in the active plan;
- no model-generated control or result artifact exists.

## Progress

- [x] (2026-07-15) Created this plan before implementation and opened draft PR #9 from current `main`.
- [x] (2026-07-15) Inventoried instruction files, prompt construction, request contracts, child environment, workflow inputs, checkout/finalization credentials, Compose mounts, container users, Relay state, runner files, tests, and operations documentation.
- [x] (2026-07-15) Removed the unused `reviewFindings` channel and undefined `implement`/`revise`/`finalize` mode.
- [x] (2026-07-15) Replaced inherited child environment with a minimal allowlist and a final `env -i` launcher.
- [x] (2026-07-15) Removed persisted checkout credentials and scoped the push token to finalization.
- [x] (2026-07-15) Separated `relay` and `agent` users, protected Relay state, and replaced the full host `.codex` mount with a read-only `auth.json` mount.
- [x] (2026-07-15) Added a restricted Codex permissions profile and fixed its filesystem override to use a valid inline TOML table.
- [x] (2026-07-15) Removed model-controlled `completed`/`blocked`, blocker arrays, limitations, commit intent, and commit messages.
- [x] (2026-07-15) Added the living-plan `[blocked]` convention and made plans with unchecked or blocked items remain active.
- [x] (2026-07-15) Moved commit-message derivation to the runner using the active plan heading and a fixed fallback.
- [x] (2026-07-15) Removed request IDs and workflow metadata from the Codex prompt.
- [x] (2026-07-15) Reduced `AGENTS.md` to four durable engineering rules.
- [x] (2026-07-15) Removed dead archive wiring and the legacy `.agent-relay` workflow/ignore/finalizer path.
- [x] (2026-07-15) Removed the entire model-generated result artifact. Relay now derives completion from process exit; the active plan owns progress, blockers, and validation evidence.
- [x] (2026-07-15) Updated focused unit and integration tests for process-derived completion, living blockers, Git-derived commits, and the minimized context boundary.
- [x] (2026-07-15) Updated README and the operations runbook to the result-free contract.
- [ ] Run the current full CI and fix every failure without restoring removed model-control channels.
- [ ] Perform a fresh end-to-end audit from workflow dispatch to finalization, independent of the existing findings list.
- [ ] Repeat the audit until one complete pass finds no conflict, duplicate instruction, alternate instruction channel, runner-owned responsibility, unnecessary exposure, or model-controlled outcome.
- [ ] Record exact validation evidence and move this plan to `docs/exec-plans/completed/` only when every item is checked and no `[blocked]` entry remains.

## Surprises & Discoveries

- Observation: a prompt warning did not create a credential boundary.
  Evidence: checkout persisted an authorization header in local Git configuration until `persist-credentials: false` and an explicit verification step were added.

- Observation: the entire host `.codex` directory was exposed.
  Evidence: the original Compose mount included host configuration, history, sessions, logs, and rules; Codex needs only authentication.

- Observation: Relay and Codex originally shared one Unix identity.
  Evidence: same-UID execution made Relay state and process information reachable regardless of environment filtering.

- Observation: the child environment was a one-variable denylist.
  Evidence: all future workflow, service, and operator variables would have been inherited automatically.

- Observation: alternate task fields duplicated the active plan.
  Evidence: `reviewFindings` and execution `mode` created instruction channels with no independent semantics.

- Observation: model-selected `blocked` could invalidate useful work after the entire token budget had been spent.
  Evidence: the prompt requested a status, validators accepted `blocked`, the job copied it, and the runner threw only after execution.

- Observation: even a minimized model result remained an unnecessary post-execution failure point.
  Evidence: malformed JSON, a missing file, an echoed request ID, or sensitive text could reject otherwise valid repository changes after Codex finished. Process exit, Git state, and the living plan already provide the required facts.

- Observation: `.agent-relay` became pure legacy once the result file was removed.
  Evidence: workflow exclusion, ignore entries, finalizer guard, and tests had no remaining producer to protect against.

- Observation: the first filesystem permission override was syntactically invalid for Codex 0.144.3.
  Evidence: the dotted key split `/home/agent/.codex` at the dot. Passing `permissions.relay.filesystem={"/home/agent/.codex"="deny"}` preserves the absolute path as a table key.

- Observation: `AGENTS.md` repeated plan process, validation, Git, credential, and infrastructure rules.
  Evidence: those details were already enforced by `.agent/PLANS.md`, the prompt, workflow, users, mounts, and CI.

## Decision Log

- Decision: the active ExecPlan is the only task instruction source.
  Rationale: removing mode and review overlays prevents contradictory task definitions.
  Date/Author: 2026-07-15 / repository audit.

- Decision: blockers and validation evidence live in the active ExecPlan.
  Rationale: the living plan is restartable, reviewable, and already part of the changed worktree. A blocker prevents plan completion but does not convert a successful process into technical failure.
  Date/Author: 2026-07-15 / repository audit.

- Decision: Codex produces no control or result artifact.
  Rationale: every former result field duplicated a deterministic owner: Relay owns process state, the plan owns work status and evidence, and Git/runner own commit behavior.
  Date/Author: 2026-07-15 / repository audit.

- Decision: Git status and the plan heading drive finalization.
  Rationale: actual worktree state is authoritative and the plan title provides a deterministic commit message.
  Date/Author: 2026-07-15 / repository audit.

- Decision: credentials and host context are excluded structurally rather than by model instruction.
  Rationale: checkout credentials are removed, push credentials exist only during finalization, Relay and Codex use separate users, Relay state is private, the child environment is allowlisted, and only read-only `auth.json` is mounted.
  Date/Author: 2026-07-15 / repository audit.

## Outcomes & Retrospective

The branch now applies the context boundary in code and packaging rather than asking Codex to understand or certify it. The runtime prompt contains only the active-plan execution contract. Task blockers remain visible in the living plan without wasting completed work. Relay has only technical statuses, and the runner uses Git and the plan heading for finalization.

This plan remains active until current CI passes and a fresh audit finds no additional issue.

## Context and Orientation

Relevant boundaries:

- durable instructions: `AGENTS.md`, `.agent/PLANS.md`;
- task instruction: `docs/exec-plans/active/2026-07-15-audit-codex-context.md`;
- workflow dispatch: `.github/workflows/agent-relay.yml`, `examples/github-actions/agent-relay.yml`;
- runner request/finalization: `runner/client.mjs`, `runner/finalize.sh`;
- request and job contracts: `src/contracts/job.ts`, `src/contracts/validators.ts`;
- prompt and process: `src/execution/prompt.ts`, `src/execution/codex-executor.ts`, `scripts/codex-run`;
- packaging: `Dockerfile`, `compose.yml`;
- operations: `README.md`, `docs/operations/README.md`.

Codex needs the repository, active plan, validation tools, network access required by its execution, and its authentication file. It does not need GitHub or Relay tokens, runner registration, Relay state/logs, host Codex history/sessions, workflow-run metadata, execution modes, request IDs, commit decisions, commit messages, publication mechanics, or a terminal outcome choice.

## Plan of Work

After every implementation pass, trace all information that can enter Codex through argv, prompt, environment, current directory, readable files, mounted volumes, network peers, repository instructions, and process output. Remove anything not required to implement the active plan. Keep control-plane decisions in deterministic components.

Do not add instructions telling task-executing Codex to inspect or certify its own permissions, credentials, Git ownership model, context boundary, or outcome semantics. Those are repository and CI responsibilities.

## Validation and Acceptance

Run from the repository root:

    npm ci
    npm run check
    docker compose config
    docker build --tag agent-relay:local .
    docker build --file Dockerfile.runner --tag agent-relay-runner:local .
    docker run --rm --entrypoint /bin/bash agent-relay:local /app/scripts/toolchain-smoke.sh

Acceptance requires:

- prompt content equals the minimal four-line active-plan contract;
- create-job request contains only opaque request ID, workspace, and plan path;
- no model-generated result file or result contract exists;
- Relay has no task-level `blocked` status;
- a `[blocked]` plan item preserves work and keeps the plan active;
- Git and the plan heading control finalization;
- Codex receives no GitHub, runner, or Relay token and cannot read Relay state or Codex home;
- only read-only host `auth.json` is mounted;
- all tests, Compose validation, image builds, isolation checks, and runner checks pass;
- a complete fresh audit produces no new finding;
- no unchecked or `[blocked]` item remains before this plan moves to `completed/`.
