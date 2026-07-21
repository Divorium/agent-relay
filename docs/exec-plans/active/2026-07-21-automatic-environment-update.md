# Automate Agent Relay environment deployment and rollback

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current while work proceeds. Maintain this document according to `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

The reviewed baseline is `main` commit `e9ec636e5abf383f8831fc126b99f04e2e005a3c`. Before implementation starts, verify that this commit exists and is an ancestor of `HEAD`. If `main` advances, recheck every current-state statement, path, workflow, runner contract, GitHub-setting assumption, package script, and Docker decision. Update the baseline and record the review in `Progress`; do not silently implement against another revision.

Codex may use read-only Git commands such as `status`, `diff`, `show`, `grep`, `rev-parse`, `show-ref`, `cat-file`, and `merge-base`. Codex must not run `git add`, `commit`, `merge`, `rebase`, `reset`, `restore`, `checkout`, `cherry-pick`, or `push`; the GitHub runner owns commit and push. Workflow files, CODEOWNERS, rulesets, environments, and GitHub settings are human-maintained. Codex must not edit `.github/workflows/`, `examples/github-actions/`, or GitHub configuration.

## Purpose / Big Picture

Replace:

    cd /srv/github-runner/storage/agent-relay
    git pull --ff-only
    ./update.sh

with a controlled deployment system for the single long-lived Agent Relay VM.

After this work:

- a merge into protected `main` validates and deploys the exact pushed SHA only while both target SHA and trusted workflow-control SHA remain current;
- an authorized operator can manually select one same-repository branch, resolve it once to an exact SHA, validate it, run that revision's managed `update.sh`, and always restore unchanged LKG `main`;
- controller stops primary listener and drains active `github-runner` workers before checkout mutation;
- second persistent deployment runner remains independent of the primary Agent Relay runtime;
- root-owned controller alone owns Git mutation, managed updater execution, runtime activation, accepted state, restoration, and restart recovery;
- failed `main` deployment attempts restore previous local LKG without requiring GitHub connectivity;
- workflow cancellation cannot abandon a post-mutation transaction because root systemd service owns it;
- outcomes distinguish validation failure, unauthorized request, superseded request, migration required, drain failure, target failure, restoration success, restoration failure, and critical recovery.

Selected branches are trusted same-repository code and execute with broad host authority because the purpose is to test the real privileged updater. This is **best-effort rollback for accidental failures**, not malicious-code isolation and not a VM snapshot. Root-equivalent target code can defeat every same-VM mechanism.

The feature proves local runtime integrity and primary listener readiness. It does not claim GitHub has already scheduled a post-deployment job; doing so without unrelated queued work racing the smoke job requires a separate dynamic-routing design.

Temporary branch testing covers updater/runtime behavior under the installed deployment protocol. It does not apply or validate fresh installation, migrations, workflows/settings, runner registration, sudoers, service-control-plane changes, or breaking controller protocol. Such a target is rejected as unsupported rather than reported as fully tested.

`DOCKER_PROVISIONING_ENABLED=0` remains authoritative. Do not re-enable Docker provisioning or reopen PR #46.

## Progress

Keep append-only. Checked implementation items require repository location plus passing automated evidence, or reproducible command plus captured result. Blocked items remain unchecked and use `[blocked]`.

- [x] (2026-07-21) Reviewed installer, updater, workflows, runner scripts, documentation, and package scripts on baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- [x] (2026-07-21) Confirmed primary runner cannot synchronously update itself because updater stops listener and waits all `github-runner` workers.
- [x] (2026-07-21) Reviewed GitHub runner groups, selected workflows, environments, dispatch refs, rerun semantics, token lifetime, and concurrency queueing.
- [x] (2026-07-21) Selected second persistent deployment runner.
- [x] (2026-07-21) Converted plan to living ExecPlan structure.
- [x] (2026-07-21) Repeated adversarial reviews corrected checkout-before-drain, overstated recovery, LKG retention, transaction ownership, exact-SHA validation, queue replacement, authorization, cancellation, bootstrap, runtime staging, updater authority, controller upgrades, and Docker scope.
- [x] (2026-07-21) Twelfth review aligned manual scope to branch-only testing, reduced privileged workflows to two, added host-schema gating, separated immutable and mutable control-plane checks, introduced dedicated health account, and preserved administrator-managed update.
- [x] (2026-07-21) Thirteenth review removed manifest-digest recursion, required workflow-control freshness for every request, strengthened local-only credential integrity checks, added CODEOWNERS/ruleset workflow protection, clarified allowed ignored checkout state, and defined transaction-ref cleanup.
- [ ] Complete Milestone 0 using actual GitHub organization evidence.
- [ ] Revalidate baseline and protected human-owned files before implementation.
- [ ] Implement protocol, portable validation, updater stage mode, manifest, health, and host-schema gate.
- [ ] Implement install/migration/bootstrap for deployment runner, health account, controller, recovery repository, state, locks, and runtime staging.
- [ ] Implement workflows, durable submission, transaction, drain, checkout, update, activation, validation, acceptance, restoration, cancellation, and boot recovery.
- [ ] Add deterministic tests, full validation, exact-head CI, independent review, and production/disposable demonstrations.
- [ ] Complete retrospective/evidence and move same plan only after every item is checked.

## Surprises & Discoveries

- Active jobs execute trusted-checkout scripts; drain must precede reset.
- Same primary UID retains self-wait deadlock; deployment runner needs distinct UID.
- Privileged target defeats same-VM controls; rollback remains best effort.
- Existing updater lock does not cover Git, activation, or restoration.
- Exact validation must not depend on either self-hosted runner.
- Current CI does not validate `main` push merge result.
- `queue: max` retains up to 100 pending items, but dispatch order is not guaranteed.
- Manual dispatch can use non-main workflow ref; reject it.
- Workflow reruns retain original SHA/ref/actor; temporary mode requires fresh run attempt 1.
- Plain SHA does not retain Git object; use local bare recovery repository and ref.
- Checkout SHA does not prove active runtime provenance; bootstrap must redeploy exact main.
- Current updater deletes active runtime early; managed updater must produce stage only.
- Canceled workflow cannot own recovery; root service must continue transaction.
- Whole live-runner directory hashes are unstable; immutable files and mutable transitions require separate checks.
- Credential contents need integrity comparison but must never be logged or exported. Use local-only digests retained only in root-private transaction state.
- Health under `github-runner` exposes its credentials. Check readability as that user, execute health as dedicated locked user.
- Runtime manifest cannot hash itself. Its `payloadTreeSha256` covers the canonical runtime tree excluding the manifest; manifest is separately schema-validated and immutable after finalization.
- Branch-only manual input matches operator request; PR/tag/SHA/URL targets are unnecessary.
- Target may validate while requiring host migration. Compare `requiredHostSchema` and protocol before drain.
- Direct unmanaged updater bypass desynchronizes journal/LKG; administrator update must route through controller.
- Trusted workflow file on moving `main` can become stale while queued. Every request carries `controlPlaneSha`; controller requires it equal current `origin/main` before mutation.
- Ruleset alone does not protect workflow contents. Require PR-only `main`, CODEOWNERS approval for deployment workflows and deployment-control files, no force/delete, and no unauthorized bypass.
- Ignored checkout state is not generally clean. Explicitly allow only managed `dist/` and repository dependency cache policy; any other ignored/untracked path blocks mutation.

## Decision Log

- Use second persistent organization runner; reject ephemeral/JIT for this one durable VM.
- Support automatic current-main deployment and manual same-repository branch testing only.
- Use two direct workflows: `.github/workflows/deploy-main.yml` and `.github/workflows/deploy-branch.yml`, both selected at `refs/heads/main` for deployment runner group.
- Use GitHub-hosted Linux for exact portable validation; retain full host-specific checks elsewhere.
- Temporary approval is a separate GitHub-hosted environment job before shared privileged job concurrency.
- Privileged jobs share job-level `concurrency.group: agent-relay-host-deployment`, `queue: max`, and no `cancel-in-progress: true`.
- Temporary requests require main workflow ref, run attempt 1, approved environment, and root-owned operator allowlist.
- Automatic and temporary requests carry `controlPlaneSha`; controller compares it to current `origin/main` after fetch and before drain. Main also requires target SHA equal current `origin/main`; otherwise `superseded`.
- Root controller owns complete transaction; workflow only validates, approves, submits, and polls.
- Stop listener and bounded-drain workers before mutation; timeout kills no active job and restarts listener.
- Run Git as recorded administrator; deployment account cannot directly mutate checkout/root state.
- Managed updater protocol runs target updater as root in transient systemd unit, fixed environment, stage-only runtime output, no activation/state ownership.
- Preserve administrator command `agent-relay-deploy admin-update-current-main`; direct unmanaged `update.sh` refuses after migration.
- Repository declares deployment/updater/manifest/controller protocol ranges and `requiredHostSchema`; incompatible target returns before drain. Main may return `migration_required`; temporary returns `unsupported_scope`.
- Store LKG object in root-owned bare recovery repository under `refs/agent-relay/last-known-good`; transaction target refs are deleted only after terminal success/restoration and retention policy.
- Runtime stage, active, and backup are same filesystem and activated through journaled ordered renames; do not claim impossible multi-directory atomicity.
- Immutable control-plane inventory includes controller/helpers, selected units, sudoers, protocol files, managed-lock metadata, and CODEOWNERS-protected repository control files as applicable. Mutable journals/refs/logs/runner diagnostics/work use phase-specific schema checks.
- Runner credential/config files are checked for location/type/owner/mode and local-only content digest equality across target execution. Digests stay root-private, are never printed/exported, and are discarded after terminal transaction.
- Verify runtime readability as `github-runner`; execute fixed health under `agent-relay-health` with private network, strict filesystem/home protection, inaccessible checkout/runner/home/work/recovery, and read-only runtime bind at `/run/agent-relay-runtime`.
- Runtime manifest `payloadTreeSha256` excludes manifest itself and covers canonical relative path, type, mode, size, and content digest for every payload entry.
- Protect `main` with PR-only ruleset, no force/delete, required checks, CODEOWNERS review for deployment workflows/control metadata, and no unauthorized bypass.
- Do not claim post-deployment GitHub job execution.
- Keep Docker provisioning disabled.

Dates/authors: 2026-07-21 architecture and adversarial review under operator instruction. Convert any changed decision into a dated explanatory entry rather than silently editing history.

## Outcomes & Retrospective

Plan remains active and plan-only; no production behavior changed. Scope is automatic current main, manual branch test, safe drain, stage/activate, local accepted state, and best-effort accidental recovery. It excludes hostile isolation and temporary infrastructure migration.

Update after each accepted milestone. On completion record production and disposable-VM results and move this same file to `completed`.

## Context and Orientation

Current installation:

- source `/srv/github-runner/storage/agent-relay` administrator-owned; active `dist` root-owned inside source;
- primary `work`, `runner`, `home` owned by `github-runner`;
- builder `build`, `build-home` owned by `agent-relay-builder`;
- `/etc/agent-relay/administrator` records administrator and is current legacy updater lock;
- primary service `actions.runner.Divorium.gh-runner.service` uses `KillMode=process`;
- installer uses PAT only to obtain short-lived registration token and does not persist PAT;
- updater is admin-only, obtains sudo interactively, stops listener, waits workers indefinitely, deletes/rebuilds active `dist`, restarts listener, Docker disabled;
- current self-hosted workflows use bare `[self-hosted]` and must be relabeled before deployment runner starts.

Expected additions include deployment runner/home/work, locked `agent-relay-health`, runtime stage/backup, `/var/lib/agent-relay-deploy` state/recovery/controller/logs, fixed submit/status helpers, managed transaction/recovery units, operator allowlist, deployment sudoers, managed lock, and host schema marker.

## Plan of Work

### Milestone 0: Prove GitHub feasibility

Verify actual organization supports:

- additional runner group for this public repo;
- selected workflow restrictions writable for exactly the two deployment workflows on `refs/heads/main`;
- required-review environment and desired self-review prevention;
- GitHub-hosted validation;
- `queue: max` and acceptable 100-pending bound;
- full-SHA action pin policy;
- PR-only protected main with required checks, CODEOWNERS review on deployment-control files, no force/delete, and no unauthorized bypass;
- minimum token permissions.

Missing/incompatible control => `[blocked]`; do not install privileged runner.

### Milestone 1: Protocol and portable validation

Add versioned repository metadata for deployment/updater/controller protocol ranges, host schema, runtime manifest, and fixed health interface.

Workflow performs `npm ci` first, then `npm run check:portable`. Portable check must run on GitHub-hosted Linux and cover typecheck, tests, runtime build, shell syntax, Node syntax, and portable system-contract tests without production systemd mutation, Docker daemon, PAT, Codex login, or self-hosted paths. Existing full `npm run check` remains.

Temporary-scope validation compares target against current main metadata and installed schema/protocol. Migration-only or incompatible branch is rejected before privileged submission.

### Milestone 2: Install, migrate, bootstrap

Fresh install and restartable existing-host migration must:

- create locked deployer and health accounts, isolated paths, deployment runner service/group/label;
- configure GitHub controls while PAT is memory-only and use separate short-lived registration token;
- install controller versions, helpers, units, sudoers, operator allowlist, managed lock, state, recovery repository, stage/backup, and bounded logs;
- require human-owned workflow routing changes before enabling second runner;
- perform dual-lock cutover from legacy updater lock;
- keep deployment runner stopped until bootstrap complete;
- bootstrap exact current main by hosted portable validation evidence, drain, fallback retention, managed stage update, stage/health validation, activation, accepted Git object/ref, accepted/deployed state;
- write bootstrap marker last, start deployment runner last, retain no PAT/token.

Partial/conflicting state fails closed; exact complete rerun is validation-only.

### Milestone 3: Human workflows

`deploy-main.yml` triggers on main push and manual retry of current main. It checks current workflow ref for manual run, resolves exact target/control-plane SHA, performs hosted `npm ci` + portable check, then privileged submit/poll job enters shared concurrency and deployment runner group. `superseded` is successful no-op; `migration_required` is explicit non-success requiring admin migration.

`deploy-branch.yml` is `workflow_dispatch` from main only, accepts branch name only, rejects PR/tag/SHA/URL/merge-ref/fork/malformed input, rejects rerun attempt, resolves exact SHA once, performs portable and temporary-scope validation, then separate hosted environment-approval job, then shared-concurrency privileged submit/poll job.

Both privileged jobs use minimum permissions, fixed timeouts, full-SHA actions, bounded normalized logs, no target workflow code, and canonical request. All ordinary self-hosted jobs/examples route to `agent-relay-main` before deployment runner enablement.

### Milestone 4: Durable submission/service

Deployer can invoke only no-argument root-owned submit-main, submit-branch, and read-only status helpers. Request arrives as bounded canonical JSON via stdin/fixed descriptor, is schema-validated, written exclusively and durably, then root transaction unit starts.

Transaction service claims request under managed lock, writes strict durable journal, and continues independently after workflow cancellation. Only one pending/active request exists. Boot recovery unit resolves nonterminal journal before primary runner may start. Status is bounded/sanitized and never reveals secrets or root paths unnecessarily.

### Milestone 5: Host transaction

Preflight before stop:

- validate request/actor/workflow path/ref/run attempt/control-plane SHA/protocol/bootstrap/host schema/controller;
- validate checkout canonical path, owner, expected remote, no submodules/alternate worktree, tracked cleanliness, and allowed ignored paths only (`dist/` plus explicitly documented dependency cache if retained); unexpected untracked or ignored path blocks;
- validate recovery repo/LKG, active deployed state/runtime manifest, stage/backup emptiness, same filesystem/device, free-space reserve, journal consistency, control-plane inventory and runner credential metadata/content digests;
- fetch as recorded administrator with bounded timeout;
- require request `controlPlaneSha == origin/main` for every mode;
- main: require target SHA equals current `origin/main`, otherwise `superseded`;
- branch: require exact resolved object and compatible temporary scope;
- copy target object into recovery repository under transaction ref before mutation.

Drain:

- stop only primary listener;
- bounded wait all `github-runner` workers; never kill them;
- failure/timeout => restart listener if initially active, no checkout/runtime mutation, terminal `drain_failed`;
- success => runtime-mask primary and monitor no listener/worker appears.

Managed update:

- journal before each irreversible step;
- reset/clean checkout as recorded administrator to exact target;
- create stage/backup on same filesystem as active `dist`;
- run target updater as root transient service/cgroup, fixed sanitized environment, bounded output/time, TERM/KILL escalation, no GitHub/runner env;
- updater produces stage only and declared allowed non-control-plane changes; no activation, journal, refs, runner config, controller, unit, sudoers, or lock mutation;
- require updater cgroup/decedents gone, primary still masked/no processes, active runtime unchanged, immutable inventory unchanged, mutable state expected, credential local digests equal;
- validate stage regular-only shape and finalized manifest; `payloadTreeSha256` excludes manifest itself and is recomputed canonically.

Activation/health:

- retain old active runtime as backup;
- journal ordered same-filesystem renames stage/active/backup and recover every crash window by manifest/digest, not names alone;
- test active readability as `github-runner` without executing target under that account;
- run fixed health as `agent-relay-health` in strict transient sandbox with only active runtime read-only bind; validate bounded machine JSON.

Main:

- optional backward-compatible controller candidate: stage/self-test/schema-check/atomic symlink switch/rollback on failure;
- accept target recovery ref and matching metadata only after runtime/controller success;
- unmask/start primary and verify listener readiness;
- cleanup transaction target ref and backups only after terminal retention rules.

Temporary:

- never activate controller or update LKG;
- record target result;
- restore exact local LKG checkout/runtime/controller without GitHub fetch;
- run stable managed updater if manifest requires convergence of allowed host changes;
- health-check restoration, then unmask/start primary;
- report target and restoration separately.

Any post-mutation failure invokes restoration. Unproven restoration => primary stays masked/stopped, LKG unchanged, evidence retained, `critical_recovery`, no automatic retry loop.

### Milestone 6: Recovery/admin/upgrade

Administrator-only `recover` never retries target; restores LKG checkout/runtime/controller locally and starts primary only after proof.

Administrator-only `admin-update-current-main` preserves manual operational path but uses same managed transaction. Direct unmanaged updater refuses after migration except authenticated controller mode.

Administrator-only `acknowledge-repair` mutates no host state, requires independently verified active SHA/runtime/controller evidence, archives critical journal, and cannot promote temporary SHA/change LKG.

Controller candidate must be backward compatible with active journal/host schema. Immutable version dirs, atomic symlink, retained previous version. Breaking host/control-plane schema changes require explicit administrator migration under managed lock. Automatic main returns `migration_required`; temporary returns `unsupported_scope` before drain.

### Milestone 7: Documentation and acceptance

Document final installed behavior only after implementation: setup/migration, two workflows, branch-only target, approval/rerun/control-plane freshness, portable validation, schema gate, drain, locks, durable transaction, stage/activation, health sandbox, recovery, controller upgrade, admin commands, critical state, bounded logs, Docker disabled, best-effort limitation.

## Concrete Steps

Baseline:

    git cat-file -e e9ec636e5abf383f8831fc126b99f04e2e005a3c^{commit}
    git merge-base --is-ancestor e9ec636e5abf383f8831fc126b99f04e2e005a3c HEAD
    git status --short
    git diff --name-status e9ec636e5abf383f8831fc126b99f04e2e005a3c...HEAD
    git grep -n 'DOCKER_PROVISIONING_ENABLED=0' e9ec636e5abf383f8831fc126b99f04e2e005a3c -- update.sh
    git diff --exit-code e9ec636e5abf383f8831fc126b99f04e2e005a3c -- .agent/PLANS.md .github/workflows examples/github-actions CODEOWNERS

Expected: success, Docker disabled, unexplained protected-file mismatch => `[blocked]`.

Focused tests cover GitHub contract fixtures, protocol/schema, branch resolver, portable validation, install/migration/token non-persistence, lock cutover, request admission/cancellation, preflight/clean state/object retention/capacity, drain timeout, managed updater/cgroup/stage/Docker, credential integrity, manifest digest, activation crash windows, health sandbox, main/superseded/migration-required, temporary restore, controller switch, boot/critical recovery, admin commands, logs.

Complete validation:

    npm ci
    npm run typecheck
    npm test
    npm run check:runtime
    npm run check:shell
    npm run check:node-scripts
    npm run check:toolchain
    npm run check:system
    npm run check
    git diff --check
    git grep -n 'DOCKER_PROVISIONING_ENABLED=0' -- update.sh

Production demonstrations: migration/bootstrap; temporary success+restore; temporary failure+restore; drain timeout no mutation; stale control-plane branch request rejected; superseded main no mutation; current main accepted; administrator managed update.

Disposable VM: failed main offline restore; restart during checkout/update/activation/restoration; controller switchback; double failure critical; immutable/control credential modification detected; higher host schema no mutation.

## Validation and Acceptance

Acceptance requires observable evidence:

- actual GitHub group/workflow/environment/ruleset/CODEOWNERS/action-pin/permission/queue controls;
- branch-only scope and rejection matrix;
- exact hosted validation before submission;
- non-main workflow ref, stale control-plane SHA, rerun, unapproved environment, unauthorized actor rejection;
- three-run queue test, host serialization, superseded handling;
- drain no-mutation and listener restoration;
- deployer ownership restrictions and administrator-owned Git mutations;
- protocol/schema rejection before drain;
- stage-only updater and unchanged active runtime/control plane/credentials;
- nonrecursive manifest digest and regular-only runtime;
- health user cannot access network, checkout, runner credentials/home/work, recovery state;
- current main accepted and listener ready;
- temporary always returns LKG, no controller/infrastructure activation;
- offline restoration and deterministic every-phase journal recovery;
- bounded normalized logs/root-only transcript/truncation/retention/credential omission;
- critical recovery preserves evidence, leaves primary unavailable, requires administrator action.

Complete only when every Progress item checked, tests/CI pass, independent review has no action points, and all production/disposable demonstrations pass.

## Idempotence and Recovery

Fresh install one-time. Migration classifies absent/exact/partial/conflict; exact complete is validation-only. Managed lock serializes migration/deploy/admin/recovery; dual-lock cutover prevents old updater overlap.

Pending request exclusive/durable. Journal strict, bounded, credential-free, atomically replaced and phase-complete. Root-private credential digests are transaction integrity metadata, not exported evidence, and are deleted at terminal cleanup.

Activation uses same-filesystem stage/active/backup and ordered journaled renames. Recovery identifies valid runtime by finalized manifest and payload digest.

LKG publication stores object/ref before matching accepted metadata. Temporary/failed target never changes LKG. Transaction refs are retained through restoration and deleted only after terminal evidence retention permits.

Recovery never retries target. Unknown/contradictory state blocks mutation and primary start but permits bounded read-only status.

Tests use temporary roots/local repos/fake APIs/processes/services and disposable VMs; no production mutation except approved demonstrations.

## Artifacts and Notes

Keep append-only.

- 2026-07-21: reviewed baseline repository contracts and GitHub runner/group/environment/dispatch/rerun/concurrency documentation.
- 2026-07-21: created draft PR #47, plan only.
- 2026-07-21: converted to living ExecPlan and performed repeated adversarial reviews.
- 2026-07-21: twelfth review simplified to automatic-main/manual-branch, two workflows, host-schema gate, stable control-plane checks, health account, administrator managed path.
- 2026-07-21: thirteenth review corrected manifest digest recursion, workflow-control freshness, credential integrity, workflow-file protection, allowed ignored state, and transaction-ref cleanup.

Future evidence: settings/API, workflow/CODEOWNERS/ruleset hashes, tests/counts, ownership/modes, migration/locks, request/journal, drain, manifests/digests, sandbox, recovery refs/fsck, transactions/logs, production/disposable results, CI and final review.

Official GitHub docs reviewed: self-hosted runner groups/access REST, deployments/environments, reruns, workflow syntax/concurrency, GITHUB_TOKEN.

Non-goals: malicious isolation; VM/disk/network/systemd/resource disaster recovery; autoscaling/ephemeral/JIT; persistent PAT/App; PR/fork/tag/SHA/arbitrary repo/URL targets; parallel mutation; guaranteed GitHub post-deploy job; VM snapshots; general data/package reversal; temporary infrastructure testing; Docker re-enable.

## Interfaces and Dependencies

No public Agent Relay job/Codex prompt/request/result/finalizer/workspace contract change.

Identities: recorded administrator; primary `github-runner`/`gh-runner`/`agent-relay-main`; builder; deployer/`gh-deploy-runner`/`agent-relay-deploy`; health `agent-relay-health`; group `agent-relay-deployment`.

Canonical request: schema, request/run/attempt/actor/event/workflow path/ref/controlPlaneSha, branch if temporary, targetSha, validation identity, required host schema, protocol versions; no credential.

Managed updater env: mode, transaction, source/build/stage, target SHA, installed schema, fixed locale/path only.

Runtime manifest: schema, target, protocols, required host schema, health entrypoint, `payloadTreeSha256` excluding manifest, payload count/bytes, timestamp, finalized marker. Canonical digest includes relative path/type/mode/size/content digest; only regular dirs/files, no symlink/device/socket/FIFO, reject unexpected hard links and group/other writable entries.

Immutable inventory: controller/helpers, symlink target metadata during updater phase, selected units, sudoers, protocol files, lock metadata. Runner credential/config files: location/type/owner/mode plus local-only digest equality. Mutable state: strict schemas and phase transitions.

Bounded config: validation/approval/request/drain/fetch/updater/TERM/KILL/health/transaction/status deadlines; queue assumption; sizes; disk reserve; log/backup/controller retention.

Use pinned existing Bash/Git/curl/jq/systemd/coreutils/Node/official runner where possible; no third-party runtime dependency without recorded necessity.

Revision note (2026-07-21): Thirteenth adversarial review corrected the remaining known design defects: manifest digest recursion, stale trusted-workflow execution, workflow-file protection, credential integrity without secret export, ignored checkout-state ambiguity, and transaction-ref lifecycle. Plan only; implementation not complete.