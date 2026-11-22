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

The CLI cache is native-platform and version scoped. Installation holds a file lock, uses a private staging directory, verifies the exact version and publishes atomically. A warm run verifies and uses the installed executable without npm installation. A shared per-version lease prevents pruning an active installation; retain the selected and one other idle version. An installation failure removes its partial stage.

Use `RUNNER_TOOL_CACHE`, not a directory below runner HOME: the existing sandbox denies the latter and may prevent its executable from starting. Authentication, helper logs, package-manager state and private runtime directories are per-execution. The CLI installation is deliberately persistent. Do not cache `auth.json` or a model session alongside the executable.

The setup wrapper cleans private login state on normal exit, failure and handled cancellation. The entrypoint and launcher remove their tool-state directories; parent cancellation terminates the detached child process group. Workflow `always()` cleanup provides an owned-path fallback. An unhandled SIGKILL or lost VM can leave state; these mechanisms are not crash-proof erasure or a substitute for host maintenance.

## Existing trust boundary

Run as the existing non-root runner without sudo. Preserve clean child environment, denied host HOME and trusted-runtime paths, read-only CLI installation and `.git`, denied model-command access to job authentication, selected workspace writes and network access. Do not use the sandbox-bypass flag. Real acceptance tests must check denial behavior, not merely profile text.

### Optional Docker access (live acceptance pending)

The checked-out implementation adds `CODEX_ALLOW_DOCKER` at the trusted `scripts/run-job-codex` boundary. This capability still requires exact-revision consumer acceptance before adoption. The trusted workflow may set the exact literal `CODEX_ALLOW_DOCKER=1`; an absent or empty value disables it and any other value fails closed. The input must come from reviewed workflow configuration outside the model-editable checkout, never PR content, a repository environment file or model instructions. Consumers must pin the accepted immutable Agent Relay revision.

When enabled, both shell launchers require `/run/docker.sock` to be a non-symlink Unix socket with read/write access for the existing runner identity and a successful connection within five seconds. The setup wrapper checks before creating job authentication; the inner launcher rechecks before creating tool state. Missing, malformed or inaccessible sockets fail without any host configuration changes or unrestricted fallback. No particular group name is required at runtime; effective access uses the runner's existing permissions.

Trusted code constructs `DOCKER_HOST=unix:///run/docker.sock` through both clean environments to the actual CLI, ignoring inherited Docker endpoints and contexts. The Codex policy adds writable `/run`, the socket's parent directory; it never adds the socket file as a directory. With the opt-in disabled, neither `DOCKER_HOST` nor the `/run` allowance is supplied, and Docker remains unnecessary for startup. The packaged socket is used; no dedicated Agent Relay socket is provisioned.

Codex runs natively as the non-root runner, with no container hosting Codex or socket mounted into a container. Control of rootful Docker is root-equivalent host authority: a model can direct the daemon to mount host paths and bypass ordinary filesystem restrictions, including authentication and Git restrictions. The `/run` allowance is deliberately broad. Sandbox policy, absence of sudo and `no-new-privileges` do not contain a Docker-enabled model. The existing denied/read-only rules remain configured, but must not be presented as host protection after this opt-in.

The trusted finalizer owns commit and push. Check the exact remote and local PR head immediately before publication. One workflow owns a PR writer at a time; independently started jobs must not overwrite the same worktree.

## Tests and evidence

`npm test` retains the 100 percent production TypeScript coverage gates. `npm run check:shell` runs the cache and launcher lifecycle tests in `test-system/job-codex-*.test.mjs`. They cover warm reuse, concurrent installation, active leases, cancellation, installation and execution failures, input validation and cleanup. Fake executables in those tests do not prove real model execution.

Monify PR #280 contains independent real-model acceptance. Run 40804598116 on consumer SHA `535fa0059f2c7f54cb549e9d3b6e194d417635e9`, using runtime `55a7f1d17514dd389feda4164422747a75ebd83a`, observed a warm cache hit, real Codex execution, denied authentication reads and Git writes, and cleaned invocation state. The same historical run also exercised Docker, but Docker is no longer a native Codex prerequisite. Later runtime changes require fresh acceptance. This evidence does not claim Monify's complete browser suite or deployment on main.


The new Docker contract has focused regression evidence for default absence, literal input validation, endpoint sanitization, `/run` admission, malformed/permission-denied/unconnectable sockets and cleanup. Final acceptance remains pending: automated consumer execution must prove Docker client/server and Compose versions, start/inspect/remove one uniquely named non-privileged container from the actual model subprocess, and prove a separate default-disabled control cannot access Docker. The consumer must use the finalized reviewed runtime revision; historical runs and synthetic CLI fixtures do not establish this gate.
