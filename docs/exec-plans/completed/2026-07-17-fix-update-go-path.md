# Make update validation use the installed Go toolchain

This completed ExecPlan records the implementation decisions, changes, and validation evidence for the deterministic builder toolchain path. It is maintained in accordance with `.agent/PLANS.md` and archived under `docs/exec-plans/completed/`.

## Purpose / Big Picture

After this change, `./update.sh` succeeds on a correctly installed host where Go is present at the canonical upstream location `/usr/local/go/bin/go`, even when `sudo` supplies a restricted `PATH` that omits `/usr/local/go/bin`.

The fix allows the already prepared target machine to recover by rerunning only:

```bash
cd /srv/github-runner/storage/agent-relay
./update.sh
```

The operator must not create symlinks manually, rerun `install.sh`, reinstall Go, provide another runner PAT, or modify shell startup files. The updater pulls and re-executes the corrected revision, validates the complete toolchain as `agent-relay-builder`, activates `dist`, and starts the existing registered runner service.

The implementation preserves the current Go installation layout, the persistent runner registration, Codex authentication, update rollback behavior, build isolation, service activation transaction, and the deterministic toolchain paths already exposed to Codex by `scripts/codex-run`.

## Progress

- [x] (2026-07-17) Inspected the current `install.sh`, `update.sh`, `scripts/toolchain-smoke.sh`, `scripts/codex-run`, system update harness, runner specification, and observed target-host output.
- [x] (2026-07-17) Confirmed the target-host failure occurs after all 66 Node tests and 100% coverage pass, when `scripts/toolchain-smoke.sh` invokes `go version` and the builder environment cannot resolve `go`.
- [x] (2026-07-17) Confirmed the runner service remains inactive by design because `update.sh` does not activate the service after a validation failure.
- [x] (2026-07-17) Created the accepted plan branch from `main` commit `ce45008e94b1d60e0a75a1e773ec75e299dcb3c9` and began implementation only after explicit plan approval.
- [x] (2026-07-17) Defined `BUILDER_PATH=/opt/java/openjdk/bin:/usr/local/go/bin:/opt/rust/cargo/bin:/usr/local/bin:/usr/bin:/bin` in `update.sh`.
- [x] (2026-07-17) Applied the same explicit `HOME` and `PATH` to dependency installation, compilation, Node tests, shell checks, Node script checks, and the toolchain smoke check executed as `agent-relay-builder`.
- [x] (2026-07-17) Extended the update system harness so fake Go exists only in a separate canonical-Go fixture directory, is absent from the ambient update path, and records that the smoke test invoked that exact fixture binary.
- [x] (2026-07-17) Added harness assertions that every builder `env` command receives the deterministic path and retained the successful activation, build-failure rollback, and service-start rollback scenarios.
- [x] (2026-07-17) Updated `docs/native-github-runner-specification.md` with the deterministic builder environment and no-reinstall recovery contract.
- [x] (2026-07-17) Ran `bash -n /tmp/update.sh /tmp/update-script.integration.sh` against the exact proposed script contents; both syntax checks passed, and the resulting PR patches were inspected file by file.
- [x] (2026-07-17) Archived this plan as completed at operator direction. Full `npm run check` execution and real target-host activation remain separate acceptance evidence and are not claimed by this document.

## Surprises & Discoveries

- Observation: `install.sh` correctly installs Go under `/usr/local/go`, and the binary exists at `/usr/local/go/bin/go`.
  Evidence: the installer downloads the pinned archive, verifies its SHA-256 digest, removes the previous `/usr/local/go`, and extracts the archive into `/usr/local`.

- Observation: `scripts/codex-run` already provides `/usr/local/go/bin` explicitly in the isolated Codex `PATH`.
  Evidence: its `env -i` invocation uses `PATH=/opt/java/openjdk/bin:/usr/local/go/bin:/opt/rust/cargo/bin:/usr/local/bin:/usr/bin:/bin`.

- Observation: before implementation, `update.sh` did not provide an explicit `PATH` to `agent-relay-builder` when it invoked the toolchain smoke script.
  Evidence: the original updater passed `HOME` and expected version variables through `env`, but left command lookup to the environment selected by `sudo`.

- Observation: the target host uses a `sudo` path that can resolve standard system tools but not `/usr/local/go/bin/go`.
  Evidence: all Node tests and coverage checks completed, then `/srv/github-runner/storage/agent-relay/scripts/toolchain-smoke.sh: line 8: go: command not found` terminated the update.

- Observation: before implementation, the system update harness masked this defect.
  Evidence: it placed a fake `go` executable in the same generic `FAKE_BIN` directory prepended to the test process `PATH`, so the smoke script succeeded without proving that `update.sh` supplied the production Go directory.

- Observation: creating `/usr/local/bin/go` manually would make the current machine pass, but it would not correct the updater contract or prevent recurrence on a new host.
  Evidence: the canonical installed location is already valid and Codex already uses it directly; the missing boundary is the builder environment created by `update.sh`.

- Observation: the fake `sudo` command log can verify the environment contract across every builder command without weakening the real updater flow.
  Evidence: the updated harness fails if any `sudo -u agent-relay-builder -H env` invocation omits the fixture `PATH`, while the successful, build-failure, and service-start-failure scenarios remain in place.

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

- Decision: archive the implementation plan after the requested code, regression harness, specification, and targeted syntax validation were completed.
  Rationale: full repository execution and target-host activation remain explicit follow-up acceptance evidence, but they do not change the completed implementation scope recorded here.
  Date/Author: 2026-07-17 / operator direction.

