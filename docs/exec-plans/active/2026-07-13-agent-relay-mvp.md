# Agent Relay MVP

## Purpose / Big Picture

Agent Relay will provide a small self-hosted bridge between a repository-scoped GitHub Actions runner and Codex.

ChatGPT creates and reviews a pull request containing one active implementation plan. A GitHub Actions workflow checks out that pull request branch on the self-hosted runner. The runner asks Agent Relay to run Codex in the same shared workspace. Codex edits and validates the checked-out files. After Codex finishes, the runner creates a commit and pushes it to the same pull request branch using GitHub Actions job credentials. ChatGPT then reviews the updated pull request and may repeat the workflow.

The first usable version supports one target repository per Docker Compose deployment. The Compose project contains one runner service and one Agent Relay service with Codex CLI. The system must remain a thin execution bridge rather than becoming a Git manager, GitHub client, workflow engine, or infrastructure controller.

Implementation must not begin until this revised plan is reviewed and approved.

## Progress

- [x] (2026-07-13 00:56Z) Created the initial design-only pull request with a README and active plan.
- [x] (2026-07-13 01:20Z) Replaced the earlier multi-repository and SSH-based design with a single-repository shared-workspace model.
- [x] (2026-07-13 01:20Z) Assigned checkout, commit, push, and GitHub credentials to the self-hosted runner.
- [x] (2026-07-13 01:20Z) Removed Docker socket, container log, internal application network, and service lifecycle access from the MVP.
- [x] (2026-07-13 01:20Z) Recorded direct use of the standard `~/.codex` directory and added `.env.example` with `RUNNER_TOKEN`.
- [ ] Review and approve the revised architecture, trust boundary, configuration, and MVP scope.
- [ ] Add repository instructions and the executable project foundation.
- [ ] Implement the runner and Agent Relay Docker images and their shared Compose deployment.
- [ ] Implement the authenticated relay job API and single-job lifecycle.
- [ ] Integrate `codex exec` with the shared workspace and persistent `~/.codex` mount.
- [ ] Add the target-repository GitHub Actions workflow for checkout, relay execution, commit, and push.
- [ ] Validate the complete same-branch pull request flow against one controlled repository.
- [ ] Complete operational and recovery documentation.

## Surprises & Discoveries

- The runner already receives GitHub Actions job credentials and can own checkout, commit, and push. Reimplementing Git repository preparation and SSH handling in Agent Relay would duplicate GitHub Actions capabilities and materially increase complexity.
- A shared workspace volume allows the runner to prepare the repository while Codex edits the same files from a separate service. No repository archive, copy protocol, SSH credential, or GitHub token is required inside Agent Relay.
- Codex uses the standard `~/.codex` directory. The MVP will mount the operator-provided directory directly and will not set or depend on `CODEX_HOME`.
- A container restart can preserve mounted Codex authentication and configuration, but it interrupts the active `codex exec` process. Retry is a new GitHub Actions run against the current pull request branch and active plan.
- Codex does not need Docker control for the initial objective. Publicly reachable application interfaces and repository-local validation are sufficient for the MVP. Missing private logs must be reported as unavailable rather than inferred.
- `codex exec` is sufficient for non-interactive execution. Support for complex internal agent behavior or subagents is a Codex capability and does not require Agent Relay to implement its own orchestration layer.

## Decision Log

- Decision: Keep the implementation plan and code changes in one target-repository pull request.
  Rationale: ChatGPT and Codex collaborate through the same branch, and the active plan evolves with implementation and review.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Support one target repository per Docker Compose deployment in the MVP.
  Rationale: A repository-scoped runner already defines the target. Avoiding multi-repository routing removes repository configuration, credential selection, and scheduling complexity.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Run the self-hosted runner and Agent Relay in the same Docker Compose project.
  Rationale: They need only a private service network and one shared workspace volume. Compose provides both without a separate deployment controller.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Let the runner own checkout, commit, and push.
  Rationale: GitHub Actions already supplies repository context and temporary job credentials. Agent Relay should not implement Git cloning, branch management, SSH identities, expected remote SHA management, or GitHub API access.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Codex edits the shared worktree but does not commit or push.
  Rationale: This keeps all GitHub credentials in the runner and lets Agent Relay remain independent of GitHub authentication.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Use a persistent Agent Relay service and start a fresh `codex exec` process for each job.
  Rationale: The service remains available to the runner without reusing one model conversation indefinitely or requiring the runner to create containers.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Use a small asynchronous create-and-poll HTTP API.
  Rationale: Codex work may be long-running. Job creation and status polling avoid holding one HTTP request open while keeping the protocol minimal.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Mount the operator's standard `~/.codex` directory into the Agent Relay user's `~/.codex` path.
  Rationale: This preserves the existing browser-based ChatGPT login and avoids introducing a separate `CODEX_HOME` convention that is not used by the operator.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Supply self-hosted runner registration through `RUNNER_TOKEN`.
  Rationale: The runner entrypoint needs an explicit runtime credential to register with the one configured target repository. The value belongs in the uncommitted deployment `.env`, while `.env.example` documents the variable name.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Do not expose the Docker socket, private container logs, or application lifecycle controls to Codex in the MVP.
  Rationale: The first version only requires repository work and public interface validation. Removing these privileges reduces scope and avoids coupling Agent Relay to each application's Compose topology.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Use Node.js 22 and TypeScript for Agent Relay.
  Rationale: Node supports the HTTP boundary, child-process streaming, filesystem validation, and tests without adding another runtime alongside Codex CLI.
  Date/Author: 2026-07-13 / ChatGPT

