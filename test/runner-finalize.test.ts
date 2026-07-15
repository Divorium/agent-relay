import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

function runResult(cwd: string, command: string, args: string[], env?: Record<string, string>) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function run(cwd: string, command: string, args: string[], env?: Record<string, string>): string {
  const result = runResult(cwd, command, args, env);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

async function repositoryFixture(name: string) {
  const root = join(tmpdir(), `agent-relay-finalize-${name}-${process.pid}-${Date.now()}-${Math.random()}`);
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  const workspace = join(root, "workspace");
  const branch = "agent/test-flow";
  await mkdir(root, { recursive: true });
  run(root, "git", ["init", "--bare", remote]);
  run(root, "git", ["init", "-b", branch, seed]);
  run(seed, "git", ["config", "user.name", "Seed"]);
  run(seed, "git", ["config", "user.email", "seed@example.invalid"]);
  await writeFile(join(seed, "tracked.txt"), "before\n");
  run(seed, "git", ["add", "tracked.txt"]);
  run(seed, "git", ["commit", "-m", "Initial state"]);
  run(seed, "git", ["remote", "add", "origin", remote]);
  run(seed, "git", ["push", "-u", "origin", branch]);
  run(root, "git", ["clone", "--branch", branch, remote, workspace]);
  return { root, remote, workspace, branch };
}

function finalizeEnv(workspace: string, branch: string, message = "Apply controlled runner changes") {
  return {
    GITHUB_WORKSPACE: workspace,
    TARGET_BRANCH: branch,
    COMMIT_MESSAGE: message,
    GITHUB_PUSH_TOKEN: "unused-for-local-remote",
  };
}

test("runner finalize script commits and pushes to the requested branch", async () => {
  const current = await repositoryFixture("success");
  const verification = join(current.root, "verification");
  try {
    await writeFile(join(current.workspace, "tracked.txt"), "after\n");
    run(current.workspace, "bash", [join(process.cwd(), "runner", "finalize.sh")], finalizeEnv(current.workspace, current.branch));

    run(current.root, "git", ["clone", "--branch", current.branch, current.remote, verification]);
    assert.equal(await readFile(join(verification, "tracked.txt"), "utf8"), "after\n");
    assert.equal(run(verification, "git", ["log", "-1", "--pretty=%s"]).trim(), "Apply controlled runner changes");
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});

test("runner finalize script exits cleanly without publication credentials when nothing changed", async () => {
  const current = await repositoryFixture("clean");
  try {
    const output = run(current.workspace, "bash", [join(process.cwd(), "runner", "finalize.sh")], {
      GITHUB_WORKSPACE: current.workspace,
      TARGET_BRANCH: current.branch,
    });
    assert.match(output, /No changes to commit/);
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});

test("runner finalize rejects invalid branches and commit messages before committing", async (t: any) => {
  for (const currentCase of [
    { name: "invalid branch", branch: "bad branch", message: "Valid message", expected: /not a valid branch name|invalid branch/i },
    { name: "control character", branch: "agent/test-flow", message: "Bad\tmessage", expected: /control characters/ },
    { name: "overlong message", branch: "agent/test-flow", message: "x".repeat(121), expected: /at most 120/ },
    { name: "overlong Unicode message", branch: "agent/test-flow", message: "🚀".repeat(121), expected: /at most 120/ },
  ]) {
    await t.test(currentCase.name, async () => {
      const current = await repositoryFixture(`validation-${currentCase.name}`);
      try {
        await writeFile(join(current.workspace, "tracked.txt"), "after\n");
        const before = run(current.workspace, "git", ["rev-parse", "HEAD"]).trim();
        const result = runResult(current.workspace, "bash", [join(process.cwd(), "runner", "finalize.sh")], finalizeEnv(
          current.workspace,
          currentCase.branch,
          currentCase.message,
        ));
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, currentCase.expected);
        assert.equal(run(current.workspace, "git", ["rev-parse", "HEAD"]).trim(), before);
      } finally {
        await rm(current.root, { recursive: true, force: true });
      }
    });
  }
});

test("runner finalize accepts a 120-character Unicode commit message", async () => {
  const current = await repositoryFixture("unicode-message");
  try {
    await writeFile(join(current.workspace, "tracked.txt"), "after\n");
    const message = "🚀".repeat(120);
    run(current.workspace, "bash", [join(process.cwd(), "runner", "finalize.sh")], finalizeEnv(current.workspace, current.branch, message));
    assert.equal(run(current.workspace, "git", ["log", "-1", "--pretty=%s"]).trim(), message);
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});

test("runner finalize rejects whitespace errors before committing", async () => {
  const current = await repositoryFixture("diff-check");
  try {
    await writeFile(join(current.workspace, "tracked.txt"), "trailing whitespace   \n");
    const before = run(current.workspace, "git", ["rev-parse", "HEAD"]).trim();
    const result = runResult(current.workspace, "bash", [join(process.cwd(), "runner", "finalize.sh")], finalizeEnv(current.workspace, current.branch));
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /trailing whitespace/);
    assert.equal(run(current.workspace, "git", ["rev-parse", "HEAD"]).trim(), before);
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});

test("runner finalize restores working-tree changes after a rejected push and can be retried", async () => {
  const current = await repositoryFixture("push-retry");
  const hook = join(current.remote, "hooks", "pre-receive");
  const verification = join(current.root, "verification");
  try {
    await writeFile(hook, "#!/bin/sh\nexit 1\n", { mode: 0o700 });
    await chmod(hook, 0o700);
    await writeFile(join(current.workspace, "tracked.txt"), "after\n");
    const before = run(current.workspace, "git", ["rev-parse", "HEAD"]).trim();

    const failed = runResult(current.workspace, "bash", [join(process.cwd(), "runner", "finalize.sh")], finalizeEnv(current.workspace, current.branch));
    assert.notEqual(failed.status, 0);
    assert.equal(run(current.workspace, "git", ["rev-parse", "HEAD"]).trim(), before);
    assert.match(run(current.workspace, "git", ["status", "--porcelain"]), /tracked\.txt/);
    assert.equal(await readFile(join(current.workspace, "tracked.txt"), "utf8"), "after\n");

    await rm(hook);
    run(current.workspace, "bash", [join(process.cwd(), "runner", "finalize.sh")], finalizeEnv(current.workspace, current.branch));
    run(current.root, "git", ["clone", "--branch", current.branch, current.remote, verification]);
    assert.equal(await readFile(join(verification, "tracked.txt"), "utf8"), "after\n");
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});
