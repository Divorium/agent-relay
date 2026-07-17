# Use the GitHub runner registration token directly during installation

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current as work proceeds. Maintain this document in accordance with `.agent/PLANS.md`. Only this selected file under `docs/exec-plans/active/` is the implementation instruction for this task.

## Purpose / Big Picture

After this change, first-time installation registers the persistent organization-level GitHub Actions runner with the time-limited runner registration token that GitHub displays in the organization runner setup instructions. The administrator obtains that token from `Organization settings -> Actions -> Runners -> New self-hosted runner`, runs `./install.sh`, and pastes the token into one hidden prompt.

The installer must no longer request a Personal Access Token, GitHub App token, or any other long-lived API credential. It must not call `POST /orgs/Divorium/actions/runners/registration-token`, construct an `Authorization` header, or parse a registration-token API response. It passes the supplied registration token directly to the official runner `config.sh` command.

This does not make the runner ephemeral. The runner remains a persistent service because registration still uses the existing configuration without `--ephemeral`, `--once`, or JIT configuration. The registration token is needed only when `.runner` is absent. Once registration succeeds, the official runner keeps its own registration state under `/srv/github-runner/storage/runner`, and ordinary `update.sh` executions require no runner token and no re-registration.

The implementation must remain narrowly scoped. It must not change runner labels, runner groups, runner name, workspace path, service ownership, systemd behavior, Codex authentication, update transactions, workflow permissions, GitHub push credentials, or the persistent runner lifecycle.

## Progress

- [x] (2026-07-17) Read `.agent/PLANS.md`, `AGENTS.md`, `install.sh`, `README.md`, `docs/native-github-runner-specification.md`, the completed native-runner ExecPlan, `package.json`, `update.sh`, and `test-system/install-script.integration.sh`.
- [x] (2026-07-17) Confirmed that the current installer requests an organization PAT, exchanges it through the GitHub REST API, parses the returned registration token with `jq`, and passes that short-lived token to `config.sh`.
- [x] (2026-07-17) Confirmed from GitHub documentation that `config.sh` accepts the automatically generated time-limited registration token shown by the runner setup flow and that this token expires after one hour.
- [x] (2026-07-17) Created this plan-only branch from `main`; no production implementation is part of this planning pull request.
- [ ] Replace the PAT prompt and REST exchange in `install.sh` with one hidden prompt for the organization runner registration token.
- [ ] Ensure registration failure clears the shell variable, prints a safe actionable error, and never prints the supplied token.
- [ ] Update `test-system/install-script.integration.sh` to prove direct-token registration, no PAT/API exchange, skip behavior for an already registered runner, and safe failure behavior.
- [ ] Update `README.md` and `docs/native-github-runner-specification.md` so the operator flow and installer contract describe the direct registration-token workflow and no longer mention a PAT.
- [ ] Remove obsolete token-exchange-only dependencies or mocks after proving they have no remaining repository use.
- [ ] Run focused installer tests, shell syntax validation, and `npm run check`; capture exact evidence.
- [ ] Perform target-host acceptance with a fresh GitHub-generated organization runner registration token, record the result without recording the token, and keep this plan active if that live evidence is unavailable.
- [ ] Complete `Outcomes & Retrospective` and move this file to `docs/exec-plans/completed/` only after every acceptance item is supported by automated or reproducible evidence.

## Surprises & Discoveries

- Observation: the current installer does not pass the PAT to the official runner. It uses the PAT only to call the organization registration-token API, then passes the returned short-lived token to `config.sh`.
  Evidence: `install.sh` reads `github_token`, sends it in an `Authorization: Bearer` header to `/orgs/Divorium/actions/runners/registration-token`, extracts `.token`, and passes `registration_token` to `config.sh`.

- Observation: the existing runner is persistent even though its initial registration uses a time-limited token.
  Evidence: `install.sh` invokes `config.sh --unattended --replace --url ... --token ... --name gh-runner --work _work` without `--ephemeral`, `--once`, or JIT configuration, then creates a long-lived systemd service.

- Observation: the installer already avoids prompting during normal reruns after successful registration.
  Evidence: the complete registration block is guarded by `if [[ ! -f "${RUNNER_DIR}/.runner" ]]; then`.

- Observation: the system installer harness currently models the PAT exchange rather than the intended operator workflow.
  Evidence: `test-system/install-script.integration.sh` pipes `mock-input`, provides fake `curl` and `jq` commands that return `mock-value`, and only verifies that `config.sh` received `--token mock-value`.

- Observation: the completed native-runner ExecPlan is a historical record and must not be rewritten to reflect this later decision.
  Evidence: `.agent/PLANS.md` states that files under `docs/exec-plans/completed/` are historical records and are not current architecture contracts.

## Decision Log

