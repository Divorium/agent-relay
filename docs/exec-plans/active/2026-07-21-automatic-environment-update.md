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

- a merge into protected `main` is observed through its resulting `push`, the exact merge-result SHA is validated on GitHub-hosted infrastructure, and it deploys only if target and workflow-control commits are still current when host transaction starts;
- manual retry deploys only current protected `main`;
- authorized operator can select open same-repository PR, including draft, or same-repository branch, resolve once to exact SHA, validate away from both self-hosted runners, and test its real privileged `update.sh` on real VM;
- second persistent deployment runner remains independent of primary Agent Relay runtime and can submit/inspect transactions while primary is stopped or broken;
- controller stops primary listener, drains active `github-runner` workers, and installs a runtime systemd mask before checkout mutation; mask remains until final accepted/restored runtime is ready;
- target `update.sh` is managed stage producer; trusted installed controller alone owns active-runtime backup, activation rename, journal, accepted refs, service unmask/start and restoration;
- previous active runtime remains retained until terminal acceptance/restoration, including first bootstrap before LKG;
- temporary target cannot accidentally start primary through normal systemd service control while mask is active, so ordinary CI/Codex cannot run against temporary runtime;
- failed main attempts network-independent convergence to previous local LKG;
- workflow cancellation does not kill post-mutation host transaction because root systemd service owns it;
- results distinguish target, restoration and critical recovery.

Selected revisions are trusted same-repository code and execute with broad host authority to test real privileged updater. System provides **best-effort rollback for accidental failures**, not malicious-code isolation or VM snapshot. Privileged target can defeat same-VM controls, including removing mask. Root ownership, runner groups, approvals, sanitization, cgroups, masks and second runner must never be described as protection from malicious privileged target.

Acceptance does not claim primary already accepted a GitHub job. Starting primary during temporary transaction permits queued work race. Without retained organization-management credential for dynamic runner control, transaction proves runtime locally and starts primary only after final selection.

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
- [x] (2026-07-21) Seventh review added primary runtime mask for whole mutation window and mandatory re-drain before rollback after any primary start attempt.
- [ ] Complete Milestone 0 with actual GitHub evidence before implementation.
- [ ] Revalidate baseline/workflows before implementation.
- [ ] Implement protocol, portable validation, stage updater, controller activation, manifest/health, managed boundary.
- [ ] Implement install/migration for deployment account/runner/group/controller/recovery/bootstrap.
- [ ] Implement submission, transaction, drain/mask, checkout, cgroup, health, acceptance/restoration/cancellation/boot.
- [ ] Human reviewer: workflows/routing/group/environments/ruleset/concurrency.
- [ ] Deterministic tests, full validation, CI, review, real/disposable demonstrations.
- [ ] Complete retrospective/evidence and move same plan only after all checked.

## Surprises & Discoveries

- Active jobs execute scripts from trusted checkout; drain must precede reset.
- Second runner under primary UID self-deadlocks; distinct UID required.
- Privileged target defeats same-VM controls; rollback best effort.
- Existing updater lock too narrow; full transaction uses one inode.
- Validation cannot depend on primary; portable hosted check required.
- Full `npm run check` is host-specific; portable check separate, full check retained.
- Primary GitHub smoke races ordinary jobs; use local health while stopped.
- Current updater destroys active runtime before build success; staging/backup required.
- Checkout SHA lacks runtime provenance; manifest/digests required.
- Remote main is not rollback state; local refs/objects required.
- Restore must work without GitHub network.
- Workflow cancellation cannot own host safety; root service continues.
- Direct selected workflows avoid reusable/custom-auth complexity.
- Approval before deploy concurrency avoids blocking main.
- Cancellation can release GitHub queue early; host busy status authoritative.
- Bootstrap needs deployment runner before LKG; pending mode accepts bootstrap/status.
- Bootstrap needs pre-LKG source/runtime fallback.
- Managed direct update diverges accepted state; fail closed.
- Controller upgrades require backward-compatible protocol.
- Unknown recovery blocks primary/mutation, not status runner.
- Runner credential bytes may rotate; verify metadata/identity, not hashes.
- Queued workflow code may stale; `controlPlaneSha` freshness required.
- Target object enters recovery transaction ref before mutation.
- Stage/backup/active require same filesystem/capacity.
- Transient systemd cgroup bounds accidental descendants.
- Unexpected preexisting untracked files block rather than delete.
- Managed build must not use stale source dependency cache.
- Target updater cannot own journal/activation; controller performs/observes.
- Post-updater checkout and service/runtime invariants required.
- Existing host migrates before new updater; missing helper refuses safely.
- Concurrent submit helpers need atomic pending gate.
- Full runtime tree digest catches accidental in-place modification.
- Push is merge signal only under PR-only no-bypass main ruleset.
- Merely checking primary stayed stopped after updater is too late: buggy updater could start service and a queued job could begin. Controller must runtime-mask primary before target execution and keep it masked through temporary restoration.
- If primary ever starts before transaction completion, rollback must first stop listener and boundedly drain any newly assigned worker; unsafe checkout/runtime mutation is forbidden while worker remains.

