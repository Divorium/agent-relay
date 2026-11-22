# Allow native Codex to operate rootful Docker through the packaged socket

This ExecPlan is a living document governed by `.agent/PLANS.md` and `AGENTS.md`. The `Progress`, `Surprises & Discoveries`, `Decision Log` and `Outcomes & Retrospective` sections are updated as implementation evidence appears. It defines one Agent Relay runtime-interface change; updating a consumer's pinned runtime is a separate, independently mergeable integration increment.

## Purpose / Big Picture

A Codex process launched **natively as `github-runner`**, just like the current Book Generator GitHub Actions execution, can start and stop containers using the existing rootful Docker Engine. The host's `docker` and `docker compose` commands must work **inside Codex's own command-execution sandbox**, not merely from another trusted CI step. No Docker container is used to host Codex and no Docker socket is mounted into a container. The native CLI cache, temporary authentication, read-only Git metadata, and trusted finalizer continue to work. An explicit, trusted consumer opt-in prevents this root-equivalent capability from silently spreading to other Agent Relay clients.

A real acceptance run will execute `docker version` (client and server), `docker compose version` and start, inspect and remove an isolated non-privileged test container from a Codex model command on a self-hosted runner. The test must leave no containers or root-owned checkout directories; it must never alter shared application stacks.

## Progress

- [ ] P1 — Implement the opt-in Docker capability in Agent Relay's existing native launcher and its direct focused regression tests. Deliverable -> one explicit `CODEX_ALLOW_DOCKER=1` input at the trusted `scripts/run-job-codex` boundary, validation of the packaged `/run/docker.sock` Unix socket, a clean `DOCKER_HOST` passed to the actual model subprocess, and a Codex sandbox filesystem allowance for its parent `/run` only when opted in. Evidence -> `npm run typecheck && npm test && npm run check:shell` proves the default stays denied, an opted-in process receives precisely the expected Docker endpoint, the sandbox arguments admit `/run` rather than treating a socket as a directory, and other secret/auth/Git policy assertions still pass; done.
- [ ] P2 — Document the executed trust contract without claiming Docker container isolation. Deliverable -> update `docs/job-managed-codex.md` and the applicable runtime specification to describe opt-in access, the actual managed endpoint and its root-equivalent risk, with no invented host changes. Evidence -> a direct source/document check confirms the opt-in name, endpoint, and boundary agree and old prose stating that Codex can never use Docker is absent; done.

## Surprises & Discoveries

- Current `src/execution/codex-executor.ts` omits `DOCKER_HOST` from `createCodexEnvironment` and omits the `/run` socket parent from `createCodexArgs`; its private runtime environment is rebuilt rather than inheriting arbitrary host variables. This blocks an otherwise Docker-group-capable runner user from using the socket inside the model's sandbox.
- `scripts/codex-run` constructs a clean environment and does not presently supply a Docker endpoint to the child; `scripts/run-job-codex` wraps the validated, cache-backed CLI and cleans per-job credentials. Both paths must remain formal boundaries, not code copied into Monify.
- Current `ansible/roles/agent_relay_host/tasks/containers.yml` **removes** the obsolete dedicated `docker.socket` systemd drop-in, so no `/srv/github-runner/storage/docker-socket/docker.sock` endpoint may be assumed. The packaged `docker.socket` normally exposes `/run/docker.sock`; the exact standard socket must be checked at execution time. `github-runner` belongs to the `docker` group. This gives root-equivalent host authority to a process able to control Docker. A `no-new-privileges` flag, workspace sandbox, or absence of `sudo` must not be described as protecting the host from a Docker-enabled Codex process.
- `Divorium/monify` Draft PR #280 already executes native Codex through a pinned Agent Relay snapshot. Its plan and acceptance fixture currently exclude Docker as of a superseded 2026-11-21 decision; that consumer will require a separate change to opt in and pin the accepted new runtime.

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

## Outcomes & Retrospective

Implementation not started. No runtime Docker access or Monify compatibility has been proven on this proposed revision. Actual model-initiated Docker execution and resource cleanup remain final acceptance gates, not presumed results of source inspection.

