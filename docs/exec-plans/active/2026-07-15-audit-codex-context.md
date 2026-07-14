# Minimize and align Codex context

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and validation evidence current while work proceeds.

When an item cannot be completed, leave it unchecked and mark it `[blocked]` in `Progress`. Record the cause, impact, evidence, and concrete unblock condition. Continue every unaffected item. A blocker is plan documentation only; it is not a Codex result status or Relay job status and must not discard completed work. A plan with an unchecked or `[blocked]` item remains active.

## Purpose / Big Picture

Codex should receive only the repository instructions and task context required to implement the active ExecPlan. It must not receive conflicting commands, duplicate governance, runner or operator procedures, GitHub workflow metadata, Relay internals, host Codex history, or result fields that ask the model to make control-plane decisions.

After this work, each source has one owner:

- `AGENTS.md` contains durable engineering constraints;
- `.agent/PLANS.md` contains reusable living-plan rules;
- the active ExecPlan is the sole task authority;
- `src/execution/prompt.ts` contains only the plan location, living-plan maintenance, validation, the prohibition against creating or publishing commits, and the exact minimal result shape;
- Relay derives technical execution state;
- Git and the runner own commit decisions and publication;
- operator-only configuration remains in the operations runbook.

The Codex result is evidence only. It contains `schemaVersion`, `summary`, and `validation`. It contains no request identifier, status, blocker list, limitations, commit intent, or commit message.

## Progress

- [x] (2026-07-15) Created this plan before implementation changes and opened draft PR #9 from current `main`.
- [x] (2026-07-15) Inventoried repository instructions, prompt construction, request/result contracts, child environment, workflow inputs, checkout/finalization credentials, Compose mounts, container users, Relay state, runner files, tests, and operations documentation.
- [x] (2026-07-15) Removed the unused `reviewFindings` instruction channel and reduced the runtime prompt.
- [x] (2026-07-15) Replaced inherited process environment with an allowlist plus a final `env -i` launcher.
- [x] (2026-07-15) Removed persisted checkout credentials and scoped the push token to finalization.
- [x] (2026-07-15) Separated `relay` and `agent` users, protected Relay state, and replaced the full host `.codex` mount with an `auth.json`-only mount.
- [x] (2026-07-15) Removed model-controlled `completed`/`blocked` outcomes, `blockers`, `limitations`, and `commitMessage` from the result contract.
- [x] (2026-07-15) Removed `blocked` from Relay job status and made successful process/result validation produce Relay-owned `completed`.
- [x] (2026-07-15) Added the living-plan `[blocked]` rule and made plans with unchecked or blocked items remain active.
- [x] (2026-07-15) Moved commit-message derivation to the runner using the active plan title with a fixed fallback.
- [x] (2026-07-15) Removed `requestId` from the Codex prompt and result; it remains opaque runner-to-Relay idempotency metadata only.
- [x] (2026-07-15) Removed the undefined `implement`/`revise`/`finalize` mode from workflow inputs, job requests, and the prompt so the active plan is the sole task instruction.
- [x] (2026-07-15) Made the required `auth.json` mount read-only.
- [x] (2026-07-15) Removed duplicated sensitive-result scanning from the runner; Relay validates the result before reporting completion.
- [x] (2026-07-15) Removed a legacy CI branch trigger and added persistent isolation diagnostics.
- [x] (2026-07-15) Updated README, operations documentation, examples, and focused tests to the minimized contract.
- [ ] Resolve the image-level Codex isolation verification failure and retain a deterministic CI test for the supported Codex CLI version.
- [ ] Run a fresh end-to-end audit from workflow dispatch to finalization without relying on the existing finding list.
- [ ] Fix every additional finding and repeat the audit until one complete pass produces no new conflict, duplicate instruction, alternate instruction channel, runner-owned responsibility, unnecessary exposure, or model-controlled outcome.
- [ ] Run full test, Compose, Relay image, isolated-boundary, toolchain, excluded-tool, runner-image, and controlled-flow validation; record exact evidence.
- [ ] Move this plan to `docs/exec-plans/completed/` only after every item is checked and no `[blocked]` entry remains.

