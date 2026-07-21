# Automate Agent Relay environment deployment and rollback

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current while work proceeds. Maintain this document according to `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

The reviewed baseline is `main` commit `e9ec636e5abf383f8831fc126b99f04e2e005a3c`. Before implementation starts, verify that this commit exists and is an ancestor of `HEAD`. If `main` advances, recheck every current-state statement, path, workflow, runner contract, GitHub-setting assumption, package script, and referenced Docker decision. Update the baseline and record the review in `Progress`; do not silently implement against another revision.

Codex may use read-only Git commands such as `status`, `diff`, `show`, `grep`, `rev-parse`, `show-ref`, `cat-file`, and `merge-base`. Codex must not run `git add`, `commit`, `merge`, `rebase`, `reset`, `restore`, `checkout`, `cherry-pick`, or `push`; the GitHub runner owns commit and push. Workflow files and GitHub settings are human-maintained. Codex must not edit `.github/workflows/` or `examples/github-actions/`.

## Purpose / Big Picture

Replace the current release procedure:

    cd /srv/github-runner/storage/agent-relay
    git pull --ff-only
    ./update.sh

with an observable deployment system for the single long-lived Agent Relay VM.

After this work:

- a push to protected `main`, or a manual retry of current protected `main`, validates the exact commit on GitHub-hosted infrastructure and deploys it only if both target and workflow-control commits are still current when the host transaction begins;
- an authorized operator can manually select an open same-repository pull request, including a draft PR, or a same-repository branch, resolve it once to an exact commit, validate it outside both self-hosted runners, and test that revision's real privileged `update.sh` on the real host;
- a second persistent deployment runner remains independent of primary Agent Relay runtime and can submit or inspect transactions while primary is stopped or broken;
- the controller stops primary listener and drains every active `github-runner` worker before changing trusted checkout;
- target `update.sh` prepares and validates a transaction-scoped runtime stage, but trusted installed controller alone owns active-runtime backup, rename activation, journal transitions, accepted refs, service startup and restoration;
- previous active runtime is retained until acceptance or restoration completes, including first bootstrap before an LKG exists;
- controller-mode update leaves primary stopped and controller verifies it stayed stopped, so temporary code is never exposed to ordinary queued CI or Codex jobs;
- controller runs fixed network-free runtime health as `github-runner` in sanitized temporary home, validates exact build manifest, and starts primary only after final accepted/restored state is selected;
- failed `main` attempts to converge to previous locally retained LKG without GitHub network;
- workflow cancellation does not terminate host transaction after mutation because root systemd service owns transaction;
- deployment/restoration outcomes are separate and critical-recovery evidence is preserved when convergence cannot be proven.

Selected revisions are trusted same-repository code and execute with broad host authority to test the real privileged updater. This system provides **best-effort rollback for accidental failures**. It is not malicious-code isolation or VM snapshot. Privileged target can damage controller, deployment runner, recovery repository, credentials, OS, Docker data, or VM. Root ownership, runner groups, approvals, sanitized environment, cgroups, and second same-VM runner must never be described as protection from malicious privileged target.

Acceptance deliberately does not claim primary registration already accepted a GitHub job. Starting primary during temporary transaction lets unrelated queued job race onto temporary runtime. Without retained organization-management credential for dynamic runner control, transaction proves runtime locally and starts primary only after final state selection. Documentation must preserve limitation.

`DOCKER_PROVISIONING_ENABLED=0` remains authoritative. This plan must not re-enable Docker provisioning or reopen PR #46 design.

## Progress

Keep append-only. Split partially completed work into checked historical and unchecked remaining entries. Checked implementation item cites repository location plus passing automated evidence, or reproducible command plus captured result. Blocked items remain unchecked with `[blocked]`.

- [x] (2026-07-21) Reviewed installation, updater, runner, CI, Codex, documentation, and package-script contracts on baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- [x] (2026-07-21) Confirmed primary cannot synchronously update itself because updater stops listener and waits for every `Runner.Worker` owned by `github-runner`.
- [x] (2026-07-21) Reviewed GitHub persistent/ephemeral/JIT runners, registration tokens, labels, groups, selected workflows, dispatch, environments, concurrency queue, and self-hosted queue behavior.
- [x] (2026-07-21) Selected second persistent deployment runner for one long-lived VM.
- [x] (2026-07-21) Converted notes to PR #3 living ExecPlan structure.
- [x] (2026-07-21) First adversarial review corrected checkout-before-drain, overstated recovery, ownership/authorization, exact-SHA, queue, LKG, journal, controller upgrade, Docker scope.
- [x] (2026-07-21) Second adversarial review corrected primary-dependent validation/smoke, workflow lifetime, bootstrap circularity, unmanaged updates, reusable caller ambiguity, protocol incompatibility.
- [x] (2026-07-21) Third adversarial review removed unnecessary OIDC/reusable machinery, added direct selected workflows, diagnostics availability, staged runtime/prebootstrap fallback, controller-before-refs, approval before concurrency.
- [x] (2026-07-21) Fourth adversarial review added control-plane freshness, transaction refs, worktree policy, filesystem/capacity checks, transient updater cgroup, service invariants, clean build-state requirements.
- [x] (2026-07-21) Fifth adversarial review made installed controller sole owner of runtime activation/journal, made target updater stage-only in managed mode, added post-updater worktree verification, and defined migration-before-new-updater transition.
- [ ] Complete Milestone 0 with actual GitHub-side evidence before implementation code.
- [ ] Revalidate baseline and human workflows before implementation.
- [ ] Implement protocol, portable validation, stage-only updater mode, installed activation path, manifest/health, managed/manual boundary.
- [ ] Implement fresh install/migration for deployment account, second runner, restricted group, controller services, recovery/state/stage roots, bootstrap pending.
- [ ] Implement trusted submission, root transaction, drain, exact checkout, updater cgroup, controller activation, local health, acceptance, restoration, cancellation/boot recovery.
- [ ] Human reviewer: add direct main/temporary/bootstrap/status workflows; route ordinary jobs only to `agent-relay-main`; configure group, environments, branch protection, concurrency.
- [ ] Add deterministic unit/contract/integration/system coverage.
- [ ] Run focused/full validation, exact-head CI, independent point-by-point review.
- [ ] Perform real-host migration and temporary/main tests; disposable-VM failed-main/cancellation/restart/bootstrap/controller tests.
- [ ] Complete retrospective/evidence and move same plan to `completed` only after every item checked.

## Surprises & Discoveries

- Observation: checkout mutation before drain can change scripts used by active Codex job.
  Evidence: current workflows execute resolver, launcher, finalizer directly from trusted checkout.

- Observation: another runner under same `github-runner` UID retains self-wait deadlock.
  Evidence: wait condition is UID plus process name.

- Observation: root-owned controller is not boundary against root-equivalent target.
  Evidence: privileged target can modify same-VM controls.

- Observation: current updater lock is too narrow.
  Evidence: it starts inside updater after future Git and ends before acceptance/restoration.

- Observation: exact validation cannot depend on primary.
  Evidence: repair must work when primary unavailable.

- Observation: complete `npm run check` is not portable.
  Evidence: toolchain check requires dedicated Java/Go/Rust/Codex paths.

- Observation: primary GitHub smoke creates scheduling race.
  Evidence: any queued ordinary job can take primary once listener starts.

- Observation: current updater destroys active `dist` before replacement complete.
  Evidence: bootstrap has no LKG and needs prior working runtime retained.

- Observation: checkout SHA does not prove runtime provenance.
  Evidence: baseline runtime has no source manifest.

- Observation: `origin/main` after failed merge is not rollback state.
  Evidence: remote already points to failed commit.

- Observation: text SHA does not retain object.
  Evidence: local recovery repo refs required.

- Observation: restoration cannot require GitHub.
  Evidence: network may be incident component.

- Observation: workflow cancellation cannot own host safety.
  Evidence: invoking shell may die after mutation.

- Observation: direct selected workflows are simpler/stronger here than reusable workflow plus custom OIDC.
  Evidence: runner group can list exact main-pinned workflows and admits only directly defined jobs.

- Observation: approval must not occupy deployment queue.
  Evidence: unresolved temporary approval could block automatic main.

- Observation: cancellation releases GitHub concurrency before root transaction finishes.
  Evidence: next job must observe host busy and wait.

- Observation: bootstrap needs deployment runner before LKG.
  Evidence: runner starts bootstrap-pending; only bootstrap/status accepted.

- Observation: bootstrap failure needs fallback before LKG.
  Evidence: preserve checkout object and active runtime.

- Observation: direct managed `git pull && ./update.sh` diverges accepted state.
  Evidence: recovery could later overwrite unrecorded runtime.

- Observation: controller upgrade cannot break active protocol.
  Evidence: active controller must understand target updater/manifest/journal.

- Observation: unknown recovery state should block primary mutation, not diagnostics.
  Evidence: second runner exists to report primary failures.

- Observation: credential bytes may rotate while runner identity remains.
  Evidence: verify file type/owner/mode and stable identity fields, not hashes.

- Observation: queued workflow control code can become stale.
  Evidence: require `controlPlaneSha == current origin/main` before mutation.

- Observation: target object belongs in recovery storage before mutation.
  Evidence: transaction ref protects exact target if production `.git` is damaged.

- Observation: staging must be same filesystem and capacity-checked.
  Evidence: rename atomicity is filesystem-local.

- Observation: transient systemd cgroup is stronger accidental descendant control than shell process group.
  Evidence: restoration waits for unit/cgroup inactive.

- Observation: untracked cleanup was undecided.
  Evidence: reject unexpected preexisting nonignored untracked files; only clean post-journal target debris during restoration.

- Observation: source `node_modules` can be stale persistent ignored state.
  Evidence: managed stage must not consume unverified source dependency cache.

- Observation: allowing target updater to rename active runtime contradicts controller-owned recovery.
  Evidence: target code could fail between rename phases without trustworthy journal. Managed updater must prepare stage only; installed controller performs activation and records every boundary.

- Observation: target updater may mutate source checkout while running.
  Evidence: post-updater acceptance must verify exact HEAD, no tracked modifications, and no unexpected nonignored untracked files before activation.

- Observation: implementation transition has chicken-and-egg risk.
  Evidence: existing host must run migration to install controller/activator before using new updater. New updater refuses destructive fallback when helper/protocol is absent.

## Decision Log

- Decision: second persistent organization runner on same VM.
  Rationale: durable recovery channel independent of primary process; ephemeral adds credentials/lifecycle without VM isolation.
  Date/Author: 2026-07-21 / design review.

- Decision: restoration best effort for accidental failure.
  Rationale: privileged target can defeat same-VM controls.
  Date/Author: 2026-07-21 / adversarial review.

- Decision: four direct main-pinned workflows: `deploy-main.yml`, `deploy-temporary.yml`, `deploy-bootstrap.yml`, `deploy-status.yml`.
  Rationale: selected-workflow group removes reusable caller ambiguity/custom auth.
  Date/Author: 2026-07-21 / simplification review.

- Decision: group allows only those four paths at `refs/heads/main`, selected public repo, label `agent-relay-deploy`.
  Rationale: only directly defined reviewed jobs reach deploy runner.
  Date/Author: 2026-07-21 / access-control design.

- Decision: temporary/bootstrap use protected-environment approval completed before deploy job concurrency.
  Rationale: write access alone should not authorize privileged branch execution; unresolved approval must not block main queue.
  Date/Author: 2026-07-21 / authorization design.

- Decision: exact target validation on `ubuntu-latest`.
  Rationale: works with broken primary and isolates target validation from privileged deploy account.
  Date/Author: 2026-07-21 / validation design.

- Decision: deployment actions pinned full SHA, minimum permissions.
  Rationale: workflow is trust boundary.
  Date/Author: 2026-07-21 / workflow hardening.

- Decision: deploy runner user has no direct checkout/root-state write.
  Rationale: only reviewed shell and fixed helpers; root service mutates.
  Date/Author: 2026-07-21 / ownership design.

- Decision: mode-specific no-argument submission helpers plus read-only status.
  Rationale: mode derives from installed helper, request is bounded canonical JSON stdin.
  Date/Author: 2026-07-21 / request boundary.

- Decision: selected workflow/deploy account is control-plane authentication boundary; no custom OIDC.
  Rationale: no target code runs there; custom JWT verifier adds failure surface without protecting against privileged target.
  Date/Author: 2026-07-21 / complexity correction.

- Decision: root systemd service owns transaction independent of workflow lifetime.
  Rationale: cancellation/runner death cannot interrupt post-mutation safety.
  Date/Author: 2026-07-21 / cancellation design.

- Decision: host flock authoritative; GitHub concurrency advisory.
  Rationale: cancellation can release queue while root transaction active.
  Date/Author: 2026-07-21 / serialization design.

- Decision: use existing root-owned `/etc/agent-relay/administrator` inode as common flock for manual prebootstrap update, controller transaction, and recovery.
  Rationale: current updater already uses it; choosing one exact inode avoids incompatible-lock ambiguity. Controller-mode updater does not reacquire.
  Date/Author: 2026-07-21 / lock correction.

- Decision: stop primary/drain all primary workers before checkout.
  Rationale: active jobs use checkout files.
  Date/Author: 2026-07-21 / safety correction.

- Decision: bounded non-destructive drain.
  Rationale: timeout kills no job, mutates nothing, restores prior listener.
  Date/Author: 2026-07-21 / operational policy.

- Decision: Git mutation as recorded administrator through root controller.
  Rationale: checkout remains administrator-owned.
  Date/Author: 2026-07-21 / ownership correction.

- Decision: `controlPlaneSha` must equal current protected `origin/main` for every mutating mode.
  Rationale: stale workflow code must not remain authoritative. Main/bootstrap target also equals current main; temporary target remains pinned separately.
  Date/Author: 2026-07-21 / stale-control-plane correction.

- Decision: backward-compatible deployment protocol before managed mode.
  Rationale: pre-protocol/breaking updater unsafe; old branches rebase/merge baseline.
  Date/Author: 2026-07-21 / compatibility design.

- Decision: managed target `update.sh` is stage producer, not active-runtime activator.
  Rationale: controller alone owns journal and recovery-critical rename. Updater receives controller-created stage/build paths, performs target host changes/build, finalizes stage/manifest, leaves active runtime and services untouched.
  Date/Author: 2026-07-21 / ownership correction.

- Decision: installed controller owns runtime activation.
  Rationale: it verifies stage and post-updater clean checkout, journals backup/activation renames, restores on interruption, and retains backup through terminal state.
  Date/Author: 2026-07-21 / activation correction.

- Decision: prebootstrap manual update uses installed activation helper; existing host must migrate before using new updater.
  Rationale: one activation implementation avoids destructive legacy fallback. New updater refuses if required installed helper is missing and directs operator to migration.
  Date/Author: 2026-07-21 / transition correction.

- Decision: execute target updater in transient systemd cgroup.
  Rationale: accidental descendants are bounded; restoration starts only after unit inactive. Not malicious-root containment.
  Date/Author: 2026-07-21 / process-control correction.

- Decision: local health as `github-runner`, not GitHub smoke.
  Rationale: verifies runtime without opening temporary scheduling; uses `env -i`, temp HOME, no Codex/network/model.
  Date/Author: 2026-07-21 / smoke isolation.

- Decision: recovery refs authoritative, metadata descriptive.
  Rationale: atomic refs retain accepted objects; metadata journal-recoverable.
  Date/Author: 2026-07-21 / recovery design.

- Decision: automatic main latest-only.
  Rationale: stale target/control-plane is superseded without mutation.
  Date/Author: 2026-07-21 / ordering policy.

- Decision: before bootstrap only bootstrap/status accepted.
  Rationale: runner needed for bootstrap; normal mutation disabled before LKG.
  Date/Author: 2026-07-21 / bootstrap design.

- Decision: after managed mode direct ordinary updater fails closed.
  Rationale: unmanaged mutation diverges accepted state. Recovery/rebootstrap explicit.
  Date/Author: 2026-07-21 / consistency design.

- Decision: controller candidate validated/provisionally switched before accepted refs.
  Rationale: failure leaves old refs/controller. Temporary never activates candidate.
  Date/Author: 2026-07-21 / controller upgrade.

- Decision: deployment runner remains available for read-only status in critical recovery when usable.
  Rationale: preserve diagnostic channel while primary/mutation blocked.
  Date/Author: 2026-07-21 / recovery channel.

- Decision: Docker provisioning remains disabled.
  Rationale: separate design is not reopened.
  Date/Author: 2026-07-21 / scope.

## Outcomes & Retrospective

Plan remains active. Plan-only commits changed no production behavior.

Current design resolves main circular dependencies: validation independent of primary, temporary health without primary, bootstrap fallback before LKG, transaction independent of workflow, controller-owned activation, and retained prior runtime. Remaining same-VM limitation is explicit.

Implementation is larger than simple wrapper because runner updates itself, active jobs share checkout, runtime has no source identity, and first managed deployment lacks LKG. Milestone 0 blocks if GitHub controls unavailable.

Update after milestones. On completion record real/disposable results and move same plan to completed.

## Context and Orientation

Current:

- `/srv/github-runner/storage/agent-relay`: admin-owned checkout, root-owned `dist`;
- `work`, `runner`, `home`, `build`, `build-home` under storage;
- `github-runner` primary/Codex no sudo;
- `agent-relay-builder` compiler no sudo;
- `/etc/agent-relay/administrator` recorded admin and current lock inode;
- primary service `actions.runner.Divorium.gh-runner.service`.

`install.sh` one-time installs pinned tools/accounts/runner, uses interactive organization credential only to obtain short-lived registration token, records admin, logs Codex in.

Current `update.sh`: admin-only, locks admin file, acquires sudo, stops primary, waits workers indefinitely, deletes/rebuilds active `dist`, starts primary; Docker disabled.

Current CI/Codex bare `[self-hosted]`; must route ordinary jobs to `agent-relay-main` before second runner starts.

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
      active-transaction.json
      accepted-state.json
      deployed-state.json
      recovery.git/
      controller-versions/
      requests/
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
- runtime health: fixed network-free command as `github-runner` temp env while primary stopped;
- critical recovery: mutation occurred, convergence unproven.

## Plan of Work

### Milestone 0: Prove GitHub feasibility

Verify actual organization/repository:

- manageable group, public repo access, exactly four main-pinned workflows;
- restrictions writable;
- installation credential minimum runner permissions;
- protected environments/reviewers for temporary/bootstrap and accepted self-review/bypass model;
- protected main prevents unauthorized workflow change/force-push/delete;
- `queue: max` and 100-pending bound acceptable.

Missing control => `[blocked]`; do not register/start privileged runner.

### Milestone 1: Stable protocol and portable validation

Revalidate baseline/contracts.

Add `.agent-relay/deployment-protocol.json` equivalent:

    schemaVersion: 1
    updaterControllerProtocol: 1
    runtimeManifestSchema: 1
    controllerCandidateSchema: 1
    minimumControllerProtocol: 1
    maximumControllerProtocol: 1

Controller rejects unsupported target before drain. Old temporary branch must merge/rebase protocol. Breaking change separate migration.

Add `npm run check:portable`: typecheck, tests, runtime build, shell/Node syntax, portable system tests on ubuntu-latest without dedicated paths/Codex login/Docker/PAT/self-hosted. Keep complete host check.

Define compiled fixed runtime-health entrypoint: no arbitrary command/network/model/source/persistent write; validate manifest/modules; bounded diagnostics.

Define stage protocol. Controller creates exact root, device/owner/mode, then grants builder-controlled stage subdirectory. Managed updater receives stage/build roots through fixed environment, writes only stage/build and declared target host locations, creates finalized manifest, and must not rename active `dist`, write controller journal/refs/state, or start/stop either runner. Controller detects violations best effort and fails.

### Milestone 2: Human workflows

Four direct full-SHA-action-pinned, minimum-permission workflows:

- `deploy-main.yml`: push main + manual retry current main; target/controlPlane = github.sha; GitHub-hosted portable validation; direct deploy job group+label; shared job concurrency `queue:max`; main helper/status.
- `deploy-temporary.yml`: dispatch main only; controlPlane github.sha; resolve exact same-repo PR/branch (draft allowed); reject fork/tag/merge/url/malformed/protocol; portable validation; protected GitHub-hosted approval; then direct deploy job shared concurrency; temporary helper/status.
- `deploy-bootstrap.yml`: dispatch main only; exact current main/controlPlane; portable validation; protected approval; direct deploy job shared concurrency; bootstrap helper.
- `deploy-status.yml`: dispatch main only; direct read-only status job, no target/concurrency/mutation.

Group allows exactly four paths at main. No reusable workflow. Deploy jobs do not checkout target/run target/expose persistent org credential/print raw output.

Canceled prior job: next sees busy, polls status until idle/bounded expiry, then submits; never replaces host transaction.

Route all ordinary self-hosted jobs/examples to `agent-relay-main` before deploy runner starts.

### Milestone 3: Install/migrate/bootstrap pending

Fresh install + restartable migration:

- deployment account/isolated runner paths/no Codex;
- selected group + runner registration separate short-lived token; primary label without identity replacement;
- install immutable controllers, submission/status/admin/activation helpers, transaction/recovery units, recovery repo, stage/backup/state/log roots, narrow sudo;
- deployer sudo only three submit + status, no shell/Git/systemctl/updater/controller/admin/activator;
- PAT/tokens memory-only;
- migration must run before new updater is used on existing host; new updater without installed protocol helper refuses and directs migration, never destructive fallback;
- initialize recovery no invented LKG;
- require clean admin-owned exact current main; reject tracked/unexpected nonignored untracked;
- import `bootstrap-source`, record primary state/runtime path without provenance claim;
- validate same device/free space;
- write bootstrap pending, start restricted deploy runner, disable main/temp;
- bootstrap workflow; markers only after success.

Failed bootstrap restores bootstrap-source, prior runtime/service, remains pending, no LKG.

### Milestone 4: Submission and independent service

Mode helper no args, reads bounded canonical JSON generated safely. It derives mode, validates schema/limits/repository/SHA/source/run/audit/controlPlane, rejects unknown fields/control chars, mode-state conflicts, and stores root request once. No credential stored. Selected workflow + locked deploy account is auth boundary; compromise equals control-plane compromise.

Root transaction owns lock/journal/Git/updater cgroup/stage activation/acceptance/restoration/result. Workflow loss does not kill it. Status bounded/read-only.

Boot recovery `Before=` and required by primary, independent from deployment runner. Known journal converges before primary. Unknown keeps primary/mutation stopped while status remains when deploy service valid.

Transaction systemd environment fixed from root request and does not inherit workflow token/environment.

### Milestone 5: Host transaction

Use flock on exact `/etc/agent-relay/administrator` inode across preflight Git, drain, update, activation, acceptance/restoration. Manual prebootstrap updater uses same; controller-mode updater no lock.

Preflight before stop:

1. validate request/mode/protocol/checkout owner/remote/config/no submodule/worktree/recovery/refs/controller/journal;
2. require tracked clean and no unexpected preexisting nonignored untracked;
3. fetch expected source ref transaction namespace as admin, hooks disabled;
4. verify object=target/protocol;
5. import target to recovery transaction ref before mutation;
6. fetch origin/main; require controlPlane=current for all; main/bootstrap target=current; stale main superseded success, stale temporary/bootstrap fail;
7. verify LKG/bootstrap fallback;
8. same-device/free-space/path owner/mode/no symlink;
9. installed host compatibility only, no target script as root/admin.

Drain:

- journal preparing/prior primary;
- stop primary;
- bounded worker wait;
- timeout restores prior listener, no mutation;
- durable drained before checkout.

Target staging:

1. reset/clean tracked checkout exact target as admin; verify owner/HEAD;
2. controller creates transaction build/stage roots and records pre-run active-runtime digest/path;
3. execute exact admin-owned regular non-symlink target updater in managed stage-only mode inside unique transient systemd service/cgroup, fixed environment/timeout, no workflow credentials;
4. updater may build stage and perform protocol-declared target host changes but may not activate dist, write controller state/refs/journal, or control runner services;
5. wait cgroup inactive with TERM/KILL escalation;
6. fail if active dist digest/path changed, primary/deploy service state changed, controller state changed, checkout HEAD/tracked files changed, or unexpected nonignored untracked debris remains;
7. verify finalized stage manifest/digests/owner/modes and clean dependency/build provenance;
8. controller journals `runtime_staged`, renames current dist to backup, journals, renames stage to active, journals; controller alone performs these boundaries and recovery;
9. verify active manifest and run health as github-runner under env-i/temp HOME/no credentials/network/model;
10. retain backup until terminal.

Main acceptance:

1. stage/self-test candidate if changed; reject breaking protocol;
2. provisional candidate switch + post-switch self-test before refs; switch back failure;
3. verify transaction target object;
4. atomic previous/current/generation refs;
5. journaled accepted/deployed metadata;
6. start primary; stable service/listener, expected runner name/ID/labels, registration files type/owner/mode;
7. readiness failure stops primary, reverts refs/metadata/controller, restores checkout/runtime, health, restarts prior;
8. final consistency required; retain bounded backups/generations, clean only journal-owned paths.

Temporary:

- record target health, no refs/candidate;
- primary remains stopped;
- restore current LKG checkout;
- stable LKG updater stage-only cgroup, controller activates, verifies manifest/health/controller;
- start primary after LKG complete;
- target/restoration separate; target fail + restoration healthy => workflow fail/host healthy;
- unproven => critical.

Bootstrap:

- no LKG; bootstrap-source/runtime fallback;
- exact current main stage-only + controller activation/health;
- candidate before refs;
- create current+generation, previous absent;
- start/readiness;
- markers last;
- any failure prebootstrap restore.

### Milestone 6: Updater, activation, recovery, upgrade

Refactor updater shared build logic:

- prebootstrap manual mode requires installed activation helper; admin locks same inode, updater prepares stage, helper verifies/activates/starts primary. Missing helper refuses with migration instruction;
- managed controller mode requires protocol, primary already drained, prepares stage only, never active dist/service/controller state;
- managed direct ordinary invocation fails;
- clean transaction build/stage, no unverified source node_modules;
- manifest schema/source/protocol/updater/runtime+health paths/digests/timestamp/finalized;
- Docker disabled.

Installed activator/controller validates stage and owns rename. Runtime crash states are journaled/recoverable.

Recovery refs current/previous/bootstrap-source/transactions/generations; atomic updates; bootstrap previous absent; refs protect objects.

Ordinary recovery offline: restore source, run stable stage-only updater, controller activates, health, controller, primary. Emergency Git reconstruction allowed. Retained valid LKG runtime backup may be started only explicit degraded critical action if updater restoration fails; journal remains.

Candidates immutable directories/atomic symlink; candidate before refs; active/previous compatible. Breaking migration separate.

### Milestone 7: Documentation and acceptance

Document portable validation, direct workflows, approval, control-plane freshness, bootstrap, queue/busy, drain, cgroup, stage-only updater/controller activation, manifest/health limitation, latest-main, managed direct refusal, recovery refs/backups, critical recovery, upgrades, logs, Docker disabled, best effort.

Run tests/CI/review/real/disposable demonstrations; keep active until evidence.

## Concrete Steps

Baseline:

    git cat-file -e e9ec636e5abf383f8831fc126b99f04e2e005a3c^{commit}
    git merge-base --is-ancestor e9ec636e5abf383f8831fc126b99f04e2e005a3c HEAD
    git status --short
    git diff --name-status e9ec636e5abf383f8831fc126b99f04e2e005a3c...HEAD
    git grep -n 'DOCKER_PROVISIONING_ENABLED=0' e9ec636e5abf383f8831fc126b99f04e2e005a3c -- update.sh
    git diff --exit-code e9ec636e5abf383f8831fc126b99f04e2e005a3c -- .agent/PLANS.md .github/workflows examples/github-actions

Milestone 0 evidence: group public/selected four workflows/writable restrictions; environments/review/self-review/bypass; protected main; queue max/bound; minimum credential permissions.

Portable:

    npm ci
    npm run check:portable

No self-hosted/Codex login/Docker/PAT/deployment secret/dedicated paths.

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

Real migration/bootstrap: labels/group/no Codex; pending normal reject; installed ownership/modes; no tokens; same device/capacity; exact current bootstrap stage/activation/manifest/health/readiness/current ref/previous absent/markers last.

Production VM:

1. temporary success, primary stopped, restoration;
2. target updater failure preserves active then LKG restores;
3. drain timeout no mutation;
4. stale target/control plane no mutation;
5. main success LKG;
6. direct updater rejected managed;
7. workflow cancel root service completes/restores;
8. status active/terminal;
9. unexpected untracked blocks;
10. target updater attempts active-dist rename, checkout mutation or service control => detected failure/restoration.

Disposable:

1. bootstrap failure before/after controller runtime activation restores prebootstrap;
2. failed main offline restore;
3. kill each controller rename state recovers;
4. host restart blocks primary/status available;
5. `.git` reconstruct;
6. candidate switchback before refs;
7. incompatible protocol before drain;
8. double failure critical;
9. cgroup descendant termination;
10. disk/device fail before drain.

## Validation and Acceptance

Feasibility: actual GitHub controls verified; missing blocks.

Routing: only four direct main workflows use group; other path/ref unschedulable; action SHA pins/min permissions.

Portable: exact target GitHub-hosted no deployment secret/self-hosted; failure prevents deploy; moved branch never substitutes.

Approval: temporary/bootstrap deploy job cannot enter concurrency/runner before approval.

Control-plane freshness: old queued workflow commit cannot mutate after main advances. Main stale superseded; temporary/bootstrap stale fail.

Serialization: GitHub queue + busy + host flock no interleaving; order irrelevant; overflow observable.

Clean worktree: preexisting tracked/untracked unexpected blocks. Post-updater exact HEAD/no tracked/untracked debris required before activation. Restoration removes only post-journal target debris/journal paths; ignored state not silently purged.

Drain: listener stop/no new assignment/no mutation while worker/timeout no kill/prior restore.

Ownership: deployer no direct write; Git admin; build stage builder; active/controller/recovery root; health github-runner.

Protocol: unsupported target before drain; stage-only updater receives no workflow credential, cannot legitimately activate/service/control state; prebootstrap manual helper works, managed direct fails.

Controller ownership: target updater cannot be trusted source of journal/rename truth. Tests prove controller detects active-runtime, checkout, service or controller-state mutation and restores.

Staging: build fail active untouched; device/capacity before drain; controller rename interruption recovers; backup retained; dependency cache clean.

Cgroup: timeout TERM/KILL accidental descendants; restoration only after unit inactive.

Temporary isolation: primary stopped through target stage/activation/health and LKG restoration/health.

Bootstrap: no invented LKG; failure restores fallback; success current only, primary, markers last.

Main: current target/control plane, drain, exact checkout, host checks, stage-only updater, controller activation, manifest/health, candidate-before-refs, atomic refs/metadata, primary/final consistency; startup failure reverts all.

Runtime identity: checkout/manifest/digests/metadata/controller/current agree; invalid data fails.

Listener readiness: service/stable listener/runner identity and credential type-owner-mode; no GitHub scheduling claim.

Cancellation: workflow loss does not kill root service; next waits; boot recovery precedes primary, status independent.

Recovery: offline source restore/Git reconstruction/runtime backup/interrupted/controller/critical. No malicious-root/whole-VM guarantee.

Logging: bounded root raw with truncation; fixed/normalized workflow diagnostics, not full transcript/secret guarantee.

Outcomes:

- superseded main: success/no mutation;
- main success: success accepted;
- main fail + healthy restore: workflow fail, host prior LKG;
- temporary target success + restore: success;
- temporary target fail + restore: fail, host LKG;
- stale temporary/bootstrap: fail/no mutation;
- unproven restore: fail critical.

Completion: all Progress evidence, tests/CI/review, production/disposable demonstrations.

## Idempotence and Recovery

Fresh install one-time. Setup/migration absent/exact/partial/conflict; only attempt-owned compensation.

Migration restartable; deployment runner may start pending, no refs/managed markers; conflicts fail.

Submission exactly once; reused ID different/conflict rejected; status read-only.

Root journal strict/bounded/atomic records control-plane/target, transaction ref, drain, checkout, updater unit, stage result, controller-owned backup/activation boundaries, health, candidate, refs, primary, restoration, terminal.

Target updater cannot write journal by contract; controller derives observed state independently before every phase transition.

Runtime same filesystem; old-active/stage-only/backup-without-active/new-active+backup distinguishable via journal/manifests.

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
- 2026-07-21 first adversarial corrections.
- 2026-07-21 second adversarial corrections.
- 2026-07-21 third adversarial simplification/staging corrections.
- 2026-07-21 fourth control-plane/transaction/cgroup corrections.
- 2026-07-21 fifth correction: controller sole activation/journal owner, stage-only updater, post-updater source invariants, migration transition.

Future evidence: GitHub settings; hashes; tests/counts/coverage; group/workflows/environments/branch; ownership/device/capacity; requests/phases/cgroup/manifest/controller/restoration/final; recovery refs/fsck; stage/backup; cancellation/boot; demonstrations; CI/final review.

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

Managed updater environment/interface equivalent:

    AGENT_RELAY_UPDATE_MODE=controller-stage-v1
    AGENT_RELAY_TRANSACTION_ID=<validated-id>
    AGENT_RELAY_BUILD_ROOT=<controller-created-path>
    AGENT_RELAY_RUNTIME_STAGE=<controller-created-path>
    AGENT_RELAY_EXPECTED_SOURCE_SHA=<target-sha>

Updater may finalize only declared stage and protocol-declared host state; it returns status and leaves active runtime/services/controller state unchanged.

Manifest equivalent:

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

Journal equivalent:

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

Bounded configuration: request, drain/fetch/host/updater/health/primary/transaction/busy deadlines; TERM/KILL; disk headroom; status interval; raw/diagnostic bytes; retention transactions/backups/generations/controllers.

Use pinned existing host tools where possible. No third-party runtime dependency without recorded necessity.

Revision note (2026-07-21): Performed fifth adversarial review. Moved every recovery-critical runtime rename and journal transition out of target `update.sh` into installed controller; defined managed updater as stage producer only; added controller observation of active runtime, checkout and service invariants; required post-updater clean source before activation; selected exact common flock inode; and documented migration-before-new-updater transition with safe refusal instead of destructive fallback. Plan only; implementation not complete.