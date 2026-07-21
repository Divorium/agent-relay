# Automate Agent Relay environment deployment and rollback

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current while work proceeds. Maintain this document according to `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

The reviewed baseline is `main` commit `e9ec636e5abf383f8831fc126b99f04e2e005a3c`. Before implementation starts, verify that this commit exists and is an ancestor of `HEAD`. If `main` advances, recheck every current-state statement, path, workflow, runner contract, GitHub-setting assumption, package script, and Docker decision. Update the baseline and record the review in `Progress`; do not silently implement against another revision.

Codex may use read-only Git commands such as `status`, `diff`, `show`, `grep`, `rev-parse`, `show-ref`, `cat-file`, and `merge-base`. Codex must not run `git add`, `commit`, `merge`, `rebase`, `reset`, `restore`, `checkout`, `cherry-pick`, or `push`; the GitHub runner owns commit and push. Workflow files and GitHub settings are human-maintained. Codex must not edit `.github/workflows/` or `examples/github-actions/`.

## Purpose / Big Picture

Replace the current manual release procedure:

    cd /srv/github-runner/storage/agent-relay
    git pull --ff-only
    ./update.sh

with a controlled deployment system for the single long-lived Agent Relay VM.

After this work:

- a merge into protected `main` triggers validation of the exact pushed SHA and deployment only when that SHA is still current at transaction start;
- an authorized operator can manually select a same-repository branch, resolve it once to an exact SHA, validate it, run that revision's real managed `update.sh`, and always restore the host to the unchanged last-known-good `main` revision;
- the controller stops the primary listener and drains active `github-runner` workers before changing the trusted checkout;
- a second persistent deployment runner remains available for accidental failures of the primary runner, runtime, updater, or checkout that do not disable the whole VM;
- the root-owned controller is the only owner of Git mutation, updater execution, runtime activation, accepted state, restoration, and transaction recovery;
- failed `main` deployment attempts restore the previous locally retained LKG without requiring GitHub connectivity;
- workflow cancellation cannot abandon a post-mutation transaction because a root-owned systemd service owns the host transaction;
- results distinguish validation failure, superseded request, drain failure, target failure, restoration success, restoration failure, and critical recovery.

Selected branches are trusted same-repository code and execute with broad host authority because the purpose is to test the real privileged updater. The system provides **best-effort rollback for accidental failures**, not isolation from malicious code and not a VM snapshot. A malicious root-equivalent target can damage the controller, deployment runner, recovery data, credentials, operating system, Docker data, or VM. Runner groups, approvals, ownership, cgroups, masks, hashes, and a second runner are not a malicious-root boundary.

The feature proves local runtime and primary-listener readiness. It does not claim that GitHub has already scheduled and completed a post-deployment job. Achieving that guarantee without allowing unrelated queued work to race the smoke job would require a separate runner-registration or dynamic-routing design and is outside this plan.

Temporary branch testing covers updater and runtime behavior under the already installed deployment protocol. It does not apply fresh-install changes, migration changes, GitHub workflow/settings changes, runner registration changes, sudoers changes, or breaking controller-protocol changes. A temporary branch requiring those changes is rejected as unsupported rather than reported as fully tested.

`DOCKER_PROVISIONING_ENABLED=0` remains authoritative. This plan must not re-enable Docker provisioning or reopen PR #46.

## Progress

Keep this section append-only. Checked implementation items require a repository location plus passing automated evidence, or a reproducible command plus captured result. Blocked items remain unchecked and use `[blocked]`.

- [x] (2026-07-21) Reviewed installation, updater, runner, CI, Codex, documentation, and package scripts on baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- [x] (2026-07-21) Confirmed that the primary runner cannot synchronously update itself because the updater stops its listener and waits for all `github-runner` workers.
- [x] (2026-07-21) Reviewed GitHub runner groups, selected-workflow restrictions, environments, manual dispatch, rerun identity, and concurrency queueing.
- [x] (2026-07-21) Selected a second persistent deployment runner instead of ephemeral or JIT creation.
- [x] (2026-07-21) Converted the plan to the repository living ExecPlan structure.
- [x] (2026-07-21) Performed repeated adversarial reviews that corrected checkout-before-drain, overstated recovery guarantees, weak LKG storage, ambiguous transaction ownership, missing exact-SHA validation, queue replacement, workflow-ref handling, manual authorization, controller upgrade, cancellation, bootstrap, runtime staging, updater authority, and Docker scope.
- [x] (2026-07-21) Twelfth adversarial review removed unrequested PR targeting, reduced the workflow design, separated immutable control-plane verification from mutable runner/state checks, added explicit infrastructure-schema gating, preserved an administrator recovery path through the controller, and replaced credential-bearing health execution with a dedicated sandboxed health account.
- [ ] Complete Milestone 0 with evidence from the actual GitHub organization before implementation.
- [ ] Revalidate the baseline and human-maintained workflow files immediately before implementation.
- [ ] Implement the versioned deployment protocol, portable validation, stage-only updater mode, runtime manifest, health command, and infrastructure-schema gate.
- [ ] Implement fresh installation and existing-host migration for the deployment runner, controller, recovery repository, state, runtime staging, health account, and bootstrap.
- [ ] Implement submission, independent systemd transaction ownership, drain, checkout, update, activation, validation, acceptance, restoration, cancellation recovery, and boot recovery.
- [ ] Human reviewer: add the two deployment workflows, route all ordinary self-hosted jobs to `agent-relay-main`, and configure runner group, environment, ruleset, and concurrency.
- [ ] Add deterministic tests, run full validation and exact-head CI, perform independent review, and execute production/disposable-VM demonstrations.
- [ ] Complete `Outcomes & Retrospective`, append final evidence, and move this same plan to `completed` only when every item is checked.

## Surprises & Discoveries

- Active jobs execute scripts from the trusted checkout; listener stop and worker drain must happen before `git reset`.
- A second runner under the same `github-runner` UID would retain the updater self-wait deadlock.
- Root-equivalent target code defeats every same-VM protection; rollback is best effort only.
- The current updater lock starts too late and ends too early for deployment orchestration.
- Exact target validation must not depend on the primary self-hosted runner that deployment may need to stop or repair.
- Current CI does not validate a `push` merge result on `main`; deployment needs an exact-SHA portable validation job.
- GitHub concurrency defaults retain only one pending run; `queue: max` is required and supports at most 100 pending runs.
- Queue order is based on when a run starts waiting, not dispatch time; every automatic request must recheck that its SHA is still current.
- `workflow_dispatch` can be invoked against a non-main ref; the workflow must reject it.
- Workflow reruns retain the original actor, SHA, and ref; temporary deployment must reject `github.run_attempt != 1` and require a fresh dispatch and approval.
- A plain LKG SHA file does not preserve its Git object. Recovery requires a local bare repository and protected LKG ref.
- The current checkout SHA does not prove which revision built active `dist`; bootstrap must redeploy and validate one exact main SHA before publishing LKG.
- The current updater deletes active `dist` before replacement is proven. Managed mode needs a stage and retained previous runtime.
- The deployment job cannot safely own host recovery after cancellation; it must submit a durable request to a root-owned service and poll status.
- Hashing entire live runner directories is unstable because runner diagnostics, work files, and credentials are mutable. Immutable control-plane files, runner identity metadata, and mutable state transitions require separate validation.
- Hashing or exporting runner credential contents is unnecessary and unsafe. Credential files are checked only for expected type, owner, mode, and location.
- Health execution as `github-runner` would expose its home and registration material. Runtime readability is checked as `github-runner`, while executable health runs under a dedicated locked account in a systemd sandbox.
- Temporary branch mode was requested for a manual branch, not for PR selection. PR-number and draft-PR semantics are outside scope.
- A commit may require an installed infrastructure migration even when runtime code itself validates. Automatic and temporary deployment must compare declared required host schema with installed host schema before drain.
- Direct `update.sh` mutation outside the controller would desynchronize journal, runtime backup, and LKG. The administrator recovery path must invoke controller-owned managed update rather than bypass it.

## Decision Log

- Decision: use a second persistent organization runner on the same VM.
  Rationale: the host is long lived and requires a recovery path independent of the primary runner process; ephemeral creation adds persistent API credentials and lifecycle complexity without VM isolation.
  Date/Author: 2026-07-21 / operator-approved architecture.

- Decision: support automatic current-`main` deployment and manual same-repository **branch** testing only.
  Rationale: this matches the operator request. PR-number, draft-state, merge-ref, tag, arbitrary SHA, fork, and arbitrary repository inputs are unnecessary and increase resolver scope.
  Date/Author: 2026-07-21 / scope correction.

- Decision: use two direct human-maintained workflows from protected `main`: `deploy-main.yml` and `deploy-branch.yml`.
  Rationale: one workflow handles push and manual retry of current main; one handles approved temporary branch testing. Bootstrap is an administrator migration operation, and status is available through the deployment job summary and local read-only controller command. Additional privileged workflows are unnecessary.
  Date/Author: 2026-07-21 / simplification review.

- Decision: restrict the deployment runner group to `Divorium/agent-relay`, public repository access, and those two workflow paths pinned to `refs/heads/main`; route it with `agent-relay-deploy`.
  Rationale: labels alone are not an access boundary. Milestone 0 must prove these controls are available and writable before the runner is installed.
  Date/Author: 2026-07-21 / GitHub access review.

- Decision: use GitHub-hosted Linux for exact-SHA portable validation.
  Rationale: validation must still run when the primary runner is broken or stopped and must not execute unaccepted branch code on another privileged self-hosted runner. The existing complete host-specific checks remain required in repository CI and disposable-host acceptance.
  Date/Author: 2026-07-21 / validation correction.

- Decision: temporary approval occurs in a GitHub-hosted approval job before the privileged job enters shared job-level concurrency.
  Rationale: an environment attached directly to a queued privileged job may hold the deployment queue while waiting for a reviewer. The approval job references the protected environment; the subsequent deploy job uses the common concurrency group.
  Date/Author: 2026-07-21 / workflow-ordering correction.

- Decision: configure the two privileged deploy jobs with the same job-level concurrency group, `queue: max`, and no `cancel-in-progress: true`.
  Rationale: GitHub supports up to 100 pending items and processes them according to queue-entry order, but ordering is not guaranteed from event dispatch. The host lock and current-main check remain authoritative.
  Date/Author: 2026-07-21 / queue review.

- Decision: reject temporary runs unless `github.ref == refs/heads/main`, `github.run_attempt == 1`, the environment was approved, and the actor is in the root-owned operator allowlist.
  Rationale: a same-repository branch is privileged code. Fresh dispatch prevents a previously approved run from being replayed after its context is stale.
  Date/Author: 2026-07-21 / authorization review.

- Decision: the root-owned controller owns the entire host transaction.
  Rationale: drain, Git mutation, updater execution, activation, state publication, restoration, and recovery require one lock, one journal, and one restart owner.
  Date/Author: 2026-07-21 / transaction design.

- Decision: stop the primary listener, wait a bounded time for existing `Runner.Worker` processes, and mutate nothing if drain fails.
  Rationale: active jobs read the checkout. The controller must not kill them automatically. On timeout it restarts the listener and exits with checkout and runtime unchanged.
  Date/Author: 2026-07-21 / safety review.

- Decision: run Git as the recorded administrator and keep the deployment account unable to write checkout, root state, controller files, or recovery data.
  Rationale: this preserves the existing checkout ownership contract. The deployment account may invoke only fixed no-argument submission/status helpers through sudo.
  Date/Author: 2026-07-21 / ownership review.

- Decision: introduce a versioned managed updater protocol.
  Rationale: automated execution cannot depend on interactive sudo. In controller mode, root runs the target updater inside a transient systemd unit with a fixed sanitized environment. The updater builds only into a controller-provided stage and declares supported non-control-plane host operations. The controller, not the updater, activates runtime or writes deployment state.
  Date/Author: 2026-07-21 / updater boundary review.

- Decision: preserve an administrator recovery command that routes through the controller.
  Rationale: disabling all manual update ability would regress the current operational contract. The recorded administrator can invoke a controller command such as `agent-relay-deploy admin-update-current-main`; it performs the same lock, drain, validation, staging, activation, and recovery rules. Direct unmanaged `./update.sh` refuses after migration.
  Date/Author: 2026-07-21 / recovery-path correction.

- Decision: declare `requiredHostSchema` and deployment protocol versions in repository metadata.
  Rationale: temporary branches cannot test installer, runner, unit, sudoers, or breaking controller changes. If target requirements exceed installed schema or protocol compatibility, the controller rejects before drain. Current-main deployment reports `migration_required` and leaves LKG active until the administrator runs an explicit migration.
  Date/Author: 2026-07-21 / infrastructure-scope correction.

- Decision: store accepted Git objects in a root-owned bare recovery repository with `refs/agent-relay/last-known-good`.
  Rationale: rollback must not depend on `origin/main`, GitHub availability, or retention of an unreferenced object in the production checkout.
  Date/Author: 2026-07-21 / recovery design.

- Decision: stage runtime on the same filesystem, retain the previous active runtime, and use journaled rename steps.
  Rationale: directory replacement is not a cross-directory atomic transaction. With the primary stopped, ordered same-filesystem renames plus a durable journal make every crash state distinguishable and recoverable without claiming impossible multi-directory atomicity.
  Date/Author: 2026-07-21 / activation correction.

- Decision: validate immutable control-plane files separately from mutable runner and deployment state.
  Rationale: the immutable inventory includes installed controller/helper binaries, selected systemd unit files, sudoers policy, managed lock path metadata, and protocol files. Runner credentials are validated by type/owner/mode/location only. Journals, refs, logs, work directories, diagnostics, and other mutable state use strict schemas and expected transition checks rather than one unstable tree digest.
  Date/Author: 2026-07-21 / control-plane correction.

- Decision: run health under locked `agent-relay-health`, not `github-runner`.
  Rationale: first verify active runtime readability as `github-runner`, then run a fixed health entrypoint under a dedicated account with `PrivateNetwork=yes`, `NoNewPrivileges=yes`, `PrivateTmp=yes`, `ProtectSystem=strict`, `ProtectHome=yes`, no writable host paths, inaccessible checkout/runner/home/work/recovery paths, and a read-only bind mount of finalized runtime to `/run/agent-relay-runtime`.
  Date/Author: 2026-07-21 / credential-exposure correction.

- Decision: do not claim post-deployment GitHub job acceptance.
  Rationale: starting the primary while a transaction is provisional can allow unrelated queued work to race a smoke job. Local listener and sandboxed runtime checks are the accepted guarantee for this plan.
  Date/Author: 2026-07-21 / smoke-scope correction.

- Decision: retain `DOCKER_PROVISIONING_ENABLED=0`.
  Rationale: Docker host provisioning is a separate decision and is outside this deployment plan.
  Date/Author: 2026-07-21 / scope preservation.

## Outcomes & Retrospective

This plan remains active. No production behavior has changed through plan-only commits.

The revised design intentionally limits itself to automatic current-main deployment, manual branch testing, safe drain, stage/activate, exact accepted state, and best-effort accidental recovery. It does not attempt hostile-code isolation, dynamic runner control, or full infrastructure migration through a temporary branch.

Update this section after each accepted milestone with implemented behavior, deviations, validation evidence, and operational lessons. On completion, state production and disposable-VM results and move this same plan to `completed` without replacing it with a summary.

## Context and Orientation

Current installation:

- `/srv/github-runner/storage/agent-relay`: administrator-owned source checkout; active `dist` currently root-owned inside it;
- `/srv/github-runner/storage/work`, `runner`, and `home`: primary runner state owned by `github-runner`;
- `/srv/github-runner/storage/build` and `build-home`: builder state owned by `agent-relay-builder`;
- `/etc/agent-relay/administrator`: root-owned recorded administrator identity and current legacy updater lock file;
- `actions.runner.Divorium.gh-runner.service`: primary service with `KillMode=process`;
- current `install.sh`: one-time setup, PAT exchanged for short-lived registration token and not persisted;
- current `update.sh`: recorded-administrator only, interactive sudo acquisition, listener stop, unbounded worker wait, active `dist` deletion/rebuild, listener restart, Docker disabled;
- current workflows use bare `[self-hosted]` and must be routed before a second runner starts.

Expected host additions are equivalent to:

    /srv/github-runner/storage/deploy-runner
    /srv/github-runner/storage/deploy-work
    /srv/github-runner/storage/deploy-home
    /srv/github-runner/storage/runtime-stage/
    /srv/github-runner/storage/runtime-backup/
    /var/lib/agent-relay-deploy/
      bootstrap-complete
      installed-host-schema
      active-transaction.json
      pending-request.json
      accepted-state.json
      deployed-state.json
      recovery.git/
      controller-versions/
      logs/
    /usr/local/libexec/agent-relay-deploy
    /usr/local/libexec/agent-relay-submit-main
    /usr/local/libexec/agent-relay-submit-branch
    /usr/local/libexec/agent-relay-deploy-status
    /etc/agent-relay/deployment-operators
    /etc/sudoers.d/agent-relay-deployer

Expected accounts include `agent-relay-deployer` and locked `agent-relay-health`, both distinct from `github-runner` and `agent-relay-builder`.

## Plan of Work

### Milestone 0: Prove GitHub-side feasibility

Verify on the actual organization and repository that:

- an organization runner group can be created and can allow this public repository;
- workflow restriction can be written for exactly `deploy-main.yml@refs/heads/main` and `deploy-branch.yml@refs/heads/main`;
- the repository environment supports required reviewers and prevention of self-review where desired;
- the authorized deployment operators are identified;
- a ruleset protects `main` from force-push, deletion, direct push, workflow-file bypass, and unauthorized rule bypass;
- `queue: max` validates and the 100-pending limit is acceptable;
- GitHub-hosted Linux runners are allowed for portable validation;
- all actions used by the two workflows can be pinned to full commit SHAs;
- minimum `GITHUB_TOKEN` permissions required by each job are available.

If a required control is unavailable or inherited read-only in an incompatible form, record `[blocked]`, do not install a privileged deployment runner, and return to architecture review.

### Milestone 1: Define protocol and portable validation

Add versioned repository metadata declaring:

- deployment protocol range;
- updater protocol version;
- runtime manifest schema;
- controller-candidate schema;
- `requiredHostSchema`;
- fixed health entrypoint and expected behavior.

Add `npm run check:portable`, runnable on GitHub-hosted Linux without the production host, Codex login, Docker daemon, PAT, systemd mutation, or self-hosted paths. It must include dependency installation, typecheck, tests, production runtime build, shell syntax, Node script syntax, and portable system-contract tests. Existing complete `npm run check` remains required by normal repository CI and final acceptance.

Define the temporary-scope check. Before privileged temporary deployment, compare the branch against current `main`. Reject when it requires a higher host schema, an incompatible controller/updater protocol, or changes that are explicitly marked migration-only. Do not claim such a branch was tested.

### Milestone 2: Implement installation, migration, and bootstrap

Extend fresh installation and add a restartable existing-host migration that:

- creates the deployment and health accounts with locked passwords and exact homes/shells;
- creates isolated runner, work, and home directories;
- creates or validates the selected runner group and labels while PAT is only in memory;
- registers the deployment runner using a separate short-lived registration token;
- installs controller versions, fixed helpers, transaction/recovery units, sudoers, state, recovery repository, stage, backup, and bounded logs;
- routes existing ordinary workflows to `agent-relay-main` before starting the deployment service;
- installs the managed transaction lock and performs a tested dual-lock cutover from the legacy administrator-file updater lock;
- keeps the deployment runner service stopped until bootstrap is complete;
- bootstraps one exact current-main SHA by validating it, draining primary, preserving the current runtime as fallback, running managed update into stage, validating stage, activating it, validating active runtime, storing the accepted Git object/ref, and publishing accepted/deployed state;
- writes `bootstrap-complete` last and starts the deployment runner service last;
- retains no PAT or registration token.

Partial or conflicting state fails closed. Re-running exact completed migration validates state and performs no destructive work.

### Milestone 3: Add the two human-maintained workflows

`deploy-main.yml`:

- triggers on `push` to `main` and manual retry of current `main`;
- resolves the exact current main SHA;
- runs `check:portable` on GitHub-hosted Linux with checkout credentials disabled;
- enters the shared job-level deployment concurrency only for the privileged submit/poll job;
- uses the selected deployment runner group and `agent-relay-deploy` label;
- submits a canonical request through the fixed no-argument helper and polls status;
- treats `superseded` as a successful no-op and reports other terminal outcomes accurately.

`deploy-branch.yml`:

- runs only through `workflow_dispatch` from `refs/heads/main`;
- accepts one same-repository branch name and rejects tags, SHAs, URLs, merge refs, forks, malformed names, and ambiguous refs;
- rejects `github.run_attempt != 1`;
- resolves the branch once to an exact SHA and never follows the branch afterward;
- runs portable validation and temporary-scope validation on GitHub-hosted Linux;
- uses a separate GitHub-hosted approval job referencing the protected environment;
- after approval, enters the same job-level concurrency and submits through the selected deployment runner;
- passes canonical event metadata without exposing credentials to the target updater.

Both deploy jobs use `queue: max`, no `cancel-in-progress: true`, exact minimum permissions, fixed timeouts, full-SHA action pins, normalized bounded logs, and no target-provided workflow code in the privileged job. All existing self-hosted jobs and examples receive explicit `agent-relay-main` routing before the deployment runner is enabled.

### Milestone 4: Implement durable submission and transaction ownership

The deployment account can invoke only fixed root-owned helpers:

- `agent-relay-submit-main`;
- `agent-relay-submit-branch`;
- `agent-relay-deploy-status`.

Submission helpers accept no shell arguments. They read a bounded canonical request from a fixed inherited file descriptor or standard input, validate mode-specific schema, create `pending-request.json` exclusively with file sync, and start the root-owned transaction unit. They do not execute target code.

The transaction service claims the pending request under the managed lock, writes a durable journal, and continues independently of the workflow process. Cancellation after claim does not terminate the host transaction. A later workflow or administrator can read bounded sanitized status. Only one pending or active request may exist.

At boot, a recovery unit runs before the primary runner. It completes or enters critical recovery for any nonterminal journal before primary may start.

### Milestone 5: Implement the host transaction

Preflight before primary stop:

- validate request, actor, mode, workflow identity, workflow ref, run attempt, protocol, bootstrap marker, installed host schema, controller version, checkout canonical path/owner/remote, clean tracked and untracked state, recovery repository, LKG ref/object, filesystem identity, free-space reserve, stage/backup emptiness, and journal consistency;
- fetch origin as recorded administrator;
- ensure target object is local and copy it into the recovery repository under a transaction ref before mutation;
- for main, compare requested SHA with current `origin/main`; return `superseded` without host mutation when they differ;
- for branch, require the exact previously resolved object and compatible temporary scope;
- capture immutable control-plane hashes and separate mutable-state metadata/invariants.

Drain:

- stop only the primary listener service;
- wait up to a configured deadline for every `github-runner` `Runner.Worker`;
- do not kill active jobs;
- on timeout or inspection failure, restart the listener if it was initially active, leave checkout/runtime unchanged, and finish with `drain_failed`;
- after successful drain, runtime-mask the primary service and monitor that no primary listener or worker appears during mutation.

Checkout and update:

- write journal state before every irreversible step;
- reset and clean the production checkout as recorded administrator to the exact target SHA;
- reject unexpected ignored dependency state when the updater protocol requires a clean dependency boundary;
- create transaction-owned stage and backup paths on the same filesystem as active `dist`;
- run target `update.sh` in managed controller mode as root inside a transient systemd service/cgroup with fixed environment, bounded output, timeout, TERM/KILL escalation, and no inherited GitHub token or runner environment;
- require updater cgroup inactivity and no surviving descendants before continuing;
- require primary service still masked and no listener/worker process;
- require active runtime unchanged while updater worked;
- require immutable control-plane files unchanged and mutable state to match expected transition rules;
- validate staged runtime regular-file/directory shape, manifest, complete tree digest, source SHA, protocol, and health entrypoint.

Activation and local health:

- retain current active runtime as transaction backup;
- replace active `dist` through journaled same-filesystem rename steps; do not claim multi-directory atomicity;
- verify active runtime readability as `github-runner` without executing target code under that account;
- run the fixed health entrypoint under `agent-relay-health` in a transient sandbox with private network, strict system/home protection, no writable host paths, inaccessible checkout/runner/home/work/recovery paths, and only active runtime bind-mounted read-only at `/run/agent-relay-runtime`;
- validate the expected bounded machine-readable health result.

Main acceptance:

- if target contains a backward-compatible controller candidate, stage, validate, self-test, and atomically switch the controller symlink while retaining the previous version; switch back on failure;
- store target in the accepted recovery ref only after runtime and required controller activation succeed;
- publish accepted and deployed state through an ordered recoverable protocol;
- unmask and start primary, verify service and listener process become ready within deadline;
- remove transaction backup only after terminal success and retention policy permits it.

Temporary completion:

- record target success or failure;
- never activate controller candidates or update LKG;
- restore checkout and runtime from local LKG and retained recovery data without fetching GitHub;
- run stable managed updater when required by the LKG manifest;
- validate restored runtime with the same sandbox;
- unmask/start primary only after restoration is proven;
- report target and restoration outcomes separately.

Any failure after mutation invokes restoration. If restoration cannot be proven, keep primary masked/stopped, preserve journal and bounded logs, retain LKG unchanged, and enter `critical_recovery` without automatic retry loops.

### Milestone 6: Implement recovery, administrator path, and controller upgrades

`agent-relay-deploy recover` is administrator-only and never retries the failed target. It terminates accidental surviving target processes, restores the recorded LKG checkout/runtime/controller from local recovery state, validates health, and starts primary only after success.

`agent-relay-deploy admin-update-current-main` is administrator-only and provides the supported manual update path after migration. It validates current main and then uses the same managed transaction. Direct unmanaged target `update.sh` refuses after migration except when invoked by the controller's authenticated managed mode.

`agent-relay-deploy acknowledge-repair` is administrator-only, does not mutate the host, requires independently verified active SHA/runtime/controller evidence, and archives a critical journal. It cannot silently promote a temporary SHA or change LKG.

Controller candidates must declare compatibility with current journal and host schema. Version directories are immutable, symlink switch is atomic, prior version remains retained, and journal schema changes require backward-compatible reading or explicit migration before activation.

Infrastructure changes that raise `requiredHostSchema` are installed only through explicit administrator migration under the managed lock. Automatic main deployment reports `migration_required` and leaves the previous LKG active until migration completes. Temporary branches requiring such migration are rejected before drain.

### Milestone 7: Documentation and acceptance

Update current-state documentation only after implementation exists. Describe installation, migration, two workflows, branch-only manual target, approval and rerun rules, portable validation, host-schema gating, drain, lock cutover, transaction service, staging/activation, health sandbox, local recovery, controller upgrades, administrator recovery, critical recovery, bounded logs, Docker remaining disabled, and best-effort rollback limitations.

## Concrete Steps

Before implementation:

    git cat-file -e e9ec636e5abf383f8831fc126b99f04e2e005a3c^{commit}
    git merge-base --is-ancestor e9ec636e5abf383f8831fc126b99f04e2e005a3c HEAD
    git status --short
    git diff --name-status e9ec636e5abf383f8831fc126b99f04e2e005a3c...HEAD
    git grep -n 'DOCKER_PROVISIONING_ENABLED=0' e9ec636e5abf383f8831fc126b99f04e2e005a3c -- update.sh
    git diff --exit-code e9ec636e5abf383f8831fc126b99f04e2e005a3c -- .agent/PLANS.md .github/workflows examples/github-actions

Expected: all commands succeed and Docker provisioning remains disabled. Any unexplained mismatch is `[blocked]`.

Milestone 0 evidence must include sanitized API/settings output for runner-group repository/workflow restriction, public-repository permission, environment reviewers, ruleset enforcement/bypass, GitHub-hosted allowance, and concurrency queue syntax.

Focused implementation tests must cover at least:

- protocol and host-schema compatibility;
- branch resolver and rejection matrix;
- portable validation contract;
- install/migration absent/exact/partial/conflict states and token non-persistence;
- dual-lock cutover;
- exclusive request admission and cancellation-independent transaction service;
- preflight ownership, clean tree, object retention, capacity, filesystem, and immutable/mutable control-plane checks;
- bounded drain and no-mutation timeout;
- updater root managed mode, stage-only behavior, cgroup/process cleanup, timeout, and Docker-disabled invariant;
- journaled runtime activation crash windows;
- dedicated health user sandbox and credential-path inaccessibility;
- main success, superseded, migration-required, failed-main restoration;
- temporary success/failure with mandatory LKG restoration;
- controller activation/switchback;
- boot recovery and critical recovery;
- administrator manual update/recover/acknowledge semantics;
- bounded normalized logs and truncation markers.

Complete repository validation:

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

Expected: every command succeeds, coverage thresholds remain satisfied, no baseline test is weakened without an equal or stronger replacement recorded in `Progress`, and Docker provisioning remains disabled.

Production-VM demonstrations:

1. existing-host migration and exact-main bootstrap;
2. successful temporary branch update followed by successful mandatory restoration;
3. controlled temporary updater failure followed by successful restoration;
4. drain timeout with no checkout/runtime mutation and listener restoration;
5. superseded automatic-main request producing no host mutation;
6. current-main deployment becoming LKG;
7. administrator `admin-update-current-main` using the same controller path.

Disposable clone or snapshot-equivalent VM demonstrations:

1. failed main deployment with GitHub network unavailable and successful LKG restoration;
2. restart during checkout/update and deterministic boot recovery;
3. restart during runtime activation and deterministic old-or-new state recovery;
4. restart during restoration and successful `recover` continuation;
5. controller candidate activation success and switchback failure path;
6. target plus restoration failure entering critical recovery while preserving evidence;
7. target attempts to alter immutable control-plane files and is rejected/restored;
8. target requiring higher host schema returns `migration_required` without mutation.

## Validation and Acceptance

Acceptance requires observable behavior, not intended design or code presence.

- GitHub feasibility proves exact runner-group and workflow restrictions, environment approval, ruleset, action pins, minimum permissions, and `queue: max` on the actual repository.
- Scope acceptance proves manual input is a same-repository branch only and that unsupported PR/tag/SHA/URL/fork/merge-ref inputs cannot reach privileged execution.
- Validation acceptance proves the exact target SHA passes hosted portable validation before submission and a failed validation cannot create a pending host request.
- Authorization acceptance proves non-main workflow ref, rerun attempt, unapproved environment, or unauthorized actor cannot submit.
- Queue acceptance starts at least three runs and proves pending runs are retained up to configured limits, host mutation never interleaves, and stale main runs return `superseded`.
- Drain acceptance proves checkout and runtime do not change while a primary worker exists and timeout restores listener without killing the job.
- Ownership acceptance proves deployer cannot directly mutate checkout, state, recovery, controller, sudoers, or runtime; Git operations preserve administrator ownership.
- Protocol acceptance proves incompatible updater/controller/host schema is rejected before drain.
- Stage acceptance proves target updater cannot activate runtime or mutate deployment state and leaves active runtime unchanged.
- Control-plane acceptance proves immutable files are checked deterministically, mutable state follows strict expected transitions, and runner credential contents are never hashed, logged, or exported.
- Health acceptance proves `github-runner` can read active runtime while health execution under `agent-relay-health` cannot access network, source checkout, runner home/configuration, workflow workspaces, or recovery state.
- Main acceptance proves current main is staged, validated, activated, locally health-checked, optionally controller-upgraded, accepted in local recovery, and primary listener started.
- Temporary acceptance proves both target success and target failure end on unchanged LKG and never activate controller or infrastructure changes.
- Recovery acceptance proves restoration does not fetch GitHub, every journal crash phase is deterministic, and primary remains unavailable while state is unproven.
- Logging acceptance defines exact byte limits, normalized GitHub output, root-only local transcript policy, truncation marker, retention, and credential omission.
- Critical-recovery acceptance proves no automatic retry loop, unchanged LKG, preserved bounded evidence, primary masked/stopped, and explicit administrator recovery requirement.

The plan is complete only when every unchecked `Progress` item is checked with evidence, all focused and complete tests pass, exact-head CI passes, independent review has no unresolved action point, production demonstrations pass, and disposable-VM failure/restart/controller scenarios pass.

## Idempotence and Recovery

Fresh install remains one-time. Migration distinguishes absent, exact, partial, and conflicting state and compensates only attempt-owned resources. Exact completed migration is validation-only.

The managed transaction lock serializes migration, deployment, administrator update, and recovery. Dual-lock cutover prevents overlap with an old manual updater during migration.

Pending request creation is exclusive and durable. The journal is strict-schema, bounded, credential-free, atomically replaced, and records enough information to distinguish preflight, drain, checkout, updater, stage, activation, health, controller switch, acceptance, restoration, listener start, completion, superseded, migration-required, and critical recovery.

Runtime activation uses same-filesystem stage, active, and backup locations with ordered journaled renames. Recovery recognizes every possible rename crash window and selects the manifest/digest-proven old or new runtime; it does not infer state from directory names alone.

LKG publication stores the Git object and local ref before publishing matching accepted metadata. A crash leaves either the old accepted state or a detectable incomplete publication. Temporary and failed targets never change LKG.

Recovery never retries target code. It restores local LKG, stable controller version, stable checkout, and stable runtime, then validates health and listener readiness. Unknown or contradictory state blocks mutation and primary start but still permits bounded read-only status.

Tests use temporary roots, local repositories, fake APIs, fake process tables/services, and disposable VMs. They must not register real runners, alter production organization settings, stop the real primary runner, or mutate production checkout except in the explicitly approved production demonstrations.

## Artifacts and Notes

Keep evidence append-only.

- 2026-07-21: reviewed repository deployment contracts on baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- 2026-07-21: reviewed GitHub self-hosted runner groups, selected workflows, environments, manual dispatch, rerun semantics, and concurrency queueing.
- 2026-07-21: created draft PR #47 with an active plan and no implementation.
- 2026-07-21: converted the plan to the repository living ExecPlan structure.
- 2026-07-21: repeated adversarial reviews corrected transaction, recovery, updater, workflow, and acceptance defects.
- 2026-07-21: twelfth adversarial review aligned manual scope to branch-only testing, reduced privileged workflows to two, added host-schema gating, corrected control-plane and health-account handling, and preserved administrator managed update.

Future evidence must include GitHub settings/API results, workflow hashes and pins, baseline hashes, exact test counts, ownership/modes, migration output, lock cutover, request/journal transitions, drain timing, runtime manifests/digests, health sandbox proof, recovery ref/object verification, transaction outcomes, bounded log behavior, production/disposable demonstrations, CI run IDs, and independent review result.

GitHub documentation reviewed:

- `https://docs.github.com/en/actions/how-tos/managing-self-hosted-runners/managing-access-to-self-hosted-runners-using-groups`
- `https://docs.github.com/en/rest/actions/self-hosted-runner-groups`
- `https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments`
- `https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs`
- `https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax`
- `https://docs.github.com/en/actions/concepts/security/github_token`

