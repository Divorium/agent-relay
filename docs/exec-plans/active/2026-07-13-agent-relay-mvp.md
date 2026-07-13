# Agent Relay MVP

## Purpose / Big Picture

Agent Relay will provide a reusable, self-hosted bridge between GitHub Actions and Codex. ChatGPT will create and review a pull request in a target repository. A GitHub Actions workflow will send an authenticated request to Agent Relay. Agent Relay will prepare the requested pull request branch, run Codex with access to the target repository and its local development infrastructure, and allow Codex to commit and push implementation changes back to the same branch.

The operator-visible outcome is a complete plan-to-implementation loop in which GitHub remains the durable collaboration surface. ChatGPT plans and reviews work, Codex performs it, and Agent Relay supplies the stable local execution environment and transport between the self-hosted runner and Codex.

This plan covers the first usable version. It deliberately avoids becoming a general workflow platform.

Implementation must not begin until this plan is reviewed and approved.

## Progress

- [x] (2026-07-13) Created the Agent Relay repository and initial README.
- [x] (2026-07-13) Recorded the proposed MVP architecture and trust model.
- [ ] Review and approve the material design decisions in this plan.
- [ ] Establish repository instructions, project structure, contracts, and automated validation.
- [ ] Implement Docker packaging and persistent Codex authentication.
- [ ] Implement the authenticated job API and durable local job state.
- [ ] Implement repository configuration, Git workspace preparation, locking, and expected-SHA validation.
- [ ] Integrate non-interactive Codex execution, logs, completion detection, and interruption handling.
- [ ] Implement SSH-based commit and push behavior for the target branch.
- [ ] Add the target-repository GitHub Actions integration example.
- [ ] Validate the complete flow against a controlled test repository and a local service endpoint.
- [ ] Complete operational, recovery, and security documentation.

## Surprises & Discoveries

- OpenAI supports browser-based ChatGPT authentication for Codex CLI and stores file-based credentials under `CODEX_HOME`. This allows a Docker deployment to preserve the existing login method through a persistent volume.
- Restarting the service can preserve authentication and job metadata, but it cannot preserve a currently running Codex process. Recovery must use the Git branch and active implementation plan rather than process memory.
- Codex App Server exists, but `codex exec` is the stable non-interactive interface and is sufficient for the MVP. Agent Relay therefore does not depend on the App Server protocol.
- The service is intentionally privileged. Repository write credentials and local infrastructure access cannot be hidden from a Codex process that is deliberately granted full shell access. The security boundary is therefore an explicit repository allowlist and trusted deployment, not an attempt to sandbox Codex away from required capabilities.

## Decision Log

- Decision: Keep the plan and implementation in one target-repository pull request.
  Rationale: ChatGPT and Codex must collaborate on the same branch, and the active plan must evolve with the implementation.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Build Agent Relay as a separate reusable repository rather than copying the service into every application repository.
  Rationale: Several systems need the same transport, Codex execution, Git, authentication, and recovery behavior. Project repositories should retain only their instructions, plans, workflow, and optional configuration.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Deploy Agent Relay close to the infrastructure it controls.
  Rationale: Codex must reach local application endpoints, repositories, logs, and optional Docker resources. The same image may be deployed once per host or infrastructure group.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Keep Agent Relay running as a persistent Docker service, but start a fresh `codex exec` process for each job.
  Rationale: A persistent service preserves authentication and accepts requests without making the GitHub runner manage containers. Fresh Codex executions avoid accidental context sharing between repositories and retries.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Use an asynchronous HTTP job API rather than holding one request open for the entire Codex execution.
  Rationale: Codex work can be long-running. A create-and-poll protocol survives runner retries, proxy timeouts, and temporary network interruptions while remaining small.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Use Node.js 22 and TypeScript for the service.
  Rationale: Codex CLI already requires the Node runtime family. TypeScript provides explicit API and state contracts, and Node supports subprocess streaming and filesystem operations without another runtime in the image.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Use persistent file-backed state for the MVP rather than a database.
  Rationale: A single Agent Relay instance only needs durable job metadata, logs, locks, and recovery markers. A database or message broker would add complexity without improving the first deployment.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Configure allowed repositories and their SSH identities on the Agent Relay host.
  Rationale: Requests must not be able to select arbitrary Git URLs, key files, or host paths. The request identifies a repository alias or slug, and Agent Relay resolves trusted configuration.
  Date/Author: 2026-07-13 / ChatGPT

- Decision: Let Codex perform the requested Git commit and push while Agent Relay verifies the resulting remote branch state.
  Rationale: The desired execution model gives Codex full repository access. Agent Relay still needs to verify expected starting and ending SHAs and report conflicts accurately.
  Date/Author: 2026-07-13 / ChatGPT

