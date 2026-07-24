import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexExecutor, createCodexArgs, createCodexEnvironment, terminateProcess } from "../src/execution/codex-executor.js";
import { CodexExecutionError } from "../src/execution/errors.js";
import { createTranscriptSink, type TranscriptSink } from "../src/execution/transcript.js";

const planPath = "docs/exec-plans/active/plan.md";

async function createRoot(name: string) {
  const root = join(tmpdir(), `agent-relay-${name}-${process.pid}-${Date.now()}`);
  const workspaceRoot = join(root, "workspaces");
  const workspace = join(workspaceRoot, "workspace");
  const home = join(root, "home");
  const runtimeRoot = join(home, ".cache", "agent-relay-runtime");
  await mkdir(join(workspace, "docs", "exec-plans", "active"), { recursive: true });
  await mkdir(join(workspace, ".git"), { recursive: true });
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(join(workspace, planPath), "# Plan\n");
  return { root, workspace, home, runtimeRoot };
}

async function captureStdout(run: () => Promise<void>): Promise<string> {
  const original = process.stdout.write;
  let output = "";
  process.stdout.write = ((value: unknown, callback?: (error?: Error | null) => void) => {
    output += String(value);
    callback?.();
    return true;
  }) as typeof process.stdout.write;
  try {
    await run();
    return output;
  } finally {
    process.stdout.write = original;
  }
}

async function captureGroupSignals(run: () => Promise<void>): Promise<Array<[number, string]>> {
  const originalKill = process.kill;
  const signals: Array<[number, string]> = [];
  process.kill = ((pid: number, signal?: string | number) => {
    if (typeof signal === "string") signals.push([pid, signal]);
    return originalKill(pid, signal);
  }) as typeof process.kill;
  try {
    await run();
    return signals;
  } finally {
    process.kill = originalKill;
  }
}

async function withThrowingTermination(run: () => Promise<void>): Promise<void> {
  const childProcess = await import("node:child_process") as unknown as {
    ChildProcess: { prototype: { kill(signal?: string | number): boolean; emit(event: string, error: Error): boolean } };
  };
  const originalGroupKill = process.kill;
  const originalDirectKill = childProcess.ChildProcess.prototype.kill;
  process.kill = ((pid: number, signal?: string | number) => {
    originalGroupKill(pid, signal);
    throw new Error("group termination reported failure");
  }) as typeof process.kill;
  childProcess.ChildProcess.prototype.kill = function (signal?: string | number): boolean {
    originalDirectKill.call(this, signal);
    this.emit("error", new Error("post-spawn termination error"));
    throw new Error("direct termination reported failure");
  };
  try {
    await run();
  } finally {
    process.kill = originalGroupKill;
    childProcess.ChildProcess.prototype.kill = originalDirectKill;
  }
}

test("executor passes only the required launcher environment", () => {
  assert.deepEqual(createCodexEnvironment("/home/user", "/home/user/.cache/runtime"), {
    HOME: "/home/user",
    CODEX_RUNTIME_ROOT: "/home/user/.cache/runtime",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
  });
});

