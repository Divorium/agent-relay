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

- a push to protected `main`, or a manual retry of current protected `main`, validates the exact commit on GitHub-hosted infrastructure and deploys it only if both the target commit and the workflow-control commit are still current when the host transaction begins;
- an authorized operator can manually select an open same-repository pull request, including a draft PR, or a same-repository branch, resolve it once to an exact commit, validate it outside both self-hosted runners, and test that revision's real privileged `update.sh` on the real host;
- a second persistent deployment runner on the same VM remains independent of the primary Agent Relay runtime and can submit or inspect transactions while the primary runner is stopped or broken;
- the controller stops the primary listener and drains every active `github-runner` worker before changing the trusted checkout;
- candidate runtime is built in a transaction-scoped staging directory on the same filesystem as active `dist`, and the previous runtime is retained until acceptance or restoration is complete;
- controller-mode update leaves the primary listener stopped and the controller verifies it stayed stopped, so temporary code is never exposed to ordinary queued CI or Codex jobs;
- the controller runs a fixed network-free runtime health check as `github-runner` in a sanitized temporary home, validates an exact build manifest, and starts primary only after final accepted or restored state is selected;
- a failed `main` deployment attempts to converge to the previous locally retained last-known-good main revision without requiring GitHub network access;
- workflow cancellation does not terminate a host transaction after mutation starts because a root-owned systemd service, not the workflow shell, owns the transaction;
- deployment and restoration results are reported separately, and critical-recovery state is preserved when automated restoration cannot be proven.

Selected revisions are trusted same-repository code and execute with broad host authority because the purpose is to test the real privileged updater. This system provides **best-effort rollback for accidental failures**. It is not isolation from malicious code and is not a VM snapshot. A privileged target can damage the controller, deployment runner, recovery repository, credentials, operating system, Docker data, or VM. Root ownership, runner groups, environment approval, sanitized environment, cgroups, and a second runner on the same VM must never be described as protection from malicious privileged target code.

The acceptance path deliberately does not claim that the primary registration has already accepted a GitHub job. Starting primary during a temporary transaction would allow an unrelated queued job to race onto temporary runtime. Without retaining an organization-management credential for dynamic runner control, the transaction instead proves runtime identity and health locally, then starts primary only after final state is selected. Documentation must preserve this limitation.

This plan preserves the current Docker decision: `DOCKER_PROVISIONING_ENABLED=0` remains authoritative. The work must not re-enable Docker provisioning in `update.sh` or reopen the Docker design from PR #46.

## Progress

Keep this section append-only. Split partially completed work into a checked historical entry and a remaining unchecked entry. Every checked implementation item must cite a repository location plus passing automated evidence, or a reproducible command plus captured result. Blocked items remain unchecked and use the `[blocked]` prefix required by `.agent/PLANS.md`.

- [x] (2026-07-21) Reviewed current installation, updater, runner, CI, Codex, documentation, and package-script contracts on baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- [x] (2026-07-21) Confirmed that primary cannot synchronously update itself because `update.sh` stops its listener and waits for every `Runner.Worker` owned by `github-runner`.
- [x] (2026-07-21) Reviewed GitHub persistent, ephemeral, JIT, registration-token, runner-label, runner-group, selected-workflow, workflow-dispatch, environment-review, concurrency-queue, and self-hosted queue mechanisms.
- [x] (2026-07-21) Selected a second persistent deployment runner for the single long-lived VM instead of an ephemeral or JIT runner.
- [x] (2026-07-21) Converted the original notes to the living ExecPlan structure used by PR #3.
- [x] (2026-07-21) First adversarial review corrected checkout-before-drain, overstated same-VM recovery, incomplete ownership and authorization, missing exact-SHA validation, unsafe queue assumptions, weak LKG storage, incomplete journal, controller-upgrade gaps, and Docker-scope ambiguity.
- [x] (2026-07-21) Second adversarial review corrected primary-dependent validation, unsafe primary-job smoke, workflow-lifetime coupling, bootstrap circularity, unmanaged manual-update divergence, reusable-workflow caller ambiguity, and old-target protocol incompatibility.
- [x] (2026-07-21) Third adversarial review removed unnecessary custom OIDC/reusable-workflow machinery, added direct selected-workflow routing, kept the deployment runner available for diagnostics, added staged runtime activation and pre-bootstrap fallback, moved controller activation before accepted refs, and separated environment approval from deployment concurrency.
- [x] (2026-07-21) Fourth adversarial review added control-plane-SHA freshness, transaction refs before mutation, unexpected-untracked handling, same-filesystem/capacity checks, transient systemd cgroup execution, enforced primary-stop invariants, clean-build-cache boundaries, and exact boot-service ordering.
- [ ] Complete Milestone 0 and record actual GitHub-side feasibility evidence before implementation code is written.
- [ ] Revalidate the pinned baseline and human-maintained workflow files immediately before implementation.
- [ ] Implement the stable deployment protocol, portable validation entrypoint, staged updater mode, runtime manifest/health check, and managed/manual update boundary.
- [ ] Implement fresh-install and existing-host migration support for deployment account, second runner, restricted group, controller services, recovery repository, state roots, and bootstrap-pending mode.
- [ ] Implement trusted request submission, root transaction lifetime, drain, exact checkout, updater cgroup, local health, acceptance, restoration, cancellation survival, and boot recovery.
- [ ] Human reviewer: add direct automatic-main, temporary, bootstrap, and status workflows; route every ordinary self-hosted job only to `agent-relay-main`; configure runner group, environments, branch protection, and concurrency.
- [ ] Add deterministic unit, contract, integration, and system coverage for feasibility, installation, migration, drain, ownership, validation, protocol, staging, transactions, interruption, health, restoration, controller activation, bootstrap, and recovery.
- [ ] Run focused validation, complete repository validation, exact-head CI, and independent point-by-point review.
- [ ] Perform real-host migration and temporary/main demonstrations. Perform failed-main, cancellation, restart, checkout-corruption, bootstrap-failure, and controller-activation demonstrations on a disposable clone or snapshot-equivalent VM.
- [ ] Update `Outcomes & Retrospective`, append final evidence and a revision note, and move this same plan to `docs/exec-plans/completed/` only after every item is checked.

