import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deriveCommitMessage, main } from "../src/run-codex.js";
import { CodexExecutionError } from "../src/execution/errors.js";

const ENVIRONMENT_NAMES = [
  "GITHUB_WORKSPACE",
  "GITHUB_OUTPUT",
  "CODEX_PLAN_PATH",
  "CODEX_WORKSPACE_ROOT",
  "CODEX_TIMEOUT_MS",
  "MAX_OUTPUT_BYTES",
  "HOME",
] as const;

async function createFixture(name: string) {
  const root = join(tmpdir(), `agent-relay-cli-${name}-${process.pid}-${Date.now()}`);
  const workspaceRoot = join(root, "runner", "_work");
  const workspace = join(workspaceRoot, "repository", "repository");
  const active = join(workspace, "docs", "exec-plans", "active");
  const completed = join(workspace, "docs", "exec-plans", "completed");
  const home = join(root, "home");
  const githubOutput = join(root, "github-output");
  const planPath = "docs/exec-plans/active/task.md";
  await mkdir(active, { recursive: true });
  await mkdir(completed, { recursive: true });
  await mkdir(join(workspace, ".git"), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(join(workspace, planPath), "# Implement native runner\n\nPlan body.\n");
  await writeFile(githubOutput, "");
  return { root, workspaceRoot, workspace, active, completed, home, githubOutput, planPath };
}

async function withEnvironment(values: Record<string, string>, run: () => Promise<void>): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const name of ENVIRONMENT_NAMES) previous.set(name, process.env[name]);
  try {
    for (const name of ENVIRONMENT_NAMES) delete process.env[name];
    Object.assign(process.env, values);
    await run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function fixtureEnvironment(fixture: Awaited<ReturnType<typeof createFixture>>): Record<string, string> {
  return {
    GITHUB_WORKSPACE: fixture.workspace,
    GITHUB_OUTPUT: fixture.githubOutput,
    CODEX_PLAN_PATH: fixture.planPath,
    CODEX_WORKSPACE_ROOT: fixture.workspaceRoot,
    HOME: fixture.home,
    CODEX_TIMEOUT_MS: "5000",
    MAX_OUTPUT_BYTES: "100000",
  };
}

test("deriveCommitMessage normalizes and bounds the first H1", () => {
  assert.equal(deriveCommitMessage("text\n#  Apply\tnew\n"), "Apply new");
  assert.equal(deriveCommitMessage("no heading"), "Apply active ExecPlan");
  assert.equal(Array.from(deriveCommitMessage(`# ${"x".repeat(200)}`)).length, 120);
});

test("direct CLI writes the commit message only after successful execution", async () => {
  const fixture = await createFixture("success");
  const executable = join(fixture.root, "fake-codex");
  await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  await chmod(executable, 0o700);
  try {
    await withEnvironment(fixtureEnvironment(fixture), async () => main(executable));
    assert.equal(await readFile(fixture.githubOutput, "utf8"), "commit_message=Implement native runner\n");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("direct CLI derives the message before Codex moves the active plan", async () => {
  const fixture = await createFixture("move");
  const executable = join(fixture.root, "move-plan");
  await writeFile(executable, `#!/bin/sh
set -eu
mv "${join(fixture.workspace, fixture.planPath)}" "${join(fixture.completed, "task.md")}"
`, { mode: 0o700 });
  await chmod(executable, 0o700);
  try {
    await withEnvironment(fixtureEnvironment(fixture), async () => main(executable));
    assert.equal(await readFile(fixture.githubOutput, "utf8"), "commit_message=Implement native runner\n");
    assert.equal(await readFile(join(fixture.completed, "task.md"), "utf8"), "# Implement native runner\n\nPlan body.\n");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("direct CLI does not publish a commit message after Codex failure", async () => {
  const fixture = await createFixture("failure");
  const executable = join(fixture.root, "failing-codex");
  await writeFile(executable, "#!/bin/sh\nexit 7\n", { mode: 0o700 });
  await chmod(executable, 0o700);
  try {
    await withEnvironment(fixtureEnvironment(fixture), async () => {
      await assert.rejects(
        () => main(executable),
        (error: unknown) => error instanceof CodexExecutionError && error.code === "CODEX_FAILED",
      );
    });
    assert.equal(await readFile(fixture.githubOutput, "utf8"), "");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("direct CLI rejects invalid limits and symlink plans before execution", async () => {
  const fixture = await createFixture("validation");
  const executable = join(fixture.root, "must-not-run");
  const marker = join(fixture.root, "executed");
  await writeFile(executable, `#!/bin/sh\nprintf executed > "${marker}"\n`, { mode: 0o700 });
  await chmod(executable, 0o700);
  try {
    await withEnvironment({ ...fixtureEnvironment(fixture), CODEX_TIMEOUT_MS: "0" }, async () => {
      await assert.rejects(
        () => main(executable),
        (error: unknown) => error instanceof CodexExecutionError && error.code === "INVALID_CONFIGURATION",
      );
    });

    await rm(join(fixture.workspace, fixture.planPath));
    await symlink(join(fixture.completed, "missing.md"), join(fixture.workspace, fixture.planPath));
    await withEnvironment(fixtureEnvironment(fixture), async () => {
      await assert.rejects(
        () => main(executable),
        (error: unknown) => error instanceof CodexExecutionError && error.code === "INVALID_PLAN",
      );
    });
    await assert.rejects(readFile(marker, "utf8"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
