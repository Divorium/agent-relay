# Validate the compiled runtime through the builder identity

## Purpose

Before this PR, `update.sh` created `${SOURCE_ROOT}/dist` as `agent-relay-builder` with mode `0700`, compiled the runtime as that account, and then checked for `dist/src/run-codex.js` as the administrator running `update.sh`. The administrator could not traverse a private builder-owned directory, so the shell test reported that the entrypoint was missing even when TypeScript emitted it successfully. The updater then left the GitHub runner stopped because runtime finalization did not complete.

This change fixes the ownership-boundary error without weakening the private build directory. A valid compiled runtime continues to finalization and Docker provisioning, while a genuinely missing entrypoint still fails safely and leaves the runner stopped.

## Current State

- `update.sh` removes the previous build and runtime directories.
- It creates `${BUILD_ROOT}` and `${SOURCE_ROOT}/dist` as `${BUILD_USER}` with mode `0700`.
- It invokes TypeScript as `${BUILD_USER}` and emits the production runtime into `${SOURCE_ROOT}/dist`.
- Immediately after compilation, it validates `dist/src/run-codex.js` through `sudo -n -u "${BUILD_USER}" /usr/bin/test -f` while the directory remains private.
- Only after successful validation does it adopt the runtime tree as `root:root`, normalize directory and file modes, and set `runtime_finalized=1`.
- If the entrypoint is genuinely absent, the existing failure message is emitted, `runtime_finalized` remains false, and the runner remains stopped.
- A production update on `codex-gh-runner` reproduced the original false-negative failure after a successful fast-forward to `main`.
- The existing runtime-build CI check compiles and inspects the output as one user, so focused regression coverage was added for the ownership boundary.

## Scope and Decisions

- Preserve `${SOURCE_ROOT}/dist` as a builder-owned private `0700` directory during compilation.
- Validate the compiled entrypoint under `${BUILD_USER}` before changing ownership or permissions.
- Use a noninteractive, absolute-path command suitable for the updater's trusted-command model: `sudo -n -u "${BUILD_USER}" /usr/bin/test -f "${SOURCE_ROOT}/dist/src/run-codex.js"`.
- Keep the existing failure message and safe behavior when the entrypoint is genuinely absent.
- Keep root adoption and normalization of the compiled tree after successful validation.
- Add regression coverage that fails with the administrator-side `[[ -f ... ]]` check and passes only when validation occurs through the builder identity.
- Do not solve the problem by broadening `dist` permissions before validation.
- Do not manually start the runner from the updater's failed pre-finalization state. A corrected rerun of `update.sh` remains the recovery path.
- No workflow, public API, request contract, installation argument, routing, Docker-host contract, or Codex execution contract change is required.

## Implementation

1. Update the compiled-entrypoint validation in `update.sh` so it runs through `${BUILD_USER}` while the output directory is still private.
2. Preserve ordering: compile as builder, validate as builder, adopt the runtime tree as `root:root`, normalize directory and file modes, then set `runtime_finalized=1`.
3. Add `test/private-runtime-entrypoint.test.ts` to require builder-context validation, reject the administrator-side shell-file test, and verify sequencing through finalization.
4. Add `test-system/private-runtime-entrypoint.integration.sh` to model an entrypoint inaccessible to the updater caller but accessible through the mocked builder boundary; cover both an existing and a genuinely missing entrypoint, and wire the script into `check:shell` and `check:system`.
5. Run the full repository validation and review the final diff for any permission weakening or altered failure semantics.

## Acceptance Criteria

- A successful TypeScript build containing `dist/src/run-codex.js` is recognized while `dist` remains builder-owned and mode `0700`.
- `update.sh` no longer emits a false `Compiled runtime entrypoint is missing` error solely because the administrator cannot traverse the builder directory.
- A genuinely missing `dist/src/run-codex.js` still stops the update before runtime adoption and keeps the runner stopped.
- The runtime tree is adopted as `root:root` and normalized only after entrypoint validation succeeds.
- Tests prove that validation is executed as `${BUILD_USER}`, occurs between compilation and adoption, and does not rely on widening the private build directory.
- `npm run check` passes.
- Independent review finds no regression in updater failure handling, runner restoration, or Docker provisioning sequencing.

## Progress

- [x] Replace administrator-side entrypoint inspection with builder-context validation.
- [x] Add focused source-contract regression coverage.
- [x] Add system integration coverage for the private-directory boundary and genuine missing-entrypoint failure.
- [x] Review the implementation diff against every acceptance criterion that does not require the queued full validation.

## Surprises & Discoveries

- The compiler output path is correct: `tsconfig.runtime.json` preserves `src/run-codex.ts` as `dist/src/run-codex.js`.
- The failure was an access-control false negative, not evidence that TypeScript failed to emit the runtime.
- The updater's safety behavior after the false negative worked as designed: because `runtime_finalized` remained false, the runner stayed stopped rather than restarting against an unvalidated replacement runtime.
- A focused system test can reproduce the identity boundary without weakening production code: ordinary access is denied, the mocked builder check succeeds for the compiled file, permissions remain private, and the same builder check fails when the file is removed.
- The production failure also prevents the self-hosted runner from executing the PR that fixes it, so full CI evidence requires one manual recovery cycle on the host.

## Decision Log

- Keep the build directory private instead of making it traversable by the administrator.
- Validate under the identity that owns and produced the build output.
- Preserve validation before root ownership adoption so the updater does not bless an unchecked runtime tree.
- Use dedicated focused contract and system tests rather than expanding the already large updater integration harness; both tests are included in the normal `npm run check` path.
- Keep this ExecPlan active until the queued full validation completes.

## Outcomes & Retrospective

The implementation and focused regressions are present on the PR branch. Local validation passed for the new TypeScript contract under TypeScript 5.8.3, `bash -n` passed for the new system test, and the focused private-directory integration scenario passed for both present and missing entrypoints. Full repository validation remains pending on the intentionally stopped self-hosted runner and must be recorded before this plan can move to `completed`.
