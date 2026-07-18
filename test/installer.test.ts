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
  assert.match(install, /STORAGE_ROOT=\$\{BASE_ROOT\}\/storage/u);
  assert.match(install, /EXPECTED_SOURCE_ROOT=\$\{STORAGE_ROOT\}\/agent-relay/u);
  assert.match(install, /WORK_ROOT=\$\{STORAGE_ROOT\}\/work/u);
  assert.match(install, /RUNNER_DIR=\$\{STORAGE_ROOT\}\/runner/u);
  assert.match(install, /RUNNER_HOME=\$\{STORAGE_ROOT\}\/home/u);
  assert.match(install, /BUILD_ROOT=\$\{STORAGE_ROOT\}\/build/u);
  assert.match(install, /BUILD_HOME=\$\{STORAGE_ROOT\}\/build-home/u);
  assert.match(update, /SOURCE_ROOT=\$\{STORAGE_ROOT\}\/agent-relay/u);
  assert.match(update, /BUILD_ROOT=\$\{STORAGE_ROOT\}\/build/u);
  assert.match(update, /BUILD_HOME=\$\{STORAGE_ROOT\}\/build-home/u);
  assert.match(install, /--work _work/u);
  assert.match(install, /ln -s \.\.\/work "\$\{RUNNER_DIR\}\/_work"/u);
  assert.doesNotMatch(install, /\/opt\/agent-relay/u);
});

test("installation separates administrator, builder and runner privileges", async () => {
  const { install } = await scripts();
  assert.match(install, /RUNNER_USER=github-runner/u);
  assert.match(install, /BUILD_USER=agent-relay-builder/u);
  assert.match(install, /ensure_locked_user "\$\{RUNNER_USER\}"/u);
  assert.match(install, /ensure_locked_user "\$\{BUILD_USER\}"/u);
  assert.match(install, /passwd --lock/u);
  assert.match(install, /must not have passwordless sudo access/u);
  assert.match(install, /User=\$\{RUNNER_USER\}/u);
  assert.match(install, /sudo -u "\$\{RUNNER_USER\}" -H \/usr\/local\/bin\/codex login/u);
});

test("installation keeps the runner listener separable from an active worker", async () => {
  const { install } = await scripts();
  assert.match(install, /ExecStart=\$\{RUNNER_DIR\}\/runsvc\.sh/u);
  assert.match(install, /KillMode=process/u);
  assert.match(install, /TimeoutStopSec=5min/u);
  assert.match(install, /sudo install -o root -g root -m 0644 "\$\{service_temp\}"/u);
  assert.doesNotMatch(install, /systemctl enable --now/u);
  assert.match(install, /Run `\.\/update\.sh` to validate and activate the runner/u);
});

test("installation uses pinned verified runner and toolchain versions", async () => {
  const { install } = await scripts();
  assert.match(install, /RUNNER_VERSION=2\.335\.1/u);
  assert.match(install, /RUNNER_SHA256=4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf/u);
  assert.match(install, /GO_VERSION=1\.24\.5/u);
  assert.match(install, /GO_SHA256=10ad9e86233e74c0f6590fe5426895de6bf388964210eac34a6d83f38918ecdc/u);
  assert.match(install, /TYPESCRIPT_VERSION=5\.8\.3/u);
  assert.match(install, /CODEX_VERSION=0\.144\.4/u);
  assert.match(install, /"typescript@\$\{TYPESCRIPT_VERSION\}"/u);
  assert.match(install, /\[\[ -x \/usr\/local\/bin\/tsc \]\]/u);
  assert.equal((install.match(/sha256sum -c -/gu) ?? []).length, 2);
});

test("installation prompts only for runner registration and missing Codex login", async () => {
  const { install } = await scripts();
  assert.match(install, /read -r -s github_token/u);
  assert.equal((install.match(/read -r -s/gu) ?? []).length, 1);
  assert.match(install, /orgs\/\$\{ORGANIZATION\}\/actions\/runners\/registration-token/u);
  assert.match(install, /unset github_token/u);
  assert.match(install, /unset registration_token/u);
});

test("the shared toolchain profile remains the pipeline and Codex environment source", async () => {
  const { install, update, codexRun, smoke, profile } = await scripts();
  assert.match(profile, /^TOOLCHAIN_JAVA_HOME=\/opt\/java\/openjdk$/mu);
  assert.match(profile, /^TOOLCHAIN_GO_ROOT=\/usr\/local\/go$/mu);
  assert.match(profile, /^TOOLCHAIN_RUST_CARGO_HOME=\/opt\/rust\/cargo$/mu);
  assert.match(profile, /^TOOLCHAIN_RUSTUP_HOME=\/opt\/rust\/rustup$/mu);
  assert.match(profile, /toolchain_environment_build\(\)/u);
  for (const consumer of [install, codexRun, smoke]) {
    assert.match(consumer, /toolchain-environment\.sh/u);
  }
  assert.doesNotMatch(update, /toolchain-environment\.sh|toolchain_environment_build/u);
  assert.match(update, /\/usr\/local\/bin\/tsc/u);
  assert.match(codexRun, /toolchain_environment_build/u);
  assert.match(smoke, /toolchain_environment_build/u);
});

test("install and update contain no legacy Docker or Relay deployment", async () => {
  const { install, update } = await scripts();
  for (const script of [install, update]) {
    assert.doesNotMatch(script, /docker(?: |-)?compose|compose\.yml|AGENT_RELAY_TOKEN|AGENT_RELAY_URL|HOST_UID|HOST_GID/iu);
    assert.doesNotMatch(script, /\.env/u);
  }
});

test("README files mirror the native storage layout", async () => {
  const specification = await readFile("docs/native-github-runner-specification.md", "utf8");
  for (const path of ["README.md", "docs/operations/README.md"]) {
    const document = await readFile(path, "utf8");
    for (const storagePath of storagePaths) {
      assert.ok(specification.includes(storagePath), `Specification must define ${storagePath}`);
      assert.ok(document.includes(storagePath), `${path} must mirror ${storagePath}`);
    }
    assert.match(document, /\.\/install\.sh/u);
    assert.match(document, /\.\/update\.sh/u);
    assert.doesNotMatch(document, /\/opt\/agent-relay|docker compose|AGENT_RELAY_TOKEN/iu);
  }
});
