# Automate Agent Relay environment deployment and rollback

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current as work proceeds. Maintain this document in accordance with `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

The reviewed runtime baseline is `main` commit `e9ec636e5abf383f8831fc126b99f04e2e005a3c`. Before implementation starts, verify that this commit exists and is an ancestor of `HEAD`. If `main` advances, recheck every current-state statement, path, workflow, runner contract, GitHub API assumption, and referenced Docker decision before editing implementation files. Update this plan with the newly reviewed baseline and record the review in `Progress`; do not silently implement against a different baseline.

Codex may inspect Git state with read-only commands such as `status`, `diff`, `show`, `grep`, `rev-parse`, `show-ref`, `cat-file`, and `merge-base`. Codex must not run `git add`, `commit`, `merge`, `rebase`, `reset`, `restore`, `checkout`, `cherry-pick`, or `push`; the GitHub runner owns commit and push. Workflow files are human-maintained for this task. Codex must not edit `.github/workflows/` or `examples/github-actions/`; the human reviewer implements workflow and GitHub-setting changes after repository and controller interfaces are stable.

## Purpose / Big Picture

Replace the current manual release procedure:

    cd /srv/github-runner/storage/agent-relay
    git pull --ff-only
    ./update.sh

with an observable deployment system for the single long-lived Agent Relay VM.

After this work:

- a push to protected `main` validates the exact pushed commit on a GitHub-hosted runner, skips the request if that commit has already been superseded by a newer `origin/main`, and deploys only the latest still-current commit;
- an authorized operator can manually select an open same-repository pull request or branch, resolve it once to an exact commit, validate it without using either self-hosted runner, and test that revision's real privileged `update.sh` on the real host;
- the controller stops the primary listener and drains every active primary worker before changing the trusted checkout, so a running Codex or CI job never observes repository scripts changing underneath it;
- controller-mode update finalizes the candidate runtime while keeping the primary listener stopped; a temporary target is therefore never exposed to ordinary queued CI or Codex jobs;
- the controller performs a local runtime smoke as the unprivileged `github-runner` account, validates an exact build manifest, and starts the primary listener only after the final accepted or restored runtime is selected;
- a failed main deployment attempts to converge back to the previous locally retained last-known-good main revision without requiring GitHub network access;
- a second persistent deployment runner remains available for accidental primary-runner, runtime, updater, or checkout failures that do not disable the whole VM;
- Git synchronization, drain, candidate update, host validation, local smoke, optional controller activation, acceptance or restoration, primary startup, and transaction cleanup are serialized as one host transaction;
- deployment and restoration results are reported independently, with bounded diagnostics and an explicit critical-recovery state when automated restoration cannot prove success.

The selected revisions are trusted same-repository code and execute with broad host authority because the purpose is to test the real privileged updater. The system therefore provides **best-effort rollback for accidental failures**, not isolation from malicious code and not a general VM snapshot. A target with root-equivalent authority can damage the controller, deployment runner, recovery repository, credentials, operating system, Docker data, or VM. Root ownership, runner groups, OIDC validation, environment sanitization, and a second runner on the same VM must never be described as protection against malicious privileged target code.

The deployment acceptance path deliberately does not claim that the primary registration has already executed a GitHub job. Without a persistent organization-management credential, an isolated primary-job smoke cannot be guaranteed without also allowing ordinary queued jobs to race onto a temporary runtime. Acceptance instead requires a runtime self-test executed as `github-runner`, primary registration/configuration integrity, successful service startup, a stable `Runner.Listener` process, and bounded local diagnostics. Subsequent ordinary work provides the external scheduling proof. Documentation must preserve this limitation.

This plan preserves the current Docker decision: `DOCKER_PROVISIONING_ENABLED=0` remains authoritative. The work must not re-enable Docker host provisioning in `update.sh` or reopen the Docker design from PR #46 unless the user explicitly creates a separate plan.

## Progress

Keep this section append-only for completed historical entries. Split partially completed work into a checked historical entry and a remaining unchecked entry. Every checked implementation item must identify a repository location plus passing automated evidence, or a reproducible command plus its captured result. Blocked items remain unchecked and use the `[blocked]` prefix required by `.agent/PLANS.md`.

- [x] (2026-07-21) Reviewed `README.md`, `docs/native-github-runner-specification.md`, `docs/operations/README.md`, `install.sh`, `update.sh`, `.github/workflows/ci.yml`, and `.github/workflows/codex.yml` on baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- [x] (2026-07-21) Confirmed that the primary runner cannot synchronously update itself because `update.sh` stops its listener and waits for every `Runner.Worker` owned by `github-runner`.
- [x] (2026-07-21) Reviewed GitHub persistent, ephemeral, JIT, registration-token, runner-label, runner-group, selected-workflow, workflow-dispatch, environment-review, reusable-workflow, OIDC, concurrency-queue, and self-hosted queue mechanisms.
- [x] (2026-07-21) Selected a second persistent deployment runner for the single long-lived VM instead of an ephemeral or JIT runner.
- [x] (2026-07-21) Converted the initial notes into the living ExecPlan structure used by PR #3.
- [x] (2026-07-21) Performed the first adversarial review and corrected checkout-before-drain, overstated same-VM recovery guarantees, incomplete ownership and authorization, missing exact-SHA validation, unsafe queue semantics, weak LKG storage, incomplete journal, controller-upgrade gaps, and Docker-scope ambiguity.
- [x] (2026-07-21) Performed a second adversarial review and found that exact-SHA validation depended on the primary runner being healthy, a primary-job smoke could expose a temporary runtime to unrelated jobs, workflow cancellation could kill the only transaction owner, bootstrap required smoke before the deployment runner existed, direct manual updates could diverge from accepted state, and reusable deployment workflows needed caller authentication.
- [x] (2026-07-21) Revised the design around GitHub-hosted portable validation, OIDC-authenticated trusted callers, a root systemd transaction service that survives workflow cancellation, controller-mode update that leaves the primary stopped, local runtime smoke, bootstrap-only operation before LKG exists, a versioned updater protocol, and managed-mode rejection of untracked manual updates.
- [ ] Complete Milestone 0 and record GitHub-side feasibility evidence before implementation code is written.
- [ ] Revalidate the pinned baseline and all human-maintained workflow files immediately before implementation. Record exact commands and output in `Artifacts and Notes`.
- [ ] Implement the stable deployment protocol, controller-mode updater path, runtime build manifest, portable validation script, and managed/manual update boundary.
- [ ] Implement fresh-install and existing-host migration boundaries for the deployment account, second runner, restricted runner group, protected controller services, recovery repository, state roots, operator policy, and bootstrap-pending state.
- [ ] Implement OIDC-authenticated request submission, root transaction service, controller-owned drain, Git operations under the recorded administrator, updater execution, local smoke, acceptance, restoration, cancellation survival, and boot recovery.
- [ ] Implement exact target resolution, latest-main supersession, local recovery refs, bootstrap transaction, controller candidate activation, and backward-compatible protocol checks.
- [ ] Human reviewer: add GitHub-hosted validation, automatic-main, temporary, bootstrap, and reusable execution workflows; route ordinary self-hosted jobs only to `agent-relay-main`; configure runner-group restrictions, environments, branch protection, and deployment concurrency.
- [ ] Add deterministic unit, contract, integration, and system coverage for feasibility, authentication, installation, migration, drain, ownership, validation, protocol compatibility, transactions, interruption, local smoke, restoration, logging, controller activation, and bootstrap races.
- [ ] Run focused validation, `npm run check`, `git diff --check`, exact-head CI, and independent point-by-point review of every unchecked plan item.
- [ ] Perform real-host migration and successful/failed temporary demonstrations. Perform failed-main, cancellation, restart-recovery, and controller-activation demonstrations on a disposable clone or snapshot-equivalent VM before completion.
- [ ] Update `Outcomes & Retrospective`, append final evidence and a revision note, and move this same plan to `docs/exec-plans/completed/` only after every item is checked.

## Surprises & Discoveries

- Observation: changing the trusted checkout before the primary worker finishes can change scripts used by an active Codex job.
  Evidence: current workflows execute `runner/resolve-request.mjs`, `runner/resolve-pr.mjs`, `runner/run-codex.mjs`, and `runner/finalize.sh` directly from `/srv/github-runner/storage/agent-relay`. Drain must precede `git reset`.

- Observation: another runner under the same `github-runner` UID would retain the updater self-wait deadlock.
  Evidence: the current wait condition is UID plus process name, not runner registration name, directory, service, label, or workflow identity.

- Observation: root-owned controller files do not form a security boundary against a target updater executed with root-equivalent authority.
  Evidence: such a target can modify root-owned files, services, credentials, networking, recovery data, and the VM. Recovery guarantees are limited to accidental failures.

- Observation: the existing updater lock is too narrow for automatic deployment.
  Evidence: its `flock` begins inside `update.sh`, after Git operations would occur, and ends before external acceptance or restoration. One controller transaction lock must span the full host mutation.

- Observation: the recorded administrator, root controller, deployment account, primary account, and builder have different ownership responsibilities.
  Evidence: the checkout is administrator-owned, state and services are root-owned, the deployer must only submit authenticated requests, runtime smoke must run as `github-runner`, and compilation remains under `agent-relay-builder`.

- Observation: exact-SHA validation cannot depend on the primary runner.
  Evidence: the feature must still repair an inactive or broken primary service. Validation therefore runs on GitHub-hosted infrastructure with no repository secrets and a portable check that does not assert the dedicated host's installed toolchain.

- Observation: a real GitHub smoke job on the primary runner creates a scheduling race.
  Evidence: once the primary listener is started, any queued ordinary job matching `agent-relay-main` can be assigned before the intended smoke. During a temporary transaction that would expose unaccepted target runtime to unrelated work. Controller-mode update must leave primary stopped and acceptance must use a local smoke instead.

- Observation: the current checkout SHA does not prove which revision produced active `dist`.
  Evidence: the baseline runtime has no source-SHA manifest. Initial LKG and every later accepted runtime require a root-owned build manifest generated during finalization and independently checked by the controller.

- Observation: current `origin/main` is not rollback state after a failed merge deployment.
  Evidence: when a bad commit reaches `main`, the remote already points to it. Rollback requires the previous commit accepted on this host.

- Observation: a plain SHA file does not preserve the Git object needed for restoration.
  Evidence: force-push, ref deletion, garbage collection, or production `.git` damage can make the SHA unavailable. Accepted state requires a protected local bare repository and atomic refs.

- Observation: restoration must not require GitHub availability.
  Evidence: network or DNS failure may be part of the deployment incident. The controller must restore tracked LKG content from local recovery objects.

- Observation: a workflow job is not a reliable lifetime boundary for a privileged host transaction.
  Evidence: workflow cancellation, runner process termination, or job timeout can kill the invoking shell after checkout mutation. Submission must start a root-owned systemd transaction service that continues to a safe terminal state independently of the deployment job.

- Observation: a reusable workflow restricted by runner group can still be called by another same-repository workflow.
  Evidence: selected-workflow runner-group policy identifies where the job is defined, not which caller supplied its inputs. The controller must verify a GitHub OIDC token containing exact `workflow_ref`, `job_workflow_ref`, repository, ref, event, run, actor, environment, and runner claims before accepting a request.

- Observation: workflow reruns preserve the initial actor's privileges.
  Evidence: temporary and bootstrap deployments must not reuse old approval context through a partial rerun. Those modes require `run_attempt == 1`; an operator starts a fresh dispatch for another attempt.

- Observation: bootstrap cannot require the deployment service to remain stopped until bootstrap completes.
  Evidence: the trusted bootstrap workflow itself needs the deployment runner. Migration must start the restricted deployment service in bootstrap-pending mode; the controller accepts only a bootstrap request until `bootstrap-complete` is written.

- Observation: direct manual `git pull && ./update.sh` would diverge runtime from LKG after managed deployment is enabled.
  Evidence: a later recovery could silently replace an unrecorded manual runtime. Direct manual updater execution must remain available before bootstrap but fail closed after managed mode is enabled; emergency repair uses documented controller recovery or an explicit rebootstrap procedure.

- Observation: controller upgrades cannot introduce a protocol the currently installed controller cannot understand.
  Evidence: the active controller must deploy and stage its successor. Updater controller mode, request schema, build manifest, journal compatibility, and candidate self-test require stable versioned interfaces; a breaking change needs a separately approved administrator migration.

- Observation: branch movement after resolution must not substitute a new commit, but can make the old object unavailable.
  Evidence: the controller continues only with the original SHA. If it cannot fetch or verify that object after the source ref moves or disappears, it fails without mutation and requires a fresh dispatch.

- Observation: the official runner connectivity check requires a PAT.
  Evidence: GitHub documents `config.sh --check --url ... --pat ...`. Because this system intentionally does not persist such a credential, transaction acceptance can verify local registration integrity and listener startup but cannot prove server-side scheduling before promotion.

- Observation: concurrency queuing is bounded and ordering is not a deployment correctness primitive.
  Evidence: `queue: max` retains at most 100 pending runs and GitHub does not guarantee dispatch ordering. The controller serializes the host and skips stale automatic-main requests by comparing exact SHA with current `origin/main`.

## Decision Log

- Decision: use a second persistent organization runner on the same VM, not an ephemeral or JIT runner.
  Rationale: one long-lived VM needs a recovery path independent of the primary runner process. Ephemeral creation adds persistent API credentials and lifecycle complexity without VM isolation.
  Date/Author: 2026-07-21 / operator-approved design.

- Decision: describe restoration as best effort against accidental failure, not as protection from malicious same-repository code.
  Rationale: real updater testing requires broad host authority that can defeat every same-VM control.
  Date/Author: 2026-07-21 / adversarial-review correction approved by operator.

- Decision: validate target code on `ubuntu-latest`, not on either self-hosted runner.
  Rationale: deployment must remain possible when primary is broken, and target validation must not execute arbitrary target scripts under the privileged deployment account. Add a portable repository check that installs Node 22 and required ordinary packages but excludes the dedicated-host toolchain assertion.
  Date/Author: 2026-07-21 / second adversarial review.

- Decision: keep one persistent deployment runner under `agent-relay-deployer`, with no direct checkout or root-state write access.
  Rationale: the deployer only submits an authenticated bounded request and reads a bounded normalized result. The root transaction service owns mutation.
  Date/Author: 2026-07-21 / ownership design.

- Decision: restrict the deployment runner group to `Divorium/agent-relay/.github/workflows/deploy-execute.yml@refs/heads/main` and route the job with both group and `agent-relay-deploy` label.
  Rationale: only jobs directly defined in the trusted reusable execution workflow may reach the privileged runner. Caller identity is separately verified through OIDC.
  Date/Author: 2026-07-21 / GitHub access-control review.

- Decision: authenticate every submitted deployment request with a GitHub OIDC token delivered through standard input, never command-line arguments.
  Rationale: no persistent PAT, GitHub App key, repository signing secret, or caller-supplied string is needed. The controller verifies issuer, signature, audience, time, `jti`, repository and owner IDs, visibility, `ref`, `sha`, `event_name`, `run_id`, `run_attempt`, `actor_id`, `environment`, `runner_environment`, `workflow_ref`, `workflow_sha`, `job_workflow_ref`, and `job_workflow_sha`.
  Date/Author: 2026-07-21 / caller-authentication correction.

- Decision: allow exactly three trusted callers from protected main: automatic main, temporary target, and bootstrap.
  Rationale: each caller has a fixed workflow path, event, environment, and mode. The reusable execution workflow cannot authorize an arbitrary same-repository caller merely because runner-group routing succeeded.
  Date/Author: 2026-07-21 / reusable-workflow correction.

- Decision: temporary and bootstrap modes require a protected environment, disallow administrator bypass where GitHub supports it, require an independent reviewer when one exists, require an allowlisted numeric `actor_id`, and reject `run_attempt > 1`.
  Rationale: write access alone must not authorize privileged target code, usernames can change, and reruns reuse the initial actor's privileges. Milestone 0 must block if the actual repository cannot provide an accepted operator-control model.
  Date/Author: 2026-07-21 / authorization design.

- Decision: use a constant deployment concurrency group with `queue: max`, but do not rely on ordering.
  Rationale: GitHub queues at most 100 runs and may start them in an order different from dispatch order. The host lock remains authoritative, main requests are superseded when stale, and queue overflow is an observable failure.
  Date/Author: 2026-07-21 / queue design.

- Decision: submit the request to a root-owned systemd transaction service and let the workflow poll a normalized result.
  Rationale: cancellation or death of the deployment job must not terminate a transaction after host mutation. The service holds the lock, handles signals, writes the journal, and continues to acceptance or restoration independently.
  Date/Author: 2026-07-21 / cancellation-survival correction.

- Decision: stop the primary listener and drain all `github-runner` workers before any checkout mutation.
  Rationale: active jobs execute scripts from the trusted checkout and must not observe a mid-job revision change.
  Date/Author: 2026-07-21 / safety correction.

- Decision: drain is bounded and non-destructive.
  Rationale: on timeout the controller does not kill a GitHub job, performs no checkout or runtime mutation, restores the listener to its prior state, records `drain_timeout`, and fails. The initial design target is 7200 seconds, finalized through tested configuration.
  Date/Author: 2026-07-21 / operational policy.

- Decision: run Git mutation as the recorded administrator through the root controller, never as `agent-relay-deployer`.
  Rationale: the checkout remains administrator-owned. Root owns services, process control, recovery data, and protected state.
  Date/Author: 2026-07-21 / ownership correction.

- Decision: define a versioned controller/updater protocol and require every target to support the currently active protocol before checkout mutation.
  Rationale: old branches that predate managed deployment cannot be safely executed by the controller. They must first merge or rebase the protocol baseline. Breaking protocol changes require a separate migration.
  Date/Author: 2026-07-21 / compatibility correction.

- Decision: controller-mode `update.sh` finalizes runtime but leaves the primary listener stopped.
  Rationale: ordinary queued jobs must never run against a temporary target. Manual pre-bootstrap mode preserves current behavior; managed controller mode owns final service startup.
  Date/Author: 2026-07-21 / smoke-isolation correction.

- Decision: replace transactional primary-job smoke with a local runtime smoke executed as `github-runner`.
  Rationale: a primary GitHub job cannot be isolated from other matching queued jobs without dynamic runner management credentials. Local smoke verifies the exact manifest, runtime readability, launcher behavior, and no-op health interface while primary remains stopped. Listener startup is checked only after final state is selected.
  Date/Author: 2026-07-21 / second adversarial review.

- Decision: require a root-owned runtime build manifest tied to exact source SHA and protocol version.
  Rationale: checkout HEAD alone does not identify active runtime. The controller verifies the manifest, entrypoint hash, source SHA, controller protocol, and completion state before acceptance or restoration.
  Date/Author: 2026-07-21 / runtime-identity correction.

- Decision: make the recovery bare repository's refs authoritative for accepted commits.
  Rationale: a text SHA does not retain objects. Use atomic `git update-ref --stdin` transactions for current and previous accepted refs, verify object connectivity before mutation, and treat metadata as journaled descriptive state rather than object authority.
  Date/Author: 2026-07-21 / recovery-store correction.

- Decision: automatic main is latest-only.
  Rationale: if `origin/main` no longer equals the validated push SHA when the host transaction begins, the request is `superseded` and makes no host change. The system does not deploy every intermediate main commit.
  Date/Author: 2026-07-21 / main-ordering policy.

- Decision: before `bootstrap-complete`, the deployment runner may run but the controller accepts only the trusted bootstrap caller and bootstrap mode.
  Rationale: the bootstrap workflow needs the deployment runner, while queued normal deployments must fail without mutation until exact LKG and recovery state exist.
  Date/Author: 2026-07-21 / bootstrap correction.

- Decision: after bootstrap, direct ordinary invocation of `update.sh` fails closed outside controller mode.
  Rationale: an untracked manual runtime would diverge from LKG. Emergency repair uses `recover`, a documented administrator repair procedure, and then an explicit bootstrap/acceptance operation.
  Date/Author: 2026-07-21 / accepted-state consistency correction.

- Decision: stage and activate backward-compatible controller candidates during accepted main transactions only.
  Rationale: the current controller must understand the target updater and candidate metadata. Candidate self-test, protocol compatibility, immutable version directory, atomic symlink switch, post-switch check, and switchback occur before final acceptance. Temporary targets never activate controller code.
  Date/Author: 2026-07-21 / controller-upgrade design.

- Decision: preserve `DOCKER_PROVISIONING_ENABLED=0`.
  Rationale: this plan must not reopen the separate Docker-host provisioning decision.
  Date/Author: 2026-07-21 / scope correction.

## Outcomes & Retrospective

This plan remains active. No installer, updater, controller, workflow, service, runner registration, GitHub configuration, or production host behavior has been changed by the plan-only commits.

The revised design no longer relies on the primary runner for pre-deployment validation, no longer exposes temporary runtime to normal jobs for smoke, and no longer assumes that the deployment workflow process remains alive for the full transaction. Its intended value is narrow and testable: validate exact code on isolated GitHub-hosted infrastructure, prevent checkout mutation during active primary work, finalize and smoke candidate runtime while primary remains stopped, preserve a network-independent accepted revision, serialize privileged host changes, and report when restoration cannot be proven.

The work remains larger than a `git pull && ./update.sh` wrapper because the current updater stops its own runner, active jobs read scripts from the shared checkout, accepted runtime has no revision identity, and rollback must survive a broken target checkout. Implementation must stop at Milestone 0 if the required GitHub-side controls or OIDC claims cannot be enforced on the actual organization.

Update this section after every accepted milestone with implementation evidence, deviations, operational results, and lessons learned. On completion, state the final real-host and disposable-VM results and move this same plan to `completed` without replacing it with a summary.

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

Current CI and Codex jobs use bare `[self-hosted]`. Adding a second runner without routing changes could send ordinary jobs to the deployment registration. Human-maintained workflows must route every ordinary self-hosted job to `[self-hosted, agent-relay-main]`. Only jobs directly defined in the trusted reusable execution workflow may target the deployment group and `agent-relay-deploy` label.

Expected new host layout is equivalent to:

    /srv/github-runner/storage/deploy-runner
    /srv/github-runner/storage/deploy-work
    /srv/github-runner/storage/deploy-home
    /var/lib/agent-relay-deploy/
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
      oidc-jwks-cache.json
    /usr/local/libexec/agent-relay-deploy-submit
    /usr/local/libexec/agent-relay-deploy-status
    /usr/local/libexec/agent-relay-deploy-recover
    /usr/local/libexec/agent-relay-deploy-controller -> /var/lib/agent-relay-deploy/controller-versions/<version>/controller
    /etc/agent-relay/deployment-operator-ids
    /etc/agent-relay/deployer
    /etc/sudoers.d/agent-relay-deployer
    /etc/systemd/system/agent-relay-deploy-transaction.service
    /etc/systemd/system/agent-relay-deploy-recover.service

Terms:

- **primary runner**: existing `gh-runner`, executing CI and Codex after final runtime selection;
- **deployment runner**: `gh-deploy-runner`, executing only the trusted reusable deployment execution workflow;
- **caller workflow**: one of the exact protected-main automatic, temporary, or bootstrap workflows;
- **execution workflow**: reusable `deploy-execute.yml`, the only workflow whose jobs may reach the deployment runner;
- **submission helper**: fixed root-owned entrypoint that reads one bounded request plus OIDC token, verifies it, writes a protected request, and starts or joins the transaction service;
- **controller service**: root-owned transaction process independent of the workflow job lifetime;
- **target SHA**: one exact commit selected after resolving a push, PR, or branch input;
- **deployment protocol**: stable versioned contract among caller, execution workflow, installed controller, target `update.sh`, runtime manifest, and journal;
- **LKG**: the current ref in the recovery repository identifying the most recent main revision accepted on this VM;
- **recovery repository**: root-owned bare Git repository retaining current and previous accepted objects and refs;
- **temporary target**: manually selected same-repository PR or branch tested but never promoted or exposed to ordinary jobs;
- **portable validation**: GitHub-hosted repository checks that do not assume the dedicated host toolchain layout;
- **host compatibility check**: non-mutating target check executed after drain and checkout on the real host before privileged update;
- **runtime smoke**: root-controlled health command executed as `github-runner` against the finalized candidate while the primary listener remains stopped;
- **critical recovery**: target or infrastructure failure followed by restoration that did not complete or could not be proven.

## Plan of Work

### Milestone 0: Prove GitHub-side feasibility and trust controls

Before implementation, verify with actual organization/repository settings, documented OIDC samples, and API responses that:

- an additional organization runner group can be created or managed;
- the group can allow this public repository, restrict repository access to `Divorium/agent-relay`, and restrict workflow access to `Divorium/agent-relay/.github/workflows/deploy-execute.yml@refs/heads/main`;
- workflow restrictions are not inherited read-only in a conflicting configuration;
- the installation credential has only permissions needed for runner groups, registration, labels, and inspection;
- public-repository environments and required reviewers are available;
- the temporary and bootstrap environment policy can enforce the operator model accepted by the user, including whether an independent reviewer exists and whether administrator bypass can be disabled;
- authorized numeric GitHub actor IDs are identified;
- protected `main` prevents unauthorized direct workflow changes, force pushes, and deletion;
- the reusable execution job can request OIDC with `id-token: write`, and actual tokens contain all claims required by this plan, including `workflow_ref`, `workflow_sha`, `job_workflow_ref`, `job_workflow_sha`, `repository_id`, `actor_id`, `run_id`, `run_attempt`, `environment`, and `runner_environment`;
- the controller can validate GitHub's OIDC issuer and JWKS using Node 22 built-ins;
- `concurrency.queue: max` is accepted by the repository and its 100-run limit is operationally acceptable.

If any required control is unavailable, append `[blocked]`, do not install or start a privileged deployment runner, and revise the architecture with the operator.

### Milestone 1: Revalidate baseline and define stable protocols

Verify the reviewed commit, ancestry, installer/updater behavior, workflow paths, package scripts, Docker provisioning state, official runner service behavior, and `.agent/PLANS.md`.

Add a versioned repository deployment contract, equivalent to `.agent-relay/deployment-protocol.json`, declaring the updater controller protocol, runtime manifest schema, controller candidate schema, and minimum installed-controller compatibility. The installed controller rejects a target before checkout mutation unless its exact commit contains a supported protocol declaration. Automatic main must be compatible by construction. A manual branch predating the protocol must be rebased or merged with the protocol baseline before testing.

Add `npm run check:portable` or an equivalent deterministic entrypoint that runs typecheck, tests, runtime build validation, shell syntax, Node script syntax, and system-script tests on `ubuntu-latest` without requiring `/opt/java/openjdk`, `/usr/local/go`, `/opt/rust`, Codex login, or the dedicated host's exact global tools. Keep `npm run check` and `check:toolchain` as the complete dedicated-host/CI contract.

Codex-owned scope may include `install.sh`, `update.sh`, protocol metadata, migration scripts, controller and OIDC verifier source, target resolvers, state handling, tests, package scripts, runtime health interface, operator documentation, and this plan. Human-owned scope is `.github/workflows/`, `examples/github-actions/`, GitHub settings, final commit/push, exact-head CI review, and real-host operations.

### Milestone 2: Implement human-maintained workflow topology

After interfaces are stable, the human reviewer adds four workflow files or exact equivalents:

1. `deploy-main.yml`
   - trigger: `push` to protected `main`;
   - target: exact `github.sha`;
   - validate target on `ubuntu-latest` with `contents: read`, no repository/environment secrets, `persist-credentials: false`, Node 22, explicit ordinary package prerequisites, `npm ci`, and `npm run check:portable`;
   - call the trusted reusable execution workflow only after validation succeeds;
   - pass mode `main`, exact source ref and SHA, and immutable request metadata.

2. `deploy-temporary.yml`
   - trigger: `workflow_dispatch` only;
   - fail unless `github.ref == refs/heads/main`;
   - accept `target_type: pr | branch` and one target value;
   - resolve an open same-repository PR, including a draft PR when explicitly selected, or a same-repository branch to one exact SHA;
   - reject forks, tags, merge refs, arbitrary URLs, malformed or ambiguous names, and unsupported protocol versions;
   - validate the exact target on `ubuntu-latest` under the same credential-free portable contract;
   - call the execution workflow in `temporary` mode only after validation.

3. `deploy-bootstrap.yml`
   - trigger: `workflow_dispatch` from `refs/heads/main` only;
   - target: exact current protected-main SHA after portable validation;
   - use a separately protected bootstrap environment;
   - call execution in `bootstrap` mode;
   - be the only accepted caller while `bootstrap-complete` is absent.

4. `deploy-execute.yml`
   - trigger: `workflow_call` only;
   - define the only deployment-runner job;
   - route with:

         runs-on:
           group: agent-relay-deployment
           labels: agent-relay-deploy

   - use one constant concurrency group with `queue: max` and no `cancel-in-progress: true`;
   - select mode-specific protected environment so OIDC contains the expected environment claim;
   - request OIDC with the fixed audience defined by the controller;
   - submit one bounded request and OIDC token through standard input to the fixed submission helper;
   - poll only the fixed normalized status/result interface until the bounded controller deadline;
   - upload only the controller-exported normalized diagnostic artifact;
   - never checkout target code, run target scripts, expose a persistent organization credential, or stream raw updater output.

The controller OIDC allowlist accepts only exact caller `workflow_ref` values for `deploy-main.yml`, `deploy-temporary.yml`, and `deploy-bootstrap.yml` at `refs/heads/main`, and exact `job_workflow_ref` for `deploy-execute.yml@refs/heads/main`. It checks caller event, environment, mode, SHA semantics, and run attempt. A different same-repository caller may reach the reusable workflow syntax but cannot pass controller authentication.

Update current CI, Codex, and examples so every ordinary self-hosted job explicitly requires `agent-relay-main`; no production workflow may retain bare `[self-hosted]`.

### Milestone 3: Build installation, migration, and bootstrap-pending boundaries

Extend fresh installation and add a restartable existing-host migration. They must:

- create `agent-relay-deployer` with separate home, runner, work, and service paths and no Codex login;
- create or validate the restricted runner group and register the deployment runner with `--runnergroup` and `agent-relay-deploy` label using a separate short-lived registration token;
- add `agent-relay-main` to the existing primary registration without replacing unrelated registration identity;
- install immutable controller versions, submission/status helpers, OIDC verifier, transaction and boot-recovery systemd units, recovery repository, protected state/log roots, operator actor-ID allowlist, and narrow sudo policy;
- permit `agent-relay-deployer` to invoke only the no-argument submission/status helpers, not arbitrary controller commands, shells, Git, systemctl, or update scripts;
- keep the operator PAT and registration tokens only in memory and out of arguments, files, logs, fixtures, runner workspaces, and child environments;
- initialize the recovery repository but do not invent an LKG from checkout HEAD or active `dist`;
- write bootstrap-pending state, start the restricted deployment runner, and leave ordinary main/temporary controller modes disabled;
- require the operator to run the trusted bootstrap workflow;
- write `bootstrap-complete` and `managed-mode` only after bootstrap deploys, locally smokes, starts the primary listener, verifies readiness, and atomically publishes initial recovery refs and metadata.

An automatic-main or temporary request that reaches the controller before bootstrap completion fails before drain or mutation. A failed or canceled bootstrap leaves the previous primary runtime and service state restored when possible and remains bootstrap-pending.

### Milestone 4: Implement authenticated submission and independent transaction lifetime

Implement a fixed root-owned submission helper. It accepts no command-line arguments and reads one size-bounded JSON envelope plus OIDC token from standard input. Before writing any request or starting a service, it must:

- parse strict JSON with duplicate-key rejection or an equivalent canonical parser boundary;
- validate OIDC RS256 signature against GitHub's issuer/JWKS, fixed audience, time claims with bounded skew, unique `jti`, and all required repository, workflow, run, actor, environment, and runner claims;
- require repository and organization numeric IDs, not only names;
- derive authoritative mode, caller, actor ID, run ID, run attempt, workflow SHA, and event from verified claims rather than trusting duplicate request fields;
- require `run_attempt == 1` for temporary and bootstrap;
- check numeric actor ID against the root-owned allowlist for temporary/bootstrap;
- bind target/source inputs to the expected caller mode;
- reject replay of a previously accepted `(run_id, run_attempt, check_run_id, jti)` tuple;
- reject normal modes before bootstrap and reject bootstrap after bootstrap is complete unless an explicit administrator rebootstrap state exists;
- reject conflicting active journal or request state.

A valid submission is written atomically to a root-only request file and starts or joins `agent-relay-deploy-transaction.service`. The root transaction service, not the workflow shell, owns the process group, lock, journal, Git mutation, updater, acceptance/restoration, and final result. If the deployment job is canceled or its runner process dies, the service continues. The workflow status helper can reconnect by request ID and retrieve only bounded normalized state.

Install `agent-relay-deploy-recover.service` before both runner services. On boot it examines the journal, terminates recorded surviving target process groups when safe, restores the recorded LKG after any checkout mutation, validates final runtime, and only then permits runner services to start. Unknown or contradictory state fails closed and leaves the deployment runner unavailable until administrator repair rather than guessing.

### Milestone 5: Implement controller-owned drain, checkout, updater, smoke, and acceptance

The controller service acquires one dedicated transaction lock. Manual pre-bootstrap updater mode and recovery use the same lock contract; controller-mode `update.sh` does not reacquire it.

Preflight before stopping primary:

1. validate request, OIDC-derived identity, bootstrap/managed state, protocol compatibility, checkout canonical path and administrator ownership, expected origin URL, safe Git configuration, no unsupported submodules or alternate worktree, recovery repository integrity, current LKG refs, controller version, and absence or recoverability of prior journal;
2. fetch only the expected source ref into a namespaced temporary ref as the recorded administrator, with hooks disabled;
3. verify the fetched exact object equals the validated target SHA and contains the supported protocol declaration;
4. for main/bootstrap, compare target with current `origin/main`; main becomes `superseded` without host mutation when they differ; bootstrap requires exact current main;
5. ensure the current LKG commit and tree remain complete in the recovery repository before any mutation.

Drain and mutation:

1. record `preparing` journal state;
2. record whether the primary service was active;
3. stop only the primary listener service;
4. wait up to the configured drain deadline for every `Runner.Worker` owned by `github-runner` to finish;
5. on drain failure or timeout, restore the listener to its prior state, leave checkout/runtime unchanged, record terminal result, and exit;
6. record `drained` durably before checkout mutation;
7. reset and clean the administrator-owned checkout to the exact target as the recorded administrator, preserving ignored caches in the ordinary path and verifying ownership afterward;
8. execute a non-mutating target host-compatibility check under a sanitized environment;
9. invoke exact target `update.sh` in stable controller mode, in a dedicated process group, with primary already stopped and with no GitHub token, OIDC token, PAT, registration token, runner job token, controller-private descriptor, or unrelated environment inherited;
10. require controller-mode updater to finalize runtime and build manifest while leaving primary stopped;
11. verify manifest source SHA, protocol, target updater version, entrypoint path/hash, ownership, modes, and completed state;
12. execute the fixed runtime health interface as `github-runner` with no Codex model request, no source mutation, and bounded output.

Main mode after local smoke:

1. stage and self-test a controller candidate only when target controller source differs;
2. reject breaking controller/updater/journal protocol changes and require separate migration;
3. import the exact accepted commit into the recovery repository and verify connectivity;
4. atomically update current and previous accepted refs with `git update-ref --stdin`, under an `accepting` journal phase;
5. atomically publish accepted/deployed metadata consistent with the authoritative ref;
6. activate a compatible candidate through immutable version directory and atomic symlink, then run post-switch self-test and switch back on failure;
7. start the primary service only after accepted state identifies the target;
8. require expected service state, one stable `Runner.Listener`, unchanged registration credential files, and bounded startup diagnostics;
9. if startup/readiness fails, stop primary, atomically revert accepted refs/metadata to previous LKG, restore previous checkout/runtime/controller, and retry primary startup;
10. mark complete only after final active SHA, manifest, controller version, service state, and accepted refs agree.

Temporary mode after local smoke:

1. record target success or failure but never update accepted refs;
2. keep primary stopped;
3. restore tracked checkout from the local LKG object without GitHub access;
4. execute stable LKG updater in controller mode, verify manifest, run local smoke as `github-runner`, and restore active controller version;
5. start primary only after LKG is fully restored;
6. verify service/listener readiness and final state;
7. report target and restoration outcomes separately;
8. enter critical recovery if restoration cannot be proven.

Bootstrap mode follows main acceptance but starts from no LKG. It may publish the first accepted refs only after exact current-main deployment, local smoke, compatible controller state, and primary readiness succeed. It writes `bootstrap-complete` and `managed-mode` last.

### Milestone 6: Implement updater protocol, runtime identity, manual boundary, and recovery

Refactor `update.sh` without duplicating build behavior:

- pre-bootstrap manual mode preserves current administrator invocation and service restoration;
- managed controller mode is accepted only under root-owned controller invocation and stable protocol input, assumes the controller already owns the transaction lock and drained primary, and leaves primary stopped on both success and failure;
- after `managed-mode` exists, ordinary direct invocation fails with a clear instruction to use GitHub deployment or administrator recovery; it does not silently alter runtime or accepted state;
- both successful build paths produce a root-owned immutable manifest equivalent to `dist/.agent-relay-build.json` containing schema version, exact source SHA, protocol version, updater version, runtime entrypoint relative path, entrypoint SHA-256, build completion timestamp, and finalized status;
- partial runtime or manifest is never treated as active;
- Docker provisioning remains disabled in every mode.

Recovery semantics:

- the recovery bare repository is the authority for current and previous LKG objects;
- ordinary restoration never fetches GitHub;
- emergency reconstruction may recreate the managed checkout from a root-controlled temporary clone of recovery refs, then restore administrator ownership; unlike ordinary reset, emergency reconstruction may discard ignored build caches because correctness is more important than cache preservation;
- `recover` never resumes a failed target; it converges to recorded LKG;
- workflow users cannot invoke arbitrary recovery. Administrator recovery uses a separate root-only helper and records evidence;
- an administrator may acknowledge an independently repaired state only through an explicit bounded operation that does not silently promote a temporary SHA. Re-establishing LKG requires bootstrap or accepted main semantics;
- controller/journal protocol changes remain backward compatible across at least active and previous controller versions. A breaking migration is outside automatic deployment and requires a separate plan.

### Milestone 7: Documentation, validation, and operational acceptance

Update current-state documentation only after behavior exists. Describe GitHub-hosted portable validation, OIDC caller authentication, runner-group workflow restriction, operator actor IDs, deployment modes, bootstrap, managed manual-update refusal, drain timeout, protocol compatibility, runtime manifest, recovery refs, local smoke limitation, latest-main supersession, cancellation survival, controller upgrades, bounded diagnostics, emergency recovery, Docker provisioning remaining disabled, and best-effort rollback.

Run repository and system validation, exact-head CI, independent review, real-host migration/temporary tests, and disposable-VM main failure/restart/controller-upgrade tests. Keep the plan active until every acceptance item is supported by evidence.

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

Milestone 0 evidence must include redacted responses or screenshots proving:

- runner-group visibility `selected`, public access explicitly enabled, selected repository exact, selected workflow fully qualified at `refs/heads/main`, `restricted_to_workflows: true`, and `workflow_restrictions_read_only: false`;
- environments for automatic, temporary, and bootstrap modes, their branch policies, reviewer/bypass settings, and accepted operator model;
- protected-main/ruleset settings covering workflow changes and force pushes;
- actual OIDC claim sample from a nonprivileged test job, without retaining token text;
- `queue: max` workflow validation and documented 100-run limit;
- numeric repository, organization-owner, and authorized actor IDs.

Portable validation implementation must be reproducible on a clean GitHub-hosted Ubuntu image. It must install only explicit ordinary prerequisites and run an exact command such as:

    npm ci
    npm run check:portable

Expected result: all portable repository tests pass without Codex login, host PAT, deployment credentials, dedicated `/opt` toolchain layout, Docker daemon, or either self-hosted runner.

Focused repository validation after implementation must include commands equivalent to:

    bash -n install.sh update.sh scripts/*.sh test-system/*.sh
    npm run build
    node --test dist/test/deployment-oidc.test.js
    node --test dist/test/deployment-protocol.test.js
    node --test dist/test/deployment-controller.test.js
    node --test dist/test/deployment-state.test.js
    node --test dist/test/deployment-resolver.test.js
    bash test-system/deployment-install.integration.sh
    bash test-system/deployment-migration.integration.sh
    bash test-system/deployment-transaction.integration.sh
    bash test-system/deployment-recovery.integration.sh

Exact names may differ, but update this section before running alternatives and retain equivalent scenario coverage.

Controller integration tests must use temporary filesystem roots, local Git repositories, fake systemd/process/service adapters, fake OIDC issuer/JWKS, fake runner registrations, and deterministic barriers rather than arbitrary sleeps. They must never mutate real `/etc`, `/srv`, runner registrations, GitHub settings, or production services.

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

Expected result: every command exits zero, coverage thresholds remain satisfied, no baseline test is weakened without an equal or stronger replacement recorded in `Progress`, and Docker provisioning remains disabled.

Real-host migration and bootstrap must demonstrate:

- primary registration is explicitly labeled `agent-relay-main`;
- deployment runner is in the restricted group and has only `agent-relay-deploy` custom routing;
- deployment runner starts in bootstrap-pending mode but normal requests fail before drain;
- controller versions, helpers, systemd units, recovery repository, actor-ID policy, state, logs, and sudoers have expected ownership and modes;
- no PAT or registration token remains;
- trusted bootstrap validates and deploys exact current main, writes a correct runtime manifest, performs local smoke as `github-runner`, starts primary, publishes initial recovery refs, and writes `bootstrap-complete`/`managed-mode` last.

Production-VM demonstrations:

1. successful temporary target followed by successful mandatory restoration, with primary stopped for the entire target-active window;
2. controlled temporary updater failure followed by successful restoration;
3. drain timeout with no checkout/runtime mutation and primary listener restoration;
4. superseded automatic-main request skipped without host mutation;
5. successful exact-main deployment becoming LKG;
6. direct manual `update.sh` rejected after managed mode without changing runtime;
7. canceled deployment workflow while the root transaction service safely completes or restores and exports final status.

Disposable snapshot/clone VM demonstrations:

1. failed main deployment with successful network-independent restoration;
2. process termination during target update and deterministic journal recovery;
3. host restart after checkout mutation and boot-time restoration before runner startup;
4. production `.git` corruption followed by reconstruction from recovery objects;
5. controller candidate activation success and switchback on candidate failure;
6. incompatible target protocol rejected before checkout mutation;
7. target and restoration double failure entering critical recovery while preserving evidence.

## Validation and Acceptance

Acceptance is based on observable host and GitHub behavior, not code presence, intended design, a locally active service alone, resolved review comments, or a future promise to migrate the VM.

Feasibility acceptance proves the actual organization can enforce selected repository/workflow restrictions for the public repository, that restrictions are writable, that required OIDC claims are present and verifiable, that operator environments match the accepted human-review model, and that `queue: max` is available.

Caller-authentication acceptance proves:

- exact automatic, temporary, and bootstrap caller workflows at protected main are accepted only in their allowed modes;
- a different same-repository workflow calling `deploy-execute.yml` is rejected by the controller before drain;
- wrong `workflow_ref`, `job_workflow_ref`, workflow SHA, repository/owner ID, environment, event, ref, audience, actor ID, runner environment, expired token, unknown key, duplicate `jti`, mismatched run, or unsupported run attempt is rejected;
- OIDC token text never appears in arguments, logs, artifacts, state, or child environment.

Portable-validation acceptance proves exact target SHA is checked on GitHub-hosted infrastructure with no deployment/repository secret beyond the automatic read-only token, no self-hosted runner, and no target-selected workflow code. Failed validation prevents deployment-runner scheduling. Host-specific compatibility is checked again after controlled checkout and before updater execution.

Drain acceptance starts a controlled primary job, begins deployment, proves the listener stops accepting new jobs, proves checkout and runtime do not change while `Runner.Worker` exists, and proves timeout restores prior listener state without killing the worker.

Ownership acceptance proves deployer cannot write checkout, controller, recovery refs, state, operator policy, sudoers, or services directly; Git changes retain recorded-administrator ownership; runtime remains root-owned; compilation remains builder-owned; local smoke executes as `github-runner`.

Protocol acceptance proves unsupported or breaking target protocol is rejected before checkout mutation. A supported target updater in controller mode never starts primary, writes exact manifest, leaves no accepted partial runtime, and receives no GitHub or controller credential. Pre-bootstrap manual mode still works; post-bootstrap direct manual mode fails closed.

Temporary-isolation acceptance proves primary listener remains stopped from successful drain through target checkout, target update, target local smoke, LKG restoration, stable local smoke, and final primary startup. No ordinary CI or Codex job can execute against temporary runtime because no primary listener is available.

Main acceptance proves portable validation, current-main check, drain, exact checkout, host compatibility, controller-mode update, manifest verification, local smoke, compatible controller activation, recovery-object import, recoverable accepted-ref publication, primary startup, and final consistency. A stale validated main request becomes `superseded` and cannot downgrade the host.

Runtime-identity acceptance proves checkout SHA, build-manifest source SHA, entrypoint digest, deployed metadata, controller version, accepted recovery ref, and final active state agree. Tampered, missing, stale, partial, symlinked, wrongly owned, or mismatched manifest/runtime fails acceptance.

Listener-readiness acceptance proves service start, one stable listener, protected registration files, and bounded startup diagnostics. Documentation explicitly states that this is not proof that GitHub scheduled a job and does not rely on `config.sh --check`, which would require a PAT.

Cancellation-lifetime acceptance kills the deployment job after controller submission and after checkout mutation. The root transaction service remains alive, retains the lock, reaches acceptance or restoration, writes terminal state, and allows a later status query to obtain the result. A host restart invokes boot recovery before runner services.

Bootstrap acceptance starts from the supported one-runner installation with no LKG. Normal requests fail without mutation. The trusted bootstrap request deploys exact current main, locally smokes, starts primary, publishes initial current/previous recovery state consistently, and writes managed markers last.

Recovery acceptance disables GitHub network, injects target failure, and restores from local recovery refs. It covers ordinary reset, emergency checkout reconstruction, interrupted recovery, current/previous ref consistency, controller switchback, and critical-recovery preservation. It does not claim recovery from malicious root deletion or whole-VM failure.

Queue acceptance starts more than one automatic and temporary execution call, proves host serialization, observes queue overflow behavior at the documented bound, and proves correctness does not depend on dispatch order. Stale main requests skip; exact temporary requests either execute their pinned object or fail without following a moved ref.

Logging acceptance defines exact byte and retention limits. Raw child output is captured only in a root-owned bounded local log with explicit truncation marker. Workflow logs receive fixed phase/status messages and escaped bounded diagnostics, never raw lines. The exported artifact is a normalized bounded diagnostic view and is not described as a full transcript or guaranteed redaction of secrets deliberately printed by malicious root code.

Controller-upgrade acceptance proves candidate staging, stable-protocol compatibility, immutable version directory, syntax/self-test, atomic switch, post-switch verification, previous-version retention, and switchback. LKG is not finalized when required activation fails. Breaking protocol changes are rejected and require a separate migration plan.

The plan is complete only when every unchecked `Progress` item is checked with evidence, focused and complete repository tests pass, exact-head CI passes, independent review finds no unresolved action point, production demonstrations pass, and disposable-VM failure/restart/controller-upgrade scenarios pass.

## Idempotence and Recovery

Fresh installation remains a one-time operation. Ordinary releases must not rerun `install.sh`. Setup and migration distinguish absent, exact, partial, and conflicting state and compensate only attempt-owned temporary resources.

Migration is restartable. It may start the restricted deployment runner in bootstrap-pending mode but does not write accepted refs or managed markers. Exact completed state is validation-only. Conflicting accounts, services, registrations, groups, policies, refs, files, or controller versions fail closed.

The submission helper atomically creates a request exactly once for a verified OIDC identity. Replayed OIDC `jti`, duplicate run tuple, reused request ID with different content, or second active transaction is rejected. A matching status query is read-only.

The transaction service journal uses unique same-directory temporary files, file sync according to the selected durability contract, atomic rename, strict schema, and bounded strings. It records enough state to determine whether drain completed, checkout mutation began, an updater process may remain, candidate runtime finalized, acceptance refs changed, controller activation began, primary startup began, or restoration/manual recovery is required.

The transaction process traps expected signals and attempts safe convergence. SIGKILL, process loss, or host restart is handled by journal recovery. Workflow cancellation does not own or kill the root service.

Accepted Git refs are updated through one atomic `git update-ref --stdin` transaction where possible. The journal makes the separate metadata publication recoverable. A crash may expose the old accepted state or a detectable incomplete acceptance; it must never silently treat an unverified target as stable.

`recover` never retries target. It terminates surviving target descendants, selects recorded LKG from the protected recovery repository, reconstructs or resets tracked checkout, runs stable controller-mode updater, verifies manifest and local smoke, starts primary, restores active controller, and archives the journal only after success.

Direct manual runtime mutation after managed bootstrap is prohibited because it cannot update accepted state transactionally. Administrator emergency repair is explicit, recorded, and followed by bootstrap or accepted-main reconciliation before normal deployment resumes.

Recovery repository garbage collection retains every object referenced by current, previous, active-journal, and retained-generation refs. It never prunes the only restorable LKG. Integrity checks occur before every target mutation and after accepted-state publication.

Tests use temporary roots, fake process/service adapters, local Git repositories, fake OIDC keys and tokens, and controlled failures. They do not register real runners, mutate organization settings, alter production `/etc` or `/srv`, stop real services, or require external network.

## Artifacts and Notes

Keep evidence append-only.

- 2026-07-21: Reviewed repository deployment contracts on baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- 2026-07-21: Reviewed GitHub runner, runner-group, workflow restriction, workflow-dispatch, environment, reusable-workflow, OIDC, concurrency queue, and self-hosted runner mechanisms.
- 2026-07-21: Created draft PR #47 with an active plan and no production implementation.
- 2026-07-21: Converted the plan to the PR #3 living ExecPlan structure.
- 2026-07-21: First adversarial review corrected checkout-before-drain, overstated recovery, ownership, authorization, exact-SHA, queue, LKG, journal, controller-upgrade, and Docker-scope defects.
- 2026-07-21: Second adversarial review found primary-dependent validation, unsafe primary smoke scheduling, workflow-lifetime coupling, bootstrap circularity, manual/LKG divergence, reusable-caller ambiguity, old-target protocol incompatibility, and exact-object movement behavior.
- 2026-07-21: Revised the plan around GitHub-hosted portable validation, OIDC-authenticated callers, independent root transaction service, controller-mode updater with primary stopped, local runtime smoke, bootstrap-pending mode, managed update boundary, and stable versioned protocol.

Required future evidence includes:

- Milestone 0 settings/API/OIDC evidence without credential material;
- baseline and protected-file hashes;
- exact portable and complete validation commands, counts, coverage, and failures;
- runner group, labels, workflow refs, environment policy, branch protection, OIDC claim allowlist, and actor IDs;
- ownership and mode evidence;
- transaction request/run IDs, OIDC-derived mode and actor ID, target/source, previous LKG, origin-main-at-start, phases, process status, manifest digest, controller version, restoration result, and final state;
- recovery ref/object/fsck verification;
- cancellation and boot-recovery evidence;
- production and disposable-VM demonstration records;
- exact-head CI and independent final review.

GitHub documentation reviewed:

- `https://docs.github.com/en/actions/reference/runners/self-hosted-runners`
- `https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access`
- `https://docs.github.com/en/rest/actions/self-hosted-runner-groups`
- `https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow`
- `https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments`
- `https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency`
- `https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations`
- `https://docs.github.com/en/actions/reference/security/oidc`
- `https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/monitor-and-troubleshoot`

