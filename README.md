# Agent Relay

Agent Relay runs on a dedicated Debian 13 (Trixie) x86-64 systemd host with an organization-level GitHub Actions runner.

- [`ansible/README.md`](ansible/README.md) describes host installation and separate GitHub connection.
- [`docs/operations/README.md`](docs/operations/README.md) describes updates and recovery.
- [`docs/native-github-runner-specification.md`](docs/native-github-runner-specification.md) defines runtime and privilege contracts.
- [`docs/job-managed-codex.md`](docs/job-managed-codex.md) defines workflow-owned CLI installation, temporary authentication and cleanup.

`ansible/playbooks/host.yml` provisions packages, users, Docker, pinned language toolchains, runner binaries, systemd and the Agent Relay runtime without a GitHub PAT. It does not install, update, authenticate or uninstall Codex. On an unregistered host it leaves the runner listener disabled and stopped. `ansible/playbooks/github-connect.yml` separately registers and starts the prepared runner using a control-machine credential.

Codex runs natively through the existing restricted launcher. A workflow selects a pinned CLI version and calls `scripts/run-job-codex` with `CODEX_VERSION`, `CODEX_CACHE_ROOT`, `RUNNER_TEMP` and a step-scoped `CODEX_TOKEN`. Installation is cached outside runner HOME; authentication is never cached. The wrapper passes `CODEX_BINARY`, `CODEX_INSTALL_ROOT` and private `CODEX_HOME` to the launcher. No global CLI or persistent host login is required.

Docker remains at `/srv/github-runner/storage/docker-socket/docker.sock`; `/run/docker.sock` remains available to operators. Users and daemon privileges are unchanged. Access to this daemon remains privileged host trust, not strong isolation.

Codex output is normalized into Actions-safe `[codex]` lines, redacted and streamed. `${GITHUB_OUTPUT}` carries workflow outputs only. Exit zero requires at least one completed command or non-empty file-change event. Trusted finalization owns commits and pushes. No public artifact upload is added.
