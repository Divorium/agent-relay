import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
    const source = name === "codex"
      ? `#!/bin/bash
set -euo pipefail
printf '%s %s\n' "${name}" "$*" >> "\${FAKE_COMMAND_LOG:?}"
if [[ "\${1:-}" == "--version" ]]; then
  printf 'codex-cli %s\n' "\${FAKE_CODEX_VERSION:-0.144.3}"
fi
`
      : `#!/bin/bash
set -euo pipefail
printf '%s %s\n' "${name}" "$*" >> "\${FAKE_COMMAND_LOG:?}"
printf '%s test-version\n' "${name}"
`;
    await writeFile(path, source, { mode: 0o700 });
    await chmod(path, 0o700);
  }
}

test("codex-run enforces the agent kernel identity and constructs the isolated Codex invocation", async (t: any) => {
  const root = join(tmpdir(), `agent-relay-codex-run-${process.pid}-${Date.now()}-${Math.random()}`);
  const harness = join(root, "harness.sh");
  const log = join(root, "commands.log");
  const launcher = join(process.cwd(), "scripts", "codex-run");
  await mkdir(root, { recursive: true });

  try {
    await t.test("rejects execution with a different effective UID", async () => {
      const source = `#!/bin/bash
set -euo pipefail
id() {
  case "$*" in
    "-u") printf '2000\\n' ;;
    "-u agent") printf '1000\\n' ;;
    *) return 1 ;;
  esac
}
source "${launcher}"
`;
      await writeFile(harness, source, { mode: 0o700 });
      const result = await runProcess("/bin/bash", [harness], {
        cwd: root,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /must execute as the isolated agent user/);
    });

    await t.test("accepts an alternate passwd name for the same UID and replaces the environment", async () => {
      const source = `#!/bin/bash
set -euo pipefail
COMMAND_LOG="${log}"
id() {
  case "$*" in
    "-u") printf '1000\\n' ;;
    "-u agent") printf '1000\\n' ;;
    "-un") printf 'node\\n' ;;
    *) return 1 ;;
  esac
}
[[ "$(id -un)" == "node" ]]
mkdir() { printf 'mkdir' >> "$COMMAND_LOG"; printf ' <%s>' "$@" >> "$COMMAND_LOG"; printf '\n' >> "$COMMAND_LOG"; }
find() { printf 'find' >> "$COMMAND_LOG"; printf ' <%s>' "$@" >> "$COMMAND_LOG"; printf '\n' >> "$COMMAND_LOG"; }
rm() { printf 'rm' >> "$COMMAND_LOG"; printf ' <%s>' "$@" >> "$COMMAND_LOG"; printf '\n' >> "$COMMAND_LOG"; }
git() { printf 'git' >> "$COMMAND_LOG"; printf ' <%s>' "$@" >> "$COMMAND_LOG"; printf '\n' >> "$COMMAND_LOG"; }
chmod() { printf 'chmod' >> "$COMMAND_LOG"; printf ' <%s>' "$@" >> "$COMMAND_LOG"; printf '\n' >> "$COMMAND_LOG"; }
exec() { printf 'exec' >> "$COMMAND_LOG"; printf ' <%s>' "$@" >> "$COMMAND_LOG"; printf '\n' >> "$COMMAND_LOG"; }
source "${launcher}" --model test-model
`;
      await writeFile(harness, source, { mode: 0o700 });
      const result = await runProcess("/bin/bash", [harness], {
        cwd: root,
        env: {
          ...process.env,
          AGENT_RELAY_TOKEN: "must-not-cross-the-boundary",
          UNRELATED_VARIABLE: "must-not-cross-the-boundary",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      assert.equal(result.status, 0, result.stderr);

      const commands = await readFile(log, "utf8");
      assert.match(commands, /find <\/home\/agent>.*<!>.*<\.cargo>.*<!>.*<\.rustup>.*<!>.*<\.codex>.*<-exec>.*<rm>.*<-rf>.*<-->/s);
      assert.match(commands, /find <\/home\/agent\/\.codex>.*<!>.*<auth\.json>.*<-exec>.*<rm>.*<-rf>.*<-->/s);
      assert.match(commands, /rm <-rf> <--> <\/tmp\/agent-relay-runtime>/);
      assert.match(commands, /git <-C> <\/tmp\/agent-relay-runtime> <init> <--quiet>/);
      assert.match(commands, /exec <\/usr\/bin\/env> <-i>/);
      assert.match(commands, /<HOME=\/home\/agent>/);
      assert.match(commands, /<CARGO_HOME=\/tmp\/agent-relay-runtime\/cargo>/);
      assert.match(commands, /<RUSTUP_HOME=\/home\/agent\/\.rustup>/);
      assert.match(commands, /<GIT_OPTIONAL_LOCKS=0>/);
      assert.match(commands, /<\/usr\/local\/bin\/codex> <--model> <test-model>/);
      assert.doesNotMatch(commands, /AGENT_RELAY_TOKEN|must-not-cross-the-boundary|UNRELATED_VARIABLE/);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("toolchain smoke script validates its command contract without invoking host tools", async (t: any) => {
  const root = join(tmpdir(), `agent-relay-toolchain-${process.pid}-${Date.now()}-${Math.random()}`);
  const bin = join(root, "bin");
  const log = join(root, "commands.log");
  const script = join(process.cwd(), "scripts", "toolchain-smoke.sh");
  const commands = [
    "node", "npm", "python3", "java", "rustc", "cargo", "go", "git", "gcc", "g++", "clang",
    "make", "cmake", "pkg-config", "bash", "curl", "wget", "jq", "zip", "unzip", "tar", "gzip",
    "xz", "zstd", "rsync", "file", "find", "diff", "codex",
  ];
  await createFakeCommands(bin, commands);
  await writeFile(log, "");

  const runSmoke = (extraEnv: Record<string, string> = {}) => runProcess("/bin/bash", [script], {
    cwd: root,
    env: {
      PATH: bin,
      EXPECTED_CODEX_VERSION: "0.144.3",
      FAKE_COMMAND_LOG: log,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await t.test("accepts the required toolchain and Codex parser", async () => {
      const result = await runSmoke();
      assert.equal(result.status, 0, result.stderr);
      const invocations = await readFile(log, "utf8");
      for (const command of commands) assert.match(invocations, new RegExp(`^${escapeRegExp(command)} `, "m"));
      assert.match(invocations, /^codex --version$/m);
      assert.match(invocations, /^codex --ask-for-approval never exec --help$/m);
    });

    await t.test("rejects an unexpected Codex version", async () => {
      const result = await runSmoke({ FAKE_CODEX_VERSION: "9.9.9" });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Unexpected Codex CLI version/);
    });

    for (const excluded of ["ssh", "dotnet"]) {
      await t.test(`rejects excluded ${excluded}`, async () => {
        await createFakeCommands(bin, [excluded]);
        try {
          const result = await runSmoke();
          assert.notEqual(result.status, 0);
          assert.match(result.stderr, new RegExp(excluded === "ssh" ? "OpenSSH must not be installed" : "\\.NET SDK must not be installed"));
        } finally {
          await rm(join(bin, excluded), { force: true });
        }
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