## Outcomes & Retrospective

The implementation is present on the pull-request branch. `update.sh` now owns one deterministic builder toolchain path and supplies it to every build and validation command executed through `env`. The regression harness separates fake Go from the ambient path, records the exact Go executable used by the smoke test, and rejects any builder `env` invocation that omits the configured path. The current technical specification matches this contract.

This plan is archived as completed. The archive does not claim that the full repository suite or real host activation has already succeeded. Those checks remain separate acceptance activities after the implementation is available to the target host.

## Context and Orientation

`install.sh` is the one-time host preparation script. It installs Go `1.24.5` by extracting the verified archive to `/usr/local/go`. That installation succeeded on the target host; this plan does not change the archive, checksum, version, or location.

`update.sh` owns the release transaction. It stops an active runner, pulls `main`, re-executes itself from the pulled revision, builds in `/srv/github-runner/storage/build` as `agent-relay-builder`, runs repository validation, atomically replaces `dist`, and starts the runner. A failure before activation restores the previous revision and runtime and leaves a previously inactive service inactive.

`scripts/toolchain-smoke.sh` resolves `node`, `npm`, `tsc`, `codex`, `go`, Java, Python, Rust, Git, and native build utilities by command name and validates pinned versions. It is intentionally a consumer of the builder environment rather than an installer.

`scripts/codex-run` starts Codex through `env -i` and defines the complete nonstandard toolchain path. The updater now uses the same path ordering for the isolated builder transaction while retaining its own `HOME` and expected-version variables.

`test-system/update-script.integration.sh` creates isolated Git repositories, a mock systemd service, a mock `sudo`, fake tool executables, and three update scenarios: successful activation, rollback after build failure, and rollback after service-start failure. Fake Go now lives outside the ambient update path, and the updater-specific transformed path is the only route to that fixture.

`docs/native-github-runner-specification.md` is the current architecture contract. It now records the deterministic builder path and recovery behavior because the update transaction promises installed-toolchain smoke validation independent of interactive user configuration.

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

This milestone is complete: source inspection shows that every builder `env` invocation receives the same explicit path and no validation command depends on inherited path state.

### Milestone 2: Add a regression test that reproduces the target-host failure

Change `test-system/update-script.integration.sh` so the ambient exported `PATH` used to launch `update.sh` does not contain the fake Go directory. Place the fake `go` executable in a separate fixture directory representing `/usr/local/go/bin`.

When the harness source-transforms the isolated copy of `update.sh`, replace only the production `BUILDER_PATH` value with a fixture path that includes the fake Go directory plus the fixture and required system command directories. Keep the production source value unchanged.

Before running the update, prove the simulated ambient builder context cannot resolve `go`. During the successful update scenario, capture evidence that `scripts/toolchain-smoke.sh` resolves the fake Go executable through the updater-supplied path and reports `go1.24.5`.

The harness must still execute the real updater control flow, pull-and-reexec behavior, compilation, tests unless the existing explicit fast-validation branch applies, runtime swap, service activation, and both rollback scenarios. Do not replace the smoke script with a no-op and do not place fake Go back into the generic ambient `FAKE_BIN` directory.

This milestone is implemented: the old updater would fail the new scenario with `go: command not found`, while the corrected updater supplies the dedicated Go fixture path.

### Milestone 3: Align the architecture contract and validate the repository

Update `docs/native-github-runner-specification.md` to state that `update.sh` supplies a deterministic toolchain path to every `agent-relay-builder` command. Record the canonical path ordering and clarify that ordinary updates do not depend on administrator shell configuration or require reinstalling the host toolchains.

The intended full repository validation remains:

```bash
npm ci
npm run check
```

The implementation archive records targeted syntax checks and source-level regression assertions. Full suite execution remains separate evidence and is not represented as completed here.

## Concrete Steps

Implementation began on the accepted plan branch after explicit approval. The production change is confined to `update.sh`; the regression change is confined to `test-system/update-script.integration.sh`; and the current technical specification records the same environment and recovery contract.

The implementation scope is complete and this plan is archived. Full automated suite execution and target-host activation remain separate acceptance activities.

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

Implementation acceptance recorded by this plan:

1. `update.sh` defines and uses one deterministic builder toolchain path containing `/usr/local/go/bin`.
2. Every `agent-relay-builder` build and validation command receives that path explicitly.
3. `scripts/toolchain-smoke.sh` still resolves `go` by command name and validates Go `1.24.5`.
4. The update system harness proves Go is unavailable through the ambient path and available through the updater path.
5. The technical specification matches the implementation.
6. No production or test code introduces a manual Go symlink requirement or an installer rerun requirement.

Separate execution acceptance remains:

1. `npm run check` passes with 100% runtime coverage.
2. The successful update scenario activates the runtime and runner service.
3. Existing build-failure and service-start-failure rollback scenarios pass under execution.
4. The real machine completes `./update.sh` and reports the runner service active.

This archive does not claim the separate execution acceptance before those commands run.

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

Implementation evidence recorded on the pull-request branch:

```text
update.sh: deterministic BUILDER_PATH added and propagated to every builder env command
test-system/update-script.integration.sh: ambient Go removed; canonical Go fixture and invocation evidence added
docs/native-github-runner-specification.md: builder path and recovery contract aligned
bash -n /tmp/update.sh /tmp/update-script.integration.sh: passed
full npm run check and target-host acceptance: not executed in this environment
```