Non-goals:

- hostile-code isolation or guaranteed recovery from malicious root code;
- VM, disk, network, systemd, or resource-exhaustion disaster recovery;
- autoscaling or ephemeral/JIT runners;
- persistent PAT or GitHub App credentials;
- PR, fork, tag, arbitrary SHA, arbitrary repository, or arbitrary URL targets;
- parallel host mutation;
- guaranteed post-deployment GitHub job execution;
- VM snapshot management by Agent Relay;
- automatic reversal of arbitrary package, credential, database, Docker-volume, or application-data changes;
- temporary testing of installer, runner registration, workflow/settings, sudoers, service-control-plane, or breaking controller changes;
- re-enabling Docker provisioning.

## Interfaces and Dependencies

No public Agent Relay job API, Codex prompt/request/result contract, finalizer decision, or workspace sandbox interface changes are required.

Identities and registrations:

    recorded administrator:    /etc/agent-relay/administrator
    primary user/runner/label: github-runner / gh-runner / agent-relay-main
    builder user:              agent-relay-builder
    deployment user/runner:    agent-relay-deployer / gh-deploy-runner
    deployment label/group:    agent-relay-deploy / agent-relay-deployment
    health user:               agent-relay-health

The deployment account may invoke only fixed root-owned submit/status helpers. The health account has no login, no sudo, no persistent writable home, and no access to runner credentials.