## Outcomes & Retrospective

No executable implementation exists yet. The design phase is complete only when the operator approves this simplified responsibility split, single-repository deployment model, runner-owned Git flow, Codex authentication mount, and restricted application access.

This section must be updated after each implementation milestone and at final completion.

## Context and Orientation

Agent Relay is a separate reusable repository, but the MVP deployment is scoped to one target repository. To use it with another project later, the same Compose definition can be deployed separately with different environment values. Multi-repository routing inside one running Agent Relay instance is outside the current plan.

The target repository owns its pull request, `AGENTS.md`, active implementation plan, project tests, and GitHub Actions workflow. GitHub owns the branch, commits, pull request, reviews, checks, and temporary job credentials.

The self-hosted runner checks out the actual pull request branch into its GitHub Actions workspace. That workspace is stored on a volume mounted into both the runner and Agent Relay services. The runner sends Agent Relay the workspace path and a concise execution instruction. Agent Relay validates the path and starts `codex exec` with that directory as its working directory.

Codex reads repository instructions and the active plan from the checked-out files. It edits the worktree and runs available validation. It does not receive a GitHub token or SSH key. After the relay job finishes, the runner inspects the worktree, commits the changes, and pushes to the same pull request branch.

The Agent Relay service uses the standard Codex configuration directory at the container user's `~/.codex`. The operator's existing `~/.codex` directory is mounted there. No `CODEX_HOME` environment variable is required.

The runner and Agent Relay communicate only over their private Compose network. Agent Relay does not require a host-published API port for normal operation.

## Boundaries and Non-Goals

Agent Relay owns Codex process execution, not repository or GitHub management.

The runner owns:

- registration with the configured GitHub repository;
- pull request branch checkout;
- GitHub Actions job credentials;
- worktree inspection;
- commit creation;
- push to the pull request branch;
- GitHub job status.

Agent Relay owns:

- HTTP authentication between runner and relay;
- shared-workspace path validation;
- one active Codex execution per deployment;
- starting and observing `codex exec`;
- execution output and terminal result reporting.

Codex owns:

- repository analysis;
- implementation;
- active plan updates;
- tests and checks available from its container;
- leaving a coherent worktree for the runner.

The MVP does not include:

- repository cloning, fetching, branch creation, commit creation, or push inside Agent Relay;
- SSH keys, deploy keys, personal access tokens, or GitHub API tokens inside Agent Relay;
- multi-repository routing in one deployment;
- Docker socket access;
- private application container networks unless they are deliberately exposed as public test interfaces;
- container logs or application service restart controls;
- dynamic creation of Agent Relay or Codex containers by the runner;
- a web UI, workflow engine, message broker, distributed scheduler, or automatic pull request merge.

Agent Relay must reject workspace paths outside the configured shared workspace root. The API must not accept arbitrary commands, executable paths, repository URLs, mount paths, or host paths from the caller.

Codex may make outbound requests only to interfaces reachable from its container. When application internals or logs are unavailable, it must report the validation limitation explicitly.

## Plan of Work

First, establish repository instructions and project contracts. Add `AGENTS.md`, `.agent/PLANS.md`, the TypeScript project, formatting, linting, type checking, tests, and a concise directory layout. Define the relay request, job state, result, and error contracts before implementing process execution.

Second, create the Docker packaging. The Compose project will contain the repository-scoped self-hosted runner and Agent Relay services. Both services mount the same workspace volume. Agent Relay additionally mounts the operator's standard `~/.codex` directory into the container user's `~/.codex` path. No `CODEX_HOME` variable is set.

Third, implement runner registration configuration. The deployment `.env` will contain `RUNNER_TOKEN` and the single target repository settings. `.env.example` will document required names without containing credentials. The runner container must register with the configured repository and expose labels used by the repository workflow.

Fourth, implement Agent Relay's HTTP boundary. It will provide a health endpoint, authenticated job creation, and job status retrieval. Input validation will accept only the supported operation and a workspace path beneath the configured shared root. The API will not accept Git URLs or GitHub credentials.

