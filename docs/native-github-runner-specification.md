# Native GitHub Runner and Codex Technical Specification

## Scope and authority

This document describes the currently implemented architecture. Agent Relay runs on a dedicated systemd-capable Linux runner host. The Linux distribution, virtualization platform, cloud provider, and bare-metal placement are deployment details rather than part of the repository architecture contract. Active ExecPlans describe proposed changes; completed ExecPlans are historical records and are not current architecture specifications.

The dedicated runner host is the production containment boundary selected by the deployment. The repository does not assume Windows integration, shared host folders, a specific hypervisor, or a particular cloud. The official organization-level GitHub Actions runner is the only long-lived Agent Relay service. It executes the trusted runtime from the administrator-owned repository checkout and gives Codex direct access only to the selected workflow workspace.

There is currently no Relay HTTP service, queue, polling loop, persisted job state, Docker integration, Compose deployment, `.env`, or `/opt/agent-relay` copy.

## Fixed paths

All Agent Relay and GitHub Runner application data is grouped below `/srv/github-runner/storage`:

```text
/srv/github-runner/storage/agent-relay  administrator-owned source and root-owned compiled runtime
/srv/github-runner/storage/work         github-runner-owned workflow workspaces
/srv/github-runner/storage/runner       official GitHub Actions runner
/srv/github-runner/storage/home         github-runner home and Codex authentication
/srv/github-runner/storage/build        disposable update leftovers
/srv/github-runner/storage/build-home   builder home
```

The storage root is a regular `root:root` directory not writable by group or other identities. `build` and `build-home` are private `agent-relay-builder:agent-relay-builder` directories with mode `0700`. The updater may delete and recreate `build`; no persistent update state is stored there.

The runner is configured with work name `_work`. `/srv/github-runner/storage/runner/_work` is a symlink to `../work`, so the official runner resolves its relative work path to `/srv/github-runner/storage/work`.

Every workflow checkout below `/srv/github-runner/storage/work` is treated as a trusted Codex project only after canonical path validation. The exact selected checkout is trusted, not a wildcard or textual prefix.

## Accounts and privilege boundary

Three identities are used:

- the host administrator owns the source checkout, performs one-time installation, updates the checkout explicitly, and invokes `update.sh`;
- `agent-relay-builder` has a locked password, no interactive shell, and no sudo access; during update it compiles the production runtime directly into the `dist` directory created for that identity;
- `github-runner` has a locked password and no sudo access; systemd runs the official runner and Codex as this account, and GitHub Actions pipeline commands execute in its workflow workspaces.

The source checkout is readable by both service accounts but writable only by the administrator. During compilation `dist` is temporarily builder-owned and mode `0700`. After compilation every runtime entry is changed to `root:root`; directories are mode `0755` and regular files are mode `0644`.

`/etc/agent-relay/administrator` is a regular non-symlink `root:root` trust-anchor file not writable by group or other identities. Its content selects the only administrator account permitted to run updates.

Neither service account can use the administrator's cached sudo authentication. Both accounts are explicitly kept out of sudo and are verified not to have passwordless sudo access.

## User flow

### First installation

```bash
cd /srv/github-runner/storage/agent-relay
./install.sh
./update.sh
```

`install.sh` performs one-time host, service-account, runner, systemd-unit, toolchain, and Codex-authentication setup.

The architecture requires a supported Linux host with systemd as PID 1 but does not require a particular distribution or virtualization environment. The current installer implementation supports Debian x86-64. It also retains a WSL compatibility path that may configure `[boot] systemd=true`; only that compatibility path requires `wsl --shutdown` before `./update.sh`.

The installer is not rerun for ordinary releases.

### Later releases

```bash
cd /srv/github-runner/storage/agent-relay
git pull --ff-only
./update.sh
```

Git synchronization is always an explicit operator action. `update.sh` performs no Git command and does not require a clean checkout.

## Installer contract

`install.sh` must:

- accept no arguments and refuse root execution;
- require the currently supported Debian x86-64 installer environment and `/srv/github-runner/storage/agent-relay`, without treating that compatibility limitation as an architecture requirement;
- require systemd as PID 1 and retain the explicit WSL compatibility path described above;
- validate and source `scripts/toolchain-environment.sh` before installing or checking host toolchains;
- install the pinned system toolchains and build dependencies;
- create locked `github-runner` and `agent-relay-builder` accounts and remove sudo access;
- prepare all six fixed storage paths with their required ownership;
- reject symlinked trusted entrypoints and change source ownership without following repository symlinks;
- download and SHA-256 verify the official runner archive;
- request an organization PAT only when runner registration is absent and exchange it for a short-lived registration token;
- register `gh-runner` for `https://github.com/Divorium` with `_work` and no custom labels;
- install a root-owned systemd unit with `KillMode=process` so stopping the listener does not terminate an already running `Runner.Worker`;
- install the root-owned administrator trust file;
- perform Codex login as `github-runner` only when authentication is absent;
- prepare, but not enable or start, the service. The first `update.sh` builds and activates the runtime.

