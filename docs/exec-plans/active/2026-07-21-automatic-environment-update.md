# Automate main and secondary environment updates

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current while work proceeds. Maintain it according to `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

The reviewed baseline is `main` commit `e9ec636e5abf383f8831fc126b99f04e2e005a3c`. Before implementation starts, verify that commit exists and is an ancestor of `HEAD`. If `main` advances, recheck the installer, updater, runner services, workflow names, paths, and tests, then update the baseline in this plan.

Workflow files are human-maintained for this task. Codex may implement repository scripts, tests, and documentation, but must not edit `.github/workflows/` or `examples/github-actions/`.

## Purpose / Big Picture

The host must contain two independent, persistent Agent Relay runner environments:

- **main**: the stable environment used for ordinary CI and Codex work;
- **secondary**: the environment used to run and inspect pull-request revisions.

The environments update each other so that no GitHub Actions job stops or waits for the runner process executing that same job:

- a push to `main` or a pushed Git tag runs on **secondary** and updates/restarts **main** to the exact event SHA;
- a same-repository pull request runs on **main** and updates/restarts **secondary** to the exact pull-request head SHA;
- a manual request may resolve either a same-repository PR number or branch name to one exact SHA and update **secondary**;
- all main and secondary update jobs use one shared GitHub concurrency queue, so cross-updates cannot deadlock by stopping each other simultaneously.

`install.sh` owns installation and reconciliation of both environments. It is safe to run again: it skips already-correct resources, creates missing resources, refreshes managed files when their desired content changed, and refuses conflicting state that it cannot repair safely. There is no separate migrator, bootstrap system, host schema, controller protocol, recovery repository, or deployment control plane.

`update.sh` is an operational updater. After the target checkout is moved to the selected exact SHA, it always performs the required runtime work for that environment: clean build preparation, compilation, file replacement, service restart, and validation. Installation, runner registration, user creation, and GitHub configuration do not belong in `update.sh`.

Repository policy for direct pushes, required reviews, environments, branch protection, and tag naming is outside this plan. The workflows react to events that the repository permits.

`DOCKER_PROVISIONING_ENABLED=0` remains authoritative. This work must not re-enable Docker provisioning or reopen PR #46.

## Progress

Keep this section append-only. Checked implementation items require a repository location and passing evidence. Blocked items remain unchecked and use `[blocked]`.

- [x] (2026-07-21) Reviewed the existing one-runner installer, updater, service, CI workflow, and Codex workflow on baseline `e9ec636e5abf383f8831fc126b99f04e2e005a3c`.
- [x] (2026-07-21) Confirmed the current runner cannot execute its own synchronous update because `update.sh` stops its listener and waits for `Runner.Worker` processes owned by the same runner user.
- [x] (2026-07-21) Replaced the earlier controller, migration, LKG, recovery, guard, and host-schema design with the operator-requested two-environment cross-update model.
- [x] (2026-07-21) Confirmed the manual target interface must support both same-repository PR numbers and branch names.
- [x] (2026-07-21) Confirmed GitHub approval, branch-protection, direct-push, and repository-policy decisions are outside this implementation plan.
- [ ] Revalidate the baseline immediately before implementation.
- [ ] Extend `install.sh` to reconcile main and secondary users, paths, registrations, labels, services, permissions, update launcher, locks, and actor-ID configuration.
- [ ] Refactor `update.sh` into one deterministic operational update path usable for either target environment.
- [ ] Add the narrow cross-update launcher and target-specific configuration installed by `install.sh`.
- [ ] Add tests for idempotent installation, cross-runner authorization, exact-SHA checkout, queue/lock behavior, update success, update failure, service restart, and environment isolation.
- [ ] Human reviewer: add the main/tag and PR/manual workflows with shared concurrency and opposite-runner routing.
- [ ] Run full repository validation, exact-head CI, and real-host demonstrations for both directions.
- [ ] Complete `Outcomes & Retrospective` and move this same plan to `completed` only after every item is checked.

## Surprises & Discoveries

- Observation: the current runner cannot safely update itself from its own GitHub Actions job.
  Evidence: `update.sh` stops `actions.runner.Divorium.gh-runner.service` and waits while a `Runner.Worker` owned by `github-runner` exists. The current job is such a worker.

- Observation: using the same Unix user for both runners would preserve the deadlock.
  Evidence: the updater identifies workers by UID and process name, not by runner registration or service name. Main and secondary therefore require distinct users.

- Observation: two simultaneous cross-updates can deadlock even with distinct users.
  Evidence: a main job updating secondary and a secondary job updating main could each stop the other listener and wait for the other worker. Both workflows must therefore share one repository-wide update concurrency group.

- Observation: a host-side blocking lock can reproduce the same deadlock if a second update job waits on the lock while the first update targets that job's runner.
  Evidence: the host lock must be fail-fast, while normal serialization is provided before job scheduling by the shared GitHub concurrency queue.

- Observation: the existing installation already represents the main environment.
  Evidence: adding secondary to an existing VM is not an application or data migration. Re-running the idempotent installer should preserve main and create only missing secondary resources.

- Observation: installation and operational update are different responsibilities.
  Evidence: users, runner archives, registrations, labels, service units, directories, sudoers, and configuration are host setup. Git checkout, build, file replacement, restart, and validation are repeated release operations.

- Observation: one shared secondary environment means each PR replaces the revision previously deployed there.
  Evidence: this is expected behavior. The workflow queue serializes updates, and the secondary environment ends on the most recently completed PR or manual target update.

## Decision Log

- Decision: use two persistent runner environments named main and secondary.
  Rationale: one environment executes the workflow that updates the other, avoiding self-update deadlock without a third controller runner.
  Date/Author: 2026-07-21 / operator clarification.

- Decision: preserve the current runner installation as main and add secondary alongside it.
  Rationale: the existing paths and runner are already the stable environment. Replacing them is unnecessary.
  Date/Author: 2026-07-21 / implementation design.

- Decision: use distinct Unix users, runner directories, work directories, homes, source checkouts, build roots, service units, runner names, and labels.
  Rationale: shared process identity or mutable paths would make worker draining and environment updates ambiguous.
  Date/Author: 2026-07-21 / deadlock correction.

- Decision: execute every environment update from the opposite runner.
  Rationale: the target runner may be stopped and restarted without terminating the GitHub Actions job performing the update.
  Date/Author: 2026-07-21 / operator clarification.

- Decision: use one shared GitHub concurrency group for main and secondary updates, with queueing and no in-progress cancellation.
  Rationale: this prevents the two opposite-runner jobs from stopping each other and waiting forever.
  Date/Author: 2026-07-21 / concurrency correction.

- Decision: use a nonblocking host lock as a defensive check.
  Rationale: GitHub queueing is the normal serialization mechanism. A blocking host lock could create cross-runner deadlock; unexpected overlap must fail clearly instead.
  Date/Author: 2026-07-21 / concurrency correction.

- Decision: automatic main updates react to pushes to `main` and pushed tags and deploy exact `github.sha`.
  Rationale: repository policy decides which pushes and tags are permitted; deployment must not reinterpret the selected commit.
  Date/Author: 2026-07-21 / operator clarification.

- Decision: automatic secondary updates react to same-repository pull-request revisions and deploy exact PR head SHA.
  Rationale: secondary is the shared PR test environment. Fork PRs are outside the trusted-host execution scope.
  Date/Author: 2026-07-21 / operator clarification.

- Decision: manual secondary update accepts either a PR number or branch name and resolves it once to an exact same-repository SHA.
  Rationale: both operator entry forms were requested; later phases must use only the resolved SHA.
  Date/Author: 2026-07-21 / operator clarification.

- Decision: use numeric `actor_id` for authorization of manual update requests.
  Rationale: numeric account identity is stable across login renames. Automatic repository events do not require manual-operator authorization.
  Date/Author: 2026-07-21 / operator clarification.

- Decision: `install.sh` is idempotent and owns all setup.
  Rationale: no separate migration tool is needed. Existing installations are brought to the desired two-runner state by rerunning the installer.
  Date/Author: 2026-07-21 / operator clarification.

- Decision: `update.sh` performs one repeated operational sequence for either environment.
  Rationale: there are no backward-compatible protocol branches or host-schema modes. Installation changes go to `install.sh`; every release update executes the same operational stages.
  Date/Author: 2026-07-21 / operator clarification.

- Decision: keep Docker provisioning disabled.
  Rationale: this plan concerns runner environment updates, not Docker host installation.
  Date/Author: 2026-07-21 / existing repository decision.

## Outcomes & Retrospective

This plan remains active and plan-only. No installer, updater, workflow, runner registration, service, or production-host behavior has changed yet.

The earlier design was unnecessarily complex because it interpreted secondary as a recovery/control-plane runner and interpreted adding it to the existing VM as a migration. The corrected model treats secondary as a normal long-lived environment updated for PR testing. The only nontrivial infrastructure issue is safe cross-runner serialization.

Update this section after implementation with actual behavior, deviations, test results, and operational lessons.

## Context and Orientation

The current installation has one environment:

- source checkout: `/srv/github-runner/storage/agent-relay`;
- runner directory: `/srv/github-runner/storage/runner`;
- work directory: `/srv/github-runner/storage/work`;
- runner home: `/srv/github-runner/storage/home`;
- build root: `/srv/github-runner/storage/build`;
- runner user: `github-runner`;
- builder user: `agent-relay-builder`;
- runner name: `gh-runner`;
- service: `actions.runner.Divorium.gh-runner.service`.

This installation becomes **main** without moving its existing paths unless implementation discovers a concrete conflict.

The expected secondary layout is equivalent to:

    /srv/github-runner-secondary/storage/agent-relay
    /srv/github-runner-secondary/storage/runner
    /srv/github-runner-secondary/storage/work
    /srv/github-runner-secondary/storage/home
    /srv/github-runner-secondary/storage/build

with:

    runner user: github-runner-secondary
    builder user: agent-relay-builder-secondary
    runner name: gh-runner-secondary
    label: agent-relay-secondary
    service: actions.runner.Divorium.gh-runner-secondary.service

Main receives explicit label `agent-relay-main`. Ordinary CI and Codex jobs continue to target main. Environment-update workflows target the opposite runner explicitly.

`install.sh` installs a root-owned environment configuration for both targets and a narrow update launcher. The launcher is not a transaction controller. It validates caller-to-target direction, exact SHA shape, configured repository and paths, and nonblocking global update lock, then performs the privileged checkout transition and invokes the selected target revision's `update.sh`.

## Plan of Work

### Milestone 1: Define two environment configurations

Add one explicit configuration model for main and secondary containing:

- environment name;
- source checkout;
- runner directory, work directory, home, and build root;
- runner and builder users;
- runner name, labels, and service name;
- which opposite runner user may request its update.

Do not infer paths from arbitrary workflow input. The launcher accepts only `main` or `secondary` and resolves all host values from root-owned configuration installed by `install.sh`.

### Milestone 2: Make `install.sh` idempotently reconcile both environments

Extend `install.sh` so rerunning it:

- validates the existing main user, directories, runner binary, registration, service, permissions, checkout, and labels;
- adds the explicit `agent-relay-main` label when absent;
- creates the secondary runner user and builder user when absent;
- creates secondary directories with isolated ownership and modes;
- installs or verifies the pinned runner archive independently for secondary;
- registers secondary only when registration is absent, using the installation credential and a short-lived registration token;
- installs or refreshes both service units and managed configuration files;
- installs the root-owned update launcher, target configuration, manual actor-ID allowlist, lock file, and narrow sudoers rules;
- grants the main runner user permission to invoke only a secondary update;
- grants the secondary runner user permission to invoke only a main update;
- skips resources already matching the desired state;
- repairs safe managed-file drift by replacing root-owned generated files;
- refuses conflicting users, paths, registrations, symlinks, ownership, or unexpected services instead of guessing.

The runtime update workflows never create users, register runners, or require the installation PAT.

### Milestone 3: Refactor `update.sh` into one operational sequence

After the launcher has stopped and drained the target runner and moved its checkout to the exact SHA, invoke that revision's regular, non-symlink `update.sh` for the selected environment.

The operational sequence is the same for main and secondary:

1. validate the target environment, canonical source path, runner/build users, service name, and required tools;
2. create a clean environment-specific build directory;
3. compile the runtime as the environment's builder user;
4. validate required runtime files before replacing the active runtime;
5. replace `dist` using a staged directory so a failed build does not delete the previous usable runtime;
6. apply expected root ownership and read-only runtime modes;
7. keep `DOCKER_PROVISIONING_ENABLED=0` and perform no Docker provisioning;
8. enable and restart the target runner service;
9. verify the service is active and the listener process belongs to the expected target runner user;
10. return a nonzero status on any failed stage with clear bounded diagnostics.

`update.sh` must not contain installation branches, runner registration, GitHub API calls, host-schema negotiation, migration modes, controller activation, or LKG management.

### Milestone 4: Implement the narrow cross-update launcher

The launcher performs only the privileged steps needed around `update.sh`:

1. validate the invoking Unix user;
2. allow `github-runner` to target only `secondary`;
3. allow `github-runner-secondary` to target only `main`;
4. validate exact 40-character commit SHA and repository identity;
5. acquire the nonblocking global update lock before stopping either runner;
6. stop the target runner listener;
7. wait until target `Runner.Worker` processes finish, with a documented finite timeout;
8. fetch the requested exact commit into the target checkout as its checkout owner;
9. reset tracked files to that exact commit and reject unsafe checkout state;
10. invoke the exact target checkout's `update.sh` with target configuration;
11. ensure the target service is restarted when the update exits, including clear failure handling;
12. release the lock and return the operational update result.

The launcher does not maintain a deployment journal, background transaction service, recovery repository, LKG, host schema, workflow guard, or status API.

### Milestone 5: Add workflow routing and serialization

The human-maintained workflows implement two directions.

Main update workflow:

- triggers on push to `main` and pushed tags;
- runs only on `[self-hosted, agent-relay-secondary]`;
- uses exact `github.sha` as the main target;
- invokes the installed launcher for `main`;
- never runs on main itself.

Secondary update workflow:

- triggers for same-repository pull-request revisions, including at least opened, reopened, synchronize, and ready-for-review;
- runs only on `[self-hosted, agent-relay-main]`;
- uses exact `github.event.pull_request.head.sha`;
- rejects fork pull requests;
- also supports `workflow_dispatch` with `target_type: pr | branch` and one target value;
- resolves manual input once to an exact same-repository SHA;
- passes `github.actor_id`; the installed allowlist is enforced for manual requests;
- invokes the installed launcher for `secondary`;
- never runs on secondary itself.

Both workflows use the same repository-wide concurrency group:

    agent-relay-environment-update

with queueing enabled and in-progress cancellation disabled. The entire update job, not only one step, belongs to this concurrency group. This shared queue is required for correctness, not merely convenience.

Existing CI and Codex workflows receive explicit `agent-relay-main` routing before secondary is enabled. GitHub review, branch-protection, direct-push, environment-approval, and tag-policy configuration remain outside this plan.

### Milestone 6: Test and document the result

Add deterministic tests for:

- first installation of both environments;
- rerunning `install.sh` against exact state;
- adding only missing secondary resources to the current one-runner installation;
- safe managed-file refresh;
- conflicting state refusal;
- main and secondary ownership isolation;
- permitted and forbidden caller/target combinations;
- exact SHA validation and same-repository enforcement;
- nonblocking lock behavior;
- target worker drain timeout;
- build failure preserving prior `dist`;
- successful staged replacement;
- service restart and listener verification;
- Docker provisioning remaining disabled;
- workflow fixtures showing opposite-runner routing and one shared concurrency group;
- PR and branch manual resolution;
- fork rejection.

Update documentation after behavior exists. Describe installation reruns, both environments, labels, paths, services, event-to-target routing, shared queue, manual PR/branch update, actor-ID allowlist, update failure behavior, and repair procedure.

## Concrete Steps

Revalidate the baseline:

    git cat-file -e e9ec636e5abf383f8831fc126b99f04e2e005a3c^{commit}
    git merge-base --is-ancestor e9ec636e5abf383f8831fc126b99f04e2e005a3c HEAD
    git status --short
    git diff --name-status e9ec636e5abf383f8831fc126b99f04e2e005a3c...HEAD
    git grep -n 'DOCKER_PROVISIONING_ENABLED=0' e9ec636e5abf383f8831fc126b99f04e2e005a3c -- update.sh

Run focused validation equivalent to:

    bash -n install.sh update.sh scripts/*.sh test-system/*.sh
    npm run build
    npm test
    bash test-system/install-script.integration.sh
    bash test-system/update-script.integration.sh
    bash test-system/environment-cross-update.integration.sh

Run complete validation:

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

Real-host acceptance must demonstrate:

1. rerunning `install.sh` preserves the existing main environment and creates or validates secondary;
2. both runners are online with distinct users, paths, names, services, work directories, and labels;
3. an automatic or manual PR update job running on main updates and restarts secondary to the exact PR SHA;
4. a manual branch update running on main updates and restarts secondary to the exact resolved branch SHA;
5. a main push update job running on secondary updates and restarts main to the exact event SHA;
6. a tag push update job running on secondary updates and restarts main to the exact tag commit;
7. two update requests are serialized by the shared workflow queue and never cross-wait;
8. an unauthorized manual `actor_id`, fork PR, wrong caller-to-target direction, or unexpected concurrent host invocation fails before stopping a runner;
9. a failed build leaves the previous target runtime usable and the target service in an explicit observable state;
10. Docker provisioning remains disabled.

## Validation and Acceptance

The implementation is accepted when:

- install is repeatable and converges exact valid state without a separate migration tool;
- main and secondary are independent at Unix user, path, workspace, build, registration, service, and label level;
- each update workflow always runs on the runner opposite its target;
- main updates on permitted main pushes and tag pushes using exact event SHA;
- secondary updates on same-repository PR revisions and manual PR/branch targets using exact resolved SHA;
- all environment updates share one queue and no cross-update deadlock is reproducible;
- the launcher rejects the wrong caller, wrong target, fork, invalid SHA, unexpected repository, or concurrent host update before service interruption;
- `update.sh` performs the same operational sequence for both environments;
- failed build does not destroy the previous runtime;
- successful update restarts and validates the intended target service;
- no installation, migration, controller, recovery, or GitHub-policy logic is added to `update.sh`;
- repository checks and real-host demonstrations pass.

## Idempotence and Recovery

`install.sh` is convergent:

- absent resource: create it;
- exact managed resource: validate and skip it;
- safely replaceable generated file: atomically replace it;
- conflicting identity, path, registration, symlink, owner, or unmanaged service: fail with a specific repair instruction.

There is no separate migration state. The supported transition from the current one-runner host is simply a rerun of the new `install.sh`.

The launcher acquires a nonblocking global update lock. Unexpected overlap returns a busy failure before either runner is stopped. Normal waiting occurs in the shared GitHub concurrency queue.

`update.sh` builds before replacing active runtime. It retains the previous `dist` until the new staged runtime is validated. On replacement or restart failure it reports the exact failed phase and makes a best effort to keep or restore the previous runtime and restart the target service. This is operational failure handling, not a general rollback framework.

## Artifacts and Notes

Keep this section append-only.

- 2026-07-21: reviewed the current one-runner installation and self-update deadlock.
- 2026-07-21: created draft PR #47 containing an active plan.
- 2026-07-21: earlier iterations introduced a controller, migration, recovery repository, LKG, workflow guard, host schema, and approval policy.
- 2026-07-21: operator clarification removed those systems and established the two-environment cross-update model: PR updates secondary; main/tag push updates main; installation is idempotent; operational update behavior belongs in `update.sh`.

Non-goals:

- deciding repository branch protection, direct-push, review, environment, or tag policy;
- a third deployment/controller runner;
- a background deployment controller or status service;
- host or application data migration;
- host-schema or backward-compatibility negotiation;
- LKG/recovery repository or VM snapshot recovery;
- automatic rollback of arbitrary host changes;
- fork PR execution;
- parallel environment updates;
- Docker provisioning.

## Interfaces and Dependencies

Environment identities:

    main runner user:        github-runner
    main builder user:       agent-relay-builder
    main runner name:        gh-runner
    main label:              agent-relay-main
    main service:            actions.runner.Divorium.gh-runner.service

    secondary runner user:   github-runner-secondary
    secondary builder user:  agent-relay-builder-secondary
    secondary runner name:   gh-runner-secondary
    secondary label:         agent-relay-secondary
    secondary service:       actions.runner.Divorium.gh-runner-secondary.service

Launcher interface is equivalent to:

    agent-relay-update-environment main --sha <40-lowercase-hex>
    agent-relay-update-environment secondary --sha <40-lowercase-hex>

Manual workflow input is:

    target_type: pr | branch
    target: pull-request number or same-repository branch name

The root-owned launcher derives all target paths, users, and service names from installed configuration. Workflow input cannot supply host paths, users, service names, commands, or arbitrary repositories.

The implementation uses existing Bash, Git, jq, curl, systemd, coreutils, Node.js, TypeScript, and the official GitHub Actions runner. Add no new runtime dependency without recording why existing tools are insufficient.

Revision note (2026-07-21): Replaced the overengineered migration/controller/recovery design with the operator-requested two-runner cross-update model. `install.sh` idempotently owns both runner installations; `update.sh` owns repeated post-checkout operational work; PR/manual PR-or-branch updates target secondary from main; main/tag pushes target main from secondary; one shared workflow queue prevents cross-update deadlock.