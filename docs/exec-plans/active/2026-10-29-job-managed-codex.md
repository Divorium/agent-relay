# Run the existing native Codex launcher with a job-selected CLI

This ExecPlan follows `.agent/PLANS.md`. Progress, discoveries, decisions, and outcomes remain living evidence. The user approved native execution on the existing self-hosted runner, workflow-owned installation, reusable CLI cache, temporary authentication, existing Docker access, and the existing finalizer. No new service or coordinator is authorized.

## Purpose / Big Picture


A consumer workflow can select and install a Codex CLI without changing the host through Ansible. It supplies an absolute executable path and an isolated authentication directory to the existing Agent Relay entrypoint. Codex still runs natively as the non-root runner, with the existing filesystem policy, Docker endpoint, normalized logs, timeout handling, and no GitHub push credential. This increment supplies that launcher contract; Monify owns its consumer workflow and persistent version cache in a separate dependent change.

## Progress


- [ ] (2026-10-29 00:00Z) P1: The existing entrypoint forwards a validated job-selected executable and private Codex home, with explicit sandbox protection of authentication and cache directories; focused environment and launcher tests pass.
- [ ] (2026-10-29 00:00Z) P2: Host provisioning and toolchain checks no longer install or require global Codex; direct host-contract tests prove the distinction from workflow-selected execution.
- [ ] (2026-10-29 00:00Z) P3: Current documentation and a tested consumer example describe the native job contract, cleanup ownership and deployment prerequisite without claiming live deployment.

## Surprises & Discoveries


The existing launcher hard-codes `/usr/local/bin/codex` and `${HOME}/.codex/auth.json`. `createCodexEnvironment` currently forwards only HOME, the runtime root, and locale. Changing the shell launcher alone would therefore discard new workflow inputs. Open PR #69 independently removes global Codex as part of Antigravity provisioning; this work must not import or edit its unrelated changes.

## Decision Log


The user explicitly approved retaining the existing runner account and Docker permissions. This is not a new Docker isolation design. The proposed CLI path and authentication directory are trusted workflow inputs, never PR description or model output. Keep GitHub token exposure limited to the finalizer. Do not add Rootless Docker, a proxy, another account, an orchestration service, or an agent-owned Git operation.

## Outcomes & Retrospective


Implementation and live acceptance remain incomplete. Local fake-CLI tests are boundary tests, not proof of a real Codex model execution or Docker E2E.

## Context and Orientation


`runner/run-codex.mjs` calls `src/run-codex.ts` through compiled `dist/src/run-codex.js`. `src/execution/codex-executor.ts` constructs the clean child environment and permission profile. `scripts/codex-run` prepares per-execution tool caches using `scripts/toolchain-environment.sh`, validates the dedicated Docker socket, launches Codex and removes its temporary runtime on exit. `runner/finalize.sh` owns commits and pushes and is outside this increment. Host installation lives in `ansible/roles/agent_relay_host/tasks/toolchains.yml`; native toolchain smoke and its tests must no longer require the CLI that workflows now own.

## Plan of Work


P1 changes the existing environment and launcher contract to require `CODEX_BINARY` and `CODEX_HOME` for job-managed execution. Validate absolute paths and reject missing or unsafe authentication directories and executable paths before starting the child. Preserve `.git` read-only access, original runner HOME denial, trusted-runtime denial and Docker endpoint validation. The CLI installation is read-only to agent commands; the authentication directory is denied to agent commands. The CLI process itself still reads its authentication. Do not log credentials. Keep the runtime executable discoverable relative to the installed entrypoint so a pinned, separately checked-out runtime can be integration-tested without replacing the host installation. Add direct tests covering positive execution, missing inputs, cleanup after failure, and preservation of exact exit codes.

P2 removes global Codex installation from Ansible and removes only the corresponding installed-host requirements from toolchain checks and their tests. It does not uninstall arbitrary existing packages, change users, sockets, permissions, services, runner registration, or another toolchain. Existing global installations are unused, not destructively removed during a PR run.

P3 updates current README, operations/specification text and the consumer example with the formal input contract. Preserve historical completed plans. The repository's own Codex workflow must provide the new inputs before it adopts the launcher; its preparation must use the same supported job-owned setup path, not persistent manual login. Public artifact uploads are not added. Implementation tests remain under existing CI.

## Concrete Steps


Working directory: the dedicated Agent Relay implementation checkout. First write and run the focused failing tests. Then implement the smallest launcher changes and rerun them. Run `npm ci`, `npm run typecheck`, `npm test`, `npm run check:runtime`, `npm run check:shell`, and `npm run check:node-scripts`. Run `npm run check:toolchain` on the self-hosted runner; a pre-existing managed Rust failure must be reproduced unchanged on the base and reported separately, not hidden or weakened.

The consumer acceptance uses an exact pinned snapshot of this PR runtime, a workflow-provided native CLI and temporary authentication. It executes a real Codex command and a Docker client/server probe, checks that model commands cannot read authentication or modify Git metadata, and confirms cleanup. Host deployment is not implied by a successful source-level run.

## Validation and Acceptance


The increment passes when a CLI installed outside `/usr/local` is invoked through the existing entrypoint without host Codex login, the model command permissions preserve the previous boundaries, the real selected child exit code is returned, temporary runtime is removed on normal failure, and provisioning does not reinstall global Codex. Tests must demonstrate that the new inputs survive environment sanitization and that credentials never become command arguments or published output. Missing tools, refused credentials, and Docker failures remain failures. Final live acceptance of Monify's combined change is recorded in its dependent PR, not substituted for focused Agent Relay tests.

## Idempotence and Recovery


Work only on `feat/job-managed-native-codex`; never write main. Preserve active executions and unrelated PR #69. File writes use expected branch heads or blob SHAs. Runtime cleanup removes only directories created for the current invocation. Cache removal, daemon-wide pruning and system mutations are excluded. On interruption retain a truthful unchecked Progress item and exact evidence; do not instruct a human to execute missing repository tasks.

## Artifacts and Notes


Planning base: `7ab13b761c81b6efa3004ab2f9d08b03bc6d4cd0`. Monify integration starts from `27e4173a18d55106649b6a43545283a863e9b54c`. Repository-native CI, exact commits and focused command transcripts are the evidence locations. No validation result has been asserted yet.

## Interfaces and Dependencies


The public boundary remains the existing CLI entrypoint plus environment variables. `CODEX_BINARY` is the workflow-selected absolute executable; `CODEX_HOME` is the private job-owned authentication/configuration directory. Existing plan, workspace, transcript and runtime inputs retain their meanings. The workflow is responsible for installation/version selection, login and eventual removal of its authentication directory. The launcher is responsible for per-execution tool-state cleanup and restricted invocation. Use existing Node, Bash, filesystem and process primitives; do not add npm runtime dependencies.

## Plan Revision Notes


2026-10-29: Initial prerequisite increment, derived from the approved recommendation. Consumer workflow activation and Docker E2E are deliberately separate from the launcher contract rather than hidden deployment assumptions.
