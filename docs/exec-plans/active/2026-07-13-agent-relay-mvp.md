# Agent Relay MVP

## Purpose / Big Picture

Agent Relay is a small self-hosted bridge between a repository-scoped GitHub Actions runner and Codex.

ChatGPT creates and reviews a pull request containing one active implementation plan. A GitHub Actions workflow checks out the pull request branch on the self-hosted runner. The runner asks Agent Relay to run Codex in the same shared workspace. Codex edits and validates the checked-out files, updates the active plan, and writes a structured result file for the runner. The runner validates the result file and actual worktree, creates a commit using the proposed commit message, and pushes it to the same pull request branch with GitHub Actions job credentials.

The first usable version supports one target repository per Docker Compose deployment. The Compose project contains one runner service and one Agent Relay service with Codex CLI. The system remains a thin execution bridge rather than becoming a Git manager, GitHub client, workflow engine, or infrastructure controller.

Implementation must not begin until this plan is reviewed and approved.

## Progress

- [x] (2026-07-13 00:56Z) Created the initial design-only pull request with README and an active plan.
- [x] (2026-07-13 01:20Z) Replaced the earlier multi-repository and SSH-based design with a single-repository shared-workspace model.
- [x] (2026-07-13 01:20Z) Assigned checkout, commit, push, and GitHub credentials to the self-hosted runner.
- [x] (2026-07-13 01:20Z) Removed Docker socket, private container logs, internal application network, and service lifecycle access from the MVP.
- [x] (2026-07-13 01:20Z) Recorded direct use of the standard `~/.codex` directory and added `.env.example` with `RUNNER_TOKEN`.
- [x] (2026-07-13 01:35Z) Added a versioned Codex result-file contract with commit message, summary, validation, blockers, and limitations.
- [x] (2026-07-13 01:50Z) Defined the mandatory general-purpose Codex development toolchain and explicitly excluded OpenSSH and .NET.
- [ ] Review and approve the architecture, result contract, toolchain, trust boundary, configuration, and MVP scope.
- [ ] Add repository instructions and the executable project foundation.
- [ ] Implement runner and Agent Relay Docker images and their shared Compose deployment.
- [ ] Implement the authenticated relay job API and single-job lifecycle.
- [ ] Integrate `codex exec`, shared workspace, persistent `~/.codex`, and result-file generation.
- [ ] Add the target-repository GitHub Actions workflow for checkout, relay execution, result validation, commit, and push.
- [ ] Validate the complete same-branch pull-request flow against one controlled repository.
- [ ] Complete operational and recovery documentation.

## Surprises & Discoveries

- The runner already receives GitHub Actions job credentials and can own checkout, commit, and push. Implementing repository preparation and SSH handling in Agent Relay would duplicate GitHub Actions capabilities.
- A shared workspace volume lets the runner prepare the repository while Codex edits the same files from another service. Agent Relay needs no repository archive, copy protocol, SSH credential, or GitHub token.
- Codex uses the standard `~/.codex` directory. The MVP mounts the operator-provided directory directly and does not set `CODEX_HOME`.
- Container recreation can preserve mounted Codex authentication and configuration, but it interrupts the active `codex exec` process. Recovery is a new workflow run against the current branch and active plan.
- Codex does not need Docker control for the initial objective. Publicly reachable interfaces and repository-local validation are sufficient for the MVP.
- `codex exec` is sufficient for non-interactive execution. Complex internal agent behavior and subagents remain Codex capabilities, not Agent Relay orchestration responsibilities.
- The runner needs structured completion metadata without parsing free-form model output. A versioned JSON result file provides that contract while the runner independently verifies the worktree.
- The Codex image must support common development stacks. Rebuilding the image for each repository would make the shared system impractical.

## Decision Log

