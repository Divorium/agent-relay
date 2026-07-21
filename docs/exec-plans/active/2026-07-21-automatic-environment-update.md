# Automate Agent Relay environment deployment and rollback

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current while work proceeds. Maintain this document according to `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

The reviewed baseline is `main` commit `e9ec636e5abf383f8831fc126b99f04e2e005a3c`. Before implementation starts, verify that this commit exists and is an ancestor of `HEAD`. If `main` advances, recheck every current-state statement, path, workflow, runner contract, GitHub-setting assumption, package script, and referenced Docker decision. Update the baseline and record the review in `Progress`; do not silently implement against another revision.

Codex may use read-only Git commands such as `status`, `diff`, `show`, `grep`, `rev-parse`, `show-ref`, `cat-file`, and `merge-base`. Codex must not run `git add`, `commit`, `merge`, `rebase`, `reset`, `restore`, `checkout`, `cherry-pick`, or `push`; the GitHub runner owns commit and push. Workflow files and GitHub settings are human-maintained. Codex must not edit `.github/workflows/` or `examples/github-actions/`.

## Purpose / Big Picture

Replace:

    cd /srv/github-runner/storage/agent-relay
    git pull --ff-only
    ./update.sh

with an observable deployment system for the single long-lived Agent Relay VM.

After this work:

- a merge into protected `main` is observed through its resulting `push`, exact merge-result SHA is validated on GitHub-hosted infrastructure, and it deploys only if target and workflow-control commits remain current when host transaction starts;
- manual retry deploys only current protected `main`;
- authorized operator can select open same-repository PR, including draft, or same-repository branch, resolve once to exact SHA, validate away from self-hosted runners, and test its real privileged `update.sh` on real VM;
- second persistent deployment runner remains independent of primary runtime and can submit/inspect transactions while primary is stopped or broken;
- controller stops primary, drains active `github-runner` workers, and runtime-masks primary before checkout mutation;
- managed target `update.sh` executes as root only inside controller-created transient unit, prepares runtime stage and declared host changes, and never owns active-runtime activation or transaction state;
- installed controller alone owns runtime backup, activation, journal, accepted refs, service unmask/start and restoration;
- previous active runtime remains retained until terminal acceptance/restoration, including first bootstrap before LKG;
- primary remains unavailable throughout temporary target and LKG restoration; monitor catches accidental direct listener/worker launch;
- controller health-checks runtime as `github-runner` in private-network, no-new-privileges sandbox with temporary home and read-only runtime;
- failed main attempts offline convergence to previous local LKG;
- workflow cancellation does not kill post-mutation host transaction because root systemd service owns it;
- results distinguish target, restoration and critical recovery.

Selected revisions are trusted same-repository code and execute with broad host authority. System provides **best-effort rollback for accidental failures**, not malicious-code isolation or VM snapshot. Privileged target can defeat same-VM controls. Never describe runner groups, approvals, ownership, cgroups, masks, monitoring or second runner as malicious-root protection.

Acceptance does not claim primary already accepted a GitHub job. Starting primary during temporary transaction would permit queued work race. Without retained organization-management credential for dynamic runner control, transaction proves runtime locally and starts primary only after final selection.

Temporary deployment tests target updater/runtime behavior under the currently installed deployment protocol and performs an isolated controller-candidate self-test. It does **not** apply or validate fresh-install behavior, one-time migration, GitHub workflow changes, runner-group/environment/ruleset settings, sudoers changes, or breaking controller/systemd protocol migrations. Those require deterministic system tests and disposable-VM acceptance before merge.

`DOCKER_PROVISIONING_ENABLED=0` remains authoritative. Do not re-enable Docker or reopen PR #46.

## Progress

Keep append-only. Checked implementation items require repository location plus passing automated evidence, or reproducible command plus captured result. Blocked remain unchecked with `[blocked]`.

- [x] (2026-07-21) Reviewed installation, updater, runner, CI, Codex, documentation, package scripts on baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- [x] (2026-07-21) Confirmed primary cannot synchronously update itself because updater stops listener and waits all `github-runner` workers.
- [x] (2026-07-21) Reviewed GitHub runner, group, selected-workflow, dispatch, environment and queue mechanisms.
- [x] (2026-07-21) Selected second persistent deployment runner.
- [x] (2026-07-21) Converted notes to PR #3 living structure.
- [x] (2026-07-21) First review corrected drain order, recovery claims, ownership/authorization, exact-SHA, queue, LKG, journal, upgrade, Docker scope.
- [x] (2026-07-21) Second review corrected primary validation/smoke, workflow lifetime, bootstrap, unmanaged updates, reusable caller, protocol.
- [x] (2026-07-21) Third review removed unnecessary OIDC/reusable machinery, added direct workflows, diagnostics, staging/prebootstrap fallback, controller-before-refs, approval-before-concurrency.
- [x] (2026-07-21) Fourth review added control-plane freshness, transaction refs, worktree policy, filesystem/capacity, cgroup, service invariants, clean build state.
- [x] (2026-07-21) Fifth review made controller sole activation/journal owner and updater stage-only.
- [x] (2026-07-21) Sixth review added atomic request admission, full active-runtime digest, PR-only main policy, timeouts.
- [x] (2026-07-21) Seventh review added primary runtime mask and mandatory re-drain after unexpected primary start.
- [x] (2026-07-21) Eighth review removed post-migration direct updater modes, added direct process monitoring, no-symlink runtime, temporary candidate self-test.
- [x] (2026-07-21) Ninth review fixed managed-updater root authority, enforceable health sandbox, and lock/config identity ambiguity.
- [x] (2026-07-21) Tenth review replaced administrator-file locking with dedicated immutable managed lock and cutover protocol, rejected temporary/bootstrap workflow reruns without fresh approval, and documented temporary-deployment scope limits.
- [ ] Complete Milestone 0 with actual GitHub evidence before implementation.
- [ ] Revalidate baseline/workflows before implementation.
- [ ] Implement protocol, portable validation, stage updater, controller activation, manifest/health, managed boundary.
- [ ] Implement install/migration for deployment account/runner/group/controller/recovery/bootstrap.
- [ ] Implement submission, transaction, drain/mask, checkout, cgroup, health, acceptance/restoration/cancellation/boot.
- [ ] Human reviewer: workflows/routing/group/environments/ruleset/concurrency.
- [ ] Deterministic tests, full validation, CI, review, real/disposable demonstrations.
- [ ] Complete retrospective/evidence and move same plan only after all checked.

## Surprises & Discoveries

- Active jobs read trusted checkout; drain before reset.
- Same primary UID self-deadlocks; deployment runner distinct UID.
- Privileged target defeats same-VM controls; rollback best effort.
- Existing updater lock too narrow; full managed transaction requires one dedicated lock.
- Validation cannot depend on primary; portable hosted check.
- Full check host-specific; portable check separate, full check retained.
- Primary GitHub smoke races ordinary jobs; local sandboxed health while stopped.
- Current updater deletes active runtime early; staging/backup.
- Checkout SHA lacks runtime provenance; manifest/digests.
- Remote main is not rollback state; local refs/objects.
- Restoration must work without GitHub.
- Workflow cancellation cannot own host safety; root service.
- Direct selected workflows avoid reusable/custom-auth complexity.
- Approval before deploy concurrency avoids blocking main.
- Cancellation releases GitHub queue before root transaction; host status authoritative.
- Bootstrap needs deployment runner before LKG and pre-LKG fallback.
- Direct managed update diverges accepted state; fail closed.
- Controller upgrades require backward-compatible protocol.
- Unknown recovery blocks primary/mutation, not status runner.
- Credential bytes may rotate; verify metadata/identity, not hashes.
- Queued workflow code may stale; `controlPlaneSha` freshness.
- Target object enters recovery ref before mutation.
- Stage/backup/active same filesystem/capacity.
- Transient cgroup bounds accidental descendants.
- Preexisting unexpected untracked files block.
- Managed build avoids source dependency cache.
- Target updater cannot own journal/activation.
- Post-updater checkout/service/runtime invariants.
- Existing host migrates before new updater; missing helper safe refusal.
- Concurrent submit needs atomic pending gate.
- Full runtime tree digest catches in-place mutation.
- Push is merge signal only under PR-only no-bypass ruleset.
- Runtime mask plus listener/worker monitor closes normal accidental scheduling path.
- Bootstrap-pending direct updater invalidates fallback; no direct mode under new updater.
- Temporary controller candidate self-tests without activation.
- Runtime/stage only regular files/directories.
- Managed updater cannot depend on interactive sudo; root transient unit required.
- Health no-network claim requires sandbox enforcement.
- Administrator file is configuration and may need future offline change; using it as permanent managed mutex creates unnecessary inode coupling. Dedicated root-owned `/var/lib/agent-relay-deploy/transaction.lock` is the managed lock. Migration acquires both legacy administrator-file lock and new lock during cutover, then new updater direct invocation refuses so only managed lock remains authoritative.
- GitHub reruns can reuse original environment approval. Temporary/bootstrap controller rejects `workflowRunAttempt != 1`; operator starts a fresh dispatch for each privileged attempt and receives a new approval gate.
- Temporary deployment cannot prove installer/migration/workflow/ruleset changes. Plan must not treat successful temporary runtime test as acceptance for those surfaces.

## Decision Log

- Second persistent organization runner; ephemeral/JIT rejected.
- Restoration best effort for accidental failure.
- Four direct protected-main workflows: main, temporary, bootstrap, status.
- Group permits exactly four paths at main, selected public repo, deploy label.
- Temporary/bootstrap approval before deploy concurrency; controller rejects `workflowRunAttempt != 1` for those modes.
- Hosted exact validation, full-SHA action pins, minimum permissions, explicit timeouts.
- Deployer no direct mutation; selected workflow/locked account is control-plane boundary; no custom OIDC.
- Mode-specific no-arg submit helpers, bounded canonical JSON, read-only status.
- Root request lock/exclusive pending admits one request.
- Root systemd service owns transaction beyond workflow lifetime.
- Managed transaction/recovery use dedicated root-owned regular non-symlink `/var/lib/agent-relay-deploy/transaction.lock`, created once and never replaced. Migration acquires legacy administrator-file flock and new lock simultaneously before installing bootstrap-pending/new updater. After cutover direct updater refuses, eliminating dual-lock entrypoints.
- Administrator file remains root-owned identity configuration, validated by controller but not used as managed transaction mutex. Administrator identity changes remain offline reprovisioning.
- Stop/drain primary before checkout; timeout no kill/no mutation/prior restore.
- Runtime-mask primary; monitor service/process; unexpected start => abort/re-mask/re-drain before mutation.
- Git mutation as recorded administrator.
- `controlPlaneSha == current origin/main`; main/bootstrap target current; temporary pinned.
- PR-only no-bypass main ruleset or Milestone 0 blocks.
- Backward-compatible protocol; old branch rebase/merge; breaking migration separate.
- Managed updater root stage producer only; no active/controller/ref/journal/service/mask mutation.
- Controller full-tree digest and sole activation.
- Existing host migrates before new updater; direct updater always refuses under new code. Bootstrap is first managed mutation.
- Updater transient cgroup, timeout/TERM/KILL/process monitor.
- Health sandbox as primary user with private network/no-new-privileges/private temp-home/read-only runtime/no source/credentials.
- Recovery refs authoritative; metadata journaled.
- Automatic main latest-only; stale main superseded, stale temporary/bootstrap fail.
- Before bootstrap only bootstrap/status.
- Main candidate provisional before refs; temporary isolated candidate self-test only.
- Deployment runner status available in critical recovery if valid.
- Temporary test scope excludes installer/migration/workflows/GitHub settings/breaking infrastructure protocol.
- Docker disabled.

Dates/authors: 2026-07-21 architecture/adversarial revisions under operator instructions. Update when decisions change.

## Outcomes & Retrospective

Plan remains active; no production behavior changed.

Design resolves validation, smoke, bootstrap, cancellation, activation, admission, authority, transition and lock ownership circularities. Same-VM privileged-target limitation remains explicit.

Milestone 0 blocks if GitHub controls unavailable. Update after milestones; complete only with real/disposable evidence.

## Context and Orientation

Current checkout `/srv/github-runner/storage/agent-relay` administrator-owned; `dist` root-owned. Primary paths `work`, `runner`, `home`; builder `build`, `build-home`. Users `github-runner`, `agent-relay-builder`. `/etc/agent-relay/administrator` records admin and is legacy updater lock. Primary service `actions.runner.Divorium.gh-runner.service`.

Current installer one-time, PAT only for short-lived registration token, no persistence. Current updater admin-only, locks administrator file, stops primary, waits workers indefinitely, deletes/rebuilds active `dist`, starts primary, Docker disabled. Current workflows bare `[self-hosted]`; route to `agent-relay-main` before second runner starts.

Expected additions:

    /srv/github-runner/storage/deploy-runner
    /srv/github-runner/storage/deploy-work
    /srv/github-runner/storage/deploy-home
    /srv/github-runner/storage/runtime-stage/
    /srv/github-runner/storage/runtime-backups/
    /var/lib/agent-relay-deploy/
      transaction.lock
      bootstrap-pending
      bootstrap-complete
      managed-mode
      request.lock
      pending-request.json
      active-transaction.json
      accepted-state.json
      deployed-state.json
      recovery.git/
      controller-versions/
      results/
      logs/
    /usr/local/libexec/agent-relay-submit-main
    /usr/local/libexec/agent-relay-submit-temporary
    /usr/local/libexec/agent-relay-submit-bootstrap
    /usr/local/libexec/agent-relay-deploy-status
    /usr/local/libexec/agent-relay-deploy-admin
    /usr/local/libexec/agent-relay-runtime-activate
    /usr/local/libexec/agent-relay-deploy-controller -> /var/lib/agent-relay-deploy/controller-versions/<version>/controller
    /etc/agent-relay/deployer
    /etc/sudoers.d/agent-relay-deployer
    /etc/systemd/system/agent-relay-deploy-transaction.service
    /etc/systemd/system/agent-relay-deploy-recover.service

Terms: primary runner; deployment runner; control-plane SHA; portable validation; installed host compatibility; root controller; versioned protocol; LKG recovery current ref; prebootstrap fallback; sandboxed health; critical recovery.

## Plan of Work

### Milestone 0: Prove GitHub feasibility

Verify actual organization/repo:

- manageable group, public repo, exactly four main-pinned workflows, restrictions writable;
- minimum registration/group credential permissions;
- temporary/bootstrap environments/reviewers and accepted self-review/bypass model;
- main ruleset PR-only normal changes, no force/delete/bypass for deployment workflow changes;
- `queue: max` and 100-pending bound acceptable.

Missing => `[blocked]`; do not start privileged runner.

### Milestone 1: Stable protocol and portable validation

Revalidate baseline. Add versioned protocol JSON for updater/controller/manifest/candidate ranges. Reject unsupported target before drain. Pre-protocol temporary branch rebase/merge. Breaking change separate migration.

Add `npm run check:portable` for hosted typecheck/tests/runtime build/shell/Node/portable system tests without host paths/Codex/Docker/PAT/self-hosted. Retain full host check.

Define fixed compiled runtime health, sandboxed by controller.

Define stage protocol: controller paths; managed root updater writes stage/build/declared host state, finalizes manifest, leaves active runtime/services/controller unchanged. Runtime/stage regular files/directories only.

### Milestone 2: Human workflows

Four direct full-SHA-action-pinned, minimum-permission, bounded-timeout workflows:

- `deploy-main.yml`: push main + workflow_dispatch only main; target/controlPlane github.sha; hosted validation; direct deploy group+label; shared concurrency queue:max; main helper/status.
- `deploy-temporary.yml`: dispatch main only; run_attempt must be 1; controlPlane github.sha; exact same-repo PR/branch draft allowed; reject invalid; hosted validation; protected hosted approval; direct deploy shared concurrency; temporary helper/status.
- `deploy-bootstrap.yml`: dispatch main only; run_attempt 1; exact current main/controlPlane; validation; protected approval; direct deploy; bootstrap helper.
- `deploy-status.yml`: dispatch main only; read-only status.

Group allows four paths. No reusable workflow. Deploy jobs never checkout/run target, expose persistent org credential or raw output.

Canceled prior job: next sees busy, polls status until idle/bounded expiry, then submits. Temporary/bootstrap rerun is rejected and requires fresh dispatch/approval.

Route ordinary self-hosted jobs/examples to `agent-relay-main` before deploy runner starts.

### Milestone 3: Install/migrate/bootstrap pending

Fresh install + restartable migration:

- isolated deployer/runner/no Codex;
- group/runner token/primary label;
- install controller/helpers/units/recovery/stage/backup/state/log/narrow sudo;
- deployer sudo submit/status only;
- PAT/tokens memory-only;
- create managed transaction lock once root:root restrictive, regular non-symlink;
- existing-host cutover acquires nonblocking exclusive legacy admin-file lock and managed lock, verifies no legacy updater/managed transaction, then installs managed updater/bootstrap-pending while both held;
- if either lock unavailable, migration fails without partial cutover;
- new updater direct invocation refuses, so after cutover only managed lock entrypoints mutate;
- recovery no invented LKG;
- clean admin-owned exact current main; reject tracked/unexpected untracked;
- import bootstrap-source, record primary/runtime fallback;
- active runtime no special entries;
- same-device/free-space;
- bootstrap pending, start deploy runner, disable main/temp;
- bootstrap; markers after success.

Failed bootstrap restores fallback, remains pending, no LKG.

### Milestone 4: Submission and independent service

Mode helper no args, bounded canonical JSON, request lock, exclusive pending create+fsync, starts service. Derive mode; validate schema/limits/repo/SHA/source/run/audit/controlPlane. Reject unknown/control chars/state conflict. For temporary/bootstrap require `workflowRunAttempt == 1`. No credentials.

Service claims pending into journal while managed transaction lock held. Start failure removes own pending. Stale pending deterministic.

Selected workflow+locked deploy account auth boundary. Root service owns transaction; status bounded/read-only; fixed environment no workflow token.

Boot recovery required before primary, independent deploy runner. Unknown blocks primary/mutation; status available.

### Milestone 5: Host transaction

One managed transaction lock across preflight through terminal.

Preflight:

1. validate request/mode/protocol/checkout owner/remote/config/no submodule/worktree/recovery/refs/controller/journal/managed lock metadata;
2. clean tracked/no unexpected untracked;
3. fetch expected ref transaction namespace as admin, hooks disabled;
4. verify object=target/protocol;
5. import transaction ref;
6. fetch origin/main; controlPlane=current; main/bootstrap target=current; stale main superseded, stale temp/bootstrap fail;
7. verify LKG/fallback;
8. same-device/free-space/path ownership/modes/no symlink;
9. installed host compatibility;
10. deterministic active-runtime tree digest.

Drain/isolation:

- journal prior primary, stop, bounded drain, timeout restore/no mutation;
- runtime-mask and verify no listener/worker;
- journal drained;
- monitor mask/service/listener/worker; violation abort/re-mask/re-drain before mutation.

Staging:

- exact checkout target as admin;
- create build/stage;
- root managed updater transient cgroup fixed environment/no workflow credentials; no sudo; builder subprocess;
- updater stage/declared host only, no active/controller/ref/journal/service/mask;
- cgroup inactive TERM/KILL;
- require mask/inactive/no processes, deploy service unchanged, active tree unchanged, checkout clean, controller state unchanged;
- verify stage regular-only manifest/digests/ownership/provenance;
- controller journals and performs backup/activation renames;
- verify active manifest/tree;
- sandboxed health;
- retain backup.

Main acceptance:

- candidate stage/self-test/provisional switch before refs;
- atomic refs/metadata;
- unmask/start after accepted complete;
- readiness identity/credential metadata;
- failure stop/re-mask/re-drain then revert, or critical;
- final consistency/retention.

Temporary:

- target health, no refs/active candidate;
- isolated candidate self-test only;
- masked primary;
- LKG restore via root stage updater/controller activation/sandbox health;
- safe unmask/start;
- separate outcomes/critical if unproven.

Bootstrap:

- fallback, masked primary, exact main stage/activation/health, candidate before refs, current+generation/previous absent, safe start/markers last, fallback on failure.

### Milestone 6: Updater, activation, recovery, upgrade

New updater has no direct mutation mode. Before migration old baseline updater remains legacy. Once new code checked out, direct invocation refuses. Controller invokes root managed stage-only mode with exact environment validation; no sudo; builder subprocess. Clean staging, no source cache, finalized manifest, Docker disabled.

Recovery refs current/previous/bootstrap-source/transactions/generations atomic. Offline recovery source/stage/activation/health/controller/start. Emergency Git reconstruction. Valid backup only degraded critical if stable updater fails. Candidates immutable/compatible; temporary self-test only; breaking migration separate.

Administrator identity change is offline reprovisioning with both runners stopped, no pending/active transaction, managed lock held, and controller config revalidated. Managed lock file itself is never replaced.

### Milestone 7: Documentation and acceptance

Document hosted validation, direct workflows, PR-only main, fresh-dispatch approval, temporary scope limits, control-plane freshness, bootstrap, managed lock/cutover, admission, queue/busy, drain/mask/monitor/cgroup, root stage updater/controller activation, runtime digest/manifest/sandbox health, latest-main, direct refusal, recovery, critical, upgrades, logs, Docker disabled, best effort.

Run tests/CI/review/real/disposable demonstrations; active until evidence.

## Concrete Steps

Baseline:

    git cat-file -e e9ec636e5abf383f8831fc126b99f04e2e005a3c^{commit}
    git merge-base --is-ancestor e9ec636e5abf383f8831fc126b99f04e2e005a3c HEAD
    git status --short
    git diff --name-status e9ec636e5abf383f8831fc126b99f04e2e005a3c...HEAD
    git grep -n 'DOCKER_PROVISIONING_ENABLED=0' e9ec636e5abf383f8831fc126b99f04e2e005a3c -- update.sh
    git diff --exit-code e9ec636e5abf383f8831fc126b99f04e2e005a3c -- .agent/PLANS.md .github/workflows examples/github-actions

Milestone 0 evidence: group/workflows; environments/review/bypass; PR-only ruleset; queue bound; credential permissions.

Portable:

    npm ci
    npm run check:portable

Focused equivalent:

    bash -n install.sh update.sh scripts/*.sh test-system/*.sh
    npm run build
    node --test dist/test/deployment-protocol.test.js
    node --test dist/test/deployment-controller.test.js
    node --test dist/test/deployment-state.test.js
    node --test dist/test/deployment-resolver.test.js
    node --test dist/test/runtime-manifest.test.js
    bash test-system/deployment-install.integration.sh
    bash test-system/deployment-migration.integration.sh
    bash test-system/deployment-transaction.integration.sh
    bash test-system/deployment-recovery.integration.sh

Complete:

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

Real migration/bootstrap: labels/group/no Codex; dual-lock cutover; pending normal reject; direct updater refusal; managed lock ownership/inode; installed ownership/modes; no tokens; device/capacity; exact bootstrap root-stage/activation/manifest/sandbox health/safe start/current ref/previous absent/markers last.

Production:

1. temporary success/masked/restoration/candidate self-test;
2. updater failure preserves/LKG restore;
3. drain timeout;
4. stale target/control no mutation;
5. main success;
6. direct updater rejected;
7. canceled workflow root completes/restores;
8. status;
9. unexpected untracked;
10. updater state mutation detected;
11. concurrent submit one pending;
12. direct main push blocked;
13. direct listener launch detected/re-drained;
14. health sandbox no network/source/home/credentials;
15. root managed updater works no sudo/direct root missing protocol rejected;
16. temporary/bootstrap workflow rerun attempt rejected; fresh dispatch requires approval;
17. migration cannot cut over while legacy updater lock held or managed transaction active.

Disposable:

1. bootstrap failure fallback;
2. failed main offline;
3. rename kill states;
4. restart primary blocked/status;
5. Git reconstruct;
6. candidate switchback;
7. incompatible protocol;
8. double failure;
9. cgroup descendants;
10. disk/device;
11. runtime mutation digest;
12. stale pending;
13. invalid tree shape;
14. bootstrap direct update refusal;
15. managed lock file replacement/tamper detected;
16. installer/migration/workflow changes validated separately despite temporary runtime success.

## Validation and Acceptance

Feasibility actual or blocked. Routing only four direct workflows. PR-only main. Portable exact validation. Approval before concurrency and fresh dispatch for each temporary/bootstrap attempt. Control-plane freshness. Atomic admission. Queue/busy/managed lock serialization. Dual-lock migration cutover. Clean worktree. Drain/mask/monitor. Ownership/root updater/sandbox health. Protocol/stage-only/direct refusal. Controller digest/activation. Runtime regular-only. Staging/cgroup. Temporary isolation and scope limits. Bootstrap fallback/current-only. Main full consistency/revert. Listener readiness without GitHub-job claim. Cancellation/boot. Offline recovery. Bounded logging.

Outcome semantics:

- superseded main: success/no mutation;
- main success: accepted success;
- main fail + healthy restore: workflow fail, host prior LKG;
- temporary success + restore: success for updater/runtime scope only;
- temporary fail + restore: fail, host LKG;
- stale or rerun temporary/bootstrap: fail/no mutation;
- unproven restoration: fail critical.

Completion requires all Progress evidence, tests/CI/review, production/disposable demonstrations.

## Idempotence and Recovery

Fresh install one-time. Setup/migration classify absent/exact/partial/conflict; attempt-owned compensation.

Migration restartable; dual-lock cutover prevents overlap with legacy update/managed transaction. Deploy runner may start pending, no accepted refs/managed markers; direct updater refuses; conflicts fail.

Submission request lock/exclusive pending; reused ID conflict; status read-only.

Managed transaction lock regular root-owned non-symlink created once and never replaced. Controller verifies device/inode/owner/mode at service start and after target updater.

Root journal strict/bounded/atomic records request/control-plane/target/ref, primary/mask/monitor/drain, checkout, updater authority/unit, tree digests, stage, activation, health, candidate, refs, start, restoration, terminal.

Target updater never writes journal. Controller observes independently.

Same-filesystem runtime crash states distinguishable. Invalid tree shapes rejected.

Refs atomic; metadata journaled; bootstrap current only; refs protect objects.

Recover never retries target; converges fallback/LKG, masks/no primary process while mutating, restores source/runtime/controller/health/start, archives after success.

Unknown blocks primary/mutation, status possible; admin repair.

Direct unmanaged mutation prohibited; emergency explicit/recorded then accepted-main/rebootstrap.

Tests temporary roots/local Git/fake systemd/process/service/deterministic barriers, no real settings/production/network.

## Artifacts and Notes

Append-only:

- 2026-07-21 baseline/GitHub review, draft PR #47, living format.
- 2026-07-21 first through tenth adversarial corrections as recorded in `Progress`.

Future evidence: settings; hashes; tests; group/workflows/environments/ruleset; lock/cutover; ownership/device/capacity; admission; mask/monitor/drain; phases/cgroup/digests/controller/health/restoration/final; recovery refs/fsck; stage/backup; cancellation/boot; demonstrations; CI/final review.

GitHub docs reviewed:

- `https://docs.github.com/en/actions/reference/runners/self-hosted-runners`
- `https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access`
- `https://docs.github.com/en/rest/actions/self-hosted-runner-groups`
- `https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow`
- `https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments`
- `https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency`
- `https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job`
- `https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/monitor-and-troubleshoot`

