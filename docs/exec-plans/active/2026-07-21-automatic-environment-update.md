# Automate Agent Relay environment deployment and rollback

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current as work proceeds. Maintain this document in accordance with `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

The reviewed runtime baseline is `main` commit `e9ec636e5abf383f8831fc126b99f04e2e005a3c`. Before implementation starts, verify that this commit exists and is an ancestor of `HEAD`. If the branch has been rebased or `main` has advanced, recheck every current-state statement, file path, workflow name, runner contract, and GitHub API assumption, update this plan with the newly reviewed baseline, and record that review in `Progress`. Do not silently implement against a different baseline.

Codex may inspect Git state with read-only commands such as `status`, `diff`, `show`, `grep`, `rev-parse`, `show-ref`, `cat-file`, and `merge-base`. Codex must not run `git add`, `commit`, `merge`, `rebase`, `reset`, `restore`, `checkout`, `cherry-pick`, or `push`; the GitHub runner owns commit and push. Workflow files are human-maintained for this task. Codex must not edit `.github/workflows/` or `examples/github-actions/`; the human reviewer implements the workflow changes described below after the corresponding code interfaces are stable.

## Purpose / Big Picture

Replace the current manual release procedure:

    cd /srv/github-runner/storage/agent-relay
    git pull --ff-only
    ./update.sh

with an observable, restartable deployment system on the dedicated Agent Relay VM.

After this work:

- a push to `main` deploys the exact pushed commit, runs that revision's real `./update.sh`, proves that the primary runner can accept a trusted smoke job, and records the commit as last known good only after the complete acceptance path succeeds;
- an operator can manually select an open same-repository pull request or branch, run its real `./update.sh` against the real host, observe the result, and always return the host to the unchanged last-known-good `main` revision;
- a failed `main` deployment automatically converges back to the previous verified `main` revision;
- a second persistent deployment and recovery runner remains available when the primary runner, compiled runtime, or tested updater is broken;
- Git synchronization, target update, health validation, smoke verification, rollback, and transaction cleanup are serialized as one host transaction;
- deployment and rollback results are reported independently, with bounded logs and an explicit critical recovery state when both fail.

The feature protects the dedicated VM from accidental updater and deployment failures. Same-repository targets are trusted to execute privileged host changes. This plan is not a sandbox for hostile code and does not promise reversal of arbitrary operating-system, package, credential, database, Docker-volume, or data-format mutations.

## Progress

Keep this section append-only for completed historical entries. Split partially completed work into a checked historical entry and a remaining unchecked entry. Every checked implementation item must identify a repository location plus passing automated evidence, or a reproducible command plus its captured result. Blocked items remain unchecked and use the `[blocked]` prefix required by `.agent/PLANS.md`.

- [x] (2026-07-21) Reviewed the current `README.md`, `docs/native-github-runner-specification.md`, `docs/operations/README.md`, `install.sh`, `update.sh`, `.github/workflows/ci.yml`, and `.github/workflows/codex.yml` contracts on baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- [x] (2026-07-21) Confirmed that the primary runner cannot synchronously update itself: `update.sh` stops its listener and waits for every `Runner.Worker` owned by `github-runner`, including the worker that would be running the deployment job.
- [x] (2026-07-21) Reviewed GitHub's persistent, ephemeral, JIT, registration-token, runner-label, runner-group, and selected-workflow access mechanisms.
- [x] (2026-07-21) Selected a second persistent deployment/recovery runner for the single long-lived VM instead of an ephemeral or JIT runner.
- [x] (2026-07-21) Established PAT non-persistence, exact-SHA execution, local last-known-good state, controller-outside-checkout, mandatory temporary-target restoration, and double-failure recovery decisions.
- [x] (2026-07-21) Rewrote this plan into the living ExecPlan structure used by PR #3, with dated progress, discoveries, decisions, milestones, commands, acceptance scenarios, recovery behavior, artifacts, and interfaces.
- [ ] Revalidate the pinned baseline and all human-maintained workflow files immediately before implementation. Record exact commands and output in `Artifacts and Notes`.
- [ ] Implement fresh-install support in `install.sh` and focused helpers for the deployment account, second runner, restricted runner group, protected controller, state roots, service unit, and noninteractive privileged authority.
- [ ] Implement the restartable one-time migration path for the already installed VM without rerunning the complete installer.
- [ ] Implement the trusted deployment controller, exact request validation, atomic transaction journal, bounded updater process-group execution, local health checks, rollback, and double-failure state.
- [ ] Implement target-resolution helpers and stable interfaces required by the human-maintained deployment and smoke workflows.
- [ ] Human reviewer: add the deployment and smoke workflows, restrict them to the deployment and primary runners respectively, and update every existing self-hosted job to require `agent-relay-main`.
- [ ] Add deterministic unit, contract, integration, and system coverage for installation, migration, routing, transactions, interruption, smoke, rollback, logging, and credential non-inheritance.
- [ ] Run focused validation, `npm run check`, `git diff --check`, exact-head CI, and independent point-by-point review of every unchecked plan item.
- [ ] Perform the one-time migration on the real VM, execute a successful temporary target test, a controlled target failure with successful restoration, and a successful exact-`main` deployment.
- [ ] Update `Outcomes & Retrospective`, append final evidence and a revision note, and move this unchanged plan to `docs/exec-plans/completed/` only after every item is checked.

## Surprises & Discoveries

- Observation: the primary runner cannot be the component that directly performs its own deployment.
  Evidence: `update.sh` stops `actions.runner.Divorium.gh-runner.service` and waits while a `Runner.Worker` owned by the numeric `github-runner` UID exists. A deployment job running on that runner would wait for itself.

- Observation: using another runner process under the same `github-runner` UID would retain the same deadlock.
  Evidence: the wait condition is UID plus process name, not runner registration name, directory, service, label, or workflow identity.

- Observation: the existing updater lock is too narrow for automatic deployment.
  Evidence: its `flock` begins inside `update.sh`, after any Git fetch or checkout, and ends before an external rollback. The authoritative lock must cover the complete Git/update/smoke/rollback transaction.

- Observation: current `origin/main` is not rollback state after a failed merge deployment.
  Evidence: when a bad commit is pushed to `main`, the remote branch already resolves to that bad commit. Rollback requires the previous commit that completed host acceptance on this VM.

- Observation: the installation PAT is unnecessary after both persistent runners are registered.
  Evidence: `install.sh` exchanges the operator credential for a short-lived registration token and the configured runner keeps its own credentials. A second persistent runner can be registered during installation or one-time migration while the PAT remains only in memory.

- Observation: labels alone are routing metadata, not a sufficient privilege boundary for a public repository.
  Evidence: a workflow that can target a matching self-hosted label may reach that runner. The privileged deployment runner must also be confined to the repository and trusted workflow through a runner group or an equivalent GitHub-supported access control.

- Observation: `update.sh` exit zero and `systemctl is-active` do not prove that GitHub can schedule work on the primary runner.
  Evidence: a listener may be locally active but unregistered, disconnected, misconfigured, or unable to execute a job. Acceptance therefore requires a bounded trusted smoke job on `agent-relay-main`.

- Observation: testing a target revision's real updater necessarily grants that trusted revision broad host authority.
  Evidence: the updater invokes privileged service, ownership, filesystem, compiler, and potentially future host-maintenance operations. Narrow command allowlists would stop testing future updater changes unless the authority contract changed in lockstep.

- Observation: rollback through the previous updater is convergence, not a general host snapshot.
  Evidence: rerunning stable code can rebuild runtime and restore declared managed state, but cannot reliably reverse an arbitrary irreversible mutation made by the failed target.

- Observation: a recovery component stored only in the tested checkout is not a recovery boundary.
  Evidence: the target checkout may contain a syntactically broken or incomplete controller. The active controller used to perform rollback must be an installed root-owned copy outside that checkout and must not be automatically replaced during a temporary target test.

## Decision Log

- Decision: use a second persistent organization runner on the same VM, not an ephemeral or JIT runner.
  Rationale: the system has one durable VM and needs an always-registered recovery channel. Ephemeral creation would add persistent API credentials, bootstrap lifecycle, cleanup, and external log handling without providing VM isolation or autoscaling value.
  Date/Author: 2026-07-21 / design review with operator.

- Decision: name the primary runner `gh-runner` with label `agent-relay-main`, and the deployment runner `gh-deploy-runner` with label `agent-relay-deploy`.
  Rationale: explicit labels prevent ordinary CI and Codex jobs from matching the privileged deployment runner and make the role of each registration observable.
  Date/Author: 2026-07-21 / design review.

- Decision: run the deployment runner under a dedicated `agent-relay-deployer` system account whose UID differs from `github-runner`.
  Rationale: `update.sh` waits by UID. A distinct identity avoids self-wait and separates deployment workspace, home, registration credentials, and service lifecycle from Codex.
  Date/Author: 2026-07-21 / repository analysis.

- Decision: confine the deployment runner to organization runner group `agent-relay-deployment`, repository `Divorium/agent-relay`, and `.github/workflows/deploy.yml@refs/heads/main`, in addition to the deployment label.
  Rationale: the repository is public and the deployment runner executes trusted revisions with administrative authority. A label alone is not the access boundary.
  Date/Author: 2026-07-21 / GitHub access-control review.

- Decision: fail installation or migration closed when the required selected-workflow runner-group restriction is unavailable.
  Rationale: silently creating an unrestricted privileged runner would materially change the accepted threat model. The operator must explicitly redesign the boundary instead.
  Date/Author: 2026-07-21 / security review.

- Decision: do not persist the operator PAT or a GitHub App private key.
  Rationale: persistent runners need the PAT only to obtain short-lived registration tokens. Fresh install and migration can register both runners while the PAT is held only in memory.
  Date/Author: 2026-07-21 / authentication review.

- Decision: obtain a separate short-lived registration token for each missing runner registration.
  Rationale: each registration is an independently auditable action and no assumption is made that one token should be reused across both configurations.
  Date/Author: 2026-07-21 / implementation design.

- Decision: use a root-owned installed deployment controller at `/usr/local/libexec/agent-relay-deploy`, sourced from reviewed repository code but executed from outside the mutable checkout.
  Rationale: Git, transaction state, timeout handling, rollback, and logs must remain available when the target checkout or updater is broken.
  Date/Author: 2026-07-21 / recovery design.

- Decision: install a root-owned trust anchor for `agent-relay-deployer` and a dedicated sudoers policy that provides the noninteractive authority required to execute trusted target updaters.
  Rationale: an Actions job cannot answer an interactive sudo prompt. The authority is intentionally broad enough to test real privileged updater changes and is bounded primarily by the selected-workflow runner group and same-repository trust model, not by a fragile command allowlist.
  Date/Author: 2026-07-21 / privilege design.

- Decision: update `update.sh` authentication so the recorded administrator and the protected deployment identity are both valid callers, while all other users remain rejected.
  Rationale: the deployment runner must execute the real updater under its own UID so the updater does not wait for that job and does not require impersonating the human administrator.
  Date/Author: 2026-07-21 / privilege design.

- Decision: treat same-repository manually selected revisions as trusted and reject forks, tags, arbitrary URLs, pull-request merge refs, ambiguous refs, and moving-target execution.
  Rationale: the feature tests privileged code, not untrusted contributions. A human-readable target is resolved once and all later work uses one exact commit SHA.
  Date/Author: 2026-07-21 / operator requirement.

- Decision: keep Git operations outside `update.sh` and serialize them with update, smoke, and rollback in the installed controller.
  Rationale: `update.sh` remains responsible for rebuilding and activating the checked-out revision; deployment orchestration owns revision selection and recovery.
  Date/Author: 2026-07-21 / current-contract review.

- Decision: store a local last-known-good `main` SHA instead of using current `origin/main` or a moving Git tag named `main`.
  Rationale: rollback state is host-specific acceptance state and must survive a newly pushed broken `main`.
  Date/Author: 2026-07-21 / rollback design.

- Decision: always restore last-known-good `main` after a temporary PR or branch test, including after a successful target update.
  Rationale: temporary testing must not silently change the runtime used by later jobs and must never promote a non-main revision.
  Date/Author: 2026-07-21 / operator requirement.

- Decision: update last-known-good state only after target update, local service/listener checks, and a real primary-runner smoke job all succeed.
  Rationale: a locally active service is not sufficient evidence that the deployed environment can perform its intended GitHub function.
  Date/Author: 2026-07-21 / acceptance design.

- Decision: execute each target updater in a dedicated process group with bounded TERM and KILL escalation before rollback.
  Rationale: rollback cannot safely begin while updater descendants may still be mutating the same host.
  Date/Author: 2026-07-21 / failure-control review.

- Decision: keep workflow files human-maintained for this task.
  Rationale: the operator previously assigned workflow changes to the human reviewer; Codex implements the repository and host interfaces but does not edit `.github/workflows/` or examples.
  Date/Author: 2026-07-21 / operator instruction.

- Decision: do not automatically replace the installed controller during a temporary target transaction.
  Rationale: the tested revision must not replace the component responsible for restoring the stable revision. Controller upgrades require a separately accepted `main` revision and explicit administrator migration or activation.
  Date/Author: 2026-07-21 / recovery design.

- Decision: stop automatic retries after deployment and rollback both fail.
  Rationale: repeating an unknown partial host mutation can compound damage. Preserve the deployment runner, journal, and logs for explicit administrator recovery.
  Date/Author: 2026-07-21 / recovery design.

## Outcomes & Retrospective

This plan remains active. No installer, updater, controller, workflow, service, runner registration, or production host behavior has been changed by the plan-only commits.

The expected result is a durable recovery channel and exact-SHA deployment transaction that can prove a target revision works and can return the host to the last verified `main`. The design deliberately favors a persistent second runner and local accepted-state journal over dynamic runner creation.

The largest residual limitation is intentional: a trusted target updater receives broad host authority. Automatic rollback guarantees only convergence through the previous stable updater and cannot undo arbitrary irreversible mutations. If implementation evidence shows that this trust model is unacceptable, record the blocker and revise the architecture before code is accepted; do not claim that runner groups or the external controller sandbox privileged target code.

Update this section after each accepted milestone with implemented behavior, deviations, operational evidence, and lessons learned. On completion, state the final real-VM result and move this same plan to `completed` without replacing it with a summary.

## Context and Orientation

Agent Relay currently runs on one systemd-capable dedicated Linux host. Distribution-specific installer details are implementation boundaries; the architecture is the dedicated host, systemd, official GitHub Actions runner, protected source checkout, isolated service accounts, and root-owned activated runtime.

Current paths and identities on the reviewed baseline are:

- `/srv/github-runner/storage/agent-relay`: administrator-owned trusted source checkout and root-owned compiled `dist`;
- `/srv/github-runner/storage/work`: workflow workspaces owned by `github-runner`;
- `/srv/github-runner/storage/runner`: official primary GitHub Actions runner;
- `/srv/github-runner/storage/home`: primary runner home and Codex authentication;
- `/srv/github-runner/storage/build` and `build-home`: disposable and persistent builder state;
- `github-runner`: primary runner and Codex account, without sudo;
- `agent-relay-builder`: runtime compiler account, without sudo;
- `/etc/agent-relay/administrator`: root-owned file naming the human administrator allowed to run the current updater;
- `actions.runner.Divorium.gh-runner.service`: primary runner systemd unit.

`install.sh` is a one-time installer. It installs pinned toolchains, creates service accounts and storage, downloads and verifies the official runner archive, asks for an organization credential only when registration is absent, exchanges it for a short-lived registration token, configures `gh-runner`, installs the primary service, records the administrator, and performs Codex login. It is not rerun for ordinary releases.

`update.sh` accepts no arguments, requires the exact source path and recorded administrator, acquires sudo, stops the primary listener, waits while a `Runner.Worker` owned by `github-runner` exists, deletes and recreates `dist`, compiles the runtime as `agent-relay-builder`, verifies the entrypoint, applies root ownership and read-only runtime modes, and starts the primary service. It deliberately performs no Git operation and has no runtime backup, transaction journal, or rollback.

The current CI and Codex workflows use `runs-on: [self-hosted]`. Adding a second runner without changing this routing would allow ordinary jobs to land on the deployment registration. The human-maintained workflow change must route all current jobs to `[self-hosted, agent-relay-main]` and route deployment work through the restricted group and `agent-relay-deploy` label.

Terms used in this plan:

- **primary runner**: existing `gh-runner`, which executes CI, Codex, and deployment smoke jobs;
- **deployment runner**: new `gh-deploy-runner`, which executes only the trusted deployment workflow and remains available during primary failure;
- **target SHA**: the one exact commit selected for a transaction after resolving a push, PR, or branch input;
- **last known good (LKG)**: the most recent `main` commit that completed update, local validation, and primary-runner smoke on this VM;
- **temporary target**: manually selected same-repository PR or branch that is tested but never promoted and never left active;
- **controller**: installed root-owned orchestration program outside the checkout;
- **transaction journal**: atomically replaced persistent state that records mode, request, target, LKG, phase, process identity, results, and recovery disposition;
- **local health**: successful updater exit, active primary service, expected listener process, and expected deployed-SHA marker;
- **smoke**: a small trusted workflow job actually executed by the primary runner and correlated to the deployment request.

Expected new host layout is:

    /srv/github-runner/storage/deploy-runner
    /srv/github-runner/storage/deploy-work
    /srv/github-runner/storage/deploy-home
    /var/lib/agent-relay-deploy/
      last-known-good-main-sha
      active-transaction.json
      deployed-sha
      logs/
    /usr/local/libexec/agent-relay-deploy
    /etc/agent-relay/deployer
    /etc/sudoers.d/agent-relay-deployer

The installed controller source remains versioned in the repository for review and testing, but deployment invokes the installed copy. The exact repository source path and activation procedure must be selected during Milestone 2 and recorded in `Decision Log` if they differ from this plan.

## Plan of Work

### Milestone 1: Revalidate the baseline and define protected task ownership

Verify the reviewed `main` commit, current branch ancestry, current installer/updater behavior, workflow names, package scripts, and the exact `.agent/PLANS.md` rules. Record hashes or diffs for every human-maintained workflow file. If `main` has advanced, update the baseline and all affected current-state claims before implementation.

Codex-owned implementation scope may include `install.sh`, `update.sh`, new scripts or Node modules for migration, controller source, target resolution, state handling, tests, package scripts, current operator documentation, and this plan. Human-owned scope is `.github/workflows/`, `examples/github-actions/`, runner-group policy application when it cannot be safely automated, final commit/push, exact-head CI review, and real-host execution.

This milestone is complete when baseline checks pass and the exact intended file ownership is recorded in `Artifacts and Notes`.

### Milestone 2: Build installation and migration boundaries

Extend fresh installation to prepare the deployment account, storage, official runner extraction, registration, group and label assignment, service, controller installation, trust anchors, state directories, and noninteractive privilege policy. Keep PAT handling in-memory and obtain separate short-lived registration tokens for missing registrations.

Add a one-time existing-host migration command rather than rerunning `install.sh`. It must identify absent, partial, complete, and conflicting state; validate the current primary installation and healthy runtime; request the organization credential only when required; create or validate GitHub-side access; label the existing runner; register the deployment runner; install host components; seed LKG from the healthy current `main`; start the deployment service; and discard all registration secrets.

This milestone is complete when deterministic installer and migration system tests prove fresh, restart, partial, complete, conflicting, credential-redaction, and non-persistence behavior.

### Milestone 3: Implement persistent state and the trusted deployment controller

Implement one full-transaction `flock`, protected atomic state files, bounded logs, exact-SHA validation, canonical checkout verification, Git fetch/reset/clean, target updater process-group control, sanitized child environment, local health checks, rollback, interruption recovery, and double-failure preservation.

The controller must use the installed copy for transaction and rollback logic. It must never execute Git or rollback code supplied by the failed target except the restored LKG `update.sh` after the checkout has been reset. It must reject unsafe state paths, symlinks, malformed journals, unexpected repository remotes, submodules, alternate worktree layouts, and SHAs outside the expected origin repository.

This milestone is complete when controller tests cover every transaction phase, atomic state transition, timeout, signal, process-group survivor, restart window, rollback path, and critical double failure.

### Milestone 4: Implement exact request resolution and transaction modes

Add repository-owned resolvers that the human-maintained workflow can call. Automatic mode accepts the push event's exact `github.sha` and verifies its relationship to `origin/main`. Manual mode accepts only `pr` or `branch`, validates an open non-draft same-repository PR or a same-repository branch ref, resolves it once, and publishes the exact SHA. No later phase follows the moving name.

Implement the main transaction:

1. acquire the host lock and inspect unfinished state;
2. read LKG;
3. fetch and validate the requested exact `main` SHA;
4. record the journal before checkout mutation;
5. reset and clean the trusted checkout;
6. execute the target updater under a bounded process group;
7. perform local health validation;
8. dispatch and poll the primary-runner smoke;
9. atomically publish target as LKG only after full success;
10. clear the transaction and report success;
11. on any post-checkout failure, restore the previous LKG before returning failure.

Implement the temporary transaction with the same target update and validation, but always restore unchanged LKG, rerun the restored updater, validate the primary runner, and report target and restoration results separately. A passing temporary target is never left active.

This milestone is complete when deterministic integration tests prove successful and failed main deployments, successful and failed temporary tests, mandatory restoration, exact-SHA pinning, and unchanged LKG on every failure or temporary path.

### Milestone 5: Add human-maintained deployment routing and primary smoke

After the controller and resolver interfaces are stable, the human reviewer adds `.github/workflows/deploy.yml` on `main` with:

- `push` on `main` using exact `github.sha`;
- `workflow_dispatch` with target type `pr` or `branch` and target value;
- repository-wide deployment concurrency with `cancel-in-progress: false`;
- the restricted deployment runner group and `agent-relay-deploy` label;
- minimum permissions needed to resolve targets, dispatch smoke, poll workflow runs, and upload bounded logs;
- no checkout or execution of workflow logic from the target branch.

The human reviewer adds a trusted smoke workflow pinned to `main`. It targets `[self-hosted, agent-relay-main]`, performs no Codex work, reads the protected deployed-SHA marker, validates request ID and expected SHA, writes no source change, and finishes within a bounded deadline. The deployment controller or workflow dispatcher must time out a smoke that never starts because the primary runner is offline and then invoke rollback.

The human reviewer changes every existing self-hosted job to require `agent-relay-main`, updates examples consistently, and verifies that no ordinary job can match the deployment runner.

This milestone is complete when workflow contract tests, GitHub configuration evidence, and a controlled smoke prove routing and timeout behavior.

### Milestone 6: Complete documentation, repository validation, and real-host acceptance

Update current-state documentation only after implementation exists. Describe fresh installation, existing-host migration, persistent state, deployment invocation, temporary target testing, LKG semantics, smoke, rollback limitations, critical recovery, log locations, and operator recovery commands. Do not claim ephemeral or hostile-code isolation.

Run focused tests and complete repository validation. Review every Progress item against code and evidence. Then execute the migration on the real VM and demonstrate the acceptance scenarios. Keep the plan active until real-host acceptance and exact-head CI are complete.

This milestone is complete when every Progress item is checked, all tests and CI pass, the real VM has both correctly routed runners, temporary and main transactions behave as specified, `Outcomes & Retrospective` is current, and the plan is moved unchanged to `completed`.

## Concrete Steps

Run repository commands from the repository root. Codex performs no Git mutation and does not edit human-maintained workflow files.

Verify the reviewed baseline before editing:

    git cat-file -e e9ec636e5abf383f8831fc126b99f04e2e005a3c^{commit}
    git merge-base --is-ancestor e9ec636e5abf383f8831fc126b99f04e2e005a3c HEAD
    git status --short
    git diff --name-status e9ec636e5abf383f8831fc126b99f04e2e005a3c...HEAD
    git show e9ec636e5abf383f8831fc126b99f04e2e005a3c:install.sh >/dev/null
    git show e9ec636e5abf383f8831fc126b99f04e2e005a3c:update.sh >/dev/null
    git diff --exit-code e9ec636e5abf383f8831fc126b99f04e2e005a3c -- .agent/PLANS.md .github/workflows examples/github-actions

Expected result: commit and ancestry checks exit zero, and human-maintained files differ only when the human reviewer intentionally updated them and recorded that change. Any unexplained mismatch is `[blocked]` until reviewed.

Inspect current contracts:

    sed -n '1,320p' install.sh
    sed -n '1,360p' update.sh
    sed -n '1,260p' docs/native-github-runner-specification.md
    sed -n '1,220p' docs/operations/README.md
    sed -n '1,240p' .github/workflows/ci.yml
    sed -n '1,260p' .github/workflows/codex.yml
    cat package.json

Expected result: the checkout, accounts, updater wait condition, current one-runner service, and current unlabelled workflow routing match `Context and Orientation`.

Implement Milestone 2 first. Expected repository additions or equivalents are:

- a restartable existing-host migration entrypoint under `scripts/`;
- versioned controller source under `scripts/` or `runner/`, installed as `/usr/local/libexec/agent-relay-deploy`;
- installer helpers for GitHub runner-group API calls, registration, secure file installation, and service generation;
- tests that use temporary filesystem roots, fake GitHub API responses, and fake runner archives rather than mutating the real host.

After Milestone 2, run focused installer and migration checks. Exact filenames may change, but update this section before running different commands:

    bash -n install.sh scripts/*.sh test-system/*.sh
    npm run build
    node --test dist/test/installer.test.js
    bash test-system/install-script.integration.sh
    bash test-system/deployment-migration.integration.sh

Expected result: all commands exit zero; PAT values and registration tokens do not appear in command logs, files, process arguments, output, or retained fixtures.

Implement Milestones 3 and 4. The controller's checkout sequence is equivalent to:

    git -C /srv/github-runner/storage/agent-relay fetch --prune origin
    git -C /srv/github-runner/storage/agent-relay reset --hard <exact-sha>
    git -C /srv/github-runner/storage/agent-relay clean -ffd

Do not use `git clean -x` or `git clean -fdx`; ignored build and dependency state is not ordinary checkout debris. Before every mutation, validate canonical checkout path, owner, expected remote URL, no unsupported submodules, no alternate worktree layout, and target reachability from the expected origin repository.

Run focused controller and transaction checks, updating names if implementation selects different files:

    npm run build
    node --test dist/test/deployment-controller.test.js
    node --test dist/test/deployment-resolver.test.js
    bash test-system/deployment-controller.integration.sh
    bash test-system/deployment-transactions.integration.sh

Expected result: successful main, failed main with rollback, successful temporary with restoration, failed temporary with restoration, timeout, interruption, restart, and double-failure scenarios all produce exact expected state and no surviving updater process.

After code interfaces are stable, the human reviewer implements Milestone 5. Verify workflow routing with source checks and GitHub configuration evidence. The production workflows must contain no bare `runs-on: [self-hosted]`; ordinary jobs require `agent-relay-main`, deployment requires the restricted group and `agent-relay-deploy`, and smoke requires `agent-relay-main`.

Run complete repository validation:

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

Expected result: every command exits zero, coverage thresholds remain satisfied, no baseline test is deleted or weakened without an equal or stronger replacement recorded in `Progress`, and human-maintained workflow changes match the interfaces in this plan.

For real-host migration, the recorded administrator runs the new migration entrypoint from the exact healthy `main` checkout. Record the exact command after the entrypoint name is finalized. Success requires:

- existing primary runner healthy and labeled `agent-relay-main`;
- deployment runner registered in the restricted group with label `agent-relay-deploy`;
- deployment service active under `agent-relay-deployer`;
- controller, trust anchors, sudoers policy, state, and logs installed with expected ownership and modes;
- current healthy `main` SHA seeded as LKG;
- no PAT or registration token retained.

Then demonstrate, in order:

1. a temporary target whose updater succeeds and is followed by successful mandatory restoration;
2. a controlled temporary target whose updater fails and is followed by successful restoration;
3. an exact pushed `main` SHA whose update and smoke succeed and which becomes the new LKG.

Record GitHub run IDs, target and LKG SHAs, transaction IDs, statuses, log artifacts, final active SHA, and service/runner state in `Artifacts and Notes`.

## Validation and Acceptance

Acceptance is based on observable host and GitHub behavior, not on code presence, intended design, a locally active service alone, resolved review comments, or a future promise to migrate the VM.

Fresh-install acceptance proves that one interactive organization credential can create or validate the restricted deployment group, obtain separate short-lived registration tokens, configure isolated primary and deployment runners, install their services and accounts, install the controller and state roots, and leave no PAT or registration token on disk, in arguments, logs, environment snapshots, or workflow-accessible paths.

Existing-host migration acceptance starts from the currently supported one-runner installation. It verifies the current healthy runtime, labels the existing runner without replacing its registration, creates only the missing deployment components, seeds the exact healthy `main` SHA as LKG, starts the deployment runner, and is restartable across absent, partial, complete, and conflicting states. It never deletes or adopts an unrelated runner registration.

Main-deployment acceptance uses a push event's exact SHA. The controller locks the host, records the previous LKG and journal, fetches and validates origin, resets to the target, runs the real target updater in a bounded process group with no inherited GitHub credentials, verifies service and listener state, dispatches a correlated primary-runner smoke, waits through bounded queue time and execution, and updates LKG only after smoke success. The final checkout, runtime marker, primary runner, and LKG all identify the target SHA.

Failed-main acceptance injects a deterministic target updater failure after checkout mutation. The controller records the target failure, proves the updater process group is gone, resets to the previous LKG, runs the restored LKG updater, verifies local health and primary runner recovery, leaves LKG unchanged, reports deployment failure plus rollback success, and leaves the deployment runner available.

Successful temporary-target acceptance selects an open same-repository PR or branch, resolves it once to an exact SHA, executes and validates it, records target success, then always resets to unchanged LKG, runs the LKG updater, and proves primary recovery. The final active SHA and LKG are the original main SHA, not the tested target.

Failed temporary-target acceptance performs the same mandatory restoration after target failure. Target failure remains authoritative for the temporary test even when restoration succeeds, and target and rollback results are separately visible.

Target-resolution acceptance rejects closed or draft PRs, forks, tags, pull-request merge refs, malformed names, ambiguous revisions, arbitrary remote URLs, SHAs absent from the expected origin repository, and a branch whose head moves after initial resolution. All later phases use only the initially resolved SHA.

Serialization acceptance starts two deployment requests and proves that GitHub concurrency does not cancel the first, the host lock admits only one transaction, and the second fails or waits according to the documented bounded policy without interleaving Git or updater mutations. A stale or interrupted journal is recovered or explicitly blocks new work before checkout mutation.

Updater-control acceptance covers success, nonzero exit, spawn failure, overall timeout, TERM handling, TERM-to-KILL escalation, failed signal delivery, and a descendant that attempts to outlive its launcher. Rollback begins only after the controller proves that no target updater process remains.

Smoke acceptance proves that the primary runner, not the deployment runner, executes the trusted smoke workflow from `main`, reads the expected request and SHA marker, and acknowledges success. An offline or unroutable primary runner leaves the smoke queued until the bounded deadline, after which the deployment transaction rolls back rather than hanging indefinitely.

Credential acceptance proves that target `update.sh` receives a sanitized environment without PAT, registration token, `GITHUB_TOKEN`, smoke-dispatch token, controller-private state descriptors, or unrelated runner secrets. Logs redact or omit credentials, and raw target output is normalized so it cannot inject GitHub workflow commands.

Double-failure acceptance injects both target failure and rollback failure. The controller does not update LKG, does not start another automatic attempt, preserves the journal and bounded logs, emits a critical recovery result, and leaves `gh-deploy-runner` online so an administrator can inspect and explicitly resume or abort recovery.

The implementation is complete only when every unchecked `Progress` item is checked with evidence, focused and full repository tests pass, exact-head CI passes, independent review finds no unresolved action point, and the real VM demonstrations above succeed.

## Idempotence and Recovery

Fresh installation remains a one-time operation. Re-running `install.sh` for ordinary releases remains unsupported. Within a fresh installation attempt, creating the deployment user, directories, service files, group configuration, runner extraction, and registration must distinguish absent, exact, partial, and conflicting state and compensate only attempt-owned temporary files.

The existing-host migration is explicitly restartable. Exact completed state is validation-only. Partial state created by the migration may be resumed only when protected markers and ownership prove that the migration owns it. Conflicting users, directories, registrations, services, labels, runner groups, trust files, or sudoers policies fail closed and are not overwritten.

The PAT and registration tokens are ephemeral. Failure after one runner registers may leave that exact valid registration for the next migration attempt to validate and reuse; the retry requests a credential only for remaining GitHub API work and never stores the original secret.

The controller journal is replaced atomically through a unique same-directory temporary file. A transaction records enough information to decide whether checkout mutation began, whether an updater process may remain, which LKG must be restored, whether smoke began, and whether manual recovery is required. Unknown, malformed, unsafe, or contradictory journal state blocks new deployment and preserves evidence.

LKG changes monotonically only through successful accepted `main` deployments. Temporary targets and failed targets never change it. Atomic replacement ensures a crash observes either the old accepted SHA or the new fully accepted SHA, never a partial value.

Repeated rollback converges to the same recorded LKG. The controller terminates target descendants, resets the checkout, cleans only nonignored untracked content, and invokes the restored stable updater. If rollback is interrupted, the journal retains rollback phase and LKG so an explicit recovery invocation can continue the same convergence attempt.

Rollback is not a general snapshot. Updater changes must remain idempotent and converge toward the checked-out revision's declared managed state. A plan that introduces an irreversible migration must define a separate backup and restoration contract before it can rely on this deployment system.

The installed controller is not automatically updated by a temporary target. An accepted controller change on `main` is activated through an explicit administrator operation after the current controller has successfully deployed that main revision. If activation fails, the prior installed controller remains available.

Tests operate on temporary roots, fake process tables, fake services, local Git repositories, and fake GitHub APIs. They must not register real runners, mutate the organization, alter the real `/etc`, stop the real primary service, or modify the production checkout.

## Artifacts and Notes

Keep evidence below append-only. Do not replace earlier evidence when a later run supersedes it; append the newer command, timestamp, revision, and result.

- 2026-07-21: Reviewed current repository deployment contracts on `main` baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- 2026-07-21: Reviewed GitHub persistent, ephemeral, JIT, registration-token, runner-label, runner-group, and workflow-restriction mechanisms. Selected a persistent recovery runner and PAT non-persistence for the single-VM design.
- 2026-07-21: Created draft PR #47 with this active plan. No production implementation or host change exists yet.
- 2026-07-21: Reorganized this plan according to the living ExecPlan structure used in PR #3. This revision changes only the active plan and does not claim implementation complete.

Expected evidence to append during work:

- baseline commit, ancestry, protected-file hashes, and current-state inspection;
- focused test commands and exact pass/fail counts for every milestone;
- any replaced baseline test and why the replacement is equal or stronger;
- GitHub runner group, selected-workflow, labels, registration names, and service evidence without credentials;
- real-host migration command and result;
- target, previous LKG, transaction ID, phases, updater status, smoke run ID, rollback status, and final active SHA for each demonstration;
- exact-head CI run and job IDs, test count, coverage, skipped/todo/cancelled count, and independent review result;
- final controller activation and operator documentation evidence.

Bounded deployment logs must report at least:

- event mode and request ID;
- requested PR or branch when applicable;
- resolved target SHA;
- previous LKG SHA;
- controller and transaction schema version;
- phase transitions and authoritative exit statuses;
- local service, listener, and deployed-marker result;
- smoke workflow run and result;
- rollback attempted, rollback SHA, and rollback result;
- final active SHA;
- critical recovery disposition when applicable.

Do not place raw untrusted updater lines directly into GitHub command-sensitive output. Prefix, escape, or otherwise normalize live lines, retain a bounded full transcript as an artifact, and exclude secrets and protected host paths not needed for diagnosis.

GitHub documentation reviewed for the design:

- `https://docs.github.com/en/actions/reference/runners/self-hosted-runners`
- `https://docs.github.com/en/rest/actions/self-hosted-runners`
- `https://docs.github.com/en/rest/actions/self-hosted-runner-groups`
- `https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners`

