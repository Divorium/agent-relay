import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

async function read(path: string): Promise<string> {
  return readFile(path, "utf8");
}

test("Docker host scripts are executable in the repository checkout", async () => {
  for (const path of ["scripts/docker-host.sh", "scripts/docker-host-debian.sh"]) {
    const metadata = await stat(path);
    assert.notEqual(metadata.mode & 0o111, 0, `${path} must retain an executable bit in Git`);
  }
});

test("update leaves Git and repository validation outside deployment", async () => {
  const update = await read("update.sh");
  assert.doesNotMatch(update, /\bgit\s+(?:-C\s+\S+\s+)?(?:pull|status|reset|fetch|switch|checkout|rev-parse)\b/u);
  assert.doesNotMatch(update, /AGENT_RELAY_UPDATE_PHASE|original_head|reexec|rollback|previous_dist|activation_stage|dist_swapped/u);
  assert.doesNotMatch(update, /npm ci|node --test|test-coverage|bash -n|node --check|toolchain-smoke/u);
  assert.doesNotMatch(update, /git_status|worktree must be clean|source checkout must be clean/iu);
  assert.match(update, /\/usr\/local\/bin\/tsc/u);
  assert.match(update, /tsconfig\.runtime\.json/u);
});

test("update stops intake, waits, finalizes runtime, provisions Docker and restores runner", async () => {
  const update = await read("update.sh");
  const responsibility = update.indexOf("runner_needs_restore=1");
  const stop = update.indexOf('sudo -n systemctl stop "${SERVICE_NAME}"', responsibility);
  const runnerUid = update.indexOf('runner_uid="$(/usr/bin/id -u "${RUNNER_USER}")"', stop);
  const wait = update.indexOf('process_table="$(/usr/bin/ps -e -o euid=,comm=)"', runnerUid);
  const removeBuild = update.indexOf('sudo -n /usr/bin/rm -rf --one-file-system -- "${BUILD_ROOT}"', wait);
  const removeRuntime = update.indexOf('sudo -n /usr/bin/rm -rf --one-file-system -- "${SOURCE_ROOT}/dist"', removeBuild);
  const createRuntime = update.indexOf('sudo -n /usr/bin/install -d -o "${BUILD_USER}"', removeRuntime);
  const compile = update.indexOf('/usr/local/bin/tsc -p "${SOURCE_ROOT}/tsconfig.runtime.json"', createRuntime);
  const entrypoint = update.indexOf('[[ -f "${SOURCE_ROOT}/dist/src/run-codex.js" ]]', compile);
  const adopt = update.indexOf('sudo -n /usr/bin/find -P "${SOURCE_ROOT}/dist" -xdev -exec /usr/bin/chown -h root:root', entrypoint);
  const finalized = update.indexOf("runtime_finalized=1", adopt);
  const provision = update.indexOf("/usr/bin/setsid --wait", finalized);
  const dockerStatus = update.indexOf("docker_status=$?", provision);
  const restore = update.indexOf("\nrestore_runner\nrunner_status=", dockerStatus);
  assert.ok(responsibility >= 0 && stop > responsibility && runnerUid > stop && wait > runnerUid);
  assert.ok(removeBuild > wait && removeRuntime > removeBuild && createRuntime > removeRuntime);
  assert.ok(compile > createRuntime && entrypoint > compile && adopt > entrypoint && finalized > adopt);
  assert.ok(provision > finalized && dockerStatus > provision && restore > dockerStatus);
  assert.match(update, /sudo -n -u "\$\{BUILD_USER\}" \/usr\/bin\/env -i/u);
  assert.match(update, /--outDir "\$\{SOURCE_ROOT\}\/dist"/u);
  assert.match(update, /-type d -exec \/usr\/bin\/chmod 0755/u);
  assert.match(update, /-type f -exec \/usr\/bin\/chmod 0644/u);
  assert.doesNotMatch(update, /\.previous|\.stage|workspace\./u);
  assert.match(update, /exec 9<"\$\{ADMIN_FILE\}"/u);
  assert.match(update, /\/usr\/bin\/flock --nonblock 9/u);
});