## Decision Log

- Second persistent organization runner; ephemeral/JIT rejected for this one VM.
- Restoration best effort for accidental failure.
- Four direct protected-main workflows: main, temporary, bootstrap, status.
- Group permits exactly four paths at `refs/heads/main`, selected public repo, label `agent-relay-deploy`.
- Temporary/bootstrap environment approval completes before deploy concurrency.
- Hosted exact validation, full-SHA action pins, minimum permissions, explicit timeouts.
- Deployer has no direct mutation; selected workflow/locked account is control-plane boundary; no custom OIDC.
- Mode-specific no-arg submit helpers, bounded canonical JSON stdin, read-only status.
- Root-only request lock + exclusive pending file admits exactly one request.
- Root systemd service owns transaction beyond workflow lifetime.
- Host flock authoritative; exact `/etc/agent-relay/administrator` inode shared by manual prebootstrap/controller/recovery; managed updater does not reacquire.
- Stop/drain primary before checkout; drain timeout no kill/no mutation/prior-state restore.
- After drain, apply `systemctl mask --runtime` or equivalent controller-owned runtime mask to exact primary service. Journal mask state. Target update/restoration runs with mask present. Only controller may remove mask immediately before final primary start.
- Any unexpected mask removal or primary process/service start during target work is failure. Controller immediately stops primary, waits boundedly for any new worker, and does not mutate checkout/runtime until drain completes; timeout enters critical recovery.
- Git mutation as recorded administrator.
- `controlPlaneSha == current origin/main` for all mutating modes. Main/bootstrap target also current; temporary pinned separately.
- Main ruleset requires PR-only normal changes, no force/delete/bypass for deployment workflows; otherwise Milestone 0 blocks trigger design.
- Backward-compatible deployment protocol; old branch rebase/merge; breaking migration separate.
- Managed updater stage producer only; no active runtime, controller state/refs/journal or runner service control.
- Controller records full active-runtime tree digest before/after updater and alone activates stage.
- Existing host migrates before new updater; prebootstrap manual uses installed activator; missing helper refuses.
- Updater runs transient systemd cgroup with timeout/TERM/KILL.
- Local health as `github-runner` under env-i/temp HOME/no credentials/network/model.
- Recovery refs authoritative; metadata journaled.
- Automatic main latest-only; stale main superseded, stale temporary/bootstrap fail.
- Before bootstrap only bootstrap/status.
- After managed mode direct update fails closed.
- Candidate validated/provisionally switched before refs; temporary never candidate.
- Deployment runner status available in critical recovery if valid.
- Docker disabled.

Dates/authors: 2026-07-21 architecture/adversarial revisions under operator instructions. Update when decisions change.

## Outcomes & Retrospective

Plan remains active; no production behavior changed.

Design resolves validation, smoke, bootstrap, cancellation, activation and admission circularities. Runtime mask closes accidental primary-start race. Same-VM privileged-target limitation remains explicit.

