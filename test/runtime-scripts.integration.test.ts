import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

function runProcess(command: string, args: string[], options: Record<string, unknown>): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = "", stderr = "";
    child.stdout?.on("data", (chunk: unknown) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk: unknown) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code: number | null) => resolve({ status: code ?? 1, stdout, stderr }));
  });
}
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function fakeCommandSource(name: string, output: string): string {
  if (name === "head") return `#!/bin/bash\nset -euo pipefail\nprintf '%s %s\\n' "${name}" "$*" >> "\${FAKE_HEAD_LOG:?}"\nexec /usr/bin/head "$@"\n`;
  return `#!/bin/bash\nset -euo pipefail\nprintf '%s %s\\n' "${name}" "$*" >> "\${FAKE_COMMAND_LOG:?}"\nprintf '%s\\n' '${output}'\n`;
}
async function createFakeCommand(directory: string, name: string, output?: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const outputs: Record<string, string> = {
    node: "v22.20.0", tsc: "Version 5.8.3", go: "go version go1.24.5 linux/amd64",
    java: 'openjdk version "21.0.1"', rustc: "rustc 1.90.0 (mock)", cargo: "cargo 1.90.0 (mock)",
    rustup: "stable-x86_64-unknown-linux-gnu (default)",
  };
  const path = join(directory, name);
  await writeFile(path, fakeCommandSource(name, output ?? outputs[name] ?? `${name} test-version`), { mode: 0o700 });
  await chmod(path, 0o700);
}
async function copyToolchainProfile(targetDirectory: string): Promise<void> {
  await writeFile(join(targetDirectory, "toolchain-environment.sh"), await readFile(join(process.cwd(), "scripts", "toolchain-environment.sh"), "utf8"), { mode: 0o600 });
}
async function prepareLauncherRuntime(root: string): Promise<{ scripts: string; socketPath: string; closeSocket: () => Promise<void> }> {
  const scripts = join(root, "scripts"), config = join(root, "config"), socketRoot = join(root, "docker-socket");
  const socketPath = join(socketRoot, "docker.sock");
  for (const directory of [scripts, config, socketRoot]) await mkdir(directory, { recursive: true });
  await copyToolchainProfile(scripts);
  await writeFile(join(scripts, "host-config.sh"), await readFile(join(process.cwd(), "scripts", "host-config.sh"), "utf8"), { mode: 0o600 });
  const hostContract = JSON.parse(await readFile(join(process.cwd(), "config", "runner-host.json"), "utf8")) as Record<string, unknown>;
  hostContract.base_root = root;
  hostContract.docker_socket_path = socketPath;
  await writeFile(join(config, "runner-host.json"), `${JSON.stringify(hostContract, null, 2)}\n`, { mode: 0o600 });
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
  return { scripts, socketPath, closeSocket: () => new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); }) };
}