Non-goals:

- autoscaling or dynamically provisioning VMs;
- ephemeral or JIT runner lifecycle;
- persisting a PAT or GitHub App private key on this VM;
- supporting fork pull requests or arbitrary repositories;
- parallel deployments on one host;
- VM snapshot management;
- general reversal of arbitrary package, operating-system, Docker-data, credential, database, or application-data migrations;
- replacing GitHub Actions with a custom public deployment API;
- automatically activating controller code from a temporary target;
- claiming protection from malicious same-repository privileged code.

## Interfaces and Dependencies

No public Agent Relay job API, Codex request contract, prompt contract, result contract, finalizer decision, or workspace sandbox interface changes are required. The feature changes host installation, updater caller authentication, GitHub runner registrations and routing, deployment workflows, deployment state, and operator procedures.

Required host identities and registrations are:

    primary system user:      github-runner
    builder system user:      agent-relay-builder
    deployment system user:   agent-relay-deployer
    primary runner name:      gh-runner
    deployment runner name:   gh-deploy-runner
    primary label:            agent-relay-main
    deployment label:         agent-relay-deploy
    deployment runner group:  agent-relay-deployment

Required services are equivalent to:

    actions.runner.Divorium.gh-runner.service
    actions.runner.Divorium.gh-deploy-runner.service