Milestone 0 blocks if GitHub controls unavailable. Update after milestones; complete only with real/disposable evidence.

## Context and Orientation

Current checkout `/srv/github-runner/storage/agent-relay` is administrator-owned; `dist` root-owned. Primary paths `work`, `runner`, `home`; builder `build`, `build-home`. Users: `github-runner`, `agent-relay-builder`. `/etc/agent-relay/administrator` records admin and is current lock inode. Primary service is `actions.runner.Divorium.gh-runner.service`.

Current installer is one-time, uses PAT only to obtain short-lived registration token, stores no PAT. Current updater is admin-only, locks admin file, stops primary, waits workers indefinitely, deletes/rebuilds active `dist`, starts primary, Docker disabled. Current workflows use bare `[self-hosted]`; route to `agent-relay-main` before second runner starts.

Expected additions:

    /srv/github-runner/storage/deploy-runner
    /srv/github-runner/storage/deploy-work
    /srv/github-runner/storage/deploy-home
    /srv/github-runner/storage/runtime-stage/
    /srv/github-runner/storage/runtime-backups/
    /var/lib/agent-relay-deploy/
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

Terms: primary runner; deployment runner; control-plane SHA; portable validation; installed host compatibility; root controller; versioned deployment protocol; LKG recovery current ref; prebootstrap source/runtime/service fallback; local runtime health; critical recovery.

## Plan of Work

### Milestone 0: Prove GitHub feasibility

Verify actual organization/repo:

- manageable group, public repo, exactly four main-pinned workflows, restrictions writable;
- minimum registration/group credential permissions;
- temporary/bootstrap environments/reviewers and accepted self-review/bypass model;
- main ruleset requires PR for normal changes, blocks force/delete and bypass for deployment workflow changes;
- `queue: max` and 100-pending bound acceptable.

Missing control => `[blocked]`; do not start privileged runner.

### Milestone 1: Stable protocol and portable validation

Revalidate baseline. Add versioned protocol JSON with updater/controller/manifest/candidate integer protocol ranges. Reject unsupported target before drain. Pre-protocol temporary branches rebase/merge. Breaking change separate migration.

Add `npm run check:portable` for hosted typecheck/tests/runtime build/shell/Node/portable system tests without host paths/Codex/Docker/PAT/self-hosted. Retain full host check.

Define fixed compiled runtime health: no arbitrary command/network/model/source/persistent write; bounded diagnostics.

Define stage protocol: controller creates build/stage paths; managed updater writes stage/build and declared host state, finalizes manifest, leaves active runtime/services/controller state unchanged.

### Milestone 2: Human workflows

Four direct full-SHA-action-pinned, minimum-permission, bounded-timeout workflows:

- `deploy-main.yml`: `push main` plus `workflow_dispatch` only from main; target/controlPlane github.sha; hosted portable validation; direct deploy job group+label; shared job concurrency `queue:max`; main helper/status. PR-only ruleset makes push merge result.
- `deploy-temporary.yml`: dispatch main only; controlPlane github.sha; exact same-repo PR/branch, draft allowed; reject fork/tag/merge/url/malformed/protocol; hosted validation; protected hosted approval; then direct deploy job shared concurrency; temporary helper/status.
- `deploy-bootstrap.yml`: dispatch main only; exact current main/controlPlane; validation; protected approval; direct deploy; bootstrap helper.
- `deploy-status.yml`: dispatch main only; direct read-only status; no target/concurrency/mutation.

Group allows exactly four paths. No reusable workflow. Deploy jobs never checkout/run target, expose persistent org credential or raw output.

Canceled prior job: next sees busy, polls status until idle/bounded expiry, then submits; no replacement.

Route ordinary self-hosted jobs/examples to `agent-relay-main` before deploy runner starts.

### Milestone 3: Install/migrate/bootstrap pending

Fresh install + restartable migration:

- isolated deployer/runner/no Codex;
- selected group + runner token, primary label without identity replacement;
- install controller/helpers/units/recovery/stage/backup/state/log/narrow sudo;
- deployer sudo only submit/status;
- PAT/tokens memory-only;
- migrate before new updater; missing helper safe refusal;
- recovery initialized no invented LKG;
- clean admin-owned exact current main; reject tracked/unexpected untracked;
- import bootstrap-source, record primary state/runtime without provenance;
- same-device/capacity;
- bootstrap pending, start deploy runner, disable main/temp;
- bootstrap; markers after success.

Failed bootstrap restores source/runtime/service, remains pending, no LKG.

### Milestone 4: Submission and independent service

Mode helper: no args, bounded canonical JSON, request lock, exclusive pending create+fsync, starts service. Derive mode; validate schema/limits/repo/SHA/source/run/audit/controlPlane; reject unknown/control chars/state conflict. No credentials.

Service atomically claims pending into journal while host flock held. Start failure removes only own pending. Stale pending recovery deterministic.

Selected workflow+locked deploy account is auth boundary. Root service owns transaction; status bounded/read-only; fixed systemd environment no workflow token inheritance.

Boot recovery required before primary but independent of deployment runner. Unknown keeps primary/mutation stopped, status available when possible.

### Milestone 5: Host transaction

One flock on admin file across preflight through terminal.

Preflight:

1. validate request/mode/protocol/checkout owner/remote/config/no submodule/worktree/recovery/refs/controller/journal;
2. clean tracked/no unexpected nonignored untracked;
3. fetch expected ref transaction namespace as admin, hooks disabled;
4. verify object=target/protocol;
5. import target transaction ref;
6. fetch origin/main; controlPlane=current all modes; main/bootstrap target=current; stale main superseded, stale temp/bootstrap fail;
7. verify LKG/bootstrap fallback;
8. same-device/free-space/path ownership/modes/no symlink;
9. installed host compatibility;
10. deterministic full active-runtime tree digest.

Drain/isolation:

1. journal prior primary state;
2. stop primary, bounded drain;
3. timeout restores prior state/no mutation;
4. apply controller-owned runtime mask to exact primary service and verify masked/inactive/no worker;
5. journal mask state and durable drained before checkout;
6. if mask unexpectedly disappears or primary starts before final unmask, stop it and boundedly drain any worker before further mutation; inability to drain => critical recovery.

Staging:

1. reset/clean tracked checkout exact target as admin; verify owner/HEAD;
2. create build/stage roots;
3. run exact admin-owned regular non-symlink updater stage-only in transient service/cgroup, fixed timeout/no workflow credentials;
4. updater may build stage/declared host work but not active runtime/controller state/refs/journal/runner services/mask;
5. wait cgroup inactive TERM/KILL;
6. require primary still masked/inactive, no workers, deploy service unchanged, active-runtime tree digest unchanged, exact clean checkout, controller state unchanged;
7. verify stage manifest/digests/owner/modes/provenance;
8. controller journals stage, renames active dist to backup, journals, renames stage active, journals;
9. verify active manifest and health as github-runner env-i/temp HOME;
10. retain backup.

Main acceptance:

- candidate stage/self-test, reject breaking, provisional switch/post-test before refs;
- verify transaction object;
- atomic previous/current/generation refs and journaled metadata;
- remove primary runtime mask only after accepted target/controller/runtime complete;
- start primary; verify stable listener/runner identity/labels/credential file metadata;
- failure after unmask/start: stop and re-mask primary, boundedly drain any new worker, then revert refs/metadata/controller/checkout/runtime; if drain fails, critical without unsafe mutation;
- health/restart prior, final consistency; bounded retention/cleanup.

Temporary:

- target health, no refs/candidate, primary remains masked;
- restore current LKG checkout;
- LKG updater stage-only cgroup; controller activation/manifest/health/controller;
- unmask/start primary only after LKG complete;
- startup failure uses same stop/re-mask/drain guard;
- separate outcomes; unproven critical.

Bootstrap:

- no LKG; bootstrap-source/runtime fallback; primary masked after drain;
- exact current main stage/activation/health; candidate before refs;
- current+generation, previous absent;
- unmask/start/readiness; markers last;
- failure stop/re-mask/drain if needed, restore prebootstrap, unmask/start prior only when safe.