## Surprises & Discoveries

- Observation: a warning in the prompt did not create a credential boundary.
  Evidence: checkout used `persist-credentials: true`, leaving an authorization header in local Git configuration inside the shared workspace.

- Observation: the whole host `.codex` directory was exposed.
  Evidence: Compose mounted `HOST_CODEX_DIR` at `/home/agent/.codex`, including configuration, history, sessions, logs, and rules that Codex did not need.

- Observation: Relay and Codex originally shared one Unix identity.
  Evidence: the service and child process ran as `agent`, so environment filtering could not protect Relay state or process information.

- Observation: the environment boundary was a one-variable denylist.
  Evidence: the child inherited every parent variable except `AGENT_RELAY_TOKEN`.

- Observation: the prompt repeated repository governance and runner internals.
  Evidence: it described instruction precedence, GitHub credentials, Git inspection, runner ownership, and obsolete result fields.

- Observation: `reviewFindings` and execution `mode` were alternate instruction channels with no independent contract.
  Evidence: `reviewFindings` was never supplied by the workflow, while `mode` merely added an undefined label beside the active plan.

- Observation: request correlation did not belong in model context.
  Evidence: Relay already owns the request ID, removes the stale result before execution, and reads one job-specific workspace result. Asking Codex to echo the ID added no integrity property.

- Observation: the model could spend the full token budget and then invalidate useful work by choosing `blocked`.
  Evidence: the prompt requested a status, validators accepted `blocked`, job state copied it, and the runner threw after execution.

- Observation: blocker and limitation arrays duplicated the living ExecPlan.
  Evidence: the same incomplete state could diverge between the plan and result file.

- Observation: commit-message generation was assigned to Codex even though the runner already owns all Git publication behavior.
  Evidence: the result required `commitMessage`; the runner can derive it deterministically from the plan heading.

- Observation: the initial living-plan rule accidentally allowed a blocked item to count as completion evidence.
  Evidence: `.agent/PLANS.md` listed an explicit blocker beside passing tests and reproducible commands. The corrected rule keeps the plan active while any item is unchecked or blocked.

- Observation: the minimized authentication mount was still writable.
  Evidence: Compose mounted `auth.json` without `:ro`, although the CLI only needs to read it.

- Observation: the runner repeated Relay sensitive-result validation.
  Evidence: both processes scanned the same result, creating two policy owners. Relay already validates before persisting `completed`.

- Observation: CI did not preserve output from the new isolation check.
  Evidence: the failed image job exposed only a truncated Actions log. The check now uploads `isolation.log` before failing.

## Decision Log

- Decision: the active ExecPlan is the only task instruction source.
  Rationale: removing `mode` and `reviewFindings` prevents ambiguous task overlays.
  Date/Author: 2026-07-15 / repository audit.

- Decision: blockers live only in the active ExecPlan.
  Rationale: the plan remains restartable and authoritative while Relay preserves valid partial work. A blocked item prevents plan completion but not technical run completion.
  Date/Author: 2026-07-15 / repository audit.

- Decision: Codex does not select a terminal outcome.
  Rationale: Relay can deterministically classify process exit, timeout, interruption, persistence failure, and result validity.
  Date/Author: 2026-07-15 / repository audit.

- Decision: the result contains exactly `schemaVersion`, `summary`, and `validation`.
  Rationale: correlation remains in the runner-to-Relay request; incomplete work remains in the plan; Git metadata remains in the runner.
  Date/Author: 2026-07-15 / repository audit.

- Decision: Git status and plan title drive finalization.
  Rationale: `git status --porcelain` is authoritative for changes, and the first level-one plan heading provides a deterministic commit message with a fixed fallback.
  Date/Author: 2026-07-15 / repository audit.

