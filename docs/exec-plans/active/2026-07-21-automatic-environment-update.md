# Automate Agent Relay environment deployment and rollback

This ExecPlan is in progress. It defines the implementation required to deploy and test Agent Relay revisions on the dedicated runner VM without rerunning `install.sh` for ordinary updates.

## Purpose

Replace the current manual release procedure:

```bash
cd /srv/github-runner/storage/agent-relay
git pull --ff-only
./update.sh
```

with a controlled GitHub Actions deployment path that:

- deploys an exact merged `main` SHA automatically after a push to `main`;
- manually deploys and tests an exact same-repository pull-request or branch SHA;
- runs the selected revision's real `./update.sh` against the real VM environment;
- returns every temporary PR or branch test to the last known good `main` deployment;
- rolls a failed `main` deployment back to the previously verified `main` SHA;
- keeps a recovery runner available when the primary Agent Relay runner or runtime is broken;
- serializes Git synchronization, update execution, validation, and rollback as one host transaction.

The feature is for accidental deployment and updater failures on a dedicated trusted VM. It is not a sandbox for hostile same-repository code.

## Current System

The current installation has one organization-level GitHub Actions runner:

- runner name: `gh-runner`;
- service account: `github-runner`;
- service: `actions.runner.Divorium.gh-runner.service`;
- source checkout: `/srv/github-runner/storage/agent-relay`;
- workflow workspace: `/srv/github-runner/storage/work`;
- runtime: root-owned `/srv/github-runner/storage/agent-relay/dist`.

The source checkout is writable only by the Debian administrator recorded in `/etc/agent-relay/administrator`. `github-runner` and `agent-relay-builder` have no sudo access.

`update.sh` intentionally performs no Git operations. It stops the primary runner listener, waits for every `Runner.Worker` owned by `github-runner`, deletes the active `dist`, compiles directly into a new `dist`, secures the runtime, and restarts the primary runner. It currently has no backup, transaction journal, recovery action, or rollback.

The existing lock inside `update.sh` covers only updater execution. It does not cover the preceding Git checkout or a later rollback.

## GitHub Runner Decision

Use a second persistent deployment/recovery runner on the same VM. Do not create an ephemeral or JIT runner for each deployment.

GitHub recommends ephemeral runners for autoscaling. This system does not autoscale: it has one long-lived VM and requires a recovery channel that remains registered when the primary runner is unavailable. A persistent deployment runner has fewer failure modes and does not require a stored PAT, GitHub App credential, JIT configuration generator, webhook scaler, or external ephemeral-runner log shipping.

The two runners are:

1. Primary runner
   - name: `gh-runner`;
   - label: `agent-relay-main`;
   - account: `github-runner`;
   - runs CI, Codex, and post-deployment smoke work;
   - remains unable to modify the trusted checkout or use sudo.

2. Deployment runner
   - name: `gh-deploy-runner`;
   - label: `agent-relay-deploy`;
   - separate runner directory, work directory, and home below `/srv/github-runner/storage`;
   - runs only the trusted deployment workflow from `main`;
   - remains independent of the compiled Agent Relay `dist` runtime;
   - uses a UID different from `github-runner`, so `update.sh` never waits for the deployment job's own `Runner.Worker`.

Create an organization runner group named `agent-relay-deployment` when the organization plan supports custom runner groups. Restrict it to:

- repository `Divorium/agent-relay`;
- public repository access explicitly enabled because this repository is public;
- workflow `Divorium/agent-relay/.github/workflows/deploy.yml@refs/heads/main` only.

Use both the group and `agent-relay-deploy` label for routing. All existing workflows must require `agent-relay-main` so they cannot be assigned to the deployment runner.

If GitHub rejects creation of a workflow-restricted custom group because the organization plan does not provide it, installation must stop with a clear diagnostic rather than silently deploying an unrestricted privileged runner. A label alone is not an adequate access boundary for the deployment runner in this public repository.

## Authentication Decision

Do not persist the operator's PAT.

During a fresh installation, `install.sh` asks for the organization credential only while runner registration is required. While that credential remains in memory, it must:

1. create or validate the deployment runner group;
2. obtain a short-lived registration token for the primary runner if registration is missing;
3. obtain a separate short-lived registration token for the deployment runner if registration is missing;
4. register each missing runner with its exact group, label, name, and work directory;
5. unset the PAT, API responses, and registration tokens.

The PAT must not be written to disk, passed in command-line arguments, printed, exported to a runner job, or copied into the source checkout.

For an already installed host, add a separate one-time administrator migration command. Do not require rerunning all of `install.sh`. The migration command may request the PAT interactively, create the group and second runner, add the `agent-relay-main` label to the existing primary runner, seed deployment state from the currently healthy `main` runtime, and then discard the PAT.

## Host Trust and Privilege Decision

The automated deployment path executes the selected revision's `update.sh` with the same effective host authority currently used by the recorded Debian administrator. This is required because the purpose of a manual PR deployment is to test the real updater, including privileged host changes.

The deployment workflow is therefore restricted to the trusted workflow on `main`, and manual targets are limited to same-repository PRs or branches. Forks are rejected.

This protects against accidental breakage but not malicious code in a trusted branch. A malicious target revision can abuse the authority needed by `update.sh`. VM snapshots, disposable VMs, and hostile-code isolation are outside this plan.

Automation must not depend on an interactive sudo password. The implementation must provide a documented noninteractive authority path for the deployment controller. The chosen mechanism must be installed by the administrator, unavailable to `github-runner`, and covered by system tests. It must not expose a PAT or GitHub workflow token to the target revision.

## Trusted Deployment Controller

Install a small controller outside the mutable source checkout, for example:

```text
/usr/local/libexec/agent-relay-deploy
```

The installed controller and its configuration are root-owned and not writable by either runner account. A tested PR or branch may replace its own repository copy but cannot replace the controller currently responsible for rollback.

The controller owns:

- global deployment locking;
- request validation;
- exact Git fetch and checkout;
- last-known-good state;
- deployment journaling;
- bounded execution of the selected `update.sh`;
- local health validation;
- rollback checkout and execution of the restored stable `update.sh`;
- final status and logs.

The controller must not be automatically replaced by a temporary PR or branch deployment. Controller self-update is outside the temporary target transaction. In the first implementation, changing the installed controller requires an explicit trusted administrator migration step after the relevant `main` revision has passed deployment.

## Persistent Host State

Store deployment state outside the repository, below a protected root such as:

```text
/var/lib/agent-relay-deploy/
  last-known-good-main-sha
  active-transaction
  logs/
```

Requirements:

- root-owned directories and regular files;
- no symlink following;
- atomic state replacement;
- exact 40-character lowercase commit SHAs;
- transaction state sufficient to recover after interruption or VM restart;
- bounded log retention;
- no secrets in logs.

`last-known-good-main-sha` means the most recent `main` commit that completed the full deployment acceptance path on this VM. Do not implement this as a moving Git tag named `main`. The remote `origin/main` cannot be used as rollback state because it already points to a newly merged revision when that revision fails deployment.

The migration command seeds last-known-good state only after verifying that:

- the trusted checkout is on `main`;
- its HEAD is reachable from `origin/main`;
- the primary service is active;
- the compiled runtime entrypoint exists.

## Global Serialization

Use one lock for the entire host transaction, not only `update.sh`:

1. resolve and validate the request;
2. fetch Git state;
3. record transaction state;
4. reset the trusted checkout;
5. execute `update.sh`;
6. validate the result;
7. commit the new last-known-good SHA or roll back;
8. clear transaction state.

The deployment workflow also uses one repository-wide concurrency group with `cancel-in-progress: false`. Host locking remains authoritative because GitHub concurrency does not protect manual host operations or interrupted prior runs.

## Git Checkout Contract

The controller operates only on `/srv/github-runner/storage/agent-relay` and verifies its canonical path, owner, remote URL, and repository identity before mutation.

Before selecting a target:

```bash
git fetch --prune origin
```

A deployment is always pinned to an exact commit SHA. A branch name or PR number is only an input used to resolve that SHA.

For checkout replacement:

```bash
git reset --hard <exact-sha>
git clean -ffd
```