## Surprises & Discoveries

- Observation: checkout mutation before drain can change scripts used by an active Codex job.
  Evidence: current workflows execute resolver, launcher, and finalizer scripts directly from `/srv/github-runner/storage/agent-relay`.

- Observation: another runner under the same `github-runner` UID retains updater self-wait deadlock.
  Evidence: current wait condition is UID plus process name, not runner registration name or label.

- Observation: root-owned controller is not a security boundary against root-equivalent target code.
  Evidence: privileged target code can modify root-owned files, services, credentials, networking, recovery data, and VM.

- Observation: existing updater lock is too narrow.
  Evidence: it begins inside `update.sh`, after future Git operations, and ends before acceptance or restoration.

- Observation: exact-SHA validation cannot depend on primary.
  Evidence: deployment/recovery must work while primary is unavailable. Portable validation must run on GitHub-hosted infrastructure.

- Observation: current complete `npm run check` is not portable to clean GitHub-hosted runner.
  Evidence: `check:toolchain` requires dedicated host Java, Go, Rust, Codex, and filesystem paths. A separate portable check is required without weakening full host validation.

- Observation: primary GitHub smoke creates scheduling race.
  Evidence: once listener starts, any queued ordinary job matching `agent-relay-main` can be assigned before intended smoke.

- Observation: current updater destroys active `dist` before replacement build completes.
  Evidence: first bootstrap has no accepted LKG. Failed build must preserve only working runtime.

- Observation: checkout SHA does not prove runtime provenance.
  Evidence: baseline runtime has no source-SHA manifest.

- Observation: current `origin/main` is not rollback state after failed merge deployment.
  Evidence: remote already points to failed commit.

- Observation: text SHA does not retain Git object.
  Evidence: ref deletion, force-push, garbage collection, or production `.git` damage can make it unavailable.

- Observation: restoration must not require GitHub availability.
  Evidence: network or DNS failure may be part of incident.

- Observation: workflow cancellation cannot own host safety.
  Evidence: cancellation can terminate invoking shell after mutation.

- Observation: direct selected workflows are simpler and stronger than reusable-workflow plus custom OIDC for this repository.
  Evidence: runner group can permit several exact workflow paths at `refs/heads/main`, and only jobs directly defined in those workflows can use group.

- Observation: environment approval must not occupy deployment concurrency queue.
  Evidence: unresolved temporary approval could otherwise block automatic main.

- Observation: cancellation releases GitHub concurrency before root transaction necessarily finishes.
  Evidence: next job must treat host lock/status as authoritative and wait before submission.

- Observation: bootstrap needs deployment runner before bootstrap completes.
  Evidence: migration starts restricted runner in bootstrap-pending mode and accepts only bootstrap/status.

- Observation: bootstrap failure needs fallback before LKG exists.
  Evidence: migration preserves current checkout object and staged activation retains pre-bootstrap active runtime.

- Observation: direct `git pull && ./update.sh` after managed bootstrap diverges runtime from accepted state.
  Evidence: later recovery could replace unrecorded manual runtime.

- Observation: controller upgrades cannot change active protocol underneath current controller.
  Evidence: updater, manifest, request, journal and candidate interfaces require backward compatibility.

- Observation: unknown recovery state should block primary mutation, not diagnostic channel.
  Evidence: deployment runner exists to report primary failures.

- Observation: listener credential bytes may legitimately rotate without changing runner identity.
  Evidence: acceptance must verify file type, ownership, mode and stable identity fields, not hash all credential bytes.

- Observation: selected workflow itself can become stale while queued.
  Evidence: a temporary or bootstrap run created from an older protected-main commit may start after `main` advances. Request must include `controlPlaneSha`, and controller must require current `origin/main` to match it before mutation.

- Observation: candidate target object should enter protected recovery storage before host mutation.
  Evidence: target or accidental checkout corruption after reset must not remove the only object needed to complete/recover transaction.

- Observation: staging path assumptions need verification.
  Evidence: directory rename is only atomic within one filesystem. Controller must compare device IDs and fail before drain when stage/backup/active roots differ.

- Observation: process-group control is weaker than a systemd cgroup for accidental descendants.
  Evidence: updater should run in a unique transient systemd service with `KillMode=control-group`, bounded TERM/KILL handling, and verified inactive state before restoration.

- Observation: current repo cleanup requirement for untracked files was undecided.
  Evidence: automatic deletion of unknown pre-existing untracked files is unsafe. Clean preflight rejects unexpected tracked changes or nonignored untracked files. During restoration, controller may delete nonignored files created after journaled mutation.

- Observation: source `node_modules` is persistent ignored state and may be stale.
  Evidence: managed build must use clean transaction build state or globally pinned tools and must not consume unverified ignored dependencies from source checkout.

- Observation: GitHub concurrency is bounded and dispatch order is not correctness state.
  Evidence: `queue: max` retains at most 100 pending jobs. Controller serializes host and skips stale main requests.

## Decision Log

- Decision: use a second persistent organization runner on same VM.
  Rationale: long-lived VM needs recovery channel independent of primary process. Ephemeral creation adds persistent API credentials and lifecycle complexity without VM isolation.
  Date/Author: 2026-07-21 / design review.

- Decision: restoration is best effort for accidental failure.
  Rationale: real updater testing requires broad host authority that can defeat same-VM controls.
  Date/Author: 2026-07-21 / adversarial-review correction.

