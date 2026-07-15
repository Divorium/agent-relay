import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

function run(cwd: string, command: string, args: string[], env?: Record<string, string>): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test("runner finalize script commits and pushes to the requested branch", async () => {
  const root = join(tmpdir(), `agent-relay-finalize-${process.pid}-${Date.now()}`);
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  const workspace = join(root, "workspace");
  const verification = join(root, "verification");
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

  try {
    await writeFile(join(workspace, "tracked.txt"), "after\n");
    run(workspace, "bash", [join(process.cwd(), "runner", "finalize.sh")], {
      GITHUB_WORKSPACE: workspace,
      TARGET_BRANCH: branch,
      COMMIT_MESSAGE: "Apply controlled runner changes",
      GITHUB_PUSH_TOKEN: "unused-for-local-remote",
    });

    run(root, "git", ["clone", "--branch", branch, remote, verification]);
    assert.equal(await readFile(join(verification, "tracked.txt"), "utf8"), "after\n");
    assert.equal(run(verification, "git", ["log", "-1", "--pretty=%s"]).trim(), "Apply controlled runner changes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runner finalize script exits cleanly without publication credentials when nothing changed", async () => {
  const root = join(tmpdir(), `agent-relay-finalize-clean-${process.pid}-${Date.now()}`);
  await mkdir(root, { recursive: true });
  run(root, "git", ["init", "-b", "agent/test-clean"]);
  run(root, "git", ["config", "user.name", "Seed"]);
  run(root, "git", ["config", "user.email", "seed@example.invalid"]);
  await writeFile(join(root, "tracked.txt"), "unchanged\n");
  run(root, "git", ["add", "tracked.txt"]);
  run(root, "git", ["commit", "-m", "Initial state"]);

  try {
    const output = run(root, "bash", [join(process.cwd(), "runner", "finalize.sh")], {
      GITHUB_WORKSPACE: root,
      TARGET_BRANCH: "agent/test-clean",
    });
    assert.match(output, /No changes to commit/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
