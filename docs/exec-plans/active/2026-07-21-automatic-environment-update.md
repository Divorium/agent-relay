# Automate Agent Relay environment deployment and rollback

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current while work proceeds. Maintain it according to `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

The reviewed baseline is `main` commit `e9ec636e5abf383f8831fc126b99f04e2e005a3c`. Before implementation starts, verify that commit exists and is an ancestor of `HEAD`. If `main` advances, recheck every current-state statement, path, workflow, runner contract, GitHub-setting assumption, package script, and Docker decision. Update the baseline and record the review in `Progress`; do not silently implement against another revision.

Codex may use read-only Git commands. It must not mutate Git history, index, branches, or remotes; the GitHub runner owns commit and push. Workflow files, CODEOWNERS, rulesets, environments, and GitHub settings are human-maintained. Codex must not edit `.github/workflows/`, `examples/github-actions/`, CODEOWNERS, or GitHub configuration.

## Purpose / Big Picture

Replace:

    cd /srv/github-runner/storage/agent-relay
    git pull --ff-only
    ./update.sh

with a controlled deployment system for the single long-lived Agent Relay VM.

After this work:

- a protected `main` push validates and deploys its exact SHA only while target SHA and trusted workflow-control SHA remain current;
- an authorized operator can manually select one same-repository branch, resolve it once to an exact SHA, validate it, run its real managed `update.sh`, and always restore unchanged LKG `main`;
- the controller stops the primary listener and drains active `github-runner` workers before checkout mutation;
- a second persistent deployment runner remains independent of the primary Agent Relay runtime;
- the root-owned controller alone owns Git mutation, managed updater execution, runtime activation, accepted state, restoration, and restart recovery;
- failed `main` deployment attempts restore previous local LKG without requiring GitHub connectivity;
- workflow cancellation cannot abandon a post-mutation transaction because a root-owned systemd service owns it;
- outcomes distinguish unauthorized, invalid, superseded, already-current, migration-required, drain-failed, target-failed, restored, restoration-failed, and critical-recovery states.

Selected branches are trusted same-repository code and execute with broad host authority because the purpose is to test the real privileged updater. This provides **best-effort rollback for accidental failures**, not malicious-code isolation and not a VM snapshot. Root-equivalent target code can defeat every same-VM mechanism.

The feature proves local runtime integrity and primary-listener readiness. It does not claim GitHub has already completed a post-deployment job. Avoiding unrelated queued work racing a provisional smoke job requires a separate dynamic runner-routing design.

Temporary branch testing covers updater/runtime behavior under the installed deployment protocol. It does not apply or validate installation, migrations, workflows/settings, runner registration, sudoers, service-control-plane changes, or breaking controller protocol. Such a target is rejected as unsupported rather than reported as fully tested.

`DOCKER_PROVISIONING_ENABLED=0` remains authoritative. Do not re-enable Docker provisioning or reopen PR #46.

## Progress

Keep append-only. Checked implementation items require code plus passing automated evidence, or reproducible command plus captured result. Blocked items remain unchecked and use `[blocked]`.

- [x] (2026-07-21) Reviewed installer, updater, workflows, runner scripts, documentation, and package scripts on baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- [x] (2026-07-21) Confirmed primary runner cannot synchronously update itself because updater stops listener and waits all `github-runner` workers.
- [x] (2026-07-21) Reviewed GitHub runner groups, selected workflows, environments, dispatch refs, rerun semantics, token lifetime, and concurrency queueing.
- [x] (2026-07-21) Selected second persistent deployment runner.
- [x] (2026-07-21) Converted plan to living ExecPlan structure.
- [x] (2026-07-21) Repeated adversarial reviews corrected checkout-before-drain, overstated recovery, LKG retention, transaction ownership, exact-SHA validation, queue replacement, authorization, cancellation, bootstrap, runtime staging, updater authority, controller upgrades, and Docker scope.
- [x] (2026-07-21) Twelfth review aligned manual scope to branch-only testing, reduced privileged workflows to two, added host-schema gating, separated immutable/mutable control-plane checks, introduced dedicated health account, and preserved administrator-managed update.
- [x] (2026-07-21) Thirteenth review corrected manifest-digest recursion, workflow-control freshness, credential integrity, workflow-file protection, allowed ignored state, and transaction-ref cleanup.
- [x] (2026-07-21) Fourteenth review corrected credential-baseline timing, automatic bootstrap duplicate deployment, migration-only path enforcement, provisional-main acceptance ordering, and ordinary-job race during final listener start.
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
- Primary credential content baseline must be captured after listener stop and worker drain; shutdown may legitimately alter credentials before that point.
- Deployment runner is active during transaction, so its live credential contents cannot be required byte-stable; validate its location/type/owner/mode and registration identity, not content equality.
- Health under `github-runner` exposes credentials. Check readability as that user; execute health as dedicated locked user.
- Runtime manifest cannot hash itself. `payloadTreeSha256` covers canonical payload excluding manifest.
- Branch-only manual input matches operator request; PR/tag/SHA/URL targets are outside scope.
- Target may validate while requiring host migration. Compare host schema/protocol before drain.
- Direct unmanaged updater bypass desynchronizes journal/LKG; administrator update must route through controller.
- Trusted workflow can become stale while queued. Every request carries `controlPlaneSha`; controller requires it equal current `origin/main` before mutation.
- Ruleset alone does not protect workflow contents. Require PR-only main plus CODEOWNERS approval for deployment-control files.
- Ignored checkout state is not generally clean. Permit only explicitly managed ignored paths.
- Bootstrap can leave an automatic `main` run queued. Automatic mode must return `already_current` when target equals healthy LKG/deployed state; manual retry is a distinct mode that intentionally redeploys current main.
- Promoting LKG before listener readiness can accept a deployment that cannot restart. Target remains provisional until listener readiness, then LKG is promoted. Failure to promote after listener start stops/masks primary and restores previous LKG.
- Starting primary provisionally can schedule ordinary work. All primary self-hosted workflows must begin with a root-managed readable transaction guard and exit immediately while deployment is provisional; controller clears the guard only after LKG promotion.
- Repository path changes that require host migration must force a host-schema bump. Portable tests enforce migration-only path policy so target cannot silently omit the bump.

## Decision Log

- Use second persistent organization runner; reject ephemeral/JIT for this one durable VM.
- Support automatic current-main deployment and manual same-repository branch testing only.
- Use two direct workflows: `.github/workflows/deploy-main.yml` and `.github/workflows/deploy-branch.yml`, selected at `refs/heads/main` for deployment runner group.
- Use GitHub-hosted Linux for exact portable validation; retain full host-specific checks elsewhere.
- Temporary approval is separate GitHub-hosted environment job before shared privileged-job concurrency.
- Privileged jobs share job-level `concurrency.group: agent-relay-host-deployment`, `queue: max`, no `cancel-in-progress: true`.
- Temporary requires main workflow ref, run attempt 1, approved environment, and root-owned operator allowlist.
- Every request carries `controlPlaneSha`; controller fetches and requires it equal current `origin/main` before drain. Main target must also equal current `origin/main`; otherwise `superseded`.
- Automatic main with target already matching healthy LKG/deployed state returns `already_current` without mutation. Manual retry uses explicit `manual_main_retry` mode and performs a real transaction.
- Root controller owns complete transaction; workflow validates, approves, submits, and polls only.
- Stop listener and bounded-drain workers before mutation; timeout kills no job and restarts listener.
- Run Git as recorded administrator; deployment account cannot directly mutate checkout/root state.
- Managed updater runs target updater as root transient unit with fixed environment and stage-only runtime output; controller owns activation/state.
- Preserve administrator `admin-update-current-main`; direct unmanaged updater refuses after migration.
- Repository declares protocol ranges, `requiredHostSchema`, and migration-only path policy. Portable tests require schema bump for migration-only changes. Incompatible main returns `migration_required`; temporary returns `unsupported_scope` before drain.
- Store LKG in root-owned bare recovery repository. Transaction refs remain through terminal restoration and are then removed by retention policy.
- Stage/active/backup share filesystem and use ordered journaled renames; never claim multi-directory atomicity.
- Immutable inventory covers controller/helpers, selected units, sudoers, protocol files, lock metadata. Mutable state uses phase-specific schemas.
- Primary runner credential/config files: validate metadata before stop, then capture root-private local content digests after successful drain/mask and require equality after target execution. Never log/export digests. Deployment runner credential contents are not equality-checked while active; validate metadata and registration identity.
- Verify runtime readability as `github-runner`; execute health as locked `agent-relay-health` in strict private sandbox with only runtime read-only bind.
- Runtime manifest `payloadTreeSha256` excludes manifest and hashes canonical path/type/mode/size/content for payload entries.
- Protect main with PR-only ruleset, no force/delete, required checks, CODEOWNERS review for deployment workflows/control metadata, no unauthorized bypass.
- During provisional main start, publish readable transaction guard. Every primary self-hosted workflow checks guard first and exits before repository work. After listener readiness controller promotes LKG, then clears guard. If promotion fails, controller stops/masks primary and restores prior LKG.
- Do not claim post-deployment GitHub job execution.
- Keep Docker provisioning disabled.

Dates/authors: 2026-07-21 architecture/adversarial review under operator instruction. Record changed decisions as dated explanatory entries.

## Outcomes & Retrospective

Plan remains active and plan-only; no production behavior changed. Scope is automatic current main, manual branch test, safe drain, stage/activate, local accepted state, and best-effort accidental recovery. It excludes hostile isolation and temporary infrastructure migration.

Update after each accepted milestone. On completion record production/disposable-VM results and move this same file to `completed`.

## Context and Orientation

Current installation:

- source `/srv/github-runner/storage/agent-relay` administrator-owned; active `dist` root-owned inside source;
- primary `work`, `runner`, `home` owned by `github-runner`;
- builder `build`, `build-home` owned by `agent-relay-builder`;
- `/etc/agent-relay/administrator` records administrator and is current legacy updater lock;
- primary service `actions.runner.Divorium.gh-runner.service` uses `KillMode=process`;
- installer uses PAT only for short-lived registration token and does not persist PAT;
- updater is admin-only, obtains sudo interactively, stops listener, waits indefinitely, deletes/rebuilds active `dist`, restarts listener, Docker disabled;
- current self-hosted workflows use bare `[self-hosted]` and must be relabeled before deployment runner starts.

Expected additions include deployment runner/home/work, locked health account, runtime stage/backup, root deployment state/recovery/controller/logs, fixed submit/status helpers, managed transaction/recovery units, operator allowlist, deployment sudoers, managed lock, host schema marker, and readable transaction guard.

## Plan of Work

### Milestone 0: Prove GitHub feasibility

Verify actual organization supports additional public-repo runner group, selected workflow restrictions for exactly two main-pinned workflows, required-review environment, GitHub-hosted validation, `queue: max`, full-SHA action pins, minimum token permissions, and PR-only protected main with required checks/CODEOWNERS/no force/delete/no unauthorized bypass. Missing/incompatible control => `[blocked]`; do not install privileged runner.

### Milestone 1: Protocol and portable validation

Add versioned repository metadata for protocol ranges, host schema, runtime manifest, fixed health interface, migration-only path globs, and files whose changes require schema bump. Portable contract tests fail when migration-only paths change without required schema increment.

Workflow runs `npm ci`, then `npm run check:portable` on GitHub-hosted Linux. Portable check covers typecheck, tests, runtime build, shell/Node syntax, protocol/schema/path-policy tests without production systemd mutation, Docker daemon, PAT, Codex login, or self-hosted paths. Existing full `npm run check` remains.

Temporary-scope validation compares exact target metadata to installed schema/protocol and rejects incompatible/migration-only target before submission.

### Milestone 2: Install, migrate, bootstrap

Fresh install and restartable migration:

- create locked deployer/health accounts, isolated paths, deployment runner/group/label;
- configure GitHub controls while PAT memory-only and use separate short-lived registration token;
- install controller versions, helpers, units, sudoers, operator allowlist, managed lock, state, recovery, stage/backup, logs, transaction guard;
- require human workflow routing/CODEOWNERS/ruleset changes before enabling second runner;
- perform dual-lock cutover from legacy updater lock;
- keep deployment runner stopped until bootstrap complete;
- bootstrap exact current main via portable validation evidence, drain, fallback retention, managed stage update, stage/health validation, activation, listener provisional start with guard, LKG promotion, guard clear, accepted object/ref/state;
- write bootstrap marker last, start deployment runner last, retain no PAT/token.

Queued automatic main after bootstrap returns `already_current`. Partial/conflicting state fails closed; exact complete rerun validates only.

### Milestone 3: Human workflows

`deploy-main.yml`: main push plus manual retry current main. Hosted exact validation. Request mode distinguishes `automatic_main` and `manual_main_retry`. Privileged submit/poll job uses shared concurrency and selected deployment runner. Automatic `superseded`/`already_current` are successful no-op; `migration_required` is explicit failure requiring admin migration.

`deploy-branch.yml`: workflow dispatch from main only; branch name only; reject PR/tag/SHA/URL/merge-ref/fork/malformed; reject rerun; resolve exact SHA once; hosted portable/temporary-scope validation; separate hosted environment approval; shared-concurrency privileged submit/poll.

Both privileged jobs: minimum permissions, timeouts, full-SHA actions, bounded normalized logs, no target workflow code, canonical request. Every primary self-hosted workflow/example gets `agent-relay-main` routing and first-step transaction-guard check before deployment runner enablement.

### Milestone 4: Durable submission/service

Deployer invokes only no-argument root-owned submit-main, submit-branch, read-only status helpers. Bounded canonical JSON via stdin/fixed descriptor; schema validate; exclusive durable pending request; start root transaction unit.

Service claims under managed lock, journals durably, continues after workflow cancellation. One pending/active request. Boot recovery resolves nonterminal journal before primary starts. Status bounded/sanitized.

### Milestone 5: Host transaction

Preflight before stop:

- validate request/actor/workflow path/ref/run attempt/control-plane SHA/protocol/bootstrap/schema/controller;
- validate checkout path/owner/remote/no submodules/no alternate worktree/tracked clean and only explicitly allowed ignored paths (`dist/` and documented dependency cache); any other ignored/untracked path blocks;
- validate recovery/LKG, active deployed state/runtime manifest, stage/backup, same device, capacity, journal, immutable inventory, runner credential metadata;
- bounded fetch as administrator;
- require controlPlaneSha equals current origin/main for every mode;
- automatic/manual main target must equal current origin/main; automatic may return already_current, stale returns superseded;
- branch exact object and temporary scope compatible;
- retain target object under transaction recovery ref before mutation.

Drain:

- stop primary listener; bounded wait all primary workers; never kill jobs;
- failure => restart initially active listener, no mutation, drain_failed;
- success => mask primary, ensure no listener/worker, then capture primary credential content digests and immutable baseline immediately before target execution.

Managed update:

- journal before irreversible steps;
- reset/clean as administrator to exact target;
- create same-device stage/backup;
- run target updater as root transient unit/cgroup, fixed environment, bounded output/time, TERM/KILL, no GitHub/runner env;
- updater stage only plus declared allowed non-control-plane operations; no activation/state/runner/controller/unit/sudoers/lock changes;
- require cgroup/descendants gone, primary masked/no processes, active runtime unchanged, immutable files unchanged, mutable state expected, primary credential digests equal, deployment credential metadata/identity valid;
- validate regular-only stage and finalized manifest; recompute nonrecursive payload digest.

Activation/health:

- retain old active runtime backup;
- journal ordered same-device renames and recover by valid manifest/digest;
- test active readability as primary user without execution;
- run fixed health as health user in strict private sandbox with only runtime bind; validate bounded machine JSON.

Main acceptance:

- optional backward-compatible controller candidate stage/self-test/schema-check/atomic switch/revert;
- publish transaction guard, unmask/start primary, verify listener readiness;
- while guard exists ordinary primary workflows exit immediately before repository work;
- only after readiness promote accepted recovery ref/metadata and deployed state, then clear guard;
- promotion failure stops/masks primary and restores prior LKG;
- cleanup refs/backups only after terminal retention rules.

Temporary:

- no controller activation/LKG change;
- record target result;
- restore exact local LKG checkout/runtime/controller without network;
- run stable managed updater if LKG manifest requires convergence;
- health-check, unmask/start primary only after restoration proof;
- report target/restoration separately.

Any post-mutation failure restores. Unproven restoration => primary masked/stopped, LKG unchanged, evidence retained, critical_recovery, no retry loop.

### Milestone 6: Recovery/admin/upgrade

Administrator-only recover never retries target; restores local LKG and starts primary only after proof. Administrator-only admin-update-current-main uses same managed transaction. Direct unmanaged updater refuses after migration except authenticated controller mode. Administrator-only acknowledge-repair mutates no host, requires independently verified evidence, cannot promote temporary/change LKG.

Controller candidate backward compatible with journal/host schema; immutable versions, atomic symlink, prior retained. Breaking host/control-plane changes require explicit migration under managed lock. Main returns migration_required; temporary unsupported_scope before drain.

### Milestone 7: Documentation and acceptance

Document final behavior only after implementation: setup/migration, two workflows, branch-only target, approval/rerun/control-plane freshness, portable validation/path/schema gate, drain, locks, durable transaction, transaction guard, stage/activation, health sandbox, recovery, controller upgrade, admin commands, critical state, logs, Docker disabled, best-effort limitation.

## Concrete Steps

Baseline:

    git cat-file -e e9ec636e5abf383f8831fc126b99f04e2e005a3c^{commit}
    git merge-base --is-ancestor e9ec636e5abf383f8831fc126b99f04e2e005a3c HEAD
    git status --short
    git diff --name-status e9ec636e5abf383f8831fc126b99f04e2e005a3c...HEAD
    git grep -n 'DOCKER_PROVISIONING_ENABLED=0' e9ec636e5abf383f8831fc126b99f04e2e005a3c -- update.sh
    git diff --exit-code e9ec636e5abf383f8831fc126b99f04e2e005a3c -- .agent/PLANS.md .github/workflows examples/github-actions ':(glob)**/CODEOWNERS'

Expected success; Docker disabled; unexplained protected mismatch => `[blocked]`.

Focused tests cover GitHub fixtures; protocol/schema/migration path policy; branch resolver; portable validation; install/migration/token non-persistence; locks; request/cancellation; preflight/clean state/object retention/capacity; drain; post-drain credential baseline; managed updater/cgroup/stage/Docker; manifest digest; activation crashes; health sandbox; main automatic already-current/superseded/manual retry/migration-required; temporary restore; controller switch; boot/critical recovery; transaction guard; admin commands; logs.

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

Production demonstrations: migration/bootstrap; queued automatic already-current; temporary success+restore; temporary failure+restore; drain timeout no mutation; stale control-plane rejection; superseded main; current main accepted with transaction guard; manual main retry; admin managed update.

Disposable VM: failed main offline restore; restart during checkout/update/activation/restoration/promotion; controller switchback; double failure critical; immutable/credential modification detected; higher host schema and missing schema bump rejected without mutation.

## Validation and Acceptance

Acceptance requires actual evidence for GitHub controls; branch-only rejection; hosted exact validation; stale workflow/ref/rerun/approval/actor rejection; queue/serialization; automatic already-current/superseded; drain; ownership; protocol/schema/path gate; stage-only updater; post-drain primary credential integrity and deployment identity metadata; nonrecursive manifest; health isolation; provisional guard and LKG-after-listener ordering; temporary LKG restoration; offline every-phase recovery; bounded logs; critical recovery.

Complete only when every Progress item checked, tests/CI pass, independent review has no action points, and all production/disposable demonstrations pass.

## Idempotence and Recovery

Fresh install one-time. Migration classifies absent/exact/partial/conflict; exact complete validates only. Managed lock serializes migration/deploy/admin/recovery; dual-lock cutover prevents old updater overlap.

Pending request exclusive/durable. Journal strict, bounded, credential-free except root-private integrity digests, atomically replaced and phase-complete. Primary credential digests are captured only after drain, never logged/exported, deleted after terminal cleanup.

Activation uses same-device stage/active/backup and ordered journaled renames. Recovery chooses runtime by finalized manifest/payload digest.

LKG object/ref/metadata promotion happens only after listener readiness under transaction guard. Crash during provisional start or promotion is journaled; recovery either completes promotion for exactly verified target or stops primary and restores old LKG. Temporary/failed target never changes LKG.

Recovery never retries target. Unknown/contradictory state blocks mutation and primary start but permits bounded read-only status.

Tests use temporary roots/local repos/fake APIs/processes/services and disposable VMs; no production mutation except approved demonstrations.

## Artifacts and Notes

Keep append-only.

- 2026-07-21: reviewed baseline repository and official GitHub runner/group/environment/dispatch/rerun/concurrency/token documentation.
- 2026-07-21: created draft PR #47, plan only.
- 2026-07-21: converted to living ExecPlan and performed repeated adversarial reviews.
- 2026-07-21: twelfth review simplified modes/workflows and added schema/control-plane/health/admin boundaries.
- 2026-07-21: thirteenth review corrected manifest recursion, workflow freshness, credential integrity, workflow protection, ignored state, ref lifecycle.
- 2026-07-21: fourteenth review corrected post-drain credential baseline, already-current/manual retry modes, migration-path enforcement, provisional listener/LKG ordering, and transaction guard.

Future evidence: settings/API; workflow/CODEOWNERS/ruleset hashes; tests/counts; ownership/modes; migration/locks; request/journal; drain; credential integrity; manifests; guard; sandbox; recovery refs/fsck; transactions/logs; production/disposable results; CI/final review.

Official GitHub docs reviewed: self-hosted runner groups/access REST, deployments/environments, workflow dispatch/reruns, workflow syntax/concurrency, GITHUB_TOKEN.

Non-goals: malicious isolation; VM/disk/network/systemd/resource disaster recovery; autoscaling/ephemeral/JIT; persistent PAT/App; PR/fork/tag/SHA/arbitrary repo/URL targets; parallel mutation; guaranteed GitHub post-deploy job; VM snapshots; general data/package reversal; temporary infrastructure testing; Docker re-enable.

## Interfaces and Dependencies

No public Agent Relay job/Codex prompt/request/result/finalizer/workspace contract change.

Identities: recorded administrator; primary `github-runner`/`gh-runner`/`agent-relay-main`; builder; deployer/`gh-deploy-runner`/`agent-relay-deploy`; health `agent-relay-health`; group `agent-relay-deployment`.

Canonical request: schema, request/run/attempt/actor/event/mode/workflow path/ref/controlPlaneSha, branch if temporary, targetSha, validation identity, required host schema, protocol versions; no credential. Main modes: `automatic_main`, `manual_main_retry`.

Managed updater env: mode, transaction, source/build/stage, target SHA, installed schema, fixed locale/path only.

Runtime manifest: schema, target, protocols, required host schema, health entrypoint, `payloadTreeSha256` excluding manifest, payload count/bytes, timestamp, finalized marker. Canonical digest includes relative path/type/mode/size/content digest; only regular dirs/files, no symlink/device/socket/FIFO, reject unexpected hard links and group/other writable entries.

Immutable inventory: controller/helpers, symlink target metadata during updater phase, selected units, sudoers, protocol files, lock metadata. Primary credential/config content equality uses root-private post-drain digests. Deployment credential/config uses metadata and registration identity only while its job is active. Mutable state uses strict schemas/transitions.

Readable transaction guard is root-written, primary-readable, strict-schema, no secrets. Primary workflows check it before checkout or trusted repository script execution.

Bounded config: validation/approval/request/drain/fetch/updater/TERM/KILL/health/listener/promotion/transaction/status deadlines; queue assumption; sizes; disk reserve; log/backup/controller retention.

Use pinned existing Bash/Git/curl/jq/systemd/coreutils/Node/official runner where possible; no third-party runtime dependency without recorded necessity.

Revision note (2026-07-21): Fourteenth adversarial review resolved the final known ordering and lifecycle defects: credential baselines now occur after drain, automatic bootstrap duplicates become `already_current`, migration-only paths require schema bumps, target remains provisional until listener readiness, LKG promotion follows readiness under a transaction guard, and promotion failure forces stop and restoration. Plan only; implementation not complete.