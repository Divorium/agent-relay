# Run the existing native Codex launcher with a job-selected CLI

This living ExecPlan follows `.agent/PLANS.md`. The user approved native execution on the existing self-hosted runner, workflow-owned installation, reusable CLI cache, temporary authentication, existing Docker access and trusted finalization. No new service or coordinator is authorized.

## Purpose / Big Picture


A workflow selects Codex without an Ansible deployment or persistent host login. The existing Agent Relay CLI runs it natively with the previous filesystem policy, Docker endpoint, output normalization and timeout handling. The workflow chooses version/credentials; the setup helper implements their bounded cache and authentication lifecycle. Monify integrates that formal CLI in its separate dependent PR.

## Progress


- [x] (2026-10-29 03:10Z) P1 launcher: job-selected executable/home/install root pass through environment sanitization, authentication and CLI permissions are explicit, and cleanup/cancellation tests pass on self-hosted.
- [x] (2026-10-29 03:10Z) P1 cache: atomic version installation, concurrent reuse, active leases, bounded retention and failure cleanup are implemented. A fake correct-version substituted executable is rejected by a trusted tree digest before execution/login.
- [x] (2026-10-29 03:10Z) P2: Ansible and host checks no longer install or require global Codex; other host-toolchain checks remain unchanged. CI 40808202330 passes typecheck, unit/coverage, runtime build, shell lifecycle and Node gates, then fails the managed Rust PATH gate.
- [x] (2026-10-29 03:10Z) P3 documentation/consumers: current host documentation and examples describe workflow-owned Codex; credentialed execution uses an immutable separate runtime, not incoming PR code.
- [ ] (2026-10-29 03:10Z) P3 final review: verify the credentialed PATH hardening and current tests. Review found that inherited GITHUB_PATH could choose fake bash/node before the trusted helper; fixed absolute shell and explicit trusted PATH require fresh CI/review.
- [ ] (2026-10-29 03:10Z) Final live acceptance: Monify's initial model/Docker proof passed, but its final integrity-enabled setup failed and is under diagnosis. Keep this plan active; no deployment or merge readiness is claimed.

- [ ] (2026-10-31 02:57Z) P4 follow-up: split host toolchain smoke from Node.js/Codex CI while retaining an independently runnable host diagnostic; targeted CI and regression tests must pass. Rust-requiring consumer jobs continue to install their declared toolchain themselves.

## Surprises & Discoveries


The original launcher hard-coded `/usr/local/bin/codex` and host HOME authentication; the environment factory discarded job inputs. Both layers now use an explicit workflow contract. The prior detached process also needed signal handling to prevent abandoned execution on runner cancellation.

The first live consumer proof failed because the cache was below sandbox-denied HOME; RUNNER_TOOL_CACHE works without relaxing that denial. Security review exposed cache substitution and PR-selected credentialed helper risks, followed by inherited interpreter PATH. Trusted hash validation and immutable helper selection address the first two; the latest workflow explicitly selects its shell and resets interpreter environment.

Open PR #69 independently removes Codex with Antigravity work; do not import or edit its unrelated changes. The managed Rust gate remains failing on the host and has not been waived or repaired by this feature.

The 2026-10-31 follow-up identified the exact unwanted dependency: `package.json`'s `check` invokes `check:toolchain`; both `.github/workflows/ci.yml` and the Codex preflight consequently fail for a host Rust PATH mismatch although the Agent Relay app is Node.js/TypeScript. The regression test first failed on run 41162168023 for both the combined gate and the missing independent diagnostic.

## Decision Log


Retain the existing runner account and Docker privileges. This is not a new host isolation design. Workflow inputs select a reviewed runtime, pinned CLI and private authentication; no model output selects executable trust. The supported setup helper is an existing-runtime CLI boundary, not a new service. Installation ownership remains with workflow configuration, not Ansible.

Integrity pins are reviewed with the runtime and stored outside the writable binary cache. Version output is not authentication of an executable. Credentialed steps must use absolute shells, a fixed trusted PATH and no inherited BASH_ENV/ENV/NODE_OPTIONS. Do not broaden user/sudo/Docker permissions or expose GitHub write tokens to model commands.

The user authorized detaching host-wide Rust/Java/Go diagnostics from Codex validation, while keeping language installation in each consuming application's build/test jobs. Preserve the host smoke script and its tests rather than disabling or weakening it. The manually dispatched host diagnostic remains honest about the provisioned VM, and Monify already installs its Rust toolchain in Rust-dependent jobs.

## Outcomes & Retrospective


Native execution, warm cache, real Docker and synthetic sandbox denials were observed in Monify runs 40804598116 and 40805358355 on earlier runtime revisions. Controls browser E2E also passed separately. Final security-patched acceptance, the complete host gate and final review remain unresolved. Main and the managed host installation have not been changed.

