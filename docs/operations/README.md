# Native GitHub Runner Operations

## Source checkout

The WSL checkout is:

```text
/srv/github-runner/storage/agent-relay
```

The installer resolves its source directory from its own path. The checkout does not need to be under the user's home and is not used as a runner workspace.

## Install or update

Use the same command for first installation, retry, recovery, and update:

```bash
cd /srv/github-runner/storage/agent-relay
./install.sh
```

The installer accepts no arguments and uses no environment file. It installs and validates the toolchain, installs the root-owned harness under `/opt/agent-relay`, authenticates Codex when required, installs and registers the official GitHub Actions runner, and starts its systemd service.

### WSL systemd restart

When WSL does not run systemd as PID 1, the installer updates `/etc/wsl.conf` and exits before package or runner installation. Run from Windows:

```powershell
wsl --shutdown
```

Start Debian and rerun the installer. No manual edit of `/etc/wsl.conf` is required.

### Interactive steps

The installer has only two conditional interactions:

- `codex login` when the current Debian user is not authenticated;
- one hidden GitHub PAT prompt when runner registration is absent.

A classic PAT needs `admin:org` and also `repo` when private repositories are involved. A fine-grained PAT needs organization `Self-hosted runners` write permission.

The PAT is used only to request GitHub's short-lived registration token and is unset immediately after the API call. The short-lived token is passed only to official `config.sh --token` and unset after configuration. Neither token is stored in the source checkout, harness, service, profile, or runner environment.

## Installed layout

```text
/opt/agent-relay                              trusted root-owned harness
/usr/local/bin/codex-run                      root-owned Codex launcher
$HOME/.local/share/actions-runner             official runner
$HOME/.local/share/actions-runner/_work       runner workspaces
$HOME/.codex/auth.json                        Codex authentication
$HOME/.cache/agent-relay-runtime              private per-run parent
/opt/rust                                     root-owned Rust toolchain
/usr/local/go                                 Go toolchain
```

## Runner registration and service

The installer registers:

```text
URL:  https://github.com/Divorium
Name: gh-runner
Work: _work
```

No custom labels or runner-group changes are made. Maintained workflows use:

```yaml
runs-on: [self-hosted]
```

`installdependencies.sh` is executed as root only immediately after checksum-verified runner extraction. `svc.sh install` is executed only when extraction or registration completed in the current installer process. Existing services are started and checked through a validated name from `.service` and `systemctl`; reruns do not execute mutable runner scripts as root.

If registration failed before `.runner` was written, rerun the installer. If registration succeeds on the retry, the same process may complete service installation. A pre-existing registered runner with no `.service` file is treated as incomplete and is not trusted for root execution.

## Workflow dispatch

The production workflow is `.github/workflows/agent-relay.yml`.

A ready-for-review pull request starts automatically only when its head repository is the same repository. Manual dispatch requires:

- `pr_number`: an open, non-draft pull request number;
- `plan_path`: a regular, non-symlink Markdown file directly under `docs/exec-plans/active/`.

The installed resolver obtains the exact head branch and SHA from GitHub before checkout. Checkout uses `persist-credentials: false`, and the workflow verifies that no checkout credential remains before Codex starts.

## Codex execution

The workflow invokes:

```text
/opt/agent-relay/dist/src/run-codex.js
```

The direct path validates workspace and plan boundaries, constructs the minimal plan prompt, invokes `/usr/local/bin/codex-run`, streams redacted output, enforces timeout/output limits, and returns non-zero on validation or process failure.

The model-controlled permission profile denies the real home, trusted harness, runner workspace root, and general temp roots. `/opt/rust` is read-only so Cargo/Rust remain usable. Writes are limited to the selected repository and one private runtime directory; `.git` remains read-only.

The launcher redirects Cargo, npm, pip, Go, Gradle, XDG, and temporary state into the private runtime directory. It uses `/dev/null` as the model-controlled Git global config, avoiding access to `$HOME/.gitconfig`.

Codex receives no GitHub token and does not commit or push. The trusted finalizer runs only after successful Codex execution.

## Logs and results

Redacted output is visible in the `Run Codex directly` step and uploaded as `agent-relay-output` even when Codex fails.

There is no separate application log store or job queue. A clean worktree is a successful no-op. A changed worktree is checked, committed, and pushed to the API-resolved pull-request branch. Failed push removes the local commit and restores changes for retry.

## Recovery

Rerun:

```bash
cd /srv/github-runner/storage/agent-relay
./install.sh
```

A rerun preserves valid Codex authentication, runner registration, `_work`, diagnostics, and a newer runner version installed by GitHub's updater. Source validation and smoke checks occur before the root-owned harness swap; an interrupted swap restores the previous harness.

The installer operates only on the new native installation and never inspects or modifies the previous environment.

## Repository validation

```bash
cd /srv/github-runner/storage/agent-relay
npm ci
npm run check
```

The deterministic suite does not perform live package installation, interactive login, organization registration, runner-group changes, or systemd installation.