### Milestone 6: Updater, activation, recovery, upgrade

Updater:

- prebootstrap manual requires installed activator; admin holds same lock, activator masks/stops/drains as needed, updater stages, activator verifies/renames/health/unmasks/starts. Missing helper refuses/migration instruction;
- managed controller mode stage-only, primary already masked/drained, no active/service/controller state;
- managed direct ordinary fails;
- clean transaction build/stage, no source dependency cache;
- manifest schema/source/protocol/updater/runtime+health paths/digests/timestamp/finalized;
- Docker disabled.

Recovery refs current/previous/bootstrap-source/transactions/generations atomic; bootstrap previous absent; protect objects.

Offline recovery restores source, stable stage-only updater, controller activation/health/controller, then safe unmask/start. Emergency Git reconstruction allowed. Valid LKG backup may start only explicit degraded critical action if stable updater fails; journal remains.

Candidates immutable/atomic symlink, validated before refs, active/previous compatible. Breaking migration separate.

### Milestone 7: Documentation and acceptance

Document hosted validation, direct workflows, PR-only main, approvals, control-plane freshness, bootstrap, admission, queue/busy, drain/mask/cgroup, stage-only/controller activation, runtime digest/manifest/health limitation, latest-main, managed refusal, recovery refs/backups, critical recovery, upgrades, logs, Docker disabled, best effort.

Run tests/CI/review/real/disposable demonstrations; active until evidence.

## Concrete Steps

Baseline:

    git cat-file -e e9ec636e5abf383f8831fc126b99f04e2e005a3c^{commit}
    git merge-base --is-ancestor e9ec636e5abf383f8831fc126b99f04e2e005a3c HEAD
    git status --short
    git diff --name-status e9ec636e5abf383f8831fc126b99f04e2e005a3c...HEAD
    git grep -n 'DOCKER_PROVISIONING_ENABLED=0' e9ec636e5abf383f8831fc126b99f04e2e005a3c -- update.sh
    git diff --exit-code e9ec636e5abf383f8831fc126b99f04e2e005a3c -- .agent/PLANS.md .github/workflows examples/github-actions

Milestone 0 evidence: group public/selected four workflows/writable; environments/review/bypass; ruleset PR-only/no bypass/force/delete; queue bound; credential permissions.

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

Real migration/bootstrap: labels/group/no Codex; pending normal reject; installed ownership/modes; no tokens; device/capacity; exact bootstrap stage/activation/manifest/health/safe unmask/readiness/current ref/previous absent/markers last.

Production:

1. temporary success, primary masked/stopped, restoration;
2. target updater failure preserves runtime/LKG restore;
3. drain timeout no mutation;
4. stale target/control plane no mutation;
5. main success LKG;
6. direct updater rejected managed;
7. workflow cancel root service completes/restores;
8. status active/terminal;
9. unexpected untracked blocks;
10. updater attempts active runtime/checkout/service/controller/mask mutation => detected;
11. concurrent submit => one pending;
12. direct main push blocked ruleset;
13. target updater tries `systemctl start` primary and runtime mask prevents listener/job.

Disposable:

1. bootstrap failure before/after activation restores prebootstrap;
2. failed main offline restore;
3. kill each rename state recovers;
4. host restart blocks primary/status available;
5. `.git` reconstruct;
6. candidate switchback before refs;
7. incompatible protocol before drain;
8. double failure critical;
9. cgroup descendant termination;
10. disk/device fail before drain;
11. in-place non-entrypoint runtime mutation caught tree digest;
12. stale pending recovery;
13. primary starts unexpectedly and receives worker; controller stops/re-masks/drains before any rollback mutation.

## Validation and Acceptance

Feasibility: actual controls verified or blocked.

Routing: only four direct main workflows use group; other path/ref unschedulable; pins/permissions/timeouts.

Main trigger: PR-only no-bypass ruleset makes push merge result; emergency direct push blocked.