test("codex-run preserves real state and routes tool state into one private runtime", async () => {
  const root = join(tmpdir(), `agent-relay-codex-run-${process.pid}-${Date.now()}`);
  const home = join(root, "home"), runtimeRoot = join(home, ".cache", "agent-relay-runtime");
  const auth = join(home, ".codex", "auth.json"), runnerState = join(home, ".local", "share", "actions-runner", ".runner");
  const sourceState = join(home, "source", "keep.txt"), unrelatedWorkspace = join(home, "other-workspace", "keep.txt");
  const invocationLog = join(root, "invocation.log"), fakeCodex = join(root, "fake-codex"), jobHome = join(root, "job-auth");
  const runtime = await prepareLauncherRuntime(root), launcher = join(runtime.scripts, "codex-run");
  for (const directory of [join(home, ".codex"), join(home, ".local", "share", "actions-runner"), join(home, "source"), join(home, "other-workspace")]) await mkdir(directory, { recursive: true });
  await mkdir(jobHome, { mode: 0o700 });
  await writeFile(join(jobHome, "auth.json"), "job auth\n", { mode: 0o600 });
  await writeFile(auth, "auth\n"); await writeFile(runnerState, "runner\n"); await writeFile(sourceState, "source\n"); await writeFile(unrelatedWorkspace, "workspace\n");
  const keys = ["HOME", "CODEX_HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "JAVA_HOME", "CARGO_HOME", "RUSTUP_HOME", "GOPATH", "GOCACHE", "NPM_CONFIG_CACHE", "PIP_CACHE_DIR", "GRADLE_USER_HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "GIT_CONFIG_GLOBAL", "TMPDIR", "TMP", "TEMP", "DOCKER_CONFIG", "DOCKER_HOST", "TOKEN_MINIFY_RUN_LOG_DIR", "PATH", "GIT_OPTIONAL_LOCKS"];
  const print = keys.map((key) => `  printf '${key}=%s\\n' "\${${key}:-}"`).join("\n");
  await writeFile(fakeCodex, `#!/bin/bash\nset -euo pipefail\n{\n${print}\n  printf 'LEAK=%s\\n' "\${LEAK_ME:-}"\n  printf 'ARGS=%s\\n' "$*"\n} > "${invocationLog}"\n`, { mode: 0o700 });
  await chmod(fakeCodex, 0o700);
  await writeFile(launcher, await readFile(join(process.cwd(), "scripts", "codex-run"), "utf8"), { mode: 0o700 });
  await chmod(launcher, 0o700);
  try {
    const result = await runProcess("/bin/bash", [launcher, "--model", "test-model"], {
      cwd: root, env: { ...process.env, HOME: home, CODEX_RUNTIME_ROOT: runtimeRoot, CODEX_BINARY: fakeCodex, CODEX_HOME: jobHome, CODEX_INSTALL_ROOT: root, LEAK_ME: "must-not-cross-boundary" }, stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(auth, "utf8"), "auth\n");
    assert.equal(await readFile(runnerState, "utf8"), "runner\n");
    assert.equal(await readFile(sourceState, "utf8"), "source\n");
    assert.equal(await readFile(unrelatedWorkspace, "utf8"), "workspace\n");
    assert.deepEqual(await readdir(runtimeRoot), []);
    const invocation = await readFile(invocationLog, "utf8");
    assert.match(invocation, new RegExp(`HOME=${escapeRegExp(home)}`));
    assert.match(invocation, new RegExp(`CODEX_HOME=${escapeRegExp(jobHome)}`));
    assert.match(invocation, new RegExp(`USER=${escapeRegExp(process.env.USER ?? "")}`));
    assert.match(invocation, /LOGNAME=.+/); assert.match(invocation, /SHELL=\/bin\/bash/);
    assert.match(invocation, /LANG=C\.UTF-8/); assert.match(invocation, /LC_ALL=C\.UTF-8/);
    assert.match(invocation, /JAVA_HOME=\/opt\/java\/openjdk/); assert.match(invocation, /RUSTUP_HOME=\/opt\/rust\/rustup/);
    for (const [key, directory] of Object.entries({ CARGO_HOME: "cargo", GOPATH: "go", GOCACHE: "go-cache", NPM_CONFIG_CACHE: "npm", PIP_CACHE_DIR: "pip", GRADLE_USER_HOME: "gradle", XDG_CACHE_HOME: "cache", XDG_CONFIG_HOME: "config", XDG_DATA_HOME: "data", TMPDIR: "tmp", TMP: "tmp", TEMP: "tmp", DOCKER_CONFIG: "docker", TOKEN_MINIFY_RUN_LOG_DIR: "worker-run" })) {
      assert.match(invocation, new RegExp(`${key}=.*\\/${directory}`));
    }
    assert.match(invocation, /GIT_CONFIG_GLOBAL=\/dev\/null/);
    assert.match(invocation, new RegExp(`DOCKER_HOST=unix://${escapeRegExp(runtime.socketPath)}`));
    assert.match(invocation, /PATH=\/opt\/java\/openjdk\/bin:\/usr\/local\/go\/bin:\/opt\/rust\/cargo\/bin:\/usr\/local\/bin:\/usr\/bin:\/bin/);
    assert.match(invocation, /GIT_OPTIONAL_LOCKS=0/); assert.match(invocation, /LEAK=\n/); assert.match(invocation, /ARGS=--model test-model/);
  } finally { await runtime.closeSocket(); await rm(root, { recursive: true, force: true }); }
});

test("codex-run rejects missing authentication before launching Codex", async () => {
  const root = join(tmpdir(), `agent-relay-codex-auth-${process.pid}-${Date.now()}`), home = join(root, "home");
  const runtimeRoot = join(home, ".cache", "agent-relay-runtime"), marker = join(root, "executed"), fakeCodex = join(root, "fake-codex"), jobHome = join(root, "job-auth");
  const runtime = await prepareLauncherRuntime(root), launcher = join(runtime.scripts, "codex-run");
  await mkdir(home, { recursive: true }); await mkdir(jobHome, { mode: 0o700 });
  await writeFile(fakeCodex, `#!/bin/bash\nprintf executed > "${marker}"\n`, { mode: 0o700 });
  await chmod(fakeCodex, 0o700);
  await writeFile(launcher, await readFile(join(process.cwd(), "scripts", "codex-run"), "utf8"), { mode: 0o700 });
  await chmod(launcher, 0o700);
  try {
    const result = await runProcess("/bin/bash", [launcher], { cwd: root, env: { ...process.env, HOME: home, CODEX_RUNTIME_ROOT: runtimeRoot, CODEX_BINARY: fakeCodex, CODEX_HOME: jobHome, CODEX_INSTALL_ROOT: root }, stdio: ["ignore", "pipe", "pipe"] });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Codex authentication must be a private regular file/);
    await assert.rejects(readFile(marker, "utf8"));
  } finally { await runtime.closeSocket(); await rm(root, { recursive: true, force: true }); }
});

