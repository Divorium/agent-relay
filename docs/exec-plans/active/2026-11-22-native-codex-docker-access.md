# Allow native Codex to operate rootful Docker through the packaged socket

This ExecPlan is a living document governed by `.agent/PLANS.md` and `AGENTS.md`. The `Progress`, `Surprises & Discoveries`, `Decision Log` and `Outcomes & Retrospective` sections are updated as implementation evidence appears. It defines one Agent Relay runtime-interface change; updating a consumer's pinned runtime is a separate, independently mergeable integration increment.

## Purpose / Big Picture

A Codex process launched **natively as `github-runner`**, just like the current Book Generator GitHub Actions execution, can start and stop containers using the existing rootful Docker Engine. The host's `docker` and `docker compose` commands must work **inside Codex's own command-execution sandbox**, not merely from another trusted CI step. No Docker container is used to host Codex and no Docker socket is mounted into a container. The native CLI cache, temporary authentication, read-only Git metadata, and trusted finalizer continue to work. An explicit, trusted consumer opt-in prevents this root-equivalent capability from silently spreading to other Agent Relay clients.

A real acceptance run will execute `docker version` (client and server), `docker compose version` and start, inspect and remove an isolated non-privileged test container from a Codex model command on a self-hosted runner. The test must leave no containers or root-owned checkout directories; it must never alter shared application stacks.

## Progress

- [x] (2026-11-22 14:49Z) Read repository guidance, selected plan, launchers, source, direct tests and current documentation. Verified `.git/HEAD` by file read: detached at `fd280ffe86e06bc161fe035193a33f9964135354`. No Git commands executed; branch creation and finalization remain outside Codex.
- [x] (2026-11-22 14:51Z) Recorded RED: the new focused Docker policy test failed with actual `undefined` versus expected `unix:///run/docker.sock` before implementation.
- [x] (2026-11-22 14:56Z) P1 implementation and focused regressions: exact opt-in validation in the job wrapper, entrypoint and inner launcher; non-symlink socket/read-write/connection validation; fixed endpoint through clean environments; conditional writable `/run`; default absence; rejected inputs/socket types/permissions/dead listeners; failure cleanup.
- [x] (2026-11-22 14:59Z) Available P1 verification passed: strict typecheck, build, 113 Node tests with 100% production line/branch/function coverage, 19 shell tests, runtime compilation, Node syntax checks, and two selected launcher integration tests.
- [ ] P1 full-suite verification remains incomplete: `npm test` includes tests executing Git, forbidden by the user and `AGENTS.md`. Four Git-dependent test files and the separate toolchain smoke test that invokes a fake Git command were excluded from local execution; the required complete suite needs automated CI execution outside Codex's no-Git boundary. No full-suite success is claimed.
- [x] (2026-11-22 15:02Z) P2 documented the implemented opt-in, packaged endpoint, broad `/run` allowance and root-equivalent trust in `docs/job-managed-codex.md` and `docs/native-github-runner-specification.md`; reconciled contradictory summary wording in `README.md` and `docs/operations/README.md`. All descriptions explicitly retain the pending live acceptance gate.
- [x] (2026-11-22 15:00Z) Supplemental live probe from this existing model session: Docker client/server 29.8.0, Compose v5.5.1, isolated non-privileged container started/inspected/removed, no mounts or checkout writes. This is not exact-revision consumer acceptance.
- [x] (2026-11-22 15:03Z) Final source/document review passed: identical socket validation at both shell boundaries, consistent opt-in/endpoint/risk wording, no trailing whitespace, no remaining socket fixtures or root-owned checkout directories. Rechecked detached HEAD unchanged. Rebuilt and reran the 19 shell and two launcher integration tests after making fixtures independent of inherited opt-in settings and asserting Docker context removal.
- [ ] Final acceptance remains incomplete: automated Monify PR #280 integration must pin the finalized reviewed runtime, opt in from the trusted workflow, prove actual model Docker operations and cleanup, and run the default-disabled denial control. This worktree has no finalized revision to pin; this task does not authorize editing Monify. No merge or end-to-end success is claimed.

## Surprises & Discoveries

