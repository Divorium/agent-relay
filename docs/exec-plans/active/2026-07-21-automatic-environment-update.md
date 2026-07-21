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
- managed target `update.sh` executes as root only inside controller-created transient unit, prepares runtime stage and protocol-declared non-control-plane host changes, and never owns active-runtime activation or deployment control plane;
- installed controller alone owns runtime backup, activation, journal, accepted refs, service unmask/start and restoration;
- previous active runtime remains retained until terminal acceptance/restoration, including first bootstrap before LKG;
- primary remains unavailable throughout temporary target and LKG restoration; monitor catches accidental direct listener/worker launch;
- controller health-checks runtime as `github-runner` in private-network sandbox that bind-mounts only finalized runtime read-only and hides the rest of source checkout;
- failed main attempts offline convergence to previous local LKG;
- workflow cancellation does not kill post-mutation host transaction because root systemd service owns it;
- results distinguish target, restoration and critical recovery.

Selected revisions are trusted same-repository code and execute with broad host authority. System provides **best-effort rollback for accidental failures**, not malicious-code isolation or VM snapshot. Privileged target can defeat same-VM controls. Never describe runner groups, approvals, ownership, cgroups, masks, monitoring or second runner as malicious-root protection.

Acceptance does not claim primary already accepted a GitHub job. Starting primary during temporary transaction would permit queued work race. Without retained organization-management credential for dynamic runner control, transaction proves runtime locally and starts primary only after final selection.

Temporary deployment tests target updater/runtime behavior under currently installed deployment protocol and performs isolated controller-candidate self-test. It does **not** apply or validate fresh install, migration, GitHub workflows/settings, sudoers, runner installations/registrations, systemd control-plane unit changes, or breaking controller protocol. Those require deterministic system tests and disposable-VM acceptance.

`DOCKER_PROVISIONING_ENABLED=0` remains authoritative. Do not re-enable Docker or reopen PR #46.

## Progress

Keep append-only. Checked implementation items require repository location plus passing automated evidence, or reproducible command plus captured result. Blocked remain unchecked with `[blocked]`.

- [x] (2026-07-21) Reviewed installation, updater, runner, CI, Codex, documentation, package scripts on baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- [x] (2026-07-21) Confirmed primary cannot synchronously update itself because updater stops listener and waits all `github-runner` workers.
- [x] (2026-07-21) Reviewed GitHub runner, group, selected-workflow, dispatch, environment and queue mechanisms.
- [x] (2026-07-21) Selected second persistent deployment runner.
- [x] (2026-07-21) Converted notes to PR #3 living structure.
- [x] (2026-07-21) First through tenth adversarial reviews corrected drain, recovery claims, ownership, validation, queueing, bootstrap, transaction lifetime, staging, control-plane freshness, cgroup isolation, controller activation ownership, request admission, runtime masking, root authority, health sandbox, managed lock and retry/scope semantics.
- [x] (2026-07-21) Eleventh review added immutable deployment-control-plane digest and corrected health sandbox layout with a read-only bind mount of `dist` outside an inaccessible checkout.
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
- Existing updater lock too narrow; full managed transaction requires dedicated lock.
- Validation cannot depend on primary; portable hosted check.
- Full check host-specific; portable separate, full retained.
- Primary GitHub smoke races ordinary jobs; local sandboxed health while stopped.
- Current updater deletes active runtime early; staging/backup.
- Checkout SHA lacks runtime provenance; manifest/digests.
- Remote main not rollback state; local refs/objects.
- Restoration without GitHub.
- Workflow cancellation cannot own host safety.
- Direct selected workflows avoid reusable/custom-auth complexity.
- Approval before deploy concurrency.
- Cancellation releases GitHub queue early; host status authoritative.
- Bootstrap needs deploy runner and pre-LKG fallback.
- Direct managed update diverges accepted state.
- Controller upgrades backward compatible.
- Unknown recovery blocks primary/mutation, not status.
- Credential bytes rotate; verify metadata/identity.
- Queued workflow can stale; control-plane freshness.
- Target object protected before mutation.
- Same filesystem/capacity.
- Transient cgroup bounds accidental descendants.
- Unexpected untracked blocks.
- Clean dependency state.
- Controller owns journal/activation.
- Post-updater invariants.
- Migration before new updater.
- Atomic pending admission.
- Full runtime tree digest.
- Push merge semantics require PR-only ruleset.
- Runtime mask plus process monitor.
- Bootstrap-pending direct updater forbidden.
- Temporary candidate self-test only.
- Runtime/stage regular files/directories.
- Managed root updater; no interactive sudo.
- Enforce health network isolation.
- Dedicated managed lock and dual-lock cutover.
- Fresh dispatch/approval for temporary/bootstrap reruns.
- Temporary scope excludes installer/infrastructure.
- Target updater must not modify deployment control plane: runner installation/registration directories, primary/deploy systemd units, controller versions/symlink, submission/status/admin helpers, sudoers, managed lock, recovery repository, journal/state roots, or deployment-runner home/work configuration. Controller records a deterministic protected-control-plane digest before updater and requires it unchanged after updater.
- `dist` is inside source checkout, so `InaccessiblePaths` on checkout would also hide runtime. Health unit must bind-mount active `dist` read-only to a separate sandbox path, make original checkout inaccessible, and invoke health from the bind-mounted path.