Non-goals: hostile isolation; guaranteed malicious-root/VM/disk/network/systemd/resource recovery; autoscaling/ephemeral/JIT; persistent PAT/App; forks/arbitrary repos; parallel mutation; pre-promotion GitHub job proof; VM snapshots; general data/package reversal; Docker re-enable; pre-protocol branches; automatic breaking migration; temporary activation of controller candidate; temporary acceptance of installer/migration/workflow/GitHub-setting changes.

## Interfaces and Dependencies

No public Agent Relay job/Codex request-result/prompt/finalizer/workspace changes.

Identities:

    administrator: /etc/agent-relay/administrator
    primary: github-runner / gh-runner / agent-relay-main
    builder: agent-relay-builder
    deployer: agent-relay-deployer / gh-deploy-runner / agent-relay-deploy
    group: agent-relay-deployment

Services:

    actions.runner.Divorium.gh-runner.service
    actions.runner.Divorium.gh-deploy-runner.service
    agent-relay-deploy-transaction.service
    agent-relay-deploy-recover.service
    agent-relay-update@<transaction-id>.service
    agent-relay-health@<transaction-id>.service

Recovery before primary; deploy runner independent. Controller mask/monitor primary.

Submit helpers no args/canonical JSON. Admin recovery unavailable to deployer sudo.

