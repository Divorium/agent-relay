# Agent Relay Repository Instructions

## Scope

This repository implements a self-hosted bridge between a repository-scoped GitHub Actions runner and Codex. Keep the system small: GitHub Actions owns checkout, commit, push, and GitHub credentials; Agent Relay owns authenticated process execution in the shared workspace.

## Required workflow

For substantial work, read `.agent/PLANS.md` and the active ExecPlan under `docs/exec-plans/active/`. Keep the plan current while implementing. Do not mark work complete without executable validation evidence.

## Engineering rules

- Use TypeScript with strict checking for the service.
- Prefer Node.js built-ins over additional runtime dependencies.
- Keep API and result contracts explicit and validated.
- Never add GitHub credentials, SSH keys, Docker socket access, or private application log access to Agent Relay.
- Never set `CODEX_HOME`; use the mounted standard `~/.codex` directory.
- The runner, not Codex, performs Git commit and push.
- `.agent-relay/result.json` is transient control metadata and must never be committed.
- Code, identifiers, and code comments must be in English.

## Validation

Before completion run:

    npm run check

When Docker is available, also build both images, validate Compose configuration, run `scripts/toolchain-smoke.sh` inside the Agent Relay image, and exercise the documented end-to-end workflow.