- Before this implementation, `src/execution/codex-executor.ts` omitted `DOCKER_HOST` from `createCodexEnvironment` and omitted the `/run` socket parent from `createCodexArgs`; its private runtime environment is rebuilt rather than inheriting arbitrary host variables. This blocked an otherwise Docker-group-capable runner user from using the socket inside the model's sandbox.
- `scripts/codex-run` constructs a clean environment and previously did not supply a Docker endpoint to the child; `scripts/run-job-codex` wraps the validated, cache-backed CLI and cleans per-job credentials. Both paths must remain formal boundaries, not code copied into Monify.
- Current `ansible/roles/agent_relay_host/tasks/containers.yml` **removes** the obsolete dedicated `docker.socket` systemd drop-in, so no `/srv/github-runner/storage/docker-socket/docker.sock` endpoint may be assumed. The packaged `docker.socket` normally exposes `/run/docker.sock`; the exact standard socket must be checked at execution time. Host provisioning declares `github-runner` membership in `docker`; validation uses effective access rather than requiring that group name. This gives root-equivalent host authority to a process able to control Docker. A `no-new-privileges` flag, workspace sandbox, or absence of `sudo` must not be described as protecting the host from a Docker-enabled Codex process.
- The original plan identifies `Divorium/monify` Draft PR #280 as executing native Codex through a pinned Agent Relay snapshot. The plan records that its acceptance fixture excluded Docker as of a superseded 2026-11-21 decision; that consumer will require a separate change to opt in and pin the accepted new runtime.

- Observation: The execution environment's effective socket access differs from the provisioned-host group description: `id` reports uid 988, gid 1002 and supplementary `nogroup`; `/run/docker.sock` is owned by `nobody:nogroup` with mode 0660. Effective read/write and connect checks work without inventing host changes.
  Evidence: `docker --host unix:///run/docker.sock version` reported both client and server 29.8.0.
- Observation: `npm test` indirectly invokes Git in finalizer/request/plan/full-flow fixtures. Running it from Codex would violate the explicit no-Git instruction. The other Node tests still reach all production coverage gates.
  Evidence: 113 tests passed; all production files reported 100.00% lines, branches and functions.
- Observation: Unix socket filenames have a short OS length limit; the execution temporary root is already long. Socket fixtures use short checkout-local `.d-*` directories and always remove them; no production socket override was added.

## Decision Log

- Decision: Honor the 2026-11-22 user requirement: Codex itself must execute Docker on the existing rootful self-hosted runner, without running Codex inside Docker and without mounting a socket into another container.
  Rationale: Host-native Codex, as in Book Generator, can use the runner user's existing Docker privileges if the model sandbox admits the packaged socket under its parent directory. There is no need for daemon, VM, service-user or Ansible changes.
  Date/Author: 2026-11-22 / user and plan author.
- Decision: Preserve a secure-by-default opt-in rather than automatically authorizing Docker for every consumer.
  Rationale: Docker control is root-equivalent, and other consumers of the same Agent Relay interface have not approved this privilege increase. Monify's trusted workflow will set `CODEX_ALLOW_DOCKER=1` in its own subsequent integration change.
  Date/Author: 2026-11-22 / plan author.
- Decision: Use the packaged standard Unix socket, without reinstating the deleted dedicated socket override; permit `/run` only for opted-in native Codex, never add `/run/docker.sock` itself as a sandbox directory.
  Rationale: A historical sandbox bug treated a socket-file path as a directory. The current host no longer provides a dedicated socket parent; the packaged socket is under `/run`. Allowing the entire `/run` parent is broader filesystem scope, but Docker permission already conveys root-equivalent host authority. This deliberate privilege must be documented, not presented as narrowly contained.
  Date/Author: 2026-11-22 / plan author.

- Decision: Use Node built-ins inside both existing shell boundaries to validate socket type, read/write access and a connection with a five-second timeout, before job authentication or inner tool-state creation respectively. A successful probe destroys its connection immediately.
  Rationale: A socket inode and permission bits alone do not prove a live accessible listener. This adds no dependencies, configurable endpoints or shared modules, and the second check catches changes between launch stages.
  Date/Author: 2026-11-22 / Codex.
- Decision: Run all available Git-free tests with the unchanged 100% production coverage thresholds and leave the full-suite requirement open.
  Rationale: The user's no-Git restriction overrides the plan's branch/commit/test instructions. No tests were disabled in the repository or delegated to a human, and no CI success was invented.
  Date/Author: 2026-11-22 / Codex.
- Decision: Update README and operations summary sentences alongside the two detailed contract documents, while marking Docker acceptance pending.
  Rationale: Their unconditional statements that the launcher never configures Docker would otherwise contradict the implemented opt-in. No new feature is described as accepted or deployed.
  Date/Author: 2026-11-22 / Codex.