- Decision: enforce credential absence structurally.
  Rationale: checkout does not persist credentials, the workflow verifies local Git config, and only finalization receives the push token.
  Date/Author: 2026-07-15 / repository audit.

- Decision: run Relay and Codex as different users.
  Rationale: Relay secrets and state cannot be isolated from a same-UID child. The service runs as `relay`; a fixed launcher runs Codex as `agent`; Relay state is mode `0700`.
  Date/Author: 2026-07-15 / repository audit.

- Decision: use an environment allowlist and final `env -i` reconstruction.
  Rationale: a denylist cannot cover future service, workflow, credential, or operator variables.
  Date/Author: 2026-07-15 / repository audit.

- Decision: mount only `auth.json`, read-only.
  Rationale: Codex must authenticate but does not need host configuration, history, sessions, logs, rules, or write access to the credential.
  Date/Author: 2026-07-15 / repository audit.

- Decision: Relay is the sole sensitive-result validator.
  Rationale: the runner acts only after Relay reports a validated completed job, so duplicating the policy creates drift without strengthening the boundary.
  Date/Author: 2026-07-15 / repository audit.

## Outcomes & Retrospective

The branch now applies the intended context boundary rather than asking Codex to police it. GitHub credentials are absent while Codex runs, Relay and Codex use separate identities, Relay state is protected, host Codex data is reduced to a read-only authentication file, the child environment is rebuilt from an allowlist, and the prompt contains only the active plan workflow and exact evidence schema.

The original `blocked` result is removed. A real blocker is documented in the active plan, unaffected work continues, the result remains ordinary evidence, and Relay preserves the work as a technically completed run.

The work remains active until the image isolation test passes, a fresh audit finds no additional issue, all validation succeeds, and this plan is moved to `completed/`.

## Context and Orientation

The GitHub runner checks out a pull-request revision into a named workspace volume. Agent Relay mounts the same volume and launches Codex in that repository.

Relevant boundaries:

- workflow dispatch: `.github/workflows/agent-relay.yml` and `examples/github-actions/agent-relay.yml`;
- runner request/result handling: `runner/client.mjs`;
- finalization: `runner/finalize.sh`;
- request/result contracts: `src/contracts/job.ts`, `src/contracts/result.ts`, `src/contracts/validators.ts`;
- prompt and child process: `src/execution/prompt.ts`, `src/execution/codex-executor.ts`, `scripts/codex-run`;
- technical job state: `src/application/job-service.ts`, `src/persistence/job-store.ts`;
- packaging and identity boundary: `Dockerfile`, `compose.yml`;
- durable instructions: `AGENTS.md`, `.agent/PLANS.md`;
- operator documentation: `docs/operations/README.md`.

Codex needs the repository, active plan, validation tools, minimal evidence schema, and its authentication file. It does not need GitHub or Relay tokens, runner registration, Relay state/logs, host Codex history/sessions, workflow-run metadata, an execution mode, a request ID, commit decisions, commit messages, publication mechanics, or a terminal outcome choice.

## Plan of Work

Maintain one task channel: the active ExecPlan. Remove alternate instruction fields from the workflow, request contract, prompt, examples, tests, and documentation.

Maintain one blocker channel: unchecked `[blocked]` entries in the active plan. Keep the plan active until blockers are resolved. Do not translate blockers into technical job failure.

Maintain one technical outcome owner: Relay. A zero-exit Codex process with a valid evidence result becomes `completed`; process, timeout, interruption, persistence, and invalid-result failures remain Relay-owned.

Maintain one finalization owner: the runner. It checks Git, derives the commit message from the plan title, and receives push credentials only during finalization.

Maintain one credential boundary: credential-free checkout, finalization-only GitHub token, Relay-only bearer token, separate Unix users, Relay-only state, read-only `auth.json`, and a restricted Codex permissions profile.