Portable: exact target hosted/no deployment secret/self-hosted; failure prevents deploy; moved branch no substitution.

Approval: temporary/bootstrap deploy cannot enter concurrency/runner before approval.

Freshness: old workflow commit cannot mutate after main advances. Main stale superseded; temp/bootstrap stale fail.

Admission: parallel helpers at most one pending; service claims once; stale pending safe.

Serialization: GitHub queue/busy/host flock no interleave; order irrelevant; overflow visible.

Clean worktree: preexisting changes block; post-updater exact clean; restoration removes only post-journal debris; ignored state not silently purged.

Drain/mask: listener stopped, workers drained, runtime mask applied and retained through temporary window; attempted start fails. Any unexpected start is stopped/re-masked and drained before rollback mutation.

Ownership: deployer no direct write; Git admin; stage builder; active/controller/recovery root; health primary user.

Protocol: unsupported before drain; updater stage-only/no credentials/no active/service/controller/journal/mask mutation; prebootstrap helper works, managed direct fails.

Controller ownership: full active tree digest unchanged across updater; controller alone journals/renames. Violation restores.

Staging: build failure active untouched; device/capacity before drain; rename interruption recovers; backup retained; clean dependencies.

Cgroup: timeout TERM/KILL descendants; restoration after inactive.

Temporary isolation: primary masked/stopped through target and LKG restoration.

Bootstrap: no invented LKG; failure fallback; success current only, safe primary, markers last.

Main: current target/control plane, drain/mask, exact checkout, host checks, stage-only updater, controller activation, manifest/health, candidate-before-refs, atomic refs/metadata, safe unmask/start/final consistency; failure guarded re-drain/revert.

Runtime identity: checkout/manifest/full-tree+entrypoint digests/metadata/controller/current agree; invalid fails.

Listener readiness: stable service/listener/runner identity/credential metadata; no GitHub scheduling claim.

Cancellation: workflow loss not root service; next waits; boot recovery before primary, status independent.

Recovery: offline source/Git/runtime/interrupted/controller/critical; no malicious-root/whole-VM guarantee.

Logging: bounded root raw with truncation; normalized workflow diagnostics; no full transcript/secret guarantee.

Outcomes:

- superseded main: success/no mutation;
- main success: accepted success;
- main fail + healthy restore: workflow fail, host prior LKG;
- temporary target success + restore: success;
- temporary target fail + restore: fail, host LKG;
- stale temp/bootstrap: fail/no mutation;
- unproven restore/drain after unexpected start: fail critical.

Completion: all Progress evidence, tests/CI/review, production/disposable demonstrations.

## Idempotence and Recovery

Fresh install one-time. Setup/migration absent/exact/partial/conflict; attempt-owned compensation.

Migration restartable; deploy runner may start pending, no accepted refs/managed markers; conflicts fail.

Submission serialized by request lock/exclusive pending. Reused ID conflict rejected. Status read-only.

Root journal strict/bounded/atomic records request, control-plane/target, transaction ref, primary prior state, mask state, drain, checkout, updater unit, active tree digests, stage, controller backup/activation, health, candidate, refs, unmask/start, restoration, terminal.

Target updater never writes journal. Controller observes independently before phase transitions.

Same filesystem runtime states old-active/stage-only/backup-without-active/new-active+backup distinguishable.

Refs atomic; metadata journaled; bootstrap current only; refs protect objects.

Recover never retries target; converges prebootstrap/LKG, ensures primary mask while mutating, restores source/runtime/controller/health, safely unmasks/starts, archives after success.

Unknown keeps primary/mutation stopped and masked when possible; status available; admin repair required.

Direct unmanaged mutation prohibited; emergency explicit/recorded then accepted-main/rebootstrap.

Tests temporary roots/local Git/fake systemd/process/service/deterministic barriers, no real settings/production/network.

## Artifacts and Notes

Append-only:

- 2026-07-21 baseline/GitHub review, draft PR #47, living format.
- 2026-07-21 first through seventh adversarial corrections as recorded in `Progress`.