## Decision Log

- Second persistent organization runner; ephemeral/JIT rejected.
- Restoration best effort.
- Four direct protected-main workflows; selected group only those paths/main/public repo/deploy label.
- Temporary/bootstrap approval before concurrency and attempt 1 only.
- Hosted exact validation, action full-SHA pins, minimum permissions/timeouts.
- Deployer no direct mutation; selected workflow/locked account boundary; no custom OIDC.
- Mode-specific no-arg submit helpers, canonical bounded JSON, read-only status.
- Exclusive pending request and root systemd transaction independent of workflow.
- Dedicated immutable managed lock; dual-lock migration cutover from legacy administrator-file lock.
- Stop/drain/mask/monitor primary; unexpected start aborts and re-drains.
- Git as recorded administrator.
- Control-plane/target freshness and PR-only no-bypass main.
- Backward-compatible deployment protocol.
- Managed updater root stage producer only; no control-plane mutation.
- Controller records two independent deterministic digests before updater: active-runtime tree and protected deployment-control-plane tree. Both must match afterward before activation.
- Protected control-plane tree includes runner installations and registration/configuration files, runner/systemd units, controller/helpers/sudoers, managed transaction lock and root deployment state/recovery metadata, excluding transaction-owned append-only log/result/journal fields expected to change.
- Changes to protected control plane require explicit migration or accepted controller mechanism, not target updater. Temporary never applies them.
- Existing host migrates before new updater; direct updater always refuses under new code.
- Updater root transient cgroup, no sudo, builder subprocess, process monitor.
- Health systemd sandbox uses `PrivateNetwork=yes`, `NoNewPrivileges=yes`, `PrivateTmp=yes`, temporary HOME, `InaccessiblePaths` for source checkout, and `BindReadOnlyPaths=<active-dist>:/run/agent-relay-runtime`; health executable runs from `/run/agent-relay-runtime` with fixed arguments and bounded output.
- Recovery refs authoritative, latest-main only, bootstrap/status pre-LKG, candidate main-only activation, status in critical recovery, Docker disabled.

Dates/authors: 2026-07-21 architecture/adversarial revisions under operator instructions. Update when decisions change.

## Outcomes & Retrospective

Plan remains active; no production behavior changed. Design resolves known circular dependencies and protects accidental control-plane drift. Same-VM privileged-target limitation remains explicit. Milestone 0 blocks if GitHub controls unavailable.

## Context and Orientation

Current checkout `/srv/github-runner/storage/agent-relay` administrator-owned; `dist` root-owned. Primary paths `work`, `runner`, `home`; builder `build`, `build-home`. Users `github-runner`, `agent-relay-builder`. `/etc/agent-relay/administrator` records admin and is legacy updater lock. Primary service `actions.runner.Divorium.gh-runner.service`.

Current installer one-time, PAT only for short-lived registration token, no persistence. Current updater admin-only, locks administrator file, stops primary, waits workers indefinitely, deletes/rebuilds active `dist`, starts primary, Docker disabled. Current workflows bare `[self-hosted]`; route to `agent-relay-main` before second runner starts.

Expected additions include isolated deploy runner paths, runtime stage/backups, `/var/lib/agent-relay-deploy/transaction.lock`, bootstrap/managed/request/journal/accepted/deployed/recovery/controller/log state, fixed submission/status/admin/activation helpers, controller symlink, deployer sudoers, transaction/recovery systemd units.

Terms: primary runner; deployment runner; control-plane SHA; portable validation; installed host compatibility; root controller; versioned protocol; protected control plane; LKG recovery current ref; prebootstrap fallback; sandboxed health; critical recovery.

## Plan of Work

### Milestone 0: Prove GitHub feasibility

Verify actual group/public repo/four main workflows/writable restrictions; minimum credential permissions; temporary/bootstrap reviewers and accepted bypass model; PR-only no-force/delete/bypass main ruleset; queue max/bound. Missing => `[blocked]`, no privileged runner.

