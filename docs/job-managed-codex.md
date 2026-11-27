# Workflow-owned native Codex

## Ownership

GitHub Actions selects the CLI version, supplies an existing authentication secret and chooses a reviewed Agent Relay runtime revision. Ansible manages the host and runtime deployment, not Codex. A consumer may compile an exact pinned runtime in its temporary directory without deploying it over the host installation. Agent Relay remains a CLI/environment boundary; consumers do not import its source helpers.

## Invocation

From a credential-free checkout of the target revision, prepare the trusted runtime outside the model's editable workspace. The existing entrypoint is then called through the setup wrapper:

    export CODEX_CACHE_ROOT="${RUNNER_TOOL_CACHE:?}/codex-cli"
    bash "$RELAY_RUNTIME_ROOT/scripts/run-job-codex" node "$RELAY_RUNTIME_ROOT/runner/run-codex.mjs"

The trusted workflow provides `CODEX_VERSION` as an exact stable version, `CODEX_TOKEN` as a step-scoped secret, and the existing `CODEX_PLAN_PATH`, `CODEX_WORKSPACE_ROOT`, `GITHUB_WORKSPACE`, `GITHUB_OUTPUT`, `HOME`, `RUNNER_TEMP` and `CODEX_TRANSCRIPT_PATH` inputs. `CODEX_TOKEN` is a Codex access token, not an API key. Login uses `codex login --with-access-token` and reads the secret from stdin. Do not put the secret in command arguments or source files.

The setup wrapper publishes `CODEX_BINARY`, `CODEX_INSTALL_ROOT` and a private per-job `CODEX_HOME` to the launcher. The launcher validates the executable's containment and private authentication ownership/modes before running anything. The wrapper removes raw authentication and GitHub token variables before invoking the child. Consumers expose GitHub write credentials only to a trusted finalizer after model execution.

## Cache and temporary state

The CLI cache is native-platform and version scoped. An exact stable version is necessary but not sufficient: the selected version and platform must have a trusted SHA-256 distribution digest in [`config/codex-integrity.json`](../config/codex-integrity.json) from the reviewed runtime revision. A missing pin fails closed. The currently supported pins are listed in that file; the wrapper recognizes Linux x64 and arm64, but recognizing a platform does not make an unpinned distribution trusted.

Installation holds a file lock, uses a private staging directory and installs with npm lifecycle scripts disabled (`--ignore-scripts`). [`scripts/codex-cache-digest.mjs`](../scripts/codex-cache-digest.mjs) checks the distribution tree against the trusted digest before executing the CLI version check and publishing atomically. The digest includes sorted paths, file contents, executable bits and contained symlink targets; it excludes `.last-used` and npm's installation-local `.package-lock.json`. The wrapper rechecks the digest and version before login, including on a warm cache hit. A cache hit does not perform npm installation.

If an existing installation fails integrity verification, the wrapper acquires an exclusive per-version lease before removing it and attempting a fresh, independently verified installation. If the lease is held, recovery is deferred and the job fails rather than executing or deleting an active untrusted installation. Successful replacement emits `CODEX_CACHE_RECOVERED`; failed installation removes its partial stage. Shared leases prevent pruning active versions; the wrapper retains the selected version and one other recent version and skips removal of leased versions.

The [distribution integrity workflow](../.github/workflows/codex-integrity.yml) verifies two fresh installations against the reviewed pin and compares their digests. A CLI version or platform change needs a corresponding reviewed trusted pin in the selected runtime revision; an observed digest from a failed job is not automatically trusted.

Use `RUNNER_TOOL_CACHE`, not a directory below runner HOME: the existing sandbox denies the latter and may prevent its executable from starting. Authentication, helper logs, package-manager state and private runtime directories are per-execution. The CLI installation is deliberately persistent. Do not cache `auth.json` or a model session alongside the executable.

The setup wrapper cleans private login state on normal exit, failure and handled cancellation. The entrypoint and launcher remove their tool-state directories; parent cancellation terminates the detached child process group. Workflow `always()` cleanup provides an owned-path fallback. An unhandled SIGKILL or lost VM can leave state; these mechanisms are not crash-proof erasure or a substitute for host maintenance.

## Existing trust boundary

Run as the existing non-root runner without sudo. Preserve clean child environment, denied host HOME and trusted-runtime paths, read-only CLI installation and `.git`, denied model-command access to job authentication, selected workspace writes and network access. Do not use the sandbox-bypass flag. Real acceptance tests must check denial behavior, not merely profile text.

Docker Engine remains provisioned for other CI workloads. The Codex launcher neither checks a dedicated Docker socket nor sets `DOCKER_HOST` or grants socket-directory filesystem permissions. Runner group memberships are unchanged; this is not a redesign of host isolation.

The trusted finalizer owns commit and push. Check the exact remote and local PR head immediately before publication. One workflow owns a PR writer at a time; independently started jobs must not overwrite the same worktree.

## Tests and evidence

`npm test` retains the 100 percent production TypeScript coverage gates. `npm run check:shell` runs the cache and launcher lifecycle tests in `test-system/job-codex-*.test.mjs`. They cover warm reuse, concurrent installation, active leases, cancellation, installation and execution failures, input validation and cleanup. Fake executables in those tests do not prove real model execution.

Monify PR #280 contains independent real-model acceptance. Run 40804598116 on consumer SHA `535fa0059f2c7f54cb549e9d3b6e194d417635e9`, using runtime `55a7f1d17514dd389feda4164422747a75ebd83a`, observed a warm cache hit, real Codex execution, denied authentication reads and Git writes, and cleaned invocation state. The same historical run also exercised Docker, but Docker is no longer a native Codex prerequisite. Later runtime changes require fresh acceptance. This evidence does not claim Monify's complete browser suite or deployment on main.