Pinned versions are GitHub Actions Runner `2.335.1`, Go `1.24.5`, TypeScript `5.8.3`, Codex CLI `0.144.4`, Node.js 22, and Java 21.

## Toolchain environment contract

`scripts/toolchain-environment.sh` defines immutable host toolchain roots and executable ordering:

```text
JAVA_HOME       /opt/java/openjdk
Go root         /usr/local/go
Rust Cargo root /opt/rust/cargo
RUSTUP_HOME     /opt/rust/rustup
PATH            /opt/java/openjdk/bin:/usr/local/go/bin:/opt/rust/cargo/bin:/usr/local/bin:/usr/bin:/bin
```

The profile has no side effects when sourced. It constructs an ordered environment array with explicit identity, locale, immutable toolchain paths, and writable state paths below a caller-supplied root.

Installation, Codex execution, and the pipeline toolchain smoke use this profile. The simplified updater does not source it because runtime compilation requires only the pinned `/usr/local/bin/tsc`, the builder home, locale, and standard executable path.

## Runtime update contract

`update.sh` must:

1. accept no arguments and refuse root execution;
2. require the exact repository location, protected administrator file, recorded administrator identity, systemd as PID 1, builder and runner accounts, `/usr/local/bin/tsc`, `/usr/bin/ps`, and `tsconfig.runtime.json`;
3. perform no Git command and impose no clean-worktree requirement;
4. acquire sudo credentials and register only sudo-cache invalidation as process cleanup, never runtime or service rollback;
5. stop `actions.runner.Divorium.gh-runner.service` before waiting, preventing the listener from accepting another job;
6. resolve the numeric effective UID of `github-runner`, inspect the complete process table through `/usr/bin/ps -e -o euid=,comm=`, fail when that command fails, and wait without a timeout only while a row matches both that UID and `Runner.Worker`;
7. delete and recreate `/srv/github-runner/storage/build` as a private builder-owned directory, discarding previous update leftovers;
8. delete `/srv/github-runner/storage/agent-relay/dist` completely and recreate it as `agent-relay-builder:agent-relay-builder` mode `0700`;
9. invoke only `/usr/local/bin/tsc -p tsconfig.runtime.json --outDir dist` as `agent-relay-builder` through `env -i` with explicit identity, home, locale, and path;
10. require `dist/src/run-codex.js` to exist;
11. change the runtime tree to `root:root`, set directories to `0755`, and set regular files to `0644` through physical filesystem-bounded traversal;
12. enable and start the runner unit, require it to become active, and display its status.

The updater does not run `npm ci`, tests, coverage, shell checks, Node checks, system tests, or toolchain smoke. Those are pipeline responsibilities.

The updater has no stage, backup, activation move, transaction journal, recovery, or rollback. If any step fails, the service may remain stopped and `dist` may be absent or partial. The next invocation deletes `dist` and compiles it again from zero.

## GitHub request flow

The workflow is `.github/workflows/codex.yml` and processes one request as follows:

1. `resolve-request.mjs` selects and validates the pull request number from `pull_request` or `workflow_dispatch` input.
2. `resolve-pr.mjs` requires an open non-draft same-repository pull request, validates its head ref and exact SHA, and publishes checkout outputs.
3. `actions/checkout` checks out that exact SHA with `persist-credentials: false`.
4. `resolve-plan.mjs` treats zero added or modified active ExecPlans in a pull request as a successful Codex skip, resolves exactly one, and rejects multiple candidates; manual dispatch continues to require and validate an explicit path.
5. The validation job runs `npm ci` and `npm run check` before Codex execution.
6. `run-codex.mjs` calls the compiled direct runtime.
7. `CodexExecutor` canonicalizes the selected workspace and invokes `scripts/codex-run` with `codex exec --json`, timeout, process-group termination, normalized-output limits, streaming redaction, and filesystem/network permissions.
8. Relay immediately pauses the source of each stdout or stderr callback, places that one tagged raw chunk into a callback-arrival queue, and processes the queue serially. This is an arrival-order rule, not a claim of total kernel ordering between the two pipes. A source resumes only after its current raw chunk has been processed and the normalized queue is below 128 KiB.
9. Relay writes every accepted redacted segment to both the live Actions log and `${RUNNER_TEMP}/agent-relay-console.log`. The workflow uploads that file as the existing `agent-relay-output` artifact after the Codex step, including when execution fails.
10. `finalize.sh` validates the branch and commit message, checks the diff, commits, and pushes through a temporary askpass helper. Codex receives no GitHub token.

The workflow runs only same-repository pull requests and uses `runs-on: [self-hosted]` without custom labels.

## Codex boundary

The launcher and runtime:

- refuse root execution;
- require the `github-runner` Codex authentication file;
- validate and source the trusted toolchain profile;
- build a private per-run state hierarchy and start Codex through `env -i`;
- trust only the exact canonical selected workspace;
- deny the runner home, trusted source checkout, entire runner workspace root, `/tmp`, and `/var/tmp` to model-controlled tools;
- expose `/opt/rust` read-only;
- grant writes only to the selected repository and private runtime directory;
- keep the selected repository's `.git` directory read-only;
- enable network access and disable memories;
- remove only their own private runtime directory.

