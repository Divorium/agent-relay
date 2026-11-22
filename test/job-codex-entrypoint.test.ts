import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main } from "../src/run-codex.js";

const names = ["GITHUB_WORKSPACE", "GITHUB_OUTPUT", "CODEX_PLAN_PATH", "CODEX_WORKSPACE_ROOT", "HOME", "RUNNER_TEMP", "CODEX_TRANSCRIPT_PATH", "CODEX_BINARY", "CODEX_HOME", "CODEX_INSTALL_ROOT", "GITHUB_TOKEN", "CODEX_ALLOW_DOCKER", "DOCKER_HOST"];

test("entrypoint forwards job inputs and removes its run state", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-entry-"));
  const workspaceRoot = join(root, "work");
  const workspace = join(workspaceRoot, "repo");
  const home = join(root, "home");
  const temp = join(root, "temp");
  const plan = "docs/exec-plans/active/task.md";
  const output = join(root, "output");
  const record = join(root, "record");
  const launcher = join(root, "fake-launcher");
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    await mkdir(join(workspace, "docs/exec-plans/active"), { recursive: true });
    await mkdir(home); await mkdir(temp);
    await writeFile(join(workspace, plan), "# Verify native job\n");
    await writeFile(output, "");
    await writeFile(launcher, `#!/bin/sh\nset -eu\nprintf '%s\\n' "$CODEX_BINARY" "$CODEX_HOME" "$CODEX_INSTALL_ROOT" "\${GITHUB_TOKEN-unset}" > '${record}'\nprintf '%s\\n' '{"type":"item.completed","item":{"id":"job-fixture","type":"command_execution","command":"fixture","aggregated_output":"","status":"completed","exit_code":0}}'\n`, { mode: 0o700 });
    await chmod(launcher, 0o700);
    for (const name of names) delete process.env[name];
    Object.assign(process.env, {
      GITHUB_WORKSPACE: workspace, CODEX_WORKSPACE_ROOT: workspaceRoot, CODEX_PLAN_PATH: plan,
      GITHUB_OUTPUT: output, HOME: home, RUNNER_TEMP: temp, CODEX_TRANSCRIPT_PATH: join(temp, "log"),
      CODEX_BINARY: "/tools/codex/bin/codex", CODEX_HOME: "/private/auth", CODEX_INSTALL_ROOT: "/tools/codex",
      GITHUB_TOKEN: "synthetic-secret-must-not-reach-child",
    });
    await main(launcher);
    assert.equal(await readFile(record, "utf8"), "/tools/codex/bin/codex\n/private/auth\n/tools/codex\nunset\n");
    assert.equal(await readFile(output, "utf8"), "commit_message=Verify native job\n");
    assert.deepEqual((await readdir(temp)).filter((name) => name.startsWith("agent-relay-runtime-")), []);
    for (const invalid of ["0", "true", " 1", "1\n"]) {
      process.env.CODEX_ALLOW_DOCKER = invalid;
      await assert.rejects(() => main(launcher), /CODEX_ALLOW_DOCKER must be 1 or empty/);
    }
    // Exercise main -> executor -> spawned launcher, including the sandbox arguments.
    await writeFile(launcher, `#!/bin/sh\nset -eu\nprintf '%s\\n' "$CODEX_ALLOW_DOCKER" "$DOCKER_HOST" "$@" > '${record}'\nprintf '%s\\n' '{"type":"item.completed","item":{"id":"docker-fixture","type":"command_execution","command":"fixture","aggregated_output":"","status":"completed","exit_code":0}}'\n`, { mode: 0o700 });
    process.env.CODEX_TRANSCRIPT_PATH = join(temp, "docker-log");
    process.env.CODEX_ALLOW_DOCKER = "1";
    process.env.DOCKER_HOST = "tcp://untrusted:2375";
    await main(launcher);
    const dockerRecord = await readFile(record, "utf8");
    assert.ok(dockerRecord.startsWith("1\nunix:///run/docker.sock\n"));
    assert.ok(dockerRecord.includes('"/run"="write"'));
    assert.ok(!dockerRecord.includes('"/run/docker.sock"='));
    assert.ok(!dockerRecord.includes("untrusted"));
    assert.deepEqual((await readdir(temp)).filter((name) => name.startsWith("agent-relay-runtime-")), []);
    process.env.CODEX_ALLOW_DOCKER = "";
    delete process.env.CODEX_HOME;
    await assert.rejects(() => main(launcher), /CODEX_HOME is required/);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