## Context and Orientation

The producer is `Divorium/agent-relay`, not the `Divorium/monify` application. The consumer is currently Draft Monify PR #280. `scripts/run-job-codex` installs or reuses a version-pinned CLI in a runner tool cache and creates per-job authentication. It then executes `runner/run-codex.mjs`, whose built `src/run-codex.ts` entrypoint invokes `scripts/codex-run`. The latter creates a clean child environment. `src/execution/codex-executor.ts` builds the model's sandbox permissions and another clean environment for the real Codex CLI. Consequently, allowing Docker only in a GitHub Actions shell step or only in the parent environment does not give the model process Docker access. The host Ansible retains the standard packaged `docker.socket` and removes the earlier dedicated socket override. On the supported Debian Docker installation its normal endpoint is `/run/docker.sock`; the launcher must verify this actual socket on the host, including its effective accessibility for `github-runner`, before using it. A Unix socket is an IPC endpoint used by the `docker` CLI to instruct the daemon.

The code and tests to inspect are `scripts/run-job-codex`, `scripts/codex-run`, `src/run-codex.ts`, `src/execution/codex-executor.ts`, `test/job-codex-environment.test.ts`, `test/codex-launcher-regression.test.ts`, `test-system/job-codex-launcher.test.mjs`, and `config/runner-host.json`. Use the current repository's `AGENTS.md` and `.agent/PLANS.md` instructions. Do not edit Monify's workflow from the Agent Relay repository or import Agent Relay source into another bounded context.

## Plan of Work

Implement a single optional input `CODEX_ALLOW_DOCKER` in the current native CLI interface; accept the exact literal `1` as the opt-in, reject other nonempty values, and default to disabled. In enabled mode, verify that `/run/docker.sock` is the actual packaged Unix socket (not a symlink or a directory) and accessible through the runner's existing Docker group, without changing host configuration. Construct `DOCKER_HOST=unix:///run/docker.sock` in trusted launcher code, not from PR-controlled environment values, and pass it through both clean environment builders to the final Codex subprocess. In `createCodexArgs` admit `/run` as a writable filesystem root only when opted in; **never list `/run/docker.sock` itself as a writable directory**, which previously caused a sandbox failure. In disabled mode provide neither the `/run` allowance nor `DOCKER_HOST`. In disabled mode expose neither the socket permission nor `DOCKER_HOST`.

Preserve the CLI's exact-version verified cache, per-run `CODEX_HOME`, no inherited GitHub write credential, protected Git metadata, owner-only temporary files, normalized output and trusted finalizer. The opt-in must not be editable by content of the checked-out PR; it originates only in the trusted workflow environment. Do not weaken the sandbox globally, use `--dangerously-bypass-approvals-and-sandbox`, change Docker daemon/socket configuration, or start any persistent stack.

Add RED/GREEN regression tests for input validation, opt-in end-to-end propagation to the spawned process and its sandbox arguments, default absence, malformed socket/permission failure and correct cleanup after failure. Extend only the relevant existing tests. Update `docs/job-managed-codex.md` and `docs/native-github-runner-specification.md` where the current wording would conflict. Keep all unrelated host provisioning tasks and module APIs unchanged.

## Milestones

P1 establishes one executable native Docker capability with a default-denied boundary and direct tests. The final focused evidence is the existing Node and shell test suites; this can be checked without changing documentation or Monify. P2 makes the published security and operational contract truthful once P1 exists, with a direct repository source/document inspection. Neither milestone needs downstream Monify merging to be independently closed.

## Concrete Steps

Work from the repository root in a dedicated branch. Read `AGENTS.md`, `.agent/PLANS.md`, `scripts/run-job-codex`, `scripts/codex-run`, `src/run-codex.ts`, `src/execution/codex-executor.ts` and corresponding tests before edits. First run targeted tests that assert the currently unsupported Docker opt-in; record the expected failing assertion. Implement P1 and run:

    npm run typecheck
    npm test
    npm run check:shell
    npm run check:runtime

