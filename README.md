# Agent Relay

Agent Relay is a small self-hosted bridge between a GitHub Actions self-hosted runner and Codex.

ChatGPT creates an active implementation plan and pull request in a target repository. GitHub Actions checks out the pull request branch on the runner, asks Agent Relay to run Codex in the checked-out workspace, and then commits and pushes the resulting changes back to the same branch. ChatGPT reviews the updated pull request and may repeat the process until the implementation and plan are complete.

## Status

Agent Relay is currently in the design phase. This repository contains the proposed architecture and active implementation plan. No executable service has been implemented yet.

## MVP scope

The first version supports one target repository per Docker Compose deployment.

Each deployment contains exactly two cooperating services:

- a repository-scoped GitHub Actions self-hosted runner;
- Agent Relay with Codex CLI.

The runner and Agent Relay share one workspace volume and one private Compose network. The runner owns GitHub integration and Git operations. Agent Relay only starts Codex in the workspace prepared by the runner.

Running separate deployments for other repositories is a future operational use of the same image and Compose definition, but multi-repository routing is not part of the MVP.

## Intended workflow

1. ChatGPT creates or updates a branch and pull request in the target repository.
2. The pull request contains one active implementation plan and, later, the implementation itself.
3. ChatGPT dispatches the repository's GitHub Actions workflow.
4. The self-hosted runner checks out the actual pull request branch into the shared workspace.
5. The runner prepares a fixed, untracked result location and sends an authenticated request to Agent Relay over the private Compose network.
6. Agent Relay starts a fresh non-interactive `codex exec` process in that existing workspace.
7. Codex reads the repository's `AGENTS.md` instructions and active plan, changes files, updates the plan, and runs validation available from its container.
8. Before finishing, Codex writes a structured result file for the runner containing the proposed commit message and execution summary.
9. Agent Relay returns the execution result and result-file location to the runner.
10. The runner validates the result file and actual worktree, removes the result file, creates a commit, and pushes it to the same pull request branch using the GitHub Actions job credentials.
11. ChatGPT reviews the updated pull request.
12. The same workflow can be dispatched again for corrections and final plan completion.

```text
ChatGPT
   -> pull request and active plan
   -> GitHub Actions workflow
   -> self-hosted runner: checkout
   -> Agent Relay: codex exec in shared workspace
   -> Codex: result.json
   -> self-hosted runner: validate, commit and push
   -> ChatGPT review
```

## Responsibility split

### GitHub Actions runner

The runner is responsible for:

- registering with the configured target repository;
- checking out the pull request branch;
- exposing the checked-out repository through the shared workspace volume;
- preparing the controlled result-file location;
- sending the execution request to Agent Relay;
- waiting for the terminal result;
- validating the Codex result file and actual worktree;
- configuring the commit author;
- committing changed files with the validated Codex-proposed commit message;
- pushing to the pull request branch with the GitHub Actions job token;
- reporting job success or failure to GitHub.

### Agent Relay

Agent Relay is responsible for:

- exposing a private authenticated HTTP API;
- validating that the requested workspace is inside the shared workspace root;
- deriving a controlled result-file path for the job;
- starting a fresh `codex exec` process in that workspace;
- instructing Codex to write the result file before finishing;
- streaming and retaining execution output needed by the runner;
- returning a clear terminal status, exit information, and result-file location;
- preventing overlapping Codex executions inside the single deployment.

Agent Relay does not clone repositories, manage branches, create commits, push changes, call the GitHub API, select SSH keys, or store GitHub credentials.

### Codex

Codex is responsible for:

- reading the checked-out repository and its instructions;
- executing the active plan;
- editing code and documentation;
- updating the active plan as work progresses;
- running tests and checks available in its execution environment;
- leaving a coherent worktree for the runner to commit;
- writing the required structured result file before ending the execution.

Codex does not receive a GitHub token or SSH key and does not push changes.

## Codex result file

Codex must write one machine-readable JSON file before completing a job. The initial contract uses:

```text
.agent-relay/result.json
```

The path is fixed by Agent Relay and is not caller-controlled. The runner creates the directory and excludes it locally through `.git/info/exclude`. The runner deletes the result file before staging repository changes, so the artifact is never committed to the target repository.

