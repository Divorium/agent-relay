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

function fakeCommandSource(name: string, output: string): string {
  if (name === "head") {
    return `#!/bin/bash
set -euo pipefail
printf '%s %s\n' "${name}" "$*" >> "\${FAKE_HEAD_LOG:?}"
exec /usr/bin/head "$@"
`;
  }
  return `#!/bin/bash
set -euo pipefail
printf '%s %s\n' "${name}" "$*" >> "\${FAKE_COMMAND_LOG:?}"
printf '%s\n' '${output}'
`;
}

async function createFakeCommand(directory: string, name: string, output?: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const outputs: Record<string, string> = {
    node: "v22.20.0",
    tsc: "Version 5.8.3",
    codex: "codex-cli 0.144.4",
    go: "go version go1.24.5 linux/amd64",
    java: 'openjdk version "21.0.1"',
    rustc: "rustc 1.90.0 (mock)",
    cargo: "cargo 1.90.0 (mock)",
    rustup: "stable-x86_64-unknown-linux-gnu (default)",
  };
  const path = join(directory, name);
  await writeFile(path, fakeCommandSource(name, output ?? outputs[name] ?? `${name} test-version`), { mode: 0o700 });
  await chmod(path, 0o700);
}

async function copyToolchainProfile(targetDirectory: string): Promise<void> {
  await writeFile(
    join(targetDirectory, "toolchain-environment.sh"),
    await readFile(join(process.cwd(), "scripts", "toolchain-environment.sh"), "utf8"),
    { mode: 0o600 },
  );
}