After each implementation pass, restart the audit at a different entry point and trace all data that can enter the Codex process: argv, prompt, environment, current directory, readable files, mounted volumes, network peers, repository instructions, active plan, result contract, and process output. Record and repair each new finding until a full pass finds none.

## Concrete Steps

Run from the repository root:

    npm ci
    npm run check
    docker compose config
    docker build --tag agent-relay:local .
    docker build --file Dockerfile.runner --tag agent-relay-runner:local .
    docker run --rm --entrypoint /bin/bash agent-relay:local /app/scripts/toolchain-smoke.sh

Focused tests must prove:

- the result accepts only `schemaVersion`, `summary`, and `validation`;
- removed result fields and alternate request instruction fields are rejected;
- Relay owns terminal state and has no `blocked` status;
- an unchecked `[blocked]` plan item preserves work and keeps the plan active;
- Git and the plan title control finalization;
- the prompt omits request IDs, modes, runner internals, credentials, and obsolete result fields;
- the child receives only the environment allowlist;
- checkout and push credentials have non-overlapping lifetimes;
- Relay state is unreadable by the agent;
- only read-only `auth.json` is mounted from host Codex data;
- the configured Codex permissions profile can write the workspace but cannot read Codex home.

Do not add instructions telling task-executing Codex to inspect or certify its own permissions, credentials, Git ownership model, result-state ownership, or context boundary. Those are repository and CI responsibilities.

## Validation and Acceptance

- `.agent/PLANS.md` requires cause, impact, evidence, and unblock condition for `[blocked]` items and keeps such plans active.
- The workflow accepts only pull request number and active plan path.
- The create-job request contains only opaque request ID, workspace, and plan path.
- The prompt contains no mode, request ID, runner procedure, credential detail, or model-selected status.
- The result contains exactly `schemaVersion`, `summary`, and `validation`.
- Relay has no `blocked` job state and derives `completed` from successful process/result validation.
- The runner uses Git for change detection and the plan title for commit-message derivation.
- The Codex child receives no GitHub, runner, or Relay token and cannot read Relay state.
- Only read-only host `auth.json` is mounted under Codex home.
- All tests, Compose validation, image builds, isolation checks, and runner checks pass.
- A final audit produces no new finding.
- The plan contains no unchecked or `[blocked]` item before it is moved to `completed/`.

## Idempotence and Recovery

The audit is repeatable and read-only. Reapplying declarative configuration produces the same boundary. Failed technical runs leave the active plan and worktree available for diagnosis. A task blocker updates only the plan and does not create a Relay failure.

The temporary Git askpass helper is deleted on exit. Checkout credentials are not persisted. Rebuilding the containers recreates the user and filesystem boundary.

## Artifacts and Notes

Implementation paths include:

- `.agent/PLANS.md`
- `AGENTS.md`
- `.github/workflows/agent-relay.yml`
- `examples/github-actions/agent-relay.yml`
- `src/execution/prompt.ts`
- `src/execution/codex-executor.ts`
- `src/contracts/job.ts`
- `src/contracts/result.ts`
- `src/contracts/validators.ts`
- `src/application/job-service.ts`
- `runner/client.mjs`
- `runner/finalize.sh`
- `scripts/codex-run`
- `Dockerfile`
- `compose.yml`
- `.env.example`
- `README.md`
- `docs/operations/README.md`
- focused tests under `test/`

Validation evidence will be appended after CI completes.

## Interfaces and Dependencies

No external application dependency is added. The image uses Debian `sudo` for fixed user separation.

`CreateJobRequest` contains `requestId`, `workspace`, and `planPath`. `CodexResult` contains `schemaVersion`, `summary`, and `validation`. `JobStatus` remains a Relay-owned technical lifecycle without `blocked`.

The packaged service runs as `relay`. `CodexExecutor` invokes `/usr/local/bin/codex-run` as `agent`. The launcher rebuilds the environment with `env -i`. Compose mounts host `auth.json` read-only.