## Outcomes & Retrospective

The implementation and local direct evidence are recorded. The default policy supplies no Docker endpoint or `/run` permission. Trusted opt-in fixes the endpoint, validates the packaged socket twice, and admits the parent directory without weakening the global sandbox. Existing authentication/cache/finalizer contracts remain configured. Focused socket tests and all available production TypeScript coverage gates pass, and the docs explain why Docker authority bypasses ordinary filesystem boundaries.

The task remains incomplete at its required full-suite and final consumer acceptance gates. Git-dependent tests could not run under the explicit no-Git restriction. A real Docker/container smoke from the current model session succeeded and cleaned its disposable resource, but the session was launched before these edits and is not a consumer using the finalized runtime. Its successful socket access also cannot stand in for the required default-disabled denial control. No new finalized immutable revision is available before the trusted finalizer acts. Monify integration is expressly separate from this repository implementation; no downstream changes, merges, host provisioning changes or workflow edits were made. The selected plan remains active.


## Context and Orientation

The producer is `Divorium/agent-relay`, not the `Divorium/monify` application. The original plan selects Draft Monify PR #280 for the separate final consumer proof; its current remote state was not revalidated during this implementation. `scripts/run-job-codex` installs or reuses a version-pinned CLI in a runner tool cache and creates per-job authentication. It then executes `runner/run-codex.mjs`, whose built `src/run-codex.ts` entrypoint invokes `scripts/codex-run`. The latter creates a clean child environment. `src/execution/codex-executor.ts` builds the model's sandbox permissions and another clean environment for the real Codex CLI. Consequently, allowing Docker only in a GitHub Actions shell step or only in the parent environment does not give the model process Docker access. The host Ansible retains the standard packaged `docker.socket` and removes the earlier dedicated socket override. On the supported Debian Docker installation its normal endpoint is `/run/docker.sock`; the launcher must verify this actual socket on the host, including its effective accessibility for `github-runner`, before using it. A Unix socket is an IPC endpoint used by the `docker` CLI to instruct the daemon.

The code and tests to inspect are `scripts/run-job-codex`, `scripts/codex-run`, `src/run-codex.ts`, `src/execution/codex-executor.ts`, `test/job-codex-environment.test.ts`, `test/codex-launcher-regression.test.ts`, `test-system/job-codex-launcher.test.mjs`, and `config/runner-host.json`. Use the current repository's `AGENTS.md` and `.agent/PLANS.md` instructions. Do not edit Monify's workflow from the Agent Relay repository or import Agent Relay source into another bounded context.

## Plan of Work

Implement a single optional input `CODEX_ALLOW_DOCKER` in the current native CLI interface; accept the exact literal `1` as the opt-in, reject other nonempty values, and default to disabled. In enabled mode, verify that `/run/docker.sock` is the actual packaged Unix socket (not a symlink or a directory) and accessible through the runner's existing effective permissions, without changing host configuration. Construct `DOCKER_HOST=unix:///run/docker.sock` in trusted launcher code, not from PR-controlled environment values, and pass it through both clean environment builders to the final Codex subprocess. In `createCodexArgs` admit `/run` as a writable filesystem root only when opted in; **never list `/run/docker.sock` itself as a writable directory**, which previously caused a sandbox failure. In disabled mode provide neither the `/run` allowance nor `DOCKER_HOST`.

Preserve the CLI's exact-version verified cache, per-run `CODEX_HOME`, no inherited GitHub write credential, protected Git metadata, owner-only temporary files, normalized output and trusted finalizer. The opt-in must not be editable by content of the checked-out PR; it originates only in the trusted workflow environment. Do not weaken the sandbox globally, use `--dangerously-bypass-approvals-and-sandbox`, change Docker daemon/socket configuration, or start any persistent stack.

Add RED/GREEN regression tests for input validation, opt-in end-to-end propagation to the spawned process and its sandbox arguments, default absence, malformed socket/permission failure and correct cleanup after failure. Extend only the relevant existing tests. Update `docs/job-managed-codex.md` and `docs/native-github-runner-specification.md` where the current wording would conflict. Keep all unrelated host provisioning tasks and module APIs unchanged.

## Milestones

P1 establishes one executable native Docker capability with a default-denied boundary and direct tests. The final focused evidence is the existing Node and shell test suites; this can be checked without changing documentation or Monify. P2 makes the published security and operational contract truthful once P1 exists, with a direct repository source/document inspection. Neither milestone needs downstream Monify merging to be independently closed.

