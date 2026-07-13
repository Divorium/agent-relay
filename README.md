# Agent Relay

Agent Relay is a self-hosted bridge between GitHub Actions and a locally running Codex environment.

It allows ChatGPT to create or update an implementation plan in a pull request, dispatch work through GitHub Actions, and delegate implementation to Codex. Codex works on the same pull request branch, uses the target system's local infrastructure, runs validation, commits its changes, and pushes them back for ChatGPT review.

## Status

Agent Relay is currently in the design phase. This repository contains the proposed architecture and active implementation plan. No executable service has been implemented yet.

## Intended workflow

1. ChatGPT creates a branch and pull request in a target repository.
2. The pull request contains an active implementation plan and later the implementation itself.
3. ChatGPT dispatches a GitHub Actions workflow in the target repository.
4. The self-hosted runner sends a request to Agent Relay over a private network.
5. Agent Relay checks out the requested repository, branch, and expected commit.
6. Agent Relay starts a fresh non-interactive Codex execution in that workspace.
7. Codex reads the repository instructions and active plan, implements the work, tests it against the local infrastructure, updates the plan, commits, and pushes to the same branch.
8. GitHub Actions reports the execution result.
9. ChatGPT reads and reviews the updated pull request.
10. The same flow can be repeated for corrections and final plan completion.

```text
ChatGPT
   -> target repository pull request
   -> GitHub Actions
   -> self-hosted runner
   -> Agent Relay
   -> Codex
   -> commit and push to the same pull request branch
   -> ChatGPT review
```

## Deployment model

Agent Relay is a separate, reusable system rather than code copied into every application repository.

The same Agent Relay image can be deployed on multiple hosts. Each deployment runs close to the repositories and local infrastructure that Codex must access. A deployment may support one or several explicitly configured repositories.

Each target repository contains only its own:

- GitHub Actions dispatch workflow;
- `AGENTS.md` instructions;
- active implementation plan;
- project-specific tests and commands;
- optional Agent Relay project configuration.

Agent Relay contains the shared execution, Git, authentication, status, and Docker packaging logic.

## Core design decisions

The initial implementation follows these constraints:

- Plan and implementation remain in one pull request.
- ChatGPT and Codex work on the same branch.
- The GitHub runner only sends requests and reads execution status.
- The runner does not start containers and does not need access to application infrastructure.
- Agent Relay is a persistent Docker service.
- Every request starts a fresh `codex exec` process rather than reusing one model conversation indefinitely.
- Codex has the same repository and local infrastructure access intentionally granted to the Agent Relay deployment.
- Codex uses a persistent `CODEX_HOME` so ChatGPT login credentials survive container recreation.
- Existing browser-based ChatGPT login remains supported. Credentials can be created outside the container and copied into the persistent Codex home.
- Git pushes use repository-specific SSH credentials available only at runtime.
- The service accepts only explicitly configured repositories.
- Only one active job may modify the same repository branch at a time.
- Every job is bound to an expected branch head SHA to prevent overwriting concurrent changes.
- GitHub remains the source of truth for plans, code, commits, pull requests, and reviews.

## Proposed MVP

The first version will provide:

- a Docker image containing Agent Relay, Codex CLI, Git, SSH, and required runtime tools;
- persistent volumes for Codex credentials, job state, and repository workspaces;
- a health endpoint;
- an authenticated HTTP endpoint for creating a job;
- an endpoint for reading job status and the final result;
- repository allowlist configuration;
- repository-specific SSH key selection;
- branch checkout with expected-SHA verification;
- isolated Git workspaces for executions;
- non-interactive Codex execution;
- streamed and persisted job logs;
- commit and push to the requested pull request branch;
- same-branch locking and duplicate-request protection;
- an example GitHub Actions workflow for target repositories;
- automated tests for API validation, Git operations, job state, locking, and process execution;
- operational documentation for login bootstrap, deployment, restart, recovery, and credential rotation.

## Authentication and persistence

Codex supports ChatGPT browser login. Its cached credentials can be stored in `auth.json` under `CODEX_HOME`. Agent Relay will use file-based credential storage and mount `CODEX_HOME` from a persistent volume.

Container recreation should preserve login credentials. A restart during an active Codex process will interrupt that execution; recovery is based on the current Git branch and active plan rather than process memory.

SSH credentials will not be built into the image or committed to this repository. Each repository will use a dedicated deploy key or other dedicated SSH identity mounted into the Agent Relay service at runtime.

## Trust model

Agent Relay is intentionally a privileged development service.

Codex may execute repository commands, modify code, access configured local infrastructure, and use repository write credentials. Therefore, an Agent Relay deployment must only accept jobs for repositories and branches trusted by the operator. It is not designed to execute arbitrary public pull requests or untrusted repositories.

Network reachability, Docker socket access, host mounts, and application credentials are deployment-specific capabilities. They must be explicitly enabled only on hosts where Codex requires them.

## Non-goals for the first version

The MVP will not provide:

- a web user interface;
- a general workflow engine;
- a message broker;
- dynamic creation of Codex containers by the GitHub runner;
- automatic pull request merging;
- GitHub organization administration;
- arbitrary repository execution;
- distributed scheduling across several Agent Relay nodes;
- multiple agents collaborating inside one job.

## Planned technology

The proposed implementation uses Node.js 22 and TypeScript for the HTTP service and job runner. This keeps Agent Relay on the same runtime family as Codex CLI, provides typed request and job contracts, and supports direct process and stream management without adding another application runtime.

The final dependency set and project layout are part of the active plan and must be approved before implementation starts.

## Active plan

The proposed implementation is described in:

`docs/exec-plans/active/2026-07-13-agent-relay-mvp.md`

Implementation will begin only after that plan is reviewed and approved.
