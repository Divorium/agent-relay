import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const repositoryRoot = process.cwd();
const resolverPath = join(repositoryRoot, "runner", "resolve-plan.mjs");

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function createPullRequestRepository(planPaths: string[]): Promise<{
  root: string;
  baseSha: string;
  headSha: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "agent-relay-resolve-plan-"));
  run("git", ["init", "--quiet"], root);
  run("git", ["config", "user.name", "Agent Relay Test"], root);
  run("git", ["config", "user.email", "agent-relay-test@example.invalid"], root);
  await writeFile(join(root, "README.md"), "base\n", "utf8");
  run("git", ["add", "README.md"], root);
  run("git", ["commit", "--quiet", "-m", "base"], root);
  const baseSha = run("git", ["rev-parse", "HEAD"], root);

  await writeFile(join(root, "feature.txt"), "head\n", "utf8");
  for (const planPath of planPaths) {
    const absolutePath = join(root, planPath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, "# Test ExecPlan\n", "utf8");
  }
  run("git", ["add", "."], root);
  run("git", ["commit", "--quiet", "-m", "head"], root);
  return { root, baseSha, headSha: run("git", ["rev-parse", "HEAD"], root) };
}

function runResolver(root: string, baseSha: string, headSha: string, outputPath: string) {
  return spawnSync(process.execPath, [resolverPath], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      EVENT_NAME: "pull_request",
      GITHUB_WORKSPACE: root,
      GITHUB_OUTPUT: outputPath,
      BASE_SHA: baseSha,
      HEAD_SHA: headSha,
    },
  });
}

test("a pull request without an active ExecPlan resolves as a successful skip", async () => {
  const repository = await createPullRequestRepository([]);
  const outputPath = join(repository.root, "github-output.txt");
  try {
    const result = runResolver(repository.root, repository.baseSha, repository.headSha, outputPath);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(await readFile(outputPath, "utf8"), "plan_found=false\nplan_path=\n");
  } finally {
    await rm(repository.root, { recursive: true, force: true });
  }
});

test("a pull request with one active ExecPlan resolves that plan", async () => {
  const planPath = "docs/exec-plans/active/2026-07-20-test-plan.md";
  const repository = await createPullRequestRepository([planPath]);
  const outputPath = join(repository.root, "github-output.txt");
  try {
    const result = runResolver(repository.root, repository.baseSha, repository.headSha, outputPath);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(outputPath, "utf8"), `plan_found=true\nplan_path=${planPath}\n`);
  } finally {
    await rm(repository.root, { recursive: true, force: true });
  }
});

test("a pull request with multiple active ExecPlans remains an error", async () => {
  const repository = await createPullRequestRepository([
    "docs/exec-plans/active/2026-07-20-first.md",
    "docs/exec-plans/active/2026-07-20-second.md",
  ]);
  const outputPath = join(repository.root, "github-output.txt");
  try {
    const result = runResolver(repository.root, repository.baseSha, repository.headSha, outputPath);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Expected exactly one added or modified active ExecPlan, found 2/u);
  } finally {
    await rm(repository.root, { recursive: true, force: true });
  }
});

test("the Codex workflow skips execution and finalization when no plan was found", async () => {
  const workflow = await readFile(join(repositoryRoot, ".github", "workflows", "codex.yml"), "utf8");
  assert.match(workflow, /No active ExecPlan was found in this pull request\. Codex execution was skipped\./u);
  assert.match(workflow, /if: steps\.plan\.outputs\.plan_found == 'true'\n        continue-on-error: true/u);
  assert.match(workflow, /always\(\) && steps\.plan\.outputs\.plan_found == 'true'/u);
  assert.match(workflow, /steps\.plan\.outputs\.plan_found == 'true' && steps\.codex\.outcome == 'success'/u);
});
