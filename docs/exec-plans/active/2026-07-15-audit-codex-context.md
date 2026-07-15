# Audit and minimize agent control context

This ExecPlan follows `.agent/PLANS.md` and remains active until validation and a clean audit pass are complete.

## Purpose / Big Picture

The execution process must receive one task definition: the active ExecPlan, interpreted using the repository plan rules. Process state, publication, credentials, request correlation, and sandbox enforcement belong to deterministic components and must not become model instructions or model-generated outputs.

## Progress

- [x] (2026-07-15) Created this plan before implementation and opened draft PR #9 from `main`.
- [x] (2026-07-15) Traced the complete control path from workflow dispatch through runner resolution, Relay request validation, job lifecycle, process launch, sandboxing, logging, and finalization.
- [x] (2026-07-15) Removed secondary task fields, execution modes, model-selected outcomes, commit intent, commit messages, and the model-generated result artifact.
- [x] (2026-07-15) Reduced repository instructions to durable code rules and reduced the runtime prompt to `.agent/PLANS.md` plus the active plan path.
- [x] (2026-07-15) Restricted the request contract to a direct Markdown file under `docs/exec-plans/active/` and reject missing files, directories, symlinks, and symlink traversal before execution.
- [x] (2026-07-15) Replaced inherited process context with a minimal environment and fixed sandbox rules for the workspace, agent home, and repository metadata.
- [x] (2026-07-15) Removed runtime configuration that could replace the packaged launcher or isolated user.
- [x] (2026-07-15) Scoped the Relay credential to the workflow client step instead of the complete self-hosted runner process.
- [x] (2026-07-15) Made the launcher clear generated agent-home state before every run while preserving only the mounted authentication file.
- [x] (2026-07-15) Removed the remaining `.agent-relay` finalizer, ignore-file, launcher, workflow, and test legacy.
- [x] (2026-07-15) Moved commit-message derivation and output-file preflight before agent execution and derived stable request correlation from workflow-run metadata when available.
- [x] (2026-07-15) Denied sibling checkout trees, Relay application files, and the Relay home while allowing writes only in the selected repository and reads only from its Git metadata.
- [x] (2026-07-15) Made the launcher the sole owner of the final tool environment; the executor now passes only locale values.
- [ ] Run the complete CI suite on the latest head and repair every failure without restoring removed channels.
- [ ] Repeat the control-path audit from a different entry point and record a clean pass with no new conflict, duplicate instruction, alternate task channel, unnecessary exposure, or model-controlled decision.
- [ ] Record final validation evidence and move this plan to `docs/exec-plans/completed/`.

## Surprises & Discoveries

- Observation: workflow validation did not protect the Relay API itself.
  Evidence: the API accepted any relative Markdown path, allowing a caller to substitute another repository document as the task source.

- Observation: the packaged security boundary could be bypassed by environment configuration.
  Evidence: the service accepted both an alternate executable and an alternate local user even though the image defines one root-owned launcher and one isolated account.

- Observation: the Relay credential lived in the self-hosted runner process environment.
  Evidence: every workflow step inherited a credential needed only by the client invocation.

- Observation: the isolated home was not isolated between runs.
  Evidence: generated configuration, sessions, or logs could remain in the long-lived container and become input to a later execution.

- Observation: the repository still contained legacy for an artifact with no producer.
  Evidence: finalization and both ignore files still treated `.agent-relay` as special after the result artifact was removed.

- Observation: the active plan described a prompt contract that no longer existed.
  Evidence: the plan required four prompt instructions while the implementation had already reduced the prompt to one pointer.

- Observation: selecting one working directory did not isolate other repositories on the shared volume.
  Evidence: the previous profile protected agent home and `.git` but did not deny sibling checkout paths or Relay implementation files.

- Observation: the executor and launcher both defined tool environment variables.
  Evidence: duplicated allowlists created two policy owners and allowed future drift between the process spawned by Relay and the final `env -i` process.

## Decision Log

- Decision: the prompt names only `.agent/PLANS.md` and the active ExecPlan.
  Rationale: one file defines reusable plan semantics and one file defines the task; everything else is deterministic runtime behavior.
  Date/Author: 2026-07-15 / repository audit.

- Decision: only a regular, non-symlink file directly under `docs/exec-plans/active/` can start a job.
  Rationale: a broad Markdown path is an alternate instruction channel.
  Date/Author: 2026-07-15 / repository audit.

- Decision: the packaged launcher and isolated user are fixed in application wiring.
  Rationale: environment overrides could silently disable the boundary that packaging and CI claim to enforce.
  Date/Author: 2026-07-15 / repository audit.

- Decision: transient agent-home state is removed before every process launch.
  Rationale: authentication is required, but prior configuration, history, sessions, and logs are not valid task context.
  Date/Author: 2026-07-15 / repository audit.

- Decision: workflow credentials exist only in the steps that consume them.
  Rationale: service-wide runner environment variables unnecessarily expand credential lifetime and visibility.
  Date/Author: 2026-07-15 / repository audit.

- Decision: only the selected repository is visible inside the shared workspace tree.
  Rationale: other pull-request checkouts and Relay source are unrelated context and can contain private or conflicting instructions.
  Date/Author: 2026-07-15 / repository audit.

- Decision: the root-owned launcher exclusively defines the final tool environment.
  Rationale: a single environment owner prevents policy drift; Relay passes only locale values required to start the launcher predictably.
  Date/Author: 2026-07-15 / repository audit.

- Decision: Relay owns technical process status, the living plan owns progress and blockers, and Git plus the runner own publication.
  Rationale: model-generated control metadata creates post-execution failure points and duplicates deterministic owners.
  Date/Author: 2026-07-15 / repository audit.

## Context and Orientation

Control files reviewed as one execution graph:

- `.github/workflows/agent-relay.yml` and `examples/github-actions/agent-relay.yml`;
- `Dockerfile.runner`, `runner/entrypoint.sh`, `runner/resolve-pr.mjs`, `runner/client.mjs`, and `runner/finalize.sh`;
- `compose.yml`, `Dockerfile`, and `scripts/codex-run`;
- `src/server.ts`, `src/config/config.ts`, `src/api/server.ts`, and `src/api/http.ts`;
- `src/contracts/job.ts`, `src/contracts/validators.ts`, and `src/contracts/errors.ts`;
- `src/application/job-service.ts`, `src/persistence/job-store.ts`, `src/security/*`, `src/execution/prompt.ts`, and `src/execution/codex-executor.ts`;
- `AGENTS.md`, `.agent/PLANS.md`, this active plan, and the tests that enforce these boundaries.

## Validation and Acceptance

Run from the repository root:

    npm ci
    npm run check
    docker compose config
    docker build --tag agent-relay:local .
    docker build --file Dockerfile.runner --tag agent-relay-runner:local .

Acceptance requires:

- the runtime prompt references only the repository plan rules and selected active plan;
- the request, runner, and filesystem checks reject every other task path before process start;
- no model-generated status, result, blocker list, commit intent, or publication instruction exists;
- the packaged process always uses the fixed launcher, isolated account, launcher-owned environment, read-only repository metadata, and clean per-run home;
- sibling workspaces, Relay source, Relay home, Relay state, and agent home are not readable from the task process;
- the Relay credential is absent from the runner service environment and present only in the client step;
- no `.agent-relay` or result-artifact legacy remains;
- unit, integration, workflow, Compose, image, sandbox, toolchain, and runner-image checks pass;
- a final independent audit finds no additional control-context issue;
- all Progress items are checked before this file moves to `completed/`.

## Outcomes & Retrospective

Pending final CI and the clean audit pass.
