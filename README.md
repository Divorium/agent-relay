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
5. The runner sends an authenticated request to Agent Relay over the private Compose network.
6. Agent Relay starts a fresh non-interactive `codex exec` process in that existing workspace.
7. Codex reads the repository's `AGENTS.md` instructions and active plan, changes files, updates the plan, and runs validation available from its container.
8. Agent Relay returns the execution result to the runner.
9. The runner inspects the worktree, creates a commit, and pushes it to the same pull request branch using the GitHub Actions job credentials.
10. ChatGPT reviews the updated pull request.
11. The same workflow can be dispatched again for corrections and final plan completion.

```text
ChatGPT
   -> pull request and active plan
   -> GitHub Actions workflow
   -> self-hosted runner: checkout
   -> Agent Relay: codex exec in shared workspace
   -> self-hosted runner: commit and push
   -> ChatGPT review
```

## Responsibility split

### GitHub Actions runner

The runner is responsible for:

- registering with the configured target repository;
- checking out the pull request branch;
- exposing the checked-out repository through the shared workspace volume;
- sending the execution request to Agent Relay;
- waiting for the terminal result;
- configuring the commit author;
- committing changed files;
- pushing to the pull request branch with the GitHub Actions job token;
- reporting job success or failure to GitHub.

### Agent Relay

Agent Relay is responsible for:

- exposing a private authenticated HTTP API;
- validating that the requested workspace is inside the shared workspace root;
- starting a fresh `codex exec` process in that workspace;
- streaming and retaining execution output needed by the runner;
- returning a clear terminal status and exit information;
- preventing overlapping Codex executions inside the single deployment.

Agent Relay does not clone repositories, manage branches, create commits, push changes, call the GitHub API, select SSH keys, or store GitHub credentials.

### Codex

Codex is responsible for:

- reading the checked-out repository and its instructions;
- executing the active plan;
- editing code and documentation;
- updating the active plan as work progresses;
- running tests and checks available in its execution environment;
- leaving a coherent worktree for the runner to commit.

Codex does not receive a GitHub token or SSH key and does not push changes.

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
- execution logs and deterministic terminal statuses;
- a repository workflow that performs checkout, relay invocation, commit, and push;
- tests for request validation, workspace path validation, process execution, job state, and runner client behavior;
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
