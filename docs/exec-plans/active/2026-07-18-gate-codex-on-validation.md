# Gate Codex execution on repository validation

This ExecPlan is a living document. Maintain it according to `.agent/PLANS.md` while implementation proceeds.

## Purpose / Big Picture

Agent Relay currently starts its Codex workflow independently from the repository CI workflow. A failing `npm run check` therefore does not prevent Codex from starting. The direct runtime also points at an unmanaged `/usr/local/bin/codex-run` path even though the managed launcher lives in the trusted Agent Relay source tree, and process-start failures discard the operating-system diagnostic.

After this change, the Agent Relay workflow validates the exact resolved pull-request head before starting Codex. The direct runtime invokes the managed launcher at `/srv/github-runner/storage/agent-relay/scripts/codex-run`, and spawn failures retain the underlying path and error such as `ENOENT`.

## Progress

- [x] Add a validation job to the Agent Relay workflow and example.
- [x] Pass the validated head SHA and branch to the dependent Codex job.
- [x] Replace the unmanaged launcher path with the trusted repository launcher.
- [x] Preserve the operating-system spawn diagnostic.
- [x] Add regression tests for the workflow gate, launcher path, and spawn message.
- [ ] Run the complete repository validation in GitHub Actions.
- [ ] Record the final validation outcome and move this plan to `docs/exec-plans/completed/`.

## Decision Log

- Decision: keep the standalone CI workflow and add the same validation directly to Agent Relay.
  Rationale: GitHub Actions does not provide an intrinsic dependency between independent workflow runs. A job-level `needs` relationship inside Agent Relay guarantees that Codex cannot start when validation of the same resolved SHA fails.
  Date/Author: 2026-07-18 / implementation.

- Decision: resolve the pull request and validate its exact head in the `validate` job, then expose `head_sha` and `head_ref` as job outputs.
  Rationale: this works for both `ready_for_review` and manual `workflow_dispatch` runs and avoids validating a different checkout from the one Codex later executes.
  Date/Author: 2026-07-18 / implementation.

- Decision: invoke the launcher directly from the trusted Agent Relay source root.
  Rationale: `install.sh` and `update.sh` already validate and secure that script. No managed `/usr/local/bin/codex-run` entrypoint exists.
  Date/Author: 2026-07-18 / implementation.

## Validation and Acceptance

The implementation is accepted when:

- `npm run check` passes;
- the Agent Relay workflow contains a `validate` job and `codex` declares `needs: validate`;
- a failed validation skips the Codex job;
- the validated head SHA is reused for the Codex checkout and plan resolution;
- the finalizer targets the branch returned for that same validated pull request;
- the default direct command is `/srv/github-runner/storage/agent-relay/scripts/codex-run`;
- a missing command reports the underlying spawn path and `ENOENT` rather than only a generic failure.
