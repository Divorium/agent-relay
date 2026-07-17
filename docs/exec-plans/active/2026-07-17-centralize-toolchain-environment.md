# Centralize the installed toolchain environment

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current as implementation proceeds. Maintain this document in accordance with `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

## Purpose / Big Picture

After this change, every host-installed development toolchain used by Agent Relay is discovered and configured through one trusted environment contract rather than through independent `PATH` fragments and ad hoc variables in `install.sh`, `update.sh`, and `scripts/codex-run`.

The immediate failure is Rust-specific: `rustc` resolves to the rustup shim under `/opt/rust/cargo/bin`, but the builder process does not receive `RUSTUP_HOME=/opt/rust/rustup`, so rustup reports that no default toolchain is configured. The underlying defect is broader. Java needs `JAVA_HOME`; Rust needs `RUSTUP_HOME` and a writable `CARGO_HOME`; Go, Gradle, npm, pip, XDG consumers, and temporary-file users need writable state directories; executable lookup needs the canonical toolchain `PATH`. Adding one variable for every newly exposed failure would preserve duplication and allow installer, updater, tests, and runtime to drift again.

The implementation must introduce one declarative and trusted toolchain profile that defines immutable installation roots and one reusable environment builder that combines those roots with caller-specific writable state. The installer, update builder transaction, Codex runtime, smoke validation, and tests must consume that same contract.

The already prepared host must recover after merge by running only:

```bash
cd /srv/github-runner/storage/agent-relay
./update.sh
```

The operator must not rerun `install.sh`, reinstall Rust or Java, run `rustup default`, create additional symlinks, edit shell profiles, provide the runner PAT again, or reauthenticate Codex.

## Progress

- [x] (2026-07-17) Confirmed all 66 Node tests and 100% TypeScript coverage pass after the deterministic builder `PATH` fix.
- [x] (2026-07-17) Confirmed toolchain validation now reaches Rust and fails because the rustup shim cannot find a configured default toolchain.
- [x] (2026-07-17) Inspected `install.sh`, `update.sh`, `scripts/codex-run`, `scripts/toolchain-smoke.sh`, the installer and updater system harnesses, and the installer contract tests.
- [x] (2026-07-17) Confirmed the installer places Rust shims below `/opt/rust/cargo/bin` and rustup state below `/opt/rust/rustup`.
- [x] (2026-07-17) Confirmed `scripts/codex-run` already supplies `JAVA_HOME`, `RUSTUP_HOME`, toolchain `PATH`, and isolated writable caches, while `update.sh` supplies only `HOME` and `PATH`.
- [x] (2026-07-17) Selected a shared environment-profile design instead of another tool-specific patch.
- [x] (2026-07-17) Created this plan-only branch from current `main` after PR #23; no production or test implementation is included.
- [ ] Introduce one trusted shell library containing immutable toolchain roots and a reusable function that constructs a clean execution environment from a target identity, home, and writable state root.
- [ ] Make `install.sh`, `update.sh`, and `scripts/codex-run` consume the shared contract without weakening source ownership or symlink protections.
- [ ] Extend smoke validation to prove both executable versions and the required environment bindings.
- [ ] Replace permissive fake toolchains with stateful fixtures that fail when Java, Rust, Go, or writable state is misconfigured.
- [ ] Update contract tests and the native-runner specification so duplicated hard-coded toolchain environments cannot silently return.
- [ ] Run `npm ci`, `npm run check`, and target-host `./update.sh`; record exact evidence and move this plan to `completed` only after all acceptance items pass.

## Surprises & Discoveries

- Observation: executable discovery and toolchain configuration are separate contracts.
  Evidence: `PATH` now finds `/opt/rust/cargo/bin/rustc`, but the executable is a rustup shim and still requires `RUSTUP_HOME=/opt/rust/rustup` to select the installed default toolchain.

- Observation: the installer already creates a valid shared Rust installation.
  Evidence: it runs rustup with `CARGO_HOME=/opt/rust/cargo`, `RUSTUP_HOME=/opt/rust/rustup`, `--default-toolchain stable`, and then publishes the shims through `/usr/local/bin`.

- Observation: `scripts/codex-run` contains the most complete current environment model.
  Evidence: its `env -i` block supplies identity and locale variables, `JAVA_HOME`, `RUSTUP_HOME`, a canonical `PATH`, isolated Cargo, Go, Gradle, npm, pip, XDG, and temporary directories, plus Git-specific restrictions.

- Observation: `update.sh` duplicates only part of that model.
  Evidence: every builder command receives `HOME` and `PATH`, but not `JAVA_HOME`, `RUSTUP_HOME`, or explicit writable toolchain state.

- Observation: Java did not fail first because `java` can execute from `PATH` without `JAVA_HOME` for the current smoke command.
  Evidence: build systems and child tools may still require `JAVA_HOME`; a successful `java -version` is not proof that the Java environment contract is complete.

- Observation: the existing updater system fixture validates `PATH` but cannot detect missing toolchain homes.
  Evidence: fake `rustc`, `cargo`, and Java commands return successful version strings without checking environment variables or state roots.

- Observation: adding `RUSTUP_HOME` only to the smoke command would be insufficient.
  Evidence: compilation hooks, npm lifecycle scripts, tests, and future project commands executed as the builder may invoke the same host toolchains before the smoke step.

## Decision Log

- Decision: create one repository-owned shell library, provisionally `scripts/toolchain-environment.sh`, as the single source of truth for immutable toolchain locations and environment construction.
  Rationale: a shared library removes duplicated path literals, can be consumed by the installer, updater, and runtime, remains versioned with the application, and can be protected by the existing regular-file, ownership, and non-symlink rules.
  Date/Author: 2026-07-17 / plan author.

- Decision: keep immutable installation roots separate from writable execution state.
  Rationale: `/opt/java/openjdk`, `/usr/local/go`, `/opt/rust/cargo/bin`, and `/opt/rust/rustup` are host-managed shared installations; Cargo cache, Go workspace/cache, Gradle, npm, pip, XDG, and temporary directories must remain writable by the current builder or runner execution and must not be written into shared installation roots.
  Date/Author: 2026-07-17 / plan author.

- Decision: the shared library must define at least these immutable values:

  ```text
  TOOLCHAIN_JAVA_HOME=/opt/java/openjdk
  TOOLCHAIN_GO_ROOT=/usr/local/go
  TOOLCHAIN_RUST_BIN=/opt/rust/cargo/bin
  TOOLCHAIN_RUSTUP_HOME=/opt/rust/rustup
  TOOLCHAIN_PATH=/opt/java/openjdk/bin:/usr/local/go/bin:/opt/rust/cargo/bin:/usr/local/bin:/usr/bin:/bin
  ```

  Rationale: these are the actual installation paths currently created by `install.sh` and consumed by `scripts/codex-run`.
  Date/Author: 2026-07-17 / plan author.

- Decision: the shared library must expose a Bash function that builds an environment array for a supplied target user, home directory, and writable state root; callers will execute through `/usr/bin/env -i`.
  Rationale: an array avoids shell-string evaluation, preserves argument boundaries, gives tests one observable contract, and prevents administrator profiles, `sudo` secure-path settings, or unrelated ambient variables from changing tool resolution.
  Date/Author: 2026-07-17 / plan author.

- Decision: the common environment must include identity and locale values, immutable toolchain roots, canonical `PATH`, and explicit writable state locations for Cargo, Go, Gradle, npm, pip, XDG, and temporary files.
  Rationale: this addresses the class of failures rather than only the current rustup symptom.
  Date/Author: 2026-07-17 / plan author.

- Decision: caller-specific security variables remain caller-owned.
  Rationale: `scripts/codex-run` must retain its Codex-specific runtime root, Git restrictions, and permission profile; `update.sh` must retain build-specific expected-version variables and transaction logic. The shared library supplies toolchain environment, not application policy.
  Date/Author: 2026-07-17 / plan author.

- Decision: `install.sh` must consume the immutable roots from the shared profile when installing or validating Java, Go, and Rust.
  Rationale: installation and execution must not carry separate copies of the same path contract.
  Date/Author: 2026-07-17 / plan author.

- Decision: every file that is sourced or executed to establish the environment must be a direct regular non-symlink file, owned and protected consistently with the existing trusted entrypoints.
  Rationale: centralizing environment setup must not create a new mutable code-injection path for the runner or builder accounts.
  Date/Author: 2026-07-17 / plan author.

- Decision: do not introduce `/etc/profile`, shell startup files, global user defaults, `rustup default` repair commands, or duplicate per-user toolchain installations.
  Rationale: Agent Relay requires a deterministic noninteractive environment independent of login shells and user dotfiles.
  Date/Author: 2026-07-17 / plan author.

## Outcomes & Retrospective

This plan is active and contains no implementation. The current host has valid installed Node, TypeScript, Codex, Go, Java, Python, and Rust assets. The update fails because builder execution does not receive the complete configuration required by the shared Rust installation.

The intended outcome is broader than making `rustc --version` pass. There must be one authoritative host-toolchain environment, one reusable construction path, explicit writable state boundaries, and tests that fail whenever a stateful tool is executable but not actually usable in its execution context.

## Context and Orientation

`install.sh` prepares the host and installs toolchains. It currently hard-codes installation roots directly. Java is exposed through `/opt/java/openjdk`, Go through `/usr/local/go`, and Rust through `/opt/rust/cargo` plus `/opt/rust/rustup`.

`update.sh` owns the build and activation transaction. It executes dependency installation, TypeScript compilation, Node tests, syntax checks, and toolchain smoke validation as `agent-relay-builder`. It now supplies a deterministic `PATH`, but it does not construct a complete isolated toolchain environment.

`scripts/codex-run` owns the runtime environment for Codex-launched work. It already creates a private runtime state tree and executes Codex through `env -i` with the most complete environment currently present in the repository. Its hard-coded immutable roots duplicate values in the installer and updater.

`scripts/toolchain-smoke.sh` validates command availability and selected versions. It currently invokes tools but does not verify that `JAVA_HOME`, `RUSTUP_HOME`, writable caches, and state roots match the managed installation contract.

`test/installer.test.ts` checks literal source structure. It has already demonstrated that exact command-string assertions can become stale when the environment contract evolves. The implementation should prefer checking one shared profile and one invocation primitive over duplicating full command strings for every call site.

`test-system/install-script.integration.sh` removes the real tool-installation block from the transformed installer, so it currently does not prove that installer path constants and execution profile stay aligned.

`test-system/update-script.integration.sh` simulates the update transaction. It now proves Go is absent from the ambient path and found through the updater path, but its fake Rust and Java commands do not validate their required environment.

`docs/native-github-runner-specification.md` is the current technical contract and must be updated to describe the shared immutable profile and per-execution state model.

## Plan of Work

### Milestone 1: Define one trusted toolchain profile

Add `scripts/toolchain-environment.sh` as a shell library with no side effects when sourced. It must:

- define the immutable Java, Go, Rust, and canonical `PATH` values listed in the Decision Log;
- expose one function, with a precise documented interface, that receives a target username, home directory, and writable state root;
- validate that all three inputs are absolute, nonempty, and structurally safe;
- create or return an ordered Bash array of `KEY=value` arguments suitable for `/usr/bin/env -i`;
- include `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LC_ALL`, `JAVA_HOME`, `RUSTUP_HOME`, and `PATH`;
- bind writable `CARGO_HOME`, `GOPATH`, `GOCACHE`, `GRADLE_USER_HOME`, `NPM_CONFIG_CACHE`, `PIP_CACHE_DIR`, `XDG_CACHE_HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `TMPDIR`, `TMP`, and `TEMP` below the supplied state root;
- never create directories itself and never execute the requested command.