Do not use `git clean -x` or `git clean -fdx`; ignored `node_modules` and other intentionally retained ignored state are not part of ordinary checkout cleanup. The controller must reject submodules, an unexpected remote, a detached alternate worktree layout, or a target SHA that is not present in the expected origin repository.

## Deployment Workflow

Add `.github/workflows/deploy.yml` with two entry paths.

### Automatic `main` deployment

Trigger:

```yaml
on:
  push:
    branches: [main]
```

The target is the exact `github.sha` from the push event. The deployment workflow itself must be the trusted `deploy.yml` from `refs/heads/main`.

### Manual PR or branch test

Trigger through `workflow_dispatch` from `main` only. Accept:

- target type: `pr` or `branch`;
- target value: PR number or branch name.

The resolver must:

- require an open, non-draft PR for `pr` mode;
- require the PR head repository to equal `Divorium/agent-relay`;
- require a same-repository `refs/heads/...` ref for branch mode;
- reject forks, tags, pull-request merge refs, arbitrary remote URLs, ambiguous refs, and moving-target execution;
- resolve the input once to an exact SHA and use only that SHA for deployment;
- record the human-readable source ref and exact SHA in the workflow summary.

The manual workflow does not update last-known-good state.

## Main Deployment Transaction

For a push to `main`:

1. acquire the global host lock;
2. recover or reject any incomplete prior transaction;
3. read the previous last-known-good `main` SHA;
4. fetch origin and verify the requested SHA is the current `origin/main` commit or is contained in the exact push update being processed;
5. hard-reset the trusted checkout to the requested SHA;
6. execute that revision's real `./update.sh` under a bounded process group;
7. require exit status zero;
8. require the primary systemd service to become active;
9. require a live `Runner.Listener` owned by `github-runner` after a bounded wait;
10. record the deployed SHA for smoke verification;
11. complete a bounded primary-runner smoke check;
12. atomically replace `last-known-good-main-sha` with the target SHA;
13. clear transaction state and report success.

If any step after checkout fails, execute the rollback transaction before the workflow finishes.

## Temporary PR or Branch Test Transaction

For a manual target:

1. acquire the global host lock;
2. recover or reject any incomplete prior transaction;
3. read the last-known-good `main` SHA;
4. fetch and verify the exact target SHA;
5. hard-reset the trusted checkout to the target SHA;
6. execute the target's real `./update.sh`;
7. perform the same local service and listener validation used for `main`;
8. record whether the target update passed or failed;
9. always hard-reset the checkout back to the unchanged last-known-good `main` SHA;
10. execute the restored stable `./update.sh`;
11. require the primary service and listener to recover;
12. clear transaction state;
13. report the target result and rollback result separately.

A passing temporary target is never left active for later jobs and never becomes last known good.

## Rollback Contract

Rollback means convergence back to the previous verified `main` revision:

1. terminate any still-running target updater process group;
2. fetch origin without trusting the failed checkout's scripts;
3. reset the trusted checkout to the recorded last-known-good SHA;
4. clean nonignored untracked files;
5. invoke the restored last-known-good `update.sh`;
6. verify the primary service and listener;
7. preserve the failed target SHA, exit status, phase, and logs;
8. leave last-known-good state unchanged.

Rollback code and transaction state handling come from the installed controller, not from the failed target revision.

This is not a general operating-system rollback. If a target revision irreversibly changes packages, data formats, Docker data, credentials, or arbitrary host state, rerunning the stable updater may not undo those changes. Every supported `update.sh` change must therefore remain idempotent and convergent toward the checked-out revision's declared host state. Destructive non-reversible migrations require a separate design and are outside this automatic rollback guarantee.

If both deployment and rollback fail:

- do not change last-known-good state;
- leave the deployment runner available;
- mark the workflow as a critical recovery failure;
- preserve transaction state and logs;
- stop automatic retries;
- require an administrator to repair the VM and explicitly resume or abort the transaction.

## Primary Runner Smoke Check

The acceptance path must prove more than `systemctl is-active` while remaining bounded when the primary runner cannot accept work.

Implement a deployment smoke mechanism that verifies the primary runner can execute a small trusted job and can read the expected deployed revision marker. The deployment runner remains responsible for timing out the smoke and invoking rollback if the smoke never starts or does not finish successfully.