- Decision: use four direct workflows pinned to protected main: `deploy-main.yml`, `deploy-temporary.yml`, `deploy-bootstrap.yml`, and `deploy-status.yml`.
  Rationale: runner-group selected-workflow policy can list several exact paths. Direct workflows eliminate reusable-caller ambiguity and custom authentication code.
  Date/Author: 2026-07-21 / simplification review.

- Decision: restrict deployment runner group to those four paths at `refs/heads/main`, repository `Divorium/agent-relay`, and label `agent-relay-deploy`.
  Rationale: only jobs directly defined in reviewed main workflows may reach deployment runner.
  Date/Author: 2026-07-21 / access-control design.

- Decision: temporary/bootstrap require protected-environment approval under operator model verified in Milestone 0.
  Rationale: repository write access alone must not automatically authorize privileged branch execution. Approval completes before deploy job enters concurrency.
  Date/Author: 2026-07-21 / authorization design.

- Decision: validate target on `ubuntu-latest`, not either self-hosted runner.
  Rationale: validation must work while primary is broken and must not execute target scripts under privileged deployment account.
  Date/Author: 2026-07-21 / validation design.

- Decision: pin every action used by deployment workflows to full commit SHA and grant minimum token permissions.
  Rationale: workflow code is trust boundary.
  Date/Author: 2026-07-21 / workflow-hardening review.

- Decision: keep deployment runner under `agent-relay-deployer` with no direct checkout/root-state write.
  Rationale: it runs reviewed workflow shell and fixed no-argument helpers. Root service owns mutation.
  Date/Author: 2026-07-21 / ownership design.

- Decision: use mode-specific submission helpers plus read-only status helper.
  Rationale: mode derives from installed helper selected by trusted workflow, not request option. Helpers accept no arguments and read bounded canonical JSON from stdin.
  Date/Author: 2026-07-21 / request-boundary design.

- Decision: trust selected workflow/deployment account as control-plane boundary rather than implement custom OIDC.
  Rationale: no target code runs on deployment runner, account is locked, runner group admits only direct protected-main workflows, and custom JWT verifier would add substantial failure surface without isolating malicious root target.
  Date/Author: 2026-07-21 / complexity correction.

- Decision: run host transaction in root-owned systemd service independent of workflow lifetime.
  Rationale: workflow cancellation or runner death must not interrupt safety after mutation.
  Date/Author: 2026-07-21 / cancellation design.

- Decision: keep host lock authoritative and GitHub concurrency advisory.
  Rationale: cancellation can release GitHub queue while root transaction remains active. Subsequent job waits on status before submitting.
  Date/Author: 2026-07-21 / serialization design.

- Decision: reuse one root-readable flock target for manual pre-bootstrap update, transaction, and recovery; controller-mode updater does not reacquire it.
  Rationale: Git, update and restoration need one exclusion boundary. Implementation may keep current protected administrator file as lock or introduce a compatible protected lock file, but all entrypoints must use same inode.
  Date/Author: 2026-07-21 / lock-contract review.

- Decision: stop primary and drain every `github-runner` worker before checkout mutation.
  Rationale: active jobs use trusted checkout files.
  Date/Author: 2026-07-21 / safety correction.

- Decision: drain is bounded and non-destructive.
  Rationale: timeout kills no GitHub job, mutates no checkout/runtime, restores prior listener state, and records `drain_timeout`.
  Date/Author: 2026-07-21 / operational policy.

- Decision: run Git mutation as recorded administrator through root controller.
  Rationale: checkout remains administrator-owned; deployer gets no write access.
  Date/Author: 2026-07-21 / ownership correction.

- Decision: require `controlPlaneSha` to equal current protected `origin/main` for main, temporary, and bootstrap before mutation.
  Rationale: old queued workflow code must not remain authoritative after main changes. Main additionally requires target SHA equality; temporary target remains independently pinned.
  Date/Author: 2026-07-21 / stale-control-plane correction.

- Decision: define backward-compatible deployment protocol before managed deployment.
  Rationale: installed controller cannot safely execute pre-protocol/breaking updater. Old temporary branches must merge/rebase protocol baseline.
  Date/Author: 2026-07-21 / compatibility design.

- Decision: controller-mode updater uses clean staged build, retained active-runtime backup and leaves primary stopped.
  Rationale: build failure preserves runtime, bootstrap needs pre-LKG fallback, and temporary code must not serve ordinary jobs.
  Date/Author: 2026-07-21 / runtime-safety design.

- Decision: execute updater in controller-owned transient systemd service/cgroup.
  Rationale: accidental descendants remain in one cgroup, timeout can stop whole unit, and restoration begins only after unit is inactive. This is best effort against trusted code, not malicious-root containment.
  Date/Author: 2026-07-21 / process-control correction.

- Decision: use local runtime health as `github-runner`, not transactional GitHub smoke.
  Rationale: verifies runtime without primary scheduling. Health uses `env -i`, temporary HOME and no actual Codex credentials/network/model request.
  Date/Author: 2026-07-21 / smoke-isolation design.

- Decision: recovery Git refs are authoritative and metadata descriptive.
  Rationale: atomic ref transactions retain accepted objects; metadata publication is journal-recoverable.
  Date/Author: 2026-07-21 / recovery-store design.

- Decision: automatic main is latest-only.
  Rationale: validated request whose target or control-plane SHA no longer equals current main is superseded without mutation.
  Date/Author: 2026-07-21 / ordering policy.

- Decision: before bootstrap, only bootstrap and status are accepted.
  Rationale: deployment runner is needed for bootstrap, but no normal transaction may mutate host before initial accepted state.
  Date/Author: 2026-07-21 / bootstrap design.

- Decision: after managed mode, direct ordinary `update.sh` invocation fails closed.
  Rationale: unmanaged runtime mutation diverges from accepted state. Recovery/rebootstrap remain explicit administrator procedures.
  Date/Author: 2026-07-21 / state-consistency design.