## Codex output contract

Raw Codex JSONL is an internal protocol and is never copied directly to the job log or artifact. Relay retains byte slices, scans every incoming byte once for LF, decodes and parses each complete record once, and releases its slices after parsing or failure. It validates complete JSON records across arbitrary byte chunks, normalizes supported item lifecycles by item identifier, bounds unknown-event notices, and labels stderr as process diagnostics. The separate JSONL protocol budget defaults to `max(16 MiB, 8 * MAX_OUTPUT_BYTES + 1 MiB)`: the factor of eight covers worst-case JSON string escaping plus envelope headroom. `MAX_JSONL_RECORD_BYTES` may explicitly set a value from 1 MiB through the 256 MiB hard ceiling. Complete and unfinished records over that budget fail independently from transcript truncation.

Every normalized physical line begins with the fixed Relay-owned `[codex] ` prefix. CRLF, bare CR, and LF are canonicalized as line boundaries, including empty continuation lines, and unsafe C0 controls and DEL are visibly encoded. This structural rule applies uniformly to model messages, reasoning, commands, patches, todos, warnings, errors, unknown notices, and stderr; Relay does not depend on a list of known GitHub workflow commands.

Normalization happens before streaming redaction and `MAX_OUTPUT_BYTES` accounting. Normalization and UTF-8-safe transport splitting yield lazily; a segment is at most 32 KiB. Admission waits whenever the pending normalized queue is at least 256 KiB, so the hard queue maximum is less than 256 KiB plus one 32 KiB segment, with at most one current normalized segment outside that accounting. The serial raw-input path retains at most one paused raw chunk per child source. The consumer always awaits the live Node Writable callback, additionally awaits `drain` when `write()` returns false, and does not advance to another segment until both live and transcript writes settle. On parser, normalizer, or sink failure, Relay retains the first failure, terminates the process group, and drains/discards both pipes through close. Live-output and transcript-output failures have distinct diagnostics.

Relay owns one fan-out, so successful live output and the uploaded transcript contain byte-identical normalized content. When the normalized redacted byte budget cannot accept the next complete physical line, Relay keeps the already accepted complete-line prefix and writes one `[codex] [OUTPUT TRUNCATED]` line to both sinks. It clears lifecycle state and stops normalizing ordinary events. It continues bounded stderr line framing and syntax/size/UTF-8 validation of JSONL records while draining both pipes, so malformed transport still fails without retaining lifecycle content. A later timeout or nonzero exit remains authoritative. The fixed Relay-owned marker is a reserved terminal notice outside the configured ordinary-output budget.

An unfinished stderr line is emitted in labeled continuation chunks with a 16 KiB framing bound. Active cumulative command, reasoning, message, and patch state retains only JavaScript string length and a SHA-256 digest of the prior UTF-8 prefix. Active items are capped at 1,024, file identities per active file-change item are capped at 1,024, and completed-item and event replay identities use deterministic 4,096-entry eviction. Completion releases active state immediately.

The Actions job log remains live while Codex runs. The `agent-relay-output` artifact becomes available only after the later upload step and contains the same Relay transcript. Relay validates that the workflow-provided transcript is a new non-symlink path below `RUNNER_TEMP`, then flushes and closes it before returning. Transcript create, write, flush, or close failures fail the Codex step, including when Codex itself exits successfully.

`GITHUB_OUTPUT` remains restricted to workflow values such as `commit_message`; execution logs never use that channel. No public API, request contract, installation argument, routing, result-semantic, commit-ownership, or finalization-decision change is part of this output contract.

Pre-merge tests execute the branch implementation with real Node streams and controlled child processes. The pull-request Codex workflow itself invokes the trusted deployed runtime, so it cannot prove that an unmerged checkout supplies the active transport. A real Codex transport smoke is post-merge and post-deployment evidence only.

## Validation contract

The GitHub Actions pipeline runs `npm ci` and `npm run check`. The check suite includes:

- strict TypeScript typechecking;
- compilation of source and tests followed by all Node tests;
- mandatory 100% line, branch, and function coverage for `src/**/*.ts`;
- production-only compilation through `tsconfig.runtime.json` into a disposable directory with `src/run-codex.js` required;
- shell and Node-script syntax checks;
- the real managed toolchain smoke with isolated writable state;
- system-level mocked installation and simplified update executions;
- updater contract checks proving there are no Git, validation-suite, staging, backup, recovery, or rollback operations;
- a system update test proving listener stop before worker inspection, idle and listener-only continuation, UID-scoped worker waiting, fail-closed process inspection before destructive work, dirty-checkout acceptance, complete runtime replacement, no rollback after build failure, and successful full rebuild on the next invocation.

The full-flow integration test creates a local Git remote and pull-request branch, serves a mock GitHub pull-request API, resolves the request and active plan, checks out the exact revision, invokes a mock Codex executable, and validates finalization behavior without granting GitHub credentials to Codex.