test("Codex arguments keep the selected repository reachable while isolating native host paths", () => {
  const args = createCodexArgs(
    "/work/root/repository",
    "prompt",
    "/home/user",
    "/home/user/.cache/runtime",
    "/srv/github-runner/storage/agent-relay",
  );
  assert.deepEqual(args.slice(0, 2), ["--ask-for-approval", "never"]);
  assert.ok(args.includes("default_permissions=\"agent\""));
  assert.ok(args.includes("permissions.agent.extends=\":workspace\""));
  const filesystem = args.find((value) => value.startsWith("permissions.agent.filesystem="));
  assert.ok(filesystem);
  for (const expected of [
    '"/home/user"="deny"',
    '"/srv/github-runner/storage/agent-relay"="deny"',
    '"/opt/rust"="read"',
    '"/tmp"="deny"',
    '"/var/tmp"="deny"',
    '"/home/user/.cache/runtime"="write"',
    '"/work/root/repository"="write"',
    '"/work/root/repository/.git"="read"',
  ]) assert.match(filesystem, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(filesystem, /"\/work\/root"="deny"/);
  assert.ok(args.includes("permissions.agent.network.enabled=true"));
  assert.ok(!args.includes("danger-full-access"));
  assert.deepEqual(args.slice(-5), ["exec", "--json", "--cd", "/work/root/repository", "prompt"]);
});

test("CodexExecutor streams redacted output and edits the workspace", async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("executor");
  const executable = join(root, "fake-codex");
  await writeFile(executable, `#!/bin/sh
set -eu
[ "\${HOME}" = "${home}" ]
[ "\${CODEX_RUNTIME_ROOT}" = "${runtimeRoot}" ]
printf '%s\n' '{"type":"item.completed","item":{"id":"command_0","type":"command_execution","command":"edit workspace","aggregated_output":"","status":"completed","exit_code":0}}'
printf '%s' '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"authorization: Bearer github_pat_abcdefghijkl'
printf '%s\n' 'mnopqrstuvwxyz1234567890"}}'
printf 'warning\n' >&2
printf 'changed\n' > "${workspace}/changed.txt"
`, { mode: 0o700 });
  await chmod(executable, 0o700);

  const executor = new CodexExecutor(executable, 5_000, 100_000, home, runtimeRoot, "/srv/github-runner/storage/agent-relay");
  try {
    const output = await captureStdout(async () => {
      const outcome = await executor.run(planPath, workspace);
      assert.equal(outcome.exitCode, 0);
    });
    assert.equal(await readFile(join(workspace, "changed.txt"), "utf8"), "changed\n");
    assert.doesNotMatch(output, /github_pat_/);
    assert.match(output, /\[REDACTED\]/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CodexExecutor reports spawn failures", async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("spawn");
  const executor = new CodexExecutor(join(root, "missing"), 5_000, 100_000, home, runtimeRoot, "/srv/github-runner/storage/agent-relay");
  try {
    await assert.rejects(
      () => executor.run(planPath, workspace),
      (error: unknown) => error instanceof CodexExecutionError && error.code === "CODEX_FAILED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CodexExecutor reports timeout after terminating the process group", async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("timeout");
  const executable = join(root, "slow-codex");
  const marker = join(root, "terminated");
  await writeFile(executable, `#!/bin/sh
set -eu
trap 'printf terminated > "${marker}"; exit 0' TERM
printf '%s\n' '{"type":"turn.started"}'
while true; do /bin/sleep 1; done
`, { mode: 0o700 });
  await chmod(executable, 0o700);

  const executor = new CodexExecutor(executable, 50, 100_000, home, runtimeRoot, "/srv/github-runner/storage/agent-relay");
  try {
    await assert.rejects(
      () => executor.run(planPath, workspace),
      (error: unknown) => error instanceof CodexExecutionError && error.code === "CODEX_TIMEOUT",
    );
    assert.equal(await readFile(marker, "utf8"), "terminated");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CodexExecutor caps output and emits one truncation marker", async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("truncate");
  const executable = join(root, "verbose-codex");
  await writeFile(executable, "#!/bin/sh\nprintf '%s\\n' '{\"type\":\"item.completed\",\"item\":{\"id\":\"command_0\",\"type\":\"command_execution\",\"command\":\"verbose\",\"aggregated_output\":\"abcdefghijklmnopqrstuvwxyz\",\"status\":\"completed\",\"exit_code\":0}}'\n", { mode: 0o700 });
  await chmod(executable, 0o700);

  const executor = new CodexExecutor(executable, 5_000, 8, home, runtimeRoot, "/srv/github-runner/storage/agent-relay");
  try {
    const output = await captureStdout(async () => {
      await executor.run(planPath, workspace);
    });
    assert.equal(output, "[codex] [OUTPUT TRUNCATED]\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("terminateProcess handles direct, grouped and fallback termination", () => {
  const directSignals: string[] = [];
  terminateProcess({ kill: (signal) => directSignals.push(signal) }, "SIGTERM", () => assert.fail("group kill must not run"));
  assert.deepEqual(directSignals, ["SIGTERM"]);

  const grouped: Array<[number, string]> = [];
  terminateProcess({ pid: 42, kill: () => assert.fail("direct kill must not run") }, "SIGKILL", (pid, signal) => grouped.push([pid, signal]));
  assert.deepEqual(grouped, [[42, "SIGKILL"]]);

  const fallbackSignals: string[] = [];
  terminateProcess({ pid: 7, kill: (signal) => fallbackSignals.push(signal) }, "SIGTERM", () => { throw new Error("missing group"); });
  assert.deepEqual(fallbackSignals, ["SIGTERM"]);
});

test("CodexExecutor force-kills a process that ignores termination", async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("force-kill");
  const executable = join(root, "stubborn-codex");
  await writeFile(executable, "#!/bin/sh\ntrap '' TERM\nprintf '{'\nwhile true; do /bin/sleep 1; done\n", { mode: 0o700 });
  await chmod(executable, 0o700);

  const executor = new CodexExecutor(
    executable,
    30,
    100_000,
    home,
    runtimeRoot,
    "/srv/github-runner/storage/agent-relay",
    30,
  );
  try {
    const signals = await captureGroupSignals(async () => {
      await assert.rejects(
        () => executor.run(planPath, workspace),
        (error: unknown) => error instanceof CodexExecutionError && error.code === "CODEX_TIMEOUT",
      );
    });
    assert.deepEqual(signals.map(([, signal]) => signal), ["SIGTERM", "SIGKILL"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CodexExecutor escalates malformed JSONL and retains the parser failure", { timeout: 2_000 }, async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("invalid-force-kill");
  const executable = join(root, "stubborn-invalid-codex");
  await writeFile(executable, `#!/usr/bin/node
process.on("SIGTERM", () => {});
process.stdout.write("{invalid\\n");
setInterval(() => {}, 1000);
`, { mode: 0o700 });
  await chmod(executable, 0o700);
  try {
    const signals = await captureGroupSignals(async () => {
      await assert.rejects(
        () => new CodexExecutor(executable, 5_000, 100_000, home, runtimeRoot, "/srv/source", 30).run(planPath, workspace),
        /Invalid Codex JSONL/u,
      );
    });
    assert.deepEqual(signals.map(([, signal]) => signal), ["SIGTERM", "SIGKILL"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("CodexExecutor escalates transcript failure and retains the transcript error", { timeout: 2_000 }, async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("transcript-force-kill");
  const executable = join(root, "stubborn-transcript-codex");
  await writeFile(executable, `#!/usr/bin/node
process.on("SIGTERM", () => {});
process.stdout.write('{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"value"}}\\n');
setInterval(() => {}, 1000);
`, { mode: 0o700 });
  await chmod(executable, 0o700);
  let syncs = 0;
  let closes = 0;
  const transcript: TranscriptSink = {
    async write() { throw new Error("planned transcript write failure"); },
    async sync() { syncs += 1; },
    async close() { closes += 1; },
  };
  try {
    const signals = await captureGroupSignals(async () => {
      await assert.rejects(
        () => new CodexExecutor(executable, 5_000, 100_000, home, runtimeRoot, "/srv/source", 30).run(planPath, workspace, transcript),
        /planned transcript write failure/u,
      );
    });
    assert.deepEqual(signals.map(([, signal]) => signal), ["SIGTERM", "SIGKILL"]);
    assert.equal(syncs, 1);
    assert.equal(closes, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("CodexExecutor coalesces concurrent terminal failures into one escalation", { timeout: 2_000 }, async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("coalesced-failures");
  const executable = join(root, "many-failures-codex");
  await writeFile(executable, `#!/usr/bin/node
process.on("SIGTERM", () => {});
process.stdout.write('{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"value"}}\\n');
setTimeout(() => {
  process.stdout.write("{invalid\\n");
  process.stderr.write(Buffer.from([0xff]));
}, 10);
setInterval(() => {}, 1000);
`, { mode: 0o700 });
  await chmod(executable, 0o700);
  let writes = 0;
  const transcript: TranscriptSink = {
    async write() {
      writes += 1;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
      throw new Error("concurrent sink failure");
    },
    async sync() { throw new Error("later sync failure"); },
    async close() { throw new Error("later close failure"); },
  };
  try {
    const signals = await captureGroupSignals(async () => {
      await assert.rejects(
        () => new CodexExecutor(executable, 5_000, 100_000, home, runtimeRoot, "/srv/source", 30).run(planPath, workspace, transcript),
        /Invalid Codex JSONL|stderr is not valid UTF-8/u,
      );
    });
    assert.deepEqual(signals.map(([, signal]) => signal), ["SIGTERM", "SIGKILL"]);
    assert.equal(writes, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("CodexExecutor cancels escalation when the child closes after graceful termination", { timeout: 2_000 }, async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("graceful-close");
  const executable = join(root, "graceful-invalid-codex");
  await writeFile(executable, `#!/usr/bin/node
process.on("SIGTERM", () => process.exit(0));
process.stdout.write("{invalid\\n");
setInterval(() => {}, 1000);
`, { mode: 0o700 });
  await chmod(executable, 0o700);
  try {
    const signals = await captureGroupSignals(async () => {
      await assert.rejects(
        () => new CodexExecutor(executable, 5_000, 100_000, home, runtimeRoot, "/srv/source", 100).run(planPath, workspace),
        /Invalid Codex JSONL/u,
      );
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
    });
    assert.deepEqual(signals.map(([, signal]) => signal), ["SIGTERM"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("CodexExecutor does not replace a parser failure with termination errors", { timeout: 2_000 }, async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("termination-errors");
  const executable = join(root, "invalid-codex");
  await writeFile(executable, `#!/usr/bin/node
process.on("SIGTERM", () => process.exit(0));
process.stdout.write("{invalid\\n");
setInterval(() => {}, 1000);
`, { mode: 0o700 });
  await chmod(executable, 0o700);
  try {
    await withThrowingTermination(async () => {
      await assert.rejects(
        () => new CodexExecutor(executable, 5_000, 100_000, home, runtimeRoot, "/srv/source", 100).run(planPath, workspace),
        /Invalid Codex JSONL/u,
      );
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("CodexExecutor discards chunks received after the output limit", async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("limit-reached");
  const executable = join(root, "chunked-codex");
  const drained = join(root, "drained");
  await writeFile(executable, `#!/bin/sh
printf '%s\\n' '{"type":"item.completed","item":{"id":"command_0","type":"command_execution","command":"truncate","aggregated_output":"abcdefghijklmnopqrstuvwxyz","status":"completed","exit_code":0}}'
/bin/sleep 0.05
printf '%s\\n' '{"type":"turn.started"}'
printf overflow >&2
printf drained > "${drained}"
`, { mode: 0o700 });
  await chmod(executable, 0o700);

  const executor = new CodexExecutor(executable, 5_000, 8, home, runtimeRoot, "/srv/github-runner/storage/agent-relay");
  try {
    const output = await captureStdout(async () => executor.run(planPath, workspace).then(() => undefined));
    assert.equal(output, "[codex] [OUTPUT TRUNCATED]\n");
    assert.equal(await readFile(drained, "utf8"), "drained");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CodexExecutor retains bounded syntax framing after transcript truncation", async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("syntax-after-limit");
  const executable = join(root, "invalid-after-limit");
  await writeFile(executable, `#!/bin/sh
printf '%s\\n' '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"abcdefghijklmnopqrstuvwxyz"}}'
printf '%s\\n' '{invalid'
`, { mode: 0o700 });
  await chmod(executable, 0o700);
  try {
    await assert.rejects(
      () => new CodexExecutor(executable, 5_000, 8, home, runtimeRoot, "/srv/source").run(planPath, workspace),
      /Invalid Codex JSONL/u,
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("CodexExecutor exposes live ordered progress before exit and persists identical bytes", async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("live");
  const executable = join(root, "live-codex");
  await writeFile(executable, `#!/bin/sh
printf '%s\n' '{"type":"item.started","item":{"id":"item_0","type":"command_execution","command":"echo live","aggregated_output":"","exit_code":null,"status":"in_progress"}}'
/bin/sleep 0.1
printf '%s\n' 'diagnostic' >&2
/bin/sleep 0.05
printf '%s\n' '{"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"echo live","aggregated_output":"done\\n","exit_code":0,"status":"completed"}}'
`, { mode: 0o700 });
  await chmod(executable, 0o700);
  const transcriptPath = join(root, "transcript.log");
  const transcript = await createTranscriptSink(root, transcriptPath);
  const original = process.stdout.write;
  let live = "";
  let settled = false;
  process.stdout.write = ((value: unknown, callback?: (error?: Error | null) => void) => { live += Buffer.from(value as Uint8Array).toString("utf8"); callback?.(); return true; }) as typeof process.stdout.write;
  try {
    const running = new CodexExecutor(executable, 5_000, 100_000, home, runtimeRoot, "/srv/source").run(planPath, workspace, transcript).finally(() => { settled = true; });
    while (!live.includes("command started")) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(settled, false);
    await running;
    assert.equal(live, await readFile(transcriptPath, "utf8"));
    assert.ok(live.indexOf("command started") < live.indexOf("stderr: diagnostic"));
    assert.ok(live.indexOf("stderr: diagnostic") < live.indexOf("command output"));
  } finally {
    process.stdout.write = original;
    await rm(root, { recursive: true, force: true });
  }
});

test("CodexExecutor bounds a one-write child burst behind a slow live Writable", async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("burst-backpressure");
  const executable = join(root, "burst-codex");
  await writeFile(executable, `#!/usr/bin/node
const activity = JSON.stringify({
  type: "item.completed",
  item: { id: "activity", type: "command_execution", command: "burst", aggregated_output: "", status: "completed", exit_code: 0 },
});
const records = Array.from({ length: 600 }, (_, index) => JSON.stringify({
  type: "item.completed",
  item: { id: "burst-" + index, type: "agent_message", text: index + ":" + "x".repeat(600) },
})).join("\\n") + "\\n";
process.stdout.write(activity + "\\n" + records);
`, { mode: 0o700 });
  await chmod(executable, 0o700);
  const transcriptPath = join(root, "burst.log");
  const transcript = await createTranscriptSink(root, transcriptPath);
  const original = process.stdout.write;
  let live = "";
  process.stdout.write = ((...args: any[]) => {
    live += Buffer.from(args[0] as Uint8Array).toString("utf8");
    const callback = args[1] as ((error?: Error | null) => void) | undefined;
    setTimeout(() => { callback?.(); process.stdout.emit("drain"); }, 1);
    return false;
  }) as typeof process.stdout.write;
  try {
    await new CodexExecutor(executable, 10_000, 1_000_000, home, runtimeRoot, "/srv/source").run(planPath, workspace, transcript);
    assert.equal(live, await readFile(transcriptPath, "utf8"));
    assert.ok(live.indexOf("0:") < live.indexOf("599:"));
  } finally {
    process.stdout.write = original;
    await rm(root, { recursive: true, force: true });
  }
});

test("CodexExecutor accepts a cumulative Codex record larger than 1 MiB", async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("large-record");
  const executable = join(root, "large-codex");
  await writeFile(executable, `#!/usr/bin/node
const item = { id: "large", type: "command_execution", command: "large", aggregated_output: "x".repeat(1_200_000), status: "completed", exit_code: 0 };
process.stdout.write(JSON.stringify({ type: "item.completed", item }) + "\\n");
`, { mode: 0o700 });
  await chmod(executable, 0o700);
  try {
    const output = await captureStdout(async () => {
      await new CodexExecutor(executable, 5_000, 100_000, home, runtimeRoot, "/srv/source").run(planPath, workspace);
    });
    assert.match(output, /command output:/u);
    assert.match(output, /EVENT CONTENT TRUNCATED/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("CodexExecutor accepts a valid final JSONL record without LF", async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("final-record");
  const executable = join(root, "final-codex");
  await writeFile(executable, "#!/bin/sh\nprintf '%s' '{\"type\":\"item.completed\",\"item\":{\"id\":\"command_0\",\"type\":\"command_execution\",\"command\":\"final record\",\"aggregated_output\":\"\",\"status\":\"completed\",\"exit_code\":0}}'\n", { mode: 0o700 });
  await chmod(executable, 0o700);
  try {
    const output = await captureStdout(async () => {
      await new CodexExecutor(executable, 5_000, 100_000, home, runtimeRoot, "/srv/source").run(planPath, workspace);
    });
    assert.equal(output, "[codex] command completed: status=completed exit=0\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("CodexExecutor bounds and labels multi-megabyte no-newline stderr", async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("large-stderr");
  const executable = join(root, "diagnostic-codex");
  await writeFile(executable, `#!/usr/bin/node
process.stdout.write('{"type":"item.completed","item":{"id":"command_0","type":"command_execution","command":"diagnostics","aggregated_output":"","status":"completed","exit_code":0}}\\n');
process.stderr.write("🧪".repeat(600_000));
`, { mode: 0o700 });
  await chmod(executable, 0o700);
  const transcriptPath = join(root, "large-stderr.log");
  const transcript = await createTranscriptSink(root, transcriptPath);
  try {
    const output = await captureStdout(async () => {
      await new CodexExecutor(executable, 5_000, 4_000_000, home, runtimeRoot, "/srv/source").run(planPath, workspace, transcript);
    });
    assert.equal(output, await readFile(transcriptPath, "utf8"));
    assert.match(output, /stderr continuation:/u);
    assert.doesNotMatch(output, /�/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("CodexExecutor fails malformed stdout, invalid stderr and invalid final UTF-8", async () => {
  for (const [name, body, message] of [
    ["malformed", `trap 'printf '%s\\n' '{"type":"turn.started"}'; printf later >&2; exit 0' TERM
printf '%s\\n' '{'
while true; do /bin/sleep 1; done`, "Invalid Codex JSONL"],
    ["stderr", "printf '\\377' >&2", "stderr UTF-8"],
    ["final-utf8", "printf '\\342'", "Invalid Codex JSONL"],
  ] as const) {
    const { root, workspace, home, runtimeRoot } = await createRoot(name);
    const executable = join(root, "bad-codex");
    await writeFile(executable, `#!/bin/sh\n${body}\n`, { mode: 0o700 });
    await chmod(executable, 0o700);
    try {
      await assert.rejects(() => new CodexExecutor(executable, 5_000, 100_000, home, runtimeRoot, "/srv/source").run(planPath, workspace), new RegExp(message, "u"));
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("CodexExecutor preserves nonzero failure after truncation", async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("nonzero-truncated");
  const executable = join(root, "failed-codex");
  await writeFile(executable, "#!/bin/sh\nprintf '%s\\n' '{\"type\":\"item.completed\",\"item\":{\"id\":\"item_0\",\"type\":\"agent_message\",\"text\":\"long output\"}}'\nexit 7\n", { mode: 0o700 });
  await chmod(executable, 0o700);
  try {
    await assert.rejects(() => new CodexExecutor(executable, 5_000, 4, home, runtimeRoot, "/srv/source").run(planPath, workspace), /exited with code 7/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("CodexExecutor terminates after a transcript sink failure", async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("sink-failure");
  const executable = join(root, "streaming-codex");
  await writeFile(executable, "#!/bin/sh\nprintf '%s\\n' '{\"type\":\"turn.started\"}'\n/bin/sleep 5\n", { mode: 0o700 });
  await chmod(executable, 0o700);
  const transcript = {
    async write() { throw new Error("sink failed"); },
    async sync() {},
    async close() {},
  };
  try {
    await assert.rejects(
      () => new CodexExecutor(executable, 5_000, 100_000, home, runtimeRoot, "/srv/source").run(planPath, workspace, transcript),
      /Codex transcript failed: sink failed/u,
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("CodexExecutor reports a transcript finalization failure", async () => {
  const { root, workspace, home, runtimeRoot } = await createRoot("sink-finalization");
  const executable = join(root, "quiet-codex");
  await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  await chmod(executable, 0o700);
  const transcript = {
    async write() {},
    async sync() { throw new Error("sync failed"); },
    async close() {},
  };
  try {
    await assert.rejects(
      () => new CodexExecutor(executable, 5_000, 100_000, home, runtimeRoot, "/srv/source").run(planPath, workspace, transcript),
      /Codex transcript failed: sync failed/u,
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});
