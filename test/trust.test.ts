import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexExecutor, createCodexArgs } from "../src/execution/codex-executor.js";

const trustedRoot = "/srv/github-runner/storage/work";
const trustedWorkspace = `${trustedRoot}/repository/repository`;

test("Codex trusts the exact workspace before first execution", () => {
  const args = createCodexArgs(
    trustedWorkspace,
    "prompt",
    `${trustedRoot}/repository`,
    "/srv/github-runner/storage/home",
    "/srv/github-runner/storage/home/.cache/agent-relay-runtime",
    "/srv/github-runner/storage/agent-relay",
  );
  const trust = `projects={${JSON.stringify(trustedWorkspace)}={trust_level="trusted"}}`;
  assert.ok(args.includes(trust));
  assert.ok(args.indexOf(trust) < args.indexOf("exec"));
  assert.equal(args.filter((value) => value.includes("trust_level")).length, 1);
  assert.ok(!args.some((value) => value.includes("untrusted")));
});

test("Codex trust override safely quotes the canonical workspace path", () => {
  const workspace = `${trustedRoot}/repo with \"quote\"/repo`;
  const args = createCodexArgs(workspace, "prompt", trustedRoot, "/home/runner", "/home/runner/runtime", "/srv/source");
  assert.ok(args.includes(`projects={${JSON.stringify(workspace)}={trust_level="trusted"}}`));
});

test("CodexExecutor passes trusted workspace configuration to the launcher", async () => {
  const root = join(tmpdir(), `agent-relay-trust-${process.pid}-${Date.now()}`);
  const workspaceRoot = join(root, "storage", "work");
  const workspace = join(workspaceRoot, "repository", "repository");
  const home = join(root, "home");
  const runtimeRoot = join(home, ".cache", "agent-relay-runtime");
  const log = join(root, "args.log");
  const fakeCodex = join(root, "fake-codex");
  await mkdir(join(workspace, "docs", "exec-plans", "active"), { recursive: true });
  await mkdir(join(workspace, ".git"), { recursive: true });
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(join(workspace, "docs", "exec-plans", "active", "plan.md"), "# Plan\n");
  await writeFile(fakeCodex, `#!/bin/sh\nset -eu\nprintf '%s\\n' "$@" > "${log}"\n`, { mode: 0o700 });
  await chmod(fakeCodex, 0o700);
  try {
    const executor = new CodexExecutor(fakeCodex, 5_000, 100_000, workspaceRoot, home, runtimeRoot, "/srv/source");
    await executor.run("docs/exec-plans/active/plan.md", workspace);
    const args = (await readFile(log, "utf8")).trim().split("\n");
    assert.ok(args.includes(`projects={${JSON.stringify(workspace)}={trust_level="trusted"}}`));
    assert.ok(args.includes("exec"));
    assert.ok(args.includes("--cd"));
    assert.ok(args.includes(workspace));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