The deployment service uses its own runner directory, work directory, and home. It does not use Codex login, the primary work root, the primary runner home, or the compiled Agent Relay `dist` as its executable dependency.

Protected host files and directories are equivalent to:

    /etc/agent-relay/administrator
    /etc/agent-relay/deployer
    /etc/sudoers.d/agent-relay-deployer
    /usr/local/libexec/agent-relay-deploy
    /var/lib/agent-relay-deploy/last-known-good-main-sha
    /var/lib/agent-relay-deploy/active-transaction.json
    /var/lib/agent-relay-deploy/deployed-sha
    /var/lib/agent-relay-deploy/logs/

Trust anchors, controller, state files, and sudoers policy are root-owned regular non-symlink files not writable by group or others. Private state and logs use restrictive modes; the deployed-SHA marker may be read by `github-runner` but not written by it. The implementation must specify and test exact modes.

The controller command interface is equivalent to:

    agent-relay-deploy main --sha <40-lowercase-hex> --request-id <id>
    agent-relay-deploy temporary --source-type pr --source <number> --sha <40-lowercase-hex> --request-id <id>
    agent-relay-deploy temporary --source-type branch --source <ref-name> --sha <40-lowercase-hex> --request-id <id>
    agent-relay-deploy recover --transaction-id <id>
    agent-relay-deploy abort --transaction-id <id>