Non-goals:

- hostile-code isolation;
- guaranteeing recovery from malicious root code, VM, disk, network, systemd, or resource-exhaustion failures;
- autoscaling or ephemeral/JIT runners;
- persisting PAT or GitHub App credentials;
- fork or arbitrary-repository targets;
- parallel host mutation;
- transactional proof that primary has executed a GitHub job before promotion;
- VM snapshot management by Agent Relay;
- general reversal of packages, credentials, databases, Docker volumes, or arbitrary application data;
- re-enabling Docker provisioning in `update.sh`;
- testing pre-protocol branches without rebasing or merging the deployment-protocol baseline;
- automatically accepting breaking controller/updater protocol changes.

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

Required services are equivalent to:

    actions.runner.Divorium.gh-runner.service
    actions.runner.Divorium.gh-deploy-runner.service
    agent-relay-deploy-transaction.service
    agent-relay-deploy-recover.service

The deployer may invoke only fixed no-argument root-owned submission/status helpers through sudo. Request content and OIDC token arrive over standard input. The deployer cannot directly execute arbitrary controller commands, shell, Git, systemctl, updater, recovery, or root-state reads.

Repository protocol metadata is equivalent to:

    interface DeploymentProtocol {
      schemaVersion: 1;
      updaterControllerProtocol: 1;
      runtimeManifestSchema: 1;
      controllerCandidateSchema: 1;
      minimumInstalledController: string;
    }