The exact function name and array name may change during implementation, but there must be one implementation of the mapping and no eval-based API.

Update trusted-source validation so this library must be a direct regular non-symlink file and is made readable but not writable by the builder and runner accounts.

This milestone is complete when source inspection shows one immutable profile and no second canonical `PATH`, `JAVA_HOME`, or `RUSTUP_HOME` definition in installer, updater, or Codex runtime code.

### Milestone 2: Make installation and execution consume the profile

Modify `install.sh` to validate and source the shared library before using its values in privileged installation steps. Replace direct installation-path literals where the shared profile is authoritative. Preserve version pins, checksums, archive verification, and current host layout.

Modify `update.sh` to:

- validate and source the shared library after pull-and-reexec from the selected revision;
- create one private builder state root below `/srv/github-runner/storage/build` or `/srv/github-runner/storage/build-home` with ownership `agent-relay-builder` and mode `0700`;
- create the required state subdirectories before invoking builder commands;
- construct the common environment once for the builder identity;
- execute every builder-owned dependency, compilation, test, syntax, and smoke command through `sudo -u agent-relay-builder -H /usr/bin/env -i` plus the shared environment array;
- add only command-specific expected-version variables at the smoke call site;
- preserve stop, pull, reexec, rollback, dist swap, and service activation order.

