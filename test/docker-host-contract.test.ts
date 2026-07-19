import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Docker provisioning remains update-only and restores runner availability", async () => {
  const update = await readFile("update.sh", "utf8");
  const install = await readFile("install.sh", "utf8");
  const provision = update.indexOf('sudo "${DOCKER_PROVISIONER}"');
  const adopt = update.indexOf('sudo find -P "${RUNTIME_ROOT}" -xdev -exec chown -h root:root');
  const restore = update.indexOf('systemctl start "${SERVICE_NAME}"', provision);
  assert.ok(adopt > 0 && provision > adopt && restore > provision);
  assert.match(update, /docker_status=\$\?/u);
  assert.match(update, /runner_needs_restore=1/u);
  assert.match(update, /runtime_finalized=1/u);
  assert.match(update, /runner remains stopped because the runtime is incomplete/u);
  assert.match(update, /runner restoration failed \(Docker provisioning status:/u);
  assert.match(update, /runtime is active, but Docker provisioning failed with status/u);
  const runnerStop = update.indexOf('systemctl stop "${SERVICE_NAME}"');
  assert.ok(runnerStop > 0);
  assert.match(update, /setsid --wait sudo "\$\{DOCKER_PROVISIONER\}"/u);
  assert.match(update, /kill -TERM -- "-\$\{active_child_pgid\}"/u);
  assert.match(update, /wait "\$\{active_child_pid\}"/u);
  assert.doesNotMatch(install, /apt-get[^\n]*(?:docker-ce|containerd\.io)|groupadd docker|systemctl[^\n]*docker/iu);
});

test("Docker host scripts implement direct-access package contracts without storage mutation", async () => {
  const host = await readFile("scripts/docker-host.sh", "utf8");
  const debian = await readFile("scripts/docker-host-debian.sh", "utf8");
  for (const state of ["complete-compatible", "fresh", "missing-plugin"]) {
    assert.ok(host.includes(state), `missing host classification ${state}`);
  }
  for (const check of ["/usr/bin/dockerd", "/usr/bin/docker", "/usr/bin/containerd", "buildx", "compose"]) {
    assert.ok(host.includes(check), `missing command check ${check}`);
  }
  assert.match(debian, /apt-get --simulate --no-install-recommends install/u);
  assert.match(debian, /docker_debian_assert_clean_dpkg/u);
  assert.match(debian, /Global dpkg state is not clean/u);
  assert.doesNotMatch(debian, /docker-ce=[0-9]|containerd\.io=[0-9]/u);
  assert.doesNotMatch(host + debian, /rsync|migration-stage|data-root|\/var\/lib\/docker|\/var\/lib\/containerd|daemon\.json|config\.toml/u);
  assert.doesNotMatch(host, /systemctl stop (?:docker|containerd)/u);
  assert.match(host, /docker_host_client_environment/u);
  assert.match(debian, /docker_debian_parse_simulation/u);
  assert.match(debian, /docker_debian_inspect_repository_definitions/u);
  assert.match(debian, /LC_ALL=C LANG=C \/usr\/bin\/(?:apt-get|apt-cache|dpkg|dpkg-query)/u);
  assert.match(host, /docker_host_inspect_unit/u);
  const installComponents = debian.match(/docker_debian_install_components\(\)[\s\S]*?\n\}/u)?.[0] ?? "";
  const ensureRepository = debian.match(/docker_debian_ensure_repository\(\)[\s\S]*?\n\}/u)?.[0] ?? "";
  assert.match(installComponents, /docker_debian_ensure_repository/u);
  assert.match(ensureRepository, /docker_debian_inspect_repository_definitions/u);
  assert.doesNotMatch(host, /DOCKER_HOST_ENGINE_ROOT|DOCKER_HOST_CONTAINERD_ROOT/u);
});

test("Docker access is direct, exact, and excludes the builder", async () => {
  const host = await readFile("scripts/docker-host.sh", "utf8");
  const profile = await readFile("scripts/toolchain-environment.sh", "utf8");
  const executor = await readFile("src/execution/codex-executor.ts", "utf8");
  assert.match(host, /usermod -aG docker "\$\{DOCKER_HOST_RUNNER_USER\}"/u);
  assert.match(host, /\/usr\/bin\/gpasswd --delete "\$\{DOCKER_HOST_BUILD_USER\}" docker/u);
  assert.match(host, /\/usr\/bin\/docker --host unix:\/\/\/var\/run\/docker\.sock/u);
  assert.match(profile, /TOOLCHAIN_STATE_SUBDIRECTORIES=.*docker/u);
  assert.match(profile, /"DOCKER_CONFIG=\$\{state_root\}\/docker"/u);
  assert.match(executor, /permission\("\/var\/run\/docker\.sock", "write"\)/u);
  assert.match(executor, /permission\("\/run\/docker\.sock", "write"\)/u);
  assert.doesNotMatch(executor, /storage\/docker/u);
});
