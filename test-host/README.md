# Debian Docker real-host acceptance

Privileged Docker acceptance is intentionally separate from ordinary repository CI and is currently blocked. The automated matrix, required evidence, cause, impact, and unblock condition are recorded in the `Real-Host Acceptance Blocker` section of `docs/exec-plans/active/2026-07-17-install-docker-for-codex.md`.

No current script in this directory is an accepted harness. Acceptance must run automatically on disposable or explicitly designated Debian 13 x86-64 systemd hosts and must not assign command execution or result interpretation to a human operator.
