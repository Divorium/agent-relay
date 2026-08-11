# Agent Relay

Agent Relay runs on a dedicated Debian 13 (Trixie) x86-64 systemd host with one organization-level GitHub Actions runner.

- [`ansible/README.md`](ansible/README.md) describes the complete host installation and separate GitHub connection;
- [`docs/operations/README.md`](docs/operations/README.md) describes credentials, updates, and recovery;
- [`docs/native-github-runner-specification.md`](docs/native-github-runner-specification.md) defines runtime and privilege contracts.

`ansible/playbooks/host.yml` provisions and updates the full host without a GitHub PAT. It manages packages, users, Docker, pinned language toolchains, the latest Codex CLI, runner binaries, the systemd unit, source checkout, and Agent Relay runtime. On an unregistered host it leaves the runner listener disabled and stopped.

`ansible/playbooks/github-connect.yml` is a separate one-time operation. It requires the organization PAT, verifies the prepared host, registers the runner, starts the listener, and reconciles the custom `agent-relay` label. It does not rerun host provisioning or runtime installation.

Pinned runner, language-toolchain, and host constants are defined in [`config/runner-host.json`](config/runner-host.json). Codex is updated to the latest available CLI release on every `host.yml` run. Codex uses `/srv/github-runner/storage/docker-socket/docker.sock`; `/run/docker.sock` remains available for host operators. Consumer workflows target `[self-hosted, agent-relay]` and retain the exact `runner.name == gh-runner` assertion as defense in depth.

Codex output is normalized into Actions-safe `[codex] ` lines, redacted, streamed live, and written to the `agent-relay-output` artifact. `${GITHUB_OUTPUT}` remains reserved for workflow outputs. A zero-exit Codex process is accepted only after at least one command execution or file change event is observed.
