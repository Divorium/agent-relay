# Historical record: Agent Relay MVP

This file records the state delivered by the original MVP work. It is not a task instruction and is not a current architecture contract. Current work must follow `.agent/PLANS.md` and the explicitly selected file under `docs/exec-plans/active/`.

## Delivered scope at completion

The MVP established:

- a Node.js and TypeScript Relay service;
- authenticated create-and-poll job APIs;
- workspace containment and one-active-job execution;
- persistent job state and restart recovery;
- controlled process execution with output limits, redaction, timeout, and termination;
- a repository-scoped runner client and runner-owned Git publication;
- Compose packaging, image builds, toolchain checks, and automated tests;
- pull-request branch validation and runner registration reuse.

## Validation recorded at the time

The implementation was covered by TypeScript checks, Node tests, runner entrypoint tests, Compose validation, image builds, toolchain verification, and excluded-tool checks.

The following external scenarios were not recorded as executed during the MVP work:

- a deployment using operator-owned runner registration and authentication credentials;
- a genuine agent execution followed by runner-created commit and push;
- Relay recreation followed by authentication reuse.

These are historical evidence gaps, not active tasks.

## Superseded design

Later work replaced several original MVP mechanisms. The following descriptions from the original implementation must not be treated as current behavior:

- model-generated `.agent-relay/result.json`;
- model-selected result or commit fields;
- `danger-full-access` execution;
- mounting the complete host `~/.codex` directory;
- prompt instructions assigning Git publication rules to the model;
- runner validation of a model-generated result artifact.

The current architecture is documented by the repository code, README, operations guide, `.agent/PLANS.md`, and the currently selected active ExecPlan.
