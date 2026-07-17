# Install and update a native organization runner with isolated Codex execution

This ExecPlan follows `.agent/PLANS.md` and implements `docs/native-github-runner-specification.md`.

## Purpose

Replace the former container and Relay service with one native Debian WSL installation. Keep one trusted source checkout, isolate GitHub workflow workspaces, and separate one-time host installation from recurring application updates.

The administrator performs privileged host operations. `agent-relay-builder` validates untrusted releases without sudo. `github-runner` executes workflows and Codex without sudo. No `/opt/agent-relay` deployment copy exists.

## Fixed filesystem layout

All Agent Relay and GitHub Runner data is grouped below one administrator-controlled root: `/srv/github-runner/storage`.

```text
/srv/github-runner/storage/agent-relay  administrator-owned source and trusted runtime
/srv/github-runner/storage/work         github-runner-owned workflow workspaces
/srv/github-runner/storage/runner       official GitHub Actions runner
/srv/github-runner/storage/home         github-runner home and Codex authentication
/srv/github-runner/storage/build        isolated temporary build area
/srv/github-runner/storage/build-home   builder home and tool caches
```

The directories have distinct responsibilities and ownership:

- `agent-relay` is the only source checkout and contains the activated, root-owned `dist` runtime;
- `work` contains repositories checked out by GitHub Actions and is writable by `github-runner`;
- `runner` contains the official GitHub Actions Runner binaries and registration state;
- `home` is the persistent home of `github-runner` and stores Codex authentication and runtime cache roots;
- `build` contains disposable per-update staging directories used by `agent-relay-builder`;
- `build-home` is the persistent home and package-cache location of `agent-relay-builder`.

The runner is configured with work name `_work`. `/srv/github-runner/storage/runner/_work` is a managed symlink to `../work`, so the official runner resolves its normal relative work path to `/srv/github-runner/storage/work`.

This layout is part of the architecture contract. README files may summarize it but must not introduce additional filesystem decisions that are absent from this plan and `docs/native-github-runner-specification.md`.

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
- one filesystem root, `/srv/github-runner/storage`, containing the six fixed runtime directories defined above;
- dedicated `/srv/github-runner/storage/work` runner workspace;
- every canonical workflow checkout selected below `/srv/github-runner/storage/work` is passed to Codex with an exact per-project `trust_level="trusted"` override before the first `exec`;
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

The trust tests verify that the exact canonical checkout receives `trust_level="trusted"` before `exec`, that paths requiring quoting are encoded safely, and that the mock Codex launcher receives the trust override on its first invocation. The toolchain smoke test also passes the same inline project configuration through the installed Codex CLI parser.

The system installer harness executes a transformed copy of the real `install.sh` against an isolated filesystem and mock system commands. It verifies the complete storage layout, service-account creation, no-sudo checks, runner archive checksum, PAT-to-registration-token exchange, runner configuration, workspace symlink, root-owned service unit, Codex login, and the absence of service activation before update.

The system updater harness executes a transformed copy of the real `update.sh` against isolated Git repositories. It verifies storage-root build paths, a full successful update with all tests and 100% coverage, rollback after a simulated build failure before activation, and rollback to the previous runtime after a simulated service-start failure following the runtime swap.

## Progress

- [x] Removed Relay HTTP, polling, queues, persisted state, Docker, Compose, and environment-file deployment.
- [x] Implemented direct Codex runtime, output redaction, limits, timeout, process-group termination, and filesystem boundary.
- [x] Added request and active-plan resolvers and retained exact PR resolution and finalization.
- [x] Replaced the `/opt/agent-relay` copy with the protected source checkout.
- [x] Defined all six fixed directories under `/srv/github-runner/storage` in the plan, specification, README, installer, updater, and tests.
- [x] Moved runner workspaces to `/srv/github-runner/storage/work`.
- [x] Moved runner binaries, runner home, builder staging, and builder home below `/srv/github-runner/storage`.
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
- [x] Forced every selected workspace below `/srv/github-runner/storage/work` to be trusted by Codex on its first invocation.
- [x] Added unit, process integration, quoting, and installed-parser smoke coverage for the project trust configuration.

## Decisions

- Decision: place every application-owned persistent and temporary directory under `/srv/github-runner/storage`.
  Rationale: one explicit root makes installation, ownership, backup, inspection, cleanup, and path-policy review deterministic. The six child directories remain separated by responsibility and ownership.

- Decision: keep runner binaries and workflow workspaces in sibling directories, with `runner/_work` pointing to `../work`.
  Rationale: the official runner retains its expected relative `_work` path without mixing runner registration state with mutable repository checkouts.

- Decision: use separate administrator, builder, and runner identities.
  Rationale: lack of a password is not a security boundary when the same account remains sudo-capable; different accounts without sudo provide an enforced OS boundary.

- Decision: keep only the source checkout, not a second `/opt/agent-relay` copy.
  Rationale: administrator ownership and removal of group/other write permission protect the trusted scripts, while root ownership protects the activated `dist`.

- Decision: split installation from update.
  Rationale: package setup, runner registration, and Codex login are one-time operations; releases should require one predictable `update.sh` command.

- Decision: retain the previous runtime until the new service is active.
  Rationale: successful compilation alone is insufficient; activation is committed only after systemd confirms the runner service.

- Decision: trust each canonical workflow checkout through an exact Codex project override on every invocation.
  Rationale: Codex trust is keyed by absolute project path and has no supported wildcard for all descendants. Reapplying the exact trusted path avoids the first-run prompt for every checkout and does not depend on a previously persisted entry.

## Acceptance

Repository acceptance requires a clean non-root execution of:

```bash
npm ci
npm run check
```

with all functional tests passing, the full mock GitHub/Codex flow passing, both system harnesses passing, all six fixed paths verified below `/srv/github-runner/storage`, exact workspace trust verified before `exec`, and runtime coverage reporting exactly 100% for lines, branches, and functions.

Target-host acceptance remains separate and must not be claimed before live WSL evidence exists.
