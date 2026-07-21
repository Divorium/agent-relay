# Automate Agent Relay environment deployment and rollback

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current as work proceeds. Maintain this document in accordance with `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

The reviewed runtime baseline is `main` commit `e9ec636e5abf383f8831fc126b99f04e2e005a3c`. Before implementation starts, verify that this commit exists and is an ancestor of `HEAD`. If `main` advances, recheck every current-state statement, file path, workflow name, runner contract, GitHub API assumption, and referenced Docker decision before editing implementation files. Update this plan with the newly reviewed baseline and record the review in `Progress`; do not silently implement against a different baseline.

Codex may inspect Git state with read-only commands such as `status`, `diff`, `show`, `grep`, `rev-parse`, `show-ref`, `cat-file`, and `merge-base`. Codex must not run `git add`, `commit`, `merge`, `rebase`, `reset`, `restore`, `checkout`, `cherry-pick`, or `push`; the GitHub runner owns commit and push. Workflow files are human-maintained for this task. Codex must not edit `.github/workflows/` or `examples/github-actions/`; the human reviewer implements the workflow changes after repository and controller interfaces are stable.

## Purpose / Big Picture

Replace the current manual release procedure:

    cd /srv/github-runner/storage/agent-relay
    git pull --ff-only
    ./update.sh

with an observable deployment system for the single long-lived Agent Relay VM.

After this work:

- a push to `main` validates the exact pushed commit, skips it when it has already been superseded by a newer `origin/main`, and deploys it only after exact-SHA repository validation succeeds;
- an authorized operator can manually select an open same-repository pull request or branch, validate its exact SHA, run that revision's real `./update.sh` against the real host, observe the result, and always request restoration to the unchanged last-known-good `main` revision;
- the controller stops the primary listener and drains active primary jobs before changing the trusted checkout, so a running Codex job never observes repository files changing underneath it;
- a failed `main` deployment attempts to converge back to the previous verified `main` revision without depending on GitHub network access;
- a second persistent deployment runner remains available for accidental primary-runner, runtime, updater, or checkout failures that do not disable the whole VM;
- Git synchronization, drain, target update, local validation, primary-runner smoke, optional controller activation, restoration, and transaction cleanup are serialized as one host transaction;
- deployment and restoration results are reported independently, with bounded logs and an explicit critical-recovery state when automated restoration cannot prove success.

The selected revisions are trusted same-repository code and execute with broad host authority because the purpose is to test the real privileged updater. The system therefore provides **best-effort rollback for accidental failures**, not isolation from malicious code and not a general VM snapshot. A target with root-equivalent authority can damage the controller, deployment runner, recovery store, credentials, operating system, Docker data, or the VM itself. This plan must not describe root ownership, runner groups, environment sanitization, or a second runner on the same VM as protection against a malicious target.

This plan preserves the current Docker decision: `DOCKER_PROVISIONING_ENABLED=0` remains authoritative. The work must not re-enable Docker host provisioning in `update.sh` or reopen the Docker design from PR #46 unless the user explicitly creates a separate plan.

## Progress

Keep this section append-only for completed historical entries. Split partially completed work into a checked historical entry and a remaining unchecked entry. Every checked implementation item must identify a repository location plus passing automated evidence, or a reproducible command plus its captured result. Blocked items remain unchecked and use the `[blocked]` prefix required by `.agent/PLANS.md`.

- [x] (2026-07-21) Reviewed the current `README.md`, `docs/native-github-runner-specification.md`, `docs/operations/README.md`, `install.sh`, `update.sh`, `.github/workflows/ci.yml`, and `.github/workflows/codex.yml` contracts on baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- [x] (2026-07-21) Confirmed that the primary runner cannot synchronously update itself because `update.sh` stops its listener and waits for every `Runner.Worker` owned by `github-runner`.
- [x] (2026-07-21) Reviewed GitHub persistent, ephemeral, JIT, registration-token, runner-label, runner-group, selected-workflow, workflow-dispatch, environment-review, and concurrency-queue mechanisms.
- [x] (2026-07-21) Selected a second persistent deployment runner for the single long-lived VM instead of an ephemeral or JIT runner.
- [x] (2026-07-21) Converted the initial notes into the living ExecPlan structure used by PR #3.
- [x] (2026-07-21) Performed a devil's-advocate review and identified unsafe checkout timing, overstated recovery guarantees, incomplete authority ownership, weak LKG bootstrap, ambiguous smoke ownership, missing exact-SHA validation, incomplete queue semantics, missing operator authorization, fragile recovery state, controller-upgrade gaps, and insufficient acceptance coverage.
- [x] (2026-07-21) Revised the architecture to use controller-owned pre-checkout drain, broad-authority best-effort rollback, one transaction owner, exact-SHA validation, superseded-main skipping, `queue: max`, manual approval and operator authorization, a network-independent recovery repository, expanded journal semantics, controlled controller activation, and explicit preservation of Docker provisioning being disabled.
- [ ] Complete Milestone 0 and record GitHub-side feasibility evidence before implementation code is written.
- [ ] Revalidate the pinned baseline and all human-maintained workflow files immediately before implementation. Record exact commands and output in `Artifacts and Notes`.
- [ ] Implement fresh-install and existing-host migration boundaries for the deployment account, second runner, restricted runner group, protected controller, recovery repository, state roots, services, operator policy, and bootstrap marker.
- [ ] Implement controller-owned primary-listener stop and bounded drain before any checkout mutation, with safe listener restoration when drain fails or times out.
- [ ] Implement the trusted deployment controller, exact request validation, protected Git operations under the recorded administrator identity, atomic transaction journal, bounded updater process-group execution, local health checks, smoke ownership, restoration, and critical-recovery state.
- [ ] Implement exact target resolution, superseded-main handling, local recovery refs, initial LKG bootstrap, and controlled controller activation.
- [ ] Human reviewer: add exact-SHA validation, deployment, manual-approval, and smoke workflow changes; route ordinary jobs only to `agent-relay-main`; configure branch protection, runner-group restrictions, environments, and concurrency queueing.
- [ ] Add deterministic unit, contract, integration, and system coverage for feasibility, installation, migration, drain, checkout ownership, validation, ordering, transactions, interruption, smoke, restoration, logging, credentials, controller activation, and bootstrap races.
- [ ] Run focused validation, `npm run check`, `git diff --check`, exact-head CI, and independent point-by-point review of every unchecked plan item.
- [ ] Perform the real-host migration and successful/failed temporary demonstrations. Perform failed-main, restart-recovery, and controller-activation demonstrations on a disposable clone or snapshot-equivalent VM before completion.
- [ ] Update `Outcomes & Retrospective`, append final evidence and a revision note, and move this same plan to `docs/exec-plans/completed/` only after every item is checked.

## Surprises & Discoveries

- Observation: changing the trusted checkout before the primary worker finishes can change scripts used by an active Codex job.
  Evidence: current workflows execute `runner/resolve-request.mjs`, `runner/resolve-pr.mjs`, `runner/run-codex.mjs`, and `runner/finalize.sh` directly from `/srv/github-runner/storage/agent-relay`. The controller must drain the primary worker before `git reset`.

- Observation: another runner under the same `github-runner` UID would retain the updater self-wait deadlock.
  Evidence: the current wait condition is UID plus process name, not runner registration name, directory, service, label, or workflow identity.

- Observation: root-owned controller files do not form a security boundary against a target updater executed with root-equivalent authority.
  Evidence: such a target can modify or remove root-owned files, services, credentials, recovery data, networking, and the VM. Recovery guarantees must therefore be limited to accidental failures.

- Observation: the existing updater lock is too narrow for automatic deployment.
  Evidence: its `flock` begins inside `update.sh`, after Git operations would occur, and ends before external smoke or restoration. The authoritative lock must cover the complete host transaction.

- Observation: the recorded administrator, root controller, and deployment account have different ownership responsibilities.
  Evidence: the checkout is administrator-owned, host state is root-owned, and the deployment runner must not gain general write access to either. Git operations must run as the recorded administrator through the root controller; privileged host state remains root-owned.

- Observation: the current checkout SHA does not prove which revision produced the active `dist` runtime.
  Evidence: the current runtime has no accepted-SHA marker. Initial LKG cannot be seeded from `HEAD` plus `systemctl is-active`; migration must redeploy and smoke an exact SHA first.

- Observation: current `origin/main` is not rollback state after a failed merge deployment.
  Evidence: when a bad commit reaches `main`, the remote branch already resolves to that bad commit. Rollback requires the previously accepted host state.

- Observation: a plain SHA file does not preserve the Git object needed for restoration.
  Evidence: force-push, ref deletion, garbage collection, or `.git` damage can make the SHA unavailable. Accepted state needs a protected local recovery repository and ref.

- Observation: restoration must not require GitHub availability.
  Evidence: network or DNS failure may be part of the deployment incident. The controller must restore the tracked LKG tree from locally retained objects.

- Observation: `update.sh` exit zero and `systemctl is-active` do not prove that GitHub can schedule work on the primary runner.
  Evidence: a listener may be active but disconnected, misregistered, or unroutable. Acceptance requires a bounded trusted smoke job on `agent-relay-main`.

- Observation: exact-SHA validation is required before host mutation.
  Evidence: current CI does not run on `push` to `main`, and a merge commit can differ from a previously validated PR head. Deployment must run or verify the complete repository check for the exact target SHA.

- Observation: GitHub concurrency defaults can replace an existing pending deployment.
  Evidence: `cancel-in-progress: false` alone retains only one pending run. The deployment workflow requires `queue: max`, while the controller independently serializes and rejects stale or superseded requests.

- Observation: `workflow_dispatch` can be invoked with a non-default ref.
  Evidence: the workflow must exist on the default branch, but callers can select another ref. Manual deployment must fail unless `github.ref == refs/heads/main` and the trusted workflow restriction is satisfied.

- Observation: runner-group access does not authorize the human operator.
  Evidence: any repository user with sufficient write access can dispatch a workflow. Temporary privileged deployment needs a required-review environment and a root-owned operator allowlist enforced through trusted workflow metadata.

- Observation: a second runner on the same VM is only a recovery channel for a bounded class of failures.
  Evidence: it cannot survive VM, disk, network, systemd, resource-exhaustion, or malicious-root failures. Documentation must state this limitation consistently.

- Observation: target branch movement after exact-SHA resolution does not invalidate the selected transaction.
  Evidence: all later work is pinned to the resolved SHA. A moving branch may be reported, but must not cause the controller to follow or re-resolve it.

- Observation: controller upgrades are part of deployment correctness.
  Evidence: accepting `main` before activating a required controller change can leave code and host orchestration incompatible. Candidate activation needs staging, self-test, atomic switch, previous-version retention, and rollback before LKG publication.

## Decision Log

- Decision: use a second persistent organization runner on the same VM, not an ephemeral or JIT runner.
  Rationale: the system has one long-lived VM and needs a recovery path independent of the primary runner process. Ephemeral creation adds persistent API credentials and lifecycle complexity without VM isolation.
  Date/Author: 2026-07-21 / operator-approved design revision.

- Decision: describe automated restoration as best effort against accidental failure, not as protection from malicious same-repository code.
  Rationale: the real updater requires broad host authority, which can defeat every same-VM control.
  Date/Author: 2026-07-21 / devil's-advocate correction approved by operator.

- Decision: the root-owned controller is the single owner of the complete transaction, including drain, Git mutation, updater execution, smoke dispatch and polling, controller activation, restoration, and final state.
  Rationale: splitting ownership between workflow and controller creates ambiguous locks, credentials, timeout behavior, and restart recovery.
  Date/Author: 2026-07-21 / architecture correction.

- Decision: stop the primary listener and drain all `github-runner` workers before any checkout mutation.
  Rationale: active jobs execute scripts from the trusted checkout and must not observe a mid-job revision change.
  Date/Author: 2026-07-21 / safety correction.

- Decision: drain is bounded and non-destructive. On timeout the controller does not kill the active GitHub job, performs no checkout mutation, restores the primary listener, records `drain_timeout`, and fails the deployment request.
  Rationale: automatic deployment must not silently terminate Codex work. The exact default deadline must be documented and configurable; initial design target is 7200 seconds.
  Date/Author: 2026-07-21 / operational policy.

- Decision: keep the deployment runner under `agent-relay-deployer`, but execute Git mutations as the recorded administrator through the root controller.
  Rationale: the checkout remains administrator-owned; the deployer receives no direct write access. Root owns services, state, process control, and recovery data.
  Date/Author: 2026-07-21 / ownership correction.

- Decision: preserve manual `update.sh` behavior for the recorded administrator and add an explicit controller mode used only by the root-owned controller after drain.
  Rationale: automated execution cannot depend on an interactive sudo ticket, while ordinary manual updates must remain supported. Controller mode may execute as root and must verify the same source-path and ownership contracts against the recorded administrator.
  Date/Author: 2026-07-21 / authority correction.

- Decision: confine the deployment runner to group `agent-relay-deployment`, repository `Divorium/agent-relay`, and `.github/workflows/deploy.yml@refs/heads/main`, with label `agent-relay-deploy`.
  Rationale: the repository is public and the runner invokes privileged host code. Workflow restriction is required in addition to labels.
  Date/Author: 2026-07-21 / GitHub access-control review.

- Decision: make GitHub-side capability verification Milestone 0 and fail closed before implementation when workflow-restricted runner groups or required controls are unavailable or read-only.
  Rationale: the architecture must not discover that its security boundary is unavailable only after privileged host components have been installed.
  Date/Author: 2026-07-21 / feasibility correction.

- Decision: do not persist the operator PAT or a GitHub App private key.
  Rationale: persistent runners need the credential only during installation or migration to obtain short-lived registration tokens and configure GitHub-side controls.
  Date/Author: 2026-07-21 / authentication review.

- Decision: temporary deployment requires both a trusted workflow from `main` and explicit operator authorization.
  Rationale: same-repository membership is not sufficient. The workflow uses a protected environment with required review and passes the immutable `github.actor`; the controller checks that actor against `/etc/agent-relay/deployment-operators`.
  Date/Author: 2026-07-21 / authorization correction.

- Decision: automatic and manual deployment use the same workflow-level concurrency group with `queue: max`; host locking remains authoritative.
  Rationale: pending runs must not silently replace each other, but GitHub ordering is not sufficient for host correctness.
  Date/Author: 2026-07-21 / queue correction.

- Decision: an automatic `main` request mutates the host only when its target SHA still equals current `origin/main` at transaction start. Otherwise it is reported as `superseded` without deployment.
  Rationale: an older queued run must never downgrade the host after a newer main commit exists.
  Date/Author: 2026-07-21 / ordering policy.

- Decision: every target must pass the complete repository validation for the exact SHA before the privileged controller job starts.
  Rationale: PR-head CI does not prove a merge SHA, and current CI does not validate pushes to `main`.
  Date/Author: 2026-07-21 / validation correction.

- Decision: manual branch or PR names are resolved once to an exact SHA. Later branch movement is informational and does not alter or invalidate the pinned transaction.
  Rationale: re-resolving a moving ref reintroduces nondeterminism.
  Date/Author: 2026-07-21 / exact-SHA correction.

- Decision: maintain accepted state in both a root-owned metadata file and a root-owned bare recovery repository with `refs/agent-relay/last-known-good`.
  Rationale: a SHA string does not retain the Git object and restoration must work without GitHub network access.
  Date/Author: 2026-07-21 / recovery correction.

- Decision: bootstrap LKG only by deploying, locally validating, smoking, and recording one exact `main` SHA during migration.
  Rationale: checkout HEAD and service status do not identify the source revision of the existing runtime.
  Date/Author: 2026-07-21 / bootstrap correction.

- Decision: deployment runner service starts only after controller, state, recovery repository, LKG, group restrictions, labels, operator policy, and `bootstrap-complete` marker are installed atomically enough to fail closed.
  Rationale: queued workflows must not race an incomplete migration.
  Date/Author: 2026-07-21 / bootstrap-race correction.

- Decision: remove the ambiguous `abort` operation. Provide `status`, `recover`, and an administrator-only `acknowledge-repair` operation.
  Rationale: an undefined abort could discard evidence or leave an unverified target active. `recover` only converges to LKG; `acknowledge-repair` archives a critical journal after the administrator independently verifies the active state.
  Date/Author: 2026-07-21 / recovery-interface correction.

- Decision: activate controller changes as part of accepted `main` deployment when the target changes controller source.
  Rationale: candidate code must be staged, self-tested, atomically activated, and rolled back before the new main SHA becomes LKG.
  Date/Author: 2026-07-21 / controller-upgrade correction.

- Decision: keep `DOCKER_PROVISIONING_ENABLED=0` unchanged.
  Rationale: this deployment plan must not reopen the separate Docker-host provisioning decision.
  Date/Author: 2026-07-21 / scope correction.

## Outcomes & Retrospective

This plan remains active. No installer, updater, controller, workflow, service, runner registration, GitHub configuration, or production host behavior has been changed by the plan-only commits.

The revised design no longer claims a same-VM security boundary against privileged target code. Its intended value is narrower and testable: it prevents checkout mutation during active primary work, validates exact revisions before privileged execution, preserves a network-independent accepted revision for accidental recovery, serializes host changes, and reports when restoration cannot be proven.

The work remains larger than a simple `git pull && ./update.sh` wrapper because the current updater stops its own runner, the checkout is shared with active jobs, and rollback must survive a broken target revision. The implementation should still be staged by milestones and must stop at Milestone 0 if GitHub-side controls are unavailable.

Update this section after each accepted milestone with implemented behavior, deviations, operational evidence, and lessons learned. On completion, state the final real-VM and disposable-VM results and move this same plan to `completed` without replacing it with a summary.

## Context and Orientation

Agent Relay currently runs on one systemd-capable dedicated Linux host. Current paths and identities are:

- `/srv/github-runner/storage/agent-relay`: administrator-owned trusted source checkout and root-owned compiled `dist`;
- `/srv/github-runner/storage/work`: workflow workspaces owned by `github-runner`;
- `/srv/github-runner/storage/runner`: official primary GitHub Actions runner;
- `/srv/github-runner/storage/home`: primary runner home and Codex authentication;
- `/srv/github-runner/storage/build` and `build-home`: builder state;
- `github-runner`: primary runner and Codex account, without sudo;
- `agent-relay-builder`: runtime compiler account, without sudo;
- `/etc/agent-relay/administrator`: root-owned file naming the human administrator allowed to run the current updater;
- `actions.runner.Divorium.gh-runner.service`: primary runner systemd unit.

`install.sh` is a one-time installer. It installs pinned toolchains, creates accounts and storage, downloads and verifies the official runner archive, asks for an organization credential only when registration is absent, obtains a short-lived registration token, configures `gh-runner`, installs the primary service, records the administrator, and performs Codex login.

`update.sh` currently accepts no arguments, requires the exact source path and recorded administrator, acquires sudo, stops the primary listener, waits without a deadline while a `Runner.Worker` owned by `github-runner` exists, deletes and recreates `dist`, compiles as `agent-relay-builder`, verifies the entrypoint, applies root ownership and read-only modes, and starts the primary service. Docker provisioning is disabled.

Current CI and Codex jobs use bare `[self-hosted]`. Adding a second runner without routing changes could send ordinary jobs to the deployment runner. Human-maintained workflows must route ordinary validation, Codex, and smoke work to `[self-hosted, agent-relay-main]`, and route only the trusted deployment job through the restricted deployment group and label.

Expected new host layout is equivalent to:

    /srv/github-runner/storage/deploy-runner
    /srv/github-runner/storage/deploy-work
    /srv/github-runner/storage/deploy-home
    /var/lib/agent-relay-deploy/
      bootstrap-complete
      last-known-good-main-sha
      active-transaction.json
      deployed-state.json
      recovery.git/
      controller-versions/
      logs/
    /usr/local/libexec/agent-relay-deploy -> /var/lib/agent-relay-deploy/controller-versions/<version>/agent-relay-deploy
    /etc/agent-relay/deployment-operators
    /etc/agent-relay/deployer
    /etc/sudoers.d/agent-relay-deployer

Terms:

- **primary runner**: existing `gh-runner`, executing CI, Codex, exact-SHA validation, and smoke;
- **deployment runner**: `gh-deploy-runner`, executing only the trusted deployment job;
- **controller**: root-owned installed transaction owner outside the checkout;
- **target SHA**: one exact commit selected after resolving a push, PR, or branch input;
- **LKG**: the most recent `main` SHA that completed drain, update, local validation, smoke, required controller activation, and accepted-state publication;
- **recovery repository**: root-owned bare Git repository retaining the LKG object and `refs/agent-relay/last-known-good`;
- **temporary target**: manually selected same-repository PR or branch tested but never promoted;
- **local health**: expected runtime entrypoint, active primary service, expected listener process, and exact deployed-state marker;
- **smoke**: trusted primary-runner job correlated to transaction ID, request ID, and target SHA;
- **critical recovery**: target or infrastructure failure followed by restoration that did not complete or could not be proven.

## Plan of Work

### Milestone 0: Prove GitHub-side feasibility and operator controls

Before implementation, verify with organization/repository settings and API responses that:

- an additional organization runner group can be created or managed;
- the group can allow this public repository, restrict repository access to `Divorium/agent-relay`, and restrict workflow access to `Divorium/agent-relay/.github/workflows/deploy.yml@refs/heads/main`;
- workflow restrictions are not inherited read-only in a conflicting configuration;
- the installation credential has only the permissions needed for runner groups, runner registration, labels, and inspection;
- repository environments and required reviewers are available for the public repository;
- the authorized temporary-deployment operators are identified;
- `main` protection prevents unauthorized direct changes to the trusted deployment workflow;
- current GitHub Actions supports `concurrency.queue: max` for this repository.

If any required control is unavailable, record `[blocked]`, do not install a privileged deployment runner, and revise the architecture with the operator.

### Milestone 1: Revalidate baseline and freeze ownership

Verify the reviewed commit, current branch ancestry, installer/updater behavior, workflow names, package scripts, Docker provisioning state, and `.agent/PLANS.md`. Record hashes or diffs for every human-maintained workflow.

Codex-owned scope may include `install.sh`, `update.sh`, migration scripts, controller source, target-resolution helpers, state handling, tests, package scripts, operator documentation, and this plan. Human-owned scope is `.github/workflows/`, `examples/github-actions/`, GitHub settings, final commit/push, exact-head CI review, and real-host operations.

### Milestone 2: Build installation, migration, and bootstrap boundaries

Extend fresh installation and add a restartable existing-host migration. They must:

- create `agent-relay-deployer` with separate home, runner, work, and service paths;
- configure the restricted runner group and labels only after Milestone 0 is satisfied;
- install the root-owned controller, version directory, recovery repository, state/log roots, operator allowlist, and narrow sudo entry permitting only the controller command;
- preserve PAT non-persistence and use separate short-lived registration tokens;
- keep the deployment service stopped during incomplete setup;
- bootstrap one exact current `main` SHA by draining the primary runner, deploying it, running local validation and smoke, storing it in the recovery repository, publishing LKG and deployed state, and restoring primary availability;
- write `bootstrap-complete` only after every host and GitHub-side invariant is validated;
- enable and start the deployment runner service last.

Partial or conflicting state fails closed. A queued deployment that reaches the host before bootstrap completion must exit without mutation.

### Milestone 3: Implement controller-owned drain, state, and restoration

Implement one full-transaction `flock`. The controller must:

1. validate caller, actor, event, request schema, bootstrap marker, checkout path, owner, remote, recovery repository, LKG, and journal;
2. stop only the primary listener service;
3. wait up to the configured drain deadline for every `github-runner` `Runner.Worker` to finish;
4. on drain failure or timeout, restart the primary listener, leave checkout and runtime unchanged, record the outcome, and exit;
5. after successful drain, record durable transaction state before checkout mutation;
6. run Git fetch/reset/clean as the recorded administrator, never as the deployment account;
7. run the target updater in controller mode under a dedicated process group with a sanitized child environment;
8. perform local health validation;
9. dispatch and poll the trusted smoke while retaining transaction ownership and host lock;
10. accept or restore according to transaction mode;
11. leave the primary listener in a known state on every noncritical exit.

The controller must retain the target process group until it proves all descendants ended. Restoration uses the local recovery repository and must not require network access. If the production checkout Git metadata is accidentally unusable, the controller may reconstruct the managed checkout from the recovery repository while preserving administrator ownership.

Environment sanitization prevents accidental token inheritance; it is not claimed to protect credentials from malicious root code. Controller logs must not print token values or pass tokens in command-line arguments.

### Milestone 4: Implement exact request, validation, ordering, and transaction modes

The trusted workflow resolves human-readable input once. Manual mode accepts only `pr` or `branch`, rejects forks, tags, merge refs, arbitrary URLs, malformed names, and missing objects, then records one exact SHA. Later branch movement is reported but ignored.

Before the deployment runner job starts, a nonprivileged exact-SHA validation job on `agent-relay-main` checks out the selected SHA with persisted credentials disabled and runs the complete repository validation (`npm ci` and `npm run check` or its final equivalent). The privileged deployment job cannot run when validation fails.

Automatic `main` mode:

1. receives exact `github.sha` from a `push` to `main`;
2. passes exact-SHA validation;
3. at controller transaction start fetches origin and compares the requested SHA with current `origin/main`;
4. reports `superseded` and performs no host mutation when they differ;
5. otherwise drains, deploys, validates, smokes, activates any required controller candidate, writes the accepted commit into the recovery repository, atomically updates the LKG ref and metadata, and finishes.

Temporary mode:

1. requires `workflow_dispatch` running with `github.ref == refs/heads/main`;
2. requires protected-environment approval and authorized actor;
3. passes exact-SHA validation;
4. drains, deploys, locally validates, and smokes the target;
5. records target success or failure;
6. always restores unchanged LKG from local recovery state, reruns stable update, validates and smokes restoration;
7. reports target and restoration results separately;
8. never changes LKG.

### Milestone 5: Add workflow routing, queueing, authorization, and smoke

The human reviewer adds or updates workflows after interfaces are stable.

`deploy.yml` must:

- trigger automatically on `push` to `main` and manually through `workflow_dispatch`;
- reject manual runs whose `github.ref` is not `refs/heads/main`;
- use one deployment concurrency group with `queue: max` and no `cancel-in-progress: true`;
- resolve one exact target SHA;
- run exact-SHA validation on `[self-hosted, agent-relay-main]` before privileged deployment;
- use a protected environment with required review for temporary mode;
- pass immutable event type, actor, workflow run ID, request ID, source, and SHA to the controller;
- route the privileged job through the selected workflow-restricted group and `agent-relay-deploy` label;
- never check out or execute workflow logic from the target branch in the privileged job;
- normalize untrusted updater output before writing live GitHub logs and upload only bounded diagnostic artifacts.

The trusted smoke workflow or directly defined smoke job must execute on `[self-hosted, agent-relay-main]`, read the atomically published deployed-state record, compare transaction ID, request ID, and target SHA, perform no Codex or source mutation, and finish within a fixed deadline. The controller alone dispatches, polls, times out, and interprets smoke.

All existing self-hosted jobs and examples must receive explicit main-runner routing. No production workflow may retain bare `[self-hosted]`.

### Milestone 6: Implement controller upgrade, documentation, and acceptance

When an accepted `main` target changes controller source, the current controller must:

- stage the candidate in a versioned root-owned directory;
- verify expected source ownership, mode, hash, syntax, schema compatibility, and a deterministic self-test;
- retain the currently active controller version;
- atomically switch the installed controller symlink;
- execute an immediate post-switch status/self-test;
- switch back on failure;
- publish the target as LKG only after activation succeeds.

Temporary targets never activate controller code.

Update operator documentation only after behavior exists. Document installation, migration, operator authorization, queueing, superseded main runs, exact-SHA validation, drain timeout, state, recovery repository, deployment invocation, temporary restoration, controller upgrades, critical recovery, bounded logs, Docker provisioning remaining disabled, and the best-effort rollback limitation.

## Concrete Steps

Run repository commands from the repository root. Codex performs no Git mutation and does not edit human-maintained workflow files.

Verify baseline:

    git cat-file -e e9ec636e5abf383f8831fc126b99f04e2e005a3c^{commit}
    git merge-base --is-ancestor e9ec636e5abf383f8831fc126b99f04e2e005a3c HEAD
    git status --short
    git diff --name-status e9ec636e5abf383f8831fc126b99f04e2e005a3c...HEAD
    git show e9ec636e5abf383f8831fc126b99f04e2e005a3c:install.sh >/dev/null
    git show e9ec636e5abf383f8831fc126b99f04e2e005a3c:update.sh >/dev/null
    git grep -n 'DOCKER_PROVISIONING_ENABLED=0' e9ec636e5abf383f8831fc126b99f04e2e005a3c -- update.sh
    git diff --exit-code e9ec636e5abf383f8831fc126b99f04e2e005a3c -- .agent/PLANS.md .github/workflows examples/github-actions

Expected result: all commands exit zero and Docker provisioning remains disabled. Any unexplained mismatch is `[blocked]`.

Record Milestone 0 evidence from GitHub settings or API without credentials. Required evidence includes runner-group properties, `allows_public_repositories`, `restricted_to_workflows`, selected repository/workflow, `workflow_restrictions_read_only`, environment protection, authorized operators, main protection, and queue syntax support.

Inspect current contracts:

    sed -n '1,380p' install.sh
    sed -n '1,420p' update.sh
    sed -n '1,280p' docs/native-github-runner-specification.md
    sed -n '1,260p' docs/operations/README.md
    sed -n '1,260p' .github/workflows/ci.yml
    sed -n '1,300p' .github/workflows/codex.yml
    cat package.json

Focused implementation checks must include final equivalent commands for:

    bash -n install.sh scripts/*.sh test-system/*.sh
    npm run build
    node --test dist/test/installer.test.js
    node --test dist/test/deployment-migration.test.js
    node --test dist/test/deployment-controller.test.js
    node --test dist/test/deployment-resolver.test.js
    node --test dist/test/deployment-journal.test.js
    node --test dist/test/controller-activation.test.js
    bash test-system/deployment-migration.integration.sh
    bash test-system/deployment-transactions.integration.sh

Tests must use temporary roots, fake process tables, fake services, local Git repositories, a local bare recovery repository, and fake GitHub API responses. They must not mutate the organization or production host.

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

Expected result: every command exits zero, coverage thresholds remain satisfied, no baseline test is weakened without an equal or stronger replacement recorded in `Progress`, and Docker provisioning remains disabled.

Real-host migration must demonstrate:

- existing primary runner becomes explicitly labeled `agent-relay-main`;
- deployment runner is in the restricted group and has only `agent-relay-deploy` routing;
- controller, recovery repository, LKG, operator policy, state, logs, and sudoers have expected ownership and modes;
- bootstrap redeploys and smokes one exact `main` SHA before writing LKG;
- deployment service starts only after `bootstrap-complete` exists;
- no PAT or registration token remains.

Production-VM demonstrations:

1. successful temporary target followed by successful mandatory restoration;
2. controlled temporary updater failure followed by successful restoration;
3. drain timeout with no checkout mutation and primary listener restoration;
4. superseded automatic-main request skipped without host mutation;
5. successful exact-main deployment becoming LKG.

Disposable snapshot/clone VM demonstrations:

1. failed main deployment with successful network-independent restoration;
2. restart during target update and deterministic restoration from journal;
3. restart during restoration and successful `recover` continuation;
4. controller candidate activation success and activation rollback failure path;
5. target and restoration double failure entering critical recovery while preserving evidence.

## Validation and Acceptance

Acceptance is based on observable host and GitHub behavior, not code presence, intended design, local service status alone, resolved review comments, or a future promise to migrate the VM.

Feasibility acceptance proves the actual organization can enforce the selected repository and workflow restrictions for the public repository, that restrictions are writable, and that temporary deployment has a working required-review and operator-authorization path.

Drain acceptance starts a controlled primary job, begins deployment, proves the listener stops accepting new work, proves the checkout does not change while `Runner.Worker` exists, and proves timeout restarts the listener without killing the worker or touching Git/runtime state.

Ownership acceptance proves deployer cannot write the checkout, state, recovery repository, controller, operator policy, or sudoers directly; Git changes made by the controller retain the recorded administrator ownership contract; root-owned state remains root-owned.

Exact-SHA acceptance proves the complete repository check runs against the selected SHA before privileged work. A failed check prevents controller invocation. A moved manual branch does not change the pinned SHA. A stale main request becomes `superseded` and cannot downgrade the host.

Queue acceptance starts at least three deployment runs and proves `queue: max` retains pending runs, host locking prevents interleaving, and controller supersession checks make ordering safe even when GitHub start order differs from dispatch order.

Manual-authorization acceptance proves a nonauthorized actor or unapproved environment cannot reach the privileged job, while an approved authorized actor can. A dispatch whose workflow ref is not `refs/heads/main` fails before target resolution or controller invocation.

Bootstrap acceptance starts from the supported one-runner installation. It redeploys and smokes an exact current-main SHA before LKG publication, writes the recovery ref and metadata consistently, writes `bootstrap-complete` last, then starts the deployment service. An already queued run cannot mutate the host before bootstrap completion.

Main-deployment acceptance drains safely, validates current `origin/main`, runs the real updater in controller mode, validates local state, completes correlated smoke, activates any required controller candidate, stores the accepted commit locally, and updates LKG atomically. Final checkout, runtime marker, recovery ref, controller version, primary runner, and LKG agree.

Failed-main acceptance on the disposable VM injects deterministic failure after checkout mutation, proves target descendants are gone, restores from local recovery with GitHub network disabled, reruns stable update, completes restoration smoke, leaves LKG unchanged, and reports target failure plus restoration success.

Temporary acceptance proves both successful and failed targets always restore unchanged LKG and report target/restoration results separately. The final host never remains on a temporary SHA.

Journal/restart acceptance covers every phase: pre-drain, drained, checkout, target update, local validation, smoke dispatch/wait, controller activation, LKG publication, restoration checkout/update/validation/smoke, completion, superseded, and critical recovery. Unknown or contradictory state blocks new work.

Controller-activation acceptance proves candidate staging, self-test, schema compatibility, atomic switch, post-switch verification, previous-version retention, and switchback. LKG is not updated when required activation fails.

Credential acceptance proves PAT and registration tokens are not persisted, target child environment does not accidentally inherit `GITHUB_TOKEN` or controller credentials, and known credential values are absent from logs and process arguments. The documentation explicitly states that malicious root target code is outside this guarantee.

Logging acceptance defines exact byte limits. A root-only local transcript is bounded and contains a truncation marker when the limit is reached; the GitHub artifact is a bounded normalized diagnostic view, not described as a full transcript. Live output cannot inject GitHub workflow commands.

Critical-recovery acceptance injects target and restoration failure. The controller leaves LKG unchanged, preserves journal and bounded logs, stops automatic retries, leaves the deployment runner available when the VM permits, and requires administrator `recover` or independently verified `acknowledge-repair`.

The plan is complete only when every unchecked `Progress` item is checked with evidence, focused and repository tests pass, exact-head CI passes, independent review finds no unresolved action point, production demonstrations pass, and disposable-VM failed-main/restart/controller-upgrade scenarios pass.

## Idempotence and Recovery

Fresh installation remains a one-time operation. Ordinary releases must not rerun `install.sh`. Fresh setup and migration distinguish absent, exact, partial, and conflicting state and compensate only attempt-owned temporary resources.

Migration is restartable. It does not enable the deployment service until all protected components, GitHub controls, exact accepted LKG, recovery objects, and bootstrap marker exist. Exact completed state is validation-only. Conflicting accounts, services, registrations, groups, policies, refs, or files fail closed.

The controller journal uses unique same-directory temporary files, file sync as required by the selected durability contract, and atomic rename. It records enough information to decide whether primary drain completed, checkout mutation began, a target process may remain, which local LKG must be restored, whether smoke or activation began, and whether manual recovery is required.

`recover` never resumes or retries the failed target. It terminates surviving target descendants, restores the recorded LKG from the local recovery repository, runs stable update, validates local state and smoke, and clears/archive journal only on success.

`acknowledge-repair` is administrator-only. It does not mutate the host. It requires the administrator to supply and verify the active SHA and records evidence before archiving a critical journal. It cannot silently set a temporary target as LKG; changing LKG still requires an accepted main transaction or explicit separately documented bootstrap repair.

LKG metadata and the recovery ref change together through an ordered, recoverable publication protocol. A crash may leave old accepted state or a detectable incomplete acceptance, never an unverified new LKG. Temporary and failed targets never change accepted state.

Restoration does not fetch GitHub. The root-owned recovery repository retains the LKG object. Controller tests must cover reconstruction of the managed checkout after accidental index, ref, or production `.git` damage. This does not protect against malicious root deletion of the recovery repository.

The controller version switch uses immutable version directories and an atomic symlink. The previous version remains retained until the next accepted deployment. Journal schema changes require explicit backward compatibility or migration before switch.

## Artifacts and Notes

Keep evidence append-only.

- 2026-07-21: Reviewed repository deployment contracts on baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- 2026-07-21: Reviewed GitHub runner, runner-group, workflow restriction, workflow-dispatch, environment, and concurrency mechanisms.
- 2026-07-21: Created draft PR #47 with an active plan and no production implementation.
- 2026-07-21: Converted the plan to the PR #3 living ExecPlan structure.
- 2026-07-21: Devil's-advocate review found architecture and acceptance defects, including checkout-before-drain, overstated same-VM recovery guarantees, incomplete ownership and authorization, missing exact-SHA gate, unsafe queue semantics, weak LKG storage, incomplete journal, and controller-upgrade gaps.
- 2026-07-21: Revised the plan to address those findings and explicitly preserved Docker provisioning as disabled.

Required future evidence includes:

- Milestone 0 API/settings output without secrets;
- baseline and protected-file hashes;
- exact test commands, counts, coverage, and failures;
- ownership and mode evidence;
- runner names, groups, labels, selected workflow, environment, and branch protection;
- drain timing and checkout immutability evidence;
- exact validation SHA and result;
- transaction IDs, source, target, previous LKG, origin-main-at-start, phases, process status, smoke run, controller version, restoration result, and final state;
- recovery repository ref/object verification;
- production and disposable-VM demonstration records;
- exact-head CI and independent review.

GitHub documentation reviewed:

- `https://docs.github.com/en/actions/reference/runners/self-hosted-runners`
- `https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access`
- `https://docs.github.com/en/rest/actions/self-hosted-runner-groups`
- `https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow`
- `https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments`
- `https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax`