Request:

    interface DeploymentRequest {
      schemaVersion: 1;
      requestId: string;
      workflowRunId: number;
      workflowRunAttempt: number;
      actor: string;
      controlPlaneSha: string;
      sourceType: "push" | "pr" | "branch";
      source: string;
      targetRef: string;
      targetSha: string;
      protocolVersion: 1;
    }

Mode from helper; Git revalidation; no credential. Temporary/bootstrap require attempt 1.

Managed updater environment:

    AGENT_RELAY_UPDATE_MODE=controller-stage-v1
    AGENT_RELAY_TRANSACTION_ID=<validated-id>
    AGENT_RELAY_BUILD_ROOT=<controller-created-path>
    AGENT_RELAY_RUNTIME_STAGE=<controller-created-path>
    AGENT_RELAY_EXPECTED_SOURCE_SHA=<target-sha>

Updater root only in controller transient unit, no sudo, stage/declared host state only; active/services/controller/journal/mask unchanged.

Manifest:

    interface RuntimeBuildManifest {
      schemaVersion: 1;
      sourceSha: string;
      deploymentProtocol: 1;
      updaterVersion: string;
      runtimeEntrypoint: "src/run-codex.js";
      runtimeEntrypointSha256: string;
      healthEntrypoint: "src/runtime-health.js";
      healthEntrypointSha256: string;
      builtAt: string;
      finalized: true;
    }

Journal must include request/mode/controlPlane/source/target/transaction ref/previous state/controller/primary/mask/updater/health units/full tree digests/stage/backup/phase/results/final/log/timestamps. Exact schema may differ but bounded, strict, credential-free, restart-sufficient.

Bounded config: request, validation, approval, drain/fetch/host/updater/health/primary/transaction/busy deadlines; monitor; TERM/KILL; disk; status; logs; retention.

Use pinned existing tools where possible. No third-party runtime dependency without recorded necessity.

Revision note (2026-07-21): Tenth adversarial review replaced the overloaded administrator-file mutex with a dedicated immutable managed transaction lock and defined dual-lock migration cutover; rejected temporary/bootstrap reruns so each privileged attempt receives fresh approval; and made temporary-deployment scope explicit so runtime success cannot be misreported as installer, workflow or infrastructure acceptance. Plan only; implementation not complete.