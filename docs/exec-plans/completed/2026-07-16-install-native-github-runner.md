# Install and update a native organization runner with isolated Codex execution

This ExecPlan follows `.agent/PLANS.md` and implements `docs/native-github-runner-specification.md`.

## Purpose

Replace the former container and Relay service with one native Debian WSL installation. Keep one trusted source checkout at `/srv/github-runner/storage/agent-relay`, place runner workspaces at `/srv/github-runner/storage/work`, and separate one-time host installation from recurring application updates.

The administrator performs privileged host operations. `agent-relay-builder` validates untrusted releases without sudo. `github-runner` executes workflows and Codex without sudo. No `/opt/agent-relay` deployment copy exists.

## User-visible result

First setup:

```bash
cd /srv/github-runner/storage/agent-relay
./install.sh
```

If requested, run `wsl --shutdown`, restart Debian, and activate the validated revision:

```bash
cd /srv/github-runner/storage/agent-relay
./update.sh
```

Every later release uses only `./update.sh`.

## Implemented architecture

- one administrator-owned source/runtime tree;
- dedicated `/srv/github-runner/storage/work` runner workspace;
- locked `github-runner` and `agent-relay-builder` accounts without sudo;
- root-owned systemd unit running the official runner as `github-runner`;
- installer-only package setup, account creation, runner registration, and Codex login;
- updater-only pull, isolated build, validation, atomic runtime activation, service activation, and rollback;
- direct Codex execution with no Relay transport, queue, polling, state store, Docker, Compose, or `.env`;
- trusted request, PR, plan, runtime, and finalization scripts read from the protected source checkout;
- exact pull-request checkout and step-scoped GitHub credentials;
- 100% line, branch, and function coverage gates for runtime source.

## End-to-end deterministic test

The full-flow integration test constructs a local bare GitHub-like remote and a pull-request branch with one active ExecPlan. A mock HTTP endpoint returns the ready PR metadata. The test then executes the production request resolver, PR resolver, exact checkout, plan resolver, direct runtime with a mock Codex executable, finalizer, commit, and push. The final remote clone must contain the mock Codex change and derived commit message.

The system installer harness executes a transformed copy of the real `install.sh` against an isolated filesystem and mock system commands. It verifies service-account creation, no-sudo checks, runner archive checksum, PAT-to-registration-token exchange, runner configuration, workspace symlink, root-owned service unit, Codex login, and the absence of service activation before update.

The system updater harness executes a transformed copy of the real `update.sh` against isolated Git repositories. It verifies a full successful update with all tests and 100% coverage, rollback after a simulated build failure before activation, and rollback to the previous runtime after a simulated service-start failure following the runtime swap.

## Progress

- [x] Removed Relay HTTP, polling, queues, persisted state, Docker, Compose, and environment-file deployment.
- [x] Implemented direct Codex runtime, output redaction, limits, timeout, process-group termination, and filesystem boundary.
- [x] Added request and active-plan resolvers and retained exact PR resolution and finalization.
- [x] Replaced the `/opt/agent-relay` copy with the protected source checkout.
- [x] Moved runner workspaces to `/srv/github-runner/storage/work`.
- [x] Split one-time `install.sh` from recurring `update.sh`.
- [x] Added locked no-sudo builder and runner accounts.
- [x] Made service activation conditional on a validated update.
- [x] Added transactional rollback before and after runtime activation.
- [x] Re-execute the updater from the newly pulled revision before building or activating it.
- [x] Prevent privileged ownership and mode changes from dereferencing repository symlinks.
- [x] Added the full GitHub-request-to-mock-Codex integration test.
- [x] Enforced 100% runtime line, branch, and function coverage.
- [x] Added isolated system integration harnesses for installation and update.
- [x] Made CI execute checkout, `npm ci`, and `npm run check` instead of an empty job.
- [x] Restricted self-hosted CI pull requests to branches in the same repository.

## Decisions

- Decision: use separate administrator, builder, and runner identities.
  Rationale: lack of a password is not a security boundary when the same account remains sudo-capable; different accounts without sudo provide an enforced OS boundary.

- Decision: keep only the source checkout, not a second `/opt/agent-relay` copy.
  Rationale: administrator ownership and removal of group/other write permission protect the trusted scripts, while root ownership protects the activated `dist`.

- Decision: split installation from update.
  Rationale: package setup, runner registration, and Codex login are one-time operations; releases should require one predictable `update.sh` command.

- Decision: retain the previous runtime until the new service is active.
  Rationale: successful compilation alone is insufficient; activation is committed only after systemd confirms the runner service.

## Acceptance

Repository acceptance requires a clean non-root execution of:

```bash
npm ci
npm run check
```

with all functional tests passing, the full mock GitHub/Codex flow passing, both system harnesses passing, and runtime coverage reporting exactly 100% for lines, branches, and functions.

Target-host acceptance remains separate and must not be claimed before live WSL evidence exists.
