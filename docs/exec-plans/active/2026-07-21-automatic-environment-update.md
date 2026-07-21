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

- a merge into protected `main` is observed through the resulting `push` event, the exact merge-result SHA is validated on GitHub-hosted infrastructure, and it is deployed only if both target and workflow-control commits are still current when the host transaction begins;
- a manual retry can deploy only current protected `main`;
- an authorized operator can manually select an open same-repository PR, including a draft PR, or same-repository branch, resolve it once to an exact SHA, validate it away from both self-hosted runners, and test that revision's real privileged `update.sh` on the real VM;
- a second persistent deployment runner remains independent of primary Agent Relay runtime and can submit or inspect transactions while primary is stopped or broken;
- controller stops primary listener and drains every active `github-runner` worker before checkout mutation;
- target `update.sh` is a stage producer in managed mode; trusted installed controller alone owns active-runtime backup, activation rename, journal, accepted refs, service startup and restoration;
- previous active runtime remains retained until acceptance or restoration completes, including first bootstrap before an LKG exists;
- primary remains stopped through every temporary-target stage, health check and LKG restoration, so ordinary CI/Codex never runs against temporary runtime;
- failed main attempts network-independent convergence to previous locally retained LKG;
- workflow cancellation does not kill a post-mutation host transaction because root systemd service owns it;
- results distinguish target outcome, restoration outcome and critical recovery.

Selected revisions are trusted same-repository code and execute with broad host authority to test the real privileged updater. This system provides **best-effort rollback for accidental failures**. It is not malicious-code isolation or VM snapshot. Privileged target can damage same-VM controls. Root ownership, runner groups, approvals, environment sanitization, cgroups and second runner must never be described as protection from malicious privileged target code.

Acceptance does not claim primary registration already accepted a GitHub job. Starting primary during temporary transaction would let unrelated queued work race onto temporary runtime. Without retained organization-management credential for dynamic runner control, transaction proves runtime locally and starts primary only after final state selection.

`DOCKER_PROVISIONING_ENABLED=0` remains authoritative. This plan must not re-enable Docker provisioning or reopen PR #46.

## Progress

Keep append-only. Checked implementation items require repository location plus passing automated evidence, or reproducible command plus captured result. Blocked items remain unchecked with `[blocked]`.

- [x] (2026-07-21) Reviewed installation, updater, runner, CI, Codex, documentation, and package-script contracts on baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- [x] (2026-07-21) Confirmed primary cannot synchronously update itself because updater stops listener and waits for every `Runner.Worker` owned by `github-runner`.
- [x] (2026-07-21) Reviewed GitHub persistent/ephemeral/JIT runners, registration tokens, labels, groups, selected workflows, dispatch, environments, concurrency queue, and self-hosted behavior.
- [x] (2026-07-21) Selected second persistent deployment runner for one long-lived VM.
- [x] (2026-07-21) Converted notes to PR #3 living ExecPlan structure.
- [x] (2026-07-21) First adversarial review corrected drain ordering, overstated recovery, ownership/authorization, exact-SHA, queue, LKG, journal, controller upgrade and Docker scope.
- [x] (2026-07-21) Second adversarial review corrected primary-dependent validation/smoke, workflow lifetime, bootstrap circularity, unmanaged updates, reusable caller ambiguity and protocol compatibility.
- [x] (2026-07-21) Third adversarial review removed unnecessary OIDC/reusable machinery, added direct selected workflows, diagnostic availability, staged runtime/prebootstrap fallback, controller-before-refs and approval-before-concurrency.
- [x] (2026-07-21) Fourth adversarial review added control-plane freshness, transaction refs, worktree policy, filesystem/capacity checks, transient updater cgroup, service invariants and clean build-state requirements.
- [x] (2026-07-21) Fifth adversarial review made installed controller sole owner of active-runtime activation/journal and target updater stage-only.
- [x] (2026-07-21) Sixth adversarial review added atomic pending-request admission, complete active-runtime tree digest, PR-only protected-main policy, updater/control-plane timeouts, and controller-observed source/service/runtime invariants.
- [ ] Complete Milestone 0 with actual GitHub-side evidence before implementation code.
- [ ] Revalidate baseline and human workflows immediately before implementation.
- [ ] Implement protocol, portable validation, stage-only updater, controller activation, manifest/health, managed/manual boundary.
- [ ] Implement fresh install/migration for deployment account, runner/group, controller services, recovery/state/stage roots and bootstrap pending.
- [ ] Implement submission, root transaction, drain, checkout, updater cgroup, health, acceptance, restoration, cancellation and boot recovery.
- [ ] Human reviewer: add direct main/temporary/bootstrap/status workflows; route ordinary jobs only to `agent-relay-main`; configure group, environments, rulesets and concurrency.
- [ ] Add deterministic unit/contract/integration/system coverage.
- [ ] Run focused/full validation, exact-head CI and independent review.
- [ ] Perform real-host migration and temporary/main tests; disposable-VM failed-main/cancellation/restart/bootstrap/controller tests.
- [ ] Complete retrospective/evidence and move same plan to `completed` only after every item checked.