test("host toolchain smoke validates the complete environment without global Codex", async () => {
  const root = join(tmpdir(), `agent-relay-toolchain-${process.pid}-${Date.now()}`), scripts = join(root, "scripts"), bin = join(root, "bin");
  const javaHome = join(root, "java"), goRoot = join(root, "go-root"), rustCargoHome = join(root, "rust-cargo"), rustupHome = join(root, "rustup"), stateRoot = join(root, "state"), home = join(root, "home"), log = join(root, "commands.log"), headLog = join(root, "head.log");
  const stateDirectories = ["cargo", "go", "go-cache", "gradle", "npm", "pip", "cache", "config", "data", "tmp", "docker"];
  const generalCommands = ["node", "npm", "tsc", "python3", "git", "gcc", "g++", "clang", "make", "cmake", "pkg-config", "bash", "curl", "wget", "jq", "zip", "unzip", "tar", "gzip", "xz", "zstd", "file", "diff", "head", "ssh", "dotnet"];
  for (const directory of [scripts, home, rustupHome]) await mkdir(directory, { recursive: true });
  for (const directory of stateDirectories) await mkdir(join(stateRoot, directory), { recursive: true });
  for (const command of generalCommands) await createFakeCommand(bin, command);
  await createFakeCommand(join(javaHome, "bin"), "java"); await createFakeCommand(join(goRoot, "bin"), "go");
  for (const command of ["rustc", "cargo", "rustup"]) await createFakeCommand(join(rustCargoHome, "bin"), command);
  await writeFile(log, ""); await writeFile(headLog, "");
  const profile = (await readFile(join(process.cwd(), "scripts", "toolchain-environment.sh"), "utf8"))
    .replace("TOOLCHAIN_JAVA_HOME=/opt/java/openjdk", `TOOLCHAIN_JAVA_HOME=${javaHome}`)
    .replace("TOOLCHAIN_GO_ROOT=/usr/local/go", `TOOLCHAIN_GO_ROOT=${goRoot}`)
    .replace("TOOLCHAIN_RUST_CARGO_HOME=/opt/rust/cargo", `TOOLCHAIN_RUST_CARGO_HOME=${rustCargoHome}`)
    .replace("TOOLCHAIN_RUSTUP_HOME=/opt/rust/rustup", `TOOLCHAIN_RUSTUP_HOME=${rustupHome}`)
    .replace("TOOLCHAIN_SYSTEM_PATH=/usr/local/bin:/usr/bin:/bin", `TOOLCHAIN_SYSTEM_PATH=${bin}:/usr/bin:/bin`);
  await writeFile(join(scripts, "toolchain-environment.sh"), profile, { mode: 0o600 });
  await writeFile(join(scripts, "toolchain-smoke.sh"), await readFile(join(process.cwd(), "scripts", "toolchain-smoke.sh"), "utf8"), { mode: 0o700 });
  const environment = {
    HOME: home, USER: "test-user", LOGNAME: "test-user", SHELL: "/bin/bash", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", JAVA_HOME: javaHome, RUSTUP_HOME: rustupHome,
    CARGO_HOME: join(stateRoot, "cargo"), GOPATH: join(stateRoot, "go"), GOCACHE: join(stateRoot, "go-cache"), GRADLE_USER_HOME: join(stateRoot, "gradle"), NPM_CONFIG_CACHE: join(stateRoot, "npm"), PIP_CACHE_DIR: join(stateRoot, "pip"),
    XDG_CACHE_HOME: join(stateRoot, "cache"), XDG_CONFIG_HOME: join(stateRoot, "config"), XDG_DATA_HOME: join(stateRoot, "data"), TMPDIR: join(stateRoot, "tmp"), TMP: join(stateRoot, "tmp"), TEMP: join(stateRoot, "tmp"), DOCKER_CONFIG: join(stateRoot, "docker"),
    PATH: `${javaHome}/bin:${goRoot}/bin:${rustCargoHome}/bin:${bin}:/usr/bin:/bin`, EXPECTED_TYPESCRIPT_VERSION: "5.8.3", EXPECTED_GO_VERSION: "1.24.5", EXPECTED_TOOLCHAIN_STATE_ROOT: stateRoot, FAKE_COMMAND_LOG: log, FAKE_HEAD_LOG: headLog,
  };
  try {
    const result = await runProcess("/bin/bash", [join(scripts, "toolchain-smoke.sh")], { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    assert.equal(result.status, 0, result.stderr);
    const invocations = await readFile(log, "utf8");
    const expectedCommands = [...generalCommands, "java", "go", "rustc", "cargo", "rustup"].filter((name) => !["head", "ssh", "dotnet"].includes(name));
    for (const command of expectedCommands) assert.match(invocations, new RegExp(`^${escapeRegExp(command)} `, "m"));
    assert.equal(await readFile(headLog, "utf8"), "head -n 1\n");
    assert.doesNotMatch(invocations, /^ssh |^dotnet |^codex /m);
    assert.match(invocations, /^rustup show active-toolchain$/m);
  } finally { await rm(root, { recursive: true, force: true }); }
});
