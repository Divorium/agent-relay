import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(path: string): Promise<string> {
  return readFile(path, "utf8");
}

test("update leaves Git and repository validation outside deployment", async () => {
  const update = await read("update.sh");

  assert.doesNotMatch(update, /\bgit\s+(?:-C\s+\S+\s+)?(?:pull|status|reset|fetch|switch|checkout|rev-parse)\b/u);
  assert.doesNotMatch(update, /AGENT_RELAY_UPDATE_PHASE|original_head|reexec|rollback|previous_dist|activation_stage|dist_swapped/u);
  assert.doesNotMatch(update, /npm ci|node --test|test-coverage|bash -n|node --check|toolchain-smoke/u);
  assert.doesNotMatch(update, /git_status|worktree must be clean|source checkout must be clean/iu);
  assert.match(update, /\/usr\/local\/bin\/tsc/u);
  assert.match(update, /tsconfig\.runtime\.json/u);
});

test("update stops intake, waits, deletes and rebuilds the final runtime", async () => {
  const update = await read("update.sh");
  const stop = update.indexOf('sudo systemctl stop "${SERVICE_NAME}"');
  const wait = update.indexOf("wait_for_runner_worker", stop);
  const removeBuild = update.indexOf('sudo rm -rf -- "${BUILD_ROOT}"', wait);
  const removeRuntime = update.indexOf('sudo rm -rf -- "${RUNTIME_ROOT}"', removeBuild);
  const createRuntime = update.indexOf('sudo install -d -o "${BUILD_USER}"', removeRuntime);
  const compile = update.indexOf("/usr/local/bin/tsc", createRuntime);
  const entrypoint = update.indexOf('sudo test -f "${RUNTIME_ENTRYPOINT}"', compile);
  const adopt = update.indexOf('sudo find -P "${RUNTIME_ROOT}" -xdev -exec chown -h root:root', entrypoint);
  const enable = update.indexOf('sudo systemctl enable "${SERVICE_NAME}"', adopt);
  const start = update.indexOf('sudo systemctl start "${SERVICE_NAME}"', enable);

  assert.ok(stop >= 0 && wait > stop && removeBuild > wait);
  assert.ok(removeRuntime > removeBuild && createRuntime > removeRuntime && compile > createRuntime);
  assert.ok(entrypoint > compile && adopt > entrypoint && enable > adopt && start > enable);
  assert.match(update, /sudo -u "\$\{BUILD_USER\}" -H \/usr\/bin\/env -i/u);
  assert.match(update, /--outDir "\$\{RUNTIME_ROOT\}"/u);
  assert.match(update, /-type d -exec chmod 0755/u);
  assert.match(update, /-type f -exec chmod 0644/u);
  assert.doesNotMatch(update, /\bmv\b|\.previous|\.stage|workspace\./u);
});

test("runner wait distinguishes active, idle and inspection failure", async () => {
  const update = await read("update.sh");
  assert.match(update, /\/usr\/bin\/pgrep -u "\$\{RUNNER_USER\}" -f 'Runner\\\.Worker'/u);
  assert.match(update, /0\)[\s\S]*sleep 5/u);
  assert.match(update, /1\)[\s\S]*return/u);
  assert.match(update, /Could not inspect GitHub runner worker processes/u);
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
  assert.match(workflow, /npm run check/u);
  assert.match(runtimeCheck, /tsconfig\.runtime\.json/u);
  assert.match(runtimeCheck, /src\/run-codex\.js/u);
  assert.match(toolchainCheck, /toolchain_environment_build/u);
  assert.match(toolchainCheck, /scripts?\/toolchain-smoke\.sh|toolchain-smoke\.sh/u);
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
