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
- controller stops primary listener, drains every active `github-runner` worker, and runtime-masks primary before checkout mutation; mask remains until final accepted/restored runtime is ready;
- managed target `update.sh` executes as root only inside controller-created transient systemd unit, prepares a runtime stage and declared host changes, and never owns active-runtime activation or transaction state;
- trusted installed controller alone owns runtime backup, activation rename, journal, accepted refs, service unmask/start and restoration;
- previous active runtime remains retained until terminal acceptance/restoration, including first bootstrap before LKG;
- temporary target cannot start primary through normal systemd service control, and controller continuously checks for direct primary listener/worker processes during target execution;
- controller health-checks candidate runtime as `github-runner` inside a systemd sandbox with private network, temporary home, read-only runtime and no Codex credentials;
- failed main attempts network-independent convergence to previous local LKG;
- workflow cancellation does not kill post-mutation host transaction because root systemd service owns it;
- results distinguish target, restoration and critical recovery.

Selected revisions are trusted same-repository code and execute with broad host authority to test real privileged updater. System provides **best-effort rollback for accidental failures**, not malicious-code isolation or VM snapshot. Privileged target can defeat same-VM controls. Root ownership, runner groups, approvals, sanitization, cgroups, masks and second runner must never be described as protection from malicious privileged target.

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
- [x] (2026-07-21) Seventh review added primary runtime mask and mandatory re-drain after unexpected primary start.
- [x] (2026-07-21) Eighth review removed post-migration direct updater modes, added direct listener/worker monitoring, no-symlink runtime, and temporary controller-candidate self-test.
- [x] (2026-07-21) Ninth review fixed managed-updater authority to explicit root transient unit, required enforceable sandboxed health with private network, and made the administrator lock-file inode immutable after installation.
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
- Bootstrap needs pre-LKG source/runtime/service fallback.
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
- Runtime mask prevents normal service start, but direct runner launch requires process monitor and re-drain guard.
- Direct updater during bootstrap-pending invalidates fallback; managed updater always refuses direct invocation.
- Temporary controller candidate should self-test but never activate.
- Active/staged runtime symlink or special file makes digest/backup unsafe; reject it.
- Managed updater cannot run as recorded administrator because automated job has no interactive sudo ticket. It must run as root in the controller-owned transient unit; root mode is accepted only by the versioned managed protocol and direct user invocation still refuses.
- Saying health performs no network request is insufficient without enforcement. Health runs in a separate transient unit with `PrivateNetwork=yes`, `NoNewPrivileges=yes`, temporary HOME/PrivateTmp, read-only active runtime and no source checkout access.
- The administrator file is both identity and common lock inode. Replacing it after installation would split locking between old and new inodes. Migration must validate it but never replace it; changing administrator identity requires an offline explicit reprovisioning procedure with both runner services stopped and no pending transaction.

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
- Exact existing `/etc/agent-relay/administrator` inode is the common flock object for controller and recovery. Installer creates it once. Migration only validates it and never atomically replaces, truncates, chmods or chowns it. Administrator change is offline reprovisioning, not deployment.
- Stop/drain primary before checkout; drain timeout no kill/no mutation/prior-state restore.
- After drain, runtime-mask primary. Journal mask. Target/restoration run masked. Only controller unmasks before final start.
- During updater, controller monitors mask/service and primary UID listener/worker. Violation terminates updater, stops/re-masks, drains, and forbids mutation until safe.
- Git mutation as recorded administrator.
- `controlPlaneSha == current origin/main` all mutating modes. Main/bootstrap target also current; temporary pinned separately.
- Main ruleset PR-only, no force/delete/bypass for deployment workflows; otherwise Milestone 0 blocks.
- Backward-compatible deployment protocol; old branch rebase/merge; breaking migration separate.
- Managed updater stage producer only; no active runtime, controller state/refs/journal or runner service/mask control.
- Managed updater executes as root only in `agent-relay-update@<transaction>.service`, with controller-provided validated paths and sanitized fixed environment. It must not invoke `sudo`; builder subprocess remains `agent-relay-builder`.
- Controller records full active-runtime tree digest before/after updater and alone activates stage. Active/stage contain only regular files/directories.
- Existing host migrates before new updater. Direct updater always refuses once new code is checked out. Bootstrap is first mutation; admin recovery/rebootstrap are local commands.
- Updater cgroup timeout/TERM/KILL plus listener monitor.
- Local health runs as `github-runner` in separate transient sandbox: `PrivateNetwork=yes`, `NoNewPrivileges=yes`, private temp/home, read-only active runtime, inaccessible source checkout, fixed executable/arguments and bounded output.
- Recovery refs authoritative; metadata journaled.
- Automatic main latest-only; stale main superseded, stale temporary/bootstrap fail.
- Before bootstrap only bootstrap/status.
- Main may provisionally switch compatible controller candidate before refs. Temporary only isolated self-test.
- Deployment runner status available in critical recovery if valid.
- Docker disabled.