The submission envelope is equivalent to:

    interface DeploymentSubmission {
      schemaVersion: 1;
      requestId: string;
      requestedMode: "main" | "temporary" | "bootstrap";
      sourceType: "push" | "pr" | "branch";
      source: string;
      targetSha: string;
      targetRef: string;
      protocolVersion: 1;
      oidcToken: string;
    }

`requestedMode`, caller identity, actor ID, run identity, event, environment, workflow refs, and workflow SHAs are authoritative only after derivation and cross-check against the verified OIDC token. `oidcToken` is consumed and never stored.

The required OIDC claims include at least:

    iss
    aud
    exp
    iat
    nbf
    jti
    repository
    repository_id
    repository_owner
    repository_owner_id
    repository_visibility
    ref
    sha
    event_name
    run_id
    run_attempt
    check_run_id
    actor
    actor_id
    environment
    runner_environment
    workflow_ref
    workflow_sha
    job_workflow_ref
    job_workflow_sha

The runtime build manifest is equivalent to:

    interface RuntimeBuildManifest {
      schemaVersion: 1;
      sourceSha: string;
      deploymentProtocol: 1;
      updaterVersion: string;
      entrypoint: "src/run-codex.js";
      entrypointSha256: string;
      finalized: true;
      builtAt: string;
    }