## Outcomes & Retrospective

No implementation exists yet. The design phase is successful when the operator accepts the architecture, trust model, MVP scope, and proposed technology. This section must be updated after every implementation milestone and at final completion.

## Context and Orientation

Agent Relay is not part of any target application's business domain. It is development infrastructure shared by projects such as Monify and other systems owned by the operator.

A target repository owns the pull request, active implementation plan, repository-specific `AGENTS.md`, tests, and GitHub Actions workflow. Agent Relay owns the HTTP request boundary, persistent Codex environment, repository checkout, job lifecycle, logs, and execution result.

The self-hosted GitHub runner is deliberately thin. It must be able to contact Agent Relay, authenticate the request, submit the repository and branch identifiers, and poll for completion. It does not need access to the target application's internal network and does not create or control Codex containers.

Agent Relay runs continuously in Docker. Its deployment joins the network or mounts the resources needed by Codex for the local projects it serves. The service starts a separate `codex exec` child process for every accepted job.

Codex authentication uses the operator's existing ChatGPT browser login. File-based credentials are stored under a persistent `CODEX_HOME`. The Docker image does not contain those credentials. Initial login is performed by the operator outside or interactively with the container, and the resulting credentials are placed in the persistent volume.

Git access uses explicit repository configuration. Each allowed repository maps to its SSH URL, SSH identity, workspace policy, and optional execution settings. SSH private keys are mounted at runtime and never committed or built into the image.

## Boundaries and Non-Goals

Agent Relay must remain a small execution bridge. It must not become a second workflow engine or duplicate GitHub pull request state.

The GitHub runner owns dispatch and reporting to GitHub Actions. Agent Relay owns local execution. Codex owns the implementation actions requested by the plan. GitHub owns branches, commits, pull requests, reviews, and checks.

The first version supports trusted repositories only. It must reject repositories that are not configured locally. It must not execute arbitrary Git URLs or public fork pull requests.

Agent Relay may be granted broad local infrastructure access, including application networks, mounted source trees, host tools, credentials, or the Docker socket. These are deployment choices and must not be silently enabled by the base image. Documentation must clearly state that any capability visible to the container is also available to Codex.

The MVP does not include a browser UI, external user management, distributed workers, a message broker, dynamic creation of Codex containers, automatic pull request merge, multi-agent collaboration, arbitrary scheduling, or a general plugin system.

The MVP does not require a GitHub API token inside Agent Relay. Git operations use SSH. Pull request metadata required for execution is supplied by the trusted GitHub Actions workflow.

## Plan of Work

First, establish the repository operating contract. Add `AGENTS.md`, the ExecPlan lifecycle instructions, the TypeScript project, formatting and linting rules, test tooling, and a documented directory layout. Define job request, state, result, repository configuration, and error contracts before implementing behavior.

Second, build the Docker runtime. The image will contain Node.js, Codex CLI, Git, OpenSSH, and the Agent Relay application. Compose examples will mount persistent directories for `CODEX_HOME`, job state, logs, and workspaces. The image must run as a non-root application user by default, while deployments may explicitly grant additional host capabilities when required. Add a login bootstrap procedure that preserves the operator's browser-based ChatGPT session.

Third, implement the HTTP service. It will expose health, create-job, and read-job endpoints. Requests will use a bearer token supplied through runtime secrets. Input validation must reject unknown repositories, invalid branch names, missing expected SHAs, invalid plan paths, duplicate request identifiers, and unsupported modes.

Fourth, implement durable local job state. A job record will be written atomically before execution begins and updated through accepted, preparing, running, completed, failed, conflicted, interrupted, and cancelled states. Service startup will detect jobs that were running when the process stopped and mark them interrupted. Re-submission with the same request identifier must be idempotent.

Fifth, implement repository preparation. Agent Relay will keep a local mirror or cache for each allowed repository and create an isolated workspace for each job. It will fetch the requested branch, verify that the remote head equals the expected SHA, and acquire a lock for the repository and branch. A second job for the same branch must not run concurrently.

Sixth, integrate Codex. Agent Relay will create a concise instruction that points Codex to the checked-out repository, applicable `AGENTS.md` files, and active plan. It will start `codex exec` in the workspace, stream structured output into the job log, capture the process exit status, and enforce a configurable maximum runtime. Codex will have the deployment-provided network, filesystem, and tool access.

Seventh, support Git completion. The Codex instruction will require implementation, validation, plan updates, commit, and push to the current branch. After Codex exits, Agent Relay will inspect the workspace and remote branch. Completion requires a clean worktree, a changed remote head when changes were expected, and no evidence that the branch was overwritten after the job started. Conflicts and incomplete pushes must be reported distinctly from implementation failures.