Dates/authors: 2026-07-21 architecture/adversarial revisions under operator instructions. Update when decisions change.

## Outcomes & Retrospective

Plan remains active; no production behavior changed.

Design resolves validation, smoke, bootstrap, cancellation, activation, admission, authority and post-migration transition circularities. Same-VM privileged-target limitation remains explicit.

Milestone 0 blocks if GitHub controls unavailable. Update after milestones; complete only with real/disposable evidence.

## Context and Orientation

Current checkout `/srv/github-runner/storage/agent-relay` administrator-owned; `dist` root-owned. Primary paths `work`, `runner`, `home`; builder `build`, `build-home`. Users `github-runner`, `agent-relay-builder`. `/etc/agent-relay/administrator` records admin and is current lock inode. Primary service `actions.runner.Divorium.gh-runner.service`.

Current installer one-time, PAT only for short-lived registration token, no PAT persistence. Current updater admin-only, locks admin file, stops primary, waits workers indefinitely, deletes/rebuilds active `dist`, starts primary, Docker disabled. Current workflows bare `[self-hosted]`; route to `agent-relay-main` before second runner starts.

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

Terms: primary runner; deployment runner; control-plane SHA; portable validation; installed host compatibility; root controller; versioned deployment protocol; LKG recovery current ref; prebootstrap source/runtime/service fallback; sandboxed local runtime health; critical recovery.

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

Define fixed compiled runtime health: no arbitrary command, no source/persistent write, bounded diagnostics. Controller invokes it only through sandboxed systemd health unit with private network and read-only runtime.

Define stage protocol: controller creates build/stage paths; managed root updater writes stage/build and declared host state, finalizes manifest, leaves active runtime/services/controller state unchanged. Stage/active only regular files/directories.

### Milestone 2: Human workflows

Four direct full-SHA-action-pinned, minimum-permission, bounded-timeout workflows:

- `deploy-main.yml`: `push main` plus `workflow_dispatch` only from main; target/controlPlane github.sha; hosted portable validation; direct deploy group+label; shared concurrency `queue:max`; main helper/status. PR-only ruleset makes push merge result.
- `deploy-temporary.yml`: dispatch main only; controlPlane github.sha; exact same-repo PR/branch, draft allowed; reject fork/tag/merge/url/malformed/protocol; hosted validation; protected hosted approval; then direct deploy shared concurrency; temporary helper/status.
- `deploy-bootstrap.yml`: dispatch main only; exact current main/controlPlane; validation; protected approval; direct deploy; bootstrap helper.
- `deploy-status.yml`: dispatch main only; read-only status; no target/concurrency/mutation.

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
- installer creates administrator file exactly once; migration validates same inode/owner/mode/content and never replaces it;
- migrate before new updater; missing helper safe refusal;
- once migration starts/bootstrap-pending exists, direct updater refuses;
- recovery initialized no invented LKG;
- clean admin-owned exact current main; reject tracked/unexpected untracked;
- import bootstrap-source, record primary state/runtime without provenance;
- validate current active runtime no symlink/special entries before fallback;
- same-device/free-space;
- bootstrap pending, start deploy runner, disable main/temp;
- bootstrap; markers after success.

Failed bootstrap restores source/runtime/service, remains pending, no LKG.

### Milestone 4: Submission and independent service

Mode helper no args, bounded canonical JSON, request lock, exclusive pending create+fsync, starts service. Derive mode; validate schema/limits/repo/SHA/source/run/audit/controlPlane; reject unknown/control chars/state conflict. No credentials.

