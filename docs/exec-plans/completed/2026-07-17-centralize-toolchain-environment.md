# Centralize the installed toolchain environment

This completed ExecPlan records the implementation that centralized Agent Relay's host toolchain configuration. It is retained as a historical implementation record in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

Agent Relay previously configured executable lookup and tool-specific state independently in `install.sh`, `update.sh`, and `scripts/codex-run`. The first visible failure was Rust: `rustc` resolved through `PATH`, but rustup could not select the installed toolchain because the builder did not receive `RUSTUP_HOME=/opt/rust/rustup`.

The implementation replaced tool-specific repairs with one shared, side-effect-free environment profile. Immutable host installations are now separated from caller-owned writable state, and installation, update builds, Codex execution, and smoke validation consume the same contract.

## Progress

- [x] Confirmed the pre-fix builder `PATH` behavior and reproduced the rustup configuration failure.
- [x] Inspected installer, updater, Codex launcher, smoke validation, system harnesses, runtime tests, contract tests, and the native-runner specification.
- [x] Added `scripts/toolchain-environment.sh` as the single source of Java, Go, Rust, rustup, canonical `PATH`, writable state directory names, and environment construction.
- [x] Made `install.sh` validate and source the shared profile and use profile-defined installation roots.
- [x] Made `update.sh` create a private per-update state root and execute all builder-owned commands through one clean `/usr/bin/env -i` boundary.
- [x] Made `scripts/codex-run` consume the same profile while retaining Codex-specific Git restrictions and per-run cleanup.
- [x] Extended `scripts/toolchain-smoke.sh` to validate complete environment bindings, writable state, executable precedence, Java coherence, and active rustup selection.
- [x] Replaced permissive Java, Go, Rust, Cargo, and rustup test doubles with stateful fixtures that reject incomplete environments.
- [x] Extended installer fixtures, updater fixtures, runtime tests, contract tests, shell validation, and technical documentation.
- [x] Hardened absolute-path validation against root, trailing separators, repeated separators, traversal components, trailing `/.` or `/..`, and line breaks.
- [x] Completed focused Bash syntax validation, strict TypeScript compilation, and focused non-root runtime-script tests.
- [x] Closed the full repository `npm ci && npm run check` item without claiming execution; it was not run in the available implementation environment.
- [x] Closed target-host activation without claiming execution; the merged implementation still requires an ordinary `./update.sh` on the WSL host.
- [x] Archived this plan under `docs/exec-plans/completed/` at the user's direction.

## Decisions

- Use `scripts/toolchain-environment.sh` as the sole repository-owned source of immutable toolchain roots and common environment construction.
- Keep the profile side-effect-free: it defines values and functions but does not create directories, execute commands, or install software.
- Keep immutable installations separate from writable execution state.
- Build the common environment as an ordered Bash array and execute through `/usr/bin/env -i`.
- Keep caller-specific policy outside the shared profile.
- Use a fresh writable state root for each update build and each Codex execution.
- Treat the sourced profile as a trusted regular non-symlink file.
- Do not rely on `/etc/profile`, shell startup files, per-user toolchain duplication, repair-time `rustup default`, or manual symlinks.

## Implemented Contract

The shared profile defines:

```text
TOOLCHAIN_JAVA_HOME=/opt/java/openjdk
TOOLCHAIN_GO_ROOT=/usr/local/go
TOOLCHAIN_RUST_CARGO_HOME=/opt/rust/cargo
TOOLCHAIN_RUST_BIN=/opt/rust/cargo/bin
TOOLCHAIN_RUSTUP_HOME=/opt/rust/rustup
TOOLCHAIN_PATH=/opt/java/openjdk/bin:/usr/local/go/bin:/opt/rust/cargo/bin:/usr/local/bin:/usr/bin:/bin
```

The generated clean environment includes identity and locale values plus:

```text
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

Writable values are placed below a caller-owned state root. Shared Java, Go, Cargo shims, and rustup state remain root-managed.

## Outcomes & Retrospective

The implementation is present on the pull-request branch. Installer, updater, Codex runtime, smoke validation, contract tests, system fixtures, and technical specification use one shared toolchain contract.

The updater now constructs one environment for `agent-relay-builder` and routes dependency installation, compilation, tests, syntax checks, and smoke validation through the same clean boundary. The missing Rust configuration is included by construction, together with Java and the supported writable state directories.

The Codex launcher no longer duplicates immutable roots or writable-state mappings. It consumes the shared profile while retaining its own Git restrictions and cleanup behavior.

Focused syntax, compilation, and runtime tests passed. The complete repository suite and live WSL activation were not executed in the available implementation environment. Their absence is recorded explicitly and is not represented as passing evidence.

## Recovery

After the implementation reaches `main`, the prepared host should require only:

```bash
cd /srv/github-runner/storage/agent-relay
./update.sh
```

Do not rerun `install.sh`, run `rustup default`, reinstall toolchains, recreate runner registration, provide the runner PAT again, create repair symlinks, or edit shell profiles.

## Evidence

Observed before the general fix:

```text
66 tests passed
100% TypeScript lines, branches, and functions
go version go1.24.5 linux/amd64
openjdk version "21.0.11" 2026-04-21 LTS
error: rustup could not choose a version of rustc to run, because one wasn't specified explicitly, and no default is configured
```

Focused implementation evidence:

```text
Bash syntax validation passed for the changed scripts
strict TypeScript compilation of changed contract and runtime tests passed
focused non-root runtime-script tests: 3 passed, 0 failed
```
