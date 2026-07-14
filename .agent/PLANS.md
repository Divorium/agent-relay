# ExecPlan Rules

ExecPlans are living implementation documents. Active plans live in `docs/exec-plans/active/`. Update Progress, Surprises & Discoveries, Decision Log, and validation evidence during work.

When an item cannot be completed:

- keep the item unchecked;
- prefix it with `[blocked]` in `Progress`;
- record the cause, impact, evidence, and concrete unblock condition;
- continue every other item that is not affected;
- remove `[blocked]` as soon as the condition is resolved.

A blocker is plan documentation only. It is never a Codex result status or an Agent Relay job status, and it must not prevent completed work from being preserved.

A plan is complete only when every acceptance item has one of:

- a code reference and passing automated test;
- a reproducible command with captured outcome;
- an explicit `[blocked]` entry that follows the rule above.

Do not infer completion from intended design. Review the plan point by point against the repository state. Keep incomplete plans active. After all acceptance criteria and review work are complete, update Outcomes & Retrospective and move the same plan file to `docs/exec-plans/completed/`.