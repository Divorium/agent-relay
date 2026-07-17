import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function installer(): Promise<string> {
  return readFile("install.sh", "utf8");
}

test("installer targets one fresh native Debian environment", async () => {
  const script = await installer();
  assert.match(script, /ORGANIZATION_URL=https:\/\/github\.com\/Divorium/);
  assert.match(script, /RUNNER_DIR="\$\{HOME:\?HOME is required\}\/\.local\/share\/actions-runner"/);
  assert.match(script, /SOURCE_ROOT="\$\(cd -- "\$\(dirname -- "\$\{BASH_SOURCE\[0\]\}"\)" && pwd -P\)"/);
  assert.match(script, /INSTALL_ROOT=\/opt\/agent-relay/);
  assert.match(script, /This installer requires Debian/);
  assert.match(script, /systemd must run as PID 1/);
  assert.match(script, /The source checkout must be readable and writable by the current user/);
  assert.doesNotMatch(script, /docker(?: |-)?compose|docker\s|compose\.yml|down -v|HOST_CODEX|HOST_UID|HOST_GID/i);
  assert.doesNotMatch(script, /\.env/);
});

test("installer configures WSL systemd before requiring systemctl", async () => {
  const script = await installer();
  const pidCheck = script.indexOf("ps -p 1 -o comm=");
  const wslConfiguration = script.indexOf("configure_wsl_systemd", pidCheck);
  const systemctlCheck = script.indexOf("command -v systemctl", pidCheck);
  assert.ok(pidCheck >= 0 && wslConfiguration > pidCheck && systemctlCheck > wslConfiguration);
  assert.match(script, /sudo install -o root -g root -m 0644 "\$\{wsl_config_temp\}" \/etc\/wsl\.conf/);
  assert.match(script, /Run `wsl --shutdown` from Windows/);
});

test("installer uses pinned downloads and verifies archives", async () => {
  const script = await installer();
  assert.match(script, /RUNNER_VERSION=2\.335\.1/);
  assert.match(script, /RUNNER_SHA256=4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf/);
  assert.match(script, /GO_VERSION=1\.24\.5/);
  assert.match(script, /GO_SHA256=10ad9e86233e74c0f6590fe5426895de6bf388964210eac34a6d83f38918ecdc/);
  assert.match(script, /TYPESCRIPT_VERSION=5\.8\.3/);
  assert.match(script, /CODEX_VERSION=0\.144\.4/);
  assert.equal((script.match(/sha256sum -c -/g) ?? []).length, 2);
  assert.match(script, /bin\/installdependencies\.sh/);
});

test("installer uses system runtimes and deterministic global binary paths", async () => {
  const script = await installer();
  assert.match(script, /\/usr\/bin\/node --version/);
  assert.match(script, /\/usr\/bin\/java -version/);
  assert.match(script, /\/usr\/local\/go\/bin\/go version/);
  assert.match(script, /sudo \/usr\/bin\/npm install --global --prefix \/usr\/local/);
  assert.match(script, /\[\[ -x \/usr\/local\/bin\/codex \]\]/);
  assert.match(script, /\[\[ -x \/usr\/local\/bin\/tsc \]\]/);
});

test("installer validates the source and toolchain before replacing trusted files", async () => {
  const script = await installer();
  const npmCi = script.indexOf("npm ci");
  const npmCheck = script.indexOf("npm run check");
  const smoke = script.indexOf('"${SOURCE_ROOT}/scripts/toolchain-smoke.sh"');
  const stage = script.indexOf('stage="/opt/.agent-relay.stage.$$"');
  const replace = script.indexOf('sudo mv -- "${stage}" "${INSTALL_ROOT}"');
  assert.ok(npmCi >= 0 && npmCheck > npmCi && smoke > npmCheck && stage > smoke && replace > stage);
  assert.match(script, /sudo chown -R root:root "\$\{stage\}"/);
  assert.match(script, /sudo install -o root -g root -m 0755/);
});

test("installer restores the previous harness when the atomic swap is interrupted", async () => {
  const script = await installer();
  assert.match(script, /install_swap_pending=1[\s\S]*sudo mv -- "\$\{INSTALL_ROOT\}" "\$\{backup\}"/);
  assert.match(script, /if \(\( install_swap_pending == 1 \)\); then[\s\S]*sudo rm -rf -- "\$\{INSTALL_ROOT\}"[\s\S]*sudo mv -- "\$\{backup\}" "\$\{INSTALL_ROOT\}"/);
  assert.match(script, /install_swap_pending=0[\s\S]*sudo rm -rf -- "\$\{backup\}"/);
});

test("installer asks only for Codex login and one hidden GitHub token", async () => {
  const script = await installer();
  assert.match(script, /if ! codex login status[\s\S]*codex login/);
  assert.match(script, /set \+x[\s\S]*read -r -s github_token/);
  assert.equal((script.match(/read -r -s/g) ?? []).length, 1);
  assert.match(script, /orgs\/\$\{ORGANIZATION\}\/actions\/runners\/registration-token/);
  assert.match(script, /-H @-/);
  assert.doesNotMatch(script, /Authorization: Bearer \$\{github_token\}/);
  assert.match(script, /unset github_token/);
  assert.match(script, /unset registration_response/);
  assert.match(script, /unset registration_token/);
});

test("installer registers and services one unlabeled organization runner", async () => {
  const script = await installer();
  assert.match(script, /\.\/config\.sh --unattended --replace/);
  assert.match(script, /--url "\$\{ORGANIZATION_URL\}"/);
  assert.match(script, /--name gh-runner/);
  assert.match(script, /--work _work/);
  assert.doesNotMatch(script, /--labels/);
  assert.match(script, /svc\.sh install/);
  assert.match(script, /svc\.sh start/);
  assert.match(script, /svc\.sh status/);
  assert.match(script, /actions_runner_services\.conf/);
  assert.match(script, /existing runner registration is incomplete/);
});

test("native Codex launcher preserves the real home and cleans only private runtime", async () => {
  const launcher = await readFile("scripts/codex-run", "utf8");
  assert.match(launcher, /if \[\[ "\$\(id -u\)" == "0" \]\]/);
  assert.match(launcher, /\$\{HOME\}\/\.codex\/auth\.json/);
  assert.match(launcher, /mktemp -d "\$\{CODEX_RUNTIME_ROOT\}\/run\.XXXXXX"/);
  assert.match(launcher, /rm -rf -- "\$\{runtime_dir\}"/);
  assert.match(launcher, /\/usr\/bin\/env -i/);
  assert.match(launcher, /HOME="\$\{HOME\}"/);
  assert.match(launcher, /RUSTUP_HOME=\/opt\/rust\/rustup/);
  assert.match(launcher, /GIT_OPTIONAL_LOCKS=0/);
  assert.doesNotMatch(launcher, /\/home\/agent|find "\$\{HOME\}"|rm -rf -- "\$\{HOME\}"/);
});

test("current operations documentation contains only the native installation", async () => {
  const readme = await readFile("README.md", "utf8");
  const operations = await readFile("docs/operations/README.md", "utf8");
  for (const document of [readme, operations]) {
    assert.match(document, /\/srv\/github-runner\/storage\/agent-relay/);
    assert.match(document, /\.\/install\.sh/);
    assert.doesNotMatch(document, /docker compose|AGENT_RELAY_TOKEN|RUNNER_TOKEN|HOST_UID|HOST_GID|\/runner\/client\.mjs/i);
  }
});