Modify `scripts/codex-run` to source the same library and replace its duplicated common environment assignments with the shared array. Keep its per-run state root, Codex authentication check, Git restrictions, signals, cleanup, and Codex command unchanged.

This milestone is complete when installer, builder, and runtime use the same immutable roots while retaining separate writable state and application-specific policy.

### Milestone 3: Make smoke validation test usability, not only lookup

Extend `scripts/toolchain-smoke.sh` so it validates:

- `JAVA_HOME` equals the managed Java root and `${JAVA_HOME}/bin/java` is the same executable family used for the version check;
- `RUSTUP_HOME` equals the managed shared rustup root;
- `CARGO_HOME`, `GOPATH`, `GOCACHE`, Gradle, npm, pip, XDG, and temporary directories are present, writable, and below the supplied execution state root;
- the canonical `PATH` ordering still resolves managed Java, Go, and Rust before generic system locations;
- Rust commands can select the installed default toolchain without modifying shared state;
- existing Node, TypeScript, Codex, Go, Java, Python, Git, compiler, archive, and permission-profile checks remain intact.

Pass the expected state root and immutable profile values explicitly where needed rather than teaching the smoke script to infer caller-specific paths from unrelated variables.

This milestone is complete when a found executable with missing configuration fails with a targeted environment error before activation.

