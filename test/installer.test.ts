import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const storagePaths = [
  "/srv/github-runner/storage/agent-relay",
  "/srv/github-runner/storage/work",
  "/srv/github-runner/storage/runner",
  "/srv/github-runner/storage/home",
  "/srv/github-runner/storage/build",
  "/srv/github-runner/storage/build-home",
] as const;

async function scripts(): Promise<{
  install: string;
  update: string;
  codexRun: string;
  smoke: string;
  profile: string;
}> {
  return {
    install: await readFile("install.sh", "utf8"),
    update: await readFile("update.sh", "utf8"),
    codexRun: await readFile("scripts/codex-run", "utf8"),
    smoke: await readFile("scripts/toolchain-smoke.sh", "utf8"),
    profile: await readFile("scripts/toolchain-environment.sh", "utf8"),
  };
}

test("installation groups source, runner, homes, workspaces and builds below storage", async () => {
  const { install, update } = await scripts();
  assert.match(install, /STORAGE_ROOT=\$\{BASE_ROOT\}\/storage/);
  assert.match(install, /EXPECTED_SOURCE_ROOT=\$\{STORAGE_ROOT\}\/agent-relay/);
  assert.match(install, /WORK_ROOT=\$\{STORAGE_ROOT\}\/work/);
  assert.match(install, /RUNNER_DIR=\$\{STORAGE_ROOT\}\/runner/);
  assert.match(install, /RUNNER_HOME=\$\{STORAGE_ROOT\}\/home/);
  assert.match(install, /BUILD_ROOT=\$\{STORAGE_ROOT\}\/build/);
  assert.match(install, /BUILD_HOME=\$\{STORAGE_ROOT\}\/build-home/);
  assert.match(update, /STORAGE_ROOT=\$\{BASE_ROOT\}\/storage/);
  assert.match(update, /SOURCE_ROOT=\$\{STORAGE_ROOT\}\/agent-relay/);
  assert.match(update, /BUILD_ROOT=\$\{STORAGE_ROOT\}\/build/);
  assert.match(update, /BUILD_HOME=\$\{STORAGE_ROOT\}\/build-home/);
  assert.match(install, /--work _work/);
  assert.match(install, /readlink "\$\{RUNNER_DIR\}\/_work"/);
  assert.match(install, /ln -s \.\.\/work "\$\{RUNNER_DIR\}\/_work"/);
  assert.match(install, /runner work path must be the managed symlink/i);
  assert.doesNotMatch(install, /RUNNER_DIR=\$\{BASE_ROOT\}\/runner|RUNNER_HOME=\$\{BASE_ROOT\}\/home/);
  assert.doesNotMatch(install, /INSTALL_ROOT=\/opt\/agent-relay|\/opt\/agent-relay/);
});

test("installation separates administrator, builder and runtime privileges", async () => {
  const { install } = await scripts();
  assert.match(install, /RUNNER_USER=github-runner/);
  assert.match(install, /BUILD_USER=agent-relay-builder/);
  assert.match(install, /ensure_locked_user "\$\{RUNNER_USER\}"/);
  assert.match(install, /ensure_locked_user "\$\{BUILD_USER\}"/);
  assert.match(install, /passwd --lock/);
  assert.match(install, /gpasswd --delete "\$\{user\}" sudo/);
  assert.match(install, /must not have passwordless sudo access/);
  assert.match(install, /User=\$\{RUNNER_USER\}/);
  assert.match(install, /sudo -u "\$\{RUNNER_USER\}" -H \/usr\/local\/bin\/codex login/);
});

test("installation configures WSL once and installs a root-owned systemd unit", async () => {
  const { install } = await scripts();
  assert.match(install, /configure_wsl_systemd/);
  assert.match(install, /sudo install -o root -g root -m 0644 "\$\{wsl_config_temp\}" \/etc\/wsl\.conf/);
  assert.match(install, /ExecStart=\$\{RUNNER_DIR\}\/runsvc\.sh/);
  assert.match(install, /KillMode=process/);
  assert.match(install, /sudo install -o root -g root -m 0644 "\$\{service_temp\}" "\/etc\/systemd\/system\/\$\{SERVICE_NAME\}"/);
  assert.match(install, /wsl --shutdown/);
  assert.match(install, /then run `\.\/update\.sh`/);
  assert.doesNotMatch(install, /systemctl enable --now|multi-user\.target\.wants/);
  assert.match(install, /Run `\.\/update\.sh` to validate and activate the runner/);
});

