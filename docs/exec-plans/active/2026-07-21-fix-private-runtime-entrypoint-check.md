# Validate the compiled runtime through the builder identity

## Purpose

`update.sh` currently creates `${SOURCE_ROOT}/dist` as `agent-relay-builder` with mode `0700`, compiles the runtime as that account, and then checks for `dist/src/run-codex.js` as the administrator running `update.sh`. The administrator cannot traverse a private builder-owned directory, so the shell test reports that the entrypoint is missing even when TypeScript emitted it successfully. The updater then leaves the GitHub runner stopped because runtime finalization did not complete.

Fix the ownership-boundary error without weakening the private build directory. A valid compiled runtime must continue to finalization and Docker provisioning, while a genuinely missing entrypoint must still fail safely and leave the runner stopped.

## Current State

- `update.sh` removes the previous build and runtime directories.
- It creates `${BUILD_ROOT}` and `${SOURCE_ROOT}/dist` as `${BUILD_USER}` with mode `0700`.
- It invokes TypeScript as `${BUILD_USER}` and emits the production runtime into `${SOURCE_ROOT}/dist`.
- Immediately after compilation, the administrator process evaluates `[[ -f "${SOURCE_ROOT}/dist/src/run-codex.js" ]]`.
- Because the administrator is not `${BUILD_USER}`, that check cannot traverse the `0700` directory and returns false.
- The failure path prints `Compiled runtime entrypoint is missing; the runner remains stopped`, keeps `runtime_finalized=0`, and intentionally does not restart the runner.
- A production update on `codex-gh-runner` reproduced this exact failure after a successful fast-forward to `main`.
- The existing runtime-build CI check compiles and inspects the output as one user, so it does not exercise this ownership boundary.

## Scope and Decisions

- Preserve `${SOURCE_ROOT}/dist` as a builder-owned private `0700` directory during compilation.
- Validate the compiled entrypoint under `${BUILD_USER}` before changing ownership or permissions.
- Use a noninteractive, absolute-path command suitable for the updater's trusted-command model. The expected implementation is equivalent to `sudo -n -u "${BUILD_USER}" /usr/bin/test -f "${SOURCE_ROOT}/dist/src/run-codex.js"`.
- Keep the existing failure message and safe behavior when the entrypoint is genuinely absent.
- Keep root adoption and normalization of the compiled tree after successful validation.
- Add a regression test that would fail with the administrator-side `[[ -f ... ]]` check and pass only when validation occurs through the builder identity.
- Do not solve the problem by broadening `dist` permissions before validation.
- Do not manually start the runner from the updater's failed pre-finalization state. A corrected rerun of `update.sh` remains the recovery path.
- No workflow, public API, request contract, installation argument, routing, Docker-host contract, or Codex execution contract change is required.

## Implementation

1. Update the compiled-entrypoint validation in `update.sh` so it runs through `${BUILD_USER}` while the output directory is still private.
2. Preserve ordering: compile as builder, validate as builder, adopt the runtime tree as `root:root`, normalize directory and file modes, then set `runtime_finalized=1`.
3. Extend `test/update-regression.test.ts` to require builder-context validation and to reject the administrator-side shell-file test.
4. Strengthen `test-system/update-script.integration.sh` so its successful scenario models a runtime directory that is inaccessible to the updater caller but accessible through the mocked builder execution boundary. The old implementation must fail this scenario; the corrected implementation must pass.
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

- [ ] Replace administrator-side entrypoint inspection with builder-context validation.
- [ ] Add focused source-contract regression coverage.
- [ ] Add or strengthen system integration coverage for the private-directory boundary.
- [ ] Run `npm run check` and record the result.
- [ ] Review the final diff against every acceptance criterion.

## Surprises & Discoveries

- The compiler output path is correct: `tsconfig.runtime.json` preserves `src/run-codex.ts` as `dist/src/run-codex.js`.
- The failure is an access-control false negative, not evidence that TypeScript failed to emit the runtime.
- The updater's safety behavior after the false negative is working as designed: because `runtime_finalized` remains false, the runner stays stopped rather than restarting against an unvalidated replacement runtime.

## Decision Log

- Keep the build directory private instead of making it traversable by the administrator.
- Validate under the identity that owns and produced the build output.
- Preserve validation before root ownership adoption so the updater does not bless an unchecked runtime tree.
- Require integration coverage of the identity boundary because the existing same-user runtime compilation test cannot detect this regression.

## Outcomes & Retrospective

Pending implementation and validation.