- Decision: Keep the implementation plan and code changes in one target-repository pull request.
  Rationale: ChatGPT and Codex collaborate through the same branch, and the active plan evolves with implementation and review.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Support one target repository per Docker Compose deployment in the MVP.
  Rationale: A repository-scoped runner already defines the target and removes multi-repository routing complexity.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Run the self-hosted runner and Agent Relay in the same Docker Compose project.
  Rationale: They require only a private network and one shared workspace volume.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Let the runner own checkout, commit, and push.
  Rationale: GitHub Actions supplies repository context and temporary job credentials. Agent Relay must not implement Git cloning, branch management, SSH identities, remote-SHA management, or GitHub API access.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Codex edits the shared worktree but does not commit or push.
  Rationale: GitHub credentials remain only in the runner.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Require Codex to write a versioned JSON result file before finishing.
  Rationale: The runner needs a deterministic commit message and concise execution metadata without parsing prose logs. The runner still verifies the actual worktree.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Store the result at `.agent-relay/result.json` and exclude it locally through `.git/info/exclude`.
  Rationale: Codex can write inside the workspace, while the runner removes the artifact before staging so it never enters the target repository commit.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Use a persistent Agent Relay service and start a fresh `codex exec` process for every job.
  Rationale: The service remains available without reusing one model conversation indefinitely or requiring the runner to create containers.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Use a small asynchronous create-and-poll HTTP API.
  Rationale: Long-running Codex work must not depend on one open HTTP request.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Mount the operator's standard `~/.codex` directory into the Agent Relay user's `~/.codex` path.
  Rationale: This preserves the existing browser-based ChatGPT login without introducing `CODEX_HOME`.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Supply runner registration through `RUNNER_TOKEN`.
  Rationale: The runner entrypoint needs an explicit runtime credential for the configured repository. The value belongs in uncommitted `.env`; `.env.example` documents only the variable.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Do not expose Docker socket, private container logs, or application lifecycle controls to Codex in the MVP.
  Rationale: The first version needs repository work and public-interface validation only.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Use Node.js 22 and TypeScript for Agent Relay.
  Rationale: Node supports HTTP, child-process streaming, filesystem validation, and tests without another application runtime.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Ship a general-purpose development toolchain in the Agent Relay image.
  Rationale: Codex must build and validate common repositories without rebuilding the image for each project. OpenSSH is unnecessary because Agent Relay performs no SSH Git operations. .NET is unnecessary for the targeted repositories.
  Date/Author: 2026-07-13 / ChatGPT

## Outcomes & Retrospective

No executable implementation exists yet. The design phase is complete only when the operator approves the responsibility split, result-file contract, development toolchain, single-repository deployment model, authentication mount, and restricted infrastructure access.

This section must be updated after each implementation milestone and at final completion.

## Context and Orientation

Agent Relay is a separate reusable repository, but each MVP deployment is scoped to one target repository. Another project can later run a separate deployment from the same image and Compose definition.

The target repository owns its pull request, `AGENTS.md`, active implementation plan, tests, and GitHub Actions workflow. GitHub owns branches, commits, pull requests, reviews, checks, and temporary job credentials.

The runner checks out the actual pull-request branch into a workspace volume mounted into both services. It sends Agent Relay the workspace path, active plan path, execution mode, and concise review findings when applicable. Agent Relay validates the path and starts `codex exec` with that directory as the working directory.

Before execution, the runner removes stale result artifacts, prepares `.agent-relay/result.json`, and adds `.agent-relay/` to `.git/info/exclude`. Agent Relay includes the result-file contract in the Codex instruction. Codex must write the file before finishing, including when work is blocked.

After execution, the runner validates the result file, independently checks `git status` and `git diff`, removes `.agent-relay/`, and decides whether a commit is valid. It commits with the validated `commitMessage` and pushes to the same pull-request branch.

The Agent Relay service uses the standard Codex configuration directory at the container user's `~/.codex`. The operator's existing directory is mounted there. No `CODEX_HOME` environment variable is used.

The runner and Agent Relay communicate only over their private Compose network. Agent Relay requires no host-published API port.

## Boundaries and Non-Goals

The runner owns:

- registration with the configured GitHub repository;
- pull-request branch checkout;
- GitHub Actions job credentials;
- controlled result-file preparation and validation;
- worktree and diff inspection;
- commit creation;
- push to the pull-request branch;
- GitHub job status.

Agent Relay owns:

- HTTP authentication between runner and relay;
- workspace path validation;
- one active Codex execution per deployment;
- result-file path derivation and prompt contract;
- starting and observing `codex exec`;
- execution output and terminal result reporting.

Codex owns:

- repository analysis;
- implementation;
- active plan updates;
- tests and checks available from its container;
- leaving a coherent worktree;
- writing the required result file.

The MVP does not include:

