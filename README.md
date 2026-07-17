# Agent Relay

This repository installs one native GitHub Actions organization runner and a trusted Codex execution harness on Debian. The former Agent Relay HTTP service, polling client, bearer secret, persisted job state, Docker images, and Compose deployment are not part of the current runtime.

The runner and Codex execute in the same operating-system environment. A workflow resolves an open, ready pull request, checks out its exact head SHA without retaining credentials, runs Codex directly in the selected repository, uploads redacted output, and uses a separate trusted finalizer for commit and push.

## Runtime model

The native installation contains:

- the official GitHub Actions runner registered at `https://github.com/Divorium` as `gh-runner`;
- root-owned helper files under `/opt/agent-relay`;
- the root-owned launcher `/usr/local/bin/codex-run`;
- Codex CLI authenticated through the current Debian user's normal `$HOME/.codex/auth.json`;
- no long-lived application service other than the official runner service.

Only trusted organization repositories and workflows may use this runner. A self-hosted workflow step runs with the runner user's operating-system permissions; the Codex permission profile constrains model-controlled tools but is not a general sandbox for arbitrary workflow code.

## Installation

Prerequisites:

- Debian x86-64;
- systemd running as PID 1, including in WSL;
- a normal non-root user with `sudo`;
- outbound HTTPS;
- a GitHub token that can create an organization runner registration token for `Divorium`.

Run:

```bash
git clone https://github.com/Divorium/agent-relay.git
cd agent-relay
./install.sh
```

The installer performs package installation, source validation, trusted harness installation, Codex authentication, GitHub runner installation, organization registration, and service startup. It has no arguments and uses no `.env` file.

On a fresh registration it asks once, without echo, for a GitHub token. A classic personal access token needs `admin:org`; a fine-grained token needs organization `Self-hosted runners` write permission. The token is used only to request GitHub's short-lived registration token and is not written to disk or retained by the runner service.

When Codex is not authenticated, the installer invokes:

```bash
codex login
```

Rerunning `./install.sh` preserves the current Codex login, runner registration, runner work directory, diagnostics, and any newer runner version installed by GitHub's updater. The installer does not inspect, stop, unregister, copy from, or clean any previous Docker or runner environment.

## Workflow inputs

The production workflow is `.github/workflows/agent-relay.yml`. Manual dispatch accepts only:

- `pr_number`: an open pull request to update;
- `plan_path`: a regular, non-symlink Markdown file directly under `docs/exec-plans/active/`.

The workflow also starts when a same-repository pull request becomes ready for review. It rejects fork-origin pull requests before untrusted repository code runs.

Before checkout, `/opt/agent-relay/runner/resolve-pr.mjs` verifies that the pull request exists, is open, is not a draft, belongs to the target repository, and has valid head ref and SHA values. Checkout uses the API-derived head SHA. Finalization pushes to the API-derived head ref.

## Execution behavior

Codex receives one task prompt:

```text
Follow .agent/PLANS.md and execute the active ExecPlan at <selected-plan-path>.
```

The direct CLI preserves the useful execution controls from the previous implementation:

- realpath containment under `${{ runner.workspace }}`;
- direct active-plan path and symlink checks;
- no Codex-owned commit or push;
- memories disabled;
- restricted filesystem permissions and required network access;
- streaming redaction of stdout and stderr;
- output cap with an explicit truncation marker;
- timeout with process-group `SIGTERM` and delayed `SIGKILL`;
- non-zero exit on validation, spawn, timeout, or Codex failure.

The commit message is derived before Codex starts from the first non-empty level-one heading in the active ExecPlan, normalized to one line, and limited to 120 Unicode characters. It is written to `GITHUB_OUTPUT` only after Codex succeeds. A clean worktree is a successful no-op. A changed worktree is checked, committed, and pushed by `/opt/agent-relay/runner/finalize.sh`.

## Credential boundaries

- Pull-request resolution receives `${{ github.token }}` only for the API lookup.
- Checkout uses `${{ github.token }}` with `persist-credentials: false`.
- The workflow verifies that no authorization header, credential helper, or credential-bearing remote remains before Codex starts.
- The Codex step receives no GitHub token or runner registration token.
- Finalization receives `${{ github.token }}` only through `GITHUB_PUSH_TOKEN` and uses a temporary askpass helper.
- No Relay bearer secret exists.
- The native launcher replaces the environment through `env -i`, preserves the real `HOME` only for Codex authentication, and uses a private per-execution temp directory.
- Model-controlled filesystem access denies the real home, `/opt/agent-relay`, `/opt/rust`, the complete runner workspace root, and general temp roots before re-allowing only the selected repository, its `.git` directory as read-only, and the private runtime directory.

## Validation

Repository validation is:

```bash
npm ci
npm run check
```

The suite covers direct CLI validation, workspace and plan boundaries, redaction, output truncation, process failure and timeout behavior, native launcher isolation, toolchain pins, installer contracts, pull-request resolution, workflow token scoping, and Git finalization. It does not perform a live GitHub registration, interactive Codex login, package installation, or systemd service installation.

Operational details are in `docs/operations/README.md`. The implementation contract is in `docs/native-github-runner-specification.md`.

## ExecPlans

Active:

- `docs/exec-plans/active/2026-07-16-install-native-github-runner.md`

Completed:

- `docs/exec-plans/completed/2026-07-13-agent-relay-mvp.md`
- `docs/exec-plans/completed/2026-07-13-ready-pr-gate.md`
- `docs/exec-plans/completed/2026-07-15-audit-codex-context.md`
- `docs/exec-plans/completed/2026-07-15-review-9-script-integration.md`
- `docs/exec-plans/completed/2026-07-16-remove-sudo-runtime.md`
- `docs/exec-plans/completed/2026-07-16-restore-codex-runtime-and-failure-logs.md`