`deployed-state.json` is atomically published and equivalent to:

    interface DeployedState {
      schemaVersion: 1;
      transactionId: string;
      requestId: string;
      sourceSha: string;
      runtimeEntrypointSha256: string;
      controllerVersion: string;
      acceptedRef?: "refs/agent-relay/current";
      publishedAt: string;
    }

The transaction journal is versioned and equivalent to:

    interface DeploymentTransaction {
      schemaVersion: 1;
      controllerVersion: string;
      requestId: string;
      transactionId: string;
      runId: number;
      runAttempt: number;
      checkRunId: number;
      actorId: number;
      mode: "main" | "temporary" | "bootstrap";
      sourceType: "push" | "pr" | "branch";
      source: string;
      targetRef: string;
      targetSha: string;
      originMainShaAtStart?: string;
      previousCheckoutSha?: string;
      previousAcceptedSha?: string;
      previousControllerVersion: string;
      protocolVersion: 1;
      phase:
        | "submitted"
        | "preflight"
        | "superseded"
        | "draining"
        | "drained"
        | "target_checked_out"
        | "host_compatibility"
        | "target_updating"
        | "target_validating"
        | "target_smoke"
        | "controller_staging"
        | "accepting_refs"
        | "controller_activating"
        | "starting_primary"
        | "restoring_checkout"
        | "restoring_update"
        | "restoring_validating"
        | "restoring_smoke"
        | "restoring_primary"
        | "completed"
        | "critical_recovery";
      primaryServiceWasActive: boolean;
      drainDeadlineAt: string;
      updaterProcessGroup?: number;
      targetResult?: OperationResult;
      runtimeManifestSha256?: string;
      controllerCandidateVersion?: string;
      controllerActivationResult?: OperationResult;
      restorationResult?: OperationResult;
      finalActiveSha?: string;
      finalAcceptedSha?: string;
      logPath: string;
      logSha256?: string;
      startedAt: string;
      updatedAt: string;
    }

    interface OperationResult {
      kind: "success" | "exit" | "signal" | "timeout" | "validation" | "authentication" | "infrastructure";
      exitCode?: number;
      signal?: string;
      code: string;
    }