test("installation uses pinned verified runner and toolchain downloads", async () => {
  const { install } = await scripts();
  assert.match(install, /RUNNER_VERSION=2\.335\.1/);
  assert.match(install, /RUNNER_SHA256=4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf/);
  assert.match(install, /GO_VERSION=1\.24\.5/);
  assert.match(install, /GO_SHA256=10ad9e86233e74c0f6590fe5426895de6bf388964210eac34a6d83f38918ecdc/);
  assert.match(install, /TYPESCRIPT_VERSION=5\.8\.3/);
  assert.match(install, /CODEX_VERSION=0\.144\.4/);
  assert.equal((install.match(/sha256sum -c -/gu) ?? []).length, 2);
  assert.equal((install.match(/installdependencies\.sh/gu) ?? []).length, 1);
  assert.match(install, /"\$\{TOOLCHAIN_GO_ROOT\}\/bin\/go"/);
  assert.match(install, /CARGO_HOME="\$\{TOOLCHAIN_RUST_CARGO_HOME\}" RUSTUP_HOME="\$\{TOOLCHAIN_RUSTUP_HOME\}"/);
  assert.match(install, /"typescript@\$\{TYPESCRIPT_VERSION\}"/);
  assert.match(install, /\[\[ -x \/usr\/local\/bin\/tsc \]\]/);
});

test("installation prompts only for Codex login and initial runner registration", async () => {
  const { install } = await scripts();
  assert.match(install, /read -r -s github_token/);
  assert.equal((install.match(/read -r -s/gu) ?? []).length, 1);
  assert.match(install, /orgs\/\$\{ORGANIZATION\}\/actions\/runners\/registration-token/);
  assert.match(install, /-H @-/);
  assert.doesNotMatch(install, /Authorization: Bearer \$\{github_token\}/);
  assert.match(install, /unset github_token/);
  assert.match(install, /unset registration_token/);
});

test("one trusted profile defines the complete host toolchain environment", async () => {
  const { install, update, codexRun, smoke, profile } = await scripts();
  assert.match(profile, /^TOOLCHAIN_JAVA_HOME=\/opt\/java\/openjdk$/mu);
  assert.match(profile, /^TOOLCHAIN_GO_ROOT=\/usr\/local\/go$/mu);
  assert.match(profile, /^TOOLCHAIN_RUST_CARGO_HOME=\/opt\/rust\/cargo$/mu);
  assert.match(profile, /^TOOLCHAIN_RUSTUP_HOME=\/opt\/rust\/rustup$/mu);
  assert.match(profile, /TOOLCHAIN_PATH=\$\{TOOLCHAIN_JAVA_HOME\}\/bin:\$\{TOOLCHAIN_GO_ROOT\}\/bin:\$\{TOOLCHAIN_RUST_BIN\}:\$\{TOOLCHAIN_SYSTEM_PATH\}/);
  assert.match(profile, /toolchain_environment_build\(\)/);
  for (const binding of [
    "JAVA_HOME", "RUSTUP_HOME", "CARGO_HOME", "GOPATH", "GOCACHE", "GRADLE_USER_HOME",
    "NPM_CONFIG_CACHE", "PIP_CACHE_DIR", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
    "TMPDIR", "DOCKER_CONFIG",
  ]) {
    assert.ok(profile.includes(`"${binding}=`), `profile must define ${binding}`);
  }
  assert.doesNotMatch(profile, /mkdir|\/usr\/bin\/env -i/);
  for (const consumer of [install, codexRun, smoke]) {
    assert.match(consumer, /scripts\/toolchain-environment\.sh|toolchain-environment\.sh/);
    assert.match(consumer, /source /);
  }
  assert.doesNotMatch(update, /toolchain-environment\.sh|toolchain_environment_build/);
  for (const consumer of [install, codexRun]) {
    assert.doesNotMatch(consumer, /TOOLCHAIN_JAVA_HOME=\/opt\/java\/openjdk|TOOLCHAIN_GO_ROOT=\/usr\/local\/go|TOOLCHAIN_RUSTUP_HOME=\/opt\/rust\/rustup/);
  }
  assert.match(install, /scripts\/toolchain-environment\.sh \\/);
  assert.match(codexRun, /toolchain_environment_build/);
  assert.match(smoke, /toolchain_environment_build/);
  assert.match(update, /\/usr\/local\/bin\/tsc/);
});

test("update finalizes the runtime before Docker provisioning and runner restoration", async () => {
  const { update } = await scripts();
  const stop = update.indexOf('sudo -n systemctl stop "${SERVICE_NAME}"');
  const wait = update.indexOf('process_table="$(/usr/bin/ps -e -o euid=,comm=)"', stop);
  const removeBuild = update.indexOf('sudo -n /usr/bin/rm -rf --one-file-system -- "${BUILD_ROOT}"', wait);
  const removeRuntime = update.indexOf('sudo -n /usr/bin/rm -rf --one-file-system -- "${SOURCE_ROOT}/dist"', removeBuild);
  const createRuntime = update.indexOf('sudo -n /usr/bin/install -d -o "${BUILD_USER}"', removeRuntime);
  const compile = update.indexOf('/usr/local/bin/tsc -p "${SOURCE_ROOT}/tsconfig.runtime.json"', createRuntime);
  const entrypoint = update.indexOf('[[ -f "${SOURCE_ROOT}/dist/src/run-codex.js" ]]', compile);
  const adopt = update.indexOf('sudo -n /usr/bin/find -P "${SOURCE_ROOT}/dist" -xdev -exec /usr/bin/chown -h root:root', entrypoint);
  const finalized = update.indexOf("runtime_finalized=1", adopt);
  const provision = update.indexOf("/usr/bin/setsid --wait", finalized);
  const restore = update.indexOf("\nrestore_runner\nrunner_status=", provision);
  assert.ok(stop >= 0 && wait > stop && removeBuild > wait && removeRuntime > removeBuild);
  assert.ok(createRuntime > removeRuntime && compile > createRuntime && entrypoint > compile);
  assert.ok(adopt > entrypoint && finalized > adopt && provision > finalized && restore > provision);
  assert.match(update, /sudo -n -u "\$\{BUILD_USER\}" \/usr\/bin\/env -i/);
  assert.match(update, /-p "\$\{SOURCE_ROOT\}\/tsconfig\.runtime\.json"/);
  assert.match(update, /--outDir "\$\{SOURCE_ROOT\}\/dist"/);
  assert.doesNotMatch(update, /npm ci|node --test|test-coverage|bash -n|node --check|toolchain-smoke/);
});