- Decision: stage and verify controller candidate before accepted refs change.
  Rationale: activation failure leaves old refs/controller intact. Only backward-compatible main targets activate controller; temporary never does.
  Date/Author: 2026-07-21 / controller-upgrade correction.

- Decision: keep deployment runner available for read-only status in critical recovery when its own service remains usable.
  Rationale: boot recovery blocks primary and mutation but should not remove diagnostic channel.
  Date/Author: 2026-07-21 / recovery-channel correction.

- Decision: preserve `DOCKER_PROVISIONING_ENABLED=0`.
  Rationale: plan does not reopen Docker-host provisioning.
  Date/Author: 2026-07-21 / scope correction.

## Outcomes & Retrospective

This plan remains active. No installer, updater, controller, workflow, service, runner registration, GitHub setting, or production-host behavior has changed through plan-only commits.

Current design avoids principal circular dependencies: target validation does not require primary, temporary health does not start primary, bootstrap has pre-LKG fallback, workflow cancellation does not own host process, and failed candidate builds retain prior runtime. Remaining same-VM limitation is explicit: privileged target code can defeat recovery controls.

Implementation is larger than `git pull && ./update.sh` because current runner updates itself, active jobs read shared checkout, runtime lacks source identity, and first managed deployment has no LKG. Milestone 0 blocks implementation if actual GitHub controls cannot enforce accepted trust model.

Update this section after every accepted milestone. On completion, state real-host and disposable-VM results and move same plan to `completed` without summary replacement.

## Context and Orientation

Current host contracts:

- `/srv/github-runner/storage/agent-relay`: administrator-owned checkout and root-owned `dist`;
- `/srv/github-runner/storage/work`: primary workflow workspaces;
- `/srv/github-runner/storage/runner`: primary runner installation;
- `/srv/github-runner/storage/home`: primary home and Codex authentication;
- `/srv/github-runner/storage/build` and `build-home`: builder state;
- `github-runner`: primary runner/Codex account, no sudo;
- `agent-relay-builder`: compiler account, no sudo;
- `/etc/agent-relay/administrator`: recorded administrator;
- `actions.runner.Divorium.gh-runner.service`: primary service.

`install.sh` is one-time installer. It installs pinned toolchains, creates accounts/directories, verifies official runner, obtains short-lived registration token from interactively provided organization credential, configures primary, records administrator, and performs Codex login.

`update.sh` currently accepts no arguments, requires exact source path and recorded administrator, acquires sudo, stops primary, waits indefinitely for primary workers, deletes active `dist`, compiles directly into replacement, finalizes ownership/modes, and starts primary. Docker provisioning is disabled.

Current CI/Codex use bare `[self-hosted]`. Before second runner registration, every ordinary job must require `[self-hosted, agent-relay-main]`.

Expected new host layout is equivalent to:

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
    /usr/local/libexec/agent-relay-deploy-controller -> /var/lib/agent-relay-deploy/controller-versions/<version>/controller
    /etc/agent-relay/deployer
    /etc/sudoers.d/agent-relay-deployer
    /etc/systemd/system/agent-relay-deploy-transaction.service
    /etc/systemd/system/agent-relay-deploy-recover.service

Terms:

- **primary runner**: existing `gh-runner`, executing CI/Codex only after final runtime selection;
- **deployment runner**: `gh-deploy-runner`, executing only selected deployment/status workflows;
- **control-plane SHA**: commit containing workflow code used by request; must still equal current protected main before mutation;
- **portable validation**: GitHub-hosted checks without dedicated host toolchain paths;
- **host compatibility**: installed controller checks of commands, versions, filesystem, capacity, services and target protocol metadata;
- **controller service**: root transaction owner independent of workflow lifetime;
- **deployment protocol**: stable versioned contract among controller, target updater, manifest, candidate and journal;
- **LKG**: `refs/agent-relay/current` in recovery repository;
- **pre-bootstrap state**: exact checkout plus retained active runtime/service, used only for failed bootstrap recovery and never called LKG;
- **runtime health**: fixed network-free command run as `github-runner` with sanitized temporary environment while primary stopped;
- **critical recovery**: mutation occurred and final accepted/restored state cannot be proven.

## Plan of Work

### Milestone 0: Prove GitHub-side feasibility

Verify on actual organization/repository:

- organization runner group can be created/managed;
- it allows this public repository and exactly four workflow paths pinned to `refs/heads/main`;
- workflow restrictions are writable, not inherited read-only;
- installation credential has only runner-group/registration/label/inspection permissions required;
- protected environments/reviewers are available for temporary/bootstrap;
- user accepts actual self-review/administrator-bypass model;
- protected main prevents unauthorized workflow change, force push and deletion;
- `queue: max` works and 100-pending bound is acceptable.

If any required control is unavailable, append `[blocked]`, do not register/start privileged deployment runner, and revise architecture.

### Milestone 1: Define stable repository/updater protocols

Revalidate baseline, updater, workflows, scripts, Docker state, service behavior and `.agent/PLANS.md`.

Add versioned contract such as `.agent-relay/deployment-protocol.json`:

    schemaVersion: 1
    updaterControllerProtocol: 1
    runtimeManifestSchema: 1
    controllerCandidateSchema: 1
    minimumControllerProtocol: 1
    maximumControllerProtocol: 1

Controller rejects exact target before drain unless contract supported. Pre-protocol temporary branch must merge/rebase baseline. Breaking change requires separate migration.

Add `npm run check:portable`: typecheck, tests, runtime build, shell syntax, Node script syntax and portable system tests on `ubuntu-latest` without `/opt` layout, Codex login, Docker daemon, PAT, deployment/primary runner. Keep complete `npm run check` and host toolchain checks.

Define fixed compiled runtime-health entrypoint. It accepts no arbitrary command, performs no network/model request, reads no source checkout, writes no persistent state, validates manifest/modules and returns bounded diagnostics.

### Milestone 2: Implement human-maintained workflows

Add four direct workflows. Pin every external action to full SHA and grant minimum permissions.