## Surprises & Discoveries

- Checkout mutation before drain changes scripts used by active jobs; drain must precede reset.
- Another runner under `github-runner` UID retains self-wait deadlock; deployment runner needs distinct UID.
- Root-owned same-VM controls do not constrain root-equivalent target; rollback language must remain best effort.
- Current updater lock begins too late and ends too early; one lock spans Git through final state.
- Exact validation cannot depend on primary; portable validation runs GitHub-hosted.
- Complete `npm run check` is host-specific; add portable check without weakening full host check.
- Primary GitHub smoke creates scheduling race; use local network-free health while primary stopped.
- Current updater deletes active `dist` before build succeeds; managed stage/backup is required.
- Checkout SHA does not prove runtime provenance; manifest/digests required.
- Current `origin/main` is not rollback state; local accepted refs required.
- Text SHA does not retain object; protected bare recovery repository required.
- Restoration cannot require GitHub network.
- Workflow cancellation cannot own host safety; root systemd service must continue.
- Direct selected workflows are simpler than reusable workflow/custom OIDC for this repo.
- Approval must complete before deploy-job concurrency so unresolved approval cannot block main.
- Cancellation releases GitHub concurrency before root transaction; next job must wait on authoritative host status.
- Bootstrap needs deployment runner before LKG; bootstrap-pending admits only bootstrap/status.
- Bootstrap failure needs preserved checkout/runtime before LKG exists.
- Direct managed `git pull && ./update.sh` diverges accepted state; fail closed after bootstrap.
- Controller upgrades must remain backward compatible with active updater/manifest/journal protocol.
- Unknown recovery blocks primary/mutation, not diagnostic deployment runner.
- Runner credential bytes may rotate; verify type/owner/mode and stable identity, not byte hashes.
- Queued workflow code can become stale; `controlPlaneSha` must equal current main before mutation.
- Exact target belongs in recovery transaction ref before mutation.
- Runtime stage/backup/active roots must share filesystem and have capacity headroom.
- Transient systemd cgroup is stronger accidental descendant control than shell process group.
- Pre-existing unexpected nonignored untracked files must block rather than be silently deleted.
- Managed build must not consume stale source `node_modules` or ignored dependency cache.
- Target updater cannot own journal/activation rename; controller must observe and perform them.
- Post-updater exact HEAD, tracked cleanliness and no unexpected nonignored debris are required before activation.
- Existing host must migrate before using new updater; missing installed helper must refuse rather than fall back destructively.
- Two helpers could race before systemd service acquires transaction lock; root-only pending-request file created with exclusive semantics is required.
- Target updater could modify active runtime in place without rename; controller records deterministic full-tree digest before updater and requires it unchanged before activation.
- `push main` is only a merge signal if ruleset requires PRs and disallows bypass; Milestone 0 must prove that policy.

## Decision Log