## Context and Orientation


`runner/run-codex.mjs` invokes compiled `src/run-codex.ts`; `src/execution/codex-executor.ts` owns clean environment, permissions and process lifecycle. `scripts/codex-run` validates inputs/socket and removes private tool state. `scripts/run-job-codex` owns versioned cache, leases, login and authentication cleanup. `scripts/codex-cache-digest.mjs` checks installations against `config/codex-integrity.json`. Host provisioning remains in `ansible/roles/agent_relay_host/tasks/toolchains.yml`; `runner/finalize.sh` remains the trusted Git writer.

## Plan of Work


P1 implements and tests the explicit native CLI/environment contract in `src/run-codex.ts`, `src/execution/codex-executor.ts`, `scripts/codex-run` and `scripts/run-job-codex`. Preserve previous sandbox rules and no raw credentials in the child environment. Cache only installed software, not authentication. Validate integrity before any cached execution; scope cleanup to owned paths and hold leases around active versions.

P2 removes only global Codex installation and corresponding host smoke expectations from Ansible and tests. Do not uninstall arbitrary existing packages, change users, daemon/socket settings, runner registration or other toolchains.

P3 reconciles README, operations/specification and both workflow consumers. Incoming PR code is validated without Codex credentials; credentialed execution uses an immutable independent runtime. Protected interpreter environment is checked directly in tests. Retain failure reporting and never add public artifact uploads.

## Concrete Steps


Working directory: the dedicated Agent Relay feature checkout. Execute `npm ci`, `npm run typecheck`, `npm test`, `npm run check:runtime`, `npm run check:shell`, `npm run check:node-scripts`, and `npm run check:toolchain`. Run `node --test test-system/job-codex-*.test.mjs` for detailed lifecycle diagnostics. Run `npm run check:toolchain` separately for host provisioning diagnosis; do not suppress its Rust failure or let it block the unrelated Codex/application CI gates. Consumer acceptance uses a pinned runtime and real model/Docker commands; report input/runtime hashes, command results and cleanup.

P4 removes `check:toolchain` from the Node.js `check` aggregate and its PR-CI job, retaining all actual code/coverage/runtime/shell/Node validation. Add a separate manual `host-toolchain.yml` for complete host diagnostics and a regression test proving both the separation and continued accessibility. Do not modify host settings, toolchain path expectations, or unrelated consumer workflows.

## Validation and Acceptance


Require a non-global CLI through the existing entrypoint, job-local login, preserved model permissions, actual child exit codes, cleaned private state, no Ansible reinstall, trusted integrity checks and credentialed shell selection. Fake-CLI tests establish local boundaries, not model success. A real application browser run and exact consumer SHA must be identified separately. Final acceptance of the combined change is recorded in Monify, not inferred from Relay CI.

## Idempotence and Recovery


Write only `feat/job-managed-native-codex`; preserve main and unrelated PR #69. Use expected heads/blob identities for mutations. Cleanup removes only invocation-owned state. Cache retention may remove idle versions only after an exclusive lease, never active versions. No daemon-wide prune or system mutation is permitted. Unhandled machine loss is not guaranteed cleanup; report remaining artifacts truthfully.

## Artifacts and Notes


Base: `7ab13b761c81b6efa3004ab2f9d08b03bc6d4cd0`. Relay CI 40805205876 first passed 130 TypeScript tests with 100 percent production coverage and 11 shell lifecycle tests before the known host Rust failure. CI 40808202330 revalidated later code after stale workflow assertions were corrected. Cache-integrity reference was obtained from a clean credential-free installation in run 40806852517. The local poison-cache regression failed before and passed after the digest fix. Final review and live security-patched acceptance remain pending.

## Interfaces and Dependencies


Workflow setup inputs are CODEX_VERSION, CODEX_CACHE_ROOT, CODEX_TOKEN and RUNNER_TEMP. The launcher receives CODEX_BINARY, CODEX_INSTALL_ROOT and private CODEX_HOME plus existing plan/workspace/transcript inputs. The workflow owns pins, credentials and invocation; Agent Relay supplies the setup/launcher CLI and normalization. Use existing Node, Bash, filesystem/process primitives and flock; add no npm runtime dependency or service.

## Plan Revision Notes

2026-10-31: User-approved follow-up corrects the previously accepted dependency of Codex on the provisioned host Rust PATH. Diagnostic remains intact and separately runnable; Node.js validation and optional application Rust setup are explicitly independent. The prior failed toolchain runs remain valid historical evidence.


2026-10-29: Reconciled retained implementation and observed test evidence. Explicitly recorded cache ownership, review corrections and remaining host/final-revision gates without claiming deployment or completion.
