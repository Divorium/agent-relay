# Audit and minimize agent control context

This ExecPlan follows `.agent/PLANS.md`. It is a completed historical record and is not a current task instruction.

## Purpose / Big Picture

The execution process must receive one task definition: the active ExecPlan, interpreted using the repository plan rules. Process state, publication, credentials, request correlation, environment routing, and sandbox enforcement belong to deterministic components and must not become model instructions or model-generated outputs.

## Progress

- [x] (2026-07-15) Created this plan before implementation and opened draft PR #9 from `main`.
- [x] (2026-07-15) Traced the complete control path from workflow dispatch through runner resolution, Relay request validation, job lifecycle, process launch, logging, and finalization.
- [x] (2026-07-15) Removed secondary task fields, execution modes, model-selected outcomes, commit intent, commit messages, and the model-generated result artifact.
- [x] (2026-07-15) Reduced repository instructions to durable code rules and reduced the runtime prompt to `.agent/PLANS.md` plus the active plan path.
- [x] (2026-07-15) Restricted the request contract to a direct Markdown file under `docs/exec-plans/active/` and reject missing files, directories, symlinks, and symlink traversal before execution.
- [x] (2026-07-15) Replaced inherited process context with a fixed minimal environment and fixed permissions for the selected workspace, agent home, repository metadata, and temporary storage.
- [x] (2026-07-15) Removed runtime configuration that could replace the packaged launcher or isolated user.
- [x] (2026-07-15) Scoped the Relay credential to the workflow client step instead of the complete self-hosted runner process.
- [x] (2026-07-15) Made the launcher clear generated agent-home state before every run while preserving only the packaged toolchains and mounted authentication file.
- [x] (2026-07-15) Removed the remaining `.agent-relay` finalizer, ignore-file, launcher, workflow, and test legacy.
- [x] (2026-07-15) Moved commit-message derivation and output-file preflight before agent execution and derived stable request correlation from workflow-run metadata when available.
- [x] (2026-07-15) Denied sibling checkout trees, Relay application files, and the Relay home while allowing writes only in the selected repository and reads only from its Git metadata.
- [x] (2026-07-15) Made the root-owned launcher the sole owner of the final tool environment; the executor passes only a fixed locale.
- [x] (2026-07-15) Denied shared temporary roots, created a cleaned mode-0700 private runtime directory, and exposed it as the only temporary directory.
- [x] (2026-07-15) Marked completed ExecPlans as historical records and removed active-sounding superseded contracts from them.
- [x] (2026-07-15) Kept mandatory pull-request CI daemon-independent while restoring static packaging and workflow contract tests to `npm run check`.
- [x] (2026-07-15) Added a separate native-host validation workflow and reusable script for real Compose, image-build, image-smoke, and runner-image tests.
- [x] (2026-07-15) Removed the Docker prohibition from `.agent/PLANS.md`; validation capabilities are now selected by workflow routing rather than global model instructions.
- [x] (2026-07-15) Recorded the distinction between the container execution profile and a trusted native host profile.

## Surprises & Discoveries

- Observation: workflow validation did not protect the Relay API itself.
  Evidence: the API accepted any relative Markdown path, allowing a caller to substitute another repository document as the task source.

- Observation: the packaged security boundary could be bypassed by environment configuration.
  Evidence: the service accepted both an alternate executable and an alternate local user even though the image defines one root-owned launcher and one isolated account.

- Observation: the Relay credential lived in the self-hosted runner process environment.
  Evidence: every workflow step inherited a credential needed only by the client invocation.

- Observation: the isolated home was not isolated between runs.
  Evidence: generated configuration, sessions, logs, or arbitrary home files could remain in the long-lived container and become input to a later execution.

- Observation: completed plans remained readable and contained obsolete imperative language.
  Evidence: historical plans described superseded permissions, host-home mounts, execution modes, and model-generated result artifacts as required behavior.

- Observation: removing every Docker test was an overcorrection.
  Evidence: the failing check came from attempting a privileged nested sandbox, not from the value of Compose, image-build, toolchain, or runner-image validation.

- Observation: a global rule forbidding Docker in ExecPlans conflated two valid execution environments.
  Evidence: the container profile has no Docker socket, while a separately trusted native host profile may need Docker and Compose to complete its plan.

## Decision Log

- Decision: the prompt names only `.agent/PLANS.md` and the active ExecPlan.
  Rationale: one file defines reusable plan semantics and one file defines the task; everything else is deterministic runtime behavior.

- Decision: only a regular, non-symlink file directly under `docs/exec-plans/active/` can start a job.
  Rationale: a broad Markdown path is an alternate instruction channel.

- Decision: completed plans are historical evidence rather than instruction sources.
  Rationale: obsolete plans must not compete with the selected active task or current architecture.

- Decision: workflow routing selects the execution environment; `.agent/PLANS.md` remains environment-neutral.
  Rationale: container and native-host agents have different legitimate capabilities, and a global prohibition would be false for one of them.

- Decision: mandatory PR CI runs without a Docker daemon, but real image validation remains implemented in a manually dispatched native-host workflow.
  Rationale: static and behavioral repository tests must always run, while Docker integration requires an explicitly provisioned host runner.

- Decision: no Docker socket is mounted into the container profile.
  Rationale: Docker socket access is effectively host-level control and belongs only to the trusted host execution profile.

- Decision: Relay owns technical process status, the living plan owns progress and blockers, and Git plus the runner own publication.
  Rationale: model-generated control metadata creates post-execution failure points and duplicates deterministic owners.

## Validation and Acceptance

Mandatory pull-request validation:

    npm ci
    npm run check

Native-host validation:

    ./scripts/host-validation.sh

The host script performs Compose validation, builds both images, verifies the packaged toolchain and filesystem invariants, checks excluded tools, and verifies runner entrypoints without privileged nested containers.

## Outcomes & Retrospective

The agent receives one task channel: `.agent/PLANS.md` plus the selected active ExecPlan. Relay owns process state, the living plan owns progress and blockers, and the runner owns Git publication.

The repository now has two explicit validation surfaces: daemon-independent mandatory CI and real Docker validation on a separately trusted native host runner. The distinction is encoded in workflow routing and operations documentation, not as an instruction that every agent must interpret.