Non-goals:

- hostile-code isolation;
- guaranteeing recovery from malicious root code, VM, disk, network, systemd, or resource-exhaustion failures;
- autoscaling or ephemeral/JIT runners;
- persisting PAT or GitHub App credentials;
- fork or arbitrary-repository targets;
- parallel host mutation;
- VM snapshot management by Agent Relay;
- general reversal of packages, credentials, databases, Docker volumes, or arbitrary application data;
- re-enabling Docker provisioning in `update.sh`;
- automatically activating controller code from temporary targets.

## Interfaces and Dependencies

No public Agent Relay job API, Codex request contract, prompt contract, result contract, finalizer decision, or workspace sandbox interface changes are required.

Required identities and registrations:

    recorded administrator:    read from /etc/agent-relay/administrator
    primary system user:       github-runner
    builder system user:       agent-relay-builder
    deployment system user:    agent-relay-deployer
    primary runner name:       gh-runner
    deployment runner name:    gh-deploy-runner
    primary label:             agent-relay-main
    deployment label:          agent-relay-deploy
    deployment runner group:   agent-relay-deployment

Required services:

    actions.runner.Divorium.gh-runner.service
    actions.runner.Divorium.gh-deploy-runner.service

The deployer may invoke only the installed controller through sudo. It cannot directly run arbitrary sudo commands, mutate the checkout, or read root-only state. The controller runs Git as the recorded administrator, invokes `update.sh` in explicit controller mode, and owns privileged process/service/state operations.

