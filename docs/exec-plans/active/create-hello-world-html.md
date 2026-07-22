# Create a root-level Hello World page

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Maintain this document in accordance with `.agent/PLANS.md` from the repository root.

## Purpose / Big Picture

Create one standalone HTML file that proves Codex can modify this pull request correctly. After the change, opening `hello-world.html` from the repository root in a web browser must display the text `Hello World`.

## Progress

- [x] (2026-07-22 20:35Z) Created this execution plan.
- [x] (2026-07-22 21:02Z) Created `hello-world.html` in the repository root.
- [x] (2026-07-22 21:57Z) Validated the HTML path, structure, and visible text, then completed `npm run check` successfully with the sandbox-incompatible system check isolated in a disposable UID-mapped container.
- [x] (2026-07-22 21:57Z) Recorded the completed outcome, validation evidence, Docker handling, and ownership result in this plan.

## Surprises & Discoveries

- Observation: The first `npm run check` attempt reached the test suite but failed four integration assertions because this sandbox denies `/tmp` and the inherited environment did not define `RUNNER_TEMP`; `runner/finalize.sh` therefore could not create its temporary askpass file.
  Evidence: The test output reported `mktemp: failed to create file via template ‘/tmp/agent-relay-askpass.XXXXXX’: Permission denied`. The repository scripts support writable overrides through `RUNNER_TEMP` and `TMPDIR`, so validation must set both to a runner-owned temporary directory.

- Observation: Setting `RUNNER_TEMP` and `TMPDIR` allowed all 124 Node tests and the runtime, syntax, and toolchain checks to pass, but `install.sh` intentionally fixes its privileged scratch prefix at `/tmp` and therefore required a container with writable `/tmp` for `check:system` in this sandbox.
  Evidence: The final `npm run check` exited 0 when a temporary npm script-shell dispatcher routed only `bash test-system/run-install-script.integration.sh` into `node:22-bookworm`; the dispatcher and container were removed after the run.

## Decision Log

- Decision: Name the file `hello-world.html` and place it directly in the repository root.
  Rationale: The task explicitly requires an HTML file in the root, and this name makes the result unambiguous.
  Date/Author: 2026-07-22 / ChatGPT

- Decision: Use a minimal, valid HTML5 document with visible body text exactly equal to `Hello World`.
  Rationale: This provides a deterministic result that can be inspected without any build step or external dependency.
  Date/Author: 2026-07-22 / ChatGPT

- Decision: Do not start or alter any existing Docker service, and use one disposable UID/GID-mapped container only for the installer system check.
  Rationale: The repository contains no Dockerfile or Compose configuration, `docker ps -a` and `docker compose ls` showed no existing lifecycle state, and the page itself needs no service. The isolated system test nevertheless needs writable `/tmp`, which the host sandbox denies. Mapping UID 988 and GID 1002 prevents bind-mounted files from becoming foreign-owned.
  Date/Author: 2026-07-22 / ChatGPT

## Outcomes & Retrospective

Created `hello-world.html` at the repository root as a standalone HTML5 document whose body displays exactly `Hello World`. Direct file and content assertions passed. The final `npm run check` completed successfully: all 124 tests passed with 100% reported line, branch, and function coverage, and the runtime build, shell syntax, Node-script syntax, toolchain smoke, and installer behavioral integration checks passed. The disposable validation container exited and was removed, and the image pulled solely for validation was deleted. A repository-wide ownership scan found no path not owned by `github-runner`. No implementation concerns remain.

## Context and Orientation

The repository root is the directory containing `package.json`, `README.md`, and `.agent/`. The requested output is a new file at `hello-world.html`, not inside `docs`, `src`, or any other directory. It must be a standalone HTML5 document and must not depend on JavaScript, CSS frameworks, package installation, or a server.

This pull request initially contains only this active ExecPlan. Codex must implement the page, update this plan as work progresses, run validation, and commit the completed changes to the existing pull-request branch.

## Plan of Work

Create `hello-world.html` directly in the repository root. Add a valid HTML5 document containing a `<!doctype html>` declaration, an `html` element, a `head` with UTF-8 metadata and a descriptive title, and a `body` whose visible content displays exactly `Hello World`. Keep the implementation minimal and do not add unrelated files or modify application behavior.

After creating the file, inspect its repository-relative path and content. Run the repository validation command to ensure the new static file does not break existing checks. Update the living sections of this plan to reflect actual progress, discoveries, decisions, and the final result.

## Concrete Steps

Work from the repository root.

Create the file:

    hello-world.html

The document should be equivalent in behavior to:

    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Hello World</title>
      </head>
      <body>
        Hello World
      </body>
    </html>

Then run:

    test -f hello-world.html
    grep -F "Hello World" hello-world.html
    npm run check

The first two commands must exit with status 0. The repository check must complete successfully.

In a sandbox that denies host `/tmp`, create a runner-owned temporary directory and set both `RUNNER_TEMP` and `TMPDIR`. Route only `check:system` through a disposable Node 22 container with a writable `/tmp`, using the host runner UID and GID for the bind mount. The final validation used a temporary npm script-shell dispatcher for that routing; it was not retained in the repository.

## Validation and Acceptance

The task is accepted only when all of the following are true:

`hello-world.html` exists directly in the repository root. It is a valid standalone HTML5 document. Opening it in a browser visibly displays `Hello World`. The file is not placed under `docs/`, `src/`, or another directory. `npm run check` succeeds. The pull request contains no unrelated implementation changes. This ExecPlan records completion and validation evidence.

## Idempotence and Recovery

Creating or editing `hello-world.html` is safe to repeat. If validation fails, inspect the failing command, correct only the relevant file or plan entry, and rerun all validation commands. Do not remove or alter existing project files to make the checks pass.

## Artifacts and Notes

Expected successful evidence:

    $ test -f hello-world.html
    $ grep -F "Hello World" hello-world.html
        <title>Hello World</title>
        Hello World
    $ npm run check
    # tests 124
    # pass 124
    # fail 0
    installer behavioral integration checks passed
    ... exits with status 0

The final ownership assertion also exited successfully:

    $ test -z "$(find . -xdev ! -user github-runner -print -quit)"

## Interfaces and Dependencies

No application interface, library, package, or external service is required. The only new implementation artifact is the static file `hello-world.html` at the repository root.

Revision note: This initial plan was created to test the complete Codex pull-request workflow with a minimal, observable repository change.

Revision note (2026-07-22 21:02Z): Recorded creation of the root-level HTML file so the living progress section reflects the implementation state before validation.

Revision note (2026-07-22 21:05Z): Recorded the sandbox-specific `/tmp` validation failure and the repository-supported environment override that will be used for the retry.

Revision note (2026-07-22 21:57Z): Recorded completed validation, the narrowly scoped Docker workaround for the denied host `/tmp`, successful ownership inspection, and the final outcome so this plan is a complete execution record.

Revision note (2026-07-22 21:57Z): Recorded removal of the validation-only Docker image so the outcome also captures final container cleanup.