test("codex-run preserves real state and routes tool state into one private runtime", async () => {
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
  printf 'LOGNAME=%s\n' "\${LOGNAME:-}"
  printf 'SHELL=%s\n' "\${SHELL:-}"
  printf 'LANG=%s\n' "\${LANG:-}"
  printf 'LC_ALL=%s\n' "\${LC_ALL:-}"
  printf 'JAVA_HOME=%s\n' "\${JAVA_HOME:-}"
  printf 'CARGO_HOME=%s\n' "\${CARGO_HOME:-}"
  printf 'RUSTUP_HOME=%s\n' "\${RUSTUP_HOME:-}"
  printf 'GOPATH=%s\n' "\${GOPATH:-}"
  printf 'GOCACHE=%s\n' "\${GOCACHE:-}"
  printf 'NPM_CONFIG_CACHE=%s\n' "\${NPM_CONFIG_CACHE:-}"
  printf 'PIP_CACHE_DIR=%s\n' "\${PIP_CACHE_DIR:-}"
  printf 'GRADLE_USER_HOME=%s\n' "\${GRADLE_USER_HOME:-}"
  printf 'XDG_CACHE_HOME=%s\n' "\${XDG_CACHE_HOME:-}"
  printf 'XDG_CONFIG_HOME=%s\n' "\${XDG_CONFIG_HOME:-}"
  printf 'XDG_DATA_HOME=%s\n' "\${XDG_DATA_HOME:-}"
  printf 'GIT_CONFIG_GLOBAL=%s\n' "\${GIT_CONFIG_GLOBAL:-}"
  printf 'TMPDIR=%s\n' "\${TMPDIR:-}"
  printf 'TMP=%s\n' "\${TMP:-}"
  printf 'TEMP=%s\n' "\${TEMP:-}"
  printf 'PATH=%s\n' "\${PATH:-}"
  printf 'GIT_OPTIONAL_LOCKS=%s\n' "\${GIT_OPTIONAL_LOCKS:-}"
  printf 'LEAK=%s\n' "\${LEAK_ME:-}"
  printf 'ARGS=%s\n' "$*"
} > "${invocationLog}"
`, { mode: 0o700 });
  await chmod(fakeCodex, 0o700);
  await copyToolchainProfile(root);

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
    assert.match(invocation, new RegExp(`USER=${escapeRegExp(process.env.USER ?? "")}`));
    assert.match(invocation, /LOGNAME=.+/);
    assert.match(invocation, /SHELL=\/bin\/bash/);
    assert.match(invocation, /LANG=C\.UTF-8/);
    assert.match(invocation, /LC_ALL=C\.UTF-8/);
    assert.match(invocation, /JAVA_HOME=\/opt\/java\/openjdk/);
    assert.match(invocation, /CARGO_HOME=.*\/cargo/);
    assert.match(invocation, /RUSTUP_HOME=\/opt\/rust\/rustup/);
    assert.match(invocation, /GOPATH=.*\/go/);
    assert.match(invocation, /GOCACHE=.*\/go-cache/);
    assert.match(invocation, /NPM_CONFIG_CACHE=.*\/npm/);
    assert.match(invocation, /PIP_CACHE_DIR=.*\/pip/);
    assert.match(invocation, /GRADLE_USER_HOME=.*\/gradle/);
    assert.match(invocation, /XDG_CACHE_HOME=.*\/cache/);
    assert.match(invocation, /XDG_CONFIG_HOME=.*\/config/);
    assert.match(invocation, /XDG_DATA_HOME=.*\/data/);
    assert.match(invocation, /GIT_CONFIG_GLOBAL=\/dev\/null/);
    assert.match(invocation, /TMPDIR=.*\/tmp/);
    assert.match(invocation, /TMP=.*\/tmp/);
    assert.match(invocation, /TEMP=.*\/tmp/);
    assert.match(invocation, /PATH=\/opt\/java\/openjdk\/bin:\/usr\/local\/go\/bin:\/opt\/rust\/cargo\/bin:\/usr\/local\/bin:\/usr\/bin:\/bin/);
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
  await copyToolchainProfile(root);
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

test("toolchain smoke validates retained pins and the complete environment profile", async () => {
  const root = join(tmpdir(), `agent-relay-toolchain-${process.pid}-${Date.now()}`);
  const scripts = join(root, "scripts");
  const bin = join(root, "bin");
  const javaHome = join(root, "java");
  const goRoot = join(root, "go-root");
  const rustCargoHome = join(root, "rust-cargo");
  const rustupHome = join(root, "rustup");
  const stateRoot = join(root, "state");
  const home = join(root, "home");
  const log = join(root, "commands.log");
  const headLog = join(root, "head.log");
  const stateDirectories = ["cargo", "go", "go-cache", "gradle", "npm", "pip", "cache", "config", "data", "tmp"];
  const generalCommands = [
    "node", "npm", "tsc", "python3", "git", "gcc", "g++", "clang", "make", "cmake", "pkg-config",
    "bash", "curl", "wget", "jq", "zip", "unzip", "tar", "gzip", "xz", "zstd", "rsync", "file",
    "find", "diff", "codex", "head", "ssh", "dotnet",
  ];

  await mkdir(scripts, { recursive: true });
  await mkdir(home, { recursive: true });
  await mkdir(rustupHome, { recursive: true });
  for (const stateDirectory of stateDirectories) await mkdir(join(stateRoot, stateDirectory), { recursive: true });
  for (const command of generalCommands) await createFakeCommand(bin, command);
  await createFakeCommand(join(javaHome, "bin"), "java");
  await createFakeCommand(join(goRoot, "bin"), "go");
  await createFakeCommand(join(rustCargoHome, "bin"), "rustc");
  await createFakeCommand(join(rustCargoHome, "bin"), "cargo");
  await createFakeCommand(join(rustCargoHome, "bin"), "rustup");
  await writeFile(log, "");
  await writeFile(headLog, "");

  const profile = (await readFile(join(process.cwd(), "scripts", "toolchain-environment.sh"), "utf8"))
    .replace("TOOLCHAIN_JAVA_HOME=/opt/java/openjdk", `TOOLCHAIN_JAVA_HOME=${javaHome}`)
    .replace("TOOLCHAIN_GO_ROOT=/usr/local/go", `TOOLCHAIN_GO_ROOT=${goRoot}`)
    .replace("TOOLCHAIN_RUST_CARGO_HOME=/opt/rust/cargo", `TOOLCHAIN_RUST_CARGO_HOME=${rustCargoHome}`)
    .replace("TOOLCHAIN_RUSTUP_HOME=/opt/rust/rustup", `TOOLCHAIN_RUSTUP_HOME=${rustupHome}`)
    .replace("TOOLCHAIN_SYSTEM_PATH=/usr/local/bin:/usr/bin:/bin", `TOOLCHAIN_SYSTEM_PATH=${bin}:/usr/bin:/bin`);
  await writeFile(join(scripts, "toolchain-environment.sh"), profile, { mode: 0o600 });
  await writeFile(
    join(scripts, "toolchain-smoke.sh"),
    (await readFile(join(process.cwd(), "scripts", "toolchain-smoke.sh"), "utf8"))
      .replace("/tmp/agent-relay-smoke.XXXXXX", `${join(stateRoot, "tmp")}/agent-relay-smoke.XXXXXX`),
    { mode: 0o700 },
  );

  const environment = {
    HOME: home,
    USER: "test-user",
    LOGNAME: "test-user",
    SHELL: "/bin/bash",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    JAVA_HOME: javaHome,
    RUSTUP_HOME: rustupHome,
    CARGO_HOME: join(stateRoot, "cargo"),
    GOPATH: join(stateRoot, "go"),
    GOCACHE: join(stateRoot, "go-cache"),
    GRADLE_USER_HOME: join(stateRoot, "gradle"),
    NPM_CONFIG_CACHE: join(stateRoot, "npm"),
    PIP_CACHE_DIR: join(stateRoot, "pip"),
    XDG_CACHE_HOME: join(stateRoot, "cache"),
    XDG_CONFIG_HOME: join(stateRoot, "config"),
    XDG_DATA_HOME: join(stateRoot, "data"),
    TMPDIR: join(stateRoot, "tmp"),
    TMP: join(stateRoot, "tmp"),
    TEMP: join(stateRoot, "tmp"),
    PATH: `${javaHome}/bin:${goRoot}/bin:${rustCargoHome}/bin:${bin}:/usr/bin:/bin`,
    EXPECTED_TYPESCRIPT_VERSION: "5.8.3",
    EXPECTED_CODEX_VERSION: "0.144.4",
    EXPECTED_GO_VERSION: "1.24.5",
    EXPECTED_TOOLCHAIN_STATE_ROOT: stateRoot,
    FAKE_COMMAND_LOG: log,
    FAKE_HEAD_LOG: headLog,
  };

  try {
    const result = await runProcess("/bin/bash", [join(scripts, "toolchain-smoke.sh")], {
      cwd: root,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(result.status, 0, result.stderr);
    const invocations = await readFile(log, "utf8");
    const expectedCommands = [...generalCommands, "java", "go", "rustc", "cargo", "rustup"]
      .filter((name) => !["head", "ssh", "dotnet"].includes(name));
    for (const command of expectedCommands) {
      assert.match(invocations, new RegExp(`^${escapeRegExp(command)} `, "m"));
    }
    assert.equal(await readFile(headLog, "utf8"), "head -n 1\n");
    assert.doesNotMatch(invocations, /^ssh |^dotnet /m);
    assert.match(invocations, /^rustup show active-toolchain$/m);
    assert.match(invocations, /^codex --ask-for-approval never exec --help$/m);

    const profileInvocation = invocations.split("\n").find((line) => line.includes("permissions.agent.filesystem="));
    if (!profileInvocation) throw new Error("Codex profile invocation was not recorded");
    const smokeRoot = new RegExp(`exec --cd (${escapeRegExp(join(stateRoot, "tmp"))}\/agent-relay-smoke\\.[A-Za-z0-9]+) --help$`).exec(profileInvocation)?.[1];
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