The initial schema contains:

```json
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
```

Required behavior:

- `schemaVersion` identifies the contract version.
- `status` is `completed` or `blocked`.
- `shouldCommit` states whether Codex believes the worktree should be committed.
- `commitMessage` is required when `status` is `completed` and `shouldCommit` is `true`.
- `summary` explains what was done.
- `validation` records commands and observed outcomes without embedding large raw logs.
- `blockers` records conditions that prevent completion.
- `limitations` records unavailable evidence, such as private application logs.

The runner validates the JSON schema, status combination, commit-message format, and actual `git diff`. It never trusts the result file as proof that files changed or tests passed. A missing or invalid result file makes the relay job fail. Secrets, tokens, authentication data, and raw sensitive logs must never be written to this file.

## Docker and workspace model

The runner and Agent Relay run in the same Docker Compose project.

They share:

- one private network for runner-to-relay HTTP communication;
- one workspace volume containing the repository checked out by GitHub Actions.

Agent Relay does not need a published host port. The runner reaches it by its Compose service name.

The workspace path supplied in a request must resolve below the configured shared workspace root. Arbitrary host paths are rejected.

## Codex authentication

The container uses the standard Codex directory at the container user's `~/.codex` path. The deployment mounts the operator-provided `~/.codex` directory into that location.

The project will not set or depend on `CODEX_HOME`.

This preserves the existing browser-based ChatGPT login across container recreation. Restarting the container interrupts a running `codex exec` process, but does not remove the mounted Codex authentication and configuration files.

## GitHub authentication

Agent Relay does not use SSH deploy keys, personal access tokens, or a GitHub API token.

The self-hosted runner receives temporary GitHub Actions job credentials when a workflow is assigned. The workflow checks out the pull request branch and later uses the same job credentials to push the runner-created commit.

The runner registration credential is supplied through `RUNNER_TOKEN` in the deployment environment. See `.env.example`.

## Application access in the MVP

Codex does not receive the Docker socket and does not manage application containers.

Codex cannot restart services or read their private container logs. It may access only public interfaces that are reachable from the Agent Relay container, together with commands and tests available in the checked-out repository.

If a public interface fails without exposing sufficient diagnostic information, Codex must report that limitation instead of claiming to have inspected unavailable application logs.

## Proposed MVP capabilities

The first implementation will provide:

- a Docker Compose deployment containing the runner and Agent Relay services;
- a Docker image containing Node.js, Codex CLI, and the Agent Relay service;
- direct mounting of the operator's `~/.codex` directory;
- a shared workspace volume between runner and Agent Relay;
- a health endpoint;
- an authenticated endpoint for starting a Codex job;
- an endpoint for reading job status and result;
- a single active Codex job per deployment;
- non-interactive `codex exec` execution;
- a versioned Codex result-file contract;
- execution logs and deterministic terminal statuses;
- a repository workflow that performs checkout, relay invocation, result validation, commit, and push;
- tests for request validation, workspace path validation, result-file validation, process execution, job state, and runner client behavior;
- operating instructions for runner registration, browser-login persistence, deployment, interruption, and retry.

## Non-goals for the first version

The MVP will not provide:

- Git repository cloning or branch management inside Agent Relay;
- SSH key management;
- GitHub API integration inside Agent Relay;
- support for several repositories from one deployment;
- Docker socket access;
- private application log access;
- application container lifecycle management;
- a web user interface;
- a general workflow engine or message broker;
- automatic pull request merging;
- distributed scheduling;
- dynamic creation of Codex containers by the runner.

## Planned technology

The proposed implementation uses Node.js 22 and TypeScript for the HTTP service and Codex process management. The self-hosted runner and Agent Relay are packaged as services in one Docker Compose project.

The final dependency set and project layout remain subject to approval of the active plan.

## Configuration

`.env.example` documents the deployment inputs, including the required `RUNNER_TOKEN` used to register the self-hosted runner with the single target repository.

## Active plan

The proposed implementation is described in:

`docs/exec-plans/active/2026-07-13-agent-relay-mvp.md`

Implementation will begin only after that plan is reviewed and approved.
