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
4. Add `test-system/private-runtime-entrypoint.integration.sh` as a focused updater harness that executes a transformed copy of the real `update.sh`. The success scenario keeps `dist` inaccessible to the updater caller while builder compilation and validation succeed. The missing-entrypoint scenario proves that the updater exits before runtime adoption, Docker provisioning, and runner restoration.
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
- [x] Add updater-level system integration coverage for the private-directory boundary and genuine missing-entrypoint failure.
- [x] Review the implementation diff against every acceptance criterion that does not require the queued full validation.

## Surprises & Discoveries

- The compiler output path is correct: `tsconfig.runtime.json` preserves `src/run-codex.ts` as `dist/src/run-codex.js`.
- The failure was an access-control false negative, not evidence that TypeScript failed to emit the runtime.
- The updater's safety behavior after the false negative worked as designed: because `runtime_finalized` remained false, the runner stayed stopped rather than restarting against an unvalidated replacement runtime.
- The first focused system test only executed a copied validation command and therefore did not prove updater control flow. It was replaced with a harness that executes the transformed production updater and inspects its command log.
- The updater-level harness proves that successful validation is followed by adoption, Docker provisioning, and runner restoration, while a missing entrypoint reaches none of those operations.
- The production failure also prevents the self-hosted runner from executing the PR that fixes it, so full CI evidence requires one manual recovery cycle on the host.

## Decision Log

- Keep the build directory private instead of making it traversable by the administrator.
- Validate under the identity that owns and produced the build output.
- Preserve validation before root ownership adoption so the updater does not bless an unchecked runtime tree.
- Keep a dedicated focused updater harness rather than duplicating the entire broad updater integration matrix; the focused harness still executes the real transformed `update.sh` and is included in the normal `npm run check` path.
- Keep this ExecPlan active until the queued full validation completes.

## Outcomes & Retrospective

The implementation and focused regressions are present on the PR branch. Local validation passed for the TypeScript source contract, `bash -n` passed for the updater-level system test, and the focused harness passed both the successful private-runtime scenario and the genuine missing-entrypoint scenario. The latter verifies that runtime adoption, Docker provisioning, and runner restoration are not reached after validation failure. Full repository validation remains pending on the intentionally stopped self-hosted runner and must be recorded before this plan can move to `completed`.