Controller interface is equivalent to:

    agent-relay-deploy status
    agent-relay-deploy main --sha <40-lowercase-hex> --request-id <id> --actor <login> --workflow-run-id <id>
    agent-relay-deploy temporary --source-type pr --source <number> --sha <40-lowercase-hex> --request-id <id> --actor <login> --workflow-run-id <id>
    agent-relay-deploy temporary --source-type branch --source <ref-name> --sha <40-lowercase-hex> --request-id <id> --actor <login> --workflow-run-id <id>
    agent-relay-deploy recover --transaction-id <id>
    agent-relay-deploy acknowledge-repair --transaction-id <id> --active-sha <40-lowercase-hex> --evidence <bounded-text>

Unknown options, duplicates, malformed IDs, unsafe environment overrides, additional positional arguments, unauthorized actors, non-main manual workflow refs, target disagreement, or missing bootstrap fail before host mutation.

`deployed-state.json` is atomically published and equivalent to:

    interface DeployedState {
      schemaVersion: 1;
      transactionId: string;
      requestId: string;
      targetSha: string;
      controllerVersion: string;
      publishedAt: string;
    }

The transaction journal is versioned and equivalent to:

    interface DeploymentTransaction {
      schemaVersion: 1;
      controllerVersion: string;
      transactionId: string;
      requestId: string;
      workflowRunId: number;
      actor: string;
      mode: "main" | "temporary";
      sourceType: "push" | "pr" | "branch";
      source: string;
      targetSha: string;
      originMainShaAtStart?: string;
      previousCheckoutSha: string;
      lastKnownGoodSha: string;
      recoveryRef: "refs/agent-relay/last-known-good";
      phase:
        | "preflight"
        | "draining"
        | "drained"
        | "target_checked_out"
        | "target_updating"
        | "target_validating"
        | "target_smoke_dispatch"
        | "target_smoke_wait"
        | "controller_staging"
        | "controller_activating"
        | "accepting"
        | "restoring_checkout"
        | "restoring_update"
        | "restoring_validating"
        | "restoring_smoke"
        | "completed"
        | "superseded"
        | "critical_recovery";
      primaryServiceWasActive: boolean;
      drainDeadlineAt: string;
      updaterProcessGroup?: number;
      targetResult?: OperationResult;
      smokeRunId?: number;
      smokeResult?: OperationResult;
      controllerCandidateVersion?: string;
      controllerActivationResult?: OperationResult;
      restorationResult?: OperationResult;
      finalActiveSha?: string;
      logPath: string;
      logSha256?: string;
      startedAt: string;
      updatedAt: string;
    }

    interface OperationResult {
      kind: "success" | "exit" | "signal" | "timeout" | "validation" | "infrastructure";
      exitCode?: number;
      signal?: string;
      code: string;
    }