The smoke must:

- run only from a workflow pinned to `main`;
- target `[self-hosted, agent-relay-main]`;
- execute no Codex work;
- verify the expected deployment request ID and SHA;
- write no source changes;
- complete within a bounded deadline;
- avoid exposing deployment credentials to the target `update.sh` process.

The implementation may use a separately dispatched smoke workflow plus bounded API polling, or an equivalent acknowledgement channel. The selected design must include interruption and queued-job tests. A job that remains queued because the primary runner is offline must eventually cause rollback rather than leaving the transaction open indefinitely.

## Update Execution Safety

The controller must execute each updater in a dedicated process group and enforce a bounded overall deadline. On timeout or interruption it must:

- send TERM to the complete updater process group;
- wait for a bounded grace period;
- escalate to KILL;
- prove no updater descendants remain before rollback;
- preserve the authoritative failure status.

The update child receives a sanitized environment. GitHub tokens, PATs, runner registration credentials, controller state descriptors, and unrelated host environment variables must not be inherited by the target revision.

The existing `update.sh` lock remains as defense in depth. It does not replace the controller lock.

## Installer Changes

Extend fresh installation without changing the existing one-time installation model:

- create deployment runner storage paths;
- install or reuse the pinned runner archive for a second extraction;
- register both missing runners while the PAT is in memory;
- create or validate the restricted deployment runner group;
- assign exact labels and work directories;
- install a separate root-owned deployment runner systemd unit;
- install the root-owned deployment controller and state directories;
- install the noninteractive authority mechanism required by the controller;
- keep the deployment runner independent of Codex login and Agent Relay runtime compilation;
- prepare the deployment runner service so the first successful bootstrap can enable it.

Running `install.sh` again remains unsupported for ordinary releases.

## Existing Host Migration

Add an explicit one-time migration path for the already installed VM. It must:

- refuse a fresh or ambiguous host;
- require the recorded Debian administrator;
- verify the current primary runner installation and healthy deployed runtime;
- request the organization PAT only when required;
- create or validate the deployment runner group;
- add or verify the `agent-relay-main` label on the primary runner;
- register `gh-deploy-runner` with the deployment group and label;
- install the controller, service, authority policy, state, and log roots;
- seed the current healthy main SHA as last known good;
- start the deployment runner;
- unset and never persist the PAT.

The migration must be restartable and must distinguish absent, partial, complete, and conflicting state. It must never delete or replace an unrelated runner registration.

## Workflow Routing Changes

Update every existing self-hosted job from:

```yaml
runs-on: [self-hosted]
```

to:

```yaml
runs-on: [self-hosted, agent-relay-main]
```

The deployment workflow uses both the restricted group and deployment label. No ordinary CI or Codex job may match the deployment runner.

## Logging and Reporting

Every deployment reports:

- event mode;
- requested PR or branch;
- resolved target SHA;
- previous last-known-good SHA;
- deployment phase and exit status;
- local service and listener result;
- smoke result;
- rollback attempted or not;
- rollback SHA and result;
- final active SHA;
- path or artifact containing the bounded full log.

Do not place raw untrusted updater output into GitHub workflow commands. Normalize or escape lines before live emission, and upload the full bounded transcript as an artifact.

## Validation and Test Coverage

Add static, unit, and system coverage for at least:

- fresh installation with both runner registrations;
- existing-host migration;
- PAT and registration-token redaction and non-persistence;
- runner group and selected-workflow configuration;
- exact runner labels and workflow routing;
- controller path, ownership, modes, and symlink rejection;
- last-known-good initialization and atomic replacement;
- full-transaction flock coverage;
- exact PR and branch SHA resolution;
- fork, tag, malformed ref, and moving-ref rejection;
- hard reset and nonignored clean behavior;
- successful `main` deployment;
- failed `main` deployment followed by successful rollback;
- successful temporary target followed by mandatory rollback;
- failed temporary target followed by successful rollback;
- update timeout and complete process-group termination;
- primary listener recovery;
- smoke success, failure, never-started, and timeout cases;
- interrupted transaction recovery;
- deployment plus rollback double failure;
- workflow output escaping and bounded artifact logs;
- no regression in current CI, Codex, finalization, runtime compilation, Docker access, or workspace isolation.