Exact serialization may differ, but it must be bounded, strict-schema validated, free of stored credentials, sufficient for deterministic restart handling, and able to distinguish authentication, preflight, updater, timeout, signal, manifest, local smoke, controller activation, primary startup, restoration, and infrastructure failures.

Recovery refs are equivalent to:

    refs/agent-relay/current
    refs/agent-relay/previous
    refs/agent-relay/transactions/<transaction-id>
    refs/agent-relay/generations/<accepted-generation>

Current and previous refs are changed through atomic reference transactions. Active-journal and retained-generation refs protect objects from pruning.

Initial constants or validated configuration must include bounded values for OIDC input bytes, request bytes, clock skew, JWKS cache age, drain deadline, host compatibility timeout, updater timeout, TERM grace, KILL grace, local smoke timeout, primary startup settle period, transaction service timeout, status polling interval, local raw-log bytes, exported diagnostic bytes, retained transactions, retained accepted generations, and controller versions.

Use existing pinned host tools where possible: Bash, Git, curl, jq, systemd, coreutils, Node.js, and the official GitHub Actions runner archive. OIDC JWT verification may use Node 22 `crypto` and HTTPS built-ins. Add no third-party runtime package unless implementation records why existing tools cannot provide deterministic parsing, signature verification, process control, Git reference transactions, or atomic state.

Revision note (2026-07-21): Performed a second complete adversarial review. Replaced primary-dependent validation with credential-free GitHub-hosted portable validation; removed the unsafe transactional primary-job smoke and kept primary stopped through temporary restoration; introduced an exact runtime manifest and local smoke as `github-runner`; authenticated reusable-workflow callers with verified GitHub OIDC claims; moved the host transaction into an independent root systemd service; resolved bootstrap circularity through bootstrap-pending mode; prohibited unmanaged direct updates after bootstrap; added a stable target protocol requirement, exact-object failure semantics, atomic recovery refs, cancellation/boot recovery, and explicit listener-readiness limitations. This revision changes only the active ExecPlan and does not claim implementation complete.