- Decision: interpret the user-facing term “runner token” as the organization runner registration token displayed by GitHub's `New self-hosted runner` flow.
  Rationale: GitHub passes this exact time-limited token to `config.sh --token`. Calling it a “runner registration token” in code, prompts, documentation, and tests removes ambiguity with PATs, GitHub App tokens, removal tokens, workflow `GITHUB_TOKEN`, and the runner's internal post-registration credentials.
  Date/Author: 2026-07-17 / plan author.

- Decision: require the administrator to obtain the registration token from the GitHub organization UI before running or continuing `install.sh`.
  Rationale: installation is already interactive for runner registration and Codex login. Direct entry removes the broader PAT credential and the REST exchange while matching GitHub's standard setup instructions.
  Date/Author: 2026-07-17 / plan author.

- Decision: keep the token prompt hidden and treat the token as opaque except for rejecting an empty value.
  Rationale: token formats can change. Local format validation would be brittle and cannot determine whether a token is expired, scoped to the wrong organization, or already invalid. The official `config.sh` response is authoritative.
  Date/Author: 2026-07-17 / plan author.

- Decision: pass the registration token directly to the official runner `config.sh` interface and clear the shell variable immediately after the command returns.
  Rationale: `config.sh --token` is the supported registration interface. The token must not be written to repository files, configuration files, logs, temporary files, or installer state.
  Date/Author: 2026-07-17 / plan author.

- Decision: keep the runner persistent and retain the existing `.runner` idempotency guard.
  Rationale: the requested credential change is unrelated to runner lifetime. A successful registration must survive token expiry and WSL restarts, while a rerun against an existing registration must not ask for another token.
  Date/Author: 2026-07-17 / plan author.

- Decision: do not edit the completed native-runner ExecPlan.
  Rationale: it records the architecture and decisions that were implemented at that time. Current behavior belongs in this active plan, the specification, README, installer, and tests.
  Date/Author: 2026-07-17 / plan author.

## Outcomes & Retrospective

This plan is active and contains no implementation. The current installer still requires a PAT or equivalent API credential to obtain the registration token automatically. The expected completed outcome is a smaller and less privileged first-installation credential boundary: the administrator supplies only the time-limited organization runner registration token that the official runner actually consumes.

Completion must be measured by deterministic installer tests, repository-wide validation, updated operator documentation, and target-host evidence when credentials and the WSL host are available. The implementation must not claim that token expiry makes the persistent runner expire or require re-registration after successful setup.

## Context and Orientation

`install.sh` performs one-time host setup. It installs toolchains, creates the locked `github-runner` and `agent-relay-builder` users, downloads the official GitHub Actions Runner, registers it when `${RUNNER_DIR}/.runner` is absent, creates the systemd unit, and performs Codex login. The registration block is the main implementation boundary for this change.

The current registration flow is:

    organization PAT or GitHub App credential
        -> POST /orgs/Divorium/actions/runners/registration-token
        -> JSON response parsed with jq
        -> registration token
        -> runner/config.sh --token

The required registration flow is:

    organization runner registration token copied from GitHub
        -> hidden install.sh prompt
        -> runner/config.sh --token

`README.md` contains the minimal first-installation instructions. It must tell the administrator what token is required, where to obtain it, that GitHub's generated token is time-limited, and that no PAT is required. It must not embed a real token or instruct the user to store one in a shell history, file, or environment variable.

`docs/native-github-runner-specification.md` is the current architecture contract. Its user flow, installer contract, and validation contract currently state that installation requests an organization PAT and exchanges it for a registration token. Those statements must be replaced with the direct registration-token contract. The statement that ordinary updates require no PAT prompt should become a broader statement that ordinary updates require no registration-token prompt or re-registration.

`test-system/install-script.integration.sh` transforms and executes the real installer with isolated paths and mock commands. It is the deterministic proof that the installer prompts correctly, calls `config.sh` with the supplied token, does not perform the obsolete API exchange, remains idempotent after `.runner` exists, and does not leak token text on failure.

The completed file `docs/exec-plans/completed/2026-07-16-install-native-github-runner.md` remains unchanged. Historical references to the previous PAT design are accurate history, not current instructions.

## Plan of Work

### Milestone 1: Replace the credential contract in `install.sh`

Inside the existing `if [[ ! -f "${RUNNER_DIR}/.runner" ]]; then` block, replace the PAT prompt, API request, response parsing, and temporary response variables with one local registration-token flow.

The prompt must explicitly request the GitHub organization runner registration token and point to the UI path without calling it a PAT. Use hidden input with `IFS= read -r -s`. Print a newline after input because hidden reads do not echo one. Reject an empty value before invoking `config.sh`.