Names may differ, but the exact-SHA, mode, request correlation, recovery, and no-arbitrary-command properties may not. The controller rejects unknown options, duplicate options, malformed IDs, additional positional arguments, unsafe environment overrides, and target SHA disagreement.

The transaction journal is versioned and equivalent to:

    interface DeploymentTransaction {
      schemaVersion: 1;
      transactionId: string;
      requestId: string;
      mode: "main" | "temporary";
      sourceType: "push" | "pr" | "branch";
      source: string;
      targetSha: string;
      lastKnownGoodSha: string;
      phase:
        | "prepared"
        | "target_checked_out"
        | "target_updating"
        | "target_validating"
        | "target_smoke"
        | "restoring"
        | "restored"
        | "critical_recovery";
      targetStatus?: number;
      smokeRunId?: number;
      rollbackStatus?: number;
      updaterProcessGroup?: number;
      startedAt: string;
      updatedAt: string;
    }

The exact serialization may differ, but it must be bounded, atomically replaced, strict-schema validated, free of secrets, and sufficient for deterministic restart handling.

The deployment workflow input interface is:

    target_type: pr | branch
    target: pull-request number or same-repository branch name

Automatic `main` deployment takes no user target input and uses exact `github.sha`. Manual dispatch must run the trusted workflow from `main`; selecting a target does not select workflow code from that target.