Service atomically claims pending into journal while host flock held. Start failure removes only own pending. Stale pending recovery deterministic.

Selected workflow+locked deploy account is auth boundary. Root service owns transaction; status bounded/read-only; fixed systemd environment no workflow token inheritance.

Boot recovery required before primary but independent from deployment runner. Unknown keeps primary/mutation stopped, status available when possible.

### Milestone 5: Host transaction

One flock on immutable administrator-file inode across preflight through terminal.

Preflight:

1. validate request/mode/protocol/checkout owner/remote/config/no submodule/worktree/recovery/refs/controller/journal/admin-file inode and metadata;
2. clean tracked/no unexpected nonignored untracked;
3. fetch expected ref transaction namespace as admin, hooks disabled;
4. verify object=target/protocol;
5. import target transaction ref;
6. fetch origin/main; controlPlane=current all modes; main/bootstrap target=current; stale main superseded, stale temp/bootstrap fail;
7. verify LKG/bootstrap fallback;
8. same-device/free-space/path ownership/modes/no symlink;
9. installed host compatibility;
10. deterministic full active-runtime tree digest; reject symlink/special file.

Drain/isolation:

1. journal prior primary state;
2. stop primary, bounded drain;
3. timeout restores prior state/no mutation;
4. runtime-mask primary and verify masked/inactive/no listener/no worker;
5. journal mask and durable drained;
6. start controller monitor for mask/service and primary UID listener/worker; terminate updater on violation;
7. unexpected primary process => stop/re-mask/drain before further mutation; inability => critical.

Staging:

1. reset/clean tracked checkout exact target as admin; verify owner/HEAD;
2. create build/stage roots;
3. start exact admin-owned regular non-symlink target updater as **root** in transient `agent-relay-update@id.service`; root mode requires exact managed protocol environment and refuses ordinary invocation; unit environment is fixed/sanitized and contains no workflow credentials;
4. updater may build stage/declared host work but not active runtime/controller state/refs/journal/runner services/mask; it does not call `sudo`; compiler subprocess runs as builder;
5. wait cgroup inactive TERM/KILL and monitor final invariants;
6. require primary masked/inactive, no listener/worker, deploy service unchanged, active-runtime tree digest unchanged, exact clean checkout, controller state unchanged;
7. verify finalized stage no symlink/special entry and manifest/digests/owner/modes/provenance;
8. controller journals stage, renames active to backup, journals, renames stage active, journals;
9. verify active manifest/tree;
10. run health in separate transient unit as github-runner with `PrivateNetwork=yes`, `NoNewPrivileges=yes`, private temp/home, read-only active runtime, source checkout inaccessible, fixed executable/arguments and bounded output;
11. retain backup.

Main acceptance:

- candidate stage/self-test, reject breaking, provisional switch/post-test before refs;
- verify transaction object;
- atomic previous/current/generation refs and journaled metadata;
- remove mask only after accepted target/controller/runtime complete;
- start primary; verify stable listener/runner identity/labels/credential metadata;
- failure after unmask/start: stop/re-mask, bounded drain any worker, then revert; drain failure => critical;
- final consistency and bounded retention.

Temporary:

- target health, no refs/active candidate;
- controller candidate isolated self-test only, no switch;
- primary remains masked;
- restore current LKG checkout;
- LKG root stage-only updater cgroup; controller activation/manifest/sandboxed health/controller;
- unmask/start primary after LKG complete;
- startup failure uses stop/re-mask/drain guard;
- separate outcomes; unproven critical.

Bootstrap:

- no LKG; bootstrap-source/runtime fallback; primary masked after drain;
- exact current main root stage-only update/activation/sandboxed health; candidate before refs;
- current+generation, previous absent;
- unmask/start/readiness; markers last;
- failure stop/re-mask/drain if needed, restore prebootstrap, safe prior unmask/start.

### Milestone 6: Updater, activation, recovery, upgrade

New updater has no direct mutation mode:

- before migration, old baseline updater remains legacy path;
- once repository contains managed updater, direct invocation always fails with migration/bootstrap/deployment/recovery instruction;
- controller invokes managed stage-only root mode in transient unit;
- managed mode accepts root only when exact required environment/path/protocol validation succeeds; rejects missing/extra unsafe parameters and direct shell use;
- root updater never calls sudo; builder subprocess remains unprivileged;
- clean transaction build/stage, no source dependency cache;
- manifest schema/source/protocol/updater/runtime+health paths/digests/timestamp/finalized;
- Docker disabled.