Canonical request includes schema version, request ID, workflow run ID, run attempt, actor, event mode, workflow path/ref/control-plane SHA, source branch when applicable, target SHA, portable-validation result identity, required host schema, and protocol versions. It contains no credential.

The managed updater environment includes only mode, transaction ID, exact source root, controller-created build/stage paths, expected target SHA, installed host schema, and fixed locale/path. It receives no GitHub token, runner environment, arbitrary caller environment, or user-supplied command.

Runtime manifest includes schema, target SHA, deployment/updater protocol, required host schema, health entrypoint, complete canonical tree digest, file count, total bytes, creation timestamp, and finalized marker. Runtime trees contain only regular directories and regular files; symlinks, devices, sockets, FIFOs, hard-link surprises, and writable-by-group/other entries are rejected.

Immutable control-plane inventory includes exact selected controller/helper binaries, controller symlink target metadata, selected systemd unit files, sudoers policy, protocol files, and managed-lock path metadata. Runner registration credential contents are excluded. Runner identity files are checked for expected location, type, owner, and mode. Mutable journal, accepted/deployed state, recovery refs, logs, runner diagnostics, and work directories are validated through explicit schemas and phase-specific transition rules.

Bounded configuration must include portable validation timeout, approval timeout, queue limit assumptions, request size, drain deadline, fetch timeout, updater timeout, TERM/KILL grace, health timeout/output bytes, transaction deadline, busy polling, disk reserve, local/GitHub log bytes, log retention, runtime backup retention, and controller-version retention.

Use existing pinned host tools where possible: Bash, Git, curl, jq, systemd, coreutils, Node.js, and the official GitHub Actions runner archive. Add no third-party runtime dependency unless the plan records why existing tools cannot provide deterministic parsing, process control, API handling, or durable state.

Revision note (2026-07-21): Twelfth adversarial review simplified the design to the requested automatic-main and manual-branch modes, reduced privileged workflows to two, moved approval ahead of deployment concurrency, introduced explicit installed-host-schema gating, separated immutable control-plane hashes from mutable runner/state invariants, removed credential-content hashing, moved health execution to a dedicated sandboxed account, preserved administrator-managed manual update through the controller, and made runtime activation explicitly journaled rather than falsely multi-directory atomic. This revision changes only the active ExecPlan and does not claim implementation complete.