Repository acceptance remains `npm run check` plus exact-head normal CI and independent review of the final implementation and workflow logs.

## Non-Goals

- Autoscaling or dynamically provisioning VMs.
- Ephemeral or JIT runner lifecycle.
- Persisting a PAT or GitHub App private key on this VM.
- Supporting fork pull requests.
- Testing arbitrary remote repositories.
- Parallel deployments on one host.
- VM snapshot management.
- General rollback of arbitrary operating-system or application data migrations.
- Replacing GitHub Actions with a custom deployment API or daemon.
- Automatically updating the installed deployment controller from a temporary branch.

## GitHub Documentation References

- Self-hosted runners reference: https://docs.github.com/en/actions/reference/runners/self-hosted-runners
- Self-hosted runner REST API: https://docs.github.com/en/rest/actions/self-hosted-runners?apiVersion=2026-03-10
- Self-hosted runner groups REST API: https://docs.github.com/en/rest/actions/self-hosted-runner-groups?apiVersion=2026-03-10
- Managing self-hosted runners: https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners

## Acceptance Criteria

- A fresh install registers isolated primary and deployment runners without persisting the PAT.
- The existing VM has a documented, restartable one-time migration path that does not rerun ordinary installation.
- Existing CI and Codex jobs can run only on the primary runner.
- Only the trusted deployment workflow from `main` can use the deployment runner.
- A push to `main` deploys the exact pushed SHA and records it as last known good only after update and smoke success.
- A failed `main` deployment automatically restores the previous last-known-good SHA and runtime.
- A manually selected same-repository PR or branch executes its real `update.sh` and always returns to the unchanged last-known-good `main` runtime.
- Forks, ambiguous refs, moving-target execution, overlapping deployments, and untrusted workflow routing are rejected.
- The target updater cannot replace the active rollback controller or inherit deployment credentials.
- Update hangs and interruptions are bounded and leave no updater descendants before rollback.
- Deployment and rollback results are independently visible and preserved.
- Double failure leaves the recovery runner available and produces an explicit administrator-recovery state.
- `npm run check`, exact-head CI, deployment system tests, and independent review pass with no unresolved finding.

## Progress

- [x] Current installer, updater, ownership, workflow, and runner contracts reviewed.
- [x] GitHub persistent, ephemeral, JIT, registration-token, and runner-group mechanisms reviewed.
- [x] Persistent deployment/recovery runner selected for the single-VM architecture.
- [x] PAT non-persistence and last-known-good SHA decisions established.
- [x] Deployment, temporary-test, rollback, and double-failure transactions specified.
- [ ] Implement fresh-install support for the second runner and restricted runner group.
- [ ] Implement the existing-host migration path.
- [ ] Implement and install the trusted deployment controller and persistent transaction state.
- [ ] Implement exact target resolution, update execution, health checks, smoke, and rollback.
- [ ] Add deployment and smoke workflows and primary-runner labels.
- [ ] Add complete regression and system coverage.
- [ ] Run Codex implementation workflow until all action points are complete.
- [ ] Review the complete implementation and CI logs.
- [ ] Move this unchanged plan to `docs/exec-plans/completed/` only after acceptance is complete.

## Decision Log

- Use a second persistent runner because this is a single durable VM and the second runner is the recovery channel, not an autoscaling worker.
- Do not store the installation PAT; request separate short-lived registration tokens while the PAT is held only in memory.
- Use a restricted runner group plus explicit labels; labels alone are not the security boundary.
- Keep deployment workflow authority on `main`; a tested revision is data, not the workflow implementation.
- Resolve every PR or branch once to an exact SHA.
- Keep Git operations outside `update.sh` and serialize them with update and rollback in an installed controller.
- Keep rollback code outside the mutable checkout.
- Track a local last-known-good `main` SHA rather than following current `origin/main` or moving a Git tag.
- Always restore `main` after temporary PR or branch testing.
- Treat rollback as convergence through the stable updater, not as a VM snapshot or arbitrary host-state reversal.
- Preserve the deployment runner after primary update failure and after double failure.
- Do not automatically replace the installed controller from a temporary target revision.