Recovery refs current/previous/bootstrap-source/transactions/generations atomic; bootstrap previous absent; protect objects.

Offline recovery restores source, root stable stage-only updater, controller activation, sandboxed health/controller, then safe unmask/start. Emergency Git reconstruction allowed. Valid LKG backup may start only explicit degraded critical action if stable updater fails; journal remains.

Candidates immutable/atomic symlink, validated before refs, active/previous compatible. Temporary only isolated self-test. Breaking migration separate.

Administrator identity change requires offline reprovisioning: stop both runner services, prove no pending/active journal, acquire old inode lock, install new identity file and update controller configuration atomically while all mutation entrypoints disabled, then revalidate. It is not part of ordinary deployment.

### Milestone 7: Documentation and acceptance

Document hosted validation, direct workflows, PR-only main, approvals, control-plane freshness, bootstrap, admission, immutable lock inode, queue/busy, drain/mask/process monitor/cgroup, root managed updater, controller activation, runtime digest/no-symlink manifest, sandboxed health limitation, latest-main, direct updater refusal, recovery refs/backups, critical recovery, upgrades, logs, Docker disabled, best effort.

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

Real migration/bootstrap: labels/group/no Codex; pending normal reject; direct updater refusal; immutable admin inode; installed ownership/modes; no tokens; device/capacity; exact bootstrap root-stage/activation/manifest/sandboxed health/safe unmask/readiness/current ref/previous absent/markers last.

Production:

1. temporary success, primary masked/stopped, candidate self-test only, restoration;
2. updater failure preserves runtime/LKG restore;
3. drain timeout no mutation;
4. stale target/control plane no mutation;
5. main success LKG;
6. direct updater rejected;
7. workflow cancel root service completes/restores;
8. status active/terminal;
9. unexpected untracked blocks;
10. updater attempts active runtime/checkout/service/controller/mask mutation detected;
11. concurrent submit one pending;
12. direct main push blocked;
13. direct Runner.Listener launch detected/aborted/re-drained;
14. health sandbox proves no network, no source access, no persistent HOME and no Codex credentials;
15. managed updater root path works without interactive sudo and rejects direct root invocation missing controller protocol.

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
11. in-place runtime mutation caught digest;
12. stale pending recovery;
13. symlink/special runtime rejected;
14. bootstrap-pending direct updater cannot invalidate fallback;
15. attempted administrator-file replacement during pending/active transaction fails and does not split lock.

## Validation and Acceptance

Feasibility: actual controls verified or blocked.

Routing: only four direct main workflows use group; other path/ref unschedulable; pins/permissions/timeouts.

Main trigger: PR-only no-bypass ruleset makes push merge result; direct push blocked.

Portable: exact target hosted/no deployment secret/self-hosted; failure prevents deploy; moved branch no substitution.

Approval: temporary/bootstrap deploy cannot enter concurrency/runner before approval.

Freshness: old workflow commit cannot mutate after main advances. Main stale superseded; temp/bootstrap stale fail.

Admission: parallel helpers at most one pending; service claims once; stale pending safe.

Serialization: queue/busy/host flock no interleave; order irrelevant; overflow visible. Administrator lock inode cannot change during managed lifetime.

Clean worktree: preexisting changes block; post-updater exact clean; restoration removes only post-journal debris; ignored state not silently purged.

Drain/mask/monitor: listener stopped, workers drained, mask retained. Normal/direct start attempts detected; updater aborted; no rollback mutation until re-drain safe.

Ownership/authority: deployer no direct write; Git admin; stage builder; active/controller/recovery root; updater root only inside managed transient unit; health primary user in sandbox.

Protocol: unsupported before drain; updater stage-only/no credentials/no active/service/controller/journal/mask mutation; direct updater refuses. Managed root mode requires exact controller environment.

Controller ownership: full active tree digest unchanged across updater; controller alone journals/renames. Violation restores.

Runtime shape: active/stage only regular files/directories. Digest covers sorted paths/type/uid/gid/mode/content.

