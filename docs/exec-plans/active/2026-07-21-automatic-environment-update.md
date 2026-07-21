# Automate Agent Relay environment deployment and rollback

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current while work proceeds. Maintain this document according to `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

The reviewed baseline is `main` commit `e9ec636e5abf383f8831fc126b99f04e2e005a3c`. Before implementation starts, verify that this commit exists and is an ancestor of `HEAD`. If `main` advances, recheck every current-state statement, path, workflow, runner contract, GitHub setting assumption, and referenced Docker decision. Update the baseline and record the review in `Progress`; do not silently implement against another revision.

Codex may use read-only Git commands such as `status`, `diff`, `show`, `grep`, `rev-parse`, `show-ref`, `cat-file`, and `merge-base`. Codex must not run `git add`, `commit`, `merge`, `rebase`, `reset`, `restore`, `checkout`, `cherry-pick`, or `push`; the GitHub runner owns commit and push. Workflow files and GitHub settings are human-maintained for this task. Codex must not edit `.github/workflows/` or `examples/github-actions/`.

## Purpose / Big Picture

Replace the current release procedure:

    cd /srv/github-runner/storage/agent-relay
    git pull --ff-only
    ./update.sh

with an observable deployment system for the single long-lived Agent Relay VM.

After this work:

- a push to protected `main` validates the exact commit on GitHub-hosted infrastructure and deploys it only if it is still the current `origin/main` when the host transaction begins;
- an authorized operator can manually select an open same-repository pull request, including a draft PR, or a same-repository branch, resolve it once to an exact commit, validate it outside both self-hosted runners, and test that revision's real privileged `update.sh` on the real host;
- a second persistent deployment runner on the same VM remains independent of the primary Agent Relay runtime and can submit or inspect deployment transactions while the primary runner is stopped or broken;
- the controller stops the primary listener and drains every active `github-runner` worker before changing the trusted checkout;
- the candidate runtime is built in a transaction-scoped staging directory and the previously active runtime is retained until the transaction is accepted or restored;
- controller-mode update leaves the primary listener stopped, so a temporary target is never exposed to ordinary queued CI or Codex jobs;
- the controller runs a local, network-free runtime health check as `github-runner`, validates an exact build manifest, and starts the primary listener only after the final accepted or restored runtime is selected;
- a failed `main` deployment attempts to converge to the previous locally retained last-known-good main revision without requiring GitHub network access;
- workflow cancellation does not terminate a host transaction after mutation has started because a root-owned systemd service, not the workflow shell, owns the transaction;
- deployment and restoration results are reported separately, and an explicit critical-recovery state is preserved when automated restoration cannot be proven.

The selected revisions are trusted same-repository code and execute with broad host authority because the purpose is to test the real privileged updater. This system provides **best-effort rollback for accidental failures**. It is not isolation from malicious code and is not a VM snapshot. A privileged target can damage the controller, deployment runner, recovery repository, credentials, operating system, Docker data, or the VM itself. Root ownership, runner groups, environment approval, sanitized environment, and a second runner on the same VM must never be described as protection from malicious privileged target code.

The acceptance path deliberately does not claim that the primary registration has already accepted a GitHub job. Starting the primary listener during a temporary transaction would allow an unrelated queued job to race onto the temporary runtime. Without retaining an organization-management credential for dynamic runner control, the transaction instead proves runtime identity and health locally, then starts the primary only after final state is selected. Documentation must preserve this limitation.

This plan preserves the current Docker decision: `DOCKER_PROVISIONING_ENABLED=0` remains authoritative. The work must not re-enable Docker provisioning in `update.sh` or reopen the Docker design from PR #46.

## Progress

Keep this section append-only. Split partially completed work into a checked historical entry and a remaining unchecked entry. Every checked implementation item must cite a repository location plus passing automated evidence, or a reproducible command plus its captured result. Blocked items remain unchecked and use the `[blocked]` prefix required by `.agent/PLANS.md`.

- [x] (2026-07-21) Reviewed the current installation, updater, runner, CI, Codex, documentation, and package-script contracts on baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- [x] (2026-07-21) Confirmed that the primary runner cannot synchronously update itself because `update.sh` stops its listener and waits for every `Runner.Worker` owned by `github-runner`.
- [x] (2026-07-21) Reviewed GitHub persistent, ephemeral, JIT, registration-token, runner-label, runner-group, selected-workflow, workflow-dispatch, environment-review, concurrency-queue, and self-hosted queue mechanisms.
- [x] (2026-07-21) Selected a second persistent deployment runner for the single long-lived VM instead of an ephemeral or JIT runner.
- [x] (2026-07-21) Converted the original notes to the living ExecPlan structure used by PR #3.
- [x] (2026-07-21) First adversarial review corrected checkout-before-drain, overstated same-VM recovery, incomplete ownership and authorization, missing exact-SHA validation, unsafe queue assumptions, weak LKG storage, incomplete journal, controller-upgrade gaps, and Docker-scope ambiguity.
- [x] (2026-07-21) Second adversarial review corrected primary-dependent validation, unsafe primary-job smoke, workflow-lifetime coupling, bootstrap circularity, unmanaged manual-update divergence, reusable-workflow caller ambiguity, and old-target protocol incompatibility.
- [x] (2026-07-21) Third adversarial review removed the unnecessary custom OIDC verifier and reusable workflow, added direct selected-workflow routing, kept the deployment runner available for diagnostics during critical recovery, added staged runtime activation and retained runtime backup, moved controller activation before accepted-ref publication, defined bootstrap fallback before an LKG exists, and separated environment approval from deployment concurrency.
- [ ] Complete Milestone 0 and record actual GitHub-side feasibility evidence before implementation code is written.
- [ ] Revalidate the pinned baseline and human-maintained workflow files immediately before implementation.
- [ ] Implement the stable deployment protocol, portable validation entrypoint, staged updater mode, runtime manifest and health check, and managed/manual update boundary.
- [ ] Implement fresh-install and existing-host migration support for the deployment account, second runner, restricted group, controller services, recovery repository, state roots, and bootstrap-pending mode.
- [ ] Implement trusted request submission, root transaction lifetime, drain, exact checkout, updater execution, local health, acceptance, restoration, cancellation survival, and boot recovery.
- [ ] Human reviewer: add the direct automatic-main, temporary, bootstrap, and status workflows; route every ordinary self-hosted job only to `agent-relay-main`; configure runner-group restrictions, environments, branch protection, and concurrency.
- [ ] Add deterministic unit, contract, integration, and system coverage for feasibility, installation, migration, drain, ownership, portable validation, protocol compatibility, staged runtime activation, transactions, interruption, health, restoration, controller activation, and bootstrap recovery.
- [ ] Run focused validation, complete repository validation, exact-head CI, and independent point-by-point review.
- [ ] Perform real-host migration and temporary/main demonstrations. Perform failed-main, cancellation, restart, checkout-corruption, bootstrap-failure, and controller-activation demonstrations on a disposable clone or snapshot-equivalent VM.
- [ ] Update `Outcomes & Retrospective`, append final evidence and a revision note, and move this same plan to `docs/exec-plans/completed/` only after every item is checked.

## Surprises & Discoveries

- Observation: checkout mutation before drain can change scripts used by an active Codex job.
  Evidence: current workflows execute resolver, launcher, and finalizer scripts directly from `/srv/github-runner/storage/agent-relay`.

- Observation: another runner under the same `github-runner` UID would retain the updater self-wait deadlock.
  Evidence: the current wait condition is UID plus process name, not runner registration name or label.

- Observation: a root-owned controller is not a security boundary against root-equivalent target code.
  Evidence: a privileged target can modify root-owned files, services, credentials, networking, recovery data, and the VM.

- Observation: the existing updater lock is too narrow.
  Evidence: it begins inside `update.sh`, after future Git operations, and ends before external acceptance or restoration.

- Observation: exact-SHA validation cannot depend on the primary runner.
  Evidence: the feature must still deploy or restore when the primary service is unavailable. Portable validation must run on GitHub-hosted infrastructure.

- Observation: the current complete `npm run check` is not portable to a clean GitHub-hosted runner.
  Evidence: `check:toolchain` requires the dedicated host's pinned Java, Go, Rust, Codex, and filesystem layout. A separate portable check is required without weakening the full host check.

- Observation: a primary GitHub smoke job creates a scheduling race.
  Evidence: once the primary listener starts, any queued ordinary job matching `agent-relay-main` can be assigned before the intended smoke. During a temporary test that would expose unaccepted code.

- Observation: the current updater destroys active `dist` before the replacement build completes.
  Evidence: bootstrap starts with no accepted LKG. A failed first managed build must not erase the only working runtime. Runtime staging and a retained previous-runtime directory are required.

- Observation: checkout SHA does not prove runtime provenance.
  Evidence: the baseline runtime has no source-SHA manifest. Every managed build requires a root-owned manifest and verified entrypoint digest.

- Observation: current `origin/main` is not rollback state after a failed merge deployment.
  Evidence: the remote already points to the failed commit. Recovery requires local accepted refs.

- Observation: a text SHA does not retain the Git object.
  Evidence: ref deletion, force-push, garbage collection, or production `.git` damage can make the object unavailable. A protected local bare repository is required.

- Observation: restoration must not require GitHub availability.
  Evidence: network or DNS failure may be part of the incident.

- Observation: workflow cancellation cannot own host safety.
  Evidence: cancellation can terminate the invoking shell after checkout mutation. A root systemd transaction must continue independently.

- Observation: a reusable workflow and custom OIDC verifier were unnecessary for this repository.
  Evidence: runner groups can permit several exact workflow paths pinned to `refs/heads/main`, and only jobs directly defined in those workflows can use the group. Direct selected workflows remove caller ambiguity and a large custom authentication surface.

- Observation: environment approval must not occupy the deployment concurrency queue.
  Evidence: an unapproved temporary request could otherwise block automatic main deployment. Resolve and validate first, run a lightweight protected approval job, then place only the deployment job in the shared concurrency group.

- Observation: cancellation releases GitHub concurrency before the root transaction necessarily finishes.
  Evidence: the next deployment job must detect `busy`, wait for the active transaction to finish, and only then submit its request. GitHub concurrency is advisory; the host lock is authoritative.

- Observation: bootstrap needs the deployment runner before bootstrap can complete.
  Evidence: migration starts the restricted runner in bootstrap-pending mode. The controller accepts only bootstrap and status requests until initial accepted state exists.

- Observation: bootstrap failure needs a rollback source before an LKG exists.
  Evidence: migration must preserve the current checkout object locally, and staged activation must retain the previously active `dist`. Failure restores the exact pre-bootstrap checkout/runtime/service state without calling it LKG.

- Observation: direct `git pull && ./update.sh` after managed bootstrap would diverge runtime from accepted state.
  Evidence: later recovery could replace an unrecorded manual runtime. Managed mode must require the deployment controller or an explicit administrator recovery/rebootstrap procedure.

- Observation: controller upgrades cannot change the active protocol underneath the current controller.
  Evidence: updater, manifest, request and journal protocols require backward compatibility. Breaking changes need a separate administrator migration plan.

- Observation: unknown recovery state should block primary mutation, not the diagnostic channel.
  Evidence: the deployment runner is intended to report failures while primary is unavailable. Boot recovery must keep primary stopped but allow the restricted deployment runner and read-only status workflow to start when its own registration remains intact.

- Observation: listener credential files may legitimately change without changing runner identity.
  Evidence: acceptance must verify regular-file type, ownership, restrictive mode, and stable runner identity fields rather than hash all credential bytes.

- Observation: GitHub concurrency is bounded and dispatch order is not correctness state.
  Evidence: `queue: max` retains at most 100 pending jobs. The controller serializes the host and skips stale main requests.

## Decision Log

- Decision: use a second persistent organization runner on the same VM.
  Rationale: the VM is long-lived and needs a recovery channel independent of the primary runner process. Ephemeral creation adds persistent API credentials and lifecycle complexity without VM isolation.
  Date/Author: 2026-07-21 / design review.

- Decision: describe restoration as best effort for accidental failure.
  Rationale: real updater testing requires broad host authority that can defeat same-VM controls.
  Date/Author: 2026-07-21 / adversarial-review correction.

- Decision: use four direct workflows pinned to protected main: `deploy-main.yml`, `deploy-temporary.yml`, `deploy-bootstrap.yml`, and `deploy-status.yml`.
  Rationale: runner-group selected-workflow policy can list several exact paths. Direct workflows eliminate reusable-caller ambiguity and remove the need for custom OIDC authentication.
  Date/Author: 2026-07-21 / simplification review.

- Decision: restrict the deployment runner group to only those four workflow paths at `refs/heads/main`, repository `Divorium/agent-relay`, and label `agent-relay-deploy`.
  Rationale: only jobs directly defined in the reviewed main-branch workflows may reach the deployment runner.
  Date/Author: 2026-07-21 / access-control design.

- Decision: temporary and bootstrap workflows require protected-environment approval under the operator model verified in Milestone 0.
  Rationale: repository write access alone must not automatically authorize privileged branch execution. Approval occurs before the deployment job enters shared concurrency.
  Date/Author: 2026-07-21 / authorization design.

- Decision: validate target code on `ubuntu-latest`, not on either self-hosted runner.
  Rationale: validation must work while primary is broken and must not execute target scripts under the privileged deployment account.
  Date/Author: 2026-07-21 / validation design.

- Decision: pin every action used by deployment workflows to a full commit SHA and grant minimum token permissions.
  Rationale: deployment workflow code is a trust boundary. Mutable action tags and unnecessary token scopes are avoidable supply-chain risk.
  Date/Author: 2026-07-21 / workflow-hardening review.

- Decision: keep the deployment runner under `agent-relay-deployer` with no direct checkout or root-state write access.
  Rationale: it runs only reviewed workflow shell and invokes fixed root-owned no-argument helpers. The root service owns mutation.
  Date/Author: 2026-07-21 / ownership design.

- Decision: use mode-specific submission helpers for main, temporary, and bootstrap, plus a read-only status helper.
  Rationale: mode is derived from the installed helper selected by the trusted workflow, not from an untrusted command-line option. Helpers read one bounded canonical JSON request from standard input and accept no arguments.
  Date/Author: 2026-07-21 / request-boundary design.

- Decision: run the host transaction in a root-owned systemd service independent of workflow lifetime.
  Rationale: workflow cancellation or runner death must not interrupt safety after mutation starts.
  Date/Author: 2026-07-21 / cancellation design.

- Decision: keep the host lock authoritative and treat GitHub concurrency as queueing only.
  Rationale: cancellation may release GitHub concurrency while a root transaction remains active. A subsequent job waits on read-only status and submits only after the host is idle.
  Date/Author: 2026-07-21 / serialization design.

- Decision: stop primary and drain every `github-runner` worker before checkout mutation.
  Rationale: active jobs use files from the trusted checkout.
  Date/Author: 2026-07-21 / safety correction.

- Decision: drain is bounded and non-destructive.
  Rationale: timeout does not kill the active GitHub job, does not mutate checkout/runtime, restores prior listener state, and records `drain_timeout`.
  Date/Author: 2026-07-21 / operational policy.

- Decision: run Git mutation as the recorded administrator through the root controller.
  Rationale: the checkout remains administrator-owned; deployer receives no direct write access.
  Date/Author: 2026-07-21 / ownership correction.

- Decision: define one backward-compatible deployment protocol before managed deployment.
  Rationale: an installed controller cannot safely execute an updater that predates or breaks its protocol. Old temporary branches must merge or rebase the protocol baseline.
  Date/Author: 2026-07-21 / compatibility design.

- Decision: controller-mode update uses staged runtime activation and leaves primary stopped.
  Rationale: build failure must preserve current runtime, bootstrap needs a pre-LKG fallback, and temporary code must never serve ordinary jobs.
  Date/Author: 2026-07-21 / runtime-safety design.

- Decision: use a local runtime health command executed as `github-runner`, not a transactional GitHub smoke job.
  Rationale: it verifies runtime readability and behavior without opening primary scheduling during a temporary transaction. It does not claim server-side job acceptance.
  Date/Author: 2026-07-21 / smoke-isolation design.

- Decision: make recovery Git refs authoritative and metadata descriptive.
  Rationale: atomic Git ref transactions retain current and previous accepted objects; metadata publication is recoverable through the journal.
  Date/Author: 2026-07-21 / recovery-store design.

- Decision: automatic main is latest-only.
  Rationale: a validated request whose SHA no longer equals current `origin/main` is `superseded` and makes no host change.
  Date/Author: 2026-07-21 / ordering policy.

- Decision: before bootstrap completes, only bootstrap and status workflows are accepted.
  Rationale: the deployment runner is required to run bootstrap, but no normal transaction may mutate the host before initial accepted state exists.
  Date/Author: 2026-07-21 / bootstrap design.

- Decision: after managed mode, direct ordinary `update.sh` invocation fails closed.
  Rationale: unmanaged runtime mutation would diverge from accepted state. Recovery and rebootstrap remain explicit administrator procedures.
  Date/Author: 2026-07-21 / state-consistency design.

- Decision: stage and verify a controller candidate before accepted refs are changed.
  Rationale: activation failure must leave old accepted refs and controller intact. Only backward-compatible main targets may activate controller code; temporary targets never do.
  Date/Author: 2026-07-21 / controller-upgrade correction.

- Decision: keep the deployment runner available for read-only status in critical recovery when its own service remains usable.
  Rationale: boot recovery blocks primary startup and further mutation, but should not remove the diagnostic channel the second runner was introduced to provide.
  Date/Author: 2026-07-21 / recovery-channel correction.

- Decision: preserve `DOCKER_PROVISIONING_ENABLED=0`.
  Rationale: this plan does not reopen Docker-host provisioning.
  Date/Author: 2026-07-21 / scope correction.

## Outcomes & Retrospective

This plan remains active. No installer, updater, controller, workflow, service, runner registration, GitHub setting, or production-host behavior has been changed by the plan-only commits.

The current design avoids the principal circular dependencies: target validation does not require primary, temporary health does not start primary, bootstrap can run before an LKG exists, workflow cancellation does not own the host process, and failed candidate builds retain the prior runtime. The remaining same-VM limitation is explicit: privileged target code can defeat recovery controls.

The implementation is intentionally larger than `git pull && ./update.sh` because the current runner updates itself, active jobs read the shared checkout, active runtime has no source identity, and the first managed deployment has no existing LKG. Milestone 0 must stop implementation if actual GitHub runner-group or environment controls cannot enforce the accepted trust model.

Update this section after every accepted milestone. On completion, state real-host and disposable-VM results and move this same plan to `completed` without replacing it with a summary.

## Context and Orientation

Current host contracts:

- `/srv/github-runner/storage/agent-relay`: administrator-owned checkout and root-owned `dist`;
- `/srv/github-runner/storage/work`: primary workflow workspaces;
- `/srv/github-runner/storage/runner`: primary runner installation;
- `/srv/github-runner/storage/home`: primary home and Codex authentication;
- `/srv/github-runner/storage/build` and `build-home`: builder state;
- `github-runner`: primary runner and Codex account, without sudo;
- `agent-relay-builder`: compiler account, without sudo;
- `/etc/agent-relay/administrator`: recorded human administrator;
- `actions.runner.Divorium.gh-runner.service`: primary runner service.

`install.sh` is a one-time installer. It installs pinned toolchains, creates accounts and directories, downloads and verifies the official runner, obtains a short-lived registration token from an interactively provided organization credential, configures `gh-runner`, records the administrator, and performs Codex login.

`update.sh` currently accepts no arguments, requires the exact source path and recorded administrator, acquires sudo, stops primary, waits indefinitely for `github-runner` workers, deletes active `dist`, compiles directly into a new `dist`, finalizes ownership/modes, and starts primary. Docker provisioning is disabled.

Current CI and Codex jobs use bare `[self-hosted]`. Before a second runner is registered, every ordinary self-hosted job must be changed to require `[self-hosted, agent-relay-main]`.

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

- **primary runner**: existing `gh-runner`, which executes CI and Codex only after final runtime selection;
- **deployment runner**: `gh-deploy-runner`, which executes only the four selected deployment/status workflows;
- **portable validation**: GitHub-hosted repository checks that do not assume dedicated host toolchain paths;
- **host compatibility**: installed non-mutating controller checks of required commands, versions, filesystem, services, and target protocol metadata;
- **controller service**: root-owned transaction owner independent of workflow lifetime;
- **deployment protocol**: stable versioned contract between installed controller, target updater, build manifest, controller candidate, and journal;
- **LKG**: `refs/agent-relay/current` in the recovery repository;
- **pre-bootstrap state**: exact checkout commit plus retained active runtime/service state, used only to recover a failed first bootstrap and never called LKG;
- **runtime health**: fixed network-free command executed as `github-runner` against finalized runtime while primary is stopped;
- **critical recovery**: mutation occurred and final accepted/restored state cannot be proven.

## Plan of Work

### Milestone 0: Prove GitHub-side feasibility

Before implementation, verify on the actual organization and repository that:

- an organization runner group can be created or managed;
- it can allow this public repository, restrict repository access to `Divorium/agent-relay`, and restrict workflow access to the four exact workflow paths pinned to `refs/heads/main`;
- workflow restrictions are writable rather than inherited read-only;
- the installation credential has only the permissions required to manage the group, labels, registration and inspection;
- protected environments and required reviewers are available for temporary and bootstrap approval;
- the user accepts the actual reviewer/self-review/administrator-bypass model available in this repository;
- protected `main` prevents unauthorized workflow changes, force pushes and deletion;
- `concurrency.queue: max` is accepted and its 100-pending-job bound is operationally acceptable.

If any required control is unavailable, append `[blocked]`, do not register or start a privileged deployment runner, and revise the architecture with the operator.

### Milestone 1: Define stable repository and updater protocols

Revalidate baseline, updater behavior, workflow paths, package scripts, Docker state, service behavior and `.agent/PLANS.md`.

Add a versioned repository contract, equivalent to `.agent-relay/deployment-protocol.json`, with integer protocol ranges rather than ambiguous version strings:

    schemaVersion: 1
    updaterControllerProtocol: 1
    runtimeManifestSchema: 1
    controllerCandidateSchema: 1
    minimumControllerProtocol: 1
    maximumControllerProtocol: 1

The installed controller rejects a target before drain unless its exact commit contains a supported contract. A pre-protocol temporary branch must merge or rebase the protocol baseline. Breaking protocol changes require a separate administrator migration plan.

Add `npm run check:portable` or equivalent. It must run typecheck, tests, runtime build validation, shell syntax, Node script syntax and portable system tests on `ubuntu-latest` without the dedicated `/opt` toolchain layout, Codex login, Docker daemon, PAT, deployment runner or primary runner. Keep `npm run check` and `check:toolchain` as the complete dedicated-host contract.

Define a fixed runtime health entrypoint compiled into `dist`, for example `dist/src/runtime-health.js`. It accepts no arbitrary command, performs no network or model request, reads no source checkout, writes no persistent state, validates the runtime manifest and required modules, and returns bounded diagnostics.

### Milestone 2: Implement human-maintained workflows

Add four direct workflows. Every external action is pinned to a full commit SHA and every workflow declares minimum permissions.

`deploy-main.yml`:

- `push` to protected `main`;
- GitHub-hosted validation of exact `github.sha` using credential-free checkout, Node 22, explicit ordinary prerequisites, `npm ci`, and `npm run check:portable`;
- deployment job defined directly in this file, routed through group `agent-relay-deployment` and label `agent-relay-deploy`;
- deployment-job concurrency group `agent-relay-host-deployment`, `queue: max`, and no cancellation of an active deployment;
- fixed main submission helper and bounded status polling;
- stale requests are allowed to reach controller, which reports `superseded` without mutation.

`deploy-temporary.yml`:

- `workflow_dispatch` only and immediate failure unless `github.ref == refs/heads/main`;
- resolve `pr` or `branch` to one exact same-repository SHA; draft PRs are allowed when explicitly selected;
- reject forks, tags, merge refs, arbitrary URLs, malformed or ambiguous names, and unsupported protocol;
- GitHub-hosted portable validation of that SHA;
- a lightweight GitHub-hosted approval job referencing the protected temporary environment;
- only after approval, a directly defined deployment-runner job with the shared concurrency group;
- fixed temporary submission helper and bounded status polling.

`deploy-bootstrap.yml`:

- `workflow_dispatch` from `refs/heads/main` only;
- exact current protected-main target and portable validation;
- a lightweight GitHub-hosted approval job referencing the protected bootstrap environment;
- only after approval, a directly defined deployment-runner job with shared concurrency;
- fixed bootstrap helper; controller accepts it only while bootstrap-pending or explicit administrator rebootstrap state exists.

`deploy-status.yml`:

- `workflow_dispatch` from `refs/heads/main` only;
- directly defined deployment-runner job using the read-only status helper;
- no concurrency requirement, no target input and no mutation.

The runner group selected-workflow list contains exactly these four workflow paths at `refs/heads/main`. No reusable workflow is used. The deploy jobs never checkout target code, run target scripts, expose a persistent organization credential, or print raw updater output.

For a deployment job that starts after a canceled prior workflow, the helper may report `busy`. The job polls the active read-only status until the host becomes idle or its bounded wait expires, then submits its own request. It never cancels or replaces the active host transaction.

Update CI, Codex and examples so no production workflow retains bare `[self-hosted]`; ordinary jobs require `agent-relay-main`.

### Milestone 3: Install, migrate and enter bootstrap-pending mode

Extend fresh installation and add a restartable existing-host migration. They must:

- create `agent-relay-deployer` with separate runner, work and home directories and no Codex login;
- create or validate the selected-workflow runner group and register the deployment runner with its group and `agent-relay-deploy` label using a separate short-lived token;
- add `agent-relay-main` to the existing primary registration without replacing unrelated identity;
- install immutable controller versions, mode-specific submission helpers, status/admin helpers, transaction and boot-recovery units, recovery repository, runtime stage/backup roots, state/log roots and narrow sudo policy;
- permit deployer to invoke only the three no-argument submission helpers and read-only status helper, not shell, Git, systemctl, updater, controller or administrator recovery directly;
- keep PAT and registration tokens only in memory and out of arguments, files, logs, fixtures, workspaces and child environments;
- initialize recovery repository without inventing LKG from checkout HEAD or current `dist`;
- require a clean administrator-owned checkout at exact current protected `main` before bootstrap-pending is entered;
- import that checkout object to a temporary protected `refs/agent-relay/bootstrap-source` ref;
- record current primary service state and validate existing runtime path/ownership without claiming its source provenance;
- write bootstrap-pending, start the restricted deployment runner and leave normal main/temporary submissions disabled;
- require trusted bootstrap workflow;
- write `bootstrap-complete` and `managed-mode` only after successful bootstrap acceptance.

A failed bootstrap restores the pre-bootstrap checkout from `bootstrap-source`, restores the retained pre-bootstrap runtime directory if candidate activation occurred, restores the prior primary service state, retains bootstrap-pending, and does not create an LKG.

### Milestone 4: Implement fixed submission and independent transaction lifetime

Each mode-specific helper accepts no command-line arguments. It reads one size-bounded canonical JSON document from standard input. The trusted workflow generates the document from fixed GitHub contexts and validated outputs, not from shell interpolation of raw branch names.

The helper:

- derives mode from its installed executable name;
- validates strict schema, byte limits, exact repository identity, exact 40-character SHA, normalized source type/value, workflow run ID/attempt and audit actor;
- rejects unknown or duplicate fields and control characters;
- rejects normal modes before bootstrap and bootstrap after completion unless administrator rebootstrap state exists;
- checks active journal/result/request consistency;
- atomically stores a root-only request exactly once;
- starts `agent-relay-deploy-transaction.service` and returns request ID;
- never stores `GITHUB_TOKEN`, registration token or another credential because none is required by the helper.

The trusted selected workflow is the authentication boundary. The helper is not a public API and does not attempt to authenticate arbitrary callers. This limitation is explicit: compromise of `agent-relay-deployer` or the selected workflow is equivalent to compromise of the deployment control plane.

The root transaction service owns lock, journal, Git, updater, runtime activation, acceptance/restoration and terminal result. Workflow cancellation or deployment-runner death does not terminate it. A matching status query is read-only and returns only bounded normalized fields.

Boot recovery is ordered before the primary runner service. If a known journal requires recovery, it converges to pre-bootstrap state or LKG before primary may start. Unknown or contradictory state keeps primary stopped and marks critical recovery. The deployment runner remains allowed to start, when its own registration/service files are valid, so `deploy-status.yml` can report the condition. No remote workflow may perform arbitrary recovery; administrator recovery is local and explicit.

### Milestone 5: Implement the host transaction

The controller acquires one dedicated lock. Pre-bootstrap manual update and administrator recovery use the same lock. Controller-mode updater does not reacquire it.

Preflight before primary stop:

1. validate request, mode state, protocol, checkout canonical path/owner, expected remote, safe Git configuration, absence of submodules/alternate worktrees, recovery repository integrity, accepted refs, controller version and journal;
2. fetch only the expected source ref into a namespaced temporary ref as the recorded administrator, with hooks disabled;
3. verify the fetched object equals the already validated exact SHA and contains the supported protocol;
4. for main/bootstrap, fetch current `origin/main` and require exact equality; stale main returns successful `superseded` without mutation; stale bootstrap fails;
5. for temporary, never follow a moved ref: execute the pinned object if it was fetched and verified, otherwise fail without mutation;
6. verify current LKG objects or pre-bootstrap source/runtime fallback before mutation;
7. run installed non-mutating host compatibility checks against protocol requirements. Do not execute a target-provided compatibility script as root or administrator.

Drain:

1. write `preparing` journal and record prior primary service state;
2. stop only primary listener;
3. wait up to configured deadline for all `github-runner` `Runner.Worker` processes;
4. on timeout/error, restore prior listener state, leave checkout/runtime unchanged and record terminal failure;
5. write `drained` durably before checkout mutation.

Target update:

1. reset and clean administrator-owned checkout to exact target as administrator; preserve ignored caches in ordinary path and verify ownership afterward;
2. execute exact regular non-symlink target `update.sh` in controller mode, under a dedicated process group and sanitized environment;
3. controller-mode updater builds into a transaction-specific staging directory on the same filesystem as active `dist`;
4. verify staged manifest, entrypoint digest, ownership and modes before activation;
5. rename current `dist` to a transaction-specific retained runtime backup, then rename staged runtime to `dist`; journal both rename boundaries and restore backup in traps when possible;
6. leave primary stopped and retain previous runtime backup until terminal acceptance/restoration;
7. controller independently verifies active manifest and executes fixed runtime health as `github-runner` with bounded output and no network/model request.

Main acceptance:

1. stage and self-test a controller candidate only when controller source changed;
2. reject breaking updater/controller/journal protocol;
3. import exact target commit into recovery repo and verify connectivity;
4. provisionally switch to a compatible candidate and execute its post-switch self-test; switch back immediately on failure;
5. only after controller compatibility succeeds, atomically update recovery refs: `previous` becomes old `current`, `current` becomes target, and a retained generation ref is created;
6. publish accepted/deployed metadata through the recoverable journal protocol;
7. start primary and require stable service/listener state, expected runner identity fields, regular protected registration files and bounded startup diagnostics;
8. if startup/readiness fails, stop primary, revert accepted refs/metadata/controller, restore previous checkout/runtime, run stable health and retry primary startup;
9. mark success only when checkout, manifest, controller version, runtime digest, accepted refs and service state agree;
10. retain prior runtime backup and previous generation according to configured retention, then clean stale stage files.

Temporary transaction:

1. record target health result but never change accepted refs or activate controller candidate;
2. keep primary stopped;
3. restore checkout from local current LKG without GitHub;
4. run LKG updater in controller mode using the same staged activation contract;
5. verify LKG manifest and local health as `github-runner`;
6. restore active controller version and start primary only after LKG is complete;
7. report target and restoration separately; failed target plus successful restoration fails the workflow while reporting host healthy;
8. enter critical recovery if restoration cannot be proven.

Bootstrap transaction:

1. starts with no current LKG but has `bootstrap-source` and pre-bootstrap runtime fallback;
2. deploys exact current main through staged activation and local health;
3. stages and verifies compatible controller candidate before accepted refs;
4. creates `current` and first retained generation ref; `previous` remains absent until the next accepted main;
5. starts primary and verifies readiness;
6. writes `bootstrap-complete` and `managed-mode` last;
7. on any failure, restores pre-bootstrap checkout/runtime/service state and remains bootstrap-pending.

### Milestone 6: Updater, manifest, recovery and controller upgrades

Refactor `update.sh` without duplicating build logic:

- pre-bootstrap manual mode preserves current administrator use and service restoration;
- managed controller mode is accepted only through the installed controller protocol, assumes primary is already drained and leaves it stopped on success/failure;
- after `managed-mode`, direct ordinary invocation fails with a clear instruction to use GitHub deployment or administrator recovery/rebootstrap;
- build output is staged outside active `dist`; active runtime is never deleted before replacement passes validation;
- both successful modes produce root-owned immutable `dist/.agent-relay-build.json` containing schema version, exact source SHA, protocol version, updater version, health-entrypoint path/digest, runtime-entrypoint path/digest, completion timestamp and `finalized: true`;
- partial stage, partial manifest or interrupted rename is recoverable from journal/runtime backup and is never treated as active;
- Docker provisioning remains disabled.

Recovery repository refs are equivalent to:

    refs/agent-relay/current
    refs/agent-relay/previous
    refs/agent-relay/bootstrap-source
    refs/agent-relay/transactions/<transaction-id>
    refs/agent-relay/generations/<generation-id>

Current/previous/generation updates use atomic `git update-ref --stdin` transactions. Transaction and retained-generation refs protect objects from pruning. Bootstrap leaves `previous` absent.

Ordinary recovery never fetches GitHub. It restores tracked checkout from recovery objects, runs stable staged updater, verifies manifest/health, restores active controller and starts primary. Emergency checkout reconstruction may replace damaged production Git metadata using a root-controlled temporary clone and then restore administrator ownership. It may discard ignored caches.

If stable updater restoration fails but a retained previous runtime backup has a valid LKG manifest and digest, administrator recovery may start that runtime as an explicitly degraded critical-recovery action. It does not clear the journal or claim full convergence until source checkout and updater state are repaired.

Controller candidates use immutable version directories and atomic symlink switching. Candidate validation occurs before accepted refs. Active and previous controller versions understand the current journal/updater protocol. A breaking protocol migration is outside automatic deployment.

### Milestone 7: Documentation and acceptance

Update current-state documentation only after behavior exists. Document portable validation, direct selected workflows, approval, bootstrap-pending, queue bounds, busy handling after cancellation, drain timeout, staged runtime activation, manifest, local-health limitation, latest-main policy, managed manual-update refusal, recovery refs/backups, critical recovery, controller upgrades, bounded logs, Docker remaining disabled and best-effort rollback.

Run focused and complete repository tests, exact-head CI, independent review, real-host migration/temporary/main demonstrations and disposable-VM failure/restart/controller-upgrade demonstrations. Keep this plan active until all evidence exists.

## Concrete Steps

Run repository commands from repository root. Codex performs no Git mutation and does not edit human-maintained workflows.

Baseline checks:

    git cat-file -e e9ec636e5abf383f8831fc126b99f04e2e005a3c^{commit}
    git merge-base --is-ancestor e9ec636e5abf383f8831fc126b99f04e2e005a3c HEAD
    git status --short
    git diff --name-status e9ec636e5abf383f8831fc126b99f04e2e005a3c...HEAD
    git grep -n 'DOCKER_PROVISIONING_ENABLED=0' e9ec636e5abf383f8831fc126b99f04e2e005a3c -- update.sh
    git diff --exit-code e9ec636e5abf383f8831fc126b99f04e2e005a3c -- .agent/PLANS.md .github/workflows examples/github-actions

Milestone 0 evidence must show, without credentials:

- runner group visibility `selected`, public repository allowed, exact selected repository, four exact selected workflows at `refs/heads/main`, and workflow restrictions writable;
- temporary/bootstrap environment branch policy, reviewers, self-review and administrator-bypass settings;
- protected-main/ruleset behavior for workflow changes, force pushes and deletion;
- accepted `queue: max` syntax and documented 100-pending bound;
- installation credential permissions required for runner groups and registration.

Portable validation must run on a clean GitHub-hosted Ubuntu image:

    npm ci
    npm run check:portable

It must require neither self-hosted runner, Codex login, Docker daemon, PAT, deployment secrets nor dedicated `/opt` toolchain paths.

Focused implementation validation must include equivalent commands:

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

Exact names may differ; update this section before running alternatives and preserve scenario coverage.

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

- primary registration labeled `agent-relay-main`;
- deployment runner in restricted group with `agent-relay-deploy` and no Codex login;
- normal requests rejected in bootstrap-pending before drain;
- controller/helpers/units/recovery/stage/backup/state/log/sudoers ownership and modes;
- no retained PAT or registration token;
- successful exact-current-main bootstrap with staged activation, manifest, local health, primary readiness, initial `current` ref, absent `previous`, and managed markers written last.

Production-VM demonstrations:

1. successful temporary target, primary stopped throughout target-active interval, then successful restoration;
2. controlled temporary updater failure, old runtime preserved or restored, then successful LKG restoration;
3. drain timeout with no checkout/runtime mutation and prior listener state restored;
4. superseded main skipped without mutation;
5. successful exact-main deployment becoming current LKG;
6. direct manual `update.sh` rejected after managed mode;
7. workflow canceled after submission while root service safely completes/restores;
8. status workflow reports active and terminal transaction without mutation.

Disposable clone/snapshot demonstrations:

1. bootstrap failure before and after runtime activation restores pre-bootstrap checkout/runtime/service;
2. failed main with network-disabled LKG restoration;
3. process termination during staged activation and deterministic journal recovery;
4. host restart after checkout mutation, with primary blocked and deployment status available;
5. production `.git` corruption followed by reconstruction from recovery objects;
6. controller candidate success and switchback failure path before accepted refs;
7. incompatible target protocol rejected before drain;
8. target/restoration double failure entering critical recovery with evidence preserved.

## Validation and Acceptance

Acceptance is observable behavior, not code presence or intended design.

Feasibility acceptance proves actual runner-group selected-workflow restrictions, public-repository access, environment approval model, protected-main rules and queue support. Missing required controls blocks implementation.

Workflow-routing acceptance proves only jobs directly defined in the four selected main workflows can use the deployment runner. A workflow on another path or ref remains unschedulable on that group. Deployment workflows use full-SHA action pins and minimum permissions.

Portable-validation acceptance proves exact target SHA is validated on GitHub-hosted infrastructure with no deployment secrets and no self-hosted runner. Failure prevents deployment-runner scheduling. Target branch movement never substitutes another SHA.

Approval acceptance proves temporary/bootstrap deployment job cannot enter concurrency or reach deployment runner before protected approval. The approved operator model is recorded from Milestone 0.

Serialization acceptance proves shared GitHub queueing, busy handling after cancellation, and host lock prevent interleaved mutation. Correctness does not depend on GitHub dispatch order. Queue overflow is observable and documented.

Drain acceptance proves listener stop, no new primary assignment, no checkout/runtime mutation while a worker remains, bounded timeout, no worker kill and prior listener restoration.

Ownership acceptance proves deployer cannot directly write checkout, runtime, controller, recovery, state, sudoers or services. Git remains administrator-owned; build staging is builder-owned until finalization; active runtime is root-owned; health runs as `github-runner`.

Protocol acceptance proves unsupported/breaking target protocol is rejected before drain. Controller mode never starts primary and receives no GitHub credential. Pre-bootstrap manual mode works; post-bootstrap direct mode fails closed.

Runtime-staging acceptance proves build failure leaves active runtime untouched; activation interruption is recovered using journal and backup; manifest/digest/ownership mismatches fail health; prior runtime backup remains until terminal state.

Temporary-isolation acceptance proves primary stays stopped from drain through target activation/health and LKG restoration/health. No ordinary CI or Codex job runs against temporary runtime.

Bootstrap acceptance proves no LKG is invented. Initial failure restores pre-bootstrap checkout/runtime/service. Success publishes `current`, leaves `previous` absent, starts primary and writes managed markers last.

Main acceptance proves latest-main check, drain, exact checkout, installed host compatibility, staged updater, manifest, local health, candidate controller validation before refs, atomic refs, metadata, primary startup and final consistency. Startup failure reverts refs/controller/checkout/runtime.

Runtime-identity acceptance proves checkout SHA, manifest source SHA, runtime and health digests, deployed metadata, controller version and recovery current ref agree. Missing, stale, partial, symlinked, wrongly owned or tampered data fails.

Listener-readiness acceptance verifies service, stable listener and runner identity fields, but explicitly does not claim that GitHub scheduled a job. Credential files are checked for type/owner/mode, not immutable byte hashes.

Cancellation acceptance kills deployment workflow after submission and after mutation. Root transaction continues with lock and terminal result. A subsequent deployment waits for host idle. Boot recovery handles process/host loss before primary startup.

Recovery acceptance works with GitHub network disabled, covers ordinary source restore, emergency Git reconstruction, staged-runtime backup, interrupted recovery, controller switchback and critical-state preservation. It does not claim malicious-root or whole-VM recovery.

Logging acceptance defines byte/retention limits. Raw target output is only a root-owned bounded local log with a truncation marker. Workflow output contains fixed phases and normalized bounded diagnostics, not a full transcript or a guarantee against secrets deliberately printed by privileged code.

Outcome semantics are exact:

- superseded main: workflow succeeds with explicit `superseded`, no mutation;
- successful main: workflow succeeds after accepted final state;
- failed main with successful restoration: workflow fails, host reported healthy at previous LKG;
- successful temporary plus successful restoration: workflow succeeds;
- failed temporary plus successful restoration: workflow fails, host reported healthy at LKG;
- any unproven restoration: workflow fails with critical recovery.

Completion requires every unchecked `Progress` item to be checked with evidence, focused and complete tests to pass, exact-head CI to pass, independent review to find no unresolved action point, production demonstrations to pass, and disposable-VM failure/restart/bootstrap/controller scenarios to pass.

## Idempotence and Recovery

Fresh install remains one-time. Ordinary releases do not rerun `install.sh`. Setup and migration distinguish absent, exact, partial and conflicting state and compensate only attempt-owned resources.

Migration is restartable. It may start the restricted deployment runner in bootstrap-pending mode but does not write accepted refs or managed markers. Conflicting accounts, registrations, groups, policies, refs, files or controller versions fail closed.

Submission creates one request exactly once. Reused request ID with different content or a conflicting active transaction is rejected. Status is read-only.

The root journal uses strict bounded schema, same-directory temporary files, required syncs and atomic rename. It records drain, checkout, stage, active-runtime backup, activation renames, target health, candidate controller, accepted-ref publication, primary startup, restoration and terminal disposition.

Runtime activation uses transaction-specific paths on the same filesystem. A crash may leave old active, staged only, backup-without-active or new-active-plus-backup; each state is distinguishable and recoverable from journal plus manifests.

Accepted refs change atomically. Metadata publication is separately journaled and recoverable. Bootstrap creates current only; later acceptance moves old current to previous. Retained transaction/generation refs prevent object pruning.

`recover` never retries target. It converges to pre-bootstrap state or LKG, restores source/runtime/controller, validates local health, starts primary when safe and archives journal only after success.

Unknown state keeps primary stopped but permits restricted deployment status when possible. Mutation remains blocked until local administrator repair.

Direct unmanaged runtime mutation after bootstrap is prohibited. Emergency repair is explicit, recorded and followed by accepted-main or rebootstrap reconciliation before normal deployment resumes.

Tests use temporary roots, local Git repositories, fake service/process adapters and deterministic barriers. They do not register real runners, mutate organization settings, alter production `/etc` or `/srv`, stop real services or require external network.

## Artifacts and Notes

Keep evidence append-only.

- 2026-07-21: Reviewed baseline deployment and runner contracts.
- 2026-07-21: Reviewed GitHub runner groups, selected workflows, environments, workflow dispatch, concurrency queuing and self-hosted behavior.
- 2026-07-21: Created draft PR #47 with plan only.
- 2026-07-21: Converted the plan to the PR #3 living ExecPlan structure.
- 2026-07-21: First adversarial review corrected drain, recovery guarantees, ownership, authorization, exact-SHA, queue, LKG, journal, controller-upgrade and Docker-scope defects.
- 2026-07-21: Second adversarial review corrected primary-dependent validation, primary smoke race, workflow-lifetime coupling, bootstrap circularity, unmanaged updates, reusable caller ambiguity and protocol compatibility.
- 2026-07-21: Third adversarial review simplified routing to direct selected workflows, removed custom OIDC, added staged runtime activation/pre-bootstrap fallback, corrected controller-activation order, preserved diagnostic runner availability and separated approval from deployment concurrency.

Required future evidence:

- Milestone 0 settings/API evidence without credentials;
- baseline/protected-file hashes;
- exact portable/full test commands, counts, coverage and failures;
- runner group, workflow paths, labels, environment and branch-protection evidence;
- ownership/mode evidence;
- request/transaction IDs, target, previous state, phases, process outcomes, manifest/runtime digests, controller version, restoration and final state;
- recovery ref/object/fsck verification;
- runtime staging/backup state evidence;
- cancellation/boot recovery evidence;
- production/disposable-VM demonstrations;
- exact-head CI and final review.

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
- guaranteed recovery from malicious root, VM, disk, network, systemd or resource-exhaustion failure;
- autoscaling or ephemeral/JIT runners;
- persisting PAT or GitHub App credentials;
- fork/arbitrary-repository targets;
- parallel host mutation;
- proof of GitHub job scheduling before promotion;
- VM snapshot management by Agent Relay;
- general reversal of packages, credentials, databases, Docker volumes or arbitrary application data;
- re-enabling Docker provisioning;
- testing pre-protocol branches without merging/rebasing the protocol baseline;
- automatic breaking controller/updater protocol migration.

## Interfaces and Dependencies

No public Agent Relay job API, Codex request/result contract, prompt contract, finalizer decision or workspace sandbox interface changes are required.

Required identities and registrations:

    recorded administrator:   /etc/agent-relay/administrator
    primary user:             github-runner
    builder user:             agent-relay-builder
    deployment user:          agent-relay-deployer
    primary runner:           gh-runner
    deployment runner:        gh-deploy-runner
    primary label:            agent-relay-main
    deployment label:         agent-relay-deploy
    deployment group:         agent-relay-deployment

Required services:

    actions.runner.Divorium.gh-runner.service
    actions.runner.Divorium.gh-deploy-runner.service
    agent-relay-deploy-transaction.service
    agent-relay-deploy-recover.service

Submission helpers accept no arguments and read canonical JSON on standard input:

    agent-relay-submit-main
    agent-relay-submit-temporary
    agent-relay-submit-bootstrap

Status is read-only. Administrator recovery uses a separate root-only command unavailable through deployment-runner sudo.

Submission schema is equivalent to:

    interface DeploymentRequest {
      schemaVersion: 1;
      requestId: string;
      workflowRunId: number;
      workflowRunAttempt: number;
      actor: string;
      sourceType: "push" | "pr" | "branch";
      source: string;
      targetRef: string;
      targetSha: string;
      protocolVersion: 1;
    }

Mode is derived from the helper. Exact values are validated again by the controller against fetched repository state. The request contains no credential.

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

Transaction journal is equivalent to:

    interface DeploymentTransaction {
      schemaVersion: 1;
      transactionId: string;
      requestId: string;
      mode: "main" | "temporary" | "bootstrap";
      sourceType: "push" | "pr" | "branch";
      source: string;
      targetRef: string;
      targetSha: string;
      previousCheckoutSha?: string;
      previousAcceptedSha?: string;
      previousControllerVersion: string;
      primaryServiceWasActive: boolean;
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

Exact serialization may differ, but it must be bounded, strict-schema validated, free of credentials and sufficient for deterministic restart handling.

Initial bounded constants/configuration must include request bytes, drain deadline, fetch deadline, host-check timeout, updater timeout, TERM/KILL grace, health timeout, primary settle interval, transaction deadline, busy-wait deadline, status polling interval, raw-log bytes, exported-diagnostic bytes, retained transactions, runtime backups, accepted generations and controller versions.

Use existing pinned host tools where possible: Bash, Git, curl, jq, systemd, coreutils, Node.js and the official Actions runner. Add no third-party runtime dependency unless implementation records why existing tools cannot provide deterministic parsing, process control, Git ref transactions or atomic state.

Revision note (2026-07-21): Performed a third complete adversarial review. Replaced the custom reusable-workflow/OIDC control plane with four direct main-pinned workflows selected by runner-group policy; separated environment approval from deployment concurrency; added host busy handling after workflow cancellation; made runtime replacement staged and recoverable with a retained prior runtime; defined pre-bootstrap fallback, current-only initial LKG, controller validation before accepted refs, and diagnostic deployment-runner availability during critical recovery; clarified listener-readiness and exact outcome semantics. This revision changes only the active ExecPlan and does not claim implementation complete.