- Use second persistent organization runner on same VM; ephemeral/JIT adds credentials/lifecycle without VM isolation.
- Restoration is best effort for accidental failures.
- Use four direct workflows pinned to protected main: `deploy-main.yml`, `deploy-temporary.yml`, `deploy-bootstrap.yml`, `deploy-status.yml`.
- Runner group permits exactly those four paths at `refs/heads/main`, selected public repository, label `agent-relay-deploy`.
- Temporary/bootstrap use protected-environment approval completed before deploy-job concurrency.
- Validate exact target on `ubuntu-latest`; pin all actions to full commit SHA; use minimum token permissions and explicit job timeouts.
- Deployment account has no direct checkout/root-state write; selected workflow plus locked account is control-plane boundary; no custom OIDC.
- Mode-specific no-argument submit helpers read bounded canonical JSON from stdin; status is read-only.
- Submission helper serializes admission with root-only request lock and creates `pending-request.json` using exclusive create; exactly one pending/active request exists.
- Root systemd transaction owns host safety independently of workflow lifetime.
- Host flock is authoritative; GitHub concurrency is advisory. Use exact `/etc/agent-relay/administrator` inode for manual prebootstrap, controller and recovery; controller-mode updater does not reacquire.
- Stop primary and boundedly drain all primary workers before checkout; timeout kills no job and restores prior listener.
- Run Git as recorded administrator through root controller.
- `controlPlaneSha` must equal current protected `origin/main` for every mutating mode. Main/bootstrap target also equals current main; temporary target is independently pinned.
- Protected-main ruleset must require pull request for all normal changes, block force-push/deletion and disallow bypass for deployment workflow changes. `push main` then represents merge result. If repository cannot enforce this, Milestone 0 blocks and trigger design must change.
- Define backward-compatible deployment protocol before managed mode; old branches rebase/merge baseline; breaking change separate migration.
- Managed target updater is stage producer only. It may perform declared target host work and finalize stage, but may not activate `dist`, write controller state/refs/journal or control runner services.
- Installed controller alone validates/activates stage, journals boundaries and restores.
- Before updater, controller records deterministic active-runtime tree digest over sorted relative paths, file contents, type, owner, group and mode; after updater digest/path must be unchanged and no unexpected `dist` replacement exists.
- Existing host must run migration before new updater; missing installed activator refuses safely. Prebootstrap manual update uses installed activator and same lock.
- Run updater in unique transient systemd service with `KillMode=control-group`, fixed timeout/TERM/KILL; restoration begins only after unit inactive.
- Local health runs as `github-runner` under `env -i`, temporary HOME/state, no Codex credentials/network/model.
- Recovery Git refs are authoritative; metadata descriptive/journaled.
- Automatic main is latest-only. Stale target or control-plane main returns `superseded` without mutation; stale temporary/bootstrap fails.
- Before bootstrap only bootstrap/status accepted.
- After managed mode direct ordinary updater fails closed; admin recovery/rebootstrap explicit.
- Controller candidate validated and provisionally switched before accepted refs; temporary never activates candidate.
- Deployment runner remains available for read-only status in critical recovery when its own service is valid.
- Docker provisioning remains disabled.

Dates/authors for decisions above: 2026-07-21, architecture and adversarial-review revisions conducted with operator instructions. Implementation must update this log when a decision changes.

## Outcomes & Retrospective

Plan remains active. Plan-only commits changed no production behavior.

Current design resolves circular dependencies: validation independent of primary, temporary health without primary, bootstrap fallback before LKG, transaction independent of workflow, controller-owned activation, prior runtime retained, and atomic request admission. Same-VM privileged-target limitation remains explicit.

Implementation is larger than simple wrapper because runner updates itself, active jobs share checkout, runtime lacks source identity, and first managed deployment lacks LKG. Milestone 0 blocks if GitHub controls unavailable.

Update after milestones. On completion record real/disposable results and move same plan to completed.

## Context and Orientation

Current:

- `/srv/github-runner/storage/agent-relay`: administrator-owned checkout, root-owned `dist`;
- storage also contains `work`, `runner`, `home`, `build`, `build-home`;
- `github-runner`: primary/Codex, no sudo;
- `agent-relay-builder`: compiler, no sudo;
- `/etc/agent-relay/administrator`: recorded admin and current lock inode;
- primary service `actions.runner.Divorium.gh-runner.service`.

`install.sh` is one-time; installs pinned tools/accounts/runner, uses interactive organization credential only for short-lived registration token, records admin, logs Codex in.

Current `update.sh`: admin-only, locks admin file, acquires sudo, stops primary, waits workers indefinitely, deletes/rebuilds active `dist`, starts primary; Docker disabled.

Current CI/Codex use bare `[self-hosted]`; route ordinary jobs to `agent-relay-main` before second runner starts.

Expected layout:

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

Terms:

- primary runner: existing `gh-runner`, ordinary work only after final selection;
- deployment runner: selected deployment/status workflows only;
- control-plane SHA: workflow-code commit, must equal current main before mutation;
- portable validation: GitHub-hosted checks without dedicated host paths;
- host compatibility: installed non-mutating checks of commands/versions/filesystem/capacity/services/protocol;
- controller: root transaction owner outside checkout;
- deployment protocol: stable controller/updater/stage/manifest/candidate/journal contract;
- LKG: recovery `current` ref;
- prebootstrap state: exact checkout + retained runtime/service, not LKG;
- runtime health: fixed network-free command as `github-runner` temporary environment while primary stopped;
- critical recovery: mutation occurred, convergence unproven.

## Plan of Work

### Milestone 0: Prove GitHub feasibility

Verify actual organization/repository:

- manageable group, public repo access, exactly four main-pinned workflows, restrictions writable;
- installation credential minimum runner permissions;
- protected environments/reviewers and accepted self-review/bypass model;
- ruleset requires PR for normal main changes, disallows force-push/deletion and prevents bypass for workflow changes;
- `queue: max` works and 100-pending bound acceptable.

Missing control => `[blocked]`; do not start privileged runner.

### Milestone 1: Stable protocol and portable validation

Revalidate baseline/contracts.

Add `.agent-relay/deployment-protocol.json` equivalent:

    schemaVersion: 1
    updaterControllerProtocol: 1
    runtimeManifestSchema: 1
    controllerCandidateSchema: 1
    minimumControllerProtocol: 1
    maximumControllerProtocol: 1

Reject unsupported target before drain. Old temporary branch must merge/rebase protocol. Breaking change separate migration.

Add `npm run check:portable`: typecheck, tests, runtime build, shell/Node syntax, portable system tests on `ubuntu-latest` without dedicated paths/Codex login/Docker/PAT/self-hosted. Keep complete host check.

Define fixed compiled runtime health: no arbitrary command/network/model/source/persistent write; validates manifest/modules; bounded output.

Define managed stage protocol. Controller creates paths. Updater receives fixed environment, writes stage/build and declared host state only, finalizes manifest, leaves active runtime/services/controller state unchanged.

### Milestone 2: Human workflows

Four direct workflows; full-SHA action pins, minimum permissions, explicit `timeout-minutes` for validation/approval/deploy/status.

- `deploy-main.yml`: `push main` plus `workflow_dispatch` only when ref main; target/controlPlane=`github.sha`; portable validation; direct deploy job group+label; shared job concurrency `queue:max`; main helper/status. Ruleset guarantees push is merge result except explicitly documented emergency case, which must be disabled for this feature.
- `deploy-temporary.yml`: dispatch main only; controlPlane github.sha; exact same-repo PR/branch (draft allowed); reject fork/tag/merge/url/malformed/protocol; portable validation; protected GitHub-hosted approval; then direct deploy job shared concurrency; temporary helper/status.
- `deploy-bootstrap.yml`: dispatch main only; exact current main/controlPlane; portable validation; protected approval; direct deploy shared concurrency; bootstrap helper.
- `deploy-status.yml`: dispatch main only; direct read-only status; no target/concurrency/mutation.

Group allows exactly four paths at main. No reusable workflow. Deploy jobs do not checkout target/run target/expose persistent org credential/print raw output.

Canceled prior workflow: next sees busy, polls status until idle/bounded expiry, then submits; never replaces transaction.

Route all ordinary self-hosted jobs/examples to `agent-relay-main` before deploy runner starts.

### Milestone 3: Install/migrate/bootstrap pending

Fresh install + restartable migration:

- deployment account/isolated runner/no Codex;
- selected group + registration separate token; primary label without identity replacement;
- install immutable controller, submit/status/admin/activate helpers, transaction/recovery units, recovery repo, stage/backup/state/log roots, narrow sudo;
- deployer sudo only submit+status;
- tokens memory-only;
- migration before new updater; missing helper causes updater safe refusal;
- initialize recovery no invented LKG;
- clean admin-owned exact current main; reject tracked/unexpected untracked;
- import `bootstrap-source`, record primary state/runtime path without provenance;
- same-device/free-space validation;
- bootstrap pending, start restricted runner, disable main/temp;
- bootstrap workflow; markers after success.

Failed bootstrap restores source/runtime/service, remains pending, no LKG.

### Milestone 4: Submission and independent service