- repository cloning, fetching, branch creation, commit creation, or push inside Agent Relay;
- SSH keys, deploy keys, personal access tokens, or GitHub API tokens inside Agent Relay;
- multi-repository routing in one deployment;
- Docker socket access;
- private application networks, logs, or lifecycle controls;
- dynamic creation of Agent Relay or Codex containers by the runner;
- web UI, workflow engine, message broker, distributed scheduler, or automatic merge;
- OpenSSH or .NET SDK in the Codex image;
- project-specific infrastructure such as Docker Engine, database servers, Android SDK, or CUDA.

Agent Relay rejects workspace paths outside the configured shared workspace root. The API does not accept arbitrary commands, executable paths, result paths, repository URLs, mount paths, or host paths.

Codex can make outbound requests only to interfaces reachable from its container. Unavailable application internals or logs must be reported explicitly as limitations.

## Codex Development Toolchain

The Agent Relay image is a general-purpose development environment. Codex must be able to build, test, and validate common repositories without rebuilding the image for every project.

Required language runtimes and package tools:

- Node.js 22 and npm;
- Python 3 with `pip` and `venv`;
- Java 21 JDK;
- Rust installed through `rustup`, including `rustc` and Cargo;
- Go;
- Git and Git LFS.

Required native build tools:

- GCC and G++;
- Clang;
- Make;
- CMake;
- `pkg-config`.

Required general utilities:

- Bash;
- `curl` and `wget`;
- `jq`;
- `zip`, `unzip`, `tar`, `gzip`, `xz`, and `zstd`;
- `rsync`;
- `file`;
- GNU coreutils, findutils, and diffutils;
- CA certificates.

Explicit exclusions:

- OpenSSH;
- .NET SDK;
- Docker Engine and Docker socket access;
- database servers, Android SDK, CUDA, and other project-specific infrastructure.

Specialized tooling required by a future repository must be evaluated deliberately. It must not be installed dynamically during an Agent Relay job or silently added to the shared image.

## Plan of Work

First, add repository instructions, `.agent/PLANS.md`, the TypeScript project, formatting, linting, type checking, tests, and explicit request, job, result, and error contracts.

Second, create Docker packaging. The Compose project contains the repository-scoped runner and Agent Relay services. Both mount the same workspace. Agent Relay mounts the operator's standard `~/.codex` directory and includes the complete general-purpose toolchain. It does not set `CODEX_HOME` and does not include OpenSSH or .NET.

Third, implement runner registration configuration. The deployment `.env` contains `RUNNER_TOKEN` and the target repository settings. `.env.example` documents required names without credentials.

Fourth, implement Agent Relay's HTTP boundary with health, authenticated job creation, and job status retrieval. Agent Relay derives the fixed result path; callers cannot select it.

Fifth, implement one-job lifecycle with accepted, running, completed, failed, timed-out, and interrupted states. Repeated request identifiers are idempotent.

Sixth, integrate Codex. Agent Relay starts a fresh `codex exec` in the validated workspace, points it to the repository instruction chain and active plan, and requires the result file before exit.

Seventh, add the target-repository workflow and runner client. The workflow checks out the actual PR branch, prepares the result path, calls Agent Relay, validates the result and worktree, removes the artifact, commits with the validated message, and pushes through GitHub Actions credentials.

Finally, validate the complete path against one controlled repository, including one correction cycle and final plan completion.

## Milestones

### Milestone 1: Repository foundation and contracts

Create repository instructions, TypeScript foundation, request schema, job schema, result schema, validation, and tests.

Acceptance requires build, lint, type-check, and test commands to pass. Contracts reject repository URLs, SSH keys, GitHub tokens, arbitrary shell commands, caller-selected result paths, invalid result status combinations, multiline commit messages, control characters, missing fields, and oversized values.

### Milestone 2: Compose deployment, toolchain, and persistent Codex login

Create Dockerfiles and one Compose definition containing the runner and Agent Relay. Add the private network, shared workspace volume, and direct mount of the operator's `~/.codex` directory.

The Agent Relay image must contain Node.js 22 and npm, Python 3 with pip and venv, Java 21 JDK, Rust through rustup with rustc and Cargo, Go, Git and Git LFS, GCC/G++, Clang, Make, CMake, pkg-config, Bash, curl, wget, jq, zip, unzip, tar, gzip, xz, zstd, rsync, file, GNU coreutils/findutils/diffutils, and CA certificates.