Use a variable named `runner_registration_token` or `registration_token`; do not retain `github_token`, because that name is ambiguous and previously meant a broader API credential. Do not add the token to environment files, command files, shell history instructions, application configuration, or persistent installer state.

Invoke the existing official runner configuration with the unchanged organization URL, runner name, work directory, unattended mode, and replacement behavior. Do not add `--ephemeral`, JIT configuration, custom labels, or runner groups.

Handle `config.sh` failure explicitly rather than relying only on `set -e`. Capture the command outcome in a control structure that allows the token variable to be unset before exiting. Print a concise error that tells the administrator to generate a fresh organization runner registration token and rerun `./install.sh`. The message must not echo the supplied value or mislabel it as a PAT.

Keep the `.runner` guard unchanged in meaning. When `.runner` exists, installation must not prompt, contact the registration-token endpoint, or invoke `config.sh` again.

This milestone is complete when code inspection and focused tests prove that `install.sh` contains no PAT prompt, no registration-token API endpoint, no registration response parsing, no authorization header for this flow, and no persistent token storage.

### Milestone 2: Update deterministic installer coverage

Refactor `test-system/install-script.integration.sh` so its success path supplies a value named and treated as a runner registration token. The mock `config.sh` must record arguments without printing them to normal installer output, create `.runner`, and allow the test to assert the unchanged URL, runner name, `_work` path, unattended mode, and direct `--token` value.

Remove mocks that exist only to simulate the PAT-to-API exchange. Add a fail-fast fake `curl` or equivalent command-log assertion for the transformed post-bootstrap installer so a future reintroduction of `/actions/runners/registration-token` causes the test to fail. The initial network and package-download section is already removed by the harness transformation; therefore any remaining registration-time `curl` call is unexpected.

Add assertions for all of the following observable behavior:

1. With no `.runner`, the installer prints a prompt containing `runner registration token`, reads the token from stdin, and passes it directly to `config.sh`.
2. The captured stdout and stderr do not contain the supplied token.
3. With an empty token, installation fails before `config.sh` and prints a clear required-token message.
4. When the mock `config.sh` rejects a supplied token, installation exits non-zero, clears the sensitive variable before controlled exit, prints a fresh-token recovery instruction, and does not print the token.
5. After a successful first registration creates `.runner`, rerunning the transformed installer does not prompt for a token and does not invoke `config.sh` again.
6. No registration-token API endpoint, PAT terminology, `Authorization: Bearer` construction, or JSON token parsing remains in executable installer behavior.

Do not weaken the existing assertions for directory layout, `_work` symlink, service unit, Codex authentication, or absence of service activation during install.

This milestone is complete when the system harness deterministically fails against the old PAT exchange and passes only with the direct registration-token implementation.

### Milestone 3: Align operator and architecture documentation

Update `README.md` under `First installation` to add a compact prerequisite immediately before `./install.sh`:

- open the `Divorium` organization settings;
- navigate to `Actions -> Runners`;
- choose `New self-hosted runner`;
- copy the time-limited token shown in the Linux configuration command;
- paste only that registration token into the hidden installer prompt;
- do not create a PAT for this installation.

The README must explain that the runner remains registered after the token expires and that later releases use only `./update.sh`.

Update `docs/native-github-runner-specification.md` so:

- the ordinary-update statement says no registration-token prompt or runner re-registration is expected;
- the installer contract requires one hidden organization runner registration token only when registration is absent;
- the installer contract says the supplied token is passed directly to the official `config.sh` and is not persisted;
- all requirements to request a PAT, call the token-generation endpoint, or parse its response are removed;
- the validation contract describes a direct registration-token installer harness rather than a PAT-to-registration-token exchange.

Do not change historical completed ExecPlans. Do not add a second setup document that can drift from the README and specification.

This milestone is complete when repository search finds no current-contract documentation instructing the operator to create a PAT for runner registration.

### Milestone 4: Remove obsolete exchange-only dependencies and validate

Inspect every repository use of `jq`, registration response variables, the organization registration-token endpoint, PAT wording, and authorization-header construction. Remove `jq` from the installer package list only if the repository has no remaining runtime or validation use after the exchange is deleted. Remove obsolete test mocks and variables rather than leaving dormant compatibility code.

Run, at minimum:

    bash -n install.sh test-system/install-script.integration.sh
    bash test-system/install-script.integration.sh
    npm run check

Record exact commands and outcomes in `Progress` and `Outcomes & Retrospective`. A syntax-only pass is insufficient; the transformed installer must execute all new success, failure, and rerun cases.

Target-host acceptance requires a currently valid organization runner registration token generated by GitHub. On a host without an existing `.runner`, run `./install.sh`, confirm that the prompt accepts the token without displaying it, confirm successful registration of persistent runner `gh-runner`, and verify that the token is absent from repository files, installer output, and persistent application configuration. Do not record the token itself in this plan or any test evidence.