Mode helper no args, reads bounded canonical JSON safely serialized. It acquires `/var/lib/agent-relay-deploy/request.lock`, rejects existing pending/active incompatible state, creates `pending-request.json` with exclusive create and fsync, then starts service. Mode derived from executable. Validate fields/limits/repository/SHA/source/run/audit/controlPlane; reject unknown fields/control chars/mode conflict. No credentials.

Service atomically claims pending request into active journal while holding host flock. If service start fails, helper removes only its own pending file. Stale pending file recovery is deterministic and owner/mode checked.

Selected workflow + locked deploy account is auth boundary; compromise equals control-plane compromise.

Root service owns host transaction. Status bounded/read-only. Systemd environment fixed from root request, no workflow token/env inheritance.

Boot recovery required before primary, independent from deploy runner. Unknown keeps primary/mutation stopped; status remains when deploy service valid.

### Milestone 5: Host transaction

Use flock on exact admin-file inode across Git, drain, stage, activation, acceptance/restoration. Manual prebootstrap uses same; managed updater no lock.

Preflight:

1. validate request/mode/protocol/checkout owner/remote/config/no submodule/worktree/recovery/refs/controller/journal;
2. require tracked clean/no unexpected preexisting nonignored untracked;
3. fetch expected ref transaction namespace as admin, hooks disabled;
4. verify object=target/protocol;
5. import target to recovery transaction ref;
6. fetch origin/main; require controlPlane=current all modes; main/bootstrap target=current; stale main superseded, stale temporary/bootstrap fail;
7. verify LKG/bootstrap fallback;
8. same-device/free-space/path owner/mode/no symlink;
9. installed host compatibility only;
10. calculate deterministic active-runtime tree digest over every entry/path/type/content/uid/gid/mode; prebootstrap runtime may lack manifest but still has tree digest.

Drain:

- journal prior primary, stop listener, bounded worker wait;
- timeout restores prior listener/no mutation;
- durable drained before checkout.

Staging:

1. reset/clean tracked checkout exact target as admin; verify owner/HEAD;
2. controller creates build/stage roots;
3. run exact admin-owned regular non-symlink updater managed stage-only in transient systemd service/cgroup, fixed environment/timeout/no workflow credentials;
4. updater may build stage/declared host work but not active runtime/controller state/refs/journal/runner services;
5. wait cgroup inactive with TERM/KILL;
6. recompute active-runtime tree digest; require exact pre-run equality, exact checkout HEAD, no tracked modifications/unexpected nonignored debris, unchanged controller state, primary still stopped and deploy service unchanged;
7. verify finalized stage manifest/digests/owner/modes and clean build provenance;
8. controller journals stage, renames current dist to backup, journals, renames stage active, journals; controller owns recovery;
9. verify active manifest and run health as github-runner `env -i`, temp HOME, no credentials/network/model;
10. retain backup until terminal.

Main acceptance:

- stage/self-test candidate, reject breaking protocol;
- provisional switch/post-test before refs, switch back failure;
- verify transaction object;
- atomic previous/current/generation refs;
- journaled metadata;
- start primary; stable listener, expected runner identity/labels, registration file type/owner/mode;
- failure reverts refs/metadata/controller/checkout/runtime and restarts prior;
- final consistency; bounded retention and journal-owned cleanup.

Temporary:

- target health recorded, no refs/candidate;
- primary stopped;
- restore current LKG checkout;
- LKG updater stage-only cgroup; controller activates; manifest/health/controller;
- start primary after complete;
- separate outcomes; unproven => critical.

Bootstrap:

- no LKG; bootstrap-source/runtime fallback;
- exact current main stage/activation/health;
- candidate before refs;
- create current+generation, previous absent;
- start/readiness; markers last;
- failure restores prebootstrap.

### Milestone 6: Updater, activation, recovery, upgrade

Updater shared build logic:

- prebootstrap manual requires installed activator; admin holds same lock, updater prepares stage, activator verifies/activates/starts primary. Missing helper refuses/migration instruction;
- managed controller mode protocol, primary drained, stage-only, never active/service/controller state;
- managed direct ordinary invocation fails;
- clean transaction build/stage, no source dependency cache;
- manifest schema/source/protocol/updater/runtime+health paths/digests/timestamp/finalized;
- Docker disabled.

Activator/controller validates stage and owns rename. Crash states journal-recoverable.