## Concrete Steps

Work from the repository root in the supplied checkout. The user forbids Git commands; do not create a branch or commit from Codex. The trusted finalizer owns publication. Read `AGENTS.md`, `.agent/PLANS.md`, `scripts/run-job-codex`, `scripts/codex-run`, `src/run-codex.ts`, `src/execution/codex-executor.ts` and corresponding tests before edits. First run targeted tests that assert the currently unsupported Docker opt-in; record the expected failing assertion. Implement P1 and run:

    npm run typecheck
    npm test
    npm run check:shell
    npm run check:runtime

The complete `npm test` invocation is currently prohibited from Codex because its fixtures execute Git. Run the allowed subset without weakening coverage gates from the repository root:

    node --input-type=module - <<'JS'
    import { readdirSync } from 'node:fs';
    import { spawnSync } from 'node:child_process';
    const excluded = new Set(['runner-finalize.test.js', 'request-scripts.test.js', 'resolve-plan.test.js', 'full-flow.integration.test.js', 'runtime-scripts.integration.test.js']);
    const files = readdirSync('dist/test').filter(n => n.endsWith('.test.js') && !excluded.has(n)).map(n => `dist/test/${n}`);
    const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--experimental-test-coverage', '--test-coverage-include=dist/src/**/*.js', '--test-coverage-lines=100', '--test-coverage-branches=100', '--test-coverage-functions=100', ...files], { stdio: 'inherit' });
    process.exitCode = result.status ?? 1;
    JS
    node --test --test-name-pattern=codex-run dist/test/runtime-scripts.integration.test.js
    npm run check:node-scripts

Run `npm run build` before these commands. The unselected toolchain smoke invokes a fake Git command and is excluded conservatively. The four Git-dependent files remain required in automated CI outside this restricted Codex execution; this substitution does not close the full-suite gate.

Expected for focused tests: all existing tests remain passing and the new opt-in assertions pass. If a test suite fails, record the exact test and failure without masking it. Complete P2 with the relevant documentation updates; review the edited sources and compare them with the recorded baseline for unrelated privilege or host-configuration changes without executing Git. For local syntax checks of scripts use the existing `npm run check:shell`, which includes Bash syntax and lifecycle tests.

## Validation and Acceptance

The implementation is accepted only after P1/P2 direct checks and a live, exact-revision consumer run proves that Codex itself invokes Docker successfully. The consumer must explicitly pass `CODEX_ALLOW_DOCKER=1` from a trusted workflow step and pin a reviewed Agent Relay commit. Within the actual Codex model subprocess, command execution must report both Docker client and server for `docker version`, a valid `docker compose version`, then successfully run an isolated Docker container, inspect its state and remove it. Failure must remain a failed test, not a static pass. Confirm no application containers are stopped, no global prune occurs, and the disposable test container is absent afterwards. A dedicated control test without opt-in must fail to access Docker under the Codex sandbox.

The rootful Docker authority is inherently equivalent to privileged host access even though the client process runs as `github-runner`, and any model with Docker permission can bypass ordinary filesystem sandbox assumptions by instructing the daemon to mount host paths. This residual security risk is intentional and must be stated explicitly; no claims of host-level containment are valid after enabling Docker.

Final downstream proof occurs in Monify PR #280, not in an Agent Relay implementation Progress item. Do not mark the two-repository end-to-end acceptance proven until the relevant live workflow runs and logs exist. Do not merge either PR without that proof.

## Idempotence and Recovery

An absent opt-in retains the current launcher behavior. A missing socket, invalid input or inaccessible daemon fails before any authenticated Codex command can run; no fallback to unrestricted permissions is allowed. Repeated tests use disposable fixtures, never production Compose volumes. The job wrapper already owns per-run cleanup and locking; do not replace that lifecycle. On a failed live Docker probe, clean up only the uniquely named test container through the trusted workflow's existing cleanup mechanism. Do not use `docker system prune` or change file owners recursively.

## Artifacts and Notes

Pre-change baseline at detached HEAD `fd280ffe86e06bc161fe035193a33f9964135354` (read `.git/HEAD` directly; no Git execution):

    src/execution/codex-executor.ts:
      createCodexEnvironment(...) omits DOCKER_HOST
      createCodexArgs(...) omits /run parent for packaged Docker socket
    scripts/codex-run:
      clean toolchain_env omits DOCKER_HOST
    scripts/run-job-codex:
      authenticates a workflow-selected cached native CLI before running the trusted command