`deploy-main.yml`:

- triggers on `push` to protected main and `workflow_dispatch` retry of current main;
- target SHA and `controlPlaneSha` both equal workflow `github.sha`;
- credential-free GitHub-hosted validation with Node 22, explicit ordinary prerequisites, `npm ci`, `npm run check:portable`;
- directly defined deployment-runner job using group/label;
- job concurrency `agent-relay-host-deployment`, `queue: max`, no active cancellation;
- fixed main helper and bounded status polling.

`deploy-temporary.yml`:

- `workflow_dispatch` only, fail unless `github.ref == refs/heads/main`;
- `controlPlaneSha = github.sha`;
- resolve PR/branch to exact same-repo SHA; draft PR allowed when explicitly selected;
- reject fork, tag, merge ref, URL, malformed/ambiguous ref, unsupported protocol;
- GitHub-hosted portable validation;
- lightweight GitHub-hosted protected-environment approval job;
- only after approval, directly defined deployment-runner job with shared concurrency;
- fixed temporary helper/status polling.

`deploy-bootstrap.yml`:

- dispatch from main only, `controlPlaneSha = github.sha`, target exact current main;
- portable validation, lightweight protected bootstrap approval, then direct deployment job with shared concurrency;
- fixed bootstrap helper; controller accepts only bootstrap-pending or explicit rebootstrap state.

`deploy-status.yml`:

- dispatch from main only;
- directly defined deployment-runner read-only status job;
- no target/concurrency/mutation.

Runner group selected-workflow list contains exactly those four paths at main. No reusable workflow. Deploy jobs never checkout target, run target scripts, expose persistent organization credential, or print raw updater output.

If prior workflow was canceled after submission, next deploy helper sees `busy`; job polls active status until idle or bounded expiry before submission. It never cancels/replaces host transaction.

Update CI, Codex and examples so no production workflow retains bare `[self-hosted]`; ordinary jobs require `agent-relay-main`.

### Milestone 3: Install, migrate and enter bootstrap-pending

Fresh install and restartable migration must:

- create `agent-relay-deployer` with separate runner/work/home and no Codex login;
- configure selected-workflow group and register deployment runner with group and label using separate short-lived token;
- add `agent-relay-main` to existing primary registration without replacing identity;
- install immutable controller versions, helpers, transaction/recovery units, recovery repo, runtime stage/backup roots, state/log roots and narrow sudo;
- allow deployer only three no-argument submit helpers and read-only status, not shell/Git/systemctl/updater/controller/admin recovery;
- keep PAT/registration tokens only in memory and out of arguments/files/logs/fixtures/workspaces/children;
- initialize recovery repo without inventing LKG;
- require clean administrator-owned checkout at exact current protected main;
- reject tracked changes and pre-existing nonignored untracked files rather than deleting them silently;
- import checkout object as `refs/agent-relay/bootstrap-source` and record primary service state;
- validate existing runtime path/owner without claiming provenance;
- validate stage/backup/active runtime roots share filesystem and have configured free-space headroom;
- write bootstrap-pending, start restricted deployment runner and leave main/temporary disabled;
- require trusted bootstrap workflow;
- write bootstrap-complete/managed-mode only after success.

Failed bootstrap restores bootstrap-source checkout, retained prior runtime and prior service state, remains bootstrap-pending and creates no LKG.

### Milestone 4: Fixed submission and independent transaction lifetime

Mode-specific helper accepts no arguments and reads one bounded canonical JSON document from stdin. Trusted workflow constructs JSON with safe serializer such as `jq -n --arg`, never raw shell concatenation.

Helper:

- derives mode from executable name;
- validates strict fields/limits, exact repository, exact SHA, normalized source, workflow run/attempt, audit actor and `controlPlaneSha`;
- rejects unknown/duplicate fields and control characters;
- rejects normal modes before bootstrap and bootstrap after completion unless explicit rebootstrap state;
- checks journal/result/request consistency;
- atomically stores root-only request once;
- starts transaction service and returns request ID;
- stores no credential because none is required.

Selected workflow plus locked deployment account is authentication boundary. Helper is not public API. Compromise of deployer/selected workflow equals deployment-control-plane compromise.

Root service owns lock, journal, Git, transient updater unit, runtime activation, acceptance/restoration and result. Workflow cancellation/runner death does not terminate it. Status is read-only and bounded.

Boot recovery unit is ordered `Before=` and required by primary service, but not by deployment-runner service. Known journal recovery converges before primary starts. Unknown/contradictory state keeps primary stopped and mutation blocked while deployment runner/status remain available if their own files are valid.

Root systemd transaction starts with fixed environment from protected request file. It does not inherit `GITHUB_TOKEN`, runner job token or workflow process environment.

### Milestone 5: Implement host transaction

Controller acquires one lock shared by manual pre-bootstrap update, transaction and admin recovery. Controller-mode updater does not reacquire.

Preflight before primary stop:

1. validate request/mode/protocol, checkout path/owner, expected remote, safe Git config, no submodule/alternate worktree, recovery integrity, refs, controller and journal;
2. require checkout tracked state clean; reject unexpected pre-existing nonignored untracked files;
3. fetch exact expected source ref into transaction namespace as administrator, hooks disabled;
4. verify object equals validated target and supports protocol;
5. import target object into recovery repo under transaction ref and verify connectivity before mutation;
6. fetch current `origin/main`; require `controlPlaneSha` equals it for every mutating mode; main/bootstrap additionally require target equals it; stale main reports successful `superseded`, stale temporary/bootstrap fails without mutation;
7. verify current LKG or bootstrap fallback;
8. verify stage/backup/active roots same device, free-space headroom, path ownership/modes and no symlinks;
9. run installed non-mutating host compatibility checks against protocol requirements; do not execute target compatibility script as root/admin.

Drain:

1. write preparing journal and prior primary state;
2. stop only primary listener;
3. wait bounded for all primary workers;
4. on timeout/error restore prior listener, mutate nothing, record failure;
5. write drained durably before checkout mutation.

Target update:

1. reset/clean tracked checkout to exact target as administrator; after journaled mutation, removal of nonignored files created by target is permitted during restoration;
2. verify checkout ownership and exact HEAD;
3. start exact regular non-symlink target `update.sh` controller mode in unique transient systemd service with `KillMode=control-group`, fixed timeout and sanitized environment;
4. managed build uses transaction build root or pinned global tools and never unverified source `node_modules`/ignored dependency cache;
5. updater builds stage on same filesystem, validates/finalizes it, renames active dist to retained backup, renames stage to active, journals boundaries, and leaves primary stopped;
6. controller waits for transient unit and all cgroup processes to be inactive; timeout performs TERM then KILL and verifies inactivity before restoration;
7. controller fails if updater started/enabled primary or changed deployment-runner service;
8. verify manifest SHA/protocol/updater/entrypoint/health digests, owner/modes/finalized state;
9. run health as `github-runner` under `env -i`, temporary HOME/state, no Codex credentials, no network/model/source mutation;
10. retain previous runtime backup until terminal state.

Main acceptance:

1. stage/self-test controller candidate if changed;
2. reject breaking protocol;
3. candidate post-switch self-test occurs provisionally before accepted refs; switch back immediately on failure;
4. target already exists under transaction ref; verify connectivity;
5. atomically update previous/current/generation refs only after controller compatibility;
6. publish accepted/deployed metadata through journal;
7. start primary and verify stable service/listener, expected runner name/ID/labels, and credential-file type/owner/mode without byte-hash requirement;
8. if readiness fails, stop primary, revert refs/metadata/controller, restore previous checkout/runtime, health-check and retry primary;
9. success only when checkout, manifest, controller, runtime digest, refs and service agree;
10. retain bounded prior runtime/generation, remove only journal-owned stage/temp paths.

Temporary:

1. record target health, never change refs/activate candidate;
2. keep primary stopped;
3. restore checkout from local current LKG;
4. run LKG updater through same staged/cgroup contract;
5. verify LKG manifest/health and restore controller;
6. start primary only after LKG complete;
7. report target/restoration separately; target failure plus healthy restoration fails workflow;
8. critical recovery when restoration unproven.

Bootstrap:

1. starts with no LKG but bootstrap-source and runtime fallback;
2. deploy exact current main through staged/cgroup contract and health;
3. validate compatible candidate before refs;
4. create current and generation ref; previous remains absent;
5. start primary/readiness;
6. write bootstrap-complete/managed-mode last;
7. any failure restores pre-bootstrap checkout/runtime/service and remains pending.

### Milestone 6: Updater, manifest, recovery and controller upgrades

Refactor `update.sh` without duplicate build logic:

- pre-bootstrap manual mode preserves administrator use and service restoration;
- managed controller mode requires installed protocol, assumes primary drained, leaves primary stopped;
- after managed-mode direct ordinary invocation fails with instructions for GitHub deployment/admin recovery/rebootstrap;
- all build modes use clean transaction staging; active dist is not removed before replacement passes validation;
- manifest includes schema, exact source SHA, protocol/updater version, runtime/health paths and SHA-256, timestamp, finalized true;
- partial stage/manifest/rename is journal-recoverable and never active;
- Docker remains disabled.

Recovery refs:

    refs/agent-relay/current
    refs/agent-relay/previous
    refs/agent-relay/bootstrap-source
    refs/agent-relay/transactions/<transaction-id>
    refs/agent-relay/generations/<generation-id>

Current/previous/generation updates use atomic `git update-ref --stdin`. Transaction/generation refs prevent pruning. Bootstrap leaves previous absent.

Ordinary recovery never fetches GitHub. It restores checkout from recovery objects, runs stable staged updater, verifies manifest/health, restores controller and starts primary. Emergency reconstruction may replace damaged production Git metadata from root-controlled temporary clone and restore admin ownership; it may discard ignored caches.

If stable updater restoration fails but retained runtime backup has valid LKG manifest/digests, admin recovery may start it only as explicit degraded critical-recovery action. It does not clear journal or claim convergence.

Controller candidates use immutable version directories/atomic symlink. Candidate validation precedes refs. Active/previous controller understand current journal/updater protocol. Breaking migration is separate plan.

### Milestone 7: Documentation and acceptance

Update docs only after behavior exists. Cover portable validation, direct selected workflows, approvals, control-plane freshness, bootstrap-pending, queue/busy behavior, drain, cgroup update, staged runtime, manifest, health limitation, latest-main, managed manual refusal, recovery refs/backups, critical recovery, controller upgrades, bounded logs, Docker disabled, best-effort rollback.

Run focused/full tests, exact-head CI, independent review, real-host migration/temporary/main demonstrations and disposable-VM failure/restart/controller tests. Keep plan active until evidence exists.

## Concrete Steps

Run from repository root. Codex performs no Git mutation and does not edit human workflow files.

Baseline:

    git cat-file -e e9ec636e5abf383f8831fc126b99f04e2e005a3c^{commit}
    git merge-base --is-ancestor e9ec636e5abf383f8831fc126b99f04e2e005a3c HEAD
    git status --short
    git diff --name-status e9ec636e5abf383f8831fc126b99f04e2e005a3c...HEAD
    git grep -n 'DOCKER_PROVISIONING_ENABLED=0' e9ec636e5abf383f8831fc126b99f04e2e005a3c -- update.sh
    git diff --exit-code e9ec636e5abf383f8831fc126b99f04e2e005a3c -- .agent/PLANS.md .github/workflows examples/github-actions

Milestone 0 evidence, without credentials:

- group visibility/public repository/exact selected workflows/writable restrictions;
- temporary/bootstrap environment branch/reviewer/self-review/bypass settings;
- protected-main workflow/force-push/delete behavior;
- accepted `queue: max` and 100-pending bound;
- installation credential permissions.