Recovery refs current/previous/bootstrap-source/transactions/generations; atomic; bootstrap previous absent; protect objects.

Offline recovery restores source, runs stable stage-only updater, controller activates, health/controller/primary. Emergency Git reconstruction allowed. Valid LKG runtime backup may start only explicit degraded critical action if stable updater fails; journal remains.

Candidates immutable/atomic symlink, validated before refs, active/previous compatible. Breaking migration separate.

### Milestone 7: Documentation and acceptance

Document portable validation, direct workflows, PR-only main rule, approvals, control-plane freshness, bootstrap, queue/busy, atomic admission, drain, cgroup, stage-only/controller activation, runtime digest/manifest, health limitation, latest-main, managed refusal, recovery refs/backups, critical recovery, upgrades, logs, Docker disabled, best effort.

Run tests/CI/review/real/disposable demonstrations; active until evidence.

## Concrete Steps

Baseline:

    git cat-file -e e9ec636e5abf383f8831fc126b99f04e2e005a3c^{commit}
    git merge-base --is-ancestor e9ec636e5abf383f8831fc126b99f04e2e005a3c HEAD
    git status --short
    git diff --name-status e9ec636e5abf383f8831fc126b99f04e2e005a3c...HEAD
    git grep -n 'DOCKER_PROVISIONING_ENABLED=0' e9ec636e5abf383f8831fc126b99f04e2e005a3c -- update.sh
    git diff --exit-code e9ec636e5abf383f8831fc126b99f04e2e005a3c -- .agent/PLANS.md .github/workflows examples/github-actions

Milestone 0 evidence: group public/selected four workflows/writable; environments/review/bypass; ruleset PR-only/no force/delete/bypass; queue bound; credential permissions.

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

Real migration/bootstrap evidence: labels/group/no Codex; pending normal reject; installed ownership/modes; no tokens; device/capacity; exact current bootstrap stage/activation/manifest/health/readiness/current ref/previous absent/markers last.

Production VM:

1. temporary success with primary stopped, restoration;
2. target updater failure preserves active then LKG restore;
3. drain timeout no mutation;
4. stale target/control plane no mutation;
5. main success LKG;
6. direct updater rejected managed;
7. workflow cancel root service completes/restores;
8. status active/terminal;
9. unexpected untracked blocks;
10. updater attempt to alter active runtime/checkout/service/controller state detected;
11. two concurrent submission helpers yield exactly one pending request;
12. emergency direct push to main is blocked by ruleset and does not trigger deployment.

Disposable:

1. bootstrap failure before/after activation restores prebootstrap;
2. failed main offline restore;
3. kill each controller rename state recovers;
4. host restart blocks primary/status available;
5. `.git` reconstruct;
6. candidate switchback before refs;
7. incompatible protocol before drain;
8. double failure critical;
9. cgroup descendant termination;
10. disk/device fail before drain;
11. updater modifies one non-entrypoint runtime file in place and full-tree digest detects it;
12. stale pending request recovery is deterministic.

## Validation and Acceptance

Feasibility: actual GitHub controls verified; missing blocks.

Routing: only four direct main workflows use group; other path/ref unschedulable; action SHA pins/min permissions/timeouts.

Main-trigger: ruleset enforces PR-only merges; push event SHA is merge result. Direct/bypass push is prevented, not silently treated as normal deployment.

Portable: exact target GitHub-hosted no deployment secret/self-hosted; failure prevents deploy; moved branch never substitutes.

Approval: temporary/bootstrap deploy cannot enter concurrency/runner before approval.

Control-plane freshness: old queued workflow commit cannot mutate after main advances. Main stale superseded; temporary/bootstrap stale fail.

Admission: parallel helpers create at most one root pending request; service claims exactly once; stale pending recovered safely.

Serialization: GitHub queue + busy + host flock no interleaving; order irrelevant; overflow observable.

Clean worktree: preexisting tracked/untracked blocks. Post-updater exact HEAD/no tracked/untracked debris required. Restoration removes only post-journal debris/journal paths; ignored state not silently purged.

Drain: listener stop/no new assignment/no mutation while worker/timeout no kill/prior restore.

Ownership: deployer no direct write; Git admin; stage builder; active/controller/recovery root; health primary user.