The expected packaged endpoint is `/run/docker.sock` (verify its actual presence at runtime; Agent Relay no longer provisions a dedicated socket); Docker Engine remains rootful. The implemented shell checks now validate that endpoint and only enabled environments supply it. No exact-revision consumer acceptance observation has been made.

Recorded local evidence:

    RED job-codex-environment Docker assertion:
      actual undefined; expected unix:///run/docker.sock
    GREEN available Node subset: 113 passed, 0 failed
      all production lines / branches / functions: 100.00 / 100.00 / 100.00
    npm run check:shell: 19 passed, 0 failed
    selected runtime-scripts integration tests: 2 passed, 0 failed
    npm run typecheck / build / check:runtime / check:node-scripts: exit 0
    current model session Docker client/server: 29.8.0 / 29.8.0
    docker compose version: v5.5.1
    isolated container: agent-relay-codex-probe-1795359623-2
      running=true privileged=false user=988:1002 mounts=0
      removed; exact-name docker ps query returned empty

The disposable probe used the already present `node:22.23.4-bookworm-slim` image with `--pull never`, no network, a read-only filesystem, dropped capabilities and no-new-privileges. It mounted no checkout or host paths, published no ports and touched no application stack. This is supplemental evidence only, not acceptance of the modified launcher. Socket fixtures likewise remove only their private paths. Final review verified identical validation logic in both shell launchers and matching contract language in current documentation. A checkout-wide directory ownership scan found no root-owned directories; `.git/HEAD` remained the same detached revision. Fixtures explicitly clear inherited Docker opt-in values, and the final CLI environment test confirms inherited Docker contexts are absent.

## Interfaces and Dependencies

The new public trust-boundary input is `CODEX_ALLOW_DOCKER` with enabled value `1` and absent/empty default disabled; other values fail closed. It is consumed by Agent Relay's existing `scripts/run-job-codex` and forwarded through the trusted launch environment to `src/run-codex.ts`, `scripts/codex-run` and `src/execution/codex-executor.ts`. Internally `createCodexEnvironment` gains a default-false fourth `allowDocker` argument, `createCodexArgs` a default-false seventh argument and `CodexExecutor` a default-false final constructor argument. `main` validates the literal environment value before runtime allocation; unrelated callers retain their default policy. Its output is the expected `DOCKER_HOST=unix:///run/docker.sock` and the opt-in sandbox permission for `/run`, after checking the actual packaged socket. There are no new npm dependencies, TCP Docker endpoints, credentials, daemon services, API handlers or shared source modules. The GitHub consumer later opts in using this formal environment boundary and updates its immutable runtime SHA.

## Plan Revision Notes

2026-11-22 / plan author: Prepared the smallest independently mergeable Agent Relay native-Docker capability required by the user's corrected Monify/Book Generator runtime contract. Kept the Monify consumer change out of this prerequisite plan, retained default-denied behavior for unrelated consumers and required real model-initiated Docker proof before final acceptance.

2026-11-22 / plan author: Repaired repository-evidence defect discovered during independent feasibility review. Current Ansible explicitly removes the old dedicated socket override. Replaced the invented managed endpoint with validation of the packaged `/run/docker.sock` and conditional sandbox admission of `/run`. No daemon, user, or Ansible installation change is authorized.

2026-11-22 / plan author: Tightened proof language: focused tests establish the default policy, while real denied/enabled Docker behavior must be demonstrated in a separate live model acceptance. Clarified that `/run/docker.sock` is the packaged endpoint, not an Agent Relay-managed dedicated socket.


2026-11-22 / Codex: Implemented the optional native Docker capability and RED/GREEN regressions; recorded socket validation, cleanup and 100% available production coverage evidence. Updated current contracts with pending acceptance status, effective-permission validation and explicit root-equivalent authority. Replaced obsolete pre-implementation claims with measured outcomes and left full Git-dependent CI and exact-revision consumer acceptance incomplete, because this Codex task forbids Git and publication belongs to the trusted finalizer. No historical completed plans were edited.

2026-11-22 15:03Z / Codex: Recorded final review and cleanup evidence; made test defaults independent of the calling job environment and verified Docker context sanitization. Rebuilt and reran affected shell/launcher tests successfully. Required full Git-dependent CI and finalized-revision consumer gates remain open.
