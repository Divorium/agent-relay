import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

function runProcess(
  command: string,
  args: string[],
  options: Record<string, unknown>,
): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: unknown) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk: unknown) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code: number | null) => resolve({ status: code ?? 1, stdout, stderr }));
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function createFakeCommands(directory: string, names: string[]): Promise<void> {
  await mkdir(directory, { recursive: true });
  for (const name of names) {
    const path = join(directory, name);
    let output = `${name} test-version`;
    if (name === "node") output = "v22.20.0";
    if (name === "tsc") output = "Version 5.8.3";
    if (name === "codex") output = "codex-cli 0.144.4";
    if (name === "go") output = "go version go1.24.5 linux/amd64";
    if (name === "java") output = 'openjdk version "21.0.1"';
    const source = name === "head"
      ? `#!/bin/bash
set -euo pipefail
printf '%s %s\n' "${name}" "$*" >> "\${FAKE_COMMAND_LOG:?}"
exec /usr/bin/head "$@"
`
      : `#!/bin/bash
set -euo pipefail
printf '%s %s\n' "${name}" "$*" >> "\${FAKE_COMMAND_LOG:?}"
printf '%s\n' '${output}'
`;
    await writeFile(path, source, { mode: 0o700 });
    await chmod(path, 0o700);
  }
}