Exact serialization may differ, but it must be bounded, strict-schema validated, free of secrets, sufficient for deterministic restart handling, and able to distinguish updater, timeout, signal, validation, smoke, activation, and infrastructure failures.

Workflow input interface:

    target_type: pr | branch
    target: pull-request number or same-repository branch name

Automatic main deployment uses exact `github.sha`. Manual dispatch must run `deploy.yml` from `refs/heads/main`, pass required review, and use an authorized actor. All later work uses only the resolved SHA.

Initial constants or validated configuration must include bounded values for drain deadline, updater timeout, TERM grace, KILL grace, smoke queue deadline, smoke execution deadline, local transcript bytes, GitHub artifact bytes, retained log count, and controller-version retention.

Use existing pinned host tools where possible: Bash, Git, curl, jq, systemd, coreutils, Node.js, and the official GitHub Actions runner archive. Add no third-party runtime package unless the implementation records why existing tools cannot provide deterministic parsing, process control, API handling, or atomic state.

Revision note (2026-07-21): Replaced the earlier plan's contradictory same-VM recovery guarantees with an explicit broad-authority, best-effort rollback model. Moved primary drain before checkout mutation; assigned the controller sole transaction ownership; preserved checkout ownership through the recorded administrator; added exact-SHA validation, superseded-main semantics, `queue: max`, workflow-ref checks, protected manual approval, operator authorization, network-independent recovery objects, bootstrap LKG deployment, expanded journal and recovery commands, controller activation, bounded-log semantics, production and disposable-VM acceptance, and an explicit prohibition on re-enabling Docker provisioning. This revision changes only the active ExecPlan and does not claim implementation complete.