### Milestone 4: Add regression fixtures for stateful toolchains

Update `test-system/update-script.integration.sh` so fake toolchains model configuration requirements:

- fake Rust shims must fail unless `RUSTUP_HOME` equals the transformed shared rustup fixture and writable `CARGO_HOME` is below the builder state root;
- fake Java or a Java-dependent probe must fail unless `JAVA_HOME` equals the transformed managed Java fixture;
- fake Go must continue proving it is absent from ambient `PATH`, and must additionally verify writable `GOPATH` and `GOCACHE` bindings;
- npm, pip, Gradle, XDG, and temporary paths must be recorded and checked as writable builder-owned locations;
- every builder command must be logged and rejected if it bypasses `/usr/bin/env -i` or omits the common environment contract;
- successful activation, pre-swap build rollback, and post-swap service-start rollback must remain covered.

Transform the shared profile in the fixture, not duplicated literals inside `update.sh`. The old implementation must fail the new Rust fixture with the observed no-default-toolchain behavior or an equivalent missing-environment error.

Update `test-system/install-script.integration.sh` to prove the installer recognizes the shared library as a trusted source and that transformed installation roots originate from that profile.

Update `test/installer.test.ts` and relevant runtime tests to assert:

- there is one shared profile file;
- all three consumers validate and source it;
- canonical immutable variables are not redefined independently;
- builder and Codex runtime both use the shared environment constructor;
- existing privilege, path, rollback, filesystem, and legacy-removal assertions remain.

This milestone is complete when tests detect both missing executables and executable-but-unconfigured toolchains.

### Milestone 5: Align documentation and validate the real recovery path

Update `docs/native-github-runner-specification.md` to distinguish:

- root-managed immutable installations;
- one repository-owned environment profile;
- isolated writable state owned by the current builder or runtime execution;
- caller-specific security and application variables;
- recovery by ordinary `./update.sh` without installer rerun.