Fifth, implement the job lifecycle. The MVP supports one active job per deployment. It records accepted, running, completed, failed, timed-out, and interrupted states, together with concise execution output. Repeating the same request identifier must not start duplicate work.

Sixth, integrate Codex. Agent Relay starts a fresh `codex exec` process in the validated workspace. The prompt points Codex to the repository's instruction chain and active plan rather than copying the plan into the request. Output is streamed to the job record, the exit status is captured, and a configurable maximum runtime is enforced.

Seventh, add the target-repository GitHub Actions workflow and runner-side client. The workflow checks out the actual pull request branch, calls Agent Relay, waits for the terminal result, verifies that the worktree contains coherent changes, configures the commit author, commits changes, and pushes through GitHub Actions credentials. Workflow concurrency prevents two jobs for the same pull request from running at once.

Finally, validate the complete path against one controlled target repository. ChatGPT creates a plan PR, dispatches the workflow, Codex changes the checked-out worktree, the runner pushes a commit to the same branch, and ChatGPT can read and review the result. Repeat the workflow for one correction and one final-plan update.

## Milestones

### Milestone 1: Repository foundation and contracts

Create repository instructions, the TypeScript project, schemas, validation, and tests for pure contracts.

Acceptance requires build, lint, type-check, and test commands to pass. The request contract must not contain repository URLs, SSH keys, GitHub tokens, or arbitrary shell commands.

### Milestone 2: Compose deployment and persistent Codex login

Create Dockerfiles and one Compose definition containing the runner and Agent Relay. Add the private network, shared workspace volume, and direct mount of the operator's `~/.codex` directory. Add `.env.example` with `RUNNER_TOKEN` and the non-secret deployment inputs.

Acceptance requires both services to start, the runner to reach Agent Relay by service name, and Codex authentication to remain available after recreating the Agent Relay container with the same mounted `~/.codex` directory.

### Milestone 3: Relay API and job lifecycle

Implement health, authenticated job submission, status polling, single-job exclusion, idempotent request identifiers, timeout handling, and interrupted-job reporting.

Acceptance requires deterministic API tests for authorization, valid submission, invalid paths, path traversal, duplicate requests, active-job rejection, terminal results, timeout, and service interruption.

### Milestone 4: Codex execution in the shared workspace

Run `codex exec` in the runner-prepared workspace, stream output, capture exit status, and preserve the checked-out worktree.

Acceptance requires a controlled authenticated execution that reads repository instructions and an active plan, performs a harmless file change, and leaves that change visible to the runner service.

### Milestone 5: GitHub Actions checkout, commit, and push

Add the repository workflow and runner-side client. The workflow must checkout the actual pull request branch, dispatch the relay job, wait for completion, commit resulting changes, and push to that branch with the job credentials.

Acceptance requires a complete pull request run where Codex changes the shared worktree and a runner-created commit appears on the same pull request branch. Agent Relay must have no SSH key or GitHub token.

### Milestone 6: Public-interface validation and review loop

Allow the Codex execution environment to reach only explicitly configured public test interfaces. Demonstrate implementation, ChatGPT review, a correction run, final plan completion, and another runner-created commit.

Acceptance requires clear reporting when an endpoint fails but private logs are unavailable. No Docker socket, private container log mount, or container lifecycle permission may be present.

### Milestone 7: Operations and recovery

Document runner registration, `RUNNER_TOKEN` rotation, browser-login refresh, Compose deployment, workspace cleanup, interrupted jobs, retries, upgrades, and failure diagnosis.

Acceptance requires a documented restart exercise showing that mounted `~/.codex` authentication persists while an in-flight job is reported as interrupted and retried through a new workflow run.

## Concrete Steps

The intended repository structure after approval is:

    AGENTS.md
    .agent/PLANS.md
    .env.example
    package.json
    tsconfig.json
    src/api/
    src/application/
    src/config/
    src/execution/
    src/persistence/
    src/security/
    src/server.ts
    test/
    scripts/
    runner/
    examples/github-actions/
    Dockerfile
    Dockerfile.runner
    compose.yml
    docs/operations/

The initial Agent Relay API will expose:

    GET /health
    POST /v1/jobs
    GET /v1/jobs/{jobId}

A create-job request will contain a caller-generated request identifier, a validated workspace path relative to the shared root, the active plan path, and an execution mode such as implement, revise, or finalize. It may contain concise review findings for revision work. It will not contain a repository URL, branch credential, GitHub token, SSH key, or copied repository contents.

The runner workflow will provide the current pull request branch through checkout rather than asking Agent Relay to locate it. The runner will perform Git commit and push only after Agent Relay reaches a successful terminal state and the worktree contains changes.

## Validation and Acceptance

The implementation is accepted only when all of the following are demonstrated:

1. One Compose deployment starts exactly one repository-scoped runner and one Agent Relay service.
2. `.env.example` contains `RUNNER_TOKEN` and no real credentials.
3. The runner registers with the configured target repository.
4. The runner and Agent Relay communicate over a private Compose network.
5. The runner and Agent Relay see the same checked-out workspace through a shared volume.
6. The operator's standard `~/.codex` directory is mounted into the Agent Relay user's `~/.codex` path without setting `CODEX_HOME`.
7. Recreating Agent Relay with the same mount preserves the existing Codex login.
8. Requests without the correct relay token are rejected.
9. Workspace paths outside the configured shared root are rejected.
10. Only one Codex job runs at a time in the deployment.
11. `codex exec` reads the active plan and repository instructions from the workspace.
12. Codex changes and validation results remain visible to the runner after execution.
13. Codex receives no GitHub token or SSH key.
14. Agent Relay performs no clone, fetch, checkout, commit, push, or GitHub API operation.
15. The runner checks out the actual pull request branch.
16. The runner commits and pushes Codex's changes with GitHub Actions job credentials.
17. A pushed commit appears on the same pull request branch that ChatGPT reviews.
18. Workflow concurrency prevents overlapping executions for the same pull request.
19. Restarting Agent Relay interrupts the active process but preserves mounted Codex authentication.
20. A new workflow run can continue from the current branch and active plan.
21. Codex has no Docker socket, private application logs, or service lifecycle control.
22. Codex can reach a configured public test interface when required.
23. Failures that require unavailable private logs are reported as limitations, not fabricated diagnoses.
24. Logs and API responses do not expose runner registration credentials, relay tokens, GitHub job credentials, or Codex authentication files.
25. The complete implementation, correction, and finalization loop is demonstrated on one controlled repository.

Unit and integration tests must cover API validation, workspace containment, authentication, job state transitions, idempotency, single-job exclusion, process execution, timeout, interruption, output redaction, and runner client behavior. Live Codex and GitHub checks remain explicit smoke or end-to-end validation because they require operator credentials and external services.

## Idempotence and Recovery

Every submitted relay request has a caller-generated request identifier. Repeating the same identifier with identical immutable fields returns the existing job. Reusing the identifier with different fields is rejected.

The MVP allows one active Codex process per deployment. A second request while a job is active is rejected with a deterministic status. GitHub Actions workflow concurrency is the primary protection against duplicate runs for the same pull request.

Agent Relay validates the requested workspace after resolving symbolic links and normalized paths. The resolved path must remain below the configured shared workspace root.

A service restart cannot preserve the operating-system process. Any previously running job is marked interrupted. Recovery is a new GitHub Actions run against the current pull request branch. The active plan and Git history provide durable progress.

Agent Relay never attempts Git recovery. Checkout and push failures belong to the runner workflow and are reported by GitHub Actions.

The mounted `~/.codex` directory and shared runner workspace remain separate resources so authentication persistence and workspace cleanup can be managed independently.

## Artifacts and Notes

The design is documented in `README.md`, `.env.example`, and this active plan.

The revised design intentionally removes the following earlier concepts:

- repository allowlists and multi-repository routing inside Agent Relay;
- repository mirrors and Git worktrees managed by Agent Relay;
- expected remote SHA verification inside Agent Relay;
- repository-specific SSH identities;
- Codex-created commits and pushes;
- Docker socket and private application log access.

Implementation evidence must be added here as concise test summaries, container checks, relay job results, and end-to-end observations.

## Interfaces and Dependencies

The initial service runtime will use Node.js 22, TypeScript, and Codex CLI. Specific HTTP, schema-validation, logging, and test dependencies must remain minimal and will be selected during the foundation milestone.

Agent Relay depends operationally on:

- the self-hosted runner service in the same Compose project;
- a shared workspace volume;
- a private Compose network;
- the operator's mounted `~/.codex` directory with valid browser-login credentials;
- a relay authentication token;
- outbound access required by Codex;
- any explicitly configured public test interfaces.

The runner depends operationally on:

- `RUNNER_TOKEN` for repository-scoped registration;
- the configured repository URL, runner name, and labels;
- GitHub Actions job credentials supplied when a workflow runs;
- the shared workspace volume;
- network access to the Agent Relay service.

No GitHub credential is an Agent Relay dependency.

## Plan Revision Notes

- 2026-07-13: Created the initial design for a reusable Agent Relay service.
- 2026-07-13: Reworked the plan around one repository per Compose deployment. GitHub Actions now owns checkout, commit, and push; Agent Relay only runs Codex in the runner's shared workspace. Removed SSH, repository management, multi-repository routing, Docker control, and private log access from the MVP. Replaced `CODEX_HOME` with a direct mount of the operator's standard `~/.codex` directory and added `RUNNER_TOKEN` to the documented deployment configuration.
