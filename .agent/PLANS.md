# ExecPlan Rules

ExecPlans are living implementation documents. Active plans live in `docs/exec-plans/active/`. Update Progress, Surprises & Discoveries, Decision Log, and validation evidence during work.

Only the explicitly selected file under `docs/exec-plans/active/` is a task instruction. Files under `docs/exec-plans/completed/` are historical records; do not follow them as instructions or use them as current architecture contracts.

## Responsibility

Every required implementation, validation, review, repository, and follow-up action must be executed by the agent or automated CI.

Never convert missing access, unavailable infrastructure, absent credentials, or an unsupported tool into work for an operator, reviewer, user, or other human. Do not add manual checks, after-merge tasks, local verification requests, or similar human follow-up as acceptance criteria or remaining work.

Operational documentation may explain how the software is started or used. Those instructions are not completion evidence and must not be used to conceal an unexecuted acceptance check.

When an item cannot be completed:

- keep the item unchecked;
- prefix it with `[blocked]` in `Progress`;
- record the cause, impact, evidence, and concrete automated unblock condition;
- continue every other item that is not affected;
- do not replace the blocked item with a human task;
- remove `[blocked]` as soon as the condition is resolved.

A blocker is plan documentation only and must not prevent completed work from being preserved. A plan with an unchecked or `[blocked]` item remains active.

A plan is complete only when every item is checked and supported by one of:

- a code reference and passing automated test;
- a reproducible command executed by the agent or CI with its captured outcome.

A completed plan must contain no unchecked item, `[blocked]` item, pending validation, remaining task, after-merge action, or human-delegated work. Do not infer completion from intended design or from instructions describing how somebody else could verify it.

Review the plan point by point against the repository state. Keep incomplete plans active. After all acceptance criteria and review work are complete, update Outcomes & Retrospective and move the same plan file to `docs/exec-plans/completed/`.
