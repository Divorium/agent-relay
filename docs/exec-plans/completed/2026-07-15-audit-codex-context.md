# Audit and minimize agent control context

This ExecPlan follows `.agent/PLANS.md`. It is a completed historical record and is not a current task instruction.

## Purpose / Big Picture

The execution process must receive one task definition: the active ExecPlan, interpreted using the repository plan rules. Process state, publication, credentials, request correlation, deployment validation, and sandbox enforcement belong to deterministic components and must not become model instructions or model-generated outputs.

## Progress

- [x] (2026-07-15) Created this plan before implementation and opened draft PR #9 from `main`.
- [x] (2026-07-15) Traced the complete control path from workflow dispatch through runner resolution, Relay request validation, job lifecycle, process launch, sandboxing, logging, and finalization.
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
- [x] (2026-07-15) Removed Docker daemon, image-build, Compose, privileged-container, and nested-container validation from CI and from the task-agent validation contract.
- [x] (2026-07-15) Replaced removed container validation with repository-local type, unit, integration, shell-syntax, workflow-contract, packaging-contract, and security-boundary tests.
- [x] (2026-07-15) Full repository-local CI passed in workflow run 29383397751 for head `df4181f6f095b94aa3c9019c3bc03603494d13cf`.
- [x] (2026-07-15) Repeated the control-path audit from workflow, process, filesystem, instruction hierarchy, historical-plan, credential, temporary-storage, runner, and validation boundaries; no additional task channel or Docker-dependent validation remained.
- [x] (2026-07-15) Recorded final validation evidence and moved this plan to `docs/exec-plans/completed/`.

## Surprises & Discoveries

- Observation: workflow validation did not protect the Relay API itself.
  Evidence: the API accepted any relative Markdown path, allowing a caller to substitute another repository document as the task source.

- Observation: the packaged security boundary could be bypassed by environment configuration.
  Evidence: the service accepted both an alternate executable and an alternate local user even though the image defines one root-owned launcher and one isolated account.

- Observation: the Relay credential lived in the self-hosted runner process environment.
  Evidence: every workflow step inherited a credential needed only by the client invocation.

- Observation: the isolated home was not isolated between runs.
  Evidence: generated configuration, sessions, logs, or arbitrary home files could remain in the long-lived container and become input to a later execution.

- Observation: the repository still contained legacy for an artifact with no producer.
  Evidence: finalization and both ignore files still treated `.agent-relay` as special after the result artifact was removed.

- Observation: selecting one working directory did not isolate other repositories on the shared volume.
  Evidence: the previous profile protected agent home and Git metadata but did not deny sibling checkout paths or Relay implementation files.

- Observation: the executor and launcher both defined tool environment variables.
  Evidence: duplicated allowlists created two policy owners and allowed future drift between the process spawned by Relay and the final clean environment.

- Observation: completed plans remained readable and contained obsolete imperative language.
  Evidence: historical plans described superseded permissions, host-home mounts, execution modes, and model-generated result artifacts as required behavior.

- Observation: shared temporary directories were an unreviewed cross-run and cross-process context source.
  Evidence: cleaning selected shared files could neither hide files owned by other users nor safely remove every stale path.

- Observation: validation assumed access to a Docker daemon and nested containers.
  Evidence: CI used image builds and privileged container execution, while the production GitHub runner and the task process already execute inside containers. The active plan also instructed the task agent to run host-only deployment commands.

## Decision Log

- Decision: the prompt names only `.agent/PLANS.md` and the active ExecPlan.
  Rationale: one file defines reusable plan semantics and one file defines the task; everything else is deterministic runtime behavior.
  Date/Author: 2026-07-15 / repository audit.

- Decision: only a regular, non-symlink file directly under `docs/exec-plans/active/` can start a job.
  Rationale: a broad Markdown path is an alternate instruction channel.
  Date/Author: 2026-07-15 / repository audit.

- Decision: completed plans are historical evidence rather than instruction sources.
  Rationale: obsolete plans must not compete with the selected active task or current architecture.
  Date/Author: 2026-07-15 / repository audit.

- Decision: the packaged launcher and isolated user are fixed in application wiring.
  Rationale: environment overrides could silently disable the boundary that packaging and CI claim to enforce.
  Date/Author: 2026-07-15 / repository audit.

- Decision: transient agent-home state is removed before every process launch.
  Rationale: authentication and packaged toolchains are required, but prior configuration, history, sessions, logs, and arbitrary files are not valid task context.
  Date/Author: 2026-07-15 / repository audit.

- Decision: shared temporary roots are denied and a private runtime directory is recreated for each run.
  Rationale: deleting selected shared files is weaker and riskier than preventing access and exposing one known-empty directory.
  Date/Author: 2026-07-15 / repository audit.

- Decision: workflow credentials exist only in the steps that consume them.
  Rationale: service-wide runner environment variables unnecessarily expand credential lifetime and visibility.
  Date/Author: 2026-07-15 / repository audit.

- Decision: only the selected repository is visible inside the shared workspace tree.
  Rationale: other pull-request checkouts and Relay source are unrelated context and can contain private or conflicting instructions.
  Date/Author: 2026-07-15 / repository audit.

- Decision: the root-owned launcher exclusively defines the final tool environment.
  Rationale: a single environment owner prevents policy drift; Relay supplies only fixed locale values required to start the launcher predictably.
  Date/Author: 2026-07-15 / repository audit.

- Decision: task validation is limited to commands available directly in the task container.
  Rationale: the task process has no Docker daemon or socket and must not create nested containers. Image construction and deployment verification belong to the host operator, not to Codex or repository CI.
  Date/Author: 2026-07-15 / repository audit.

- Decision: Relay owns technical process status, the living plan owns progress and blockers, and Git plus the runner own publication.
  Rationale: model-generated control metadata creates post-execution failure points and duplicates deterministic owners.
  Date/Author: 2026-07-15 / repository audit.

## Validation and Acceptance

Executed from the repository root inside the task container:

    npm ci
    npm run check

Workflow run 29383397751 completed successfully. The final CI contract contains no Docker, Compose, image-build, privileged-container, or nested-container invocation.

## Outcomes & Retrospective

The agent receives one task channel: `.agent/PLANS.md` plus the selected active ExecPlan. Relay owns process state, the living plan owns progress and blockers, and the runner owns Git publication.

Task validation now consists exclusively of commands executable directly inside the task container. Host image construction, Compose deployment, and runtime container verification are explicitly operator-only and cannot become Codex completion criteria.

The final repository-local test suite covers type safety, unit and integration behavior, runner scripts, shell syntax, workflow credential boundaries, packaging contracts, filesystem policy construction, prompt equality, and the absence of transient audit workflows or nested-container smoke scripts.
