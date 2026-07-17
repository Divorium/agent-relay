# Native GitHub Runner Operations

## Source checkout

The repository checkout in WSL is:

```text
/srv/github-runner/storage/agent-relay
```

The installer resolves the source directory from its own location. It does not require the checkout to be under the user's home directory and does not store runtime state in the source checkout.

## Install or update

Run the same entrypoint for the first installation and every update:

```bash
cd /srv/github-runner/storage/agent-relay
./install.sh
```

The script installs and validates the toolchain, installs the trusted harness under `/opt/agent-relay`, authenticates Codex when required, installs the official GitHub Actions runner, registers it for the `Divorium` organization, and installs its systemd service.

The installer accepts no arguments and uses no environment file.

### WSL systemd restart

When WSL is detected without systemd running as PID 1, the installer updates `/etc/wsl.conf` and exits without continuing the installation. Run this once from Windows:

```powershell
wsl --shutdown
```

Start Debian again and rerun:

```bash
cd /srv/github-runner/storage/agent-relay
./install.sh
```

No manual edit of `/etc/wsl.conf` is required.

### Interactive steps

The installer has only two conditional interactions:

- it invokes `codex login` when the current Debian user is not authenticated;
- when no runner registration exists, it reads one GitHub token without echo.

For initial organization registration, a classic personal access token needs `admin:org`. A fine-grained token needs the `Self-hosted runners` organization permission with write access. The installer exchanges it for GitHub's short-lived registration token, then removes both values from its shell state. Neither token is written to the repository, installed harness, service configuration, profile, or runner environment.

## Installed layout

```text
/opt/agent-relay                              trusted root-owned harness
/usr/local/bin/codex-run                      root-owned Codex launcher
$HOME/.local/share/actions-runner             official GitHub Actions runner
$HOME/.local/share/actions-runner/_work       runner workspaces
$HOME/.codex/auth.json                        current user's Codex authentication
/opt/rust                                     root-owned Rust toolchain
/usr/local/go                                 Go toolchain
```

The source checkout at `/srv/github-runner/storage/agent-relay` is not used as a runner workspace and is not modified by workflow jobs.

## Runner registration

The installer registers one organization runner with:

```text
URL:  https://github.com/Divorium
Name: gh-runner
Work: _work
```

It does not add custom labels or manage runner groups. Repository access is controlled by the existing organization runner-group policy. Maintained workflows use:

```yaml
runs-on: [self-hosted]
```

## Workflow dispatch

The production workflow is `.github/workflows/agent-relay.yml`.

A ready-for-review pull request starts automatically only when its head repository is the same repository. Manual dispatch requires:

- `pr_number`: an open, non-draft pull request number;
- `plan_path`: a regular, non-symlink Markdown file directly under `docs/exec-plans/active/`.

The installed resolver obtains the pull request head branch and exact SHA from the GitHub API before checkout. Checkout uses `persist-credentials: false`, and the workflow verifies that no checkout credential remains before Codex starts.

## Codex execution

The workflow invokes:

```text
/opt/agent-relay/dist/src/run-codex.js
```

The direct runner:

- validates the runner workspace and active ExecPlan path;
- constructs the minimal plan-based prompt;
- invokes `/usr/local/bin/codex-run`;
- limits model-controlled filesystem access to the selected repository and a private runtime directory;
- keeps `.git` read-only for Codex;
- enables required network access;
- streams redacted stdout and stderr;
- enforces the configured timeout and output cap;
- returns non-zero on validation, spawn, timeout, or Codex failure.

Codex does not receive a GitHub token and does not commit or push. After successful execution, the trusted finalizer commits and pushes only when Git reports changes.

## Logs and results

Codex output is visible directly in the `Run Codex directly` GitHub Actions step. The same redacted stream is uploaded as the `agent-relay-output` artifact even when Codex fails.

There is no separate application log store or persisted job queue. GitHub Actions is the execution and log surface.

A clean worktree is a successful no-op. A changed worktree is checked with `git diff --check`, committed with the normalized active-plan heading, and pushed to the API-resolved pull request branch. If push fails, the finalizer removes its local commit and restores the working-tree changes for a retry.

## Recovery

Rerun the installer after package, harness, authentication, registration, or service problems:

```bash
cd /srv/github-runner/storage/agent-relay
./install.sh
```

A rerun preserves the existing Codex login, runner registration, `_work`, diagnostics, and a newer runner version installed by GitHub's updater.

The installer operates only on the new native installation. It does not inspect, stop, unregister, copy from, clean, or modify the previous environment.

## Repository validation

The repository-owned validation suite is:

```bash
cd /srv/github-runner/storage/agent-relay
npm ci
npm run check
```

The suite uses local fixtures. It does not perform live package installation, interactive login, organization registration, runner-group changes, or systemd service installation.