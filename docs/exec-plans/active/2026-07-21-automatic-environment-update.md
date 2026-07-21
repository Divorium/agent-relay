# Automate Agent Relay environment deployment and rollback

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current as work proceeds. Maintain this document in accordance with `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

The reviewed baseline is `main` commit `e9ec636e5abf383f8831fc126b99f04e2e005a3c`. Before implementation starts, verify that this commit exists and is an ancestor of `HEAD`. If `main` advances, recheck every current-state statement, path, workflow, runner contract, GitHub-setting assumption, package script, and referenced Docker decision. Update the baseline and record the review in `Progress`; do not silently implement against another revision.

Codex may use read-only Git commands such as `status`, `diff`, `show`, `grep`, `rev-parse`, `show-ref`, `cat-file`, and `merge-base`. Codex must not run `git add`, `commit`, `merge`, `rebase`, `reset`, `restore`, `checkout`, `cherry-pick`, or `push`; the GitHub runner owns commit and push. Workflow files and GitHub settings are human-maintained for this task. Codex must not edit `.github/workflows/` or `examples/github-actions/`.

## Purpose / Big Picture

Replace the current release procedure:

    cd /srv/github-runner/storage/agent-relay
    git pull --ff-only
    ./update.sh

with an observable deployment system for the single long-lived Agent Relay VM.

After this work:

- a merge into protected `main` is observed through its resulting `push`, the exact merge-result SHA is validated on GitHub-hosted infrastructure, and it is deployed only while both target and workflow-control commits remain current;
- a manual retry can deploy only current protected `main`;
- an authorized operator can select an open same-repository pull request, including a draft PR, or a same-repository branch, resolve it once to an exact SHA, validate it without using either self-hosted runner, and test that revision's real privileged `update.sh` on the real VM;
- a second persistent deployment runner remains independent of the compiled Agent Relay runtime and can submit or inspect a transaction while the primary runner is stopped or broken;
- the installed controller stops the primary listener, drains every active `github-runner` worker, and runtime-masks the primary service before changing the trusted checkout;
- managed target `update.sh` executes as root only inside a controller-created transient systemd unit, prepares a transaction-scoped runtime stage and explicitly allowed non-control-plane host changes, and never owns active-runtime activation or deployment state;
- the installed controller alone owns runtime backup, activation, journal transitions, accepted Git refs, service unmask/start, and restoration;
- the previously active runtime remains retained until acceptance or restoration is complete, including the first bootstrap before any LKG exists;
- the primary listener remains unavailable throughout a temporary-target test and LKG restoration, while a controller monitor detects accidental direct `Runner.Listener` or `Runner.Worker` launch;
- the controller executes runtime health as `github-runner` in a private-network, no-new-privileges systemd sandbox that bind-mounts only finalized runtime read-only and hides the source checkout;
- a failed `main` deployment attempts network-independent convergence to the previous locally retained last-known-good main revision;
- workflow cancellation does not terminate a post-mutation transaction because a root-owned systemd service, not the workflow shell, owns the transaction;
- deployment and restoration results are reported separately, and an explicit critical-recovery state is preserved whenever convergence cannot be proven.

Selected revisions are trusted same-repository code and execute with broad host authority because the purpose is to test the real privileged updater. This system provides **best-effort rollback for accidental failures**. It is not malicious-code isolation and is not a VM snapshot. A privileged target can defeat same-VM controls. Root ownership, runner groups, approvals, environment sanitization, cgroups, service masks, monitoring, and a second runner must never be described as protection from malicious privileged code.

The acceptance path deliberately does not claim that the primary registration has already accepted a GitHub job. Starting the primary listener during a temporary transaction would allow unrelated queued work to race onto the temporary runtime. Without retaining an organization-management credential for dynamic runner control, the transaction proves runtime identity and health locally, then starts the primary listener only after final state selection.

Temporary deployment validates updater/runtime behavior under the currently installed deployment protocol and may run an isolated controller-candidate compatibility self-test. It does **not** apply or accept fresh-install behavior, one-time migration, GitHub workflow/settings changes, runner-group/environment/ruleset changes, runner installation or registration changes, sudoers changes, systemd control-plane unit changes, or breaking controller protocol migrations. Those surfaces require deterministic system tests and disposable-VM acceptance.

This plan preserves the current Docker decision: `DOCKER_PROVISIONING_ENABLED=0` remains authoritative. The work must not re-enable Docker provisioning or reopen the separate design from PR #46.

## Progress

Keep this section append-only. Split partially completed work into a checked historical entry and a remaining unchecked entry. Every checked implementation item must identify a repository location plus passing automated evidence, or a reproducible command plus its captured result. Blocked items remain unchecked and use the `[blocked]` prefix required by `.agent/PLANS.md`.

- [x] (2026-07-21) Reviewed the current installation, updater, runner, CI, Codex, documentation, and package-script contracts on baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- [x] (2026-07-21) Confirmed that the primary runner cannot synchronously update itself because `update.sh` stops its listener and waits for every `Runner.Worker` owned by `github-runner`.
- [x] (2026-07-21) Reviewed GitHub persistent, ephemeral, JIT, registration-token, runner-label, runner-group, selected-workflow, workflow-dispatch, environment-review, concurrency-queue, and self-hosted update mechanisms.
- [x] (2026-07-21) Selected a second persistent deployment runner for the single long-lived VM instead of an ephemeral or JIT runner.
- [x] (2026-07-21) Converted the initial architecture notes into the living ExecPlan structure used by PR #3.
- [x] (2026-07-21) Performed twelve adversarial review passes. The revisions corrected checkout-before-drain, overstated recovery guarantees, ownership and authorization gaps, primary-dependent validation and smoke, workflow-lifetime coupling, bootstrap circularity, queue semantics, local LKG storage, reusable-workflow ambiguity, controller upgrade ordering, runtime staging, control-plane freshness, process containment, request admission, direct primary-start races, managed-updater authority, health sandboxing, lock cutover, workflow reruns, temporary-test scope, protected-control-plane drift, and self-hosted runner auto-update nondeterminism.
- [ ] Complete Milestone 0 and record actual GitHub-side feasibility evidence before implementation code is written.
- [ ] Revalidate the pinned baseline and all human-maintained workflow files immediately before implementation.
- [ ] Implement the stable deployment protocol, portable validation entrypoint, managed stage-only updater, controller-owned activation, runtime manifest and sandboxed health interface.
- [ ] Implement fresh-install and existing-host migration support for the deployment account, pinned runner installations, restricted group, controller services, recovery repository, state roots, and bootstrap-pending mode.
- [ ] Implement atomic request submission, root transaction lifetime, drain/mask/monitor, exact checkout, updater cgroup, control-plane validation, acceptance, restoration, cancellation survival, and boot recovery.
- [ ] Human reviewer: add direct main, temporary, bootstrap, and status workflows; route ordinary jobs only to `agent-relay-main`; configure the runner group, environments, ruleset, and concurrency.
- [ ] Add deterministic unit, contract, integration, and system coverage for every milestone and failure boundary.
- [ ] Run focused validation, complete repository validation, exact-head CI, and independent point-by-point review.
- [ ] Perform real-host migration and temporary/main demonstrations. Perform failed-main, cancellation, restart, checkout-corruption, bootstrap-failure, runner-upgrade, and controller-activation demonstrations on a disposable clone or snapshot-equivalent VM.
- [ ] Update `Outcomes & Retrospective`, append final evidence and a revision note, and move this same plan to `docs/exec-plans/completed/` only after every item is checked.

## Surprises & Discoveries

- Observation: changing the trusted checkout before primary workers finish can change scripts used by active jobs.
  Evidence: current Codex workflow executes resolver, launcher, and finalizer files directly from `/srv/github-runner/storage/agent-relay`.

- Observation: another runner process under the same `github-runner` UID would retain the updater self-wait deadlock.
  Evidence: the current wait condition identifies `Runner.Worker` by UID and process name, not by runner registration, label, service, or directory.

- Observation: a root-owned controller is not a security boundary against root-equivalent target code.
  Evidence: privileged target code can alter root-owned files, services, credentials, networking, recovery data, or the VM. Recovery claims must remain limited to accidental failure.

- Observation: the current updater lock is too narrow for deployment orchestration.
  Evidence: it starts inside `update.sh`, after future Git selection, and ends before external acceptance or restoration.

- Observation: exact-SHA validation cannot depend on the primary runner.
  Evidence: deployment and restoration must still work while primary is unavailable. Validation therefore runs on GitHub-hosted infrastructure.

- Observation: the complete current `npm run check` is not portable to a clean GitHub-hosted runner.
  Evidence: `check:toolchain` requires dedicated Java, Go, Rust, Codex, and filesystem locations. A portable check is required without weakening the complete host check.

- Observation: a transactional GitHub smoke job on primary creates a scheduling race.
  Evidence: once primary listener starts, any queued ordinary job matching `agent-relay-main` can be assigned before the intended smoke and could run against temporary runtime.

- Observation: the current updater removes active `dist` before replacement compilation succeeds.
  Evidence: a failed first bootstrap would otherwise destroy the only working runtime before an LKG exists.

- Observation: checkout SHA does not identify active runtime.
  Evidence: current `dist` contains no accepted-source manifest. Exact source and entrypoint digests must be produced and independently verified.

- Observation: current `origin/main` is not rollback state after a failed merge deployment.
  Evidence: the remote already points to the failed commit. A previous accepted object must be retained locally.

- Observation: storing only a SHA does not retain the Git object.
  Evidence: force-push, ref deletion, garbage collection, or production `.git` damage can make the object unavailable. A protected bare recovery repository is required.

- Observation: restoration must not require GitHub availability.
  Evidence: network or DNS failure may be part of the deployment incident.

- Observation: workflow cancellation is not a safe transaction lifetime boundary.
  Evidence: cancellation can terminate the invoking shell after checkout or runtime mutation. A root systemd service must continue independently.

- Observation: direct selected workflows are simpler than a reusable workflow plus custom OIDC verifier in this repository.
  Evidence: runner-group policy can list multiple exact workflows at `refs/heads/main`, and only jobs directly defined in selected workflows may use the group.

- Observation: protected-environment approval must finish before the deployment job enters shared concurrency.
  Evidence: an unresolved temporary approval could otherwise block automatic main deployment.

- Observation: GitHub concurrency can be released before the root transaction finishes.
  Evidence: workflow cancellation releases the job, while the root service continues. Subsequent jobs must use host status and lock as authority.

- Observation: bootstrap requires the deployment runner before an LKG exists.
  Evidence: migration must start the restricted runner in bootstrap-pending mode and accept only bootstrap/status requests.

- Observation: bootstrap failure needs a fallback that is not falsely called LKG.
  Evidence: migration must retain exact pre-bootstrap checkout object, runtime tree, and prior primary-service state.

- Observation: direct `git pull && ./update.sh` after migration would diverge runtime from accepted state.
  Evidence: later recovery could silently replace an unrecorded manual runtime. New managed updater must refuse direct invocation.

- Observation: controller upgrades cannot break the protocol understood by the currently installed controller.
  Evidence: updater, stage, manifest, request, journal, and candidate interfaces need backward compatibility. Breaking changes require a separate migration.

- Observation: unknown recovery state should block primary mutation, not the diagnostic channel.
  Evidence: the deployment runner exists specifically to report primary-runner failures.

- Observation: runner credential contents can legitimately change without changing runner identity.
  Evidence: acceptance should verify type, ownership, restrictive mode, and stable identity fields rather than raw credential hashes.

- Observation: queued workflow control code can become stale.
  Evidence: a run created from an older main commit can start after main advances. `controlPlaneSha` must equal current protected main before mutation.

- Observation: exact target object should enter protected recovery storage before mutation.
  Evidence: target checkout or production `.git` can be damaged after reset; the transaction still needs the exact object for deterministic handling.

- Observation: runtime staging rename is atomic only within one filesystem.
  Evidence: controller must compare device IDs and available capacity before drain.

- Observation: a transient systemd cgroup gives stronger accidental descendant control than a shell process group.
  Evidence: the updater unit can use `KillMode=control-group`, bounded TERM/KILL, and a verifiable inactive terminal state.

- Observation: automatic deletion of unknown pre-existing untracked files is unsafe.
  Evidence: preflight must reject unexpected tracked or nonignored untracked state. Restoration may clean only post-journal target debris and transaction-owned paths.

- Observation: persistent ignored `node_modules` can be stale.
  Evidence: managed build must use transaction build roots or pinned global tools and must not consume unverified source dependency cache.

- Observation: target updater cannot be authoritative for journal or active-runtime rename.
  Evidence: target code could fail between rename boundaries or report false state. Installed controller must observe and perform recovery-critical transitions.

- Observation: target updater can accidentally mutate checkout or active runtime while producing stage.
  Evidence: controller must verify exact HEAD, tracked cleanliness, nonignored debris, full active-runtime tree digest, service state, mask state, and control-plane digest after updater exits.

- Observation: two submission helpers can race before the transaction service acquires the host lock.
  Evidence: a root-only request lock and exclusive pending-request file are required before systemd service start.

- Observation: a normal service mask does not prevent direct runner-binary execution.
  Evidence: controller must monitor primary UID `Runner.Listener` and `Runner.Worker` processes while target code runs and re-drain before any further mutation after an unexpected start.

- Observation: temporary deployment cannot accept infrastructure changes that it does not activate.
  Evidence: installer, migration, workflow, runner registration, sudoers, systemd control-plane, and breaking controller changes require separate disposable-VM acceptance.

- Observation: `dist` is located inside the source checkout.
  Evidence: making checkout inaccessible would also hide runtime. Health sandbox must bind-mount finalized `dist` read-only to a separate path before hiding the original checkout.

- Observation: self-hosted runner software updates automatically by default.
  Evidence: GitHub documents `config.sh --disableupdate` for deterministic, operator-managed runner versions and requires disabled-update runners to be updated regularly. Automatic binary mutation would otherwise invalidate the protected-control-plane baseline. citeturn383438search0turn577599search1

## Decision Log

- Decision: use a second persistent organization runner on the same VM, not an ephemeral or JIT runner.
  Rationale: the host is long-lived and needs a channel independent of the primary runner process. Ephemeral lifecycle adds persistent API credentials and cleanup without VM isolation.
  Date/Author: 2026-07-21 / architecture review.

- Decision: describe restoration as best effort for accidental failures.
  Rationale: privileged target code can defeat every same-VM control.
  Date/Author: 2026-07-21 / adversarial review.

- Decision: use four direct workflows pinned to protected main: `deploy-main.yml`, `deploy-temporary.yml`, `deploy-bootstrap.yml`, and `deploy-status.yml`.
  Rationale: direct selected workflows remove reusable-caller ambiguity and custom authentication code.
  Date/Author: 2026-07-21 / workflow design.

- Decision: restrict deployment runner group to exactly those four workflow paths at `refs/heads/main`, selected repository `Divorium/agent-relay`, and label `agent-relay-deploy`.
  Rationale: only directly defined reviewed jobs may reach the privileged runner.
  Date/Author: 2026-07-21 / access-control review.

- Decision: complete temporary/bootstrap environment approval before deployment-job concurrency and reject `workflowRunAttempt != 1` for those modes.
  Rationale: repository write access alone must not authorize privileged code, unresolved approval must not block main, and a rerun must not reuse prior approval without a fresh dispatch.
  Date/Author: 2026-07-21 / authorization review.

- Decision: validate exact target on `ubuntu-latest`, pin every external action to a full commit SHA, declare minimum permissions, and set explicit job timeouts.
  Rationale: validation must not require either self-hosted runner, and workflow dependencies are part of the trust boundary.
  Date/Author: 2026-07-21 / validation review.

- Decision: keep deployment runner under locked `agent-relay-deployer` with no direct checkout or root-state write access.
  Rationale: the runner executes reviewed workflow shell and fixed no-argument helpers only. Root service owns mutation.
  Date/Author: 2026-07-21 / ownership review.

- Decision: use mode-specific no-argument submission helpers that read bounded canonical JSON from standard input, plus a read-only status helper.
  Rationale: mode derives from installed executable, not an untrusted option, and credentials need not be stored or passed.
  Date/Author: 2026-07-21 / request-boundary review.

- Decision: serialize submission with a root-only request lock and exclusive `pending-request.json` creation.
  Rationale: exactly one pending or active request may exist even when GitHub jobs start concurrently.
  Date/Author: 2026-07-21 / concurrency review.

- Decision: run the host transaction in a root-owned systemd service independent of workflow lifetime.
  Rationale: workflow cancellation or deployment-runner death must not interrupt safety after mutation begins.
  Date/Author: 2026-07-21 / cancellation review.

- Decision: use dedicated immutable `/var/lib/agent-relay-deploy/transaction.lock` for managed transaction and recovery.
  Rationale: the administrator file is identity configuration, not a durable mutex. Existing-host migration acquires both the legacy administrator-file lock and new managed lock during cutover; afterward new direct updater refuses, eliminating dual-lock mutation paths.
  Date/Author: 2026-07-21 / lock review.

- Decision: stop and boundedly drain all primary workers before checkout mutation, then runtime-mask primary for the entire mutation window.
  Rationale: active jobs consume checkout files and temporary code must never serve ordinary work.
  Date/Author: 2026-07-21 / isolation review.

- Decision: monitor primary service, mask, `Runner.Listener`, and `Runner.Worker` continuously while target updater runs.
  Rationale: a buggy privileged updater could launch runner directly. Detection terminates updater and requires stop, re-mask, and bounded re-drain before further mutation.
  Date/Author: 2026-07-21 / scheduling-race review.

- Decision: run Git mutation as the recorded administrator through the root controller.
  Rationale: the trusted checkout remains administrator-owned while deployment runner remains unable to write it.
  Date/Author: 2026-07-21 / ownership review.

- Decision: require `controlPlaneSha` to equal current protected `origin/main` for every mutating mode.
  Rationale: stale queued workflow code must not remain authoritative. Main/bootstrap target also equals current main; temporary target remains independently pinned.
  Date/Author: 2026-07-21 / freshness review.

- Decision: require a protected-main ruleset that mandates PRs for normal changes and blocks force push, deletion, and deployment-workflow bypass.
  Rationale: only under that policy does `push` to main represent an accepted merge result. Missing enforcement blocks this architecture.
  Date/Author: 2026-07-21 / branch-policy review.

- Decision: define a backward-compatible deployment protocol before managed deployment.
  Rationale: installed controller cannot safely execute a pre-protocol or breaking updater. Old temporary branches must merge/rebase the protocol baseline.
  Date/Author: 2026-07-21 / compatibility review.

- Decision: execute managed target updater as root only in `agent-relay-update@<transaction>.service` with fixed validated environment.
  Rationale: automation has no interactive sudo ticket. Root updater must not call `sudo`; compilation still runs as unprivileged builder.
  Date/Author: 2026-07-21 / authority review.

- Decision: make managed target updater a stage producer only.
  Rationale: installed controller alone must own journal and active-runtime activation. Updater may produce stage and declared non-control-plane host changes but may not modify runner services, control plane, active runtime, refs, or journal.
  Date/Author: 2026-07-21 / activation review.

- Decision: record deterministic full-tree digests for active runtime and protected deployment control plane before and after updater.
  Rationale: accidental in-place mutation must be detected before stage activation. Runtime digest covers path, type, UID, GID, mode, and file contents. Protected-control-plane digest uses an exact canonical inventory with explicitly allowed transaction-owned changes.
  Date/Author: 2026-07-21 / integrity review.

- Decision: restrict finalized active/staged runtime to regular files and directories.
  Rationale: symlinks and special files make hashing, activation, and recovery ambiguous.
  Date/Author: 2026-07-21 / filesystem review.

- Decision: disable automatic software updates for both self-hosted runners using supported `--disableupdate` registration.
  Rationale: deterministic runner binaries are part of the deployment control plane. Existing-host migration may re-register primary under the same stable name/labels while preserving home/work/Codex state, and records that numeric runner identity may change. GitHub requires disabled-update runners to be upgraded regularly, including within the documented support window. citeturn383438search0turn577599search1
  Date/Author: 2026-07-21 / runner-maintenance review.

- Decision: perform runner software upgrades only through an explicit administrator maintenance/migration procedure under managed lock.
  Rationale: target updater and temporary deployment must not mutate runner installations. The procedure updates pinned runner version/checksum, verifies both registrations/services, and must occur within GitHub's supported update window.
  Date/Author: 2026-07-21 / runner-maintenance review.

- Decision: run runtime health as `github-runner` in a separate sandboxed systemd unit.
  Rationale: health must prove unprivileged runtime readability without network, Codex credentials, source access, or persistent writes. The unit bind-mounts active runtime read-only to `/run/agent-relay-runtime` and makes the original checkout inaccessible.
  Date/Author: 2026-07-21 / health review.

- Decision: make recovery Git refs authoritative and metadata descriptive.
  Rationale: atomic refs retain accepted objects; metadata publication is journal-recoverable.
  Date/Author: 2026-07-21 / recovery review.

- Decision: use latest-only semantics for automatic main deployment.
  Rationale: stale target or stale control plane becomes `superseded` without mutation rather than downgrading host.
  Date/Author: 2026-07-21 / ordering review.

- Decision: accept only bootstrap and status before initial LKG, and reject every direct invocation of the new managed updater.
  Rationale: bootstrap is the only supported first mutation after migration. Direct mutation would invalidate pre-bootstrap fallback or accepted state.
  Date/Author: 2026-07-21 / transition review.

- Decision: validate compatible controller candidate before accepted refs; temporary mode may self-test candidate but never activate it.
  Rationale: active controller changes are part of main acceptance. Temporary test cannot alter deployment control plane.
  Date/Author: 2026-07-21 / controller-upgrade review.

- Decision: preserve deployment runner read-only status availability during critical recovery when its own service remains valid.
  Rationale: unknown recovery state should block primary and mutation without removing the diagnostic channel.
  Date/Author: 2026-07-21 / recovery-channel review.

- Decision: preserve `DOCKER_PROVISIONING_ENABLED=0`.
  Rationale: Docker-host provisioning is a separate design and remains out of scope.
  Date/Author: 2026-07-21 / scope review.

## Outcomes & Retrospective

This plan remains active. No installer, updater, controller, workflow, service, runner registration, GitHub setting, or production-host behavior has changed through plan-only commits.

The design now resolves the known circular dependencies: validation does not require primary, temporary health does not start primary, bootstrap has pre-LKG fallback, transaction lifetime is independent of workflow lifetime, controller alone activates runtime, prior runtime remains retained, request admission is atomic, managed lock cutover excludes legacy updater, and self-hosted runner binaries are deterministic rather than auto-mutating.

The remaining fundamental limitation is explicit: privileged target code can defeat same-VM recovery controls. Milestone 0 blocks implementation if the required GitHub controls cannot be enforced in the actual organization.

Update this section after every accepted milestone. On completion, state the final real-host and disposable-VM results and move this same plan to `completed` without replacing it with a summary.

## Context and Orientation

Current host contracts:

- `/srv/github-runner/storage/agent-relay`: administrator-owned checkout and root-owned `dist`;
- `/srv/github-runner/storage/work`, `runner`, and `home`: primary work, runner installation, and Codex home;
- `/srv/github-runner/storage/build` and `build-home`: builder state;
- `github-runner`: primary runner and Codex account, without sudo;
- `agent-relay-builder`: compiler account, without sudo;
- `/etc/agent-relay/administrator`: recorded administrator and legacy updater lock;
- `actions.runner.Divorium.gh-runner.service`: primary runner service.

Current `install.sh` is one-time. It installs pinned tools, creates accounts/directories, verifies official runner archive, obtains a short-lived registration token from an interactively supplied organization credential, configures primary, records administrator, and performs Codex login. It does not persist PAT.

Current `update.sh` is administrator-only, locks the administrator file, acquires sudo, stops primary, waits workers indefinitely, deletes and rebuilds active `dist`, starts primary, and leaves Docker provisioning disabled.

Current CI and Codex jobs use bare `[self-hosted]`. Every ordinary job must be routed to `agent-relay-main` before the deployment runner starts.

Expected managed layout is equivalent to:

    /srv/github-runner/storage/deploy-runner
    /srv/github-runner/storage/deploy-work
    /srv/github-runner/storage/deploy-home
    /srv/github-runner/storage/runtime-stage/
    /srv/github-runner/storage/runtime-backups/
    /var/lib/agent-relay-deploy/
      transaction.lock
      request.lock
      pending-request.json
      bootstrap-pending
      bootstrap-complete
      managed-mode
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

- **primary runner**: `gh-runner`, which executes ordinary CI/Codex only after final state selection;
- **deployment runner**: `gh-deploy-runner`, which executes only selected deployment/status workflows;
- **control-plane SHA**: commit containing workflow code used by request and required to equal current main before mutation;
- **portable validation**: GitHub-hosted checks that do not assume dedicated host paths;
- **protected deployment control plane**: exact inventory of runner installations/configuration, runner and controller units, controller/helper binaries, sudoers, managed locks, recovery configuration and schemas that target updater may not change;
- **deployment protocol**: versioned contract among controller, target updater, stage, manifest, candidate, and journal;
- **LKG**: `refs/agent-relay/current` in recovery repository;
- **pre-bootstrap state**: exact checkout, retained runtime, and prior primary-service state used only for failed bootstrap recovery;
- **sandboxed runtime health**: fixed network-free command run as `github-runner` against read-only bind-mounted runtime while checkout is hidden;
- **critical recovery**: mutation occurred and final accepted/restored state cannot be proven.

## Plan of Work

### Milestone 0: Prove GitHub-side feasibility

Verify on the actual organization/repository:

- organization runner group can be managed, allows this public repository, and restricts access to exactly four workflows at `refs/heads/main`;
- workflow restrictions are writable, not inherited read-only;
- installation credential has only permissions required for group, labels, runner registration, and inspection;
- protected environments/reviewers exist for temporary/bootstrap and the user accepts actual self-review and administrator-bypass behavior;
- main ruleset requires PRs for normal changes, blocks force push/deletion, and prevents bypass for deployment workflow changes;
- `queue: max` works and the 100-pending-job bound is acceptable;
- runner maintenance process can satisfy GitHub's disabled-update support window. citeturn577599search1

Missing required control is `[blocked]`; do not register/start privileged deployment runner.

### Milestone 1: Define stable protocol and portable validation

Revalidate baseline and current contracts.

Add a versioned protocol document equivalent to:

    schemaVersion: 1
    updaterControllerProtocol: 1
    runtimeManifestSchema: 1
    controllerCandidateSchema: 1
    protectedControlPlaneSchema: 1
    minimumControllerProtocol: 1
    maximumControllerProtocol: 1

Reject unsupported target before drain. Pre-protocol temporary branch must merge/rebase baseline. Breaking protocol requires separate migration.

Add `npm run check:portable` for hosted typecheck, tests, runtime build, shell/Node syntax, and portable system tests without dedicated host paths, Codex login, Docker daemon, PAT, or self-hosted runner. Keep complete `npm run check` and host toolchain checks.

Define fixed compiled runtime-health entrypoint and exact sandbox contract.

Define managed stage protocol: controller creates paths; root updater writes stage/build and explicitly allowed non-control-plane host state, finalizes manifest, and leaves active runtime, runner installations, systemd control-plane, controller state, refs, journal, locks, and masks unchanged.

Define canonical full-tree runtime digest and protected-control-plane inventory/digest. Exact allowed transaction-owned mutable records are listed individually; broad directory exclusions are prohibited.

### Milestone 2: Implement human-maintained workflows

Add four direct workflows. Pin all external actions to full commit SHAs, use minimum permissions, and set explicit timeouts.

- `deploy-main.yml`: `push` to main plus `workflow_dispatch` from main only; target/control-plane SHA = `github.sha`; GitHub-hosted portable validation; directly defined deployment job using selected group/label and shared `queue: max`; main submit/status.
- `deploy-temporary.yml`: `workflow_dispatch` from main only, attempt 1 only; resolve exact same-repo PR/branch, draft allowed; reject fork/tag/merge ref/URL/malformed/protocol; hosted validation; GitHub-hosted protected approval; directly defined deployment job after approval; temporary submit/status.
- `deploy-bootstrap.yml`: `workflow_dispatch` from main only, attempt 1 only; exact current main; hosted validation; protected approval; directly defined deployment job; bootstrap submit/status.
- `deploy-status.yml`: main-only dispatch; directly defined read-only deployment-runner status job, no target/concurrency/mutation.

Runner group allows exactly those four paths at main. No reusable workflow. Deployment jobs never checkout or execute target, expose persistent organization credential, or print raw updater output.

Canceled prior workflow may leave host busy. Next deployment job polls read-only status until idle or bounded expiry and never cancels/replaces the active host transaction.

Update current workflows/examples so no ordinary job retains bare `[self-hosted]`; ordinary jobs require `agent-relay-main`.

### Milestone 3: Install, migrate, pin runner versions, and enter bootstrap-pending

Fresh install and restartable existing-host migration must:

- create isolated deployment account/runner paths with no Codex login;
- register both runners with explicit labels and supported `--disableupdate`; existing primary may be re-registered under stable name during migration, preserving its home/work/Codex state while documenting that numeric runner identity can change;
- install pinned runner version/checksum for both registrations and validate version before services start;
- configure selected workflow group for deployment runner;
- install immutable controller versions, submission/status/admin/activation helpers, transaction/recovery units, recovery repository, stage/backup/state/log roots, and narrow sudoers;
- allow deployer only fixed submit/status helpers;
- keep PAT and registration/removal tokens in memory only;
- create managed transaction lock once as root-owned regular non-symlink;
- acquire legacy administrator-file lock and managed lock together during existing-host cutover, prove no legacy updater or managed transaction, then install new updater/bootstrap-pending while both remain held;
- make new updater refuse direct invocation, eliminating dual-lock mutation after cutover;
- initialize recovery repository without inventing LKG;
- require clean administrator-owned exact current main and reject tracked/unexpected nonignored state;
- import `bootstrap-source`, record primary service state and runtime fallback, validate regular-only runtime tree, filesystem/capacity, and protected-control-plane baseline;
- start deployment runner in bootstrap-pending, accept only bootstrap/status;
- write bootstrap-complete/managed-mode only after successful bootstrap.

Failed bootstrap restores pre-bootstrap source/runtime/service, remains pending, and creates no LKG.

Add explicit administrator runner-maintenance command. It acquires managed lock with both runners drained/stopped, installs new pinned runner archive/checksum, validates registrations/services, preserves homes/workspaces, and restarts. Documentation requires execution within GitHub's supported disabled-update window. citeturn577599search1

### Milestone 4: Implement atomic submission and independent transaction lifetime

Mode helper accepts no arguments and reads bounded canonical JSON safely generated by trusted workflow. It acquires request lock, validates schema/repository/SHA/source/run/audit/control-plane fields, rejects unknown/control characters/state conflicts, requires attempt 1 for temporary/bootstrap, and exclusively creates/fsyncs pending request before starting transaction service.

Service claims pending request into journal while holding managed lock. Start failure removes only caller-owned pending file. Stale pending recovery is deterministic and validates owner/mode/content.

Selected workflow plus locked deploy account is authentication boundary. Root transaction service owns lock, journal, Git, updater cgroup, stage activation, acceptance/restoration, and result. Workflow loss does not kill it. Status is bounded and read-only. Service uses fixed protected environment and inherits no workflow token.

Boot recovery is required before primary startup but independent of deployment runner. Unknown state keeps primary/mutation blocked while status remains available when deployment runner itself is valid.

### Milestone 5: Implement host transaction

Preflight under managed lock:

1. validate request/mode/protocol/checkout owner/remote/config/no submodule/alternate worktree/recovery refs/controller/journal/lock;
2. require clean tracked state and no unexpected nonignored untracked files;
3. fetch expected source ref into transaction namespace as administrator with hooks disabled;
4. verify object equals target and supports protocol;
5. import exact object into recovery transaction ref;
6. fetch current origin/main; require control-plane SHA current for all modes; main/bootstrap target current; stale main `superseded`, stale temporary/bootstrap fail;
7. verify LKG or bootstrap fallback;
8. verify same filesystem, capacity, paths, ownership, modes, and no symlinks;
9. run installed host compatibility checks only;
10. calculate deterministic active-runtime digest and protected-control-plane digest.

Drain/isolation:

1. journal prior primary state;
2. stop primary and boundedly drain workers;
3. timeout restores prior state and mutates nothing;
4. runtime-mask primary and verify no listener/worker;
5. journal durable drained state;
6. monitor mask/service/listener/worker while updater runs; violation terminates updater and requires stop/re-mask/re-drain before further mutation.

Managed updater/staging:

1. reset/clean tracked checkout to exact target as administrator and verify owner/HEAD;
2. create transaction build/stage roots;
3. start exact administrator-owned regular non-symlink target updater as root in transient `agent-relay-update@id.service` with fixed validated environment, no workflow credentials, no sudo, and builder subprocess;
4. updater may produce stage and protocol-declared non-control-plane host changes only;
5. wait for updater cgroup inactivity with TERM/KILL escalation;
6. require primary masked/inactive, no primary processes, deployment service unchanged, exact clean checkout, active-runtime digest unchanged, protected-control-plane digest unchanged except exact journal-owned allowed transitions;
7. verify finalized stage regular-only tree, manifest, digests, owner/mode, and clean dependency provenance;
8. controller journals stage, renames active runtime to backup, journals, renames stage active, journals;
9. verify active manifest/tree;
10. run health transient unit as `github-runner` with `PrivateNetwork=yes`, `NoNewPrivileges=yes`, `PrivateTmp=yes`, temporary HOME, original checkout inaccessible, and active runtime bind-mounted read-only at `/run/agent-relay-runtime`;
11. retain prior runtime backup until terminal state.

Main acceptance:

- stage/self-test compatible controller candidate and provisionally switch before accepted refs;
- verify transaction object;
- atomically update previous/current/generation refs and journal metadata;
- remove primary mask only after accepted runtime/controller/refs complete;
- start primary and verify stable listener, expected registration identity/labels/version, and credential metadata;
- failure after start requires stop/re-mask/re-drain before reverting refs/controller/checkout/runtime; inability to drain enters critical recovery;
- final consistency and bounded retention required.

Temporary:

- record target health, never change accepted refs;
- run controller-candidate isolated self-test only, never switch;
- keep primary masked;
- restore LKG checkout, run LKG managed stage updater, controller activation, manifest and sandboxed health;
- safely unmask/start primary after LKG complete;
- report target/restoration separately; unproven restoration is critical.

Bootstrap:

- start with bootstrap-source/runtime fallback and no LKG;
- deploy exact current main through stage/activation/health;
- validate compatible candidate before refs;
- create current+generation, leave previous absent;
- safely start primary and write bootstrap-complete/managed-mode last;
- any failure restores fallback and remains pending.

### Milestone 6: Implement updater, activation, recovery, runner maintenance, and controller upgrade

New updater has no direct mutation mode. Before migration old baseline updater remains legacy. Once new code is checked out, direct invocation always refuses with migration/bootstrap/deployment/recovery instruction.

Controller invokes root managed stage-only mode using exact fixed environment. Updater does not call sudo; builder remains unprivileged; no source dependency cache; finalized manifest required; Docker disabled.

Recovery refs current/previous/bootstrap-source/transactions/generations update atomically and retain objects. Offline recovery restores source, runs stable stage updater, controller activation, sandboxed health, controller, then safe primary start. Emergency Git reconstruction is allowed. Valid LKG runtime backup may be started only as explicit degraded critical action if stable updater fails; journal remains.

Controller candidates use immutable version directories and atomic symlink switch, validate before refs, and remain protocol-compatible. Temporary mode only self-tests. Breaking migration is separate.

Runner binaries are outside target updater scope. Runner upgrades use the explicit maintenance command under managed lock, update pinned version/checksum, and satisfy GitHub's documented update requirement for disabled-update runners. citeturn577599search1

### Milestone 7: Complete documentation and acceptance

Document hosted validation, direct workflows, PR-only main, approvals/fresh attempts, temporary scope, control-plane freshness/digest, bootstrap, lock cutover, atomic admission, queue/busy, drain/mask/monitor/cgroup, root stage updater/controller activation, runtime digest/manifest, bind-mounted health sandbox, latest-main, direct updater refusal, recovery/critical state, controller and runner maintenance, bounded logs, Docker disabled, and best-effort limitation.

Run focused and complete tests, exact-head CI, independent review, real-host migration/temporary/main demonstrations, and disposable-VM failure/restart/bootstrap/controller/runner-maintenance demonstrations. Keep plan active until every item has evidence.

## Concrete Steps

Run repository commands from repository root. Codex performs no Git mutation and does not edit human-maintained workflows.

Baseline verification:

    git cat-file -e e9ec636e5abf383f8831fc126b99f04e2e005a3c^{commit}
    git merge-base --is-ancestor e9ec636e5abf383f8831fc126b99f04e2e005a3c HEAD
    git status --short
    git diff --name-status e9ec636e5abf383f8831fc126b99f04e2e005a3c...HEAD
    git grep -n 'DOCKER_PROVISIONING_ENABLED=0' e9ec636e5abf383f8831fc126b99f04e2e005a3c -- update.sh
    git diff --exit-code e9ec636e5abf383f8831fc126b99f04e2e005a3c -- .agent/PLANS.md .github/workflows examples/github-actions

Milestone 0 evidence must show actual group/repository/workflow restrictions, environments/review/bypass, PR-only main ruleset, concurrency support, installation credential permissions, and accepted runner-maintenance schedule.

Portable validation:

    npm ci
    npm run check:portable

Focused implementation validation must include equivalent commands:

    bash -n install.sh update.sh scripts/*.sh test-system/*.sh
    npm run build
    node --test dist/test/deployment-protocol.test.js
    node --test dist/test/deployment-controller.test.js
    node --test dist/test/deployment-state.test.js
    node --test dist/test/deployment-resolver.test.js
    node --test dist/test/runtime-manifest.test.js
    node --test dist/test/protected-control-plane.test.js
    bash test-system/deployment-install.integration.sh
    bash test-system/deployment-migration.integration.sh
    bash test-system/deployment-transaction.integration.sh
    bash test-system/deployment-recovery.integration.sh
    bash test-system/runner-maintenance.integration.sh

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

Real-host migration/bootstrap demonstrates labels/group, both runners on pinned `--disableupdate` version, no Codex on deployer, dual-lock cutover, pending normal rejection, direct updater refusal, ownership/modes, no retained tokens, device/capacity, protected-control-plane baseline, exact-current-main bootstrap, stage/activation/manifest/sandboxed health, safe primary start, current ref, previous absent, and markers written last.

Production demonstrations:

1. temporary success with primary masked, controller candidate self-test only, and restoration;
2. target updater failure preserving runtime and restoring LKG;
3. drain timeout with no mutation;
4. stale target/control-plane with no mutation;
5. successful main acceptance;
6. direct updater refusal;
7. workflow cancellation while root transaction completes/restores;
8. status for active/terminal transaction;
9. unexpected untracked block;
10. updater control-plane/runtime/checkout/service/mask mutation detection;
11. concurrent submission admitting one pending request;
12. direct main push blocked by ruleset;
13. direct primary listener launch detected and safely re-drained;
14. health sandbox proves runtime access but no network/source/persistent home/Codex credentials;
15. managed root updater works without sudo and rejects missing protocol;
16. temporary/bootstrap rerun rejected and fresh dispatch re-approval required;
17. migration cannot cut over while legacy updater or managed transaction lock is held;
18. explicit runner maintenance upgrades pinned versions and returns both registrations healthy.

Disposable demonstrations cover bootstrap failure before/after activation, failed main offline restoration, kill at every rename phase, boot recovery, Git reconstruction, candidate switchback, incompatible protocol, double failure, cgroup descendants, disk/device failure, in-place runtime mutation, stale pending request, invalid tree shape, bootstrap direct-refusal, managed-lock tamper, protected-control-plane mutation, and runner-maintenance interruption/recovery.

## Validation and Acceptance

Acceptance categories:

- actual GitHub feasibility, selected workflow routing, PR-only main, action pins, permissions, and timeouts;
- exact hosted portable validation, approval before concurrency, fresh privileged attempts, and control-plane freshness;
- atomic admission, dual-lock migration cutover, managed serialization, and queue overflow visibility;
- clean checkout and bounded cleanup ownership;
- primary drain, mask, process monitor, and guarded re-drain;
- ownership and managed root updater authority;
- stage-only protocol, runtime and protected-control-plane digest invariants;
- regular-only runtime shape, staged activation, cgroup termination;
- bind-mounted private-network health sandbox;
- temporary isolation and explicit limited acceptance scope;
- bootstrap fallback and current-only initial LKG;
- main atomic acceptance/revert;
- pinned disabled-update runner installations and explicit maintenance;
- listener readiness without claiming a scheduled job;
- cancellation, boot recovery, offline recovery, and critical-state preservation;
- bounded logging.

Outcome semantics:

- superseded main: workflow success, no mutation;
- successful main: accepted success;
- failed main with healthy restoration: workflow failure, host healthy at prior LKG;
- successful temporary target plus healthy restoration: workflow success only for documented updater/runtime scope;
- failed temporary target plus healthy restoration: workflow failure, host healthy at LKG;
- stale or rerun temporary/bootstrap: workflow failure without mutation;
- unproven restoration: workflow failure with critical recovery.

Completion requires every unchecked `Progress` item checked with evidence, focused and complete tests passing, exact-head CI passing, independent review with no unresolved action point, and all production/disposable demonstrations passing.

## Idempotence and Recovery

Fresh installation remains one-time. Setup and migration classify absent, exact, partial, and conflicting states and compensate only attempt-owned resources.

Existing-host migration is restartable. Dual-lock cutover prevents overlap with legacy updater or managed transaction. Runner re-registration with `--disableupdate` preserves home/work/Codex state but may change numeric runner identity; partial registration states are detected and resumed or failed closed.

Submission uses request lock and exclusive pending file. Reused request IDs with different content fail. Status is read-only.

Managed transaction lock is root-owned regular non-symlink, created once and never replaced. Controller verifies device/inode/owner/mode at start and after target updater.

Root journal uses strict bounded schema, durable temporary replacement, and atomic rename. It records request, control-plane/target refs, primary mask/monitor/drain, checkout, updater and health units, runtime/control-plane digests, stage/activation, candidate, accepted refs, start, restoration, and terminal outcome.

Target updater never writes journal. Controller derives observed state independently before phase transitions.

Runtime states old-active, stage-only, backup-without-active, and new-active-plus-backup are distinguishable. Invalid tree shapes fail.

Accepted refs update atomically. Metadata is separately journaled. Bootstrap creates current only. Transaction/generation refs prevent pruning.

Recover never retries target. It converges to pre-bootstrap fallback or LKG, keeps primary unavailable while mutating, restores source/runtime/controller, runs sandboxed health, safely starts primary, and archives journal only after success.

Unknown state blocks primary and mutation but allows read-only status when possible. Local administrator repair is required.

Direct unmanaged mutation is prohibited. Emergency repair is explicit, recorded, and followed by accepted-main or rebootstrap reconciliation.

Tests use temporary roots, local Git repositories, fake systemd/process/service adapters, fake runner registrations, and deterministic barriers. They do not mutate real GitHub settings or production host and do not require external network.

## Artifacts and Notes

Keep evidence append-only.

- 2026-07-21: Reviewed baseline repository and GitHub runner/deployment contracts.
- 2026-07-21: Created draft PR #47 with an active plan only and converted it to the PR #3 living structure.
- 2026-07-21: Performed twelve adversarial review passes and revised the plan as recorded in `Progress`.

Required future evidence includes GitHub settings, baseline hashes, exact tests/counts/coverage, runner group/workflows/environments/ruleset, runner versions and update policy, locks/cutover, ownership/device/capacity, admission, runtime/control-plane digests, health sandbox, phases/cgroups/restoration, recovery refs/fsck, cancellation/boot, demonstrations, exact-head CI, and final independent review.

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
- guaranteed recovery from malicious root, VM, disk, network, systemd, or resource-exhaustion failure;
- autoscaling or ephemeral/JIT runners;
- persistent PAT or GitHub App credentials;
- fork or arbitrary-repository targets;
- parallel host mutation;
- proof of GitHub job scheduling before promotion;
- VM snapshot management by Agent Relay;
- general reversal of package, credential, database, Docker-volume, or application-data mutation;
- re-enabling Docker provisioning;
- testing pre-protocol branches without rebase/merge;
- automatic breaking protocol migration;
- temporary activation or acceptance of infrastructure/control-plane changes.

## Interfaces and Dependencies

No public Agent Relay job API, Codex request/result contract, prompt contract, finalizer decision, or workspace sandbox interface changes are required.

Required identities and registrations:

    administrator: /etc/agent-relay/administrator
    primary: github-runner / gh-runner / agent-relay-main
    builder: agent-relay-builder
    deployer: agent-relay-deployer / gh-deploy-runner / agent-relay-deploy
    deployment group: agent-relay-deployment

Both runner registrations use a pinned runner version and `--disableupdate`. Runner version/checksum and maintenance deadline are documented state.

Required services:

    actions.runner.Divorium.gh-runner.service
    actions.runner.Divorium.gh-deploy-runner.service
    agent-relay-deploy-transaction.service
    agent-relay-deploy-recover.service
    agent-relay-update@<transaction-id>.service
    agent-relay-health@<transaction-id>.service

Recovery is required before primary startup; deployment runner remains independent for status.

Submission helpers accept no arguments and canonical JSON over stdin. Administrator recovery and runner maintenance are unavailable in deployer sudoers.

Request schema is equivalent to:

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

Mode derives from helper. Values are revalidated against Git. No credential is included. Temporary/bootstrap require attempt 1.

Managed updater environment is equivalent to:

    AGENT_RELAY_UPDATE_MODE=controller-stage-v1
    AGENT_RELAY_TRANSACTION_ID=<validated-id>
    AGENT_RELAY_BUILD_ROOT=<controller-created-path>
    AGENT_RELAY_RUNTIME_STAGE=<controller-created-path>
    AGENT_RELAY_EXPECTED_SOURCE_SHA=<target-sha>

Updater runs as root only in controller-created transient unit, does not call sudo, writes stage and declared non-control-plane host state only, and leaves active runtime, runner installations, systemd control plane, controller, journal, refs, lock, and mask unchanged.

Runtime manifest is equivalent to:

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

Protected-control-plane schema defines exact canonical inventory and allowed mutable transaction records. It includes pinned runner binaries and registration identity/configuration, relevant systemd units, controller/helper binaries and symlink target, sudoers, managed lock metadata, recovery refs/configuration, and root state schemas. Volatile `_work`, `_diag`, transaction logs/results, and credential contents are not blindly hashed; they are either excluded explicitly or validated through exact type/ownership/mode/identity rules. Secrets are never logged or exported.

Journal includes request, mode, control plane, target, transaction refs, previous state, controller version, primary state/mask/monitor, updater/health units, runtime and protected-control-plane digests, stage/backup, phases, results, final state, log path, and timestamps. Exact serialization may differ but must be bounded, strict, credential-free, and restart-sufficient.

Bounded configuration includes request, validation, approval, drain, fetch, host, updater, health, primary, transaction, busy deadlines, monitor interval, TERM/KILL grace, disk headroom, status polling, log limits, and retention of requests/results/transactions/backups/generations/controllers.

Use pinned existing host tools where possible. Add no third-party runtime dependency without recorded necessity.

Revision note (2026-07-21): Twelfth adversarial review restored the full living-ExecPlan evidence and decision format and resolved runner auto-update nondeterminism. Both self-hosted runners are now pinned with `--disableupdate`; existing-host migration may re-register primary under its stable name while preserving home/work/Codex state; and an explicit managed-lock runner-maintenance procedure must keep both runners inside GitHub's supported update window. Plan only; implementation is not complete.