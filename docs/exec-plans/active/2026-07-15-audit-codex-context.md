# Minimize and align Codex context

This ExecPlan is a living document and must remain current while the work proceeds.

## Purpose / Big Picture

Codex should receive only the repository instructions and task context required to implement the requested change. The repository must not give Codex conflicting commands, duplicate the same rule across multiple sources, assign runner or operator responsibilities to Codex, or expose operational and security details that are not necessary for implementation.

After this work, every source that can influence Codex execution has a clear owner and narrow purpose. `AGENTS.md` contains durable repository-level engineering rules. `.agent/PLANS.md` contains only reusable ExecPlan structure and execution guidance that is compatible with the repository rules. `src/execution/prompt.ts` contains only the runtime contract required for one Relay job. The active plan contains only task-specific implementation context.

## Progress

- [x] (2026-07-15) Created this plan before making implementation changes.
- [ ] Inventory every file, workflow value, environment variable, prompt fragment, generated artifact, and mounted path that can become visible to Codex.
- [ ] Classify each item as required task context, durable repository instruction, runner-owned control, operator-only information, duplicate instruction, or conflicting instruction.
- [ ] Remove conflicts, duplicates, runner-owned procedures, and information that Codex does not need.
- [ ] Keep each remaining instruction in one canonical source and replace duplicated detail with a narrow reference only where the reference is required.
- [ ] Add focused tests for the runtime prompt and context boundary without making Codex responsible for auditing that boundary.
- [ ] Repeat the repository audit from a clean inventory until no additional conflicting, unnecessary, or inappropriate Codex context is found.
- [ ] Run the full repository validation and record the results.
- [ ] Move this plan to `docs/exec-plans/completed/` only after the final audit finds no remaining issues.

## Surprises & Discoveries

No discoveries have been recorded yet.

## Decision Log

- Decision: audit the complete context boundary rather than only `AGENTS.md`, `.agent/PLANS.md`, and `src/execution/prompt.ts`.
  Rationale: Codex context can also be affected by workflow inputs, mounted files, environment variables, generated prompts, active plans, and repository documentation that the agent is instructed to read.
  Date/Author: 2026-07-15 / repository audit.

- Decision: tests may validate the application-owned prompt and context construction, but Codex must not receive instructions to audit its own permissions or Git ownership model.
  Rationale: context governance belongs to the Relay implementation and repository maintainers, not to the task-executing model.
  Date/Author: 2026-07-15 / repository audit.

## Outcomes & Retrospective

The audit has not started. Completion requires a documented inventory, implementation changes, focused regression tests, a second independent pass over the repository, and full validation.

## Context and Orientation

Agent Relay launches `codex exec` from `src/execution/codex-executor.ts`. The task prompt is built in `src/execution/prompt.ts`. Codex can also read repository files available in the checked-out workspace, including `AGENTS.md`, `.agent/PLANS.md`, active ExecPlans, source code, tests, workflows, and documentation. The GitHub runner owns checkout, commit, and push. Agent Relay owns authenticated process execution and result validation.

The audit must examine both explicit instructions and incidental exposure. Explicit instructions are prose that tells Codex what to do. Incidental exposure includes environment variables, mounted credentials, generated files, workflow metadata, paths, logs, and operational details available in the Codex process even when they are not mentioned in the prompt.

## Plan of Work

First, produce a complete inventory of the Codex context boundary from the current repository. Trace the process launch from workflow and Compose configuration through `src/server.ts`, configuration loading, environment construction, prompt construction, workspace mounting, result-file creation, and runner finalization. Search all repository text for instructions addressed to Codex, agents, implementers, or ExecPlan executors.

Second, classify every discovered item. Preserve only information needed for implementation, validation, and the structured result contract. Move durable rules to the narrowest canonical source. Remove duplicate wording when a lower-level runtime guarantee already enforces it. Remove runner-owned Git, publication, artifact, credential, and orchestration procedures from Codex-facing instructions unless Codex must know a single prohibition to avoid interfering with them.

Third, implement the context reduction. Keep the runtime prompt short and task-specific. Keep `.agent/PLANS.md` generic and compatible with `AGENTS.md`. Keep operational procedures in the operations runbook and do not instruct Codex to inspect them unless the active task changes operations. Ensure the Codex child environment excludes Relay credentials and any other control or publication credentials that are not required by the child process.

Fourth, add focused tests around prompt construction and environment filtering. Tests must assert application behavior directly. Do not add plan steps or runtime instructions telling Codex to grep, validate, or reason about its own instruction boundary.

Finally, restart the inventory from the process launch and repeat all searches without relying on the first findings list. Record each additional finding. Continue until a full pass produces no new conflicts, duplicates, runner-owned instructions, or unnecessary exposed information.

## Concrete Steps

Run all commands from the repository root.

Inspect the complete repository tree and all text files. Trace the Codex launch, prompt, environment, workspace, workflow inputs, mounted paths, and result handling. Use repository searches as maintainer audit tools; do not add those searches to the instructions sent to Codex.

Run focused tests while changing prompt construction and environment filtering, then run:

    npm ci
    npm run check
    docker compose config
    docker build --tag agent-relay:local .
    docker build --file Dockerfile.runner --tag agent-relay-runner:local .

Record exact outcomes in `Artifacts and Notes` before completion.

## Validation and Acceptance

A final clean audit pass must find no contradictory instructions, no duplicate detailed procedures in multiple Codex-readable instruction sources, no runner-owned tasks assigned to Codex, and no exposed credential or control values that the Codex process does not need.

The runtime prompt must contain only the active plan location, execution mode, required result contract, workspace constraints needed by the task, and narrowly stated prohibitions necessary to protect runner-owned operations. Repository-level engineering rules must not be duplicated in the runtime prompt.

The Codex child environment must exclude Relay authentication, GitHub publication credentials, and other runner or operator control values unless a specific implementation task demonstrably requires them. Tests must prove the filtering behavior.

All repository checks and image builds must pass. The plan remains active until a repeated audit produces no new findings.

## Idempotence and Recovery

The audit is read-only until a finding is classified. Each implementation change must be small and reversible. Repeating the inventory and searches must not change repository state. Prompt and environment tests must use controlled fixtures and must not require real credentials.

## Artifacts and Notes

No audit evidence has been recorded yet.

## Interfaces and Dependencies

Do not add an external dependency for this work. Use the existing TypeScript and Node.js test infrastructure.

The final context boundary must be represented by explicit application interfaces around prompt construction and child environment construction. Tests should consume those interfaces rather than parse unrelated documentation or make the task-executing Codex verify repository governance.