test("update performs no Git synchronization, runtime staging or rollback", async () => {
  const { update } = await scripts();
  assert.doesNotMatch(update, /\bgit\s+(?:-C\s+\S+\s+)?(?:pull|status|reset|fetch|switch|checkout|rev-parse)\b/u);
  assert.doesNotMatch(update, /AGENT_RELAY_UPDATE_PHASE|original_head|reexec|previous_dist|activation_stage|dist_swapped|rollback/u);
  assert.doesNotMatch(update, /\.agent-relay-dist|\.dist\.previous|workspace\./u);
  assert.match(update, /sudo -n \/usr\/bin\/rm -rf --one-file-system -- "\$\{BUILD_ROOT\}"/);
  assert.match(update, /sudo -n \/usr\/bin\/rm -rf --one-file-system -- "\$\{SOURCE_ROOT\}\/dist"/);
});

test("runtime adoption does not follow links and applies production modes", async () => {
  const { install, update } = await scripts();
  assert.match(install, /find -P "\$\{SOURCE_ROOT\}" -xdev -exec chown -h/);
  assert.match(install, /Required source file must be a regular non-symlink file/);
  assert.match(install, /scripts\/toolchain-environment\.sh/);
  assert.doesNotMatch(install, /chown -R "\$\{owner\}:\$\{group\}" "\$\{SOURCE_ROOT\}"/);
  assert.match(update, /\/usr\/bin\/find -P "\$\{SOURCE_ROOT\}\/dist" -xdev -exec \/usr\/bin\/chown -h root:root \{\} \+/);
  assert.match(update, /-type d -exec \/usr\/bin\/chmod 0755/);
  assert.match(update, /-type f -exec \/usr\/bin\/chmod 0644/);
  assert.doesNotMatch(update, /chown -R/);
});

test("install remains free of Docker provisioning and both scripts contain no Relay transport deployment", async () => {
  const { install, update } = await scripts();
  assert.doesNotMatch(install, /apt-get[^\n]*(?:docker-ce|containerd\.io)|groupadd docker|usermod[^\n]*docker|systemctl[^\n]*docker/iu);
  assert.match(update, /scripts\/docker-host\.sh/u);
  for (const script of [install, update]) {
    assert.doesNotMatch(script, /compose\.yml|AGENT_RELAY_TOKEN|AGENT_RELAY_URL|HOST_UID|HOST_GID/iu);
    assert.doesNotMatch(script, /\.env/);
  }
});

test("README files mirror the native runner filesystem decision", async () => {
  const plan = await readFile("docs/exec-plans/completed/2026-07-16-install-native-github-runner.md", "utf8");
  const specification = await readFile("docs/native-github-runner-specification.md", "utf8");
  for (const path of ["README.md", "docs/operations/README.md"]) {
    const document = await readFile(path, "utf8");
    for (const storagePath of storagePaths) {
      assert.ok(plan.includes(storagePath), `ExecPlan must define ${storagePath}`);
      assert.ok(specification.includes(storagePath), `Specification must define ${storagePath}`);
      assert.ok(document.includes(storagePath), `${path} must mirror ${storagePath}`);
    }
    assert.match(document, /\.\/install\.sh/);
    assert.match(document, /\.\/update\.sh/);
    assert.doesNotMatch(document, /\/srv\/github-runner\/storage\/docker(?:\/|\s|$)/u);
    assert.doesNotMatch(document, /\/srv\/github-runner\/(?:runner|home|build|build-home)(?:\/|\s|$)/u);
    assert.doesNotMatch(document, /\/opt\/agent-relay|AGENT_RELAY_TOKEN/iu);
  }
  assert.doesNotMatch(specification, /\/srv\/github-runner\/storage\/docker/u);
  assert.match(plan, /README files may summarize it but must not introduce additional filesystem decisions/);
  assert.match(plan, /runner\/_work` is a managed symlink to `\.\.\/work/);
});
