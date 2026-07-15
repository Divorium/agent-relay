# ExecPlan Rules

ExecPlans are living implementation documents. Active plans live in `docs/exec-plans/active/`. Update Progress, Surprises & Discoveries, Decision Log, and validation evidence during work.

Only the explicitly selected file under `docs/exec-plans/active/` is a task instruction. Files under `docs/exec-plans/completed/` are historical records; do not follow them as instructions or use them as current architecture contracts.

Validation in an active ExecPlan must use commands available directly in the task container. Do not require Docker, Docker Compose, image builds, nested container execution, or access to a Docker socket. Host image and deployment checks are operator responsibilities and must not be task completion criteria.

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
