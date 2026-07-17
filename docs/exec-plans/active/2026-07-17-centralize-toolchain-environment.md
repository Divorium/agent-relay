# Centralize the installed toolchain environment

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current as implementation proceeds. Maintain this document in accordance with `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

## Purpose / Big Picture

Agent Relay must configure every host-installed development toolchain through one trusted environment contract rather than through independent `PATH` fragments and ad hoc variables in `install.sh`, `update.sh`, and `scripts/codex-run`.

The immediate failure exposed Rust: `rustc` resolved to the rustup shim under `/opt/rust/cargo/bin`, but the builder process did not receive `RUSTUP_HOME=/opt/rust/rustup`, so rustup could not select the installed default toolchain. This was a symptom of a broader defect. Java needs `JAVA_HOME`; Rust needs immutable rustup state plus writable Cargo state; Go, Gradle, npm, pip, XDG consumers, and temporary-file users need explicit writable directories; executable lookup needs one canonical `PATH`.

The implementation introduces a declarative, side-effect-free toolchain profile. It separates immutable host installations from caller-owned writable execution state and exposes one environment constructor used by installation, update builds, Codex runs, and smoke validation.

The already prepared host must recover after merge by running only:

```bash
cd /srv/github-runner/storage/agent-relay
./update.sh
```

The operator must not rerun `install.sh`, reinstall Rust or Java, run `rustup default`, create repair symlinks, edit shell profiles, provide the runner PAT again, or reauthenticate Codex.

## Progress

- [x] (2026-07-17) Confirmed all 66 Node tests and 100% TypeScript coverage passed after the deterministic builder `PATH` fix.
- [x] (2026-07-17) Confirmed toolchain validation then reached Rust and failed because the rustup shim could not find the shared rustup state.
- [x] (2026-07-17) Inspected `install.sh`, `update.sh`, `scripts/codex-run`, `scripts/toolchain-smoke.sh`, installer and updater system harnesses, runtime script tests, contract tests, and the native-runner specification.
- [x] (2026-07-17) Added `scripts/toolchain-environment.sh` as the single source of immutable Java, Go, and Rust roots, canonical `PATH`, writable state directory names, and environment construction.
- [x] (2026-07-17) Made `install.sh` validate and source the shared profile and use its values when installing or checking Java, Go, and Rust.
- [x] (2026-07-17) Made `update.sh` validate and source the profile, create a private per-update state root, construct the builder environment once, and execute every builder command through `sudo -u agent-relay-builder -H /usr/bin/env -i`.
- [x] (2026-07-17) Made `scripts/codex-run` build its existing private per-run state tree from the shared directory list and launch Codex with the common environment plus Codex-specific Git restrictions.
- [x] (2026-07-17) Extended `scripts/toolchain-smoke.sh` to reconstruct and verify every required binding, check writable state directories, prove managed Java, Go, and Rust precedence, and verify the active rustup toolchain.
- [x] (2026-07-17) Replaced permissive updater fixtures with stateful Java, Go, rustc, cargo, and rustup fixtures that fail when immutable homes or writable state bindings are absent or incorrect.
- [x] (2026-07-17) Extended installer fixtures, installer contracts, runtime-script integration tests, package shell checks, and the native-runner specification for the shared environment contract.
- [x] (2026-07-17) Hardened the profile path validator against root, trailing separators, repeated separators, traversal components, trailing `/.` or `/..`, and line breaks.
- [x] (2026-07-17) Ran Bash syntax validation against the implemented installer, updater, profile, launcher, smoke script, and both system harnesses; all parsed successfully.
- [x] (2026-07-17) Ran strict TypeScript compilation for the changed contract and runtime-script tests; compilation succeeded.
- [x] (2026-07-17) Ran the three focused runtime-script tests as a non-root account: Codex environment isolation, missing-auth rejection, and complete toolchain smoke validation all passed.
- [ ] Run the complete repository `npm ci && npm run check` from a full checkout and record the resulting test and coverage evidence.
- [ ] Run the merged implementation on the target WSL host with `./update.sh`, verify successful activation, and verify the runner service is active.
- [ ] Move this exact file to `docs/exec-plans/completed/` only after complete repository validation and target-host acceptance succeed.

## Surprises & Discoveries

- Observation: executable discovery and toolchain configuration are separate contracts.
  Evidence: adding `/opt/rust/cargo/bin` to `PATH` made `rustc` executable, but the executable remained unusable without `RUSTUP_HOME=/opt/rust/rustup`.

- Observation: the installer had already created a valid shared Rust installation.
  Evidence: rustup was installed with `CARGO_HOME=/opt/rust/cargo`, `RUSTUP_HOME=/opt/rust/rustup`, `--default-toolchain stable`, and `--profile minimal`.

- Observation: `scripts/codex-run` contained the most complete previous environment model.
  Evidence: it already supplied identity, locale, `JAVA_HOME`, `RUSTUP_HOME`, canonical `PATH`, private Cargo, Go, Gradle, npm, pip, XDG, and temporary directories.

- Observation: `update.sh` duplicated only part of that model.
  Evidence: before this implementation every builder command received `HOME` and a deterministic `PATH`, but no `JAVA_HOME`, `RUSTUP_HOME`, or explicit writable tool state.

- Observation: Java did not fail first because `java -version` can succeed without `JAVA_HOME`.
  Evidence: the original smoke command validated only the executable version. Build tools and child processes can still require a coherent Java home.

- Observation: the original updater system fixture could validate executable lookup but not executable usability.
  Evidence: fake Java, Rust, and Go commands returned version strings without inspecting their environment or writable state.

- Observation: one clean environment wrapper is simpler and safer than repeating environment assignments at every call site.
  Evidence: the updater now constructs one array and routes dependency installation, compilation, tests, syntax checks, and smoke validation through the same `run_builder` boundary.

- Observation: the local implementation environment did not contain a complete repository checkout and could not resolve `github.com`.
  Evidence: focused files could be compiled and tested, but a full clone and complete `npm run check` could not be produced in that environment. This is why the plan remains active.

## Decision Log

- Decision: use `scripts/toolchain-environment.sh` as the sole repository-owned source of immutable toolchain locations and common environment construction.
  Rationale: one versioned library prevents installer, updater, runtime, tests, and documentation from carrying independent path contracts.
  Date/Author: 2026-07-17 / plan author.

- Decision: keep the profile side-effect-free.
  Rationale: sourcing the profile must only define constants, the state directory list, validation, and environment construction. Directory creation and command execution remain caller responsibilities.
  Date/Author: 2026-07-17 / plan author.

- Decision: define these immutable values in the profile:

  ```text
  TOOLCHAIN_JAVA_HOME=/opt/java/openjdk
  TOOLCHAIN_GO_ROOT=/usr/local/go
  TOOLCHAIN_RUST_CARGO_HOME=/opt/rust/cargo
  TOOLCHAIN_RUST_BIN=/opt/rust/cargo/bin
  TOOLCHAIN_RUSTUP_HOME=/opt/rust/rustup
  TOOLCHAIN_PATH=/opt/java/openjdk/bin:/usr/local/go/bin:/opt/rust/cargo/bin:/usr/local/bin:/usr/bin:/bin
  ```

  Rationale: these are the host-managed roots created by installation and required by both builder and Codex execution.
  Date/Author: 2026-07-17 / plan author.

- Decision: separate immutable installations from writable execution state.
  Rationale: Java, Go, and Rust installations are shared and root-managed. Cargo cache, Go workspace/cache, Gradle, npm, pip, XDG, and temporary files must be writable only inside the current builder or Codex state root.
  Date/Author: 2026-07-17 / plan author.

- Decision: build the common environment as an ordered Bash array and execute through `/usr/bin/env -i`.
  Rationale: arrays preserve argument boundaries and avoid evaluation; `env -i` removes dependence on administrator profiles, `sudo` secure-path behavior, and unrelated inherited variables.
  Date/Author: 2026-07-17 / plan author.

- Decision: include identity, locale, immutable toolchain roots, canonical `PATH`, and explicit writable state paths in the common environment.
  Rationale: this addresses the class of stateful toolchain failures instead of patching only Rust.
  Date/Author: 2026-07-17 / plan author.

- Decision: caller-specific policy remains caller-owned.
  Rationale: `scripts/codex-run` retains Git restrictions and Codex runtime policy. `update.sh` retains expected-version inputs and transaction behavior. The profile configures toolchains, not application policy.
  Date/Author: 2026-07-17 / plan author.

- Decision: use a fresh writable state root for every update build and every Codex execution.
  Rationale: this avoids cross-run cache/config contamination and guarantees cleanup without modifying shared host installations.
  Date/Author: 2026-07-17 / plan author.

- Decision: protect the profile as a trusted regular non-symlink source file.
  Rationale: a sourced file is executable code. The builder and runner accounts must not be able to replace it or redirect it through a symlink.
  Date/Author: 2026-07-17 / plan author.

- Decision: do not use `/etc/profile`, shell startup files, global per-user defaults, repair-time `rustup default`, or duplicate per-user toolchain installations.
  Rationale: Agent Relay requires deterministic noninteractive execution independent of login shells and dotfiles.
  Date/Author: 2026-07-17 / plan author.

## Outcomes & Retrospective

The implementation is present on the pull-request branch. Installer, updater, Codex runtime, smoke validation, contract tests, system fixtures, and technical specification now use one shared toolchain contract.

`update.sh` creates a private state root below `/srv/github-runner/storage/build`, constructs one environment for `agent-relay-builder`, and routes all builder-owned project commands through the same clean boundary. The missing Rust configuration is included by construction, as are Java and every supported writable tool state directory.

`scripts/codex-run` no longer duplicates immutable roots or the state mapping. It consumes the same profile while preserving Codex-specific Git restrictions and per-run cleanup.

The regression fixtures now prove more than version output: Java, Go, rustc, cargo, and rustup refuse to succeed unless their immutable homes and writable state bindings are coherent. This prevents the earlier class of false-positive smoke tests.

Focused syntax, compilation, and runtime tests passed. Full repository validation and the real target-host update have not yet run, so this plan remains active and no production activation claim is made.

## Context and Orientation

`install.sh` performs one-time host preparation. It installs the pinned host toolchains and creates the service accounts, storage layout, organization runner registration, systemd unit, and Codex authentication.

`update.sh` owns release activation. It stops an active runner, pulls `main`, re-executes from the pulled revision, builds and validates as `agent-relay-builder`, swaps `dist`, starts the service, and rolls back revision/runtime/service state on failure.

`scripts/codex-run` launches Codex as `github-runner`. It requires existing ChatGPT authentication, creates a private runtime state root, launches through a clean environment, forwards termination, and removes only that private runtime state.

`scripts/toolchain-smoke.sh` validates executable versions, common environment bindings, writable state, managed executable precedence, rustup activation, and the Codex permission-profile parser.

`test-system/update-script.integration.sh` creates a local Git remote, simulated service, fake sudo boundary, and stateful host toolchains. It covers successful activation, pre-swap build failure rollback, and post-swap service-start rollback.

`test-system/install-script.integration.sh` runs a transformed installer with mocked privileged operations and verifies storage layout, service preparation, registration, authentication, and profile-derived installation roots.

## Implementation Contract

The profile must remain a direct regular file at:

```text
scripts/toolchain-environment.sh
```

It must define the immutable roots and the ordered state directory list. Its constructor accepts exactly:

```text
target user
target home
writable state root
output array name
```

The generated environment must include:

```text
HOME
USER
LOGNAME
SHELL
LANG
LC_ALL
JAVA_HOME
RUSTUP_HOME
CARGO_HOME
GOPATH
GOCACHE
GRADLE_USER_HOME
NPM_CONFIG_CACHE
PIP_CACHE_DIR
XDG_CACHE_HOME
XDG_CONFIG_HOME
XDG_DATA_HOME
TMPDIR
TMP
TEMP
PATH
```

The profile must not create directories, execute tools, mutate global state, edit shell files, or install software.

`install.sh` remains responsible for creating or validating immutable installations. `update.sh` and `scripts/codex-run` remain responsible for creating writable state directories with the correct ownership and permissions.

## Validation and Acceptance

Repository acceptance requires:

1. the profile is the only source of immutable Java, Go, and Rust roots and canonical `PATH`;
2. the installer, updater, Codex launcher, and smoke validator source the same profile;
3. the updater executes every builder project command through one `/usr/bin/env -i` wrapper;
4. all writable tool state is below a caller-owned state root;
5. the profile and other trusted entrypoints are rejected when symlinked;
6. the smoke validator proves environment bindings, writable state, executable precedence, Java coherence, and active rustup selection;
7. stateful system fixtures fail when required bindings are omitted or incorrect;
8. successful update activation and both rollback scenarios pass;
9. `npm run check` passes, including 100% TypeScript runtime line, branch, and function coverage;
10. the target host completes `./update.sh`, reports success, and the GitHub runner service is active.

## Idempotence and Recovery

The shared profile is declarative. Repeated sourcing does not create or modify host state.

Per-update and per-Codex state roots are disposable. Failed updates remove staged build and state data through the existing rollback transaction. Successful updates remove the build state before activation. Codex removes its private state on exit.

The affected host already has valid runner registration, Codex authentication, and installed toolchains. Once the implementation reaches `main`, recovery consists only of:

```bash
cd /srv/github-runner/storage/agent-relay
./update.sh
```

Do not delete `/srv/github-runner/storage/runner`, `/srv/github-runner/storage/home`, `/opt/java`, `/usr/local/go`, or `/opt/rust`. Do not recreate the organization runner.

## Artifacts and Notes

Observed pre-fix target-host evidence:

```text
66 tests passed
100% lines, branches, and functions
go version go1.24.5 linux/amd64
openjdk version "21.0.11" 2026-04-21 LTS
error: rustup could not choose a version of rustc to run, because one wasn't specified explicitly, and no default is configured
```

Focused implementation evidence:

```text
bash -n: install, update, shared profile, Codex launcher, smoke script, and both system harnesses passed
strict TypeScript compilation of changed contract/runtime tests passed
focused non-root runtime-script tests: 3 passed, 0 failed
```

The complete repository suite and live WSL activation remain acceptance steps and are intentionally not represented as completed evidence.