test("runner wait scans the complete process table and filters by numeric UID", async () => {
  const update = await read("update.sh");
  assert.match(update, /runner_uid="\$\(\/usr\/bin\/id -u "\$\{RUNNER_USER\}"\)"/u);
  assert.match(update, /\/usr\/bin\/ps -e -o euid=,comm=/u);
  assert.match(update, /\/usr\/bin\/awk -v uid="\$\{runner_uid\}" '\$1 == uid && \$2 == "Runner\.Worker"/u);
  assert.match(update, /\/usr\/bin\/sleep 5/u);
  assert.match(update, /Could not inspect runner worker processes/u);
  assert.doesNotMatch(update, /\/usr\/bin\/ps -u/u);
  assert.doesNotMatch(update, /\/usr\/bin\/pgrep/u);
});

test("Docker provisioner process group is race-safe and signal handling is bounded", async () => {
  const update = await read("update.sh");
  assert.match(update, /\/usr\/bin\/setsid --wait \/bin\/bash -c/u);
  assert.match(update, /printf "%s\\n" "\$\$" > "\$1"/u);
  assert.match(update, /if ! launcher_running; then\n    break/u);
  assert.match(update, /Docker provisioner did not publish its process group/u);
  assert.match(update, /observed_pgid=.*\/usr\/bin\/ps -o pgid=/u);
  assert.match(update, /PROCESS_GROUP_WAIT_STEPS=300/u);
  assert.match(update, /PROVISIONER_DEADLINE_STEPS=7200/u);
  assert.match(update, /Docker provisioner exceeded its bounded deadline/u);
  assert.match(update, /refresh_sudo_authority/u);
  assert.match(update, /sudo -n \/usr\/bin\/setsid --wait/u);
  assert.doesNotMatch(update, /start_sudo_keeper/u);
  assert.match(update, /process_group_signal TERM/u);
  assert.match(update, /process_group_signal KILL/u);
  assert.match(update, /wait "\$\{active_launcher_pid\}"/u);
  assert.match(update, /trap 'terminate_active_operation HUP 129' HUP/u);
  assert.match(update, /trap 'terminate_active_operation INT 130' INT/u);
  assert.match(update, /trap 'terminate_active_operation TERM 143' TERM/u);
});

test("pipeline validates the production build and real host toolchain", async () => {
  const packageJson = JSON.parse(await read("package.json")) as { scripts: Record<string, string> };
  const workflow = await read(".github/workflows/ci.yml");
  const runtimeCheck = await read("scripts/ci-runtime-build.sh");
  const toolchainCheck = await read("scripts/ci-toolchain-smoke.sh");
  assert.match(packageJson.scripts.check ?? "", /npm run check:runtime/u);
  assert.match(packageJson.scripts.check ?? "", /npm run check:toolchain/u);
  assert.equal(packageJson.scripts["check:runtime"], "bash scripts/ci-runtime-build.sh");
  assert.equal(packageJson.scripts["check:toolchain"], "bash scripts/ci-toolchain-smoke.sh");
  for (const command of [
    "npm run typecheck", "npm test", "npm run check:runtime", "npm run check:shell",
    "npm run check:node-scripts", "npm run check:toolchain", "npm run check:system",
  ]) {
    assert.ok(workflow.includes(command), `CI workflow must run ${command}`);
  }
  assert.match(runtimeCheck, /tsconfig\.runtime\.json/u);
  assert.match(runtimeCheck, /src\/run-codex\.js/u);
  assert.match(toolchainCheck, /toolchain_environment_build/u);
  assert.match(toolchainCheck, /scripts?\/toolchain-smoke\.sh|toolchain-smoke\.sh/u);
});

test("workflow names, filenames and concurrency match their responsibilities", async () => {
  const ci = await read(".github/workflows/ci.yml");
  const codex = await read(".github/workflows/codex.yml");
  assert.match(ci, /^name: CI$/mu);
  assert.match(ci, /concurrency:\n  group: \$\{\{ github\.ref \}\}\n  cancel-in-progress: true/u);
  assert.match(ci, /runs-on: \[self-hosted\]/u);
  assert.match(codex, /^name: Codex$/mu);
  assert.doesNotMatch(codex, /^name: Agent Relay$/mu);
  assert.match(codex, /cancel-in-progress: false/u);
  await assert.rejects(read(".github/workflows/agent-relay.yml"), /ENOENT/u);
});

test("runtime compiler configuration excludes tests and preserves the runtime path", async () => {
  const runtimeConfig = JSON.parse(await read("tsconfig.runtime.json")) as {
    extends?: string;
    compilerOptions?: { outDir?: string };
    include?: string[];
    exclude?: string[];
  };
  assert.equal(runtimeConfig.extends, "./tsconfig.json");
  assert.equal(runtimeConfig.compilerOptions?.outDir, "dist");
  assert.deepEqual(runtimeConfig.include, ["src/**/*.ts", "types/**/*.d.ts"]);
  assert.deepEqual(runtimeConfig.exclude, ["test/**/*.ts"]);
});