Portable validation on clean GitHub-hosted Ubuntu:

    npm ci
    npm run check:portable

No self-hosted runner, Codex login, Docker daemon, PAT, deployment secret or dedicated `/opt` paths.

Focused implementation validation, equivalent names allowed after plan update:

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

Real-host migration/bootstrap evidence:

- primary label, deployment group/label, no Codex login;
- normal submissions rejected in bootstrap-pending before drain;
- controller/helpers/units/recovery/stage/backup/state/log/sudoers ownership/modes;
- no retained PAT/registration token;
- stage/backup/active device-ID and capacity checks;
- exact-current-main bootstrap with staging, manifest, health, primary readiness, current ref, absent previous, markers last.

Production VM:

1. successful temporary target, primary stopped throughout, restoration succeeds;
2. controlled temporary build/update failure preserves/restores runtime then LKG;
3. drain timeout mutates nothing and restores listener;
4. stale main or stale control-plane request skipped/rejected without mutation;
5. successful exact-main LKG;
6. direct update rejected after managed mode;
7. workflow canceled after submission while root service completes/restores;
8. status workflow reports active/terminal state;
9. unexpected pre-existing untracked file blocks before mutation;
10. updater attempt to start primary causes failure/restoration.

Disposable clone/snapshot:

1. bootstrap failure before/after runtime rename restores pre-bootstrap state;
2. failed main restores LKG with network disabled;
3. kill during each runtime rename state recovers deterministically;
4. host restart after checkout mutation blocks primary while status remains available;
5. production `.git` corruption reconstructs from recovery;
6. controller candidate switchback before refs;
7. incompatible protocol rejected before drain;
8. target/restoration double failure enters critical recovery;
9. updater descendant survives normal shell but is terminated with transient cgroup;
10. insufficient disk/cross-filesystem staging fails before drain.

## Validation and Acceptance

Acceptance is observable behavior, not code presence or intended design.

Feasibility proves actual selected-workflow group, public access, environments, protected main and queue support. Missing control blocks implementation.

Workflow routing proves only jobs directly defined in four selected main workflows use deployment runner. Other path/ref cannot schedule. Full-SHA action pins/minimum permissions are enforced.

Portable validation proves exact target on GitHub-hosted with no deployment secret/self-hosted runner. Failure prevents deployment job. Branch movement never substitutes SHA.

Approval proves temporary/bootstrap deploy job cannot enter shared concurrency or reach deployment runner before environment approval.

Control-plane freshness proves old queued main/temporary/bootstrap workflow commit cannot mutate host after main advances. Main stale result is `superseded`; stale temporary/bootstrap fails and requires fresh dispatch.

Serialization proves GitHub queue, busy handling and host lock prevent interleaved mutation; correctness independent of dispatch order; overflow observable.

Clean-worktree acceptance proves migration/preflight reject tracked changes or unexpected pre-existing nonignored untracked files. Restoration may remove only post-journal nonignored target debris and journal-owned paths; ignored state is not silently purged.

Drain proves listener stop, no new primary assignment, no checkout/runtime mutation while worker remains, timeout/no kill/prior-state restoration.

Ownership proves deployer cannot write checkout/runtime/controller/recovery/state/sudoers/services; Git admin-owned, stage builder-owned until final, runtime root-owned, health github-runner.

Protocol proves unsupported/breaking target rejected before drain; controller mode never starts primary, receives no GitHub credential; prebootstrap manual works, postbootstrap direct fails.

Staging proves build failure leaves active runtime; device/capacity mismatch fails before drain; rename interruption recovers; backup retained through terminal state; unverified ignored dependencies not consumed.

Cgroup proves timeout/TERM/KILL covers transient updater service and accidental descendants; restoration starts only after unit inactive. Primary/deployment service tampering is detected.

Temporary isolation proves primary stopped from drain through target activation/health and LKG restoration/health. No ordinary job can run against target.

Bootstrap proves no LKG invented; failure restores prebootstrap source/runtime/service; success creates current only, starts primary, writes markers last.

Main proves current target/control-plane, drain, exact checkout, installed host checks, cgroup updater, manifest/health, candidate before refs, atomic refs/metadata, primary startup/final consistency. Startup failure reverts all.

Runtime identity proves checkout, manifest source, runtime/health digests, metadata, controller and current ref agree. Missing/stale/partial/symlink/wrong-owner/tamper fails.

Listener readiness proves service/stable listener/runner identity and credential file type-owner-mode. It does not claim GitHub scheduled job.

Cancellation proves workflow loss does not kill root transaction; next job waits for host idle; boot recovery precedes primary but not diagnostic deployment runner.

Recovery works without GitHub, covers source restore, Git reconstruction, runtime backup, interrupted recovery, controller switchback and critical evidence. No malicious-root/whole-VM guarantee.

Logging defines byte/retention limits. Raw target output only root-owned bounded local log with truncation marker. Workflow gets fixed phases/normalized bounded diagnostics, not full transcript or secret guarantee against malicious privileged code.

Outcome semantics:

- superseded main: workflow success with explicit `superseded`, no mutation;
- successful main: success after final accepted state;
- failed main with healthy restoration: workflow failure, host healthy at prior LKG;
- successful temporary plus healthy restoration: success;
- failed temporary plus healthy restoration: failure, host healthy at LKG;
- stale temporary/bootstrap control plane: failure without mutation;
- unproven restoration: failure with critical recovery.

Completion requires every Progress item checked with evidence, focused/full tests and exact-head CI pass, independent review has no unresolved action, production demonstrations pass, and disposable-VM scenarios pass.

## Idempotence and Recovery

Fresh install remains one-time. Setup/migration distinguish absent, exact, partial, conflicting and compensate only attempt-owned resources.

Migration restartable: may start restricted runner in bootstrap-pending but writes no accepted refs/managed markers. Conflicts fail closed.

