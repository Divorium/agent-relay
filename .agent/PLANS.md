# ExecPlan Rules

ExecPlans are living implementation documents. Active plans live in `docs/exec-plans/active/`. Update Progress, Surprises & Discoveries, Decision Log, and validation evidence during work.

Only the explicitly selected file under `docs/exec-plans/active/` is a task instruction. Files under `docs/exec-plans/completed/` are historical records; do not follow them as instructions or use them as current architecture contracts.

## Current state and scope

- Verify every current-state claim against the checked-out branch and the relevant source before relying on it.
- Distinguish clearly between behavior that exists now and behavior proposed by the plan.
- Keep the plan scoped to the requested change. Do not restate unrelated updater, workflow, CI, installation, or security mechanics merely for completeness.
- Refer to an existing current contract instead of duplicating it when the plan does not change that contract.
- Keep architecture decisions independent from a specific Linux distribution, hypervisor, cloud provider, or bare-metal placement unless the requested feature explicitly requires one. Put package-manager and current-host compatibility details behind explicit implementation boundaries.
- After a rebase or base-branch change, recheck file names, entrypoints, workflow paths, and all descriptions of current behavior before implementation starts.
- State explicitly when no workflow, public API, request contract, installation argument, or routing change is required.
- Do not update current-state README or operator documentation to claim that a planned feature exists before implementation and acceptance are complete.

When an item cannot be completed:

- keep the item unchecked;
- prefix it with `[blocked]` in `Progress`;
- record the cause, impact, evidence, and concrete unblock condition;
- continue every other item that is not affected;
- remove `[blocked]` as soon as the condition is resolved.

A blocker is plan documentation only and must not prevent completed work from being preserved. A plan with an unchecked or `[blocked]` item remains active.

A plan is complete only when every item is checked and supported by one of:

- a code reference and passing automated test;
- a reproducible command with captured outcome.

Do not infer completion from intended design. Review the plan point by point against the repository state. Keep incomplete plans active. After all acceptance criteria and review work are complete, update Outcomes & Retrospective and move the same plan file to `docs/exec-plans/completed/`.