### Milestone 1: Stable protocol and portable validation

Revalidate baseline. Add versioned protocol ranges for updater/controller/manifest/candidate and protected-control-plane schema. Reject unsupported before drain; old temporary branch rebase/merge; breaking change migration.

Add `npm run check:portable` for hosted typecheck/tests/runtime build/shell/Node/portable system tests without host paths/Codex/Docker/PAT/self-hosted. Retain full host check.

Define fixed health and stage protocol. Stage/active regular files/directories only. Define exact protected-control-plane inventory and canonical digest serialization; transaction-owned mutable files are explicitly excluded or represented by allowed transition schema rather than broad directory exclusion.

### Milestone 2: Human workflows

Four direct main-pinned full-SHA-action/min-permission/timeout workflows: main push+retry, temporary dispatch attempt1 exact PR/branch with hosted validation and protected approval, bootstrap dispatch attempt1 exact main with approval, status read-only. Shared deploy concurrency after approval. No reusable workflow/target checkout/raw output. Busy polling after canceled workflow. Route ordinary jobs to primary label.

### Milestone 3: Install/migrate/bootstrap pending

Create deployer/runner/group/label, controller/helpers/units/recovery/stage/state/sudo, memory-only tokens, managed lock, dual-lock cutover, new updater refusal, clean exact current main, bootstrap-source/fallback, active runtime shape, device/capacity, protected-control-plane baseline digest, bootstrap pending/status runner, bootstrap then markers. Failure restores fallback/no LKG.

### Milestone 4: Submission and independent service

No-arg canonical JSON helpers; request lock/O_EXCL pending/fsync; attempt1 temporary/bootstrap; service claims under managed lock; deterministic stale recovery; selected workflow boundary; root transaction fixed environment; boot recovery before primary, deploy status independent.

### Milestone 5: Host transaction

Preflight validates request/protocol/checkout/recovery/controller/lock, clean tree, exact fetch/object/ref, control-plane freshness, LKG/fallback, filesystem/capacity, installed compatibility, active-runtime digest and protected-control-plane digest.

Drain/mask/monitor primary. Stage exact target via root transient updater cgroup. After updater require cgroup inactive, primary masked/no processes, exact clean checkout, active-runtime digest unchanged, protected-control-plane digest unchanged except explicitly journal-owned allowed transitions, stage manifest valid/regular-only. Controller alone backup/activate/journal; sandboxed health through read-only bind mount.

Main: candidate compatibility/provisional switch before refs; atomic refs/metadata; safe unmask/start; failure guarded revert. Temporary: candidate isolated self-test, no protected-control-plane changes; LKG restore. Bootstrap: fallback, exact main, candidate before refs, current only, safe start, markers last.

### Milestone 6: Updater, activation, recovery, upgrade

New updater direct refusal; root managed stage-only mode with exact environment; no sudo; builder subprocess; no source dependency cache; finalized manifest; no protected-control-plane mutation; Docker disabled. Offline recovery refs/source/stage/activation/sandboxed health/start. Candidate migration rules. Administrator identity/control-plane changes offline explicit migration under managed lock.

### Milestone 7: Documentation and acceptance

Document hosted validation, direct workflows, PR-only main, approvals/fresh attempts, temporary scope, control-plane freshness/digest, bootstrap, lock cutover, admission, queue/busy, drain/mask/monitor/cgroup, root stage updater/controller activation, runtime digest/manifest, bind-mounted sandbox health, latest-main, direct refusal, recovery/critical/upgrades/logs/Docker/best effort. Run all evidence.

## Concrete Steps

Baseline checks remain: pinned commit/ancestry/status/diff, Docker flag, protected workflow/instruction diff. Portable: `npm ci`, `npm run check:portable`. Focused tests cover protocol/controller/state/resolver/runtime manifest/install/migration/transaction/recovery. Complete validation retains typecheck/tests/runtime/shell/node/toolchain/system/check/diff/Docker grep.

Production demonstrations additionally prove protected-control-plane digest catches updater changes to runner files, unit files, helpers, sudoers, lock or recovery state; sandbox health can read bind-mounted runtime but cannot see source checkout or network. Disposable tests cover all crash/restore/candidate/protocol/cgroup/disk/runtime-shape/pending/lock and infrastructure-scope scenarios.

## Validation and Acceptance

Required acceptance categories:

- actual GitHub feasibility/routing/PR-only main/action pins/permissions/timeouts;
- hosted exact portable validation, approval-before-concurrency, fresh attempt, control-plane freshness;
- atomic admission, dual-lock migration cutover, managed serialization;
- clean checkout and no unexpected untracked state;
- drain/mask/process monitor;
- ownership/root managed updater/stage-only protocol;
- active-runtime and protected-control-plane digest invariants;
- regular-only runtime shape, staged activation, cgroup termination;
- bind-mounted private-network health sandbox;
- temporary isolation and explicit limited scope;
- bootstrap fallback/current-only;
- main atomic acceptance/revert;
- listener readiness without scheduling claim;
- cancellation/boot/offline recovery/critical state;
- bounded logging.

Outcomes: superseded main succeeds without mutation; main success accepted; failed main with healthy restore fails workflow/host prior LKG; temporary success+restore succeeds only for documented runtime/updater scope; temporary fail+restore fails/host LKG; stale/rerun temporary/bootstrap fail without mutation; unproven restoration is critical.

Completion requires all Progress evidence, tests/CI/review, production/disposable demonstrations.

## Idempotence and Recovery

Fresh install one-time; setup/migration classify absent/exact/partial/conflict. Dual-lock migration prevents legacy overlap. Managed lock fixed. Submission O_EXCL. Strict atomic journal records request, refs, primary mask/monitor/drain, checkout, updater authority/unit, runtime and protected-control-plane digests, stage/activation, health, candidate, refs/start/restoration/terminal. Target updater never writes journal. Runtime states distinguishable. Refs atomic. Recover never retries target and keeps primary unavailable while mutating. Unknown blocks mutation/primary, status possible. Direct unmanaged mutation prohibited. Tests use temporary roots/fakes/no production network.

## Artifacts and Notes

Append-only: baseline/GitHub review, draft PR #47/living format, first through eleventh adversarial corrections. Future evidence includes settings, tests, workflows/ruleset, lock/cutover, ownership/device/capacity, admission, runtime/control-plane digests, sandbox, phases/cgroup/restoration, refs/fsck, cancellation/boot, demonstrations, CI/final review.

GitHub documentation reviewed: self-hosted runners, access management, runner groups REST, manual workflows, environments, concurrency, runner selection, monitoring/troubleshooting.

Non-goals: hostile isolation; guaranteed malicious-root/VM/disk/network/systemd/resource recovery; autoscaling/ephemeral/JIT; persistent PAT/App; forks/arbitrary repos; parallel mutation; pre-promotion GitHub job proof; VM snapshots; general data/package reversal; Docker re-enable; pre-protocol branches; automatic breaking migration; temporary activation or acceptance of infrastructure/control-plane changes.

## Interfaces and Dependencies

No public Agent Relay job/Codex request-result/prompt/finalizer/workspace changes.

Identities: recorded administrator; primary `github-runner`/`gh-runner`/`agent-relay-main`; builder; deployer/`gh-deploy-runner`/`agent-relay-deploy`; group.

Services: primary/deployment runner, transaction/recovery, updater transient, health transient.

Request includes schema, request/run/attempt/actor/controlPlaneSha/source type/value/ref/targetSha/protocol. Mode from helper; no credential; temporary/bootstrap attempt1.

Managed updater environment includes mode, transaction ID, controller-created build/stage paths, expected SHA. Updater root only in transient unit, no sudo, stage/declared non-control-plane host state only.

Runtime manifest includes schema/source/protocol/updater/runtime+health paths/digests/timestamp/finalized.

Protected-control-plane digest schema must define exact canonical inventory and allowed mutable transaction records. It includes runner directories/identity configuration, relevant systemd units, controller/helper binaries and symlink target, sudoers, managed lock metadata, recovery refs/config and root state schemas. Secrets are hashed locally and never logged/exported.

Journal includes request/mode/control plane/source/target/transaction refs/previous state/controller/primary/mask/updater+health units/runtime and control-plane digests/stage/backup/phase/results/final/log/timestamps. Exact serialization bounded/strict/credential-free/restart-sufficient.

Bounded config covers request/validation/approval/drain/fetch/host/updater/health/primary/transaction/busy deadlines, monitor, TERM/KILL, disk, status, logs, retention.

Use pinned existing tools where possible. No third-party runtime dependency without recorded necessity.

Revision note (2026-07-21): Eleventh adversarial review added a canonical protected-deployment-control-plane digest to prevent accidental updater changes to runner installations, registrations, units, helpers, sudoers, lock and recovery state; clarified those changes require migration rather than temporary deployment; and corrected the health sandbox by bind-mounting only finalized `dist` read-only outside an inaccessible source checkout. Plan only; implementation not complete.