The smoke interface includes a unique request ID and expected deployed SHA. The trusted smoke workflow reads the controller-published marker, compares both values, and returns a GitHub workflow result that the deployment transaction polls within a fixed deadline. The implementation must record the selected deadline and polling interval as bounded constants or validated configuration.

GitHub API authentication during installation or migration requires only the permissions needed to create or validate the runner group, restrict access, obtain registration tokens, and inspect registrations. Deployment workflow permissions require only target metadata, actions dispatch and polling, and artifact upload as actually used. Tokens are provided to trusted controller or resolver code only and are removed from the child environment before target updater execution.

Use existing pinned host tools where possible: Bash, Git, curl, jq, systemd, coreutils, Node.js, and the official GitHub Actions runner archive. Add no third-party runtime package unless the implementation records why existing tools cannot provide deterministic parsing, process control, or API handling.

Revision note (2026-07-21): Converted the initial architecture notes into the PR #3 living ExecPlan structure. Preserved the automatic `main` deployment, manual exact-SHA target test, mandatory LKG restoration, persistent recovery runner, PAT non-persistence, restricted workflow routing, external controller, full transaction lock, smoke, rollback, double-failure, and validation decisions. Added dated progress, evidence-backed discoveries, structured decisions, six observable milestones, exact commands, acceptance scenarios, recovery semantics, artifacts, interfaces, and explicit human ownership of workflow changes. This revision changes only the active ExecPlan and does not claim implementation complete.
