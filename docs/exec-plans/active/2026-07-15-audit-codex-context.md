# Audit and minimize agent control context

This ExecPlan follows `.agent/PLANS.md` and remains active until the repository uses the real execution topology and the final self-hosted CI run passes.

## Purpose / Big Picture

The task process must receive one task definition: the selected active ExecPlan interpreted through `.agent/PLANS.md`. Workflow, credentials, process status, Git publication, and environment capabilities remain deterministic system concerns. Validation must reflect the infrastructure that actually exists: one containerized self-hosted runner labeled `agent-relay` and one Agent Relay container.

## Progress

- [x] Created draft PR #9 and traced the task-control path from workflow dispatch through Relay execution and Git finalization.
- [x] Removed secondary task fields, model-selected outcomes, commit intent, commit messages, and the model-generated result artifact.
- [x] Reduced `AGENTS.md` to durable engineering rules and restricted the runtime prompt to `.agent/PLANS.md` plus the selected active plan.
- [x] Restricted job creation to a direct regular file under `docs/exec-plans/active/` and removed configurable launcher and user overrides.
- [x] Scoped credentials to their consuming workflow steps and separated Relay and task-process filesystem access.
- [ ] Remove the invented native-host runner workflow and every claim that workflow routing can reach a host process.
- [ ] Run mandatory CI only on the existing `[self-hosted, agent-relay]` runner and reject fork-origin pull requests before executing repository code.
- [ ] Preserve the former application, Compose, image, toolchain, excluded-tool, and runner-image checks without claiming that Docker integration ran inside the containerized runner.
- [ ] Replace implementation-text assertions where practical with behavioral packaging and failure-path tests.
- [ ] Make job creation compensate a partially persisted job and request index before accepting another request.
- [ ] Treat a completed Relay process with a clean worktree as an explicit no-change failure rather than a successful implementation run.
- [ ] Reconcile PR #9 with the overlapping files in PR #3 and record the required merge/rebase order.
- [ ] Run the full test suite on the current PR head through the actual self-hosted runner and repair every failure.
- [ ] Record final evidence, complete a clean review pass, and move this plan back to `completed/` only after all items are satisfied.

## Surprises & Discoveries

- The previously cited successful run executed on GitHub-hosted Ubuntu. It proved that the original Docker checks were useful and valid in an environment with Docker, but it did not prove they can run inside the current containerized self-hosted runner.
- A manual host script can preserve the real Docker validation procedure, but a workflow targeting an unprovisioned runner is a dead test path and must not be represented as CI coverage.
- Green text-contract tests do not prove that a Dockerfile builds, a Compose file is accepted by Compose, or the installed Codex sandbox enforces the configured permissions.
- PR #3 and PR #9 overlap in prompt, runner, lifecycle, logging, and plan files. They cannot be merged independently without a deliberate rebase and regression run.

## Decision Log

- Decision: every repository workflow uses the existing self-hosted `agent-relay` runner.
  Rationale: no GitHub-hosted or additional native runner is part of this deployment.
- Decision: `.agent/PLANS.md` remains environment-neutral.
  Rationale: environment capabilities are properties of the launcher, not reusable model instructions.
- Decision: real Docker validation remains an operator-executed repository script until an actual automated Docker-capable execution path exists.
  Rationale: a dead workflow is worse than an explicit manual gate.
- Decision: mandatory CI must still test application behavior, contracts, scripts, workflow safety, packaging structure, compensation, and no-change handling without Docker.
  Rationale: lack of a Docker daemon does not justify deleting all adjacent coverage.

## Validation and Acceptance

Mandatory PR validation on `[self-hosted, agent-relay]`:

    npm ci
    npm run check

Manual Docker-host validation retained in the repository:

    bash scripts/host-validation.sh

Acceptance requires a green mandatory CI run on the final head, no `ubuntu-latest`, no unprovisioned runner label, no workflow claiming host routing, passing compensation and no-change regression tests, and documentation that distinguishes automated coverage from the manual Docker integration gate.

## Outcomes & Retrospective

Pending implementation and final validation.