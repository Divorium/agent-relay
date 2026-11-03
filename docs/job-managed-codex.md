# Workflow-owned native Codex

## Ownership

GitHub Actions selects the CLI version, supplies an existing authentication secret and chooses a reviewed Agent Relay runtime revision. Ansible manages the host and runtime deployment, not Codex. A consumer may compile an exact pinned runtime in its temporary directory without deploying it over the host installation. Agent Relay remains a CLI/environment boundary; consumers do not import its source helpers.

## Invocation

From a credential-free checkout of the target revision, prepare the trusted runtime outside the model's editable workspace. The existing entrypoint is then called through the setup wrapper:

    export CODEX_CACHE_ROOT="${RUNNER_TOOL_CACHE:?}/codex-cli"
    bash "$RELAY_RUNTIME_ROOT/scripts/run-job-codex" node "$RELAY_RUNTIME_ROOT/runner/run-codex.mjs"

The trusted workflow provides `CODEX_VERSION` as an exact stable version, `CODEX_TOKEN` as a step-scoped secret, and the existing `CODEX_PLAN_PATH`, `CODEX_WORKSPACE_ROOT`, `GITHUB_WORKSPACE`, `GITHUB_OUTPUT`, `HOME`, `RUNNER_TEMP` and `CODEX_TRANSCRIPT_PATH` inputs. `CODEX_TOKEN` may be an API key or an access token prefixed `at-`; login reads it from stdin. Do not put the secret in command arguments or source files.

The setup wrapper publishes `CODEX_BINARY`, `CODEX_INSTALL_ROOT` and a private per-job `CODEX_HOME` to the launcher. The launcher validates the executable's containment and private authentication ownership/modes before running anything. The wrapper removes raw authentication and GitHub token variables before invoking the child. Consumers expose GitHub write credentials only to a trusted finalizer after model execution.

## Cache and temporary state

The CLI cache is native-platform and version scoped. Installation holds a file lock, uses a private staging directory, verifies the exact version and publishes atomically. A warm run verifies and uses the installed executable without npm installation. A shared per-version lease prevents pruning an active installation; retain the selected and one other idle version. An installation failure removes its partial stage.

Use `RUNNER_TOOL_CACHE`, not a directory below runner HOME: the existing sandbox denies the latter and may prevent its executable from starting. Authentication, helper logs, package-manager state and private runtime directories are per-execution. The CLI installation is deliberately persistent. Do not cache `auth.json` or a model session alongside the executable.

The setup wrapper cleans private login state on normal exit, failure and handled cancellation. The entrypoint and launcher remove their tool-state directories; parent cancellation terminates the detached child process group. Workflow `always()` cleanup provides an owned-path fallback. An unhandled SIGKILL or lost VM can leave state; these mechanisms are not crash-proof erasure or a substitute for host maintenance.

## Existing trust boundary

Run as the existing non-root runner without sudo. Preserve clean child environment, denied host HOME and trusted-runtime paths, read-only CLI installation and `.git`, denied model-command access to job authentication, selected workspace writes, and the existing Docker endpoint. Do not use the sandbox-bypass flag. Real acceptance tests must check denial behavior, not merely profile text.

The existing root-owned Docker daemon remains intentionally accessible through the runner's docker group. A sandbox rule does not constrain host operations performed by that daemon. This is the previously accepted trust model, not new Rootless Docker or full isolation between mutually untrusted jobs. No production credential or Docker permission changes are part of this feature.

The trusted finalizer owns commit and push. Check the exact remote and local PR head immediately before publication. One workflow owns a PR writer at a time; independently started jobs must not overwrite the same worktree.

## Tests and evidence

`npm test` retains the 100 percent production TypeScript coverage gates. `npm run check:shell` runs the cache and launcher lifecycle tests in `test-system/job-codex-*.test.mjs`. They cover warm reuse, concurrent installation, active leases, cancellation, installation and execution failures, input validation and cleanup. Fake executables in those tests do not prove model or Docker access.

Monify PR #280 contains independent real-model acceptance. Run 40804598116 on consumer SHA `535fa0059f2c7f54cb549e9d3b6e194d417635e9`, using runtime `55a7f1d17514dd389feda4164422747a75ebd83a`, observed a warm cache hit, real Codex execution, Docker server 29.8.0, a disposable container, denied authentication reads and Git writes, and cleaned invocation state. Later runtime changes require fresh acceptance. This evidence does not claim Monify's complete browser suite or deployment on main.