Expected for focused tests: all existing tests remain passing and the new opt-in assertions pass. If a test suite fails, record the exact test and failure without masking it. Complete P2 with the relevant documentation updates; inspect the final diff for unrelated privilege or host-configuration changes. For local syntax checks of scripts use the existing `npm run check:shell`, which includes Bash syntax and lifecycle tests.

## Validation and Acceptance

The implementation is accepted only after P1/P2 direct checks and a live, exact-revision consumer run proves that Codex itself invokes Docker successfully. The consumer must explicitly pass `CODEX_ALLOW_DOCKER=1` from a trusted workflow step and pin a reviewed Agent Relay commit. Within the actual Codex model subprocess, command execution must report both Docker client and server for `docker version`, a valid `docker compose version`, then successfully run an isolated Docker container, inspect its state and remove it. Failure must remain a failed test, not a static pass. Confirm no application containers are stopped, no global prune occurs, and the disposable test container is absent afterwards. A dedicated control test without opt-in must fail to access Docker under the Codex sandbox.

The rootful Docker authority is inherently equivalent to privileged host access even though the client process runs as `github-runner`, and any model with Docker permission can bypass ordinary filesystem sandbox assumptions by instructing the daemon to mount host paths. This residual security risk is intentional and must be stated explicitly; no claims of host-level containment are valid after enabling Docker.

Final downstream proof occurs in Monify PR #280, not in an Agent Relay implementation Progress item. Do not mark the two-repository end-to-end acceptance proven until the relevant live workflow runs and logs exist. Do not merge either PR without that proof.

## Idempotence and Recovery

An absent opt-in retains the current launcher behavior. A missing socket, invalid input or inaccessible daemon fails before any authenticated Codex command can run; no fallback to unrestricted permissions is allowed. Repeated tests use disposable fixtures, never production Compose volumes. The job wrapper already owns per-run cleanup and locking; do not replace that lifecycle. On a failed live Docker probe, clean up only the uniquely named test container through the trusted workflow's existing cleanup mechanism. Do not use `docker system prune` or change file owners recursively.

## Artifacts and Notes

Current implementation baseline:

    src/execution/codex-executor.ts:
      createCodexEnvironment(...) omits DOCKER_HOST
      createCodexArgs(...) omits /run parent for packaged Docker socket
    scripts/codex-run:
      clean toolchain_env omits DOCKER_HOST
    scripts/run-job-codex:
      authenticates a workflow-selected cached native CLI before running the trusted command

The expected packaged endpoint is `/run/docker.sock` (verify its actual presence at runtime; Agent Relay no longer provisions a dedicated socket); Docker Engine remains rootful. No runtime success observation has been made for this plan.

## Interfaces and Dependencies

The new public trust-boundary input is `CODEX_ALLOW_DOCKER` with enabled value `1` and absent/empty default disabled; other values fail closed. It is consumed by Agent Relay's existing `scripts/run-job-codex` and forwarded through the trusted launch environment to `src/run-codex.ts`, `scripts/codex-run` and `src/execution/codex-executor.ts`. Its output is the expected `DOCKER_HOST=unix:///run/docker.sock` and the opt-in sandbox permission for `/run`, after checking the actual packaged socket. There are no new npm dependencies, TCP Docker endpoints, credentials, daemon services, API handlers or shared source modules. The GitHub consumer later opts in using this formal environment boundary and updates its immutable runtime SHA.

## Plan Revision Notes

2026-11-22 / plan author: Prepared the smallest independently mergeable Agent Relay native-Docker capability required by the user's corrected Monify/Book Generator runtime contract. Kept the Monify consumer change out of this prerequisite plan, retained default-denied behavior for unrelated consumers and required real model-initiated Docker proof before final acceptance.

2026-11-22 / plan author: Repaired repository-evidence defect discovered during independent feasibility review. Current Ansible explicitly removes the old dedicated socket override. Replaced the invented managed endpoint with validation of the packaged `/run/docker.sock` and conditional sandbox admission of `/run`. No daemon, user, or Ansible installation change is authorized.