Acceptance requires both services to start, the runner to reach Agent Relay by service name, Codex authentication to survive Agent Relay recreation, and automated smoke checks to confirm required tools and major versions. Smoke checks must also confirm that OpenSSH and .NET are absent.

### Milestone 3: Relay API and job lifecycle

Implement health, authenticated job submission, status polling, single-job exclusion, idempotency, timeout, interruption reporting, and controlled result-path derivation.

Acceptance requires deterministic tests for authorization, valid submission, path traversal, duplicate requests, active-job rejection, terminal results, timeout, interruption, and rejection of caller-supplied result paths.

### Milestone 4: Codex execution and result artifact

Run `codex exec` in the runner-prepared workspace, stream output, capture exit status, preserve the worktree, and require `.agent-relay/result.json`.

Acceptance requires a controlled execution that reads repository instructions and the active plan, performs a harmless change, writes a valid result artifact with commit message and validation summary, and leaves both visible to the runner. Missing, malformed, inconsistent, or sensitive result files fail validation.

### Milestone 5: GitHub Actions checkout, commit, and push

Add the repository workflow and runner client. The workflow checks out the actual PR branch, locally excludes the result directory, dispatches the relay job, waits for completion, validates the result, compares it with the actual worktree, removes the artifact, commits with the validated message, and pushes with job credentials.

Acceptance requires a complete PR run where Codex changes the worktree and a runner-created commit appears on the same branch. Agent Relay has no SSH key or GitHub token, and `.agent-relay/result.json` is absent from the commit.

### Milestone 6: Public-interface validation and review loop

Allow Codex to reach only explicitly configured public test interfaces. Demonstrate implementation, ChatGPT review, correction, final plan completion, and another runner-created commit.

Acceptance requires clear limitations when private logs are unavailable. No Docker socket, private log mount, or lifecycle permission may be present.

### Milestone 7: Operations and recovery

Document runner registration, `RUNNER_TOKEN` rotation, browser-login refresh, Compose deployment, toolchain upgrades, result-artifact diagnosis, workspace cleanup, interrupted jobs, retries, and failure diagnosis.

Acceptance requires a restart exercise showing mounted `~/.codex` authentication persists while an in-flight job is interrupted and retried through a new workflow run.

## Concrete Steps

The intended repository structure is:

    AGENTS.md
    .agent/PLANS.md
    .env.example
    package.json
    tsconfig.json
    src/api/
    src/application/
    src/config/
    src/contracts/
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

The initial Agent Relay API exposes:

    GET /health
    POST /v1/jobs
    GET /v1/jobs/{jobId}

A create-job request contains a caller-generated request identifier, a workspace path relative to the shared root, active plan path, and execution mode such as implement, revise, or finalize. It may contain concise review findings. It does not contain repository URL, GitHub credential, SSH key, arbitrary result path, or copied repository contents.

Agent Relay derives `.agent-relay/result.json` relative to the validated workspace and includes the schema in the Codex instruction. The runner creates `.agent-relay/`, adds it to `.git/info/exclude`, and removes it before staging.

The initial result schema is:

    {
      "schemaVersion": 1,
      "status": "completed",
      "shouldCommit": true,
      "commitMessage": "Implement the active ExecPlan",
      "summary": "Implemented the requested behavior and updated the active plan.",
      "validation": [
        {
          "command": "npm test",
          "status": "passed",
          "exitCode": 0,
          "details": "All tests passed."
        }
      ],
      "blockers": [],
      "limitations": []
    }

Runner decision rules:

- a missing or invalid result file fails the workflow;
- `completed` plus `shouldCommit: true` requires a non-empty actual diff;
- `completed` plus `shouldCommit: false` requires an empty actual diff;
- `blocked` never causes a commit;
- self-reported validation does not replace actual workflow checks;
- the runner removes the result artifact before staging and verifies it is absent from the commit.

## Validation and Acceptance

The implementation is accepted only when:

1. One Compose deployment starts exactly one repository-scoped runner and one Agent Relay service.
2. `.env.example` contains `RUNNER_TOKEN` and no real credentials.
3. The runner registers with the configured target repository.
4. Both services communicate over a private Compose network and see the same workspace.
5. The operator's standard `~/.codex` is mounted without setting `CODEX_HOME`.
6. Recreating Agent Relay preserves the Codex login.
7. The required development runtimes, compilers, package tools, and utilities are installed and smoke-tested.
8. OpenSSH and .NET are absent from the Agent Relay image.
9. Unauthorized requests and paths outside the shared root are rejected.
10. Only one Codex job runs at a time.
11. `codex exec` reads repository instructions and the active plan.
12. Codex changes and validation results remain visible to the runner.
13. Codex writes a valid result file with a commit message when changes should be committed.
14. Missing, malformed, inconsistent, or sensitive result artifacts fail validation.
15. Codex receives no GitHub token or SSH key.
16. Agent Relay performs no clone, fetch, checkout, commit, push, or GitHub API operation.
17. The runner checks out the actual pull-request branch and independently verifies the worktree.
18. The runner removes the result artifact before staging.
19. The runner commits with the validated Codex-proposed message and pushes with GitHub Actions credentials.
20. Workflow concurrency prevents overlapping executions for the same pull request.
21. Restarting Agent Relay interrupts the active process but preserves mounted authentication.
22. A new workflow run can continue from the current branch and active plan.
23. Codex has no Docker socket, private logs, or service lifecycle control.
24. Failures requiring unavailable private logs are recorded as limitations, not fabricated diagnoses.
25. Logs, result files, and API responses expose no runner token, relay token, GitHub credentials, or Codex authentication files.
26. The complete implementation, correction, and finalization loop is demonstrated on one controlled repository.

Unit and integration tests cover API validation, workspace containment, authentication, result schema validation, commit-message validation, job state transitions, idempotency, single-job exclusion, process execution, timeout, interruption, redaction, result cleanup, worktree comparison, runner client behavior, and toolchain smoke checks.

## Idempotence and Recovery

Every request has a caller-generated request identifier. Repeating an identical request returns the existing job. Reusing the identifier with different immutable fields is rejected.

The MVP permits one active Codex process per deployment. Workflow concurrency is the primary protection against duplicate runs for one PR.

Agent Relay resolves and normalizes workspace paths before checking containment. It derives the result path and never accepts it from the caller.

Before every execution, the runner removes stale result artifacts. A result is valid only for the current job.

A restart cannot preserve the operating-system process. Running jobs become interrupted. Recovery is a new GitHub Actions run against the current branch and plan.

Agent Relay never attempts Git recovery. Checkout and push failures belong to the runner workflow.

Mounted `~/.codex` and the shared workspace are separate resources so authentication persistence and workspace cleanup remain independent.

## Artifacts and Notes

The design is documented in `README.md`, `.env.example`, and this active plan.

The revised design removes repository routing, mirrors, worktrees managed by Agent Relay, expected remote-SHA verification, SSH identities, Codex-created commits, Docker socket, and private-log access.

The design adds `.agent-relay/result.json` as the controlled handoff from Codex to the runner.

The image contract adds a general-purpose development toolchain and explicitly excludes OpenSSH and .NET.

Implementation evidence must be added as concise test summaries, container checks, toolchain smoke checks, sanitized result artifacts, and end-to-end observations.

## Interfaces and Dependencies

Agent Relay uses Node.js 22, TypeScript, and Codex CLI. HTTP, schema-validation, logging, and test dependencies must remain minimal.

Agent Relay depends operationally on:

- the self-hosted runner service in the same Compose project;
- a shared workspace volume;
- a private Compose network;
- mounted `~/.codex` with valid browser-login credentials;
- a relay authentication token;
- outbound access required by Codex;
- explicitly configured public test interfaces.

The runner depends operationally on:

- `RUNNER_TOKEN` for repository-scoped registration;
- configured repository URL, runner name, and labels;
- GitHub Actions job credentials;
- the shared workspace volume;
- network access to Agent Relay;
- a JSON parser and result-schema validator.

No GitHub credential is an Agent Relay dependency.

## Plan Revision Notes

- 2026-07-13: Created the initial reusable Agent Relay design.
- 2026-07-13: Reworked the plan around one repository per Compose deployment and runner-owned Git operations.
- 2026-07-13: Added the versioned `.agent-relay/result.json` handoff.
- 2026-07-13: Added the mandatory general-purpose Codex toolchain: Node.js/npm, Python/pip/venv, Java 21, Rust/rustup/Cargo, Go, Git/Git LFS, native build tools, and basic Unix utilities. OpenSSH and .NET are explicitly excluded.