If live target-host access or a valid token is unavailable, keep the target-host item unchecked and record the blocker according to `.agent/PLANS.md`. Automated mocks cannot prove that GitHub accepted a live token.

## Concrete Implementation Details

The final registration block should have this behavioral shape, with exact shell structure chosen to guarantee cleanup on both success and controlled failure:

    if runner registration is absent:
        print hidden registration-token prompt
        read opaque non-empty token
        invoke config.sh with existing persistent-runner options
        clear token variable
        on failure, print safe recovery instruction and exit non-zero

Do not copy a token into a temporary file to avoid process arguments. The official `config.sh` contract accepts `--token`; use that supported interface. Do not introduce a custom credential transport wrapper around the official runner.

Do not validate a fixed token prefix or length. An empty check is sufficient locally. Wrong-organization, expired, revoked, malformed, or otherwise rejected tokens must be reported through the controlled `config.sh` failure path.

Do not use `--replace` as a substitute for the `.runner` guard. Preserve both current behaviors: `--replace` handles a same-name server-side registration during an intentional fresh local setup, while the local `.runner` file prevents repeated registration on normal installer reruns.

The error message after a rejected token must make recovery explicit:

    Generate a fresh organization runner registration token in GitHub and rerun ./install.sh.

Wording may vary, but it must not ask for a PAT and must not imply that `update.sh` performs registration.

## Validation and Acceptance

The implementation is accepted only when all of the following are true:

- `install.sh` requests a hidden organization runner registration token only when `${RUNNER_DIR}/.runner` is absent.
- The installer does not request or accept a PAT for runner registration.
- The installer does not call the organization registration-token REST endpoint.
- The installer passes the supplied token directly to the official `config.sh --token` interface.
- Runner configuration remains persistent and does not include `--ephemeral`, `--once`, or JIT configuration.
- Successful registration creates or retains official runner state and later installer reruns skip the token prompt.
- Empty and rejected-token paths fail clearly without printing the supplied token.
- No registration token is written to files, logs, repository state, or application configuration.
- README and the current technical specification describe the same direct-token flow.
- Historical completed ExecPlans remain unchanged.
- The installer system harness covers success, empty input, rejected token, no secret output, no obsolete API exchange, and rerun idempotency.
- `bash -n install.sh test-system/install-script.integration.sh` passes.
- `bash test-system/install-script.integration.sh` passes.
- `npm run check` passes.
- Live target-host registration is either demonstrated with redacted evidence or explicitly left incomplete with a documented blocker.

## Idempotency and Recovery

A failed registration must leave `.runner` absent. The administrator generates a fresh token in GitHub and reruns `./install.sh`. Previously installed packages, toolchains, service accounts, runner binaries, fixed directories, and Codex authentication may be reused by the idempotent installer.

A successful registration must leave `.runner` present. Subsequent `./install.sh` executions skip registration and require no new token. Ordinary releases continue to use only `./update.sh`.

Do not automatically delete a valid existing runner registration. Do not call a remove-token endpoint. Do not unregister a server-side runner as part of failure recovery. If GitHub rejects a fresh token because of an external organization policy or authorization issue, preserve the local diagnostics and fail without attempting broader organization changes.

## Security and Secret Handling

The registration token is time-limited but still sensitive. Read it with terminal echo disabled, keep it in one shell variable for the shortest practical period, pass it only to the official configuration command, unset it immediately afterward, and never include it in error messages.

The change reduces privilege because the installer no longer handles a PAT or GitHub App credential capable of generating registration tokens or performing other authorized API operations. It does not eliminate the need to protect the registration token during its validity window.

Do not claim that the runner continues authenticating with the registration token. After successful configuration, the official runner manages its own registration credentials in its protected runner directory. The supplied registration token may expire without disabling the already registered persistent runner.

## Interfaces and Dependencies

The external interface remains the official runner command:

    ./config.sh --unattended --replace --url https://github.com/Divorium --token TOKEN --name gh-runner --work _work

The user-visible installer interface changes from a PAT prompt to a runner registration-token prompt. No command-line argument or environment variable is added to `install.sh`; it continues to accept no arguments.

The current GitHub references for this contract are:

- [Adding self-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners), which states that the configuration script requires an automatically generated time-limited token and that the token expires after one hour.
- [REST API endpoints for self-hosted runners](https://docs.github.com/en/rest/actions/self-hosted-runners?apiVersion=2026-03-10#create-a-registration-token-for-an-organization), which identifies the returned value as the registration token passed to `config.sh`. The implementation described by this plan does not call this endpoint; the link establishes terminology and equivalence with the token shown by GitHub's setup UI.
