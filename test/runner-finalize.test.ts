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

test("runner finalize script refuses to commit relay artifacts", async () => {
  const root = join(tmpdir(), `agent-relay-finalize-artifact-${process.pid}-${Date.now()}`);
  const workspace = join(root, "workspace");
  await mkdir(join(workspace, ".agent-relay"), { recursive: true });
  run(root, "git", ["init", "-b", "agent/test-artifact", workspace]);
  run(workspace, "git", ["config", "user.name", "Seed"]);
  run(workspace, "git", ["config", "user.email", "seed@example.invalid"]);
  await writeFile(join(workspace, "tracked.txt"), "before\n");
  run(workspace, "git", ["add", "tracked.txt"]);
  run(workspace, "git", ["commit", "-m", "Initial state"]);
  await writeFile(join(workspace, ".agent-relay", "result.json"), "{}\n");

  try {
    const result = spawnSync("bash", [join(process.cwd(), "runner", "finalize.sh")], {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_WORKSPACE: workspace,
        TARGET_BRANCH: "agent/test-artifact",
        COMMIT_MESSAGE: "Must not commit artifact",
        GITHUB_PUSH_TOKEN: "unused-for-artifact-check",
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Relay artifact must not be committed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