Future evidence: settings; hashes; tests/counts/coverage; group/workflows/environments/ruleset; ownership/device/capacity; admission; mask/drain; phases/cgroup/digests/controller/restoration/final; recovery refs/fsck; stage/backup; cancellation/boot; demonstrations; CI/final review.

GitHub docs reviewed:

- `https://docs.github.com/en/actions/reference/runners/self-hosted-runners`
- `https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access`
- `https://docs.github.com/en/rest/actions/self-hosted-runner-groups`
- `https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow`
- `https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments`
- `https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency`
- `https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job`
- `https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/monitor-and-troubleshoot`

Non-goals: hostile isolation; guaranteed malicious-root/VM/disk/network/systemd/resource recovery; autoscaling/ephemeral/JIT; persistent PAT/App; forks/arbitrary repos; parallel mutation; pre-promotion GitHub job proof; VM snapshots; general data/package reversal; Docker re-enable; pre-protocol branches; automatic breaking migration.

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

Recovery unit required before primary; deploy runner independent for status. Controller uses runtime mask on exact primary unit during mutation.

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

Mode from helper; values revalidated against Git; no credential.

Managed updater environment:

    AGENT_RELAY_UPDATE_MODE=controller-stage-v1
    AGENT_RELAY_TRANSACTION_ID=<validated-id>
    AGENT_RELAY_BUILD_ROOT=<controller-created-path>
    AGENT_RELAY_RUNTIME_STAGE=<controller-created-path>
    AGENT_RELAY_EXPECTED_SOURCE_SHA=<target-sha>

Updater finalizes stage/declared host state only; active runtime/services/controller/journal/mask unchanged.

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

Journal:

    interface DeploymentTransaction {
      schemaVersion: 1;
      transactionId: string;
      requestId: string;
      mode: "main" | "temporary" | "bootstrap";
      controlPlaneSha: string;
      sourceType: "push" | "pr" | "branch";
      source: string;
      targetRef: string;
      targetSha: string;
      targetTransactionRef?: string;
      previousCheckoutSha?: string;
      previousAcceptedSha?: string;
      previousControllerVersion: string;
      primaryServiceWasActive: boolean;
      primaryRuntimeMasked: boolean;
      updaterUnit?: string;
      activeRuntimeTreeSha256Before?: string;
      activeRuntimeTreeSha256AfterUpdater?: string;
      runtimeStagePath?: string;
      runtimeBackupPath?: string;
      phase:
        | "submitted"
        | "preflight"
        | "superseded"
        | "draining"
        | "primary_masked"
        | "drained"
        | "target_checked_out"
        | "target_building"
        | "runtime_staged"
        | "runtime_backup_renamed"
        | "runtime_activated"
        | "target_health"
        | "controller_staging"
        | "controller_provisional"
        | "accepting_refs"
        | "starting_primary"
        | "restoring_checkout"
        | "restoring_runtime"
        | "restoring_health"
        | "restoring_primary"
        | "completed"
        | "critical_recovery";
      targetResult?: OperationResult;
      restorationResult?: OperationResult;
      runtimeManifestSha256?: string;
      finalActiveSha?: string;
      finalAcceptedSha?: string;
      logPath: string;
      startedAt: string;
      updatedAt: string;
    }

    interface OperationResult {
      kind: "success" | "exit" | "signal" | "timeout" | "validation" | "infrastructure";
      exitCode?: number;
      signal?: string;
      code: string;
    }

Exact serialization may differ but bounded/strict/credential-free/restart-sufficient.

Bounded config: request, validation, approval, drain/fetch/host/updater/health/primary/transaction/busy deadlines; TERM/KILL; disk headroom; status; logs; retention.

Use pinned existing host tools where possible. No third-party runtime dependency without recorded necessity.

Revision note (2026-07-21): Seventh adversarial review added a controller-owned runtime mask for the primary service across every mutation/temporary-restoration window and a mandatory stop/re-mask/drain guard before rollback if primary ever starts unexpectedly. This closes the accidental scheduling race that post-factum service checks could not prevent. Plan only; implementation not complete.