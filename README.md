# Agent Relay

Agent Relay runs on a dedicated Debian 13 (Trixie) x86-64 systemd host with one organization-level GitHub Actions runner.

- [`ansible/README.md`](ansible/README.md) describes the complete host and Agent Relay deployment;
- [`docs/operations/README.md`](docs/operations/README.md) describes credentials, updates and recovery;
- [`docs/native-github-runner-specification.md`](docs/native-github-runner-specification.md) defines the technical runtime and privilege contracts.

Ansible provisions the host, manages the source checkout and invokes `install.sh`. The installer validates the prepared host, installs or reuses the GitHub runner, builds Agent Relay and activates the runner service. It never installs or invokes Ansible, installs host packages, creates users or authenticates Codex.

Shared runner, toolchain and host constants are defined once in [`config/runner-host.json`](config/runner-host.json).

Codex output is normalized into Actions-safe `[codex] ` lines, redacted, streamed live and written to the `agent-relay-output` artifact. `${GITHUB_OUTPUT}` remains reserved for workflow outputs.