Eighth, provide target-repository integration. Add an example GitHub Actions workflow and a small portable client script that submits the job and polls until a terminal state. The workflow will pass repository slug, pull request number, branch, expected SHA, active plan path, request identifier, and execution mode. The example will document how ChatGPT or a human dispatches it.

Finally, validate the entire system with a controlled repository and local endpoint. The acceptance test will create a pull request branch containing a small active plan, dispatch Agent Relay through the same protocol as GitHub Actions, let Codex change and test the repository, and confirm that a new commit appears on the same branch. Restart and conflict cases will also be demonstrated.

## Milestones

### Milestone 1: Repository foundation and contracts

Create the project structure, instructions, schemas, validation tooling, and tests for pure contracts. At the end of this milestone, the repository can build, lint, type-check, and test, but it does not yet execute Codex.

Acceptance requires documented request and result schemas, repository configuration validation, deterministic error codes, and green project checks.

### Milestone 2: Docker and authentication persistence

Create the production Dockerfile and Compose example. Install Codex CLI and required Git/SSH tools. Mount `CODEX_HOME` and document browser-login bootstrap and credential copying. Add an automated smoke check that confirms Codex is installed and that file-based authentication survives container recreation without exposing credential contents.

Acceptance requires starting the service container, confirming health, recreating it with the same volume, and confirming that Codex still recognizes an authenticated session.

### Milestone 3: HTTP API and durable job lifecycle

Implement authenticated job submission, status retrieval, local persistence, idempotency, and restart recovery. Use a fake executor in tests so API and state behavior do not require live Codex access.

Acceptance requires API tests for valid submission, unauthorized access, invalid input, duplicate requests, terminal status, and interrupted-job recovery.

### Milestone 4: Git workspace and SSH integration

Implement repository allowlisting, SSH identity selection, fetching, expected-SHA verification, isolated workspaces, branch locks, and cleanup. Test against local bare Git repositories without requiring GitHub.

Acceptance requires deterministic tests for successful checkout, unknown repository rejection, SHA mismatch, duplicate branch execution, commit detection, and non-force push behavior.

### Milestone 5: Codex execution

Run real `codex exec` processes, stream output, enforce timeout and cancellation behavior, and preserve logs. Define the exact prompt contract for implement, revise, and finalize modes without duplicating the active plan contents in the request.

Acceptance requires a controlled authenticated smoke execution that reads a plan from the workspace and performs a harmless local change.

### Milestone 6: Same-branch push and GitHub Actions integration

Allow Codex to commit and push through the configured SSH identity, verify the final remote branch, and add the reusable target-repository workflow example.

Acceptance requires a complete controlled pull request branch run in which GitHub Actions submits the job, Codex pushes a new commit to the same branch, and the workflow reports the final SHA.

### Milestone 7: Operations and recovery

Complete runbooks for deployment, login refresh, key rotation, logs, interrupted execution, workspace cleanup, upgrades, and failure diagnosis. Review the final trust model against actual mounts, networks, and secrets.

Acceptance requires a documented restart exercise, a failed-job exercise, a branch-conflict exercise, and confirmation that logs do not contain authentication files or SSH key material.

## Concrete Steps

The implementation branch will begin by adding the repository instructions and project skeleton. Exact commands and paths will be finalized after this plan is approved, but the intended structure is:

    AGENTS.md
    .agent/PLANS.md
    package.json
    tsconfig.json
    src/api/
    src/application/
    src/config/
    src/execution/
    src/git/
    src/persistence/
    src/security/
    src/server.ts
    test/
    scripts/
    examples/github-actions/
    Dockerfile
    compose.example.yml
    docs/operations/

The service will expose versioned endpoints similar to:

    GET /health
    POST /v1/jobs
    GET /v1/jobs/{jobId}

A create-job request will include a stable request identifier, configured repository slug, pull request number, branch, expected head SHA, active plan path, and execution mode. It may include concise review instructions for revision work, but it will not embed the entire repository or duplicate the plan.

The implementation must keep the API and job contracts documented and tested before wiring them to live Codex execution.

## Validation and Acceptance

The implementation is accepted only when all of the following behaviors are demonstrated:

1. The Docker image builds reproducibly and starts the Agent Relay health endpoint.
2. Browser-based ChatGPT login can be provisioned into persistent `CODEX_HOME` without changing to API-key authentication.
3. Recreating the service container with the same volume preserves the Codex login cache.
4. The self-hosted runner can create a job and poll its result over the private network.
5. Requests without the correct relay token are rejected.
6. Requests for unconfigured repositories are rejected before any Git operation.
7. The requested remote branch must match the supplied expected SHA before execution starts.
8. Two jobs cannot modify the same repository branch concurrently.
9. Codex runs in the requested workspace and can reach a configured local test endpoint.
10. Codex reads the active plan and repository instructions rather than receiving a second copied plan in the API request.
11. Codex can modify, validate, commit, and push to the same pull request branch through the configured SSH identity.
12. Agent Relay verifies and reports the final remote commit SHA.
13. A remote branch change during execution produces a conflict result and never causes a force push.
14. Repeated submission of the same request identifier returns the same job rather than starting duplicate work.
15. Restarting Agent Relay marks an in-flight process as interrupted while preserving its logs and job record.
16. A later retry can continue from the current branch and active plan.
17. Logs and API responses do not expose Codex authentication data, relay tokens, or SSH private key contents.
18. The complete flow is demonstrated through the provided GitHub Actions example.

Unit and integration tests must cover contract validation, state transitions, persistence, locking, Git behavior, process execution, redaction, and restart recovery. Live Codex and GitHub validation must be kept as explicit smoke or end-to-end checks because they require operator credentials and external services.

## Idempotence and Recovery

Every submitted request has a caller-provided request identifier. Repeating the request with identical immutable fields returns the original job. Reusing the identifier with different fields is rejected.

Repository workspaces are derived from job identifiers and are never shared by simultaneous jobs. Preparation can be retried after removing an incomplete workspace. The repository cache is disposable and can be rebuilt from the configured remote.

The branch lock is acquired before workspace preparation and released in a guaranteed cleanup path. Stale locks must include enough process and job metadata to distinguish an active job from an interrupted one after service restart.

Agent Relay never force pushes. If the remote head changes unexpectedly, the job ends as conflicted. A new job may then start from the updated expected SHA.

A service restart cannot resume the same operating-system process. The active job becomes interrupted. Recovery means dispatching a new attempt against the current branch. The active plan and Git history must contain enough progress information for Codex to continue safely.

Persistent Codex credentials, state, logs, and workspaces are separate mounts so each can be backed up, rotated, or cleared independently.

## Artifacts and Notes

The initial design is documented in `README.md` and this active plan.

Relevant external behavior verified during planning:

- Codex CLI supports ChatGPT browser login.
- File-based credentials are stored in `auth.json` under `CODEX_HOME` and are refreshed during use.
- Authentication can be copied into a Docker container or preserved through a mounted volume.
- `codex exec` is the stable non-interactive command intended for scripted and CI-style execution.
- Codex App Server is not required for this MVP.

Implementation evidence must be added here as concise command outputs, test summaries, container checks, and end-to-end observations.

## Interfaces and Dependencies

The initial service runtime will use Node.js 22, TypeScript, and the stable Codex CLI package. The specific HTTP framework, schema library, test runner, logger, and package versions will be selected during the foundation milestone. Dependencies must be limited to capabilities that materially improve contract validation, HTTP handling, process control, or tests.

Agent Relay depends operationally on:

- a persistent `CODEX_HOME` with a valid ChatGPT login;
- Git and OpenSSH;
- one configured SSH identity per writable repository or another explicitly configured dedicated identity;
- network access to GitHub;
- network and filesystem access required by each target system;
- a shared private network with the self-hosted runner;
- a relay authentication secret shared with the runner;
- target repositories that contain sufficient `AGENTS.md` instructions and an active implementation plan.

The request contract must not accept raw SSH keys, arbitrary key paths, arbitrary Git URLs, Docker mount definitions, or shell commands. Those capabilities are controlled by the Agent Relay deployment configuration.

## Approval Decisions

Approval of this plan confirms the following proposed choices:

1. Agent Relay is a separate reusable repository.
2. The same image may be deployed on several hosts, close to each project's local infrastructure.
3. One deployment may serve multiple explicitly allowlisted repositories.
4. The service is persistent, while each job uses a fresh `codex exec` process.
5. The runner communicates through a small asynchronous HTTP API.
6. Node.js 22 and TypeScript are used for the service.
7. MVP state is stored in local files rather than a database.
8. Codex retains full deployment-granted repository and infrastructure access.
9. Browser-based ChatGPT login is persisted through `CODEX_HOME`.
10. Repository-specific SSH identities are mounted at runtime.
11. Codex commits and pushes to the existing pull request branch; Agent Relay verifies the result.
12. The MVP supports trusted repositories only and does not attempt to execute arbitrary external pull requests.

Any rejected decision must be revised in this plan before implementation begins.

## Plan Revision Notes

- 2026-07-13: Created the initial self-contained MVP plan from the agreed one-PR, persistent-Codex, thin-runner architecture. Added explicit decisions for multi-repository deployment, browser-login persistence, SSH pushes, job recovery, and acceptance validation.