Submission creates request exactly once. Reused ID with different content/conflicting transaction rejected. Status read-only.

Root journal uses strict bounded schema, same-directory temp, required syncs, atomic rename. Records control-plane/target, drain, checkout, transaction ref, stage, runtime backup, rename boundaries, cgroup unit, health, candidate, refs, primary startup, restoration, terminal disposition.

Runtime paths are same filesystem. Crash states old-active, stage-only, backup-without-active, new-active-plus-backup are distinguishable via journal/manifests.

Accepted refs update atomically. Metadata separately journaled. Bootstrap creates current only; later acceptance moves old current to previous. Transaction/generation refs prevent pruning.

Recover never retries target. It converges prebootstrap or LKG, restores source/runtime/controller, validates health, starts primary when safe, archives only after success.

Unknown state keeps primary/mutation stopped but permits restricted status when possible. Local administrator repair required.

Direct unmanaged runtime mutation after bootstrap prohibited. Emergency repair explicit/recorded and followed by accepted-main/rebootstrap reconciliation.

Tests use temporary roots, local Git, fake systemd/process/service adapters and deterministic barriers; no real registration/settings/production mutation/network.

## Artifacts and Notes

Keep evidence append-only.

- 2026-07-21: Reviewed baseline deployment/runner contracts.
- 2026-07-21: Reviewed GitHub runner groups, selected workflows, environments, dispatch, concurrency and self-hosted behavior.
- 2026-07-21: Created draft PR #47 with plan only.
- 2026-07-21: Converted plan to PR #3 living structure.
- 2026-07-21: First adversarial review corrected drain, recovery guarantees, ownership, authorization, exact-SHA, queue, LKG, journal, controller and Docker scope.
- 2026-07-21: Second adversarial review corrected primary validation/smoke, workflow lifetime, bootstrap, unmanaged update, reusable caller and protocol.
- 2026-07-21: Third adversarial review simplified direct workflow routing, added runtime staging/prebootstrap fallback, corrected controller order, preserved status channel and separated approval/concurrency.
- 2026-07-21: Fourth adversarial review added control-plane freshness, pre-mutation transaction refs, worktree cleanup policy, filesystem/capacity validation, transient updater cgroup, service invariants and clean build-state requirements.

Required future evidence:

- Milestone 0 settings/API evidence without credentials;
- baseline/protected-file hashes;
- exact portable/full tests, counts, coverage, failures;
- runner group/workflow/label/environment/branch protection;
- ownership/modes/device/capacity;
- request/transaction IDs, control-plane/target, phases, cgroup outcomes, manifests/digests, controller, restoration/final state;
- recovery refs/objects/fsck;
- staging/backup states;
- cancellation/boot recovery;
- production/disposable demonstrations;
- exact-head CI/final review.

GitHub documentation reviewed:

- `https://docs.github.com/en/actions/reference/runners/self-hosted-runners`
- `https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access`
- `https://docs.github.com/en/rest/actions/self-hosted-runner-groups`
- `https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow`
- `https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments`
- `https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency`
- `https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job`
- `https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/monitor-and-troubleshoot`

Non-goals:

- hostile-code isolation;
- guaranteed malicious-root/VM/disk/network/systemd/resource-exhaustion recovery;
- autoscaling/ephemeral/JIT runners;
- persistent PAT/GitHub App credentials;
- fork/arbitrary-repository targets;
- parallel host mutation;
- proof of GitHub job scheduling before promotion;
- VM snapshot management by Agent Relay;
- general reversal of packages/credentials/databases/Docker volumes/application data;
- re-enabling Docker provisioning;
- pre-protocol temporary branches without rebase/merge;
- automatic breaking protocol migration.

## Interfaces and Dependencies

No public Agent Relay job API, Codex request/result, prompt, finalizer or workspace sandbox changes required.

Identities/registrations:

    recorded administrator: /etc/agent-relay/administrator
    primary user:           github-runner
    builder user:           agent-relay-builder
    deployment user:        agent-relay-deployer
    primary runner:         gh-runner
    deployment runner:      gh-deploy-runner
    primary label:          agent-relay-main
    deployment label:       agent-relay-deploy
    deployment group:       agent-relay-deployment

Services:

    actions.runner.Divorium.gh-runner.service
    actions.runner.Divorium.gh-deploy-runner.service
    agent-relay-deploy-transaction.service
    agent-relay-deploy-recover.service
    agent-relay-update@<transaction-id>.service or equivalent transient unit

Recovery unit is ordered before/requires primary startup. Deployment runner is independent so read-only status remains possible during critical recovery.

Submission helpers accept no arguments and read canonical JSON stdin. Admin recovery command is root/recorded-admin only and unavailable in deployer sudoers.

Request schema equivalent:

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

Mode derives from helper. Values validated against fetched repository state. No credential included.

Runtime manifest equivalent:

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

Exact serialization may differ but must be bounded, strict, credential-free and restart-sufficient.

Bounded constants/configuration include request bytes, drain/fetch/host-check/updater/health/primary/transaction/busy deadlines, TERM/KILL grace, disk headroom, status interval, raw/diagnostic bytes, retained transactions/runtime backups/generations/controllers.

Use existing pinned host tools where possible: Bash, Git, curl, jq, systemd, coreutils, Node.js, official runner. Add no third-party runtime dependency without recorded necessity.

Revision note (2026-07-21): Performed a fourth complete adversarial review. Added control-plane commit freshness for queued workflows; protected target objects in transaction refs before mutation; made clean-worktree behavior explicit; required same-filesystem and capacity validation for runtime staging; moved updater execution into a transient systemd cgroup; required primary and deployment service invariants; prevented managed builds from consuming unverified ignored dependencies; clarified boot ordering, status availability, lock sharing, and stale request outcomes. This revision changes only the active ExecPlan and does not claim implementation complete.