Protocol: unsupported before drain; updater stage-only/no credentials/no active/service/controller/journal mutation; prebootstrap helper works, managed direct fails.

Controller ownership: full active tree digest unchanged across updater; controller alone journals/renames. Violation fails/restores.

Staging: build fail active untouched; device/capacity before drain; rename interruption recovers; backup retained; dependency cache clean.

Cgroup: timeout TERM/KILL accidental descendants; restoration after unit inactive.

Temporary isolation: primary stopped through target and LKG restoration.

Bootstrap: no invented LKG; failure restores fallback; success current only, primary, markers last.

Main: current target/control plane, drain, exact checkout, host checks, stage-only updater, controller activation, manifest/health, candidate-before-refs, atomic refs/metadata, primary/final consistency; failure reverts all.

Runtime identity: checkout/manifest/full-tree and entrypoint digests/metadata/controller/current agree; invalid data fails.

Listener readiness: stable service/listener/runner identity/credential type-owner-mode; no GitHub scheduling claim.

Cancellation: workflow loss not root service; next waits; boot recovery before primary, status independent.

Recovery: offline source/Git/runtime/interrupted/controller/critical; no malicious-root/whole-VM guarantee.

Logging: bounded root raw with truncation; normalized workflow diagnostics, no full transcript/secret guarantee.

Outcomes:

- superseded main: success/no mutation;
- main success: success accepted;
- main fail + healthy restore: workflow fail, host prior LKG;
- temporary target success + restore: success;
- temporary target fail + restore: fail, host LKG;
- stale temporary/bootstrap: fail/no mutation;
- unproven restore: fail critical.

Completion: every Progress item evidence, tests/CI/review, production/disposable demonstrations.

## Idempotence and Recovery

Fresh install one-time. Setup/migration absent/exact/partial/conflict; attempt-owned compensation.

Migration restartable; runner may start pending, no accepted refs/managed markers; conflicts fail.

Submission admission serialized by request lock and exclusive pending file. Reused ID different/conflict rejected. Status read-only.

Root journal strict/bounded/atomic records request/control-plane/target/transaction ref/drain/checkout/updater unit/pre/post active-tree digest/stage result/controller backup/activation/health/candidate/refs/primary/restoration/terminal.

Target updater never writes journal by contract; controller derives observed state independently before phase transition.

Runtime same filesystem; old-active/stage-only/backup-without-active/new-active+backup distinguishable.

Refs atomic; metadata journaled; bootstrap current only; generation/transaction refs protect objects.

Recover never retries target; converges prebootstrap/LKG, restores source/runtime/controller, health, primary; archives after success.

Unknown keeps primary/mutation stopped, status when possible; admin repair required.

Direct unmanaged mutation prohibited; emergency explicit/recorded then accepted-main/rebootstrap.

Tests temporary roots/local Git/fake systemd/process/service/deterministic barriers, no real settings/production/network.

## Artifacts and Notes

Append-only:

- 2026-07-21 baseline review.
- 2026-07-21 GitHub mechanisms review.
- 2026-07-21 draft PR #47 plan only.
- 2026-07-21 living format conversion.
- 2026-07-21 first through sixth adversarial corrections as recorded in `Progress`.

Future evidence: GitHub settings; hashes; tests/counts/coverage; group/workflows/environments/ruleset; ownership/device/capacity; request admission; phases/cgroup/digests/controller/restoration/final; recovery refs/fsck; stage/backup; cancellation/boot; demonstrations; CI/final review.

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

Recovery unit required before primary; deploy runner independent for status.

Submit helpers no args/canonical JSON. Admin recovery unavailable to deployer sudo.

Request equivalent:

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

Updater finalizes declared stage and declared host state only; active runtime/services/controller state unchanged.

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

Bounded config: request, validation, approval, drain/fetch/host/updater/health/primary/transaction/busy deadlines; TERM/KILL; disk headroom; status interval; raw/diagnostic bytes; retention pending/results/transactions/backups/generations/controllers.

Use pinned existing host tools where possible. No third-party runtime dependency without recorded necessity.

Revision note (2026-07-21): Performed sixth adversarial review. Added atomic pending-request admission, deterministic full-tree active-runtime digest, enforced PR-only protected-main semantics for the push trigger, and required explicit workflow timeouts. The controller now verifies target updater did not modify active runtime in place before performing trusted activation. Plan only; implementation not complete.