# Agent Relay Repository Instructions

## Scope

This repository implements a self-hosted bridge between a repository-scoped GitHub Actions runner and Codex. Keep the service and its trust boundaries small.

## Required workflow

For substantial work, follow the active ExecPlan referenced by the task. Keep its living sections current and do not claim completion without executable validation evidence.

## Engineering rules

- Use TypeScript with strict checking for the service.
- Prefer Node.js built-ins over additional runtime dependencies.
- Keep API and result contracts explicit and validated.
- Keep GitHub credentials, the Docker socket, and Relay state outside the Codex execution boundary.
- Write code, identifiers, and code comments in English.

## Validation

Run the validation required by the active plan. `npm run check` is the minimum repository validation.
