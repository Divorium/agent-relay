# Agent Relay Repository Instructions

- Use TypeScript with strict checking for the service.
- Prefer Node.js built-ins over additional runtime dependencies.
- Keep API and data contracts explicit and validated.
- Write code, identifiers, and code comments in English.
- Execute every required repository, implementation, validation, review, and follow-up task through the agent or automated CI. Do not assign repository work to an operator, reviewer, user, or other human.
- When available tools cannot execute a required check, keep the work incomplete and state the limitation. Do not convert the missing capability into a hidden human task or declare the work complete.

## Architecture and documentation discipline

- Treat source code, the current `README.md`, `docs/native-github-runner-specification.md`, and `docs/operations/README.md` as the current implemented contract. Resolve any disagreement against the checked-out source before editing documentation.
- Treat files under `docs/exec-plans/completed/` as historical records. Never use them as current architecture instructions and do not rewrite them to match later changes.
- Treat only the explicitly selected file under `docs/exec-plans/active/` as the implementation instruction for a Codex task.
- In an active ExecPlan, distinguish current behavior from proposed behavior. Do not copy broad updater, workflow, CI, installation, or security descriptions unless the planned change directly depends on them.
- Before recording a current-state claim, verify the exact checked-out branch, current file names, and current behavior in the relevant source. Recheck those claims after a rebase or base-branch change.
- Do not describe a proposed feature in README or operator documentation as currently available before its implementation and acceptance evidence are complete.
- Do not change GitHub Actions workflow files merely to expose a host command-line tool when the existing generic execution and log paths already provide the required behavior. Any workflow change must be justified by a concrete missing interface.