Staging: build failure active untouched; device/capacity before drain; rename interruption recovers; backup retained; clean dependencies.

Cgroup: timeout TERM/KILL descendants; restoration after inactive.

Health sandbox: `PrivateNetwork`, no new privileges, private temp/home, read-only runtime, inaccessible source, no credentials; fixed command and bounded output.

Temporary isolation: primary masked/stopped through target and LKG restoration; candidate self-tested never activated.

Bootstrap: no invented LKG; direct updater cannot alter fallback; failure restores; success current only, primary, markers last.

Main: current target/control plane, drain/mask/monitor, exact checkout, host checks, managed root stage updater, controller activation, manifest/sandboxed health, candidate-before-refs, atomic refs/metadata, safe unmask/start/final consistency; failure guarded re-drain/revert.

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

Migration restartable; deploy runner may start pending, no accepted refs/managed markers; direct updater refuses; admin lock inode unchanged; conflicts fail.

Submission serialized by request lock/exclusive pending. Reused ID conflict rejected. Status read-only.

Root journal strict/bounded/atomic records request, control-plane/target, transaction ref, primary prior state, mask/monitor, drain, checkout, updater unit/authority, active tree digests, stage, controller backup/activation, sandboxed health, candidate, refs, unmask/start, restoration, terminal.

Target updater never writes journal. Controller observes independently before phase transitions.

Same-filesystem runtime states old-active/stage-only/backup-without-active/new-active+backup distinguishable. Invalid tree shapes rejected.

Refs atomic; metadata journaled; bootstrap current only; refs protect objects.

Recover never retries target; converges prebootstrap/LKG, ensures primary mask/no primary processes while mutating, restores source/runtime/controller, sandboxed health, safely unmasks/starts, archives after success.

Unknown keeps primary/mutation stopped and masked when possible; status available; admin repair required.

Direct unmanaged mutation prohibited; emergency explicit/recorded then accepted-main/rebootstrap.

Tests temporary roots/local Git/fake systemd/process/service/deterministic barriers, no real settings/production/network.

## Artifacts and Notes

Append-only:

- 2026-07-21 baseline/GitHub review, draft PR #47, living format.
- 2026-07-21 first through ninth adversarial corrections as recorded in `Progress`.

Future evidence: settings; hashes; tests/counts/coverage; group/workflows/environments/ruleset; ownership/device/capacity/inode; admission; mask/monitor/drain; phases/cgroup/digests/controller/health sandbox/restoration/final; recovery refs/fsck; stage/backup; cancellation/boot; demonstrations; CI/final review.

GitHub docs reviewed:

- `https://docs.github.com/en/actions/reference/runners/self-hosted-runners`
- `https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access`
- `https://docs.github.com/en/rest/actions/self-hosted-runner-groups`
- `https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow`
- `https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments`
- `https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency`
- `https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job`
- `https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/monitor-and-troubleshoot`

Non-goals: hostile isolation; guaranteed malicious-root/VM/disk/network/systemd/resource recovery; autoscaling/ephemeral/JIT; persistent PAT/App; forks/arbitrary repos; parallel mutation; pre-promotion GitHub job proof; VM snapshots; general data/package reversal; Docker re-enable; pre-protocol branches; automatic breaking migration; temporary activation of controller candidate.

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

Recovery unit required before primary; deploy runner independent for status. Controller uses runtime mask and process monitor for exact primary service/UID during mutation.

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

Updater runs as root only in controller-created transient unit, finalizes stage/declared host state, does not call sudo, and leaves active runtime/services/controller/journal/mask unchanged.

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
      healthUnit?: string;
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
        | "controller_candidate_test"
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

Bounded config: request, validation, approval, drain/fetch/host/updater/health/primary/transaction/busy deadlines; monitor interval; TERM/KILL; disk headroom; status; logs; retention.

Use pinned existing host tools where possible. No third-party runtime dependency without recorded necessity.

Revision note (2026-07-21): Ninth adversarial review resolved the final execution-boundary ambiguities: managed updater runs as root only in a controller-created transient unit and no longer depends on interactive sudo; runtime health is enforced in a private-network, no-new-privileges systemd sandbox; and `/etc/agent-relay/administrator` is an immutable post-installation lock inode, with administrator changes moved to offline reprovisioning. Plan only; implementation not complete.