test("codex-run preserves real home state and exposes only its explicit environment", async () => {
  const root = join(tmpdir(), `agent-relay-codex-run-${process.pid}-${Date.now()}`);
  const home = join(root, "home");
  const runtimeRoot = join(home, ".cache", "agent-relay-runtime");
  const auth = join(home, ".codex", "auth.json");
  const runnerState = join(home, ".local", "share", "actions-runner", ".runner");
  const sourceState = join(home, "source", "keep.txt");
  const unrelatedWorkspace = join(home, "other-workspace", "keep.txt");
  const invocationLog = join(root, "invocation.log");
  const fakeCodex = join(root, "fake-codex");
  const launcher = join(root, "codex-run");

  await mkdir(join(home, ".codex"), { recursive: true });
  await mkdir(join(home, ".local", "share", "actions-runner"), { recursive: true });
  await mkdir(join(home, "source"), { recursive: true });
  await mkdir(join(home, "other-workspace"), { recursive: true });
  await writeFile(auth, "auth\n");
  await writeFile(runnerState, "runner\n");
  await writeFile(sourceState, "source\n");
  await writeFile(unrelatedWorkspace, "workspace\n");
  await writeFile(fakeCodex, `#!/bin/bash
set -euo pipefail
{
  printf 'HOME=%s\n' "\${HOME:-}"
  printf 'USER=%s\n' "\${USER:-}"
  printf 'CARGO_HOME=%s\n' "\${CARGO_HOME:-}"
  printf 'TMPDIR=%s\n' "\${TMPDIR:-}"
  printf 'GIT_OPTIONAL_LOCKS=%s\n' "\${GIT_OPTIONAL_LOCKS:-}"
  printf 'LEAK=%s\n' "\${LEAK_ME:-}"
  printf 'ARGS=%s\n' "$*"
} > "${invocationLog}"
`, { mode: 0o700 });
  await chmod(fakeCodex, 0o700);

  const launcherSource = (await readFile(join(process.cwd(), "scripts", "codex-run"), "utf8"))
    .replace("/usr/local/bin/codex", fakeCodex);
  await writeFile(launcher, launcherSource, { mode: 0o700 });
  await chmod(launcher, 0o700);

  try {
    const result = await runProcess("/bin/bash", [launcher, "--model", "test-model"], {
      cwd: root,
      env: {
        ...process.env,
        HOME: home,
        CODEX_RUNTIME_ROOT: runtimeRoot,
        LEAK_ME: "must-not-cross-boundary",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(auth, "utf8"), "auth\n");
    assert.equal(await readFile(runnerState, "utf8"), "runner\n");
    assert.equal(await readFile(sourceState, "utf8"), "source\n");
    assert.equal(await readFile(unrelatedWorkspace, "utf8"), "workspace\n");
    assert.deepEqual(await readdir(runtimeRoot), []);

    const invocation = await readFile(invocationLog, "utf8");
    assert.match(invocation, new RegExp(`HOME=${escapeRegExp(home)}`));
    assert.match(invocation, /CARGO_HOME=.*\/cargo/);
    assert.match(invocation, /TMPDIR=.*\/tmp/);
    assert.match(invocation, /GIT_OPTIONAL_LOCKS=0/);
    assert.match(invocation, /LEAK=\n/);
    assert.match(invocation, /ARGS=--model test-model/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("codex-run rejects missing authentication before launching Codex", async () => {
  const root = join(tmpdir(), `agent-relay-codex-auth-${process.pid}-${Date.now()}`);
  const home = join(root, "home");
  const runtimeRoot = join(home, ".cache", "agent-relay-runtime");
  const marker = join(root, "executed");
  const fakeCodex = join(root, "fake-codex");
  const launcher = join(root, "codex-run");
  await mkdir(home, { recursive: true });
  await writeFile(fakeCodex, `#!/bin/bash\nprintf executed > "${marker}"\n`, { mode: 0o700 });
  await chmod(fakeCodex, 0o700);
  await writeFile(
    launcher,
    (await readFile(join(process.cwd(), "scripts", "codex-run"), "utf8")).replace("/usr/local/bin/codex", fakeCodex),
    { mode: 0o700 },
  );
  await chmod(launcher, 0o700);
  try {
    const result = await runProcess("/bin/bash", [launcher], {
      cwd: root,
      env: { ...process.env, HOME: home, CODEX_RUNTIME_ROOT: runtimeRoot },
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Codex authentication is missing/);
    await assert.rejects(readFile(marker, "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("toolchain smoke validates retained pins and the Codex permission profile", async () => {
  const root = join(tmpdir(), `agent-relay-toolchain-${process.pid}-${Date.now()}`);
  const bin = join(root, "bin");
  const log = join(root, "commands.log");
  const script = join(process.cwd(), "scripts", "toolchain-smoke.sh");
  const commands = [
    "node", "npm", "tsc", "python3", "java", "rustc", "cargo", "go", "git", "gcc", "g++", "clang",
    "make", "cmake", "pkg-config", "bash", "curl", "wget", "jq", "zip", "unzip", "tar", "gzip",
    "xz", "zstd", "rsync", "file", "find", "diff", "codex", "head", "ssh", "dotnet",
  ];
  await createFakeCommands(bin, commands);
  await writeFile(log, "");

  try {
    const result = await runProcess("/bin/bash", [script], {
      cwd: root,
      env: {
        PATH: bin,
        EXPECTED_TYPESCRIPT_VERSION: "5.8.3",
        EXPECTED_CODEX_VERSION: "0.144.4",
        EXPECTED_GO_VERSION: "1.24.5",
        FAKE_COMMAND_LOG: log,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(result.status, 0, result.stderr);
    const invocations = await readFile(log, "utf8");
    for (const command of commands.filter((name) => !["ssh", "dotnet"].includes(name))) {
      assert.match(invocations, new RegExp(`^${escapeRegExp(command)} `, "m"));
    }
    assert.doesNotMatch(invocations, /^ssh |^dotnet /m);
    assert.match(invocations, /^codex --ask-for-approval never exec --help$/m);

    const profileInvocation = invocations.split("\n").find((line) => line.includes("permissions.agent.filesystem="));
    if (!profileInvocation) throw new Error("Codex profile invocation was not recorded");
    const smokeRoot = /exec --cd (\/tmp\/agent-relay-smoke\.[A-Za-z0-9]+) --help$/.exec(profileInvocation)?.[1];
    if (!smokeRoot) throw new Error("Codex profile invocation did not contain the private smoke workspace");
    assert.match(
      profileInvocation,
      new RegExp(
        `^codex --ask-for-approval never -c features\\.memories=false -c default_permissions="agent" -c permissions\\.agent\\.extends=":workspace" -c permissions\\.agent\\.filesystem=\\{"/tmp"="deny","${escapeRegExp(smokeRoot)}"="write"\\} -c permissions\\.agent\\.network\\.enabled=true exec --cd ${escapeRegExp(smokeRoot)} --help$`,
      ),
    );
    await assert.rejects(stat(smokeRoot), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
