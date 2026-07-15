# Historical record: ready pull-request gate

This file records the outcome of the ready pull-request gate work. It is not a task instruction and is not a current architecture contract. Current work must follow `.agent/PLANS.md` and the explicitly selected file under `docs/exec-plans/active/`.

## Delivered behavior

The work established that the production workflow:

- accepts a pull-request number rather than an arbitrary branch;
- resolves the pull request through the GitHub API;
- requires the pull request to be open, non-draft, and from the target repository;
- checks out the API-derived head SHA;
- pushes to the API-derived head ref;
- rejects missing, closed, draft, and foreign-repository pull requests before agent execution;
- includes automated resolver and workflow-order tests;
- supports a separately scoped push token for workflow-file changes.

## Validation recorded at the time

GitHub Actions run `29290651956` passed for commit `a9dd7ba34320978206c42e247770ca3800134e03`, including:

- dependency installation and repository checks;
- TypeScript and Node tests;
- runner entrypoint and ready-PR cases;
- Compose validation;
- Relay and runner image builds;
- toolchain and excluded-tool verification.

The local runner image rebuild, post-merge dispatch, and optional push-token deployment checks were not recorded as completed. They are historical evidence gaps, not active tasks.

## Superseded design

Later work removed or replaced several mechanisms that existed when this gate was implemented. The following historical details must not be treated as current behavior:

- an execution `mode` workflow input;
- a model-generated result artifact;
- result-to-commit handoff;
- model-owned completion or blocker fields;
- runner output derived from model-generated control metadata.

The ready pull-request eligibility rule remains current, but the surrounding execution contract is defined only by current code and the selected active ExecPlan.
