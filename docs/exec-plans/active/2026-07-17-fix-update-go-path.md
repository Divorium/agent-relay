# Make update validation use the installed Go toolchain

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current as work proceeds. Maintain this document in accordance with `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

## Purpose / Big Picture

After this change, `./update.sh` succeeds on a correctly installed host where Go is present at the canonical upstream location `/usr/local/go/bin/go`, even when `sudo` supplies a restricted `PATH` that omits `/usr/local/go/bin`.

The fix must allow the already prepared target machine to recover by rerunning only:

```bash
cd /srv/github-runner/storage/agent-relay
./update.sh
```

The operator must not create symlinks manually, rerun `install.sh`, reinstall Go, provide another runner PAT, or modify shell startup files. The updater must pull and re-execute the corrected revision, validate the complete toolchain as `agent-relay-builder`, activate `dist`, and start the existing registered runner service.

The implementation must preserve the current Go installation layout, the persistent runner registration, Codex authentication, update rollback behavior, build isolation, service activation transaction, and the deterministic toolchain paths already exposed to Codex by `scripts/codex-run`.

## Progress

- [x] (2026-07-17) Inspected the current `install.sh`, `update.sh`, `scripts/toolchain-smoke.sh`, `scripts/codex-run`, system update harness, runner specification, and observed target-host output.
- [x] (2026-07-17) Confirmed the target-host failure occurs after all 66 Node tests and 100% coverage pass, when `scripts/toolchain-smoke.sh` invokes `go version` and the builder environment cannot resolve `go`.
- [x] (2026-07-17) Confirmed the runner service remains inactive by design because `update.sh` does not activate the service after a validation failure.
- [x] (2026-07-17) Created this plan-only branch from `main` commit `ce45008e94b1d60e0a75a1e773ec75e299dcb3c9`; this pull request contains no production implementation.
- [ ] Define one deterministic builder toolchain `PATH` in `update.sh` that includes the installed Java, Go, Rust, local, and system binary directories.
- [ ] Apply that explicit `PATH` to every build and validation command executed as `agent-relay-builder`, rather than depending on the administrator shell or `sudo` secure-path configuration.
- [ ] Extend the system update harness so Go exists only in a fixture directory corresponding to `/usr/local/go/bin`, is absent from the ambient builder path, and is found only because the updater supplies the deterministic path.
- [ ] Preserve and rerun the successful update, build-failure rollback, and service-start rollback scenarios.
- [ ] Update the current native-runner technical specification with the deterministic builder toolchain-path contract and the recovery behavior for an already installed host.
- [ ] Run `npm run check`, record exact evidence, complete `Outcomes & Retrospective`, and move this plan to `docs/exec-plans/completed/` only after every acceptance item is supported by passing automated evidence.

## Surprises & Discoveries

- Observation: `install.sh` correctly installs Go under `/usr/local/go`, and the binary exists at `/usr/local/go/bin/go`.
  Evidence: the installer downloads the pinned archive, verifies its SHA-256 digest, removes the previous `/usr/local/go`, and extracts the archive into `/usr/local`.

- Observation: `scripts/codex-run` already provides `/usr/local/go/bin` explicitly in the isolated Codex `PATH`.
  Evidence: its `env -i` invocation uses `PATH=/opt/java/openjdk/bin:/usr/local/go/bin:/opt/rust/cargo/bin:/usr/local/bin:/usr/bin:/bin`.

- Observation: `update.sh` does not provide an explicit `PATH` to `agent-relay-builder` when it invokes the toolchain smoke script.
  Evidence: the updater passes `HOME` and expected version variables through `env`, but leaves command lookup to the environment selected by `sudo`.

- Observation: the target host uses a `sudo` path that can resolve standard system tools but not `/usr/local/go/bin/go`.
  Evidence: all Node tests and coverage checks completed, then `/srv/github-runner/storage/agent-relay/scripts/toolchain-smoke.sh: line 8: go: command not found` terminated the update.

- Observation: the current system update harness masks this defect.
  Evidence: it places a fake `go` executable in the same generic `FAKE_BIN` directory prepended to the test process `PATH`, so the smoke script succeeds without proving that `update.sh` supplies the production Go directory.

- Observation: creating `/usr/local/bin/go` manually would make the current machine pass, but it would not correct the updater contract or prevent recurrence on a new host.
  Evidence: the canonical installed location is already valid and Codex already uses it directly; the missing boundary is the builder environment created by `update.sh`.

## Decision Log

- Decision: fix the updater environment rather than changing the Go installation layout.
  Rationale: `/usr/local/go` is the official extracted distribution location and is already the path used by the Codex runtime. A second executable publication mechanism would add host state without addressing the updater's reliance on an implicit `sudo` path.
  Date/Author: 2026-07-17 / plan author.

- Decision: define one explicit builder toolchain path in `update.sh` with this production ordering:

  ```text
  /opt/java/openjdk/bin:/usr/local/go/bin:/opt/rust/cargo/bin:/usr/local/bin:/usr/bin:/bin
  ```

  Rationale: this matches the existing Codex toolchain ordering, includes every pinned nonstandard toolchain root, and makes command resolution independent of the administrator account, shell profiles, and distribution-specific `sudo` configuration.
  Date/Author: 2026-07-17 / plan author.

- Decision: pass the deterministic `PATH` to all `agent-relay-builder` build and validation commands, not only to `scripts/toolchain-smoke.sh`.
  Rationale: the builder transaction should have one reproducible toolchain environment. Limiting the fix to one command would leave `npm ci`, tests, shell validation, or future build hooks dependent on an unrelated ambient path.
  Date/Author: 2026-07-17 / plan author.

- Decision: keep `scripts/toolchain-smoke.sh` command-oriented and continue invoking `go version` rather than changing it to `/usr/local/go/bin/go version`.
  Rationale: the smoke test must validate the environment that build tools and subprocesses actually receive. Hard-coding one executable inside the smoke script would hide an invalid builder `PATH` from other consumers.
  Date/Author: 2026-07-17 / plan author.

- Decision: do not require a second `install.sh` execution on the affected machine.
  Rationale: the installed Go distribution, runner registration, service unit, service accounts, and Codex login are already present. The new updater can be obtained by the existing pull-and-reexec phase and must then complete validation using the corrected environment.
  Date/Author: 2026-07-17 / plan author.

- Decision: the implementation pull request must not start or enable the runner before all validation succeeds.
  Rationale: the observed `inactive (dead)` state is the correct transactional result of a failed update. The fix concerns tool discovery, not activation ordering or rollback semantics.
  Date/Author: 2026-07-17 / plan author.

## Outcomes & Retrospective

This plan is active and contains no implementation. The current target host has a registered runner and valid Codex authentication, but application activation is incomplete because the updater cannot resolve the installed Go binary during toolchain validation.

Completion requires automated proof that an update succeeds when ambient command lookup cannot find Go, that the explicit builder path resolves the pinned Go installation, and that all existing rollback and security boundaries remain intact. Target-host success must be recorded separately after the implementation is merged and `./update.sh` completes with the runner service active.

## Context and Orientation

`install.sh` is the one-time host preparation script. It installs Go `1.24.5` by extracting the verified archive to `/usr/local/go`. That installation succeeded on the target host; this plan does not change the archive, checksum, version, or location.

`update.sh` owns the release transaction. It stops an active runner, pulls `main`, re-executes itself from the pulled revision, builds in `/srv/github-runner/storage/build` as `agent-relay-builder`, runs repository validation, atomically replaces `dist`, and starts the runner. A failure before activation restores the previous revision and runtime and leaves a previously inactive service inactive.

`scripts/toolchain-smoke.sh` resolves `node`, `npm`, `tsc`, `codex`, `go`, Java, Python, Rust, Git, and native build utilities by command name and validates pinned versions. It is intentionally a consumer of the builder environment rather than an installer.

`scripts/codex-run` starts Codex through `env -i` and already defines the complete nonstandard toolchain path. The updater should use the same path ordering for the isolated builder transaction, while retaining its own `HOME` and expected-version variables.

`test-system/update-script.integration.sh` creates isolated Git repositories, a mock systemd service, a mock `sudo`, fake tool executables, and three update scenarios: successful activation, rollback after build failure, and rollback after service-start failure. Its current fake Go placement must be changed so the test reproduces the real host condition instead of inheriting a path that makes Go accidentally visible.

`docs/native-github-runner-specification.md` is the current architecture contract. It must describe the deterministic builder path because the update transaction promises installed-toolchain smoke validation independent of interactive user configuration.

The completed native-runner ExecPlan is historical evidence and must not be edited into a new active contract.

## Plan of Work

### Milestone 1: Make the builder environment deterministic

Add a single `BUILDER_PATH` or equivalently named constant near the other immutable update configuration in `update.sh`. Its value must be exactly the installed Java, Go, Rust, local, and system binary directories in the order recorded in the Decision Log.

For each command executed with `sudo -u "${BUILD_USER}" -H env`, include both:

```text
HOME=${BUILD_HOME}
PATH=${BUILDER_PATH}
```

Preserve the existing command identity and arguments. This applies to dependency installation, TypeScript compilation, Node tests and coverage, shell syntax validation, Node script validation, and the toolchain smoke script. Commands executed as the administrator or root, including Git pull, service operations, ownership changes, and runtime activation, remain outside this builder path contract.

Do not add shell-profile changes, `/etc/environment` changes, alternatives, wrapper scripts, or `/usr/local/bin/go` symlinks. Do not modify `scripts/codex-run` unless a test proves its existing path differs from the selected canonical ordering; the current file already contains the intended value.

This milestone is complete when source inspection shows that every builder `env` invocation receives the same explicit path and no validation command depends on inherited path state.

### Milestone 2: Add a regression test that reproduces the target-host failure

Change `test-system/update-script.integration.sh` so the ambient exported `PATH` used to launch `update.sh` does not contain the fake Go directory. Place the fake `go` executable in a separate fixture directory representing `/usr/local/go/bin`.

When the harness source-transforms the isolated copy of `update.sh`, replace only the production `BUILDER_PATH` value with a fixture path that includes the fake Go directory plus the fixture and required system command directories. Keep the production source value unchanged.

Before running the update, prove the simulated ambient builder context cannot resolve `go`. During the successful update scenario, capture evidence that `scripts/toolchain-smoke.sh` resolves the fake Go executable through the updater-supplied path and reports `go1.24.5`.

The harness must still execute the real updater control flow, pull-and-reexec behavior, compilation, tests unless the existing explicit fast-validation branch applies, runtime swap, service activation, and both rollback scenarios. Do not replace the smoke script with a no-op and do not place fake Go back into the generic ambient `FAKE_BIN` directory.

This milestone is complete when the old updater would fail the new scenario with `go: command not found`, while the corrected updater passes it.

### Milestone 3: Align the architecture contract and validate the repository

Update `docs/native-github-runner-specification.md` to state that `update.sh` supplies a deterministic toolchain path to every `agent-relay-builder` command. Record the canonical path ordering and clarify that ordinary updates do not depend on administrator shell configuration or require reinstalling the host toolchains.

Run from a clean checkout:

```bash
npm ci
npm run check
```

The final evidence must include:

- all unit and integration tests passing;
- 100% TypeScript runtime line, branch, and function coverage;
- shell and Node script syntax checks passing;
- installer system harness passing;
- update system harness passing with Go absent from the ambient path;
- successful update activation scenario passing;
- pre-activation build rollback passing;
- post-swap service-start rollback passing.

After automated validation, update `Progress`, `Surprises & Discoveries`, and `Outcomes & Retrospective`. Move this exact plan file to `docs/exec-plans/completed/` only when every item is complete and evidenced.

## Concrete Steps

Implementation is intentionally deferred until this plan is accepted.

The implementation agent should begin from the accepted plan branch or a fresh branch based on the then-current `main`, inspect the current versions of every named file, and preserve unrelated changes. The expected production edit is centered on `update.sh`; the expected regression edit is centered on `test-system/update-script.integration.sh`; the current technical specification must be updated to match the implementation.

No command should be delegated to the operator as part of repository implementation or validation.

After the implementation is merged to `main`, target-host acceptance consists of running:

```bash
cd /srv/github-runner/storage/agent-relay
./update.sh
```

Expected observable results are:

```text
Agent Relay updated successfully: <commit>
```

and:

```bash
systemctl is-enabled actions.runner.Divorium.gh-runner.service
systemctl is-active actions.runner.Divorium.gh-runner.service
```

Both commands must succeed. The runner should then appear online and idle in the `Divorium` organization. No PAT prompt, runner re-registration, Codex login, manual symlink, or `install.sh` rerun is expected.

## Validation and Acceptance

Repository acceptance requires all of the following:

1. `update.sh` defines and uses one deterministic builder toolchain path containing `/usr/local/go/bin`.
2. Every `agent-relay-builder` build and validation command receives that path explicitly.
3. `scripts/toolchain-smoke.sh` still resolves `go` by command name and validates Go `1.24.5`.
4. The update system harness proves Go is unavailable through the ambient path and available through the updater path.
5. The successful update scenario activates the runtime and runner service.
6. Existing build-failure and service-start-failure rollback scenarios remain passing.
7. `npm run check` passes with 100% runtime coverage.
8. The technical specification matches the implementation.
9. No production or test code introduces a manual Go symlink requirement or an installer rerun requirement.
10. Target-host acceptance is not claimed until the real machine completes `./update.sh` and reports the runner service active.

## Idempotence and Recovery

Adding an explicit environment variable is idempotent. Repeated updates use the same command-resolution contract and do not alter the installed Go tree.

The affected host is already in a safe recoverable state: runner registration and Codex authentication are persistent, while the runner service was not activated because validation failed. After the implementation reaches `main`, rerunning `./update.sh` pulls and re-executes the corrected updater. If validation still fails, the existing rollback path remains authoritative and no partial `dist` activation is committed.

Do not delete `/srv/github-runner/storage/runner`, `/srv/github-runner/storage/home`, or the Go installation. Do not remove and recreate the organization runner. Those actions are unrelated to the failure and would discard valid persistent state.

## Artifacts and Notes

Observed target-host evidence:

```text
66 tests passed
all files: 100.00% lines, branches, and functions
/srv/github-runner/storage/agent-relay/scripts/toolchain-smoke.sh: line 8: go: command not found
```

Observed service state after the failed transaction:

```text
Loaded: loaded
Active: inactive (dead)
```

This state is expected until a complete update transaction succeeds.