Run from a clean checkout:

```bash
npm ci
npm run check
```

Required evidence includes:

- all unit and integration tests passing;
- 100% TypeScript line, branch, and function coverage;
- shell and Node syntax validation passing;
- installer system harness passing;
- updater system harness passing with stateful Java, Go, and Rust fixtures;
- successful activation and both rollback scenarios passing;
- no duplicated canonical toolchain root definitions outside the shared profile and tests that intentionally reference expected values.

After merge, run on the prepared target host:

```bash
cd /srv/github-runner/storage/agent-relay
./update.sh
systemctl is-enabled actions.runner.Divorium.gh-runner.service
systemctl is-active actions.runner.Divorium.gh-runner.service
```

Record the complete toolchain-smoke output and active service result. Only then update `Outcomes & Retrospective` and move this plan to `docs/exec-plans/completed/`.

## Concrete Steps

Implementation is intentionally deferred until this plan is explicitly accepted.

The implementation agent should begin from this accepted plan branch or a fresh branch based on the then-current `main`, inspect current versions of all named files, and preserve unrelated changes. Expected implementation scope includes:

```text
scripts/toolchain-environment.sh
install.sh
update.sh
scripts/codex-run
scripts/toolchain-smoke.sh
test/installer.test.ts
relevant codex-run/toolchain tests
test-system/install-script.integration.sh
test-system/update-script.integration.sh
docs/native-github-runner-specification.md
this ExecPlan
```

No host repair command should be delegated to the operator as a substitute for repository implementation.

## Validation and Acceptance

Repository acceptance requires all of the following:

1. One trusted shared library is the sole source of immutable toolchain roots and canonical `PATH`.
2. Installer, update builder, and Codex runtime consume that shared contract.
3. Builder and runtime commands execute with a clean environment and explicit identity, locale, immutable toolchain configuration, and writable state directories.
4. Java receives the managed `JAVA_HOME`; Rust receives the managed `RUSTUP_HOME`; Cargo, Go, Gradle, npm, pip, XDG, and temporary state remain writable and isolated.
5. The shared profile is protected by direct-file, non-symlink, ownership, and permission validation.
6. Toolchain smoke validates configuration and usability, not only command lookup and version strings.
7. System fixtures fail when a stateful toolchain is executable but misconfigured.
8. Existing update activation and rollback semantics remain passing.
9. `npm run check` passes with 100% TypeScript runtime coverage.
10. The technical specification matches the implementation.
11. The prepared host completes `./update.sh` without `install.sh`, `rustup default`, PAT input, re-registration, manual symlinks, or shell-profile changes.
12. The runner service is enabled and active after target-host acceptance.

## Idempotence and Recovery

The shared environment profile is declarative. Repeated updates construct the same immutable bindings and fresh writable state without modifying shared installations.

The existing host already contains `/opt/java/openjdk`, `/usr/local/go`, `/opt/rust/cargo`, and `/opt/rust/rustup`. The new updater must consume these paths directly. It must not treat the current rustup error as evidence that Rust needs reinstalling.

A failure before runtime activation remains subject to the existing update rollback transaction. Builder state created for a failed attempt may be removed by cleanup, while shared installations, runner registration, Codex authentication, and the previously active runtime remain untouched.

## Artifacts and Notes

Observed successful validation before the Rust failure:

```text
66 tests passed
all files: 100.00% lines, branches, and functions
Node.js v22.23.1
npm 10.9.8
TypeScript 5.8.3
codex-cli 0.144.4
Go 1.24.5
OpenJDK 21.0.11
Python 3.13.5
pip 25.1.1
```

Observed failure:

```text
error: rustup could not choose a version of rustc to run, because one wasn't specified explicitly, and no default is configured.
help: run 'rustup default stable' to download the latest stable release of Rust and set it as your default toolchain.
```

The suggested `rustup default stable` command is not the intended repair. The installer already created the managed default toolchain under `/opt/rust/rustup`; the missing boundary is the execution environment that tells rustup where that shared state lives.
