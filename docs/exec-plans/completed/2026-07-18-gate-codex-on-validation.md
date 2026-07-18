# Gate Codex execution on repository validation

This ExecPlan was maintained according to `.agent/PLANS.md` and completed on 2026-07-18.

## Purpose / Big Picture

Agent Relay previously started its Codex workflow independently from the repository CI workflow. A failing `npm run check` therefore did not prevent Codex from starting. The direct runtime also pointed at an unmanaged `/usr/local/bin/codex-run` path even though the managed launcher lived in the trusted Agent Relay source tree, and process-start failures discarded the operating-system diagnostic.

After this change, the Agent Relay workflow validates the resolved pull-request head before starting Codex, rechecks the remote PR state immediately before execution, and grants write permission only to the Codex job. The direct runtime invokes the managed launcher at `/srv/github-runner/storage/agent-relay/scripts/codex-run`, and spawn failures retain the underlying path and error such as `ENOENT`.

## Progress

- [x] Add a validation job to the Agent Relay workflow and example.
- [x] Pass the validated PR number and head SHA to the dependent Codex job.
- [x] Restrict the validation job to read-only repository permissions.
- [x] Re-resolve the PR before Codex and reject closed, draft, cross-repository, or changed-head requests.
- [x] Replace the unmanaged launcher path with the trusted repository launcher.
- [x] Preserve the operating-system spawn diagnostic.
- [x] Add regression tests for the workflow gate, permission boundary, PR revalidation, launcher path, and spawn message.
- [x] Verify that the updater invokes `node --test` and rolls back when that command fails.
- [x] Run the complete repository validation in GitHub Actions.
- [x] Record the final validation outcome and move this plan to `docs/exec-plans/completed/`.

## Surprises & Discoveries

- Observation: the complete TypeScript suite and coverage checks passed, but the update-system harness initially failed when `update.sh` recursively invoked the same tests inside a fixture with rewritten host paths.
  Evidence: nested tests observed fixture values rather than the production constants they are designed to validate.

- Observation: merely returning success for every fixture `node --test` call removed coverage of the updater's test-failure rollback path.
  Evidence: the harness now records the exact test invocation, can fail that command once, and verifies that the source checkout, activated runtime, and service state are restored.

- Observation: validating a SHA once is insufficient for a long-running two-job workflow.
  Evidence: the PR can be closed, returned to draft, or updated while `npm run check` is running, so the Codex job now performs a second API lookup with the validated SHA as an explicit expectation.

## Decision Log

- Decision: keep the standalone CI workflow and add the same validation directly to Agent Relay.
  Rationale: independent workflow runs have no job-level dependency. A `needs` relationship inside Agent Relay guarantees that Codex cannot start when validation of the same resolved SHA fails.
  Date/Author: 2026-07-18 / implementation.

- Decision: expose only the validated PR number and head SHA from `validate`, then re-resolve the PR in `codex`.
  Rationale: the second lookup enforces that the PR remains open, ready, same-repository, and unchanged before any checkout or Codex execution. The current head ref returned by that lookup is also used by the finalizer.
  Date/Author: 2026-07-18 / implementation.

- Decision: make workflow-level permissions read-only and grant `contents: write` only to `codex`.
  Rationale: validation executes PR-controlled dependency and test commands on a self-hosted runner and does not require repository write access.
  Date/Author: 2026-07-18 / implementation.

- Decision: invoke the launcher directly from the trusted Agent Relay source root.
  Rationale: `install.sh` and `update.sh` already validate and secure that script. No managed `/usr/local/bin/codex-run` entrypoint exists.
  Date/Author: 2026-07-18 / implementation.

- Decision: mock the nested fixture `node --test` command while recording its arguments and supporting a one-shot failure.
  Rationale: the outer `npm run check` executes the real test suite. The system harness must verify updater orchestration against rewritten fixture paths, including that tests are invoked and a test failure triggers rollback, without rerunning path-sensitive unit contracts inside the fixture.
  Date/Author: 2026-07-18 / implementation.

## Outcomes & Retrospective

The Agent Relay workflow now contains a same-SHA validation gate, a second remote-state check before Codex, and a least-privilege token boundary between validation and mutation. The runtime invokes the managed launcher instead of a nonexistent installation path, and startup failures include the original operating-system diagnostic.

GitHub Actions `CI #628` completed successfully on commit `1896ea79422a4d79c10be24f303c5f22ce8dc9ea`. It ran dependency installation and the complete `npm run check`, including the updater test-invocation and test-failure rollback scenarios.

## Validation and Acceptance

All acceptance criteria were met:

- `npm run check` passed in CI;
- the Agent Relay workflow contains a `validate` job and `codex` declares `needs: validate`;
- failed validation skips the Codex job;
- `validate` has read-only permissions and only `codex` receives `contents: write`;
- the PR is re-resolved before Codex and a changed head SHA is rejected;
- the current revalidated head SHA is used for Codex checkout and plan resolution;
- the finalizer targets the branch returned by the revalidation lookup;
- the updater harness proves that `node --test` is invoked and that a failure rolls back the update;
- the default direct command is `/srv/github-runner/storage/agent-relay/scripts/codex-run`;
- a missing command reports the underlying spawn path and `ENOENT` rather than only a generic failure.
