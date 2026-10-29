import test from "node:test";
import assert from "node:assert/strict";
import { createCodexArgs, createCodexEnvironment } from "../src/execution/codex-executor.js";

const job = {
  binary: "/tools/codex/0.164.0/bin/codex",
  home: "/runner/temp/codex-auth",
  installRoot: "/tools/codex/0.164.0",
};

test("job CLI inputs survive environment sanitization without inherited secrets", () => {
  const env = Reflect.apply(createCodexEnvironment, undefined, ["/runner/home", "/runner/temp/run", job]);
  assert.deepEqual(env, {
    HOME: "/runner/home",
    CODEX_RUNTIME_ROOT: "/runner/temp/run",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    CODEX_BINARY: job.binary,
    CODEX_HOME: job.home,
    CODEX_INSTALL_ROOT: job.installRoot,
  });
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.CODEX_TOKEN, undefined);
});

test("job authentication is denied and installed CLI is read-only to commands", () => {
  const args: string[] = Reflect.apply(createCodexArgs, undefined, [
    "/runner/work/repo", "task", "/runner/home", "/runner/temp/run", "/trusted/relay", job,
  ]);
  const policy = args.find((value) => value.startsWith("permissions.agent.filesystem=")) ?? "";
  assert.ok(policy);
  assert.ok(policy.includes('"/runner/home"="deny"'));
  assert.ok(policy.includes('"/runner/temp/codex-auth"="deny"'));
  assert.ok(policy.includes('"/tools/codex/0.164.0"="read"'));
  assert.ok(policy.includes('"/runner/work/repo/.git"="read"'));
  assert.ok(!args.includes("--dangerously-bypass-approvals-and-sandbox"));
});
