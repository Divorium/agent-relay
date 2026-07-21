import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (path: string): Promise<string> => readFile(path, "utf8");

test("updater maintains noninteractive sudo authority through bounded provisioning", async () => {
  const update = await source("update.sh");
  const wait = update.indexOf('process_table="$(/usr/bin/ps -e -o euid=,comm=)"');
  const authority = update.indexOf("refresh_sudo_authority", wait);
  const compile = update.indexOf('/usr/local/bin/tsc -p "${SOURCE_ROOT}/tsconfig.runtime.json"', authority);
  const finalized = update.indexOf("runtime_finalized=1", compile);
  const provision = update.indexOf("/usr/bin/setsid --wait", finalized);
  const restore = update.indexOf("\nrestore_runner\nrunner_status=", provision);
  assert.ok(wait >= 0 && authority > wait && compile > authority && finalized > compile && provision > finalized && restore > provision);
  assert.match(update, /sudo -n -u "\$\{BUILD_USER\}"/u);
  assert.match(update, /process_group_running/u);
  assert.match(update, /substr\(\$2,1,1\)!="Z"/u);
  assert.match(update, /PROVISIONER_DEADLINE_STEPS/u);
  assert.match(update, /sudo -n \/usr\/bin\/setsid --wait/u);
  assert.doesNotMatch(update, /start_sudo_keeper/u);
});

test("provisioner implements fresh, residual-cleanup, or exact-managed state and permanent roots", async () => {
  const host = await source("scripts/docker-host.sh");
  assert.match(host, /DOCKER_HOST_STORAGE_ROOT=\/srv\/github-runner\/storage\/docker/u);
  assert.match(host, /DOCKER_HOST_ENGINE_ROOT=.*\/engine/u);
  assert.match(host, /DOCKER_HOST_CONTAINERD_ROOT=.*\/containerd/u);
  assert.match(host, /DOCKER_HOST_MARKER=\/etc\/agent-relay\/docker-host-state-v1/u);
  assert.match(host, /DOCKER_HOST_CLASSIFICATION=fresh/u);
  assert.match(host, /DOCKER_HOST_CLASSIFICATION=residual/u);
  assert.match(host, /DOCKER_HOST_CLASSIFICATION=managed/u);
  assert.doesNotMatch(host, /complete-compatible|missing-plugin/u);
  assert.match(host, /Pre-existing installed or partial Docker or container runtime package state is unsupported/u);
  assert.match(host, /Pre-existing Docker or containerd process state is unsupported/u);
  assert.match(host, /Managed Docker storage is already populated without a marker/u);
});

test("unmarked Docker remnant cleanup is exact, restartable, and fully reclassified before publication", async () => {
  const host = await source("scripts/docker-host.sh");
  const adapter = await source("scripts/docker-host-debian.sh");
  const cleanup = host.indexOf("docker_host_classify_and_clean_unmarked() {");
  const loop = host.indexOf("\n  while :; do\n", cleanup);
  const firstClassification = host.indexOf("\n    docker_host_classify\n", loop);
  const purge = host.indexOf("docker_debian_purge_residual_packages", firstClassification);
  const remove = host.indexOf("docker_host_remove_cleanup_remnants", purge);
  const main = host.indexOf("docker_host_main() {");
  const cleanupCall = host.indexOf("docker_host_classify_and_clean_unmarked", main);
  const publishPreparing = host.indexOf("docker_host_publish_marker preparing", cleanupCall);
  const configure = host.indexOf("docker_host_prepare_storage_and_configuration", publishPreparing);
  assert.ok(cleanup >= 0 && loop > cleanup && firstClassification > loop && purge > firstClassification && remove > purge);
  assert.ok(main >= 0 && cleanupCall > main && publishPreparing > cleanupCall && configure > publishPreparing);
  assert.match(adapter, /"\$\{status\}" == 'rc ' && -n "\$\{version\}"/u);
  assert.match(adapter, /docker_debian_run_residual_purge "\$\{packages\[@\]\}"/u);
  assert.match(adapter, /timeout --signal=TERM --kill-after=10s/u);
  assert.match(adapter, /\/usr\/bin\/dpkg --purge -- "\$@"/u);
  assert.match(adapter, /Residual package remains after cleanup/u);
  assert.match(host, /docker_host_inventory_cleanup_configuration/u);
  assert.match(host, /docker_host_inventory_cleanup_plugins/u);
  assert.match(host, /docker_host_inventory_cleanup_units/u);
  assert.match(host, /docker_host_inventory_stale_unit_manager_state/u);
  assert.match(host, /DOCKER_HOST_MOUNTINFO=\/proc\/self\/mountinfo/u);
  assert.match(host, /DOCKER_HOST_CLEANUP_PATH="\$1" \/usr\/bin\/awk/u);
  assert.match(host, /Mounted filesystem at or below recursive cleanup path/u);
  assert.match(host, /docker_host_assert_cleanup_tree_unmounted "\$\{path\}"[\s\S]*?rm -rf --one-file-system -- "\$\{path\}"/u);
  assert.match(host, /cleanup-plugin-roots\.bin/u);
  assert.match(host, /cleanup-unit-roots\.bin/u);
  assert.match(host, /docker_host_assert_recorded_cleanup_roots_unmounted/u);
  assert.match(adapter, /cleanup-apt-roots\.bin/u);
  assert.match(adapter, /docker_debian_assert_cleanup_apt_roots_unmounted/u);
  assert.match(adapter, /docker_debian_filter_list_source/u);
  assert.match(adapter, /docker_debian_filter_sources_file/u);
  assert.match(adapter, /\.agent-relay-docker-cleanup\.tmp\./u);
  assert.match(adapter, /DOCKER_DEBIAN_APT_DIRECTORY=\/etc\/apt/u);
  assert.match(host, /rm -rf --one-file-system -- "\$\{path\}"/u);
  assert.doesNotMatch(adapter, /apt-get[^\n]*purge/u);
});

test("configuration precedes controlled package installation and explicit startup", async () => {
  const host = await source("scripts/docker-host.sh");
  const configure = host.lastIndexOf("docker_host_prepare_storage_and_configuration");
  const policy = host.indexOf("docker_host_install_policy", configure);
  const install = host.indexOf("docker_debian_install_components", policy);
  const start = host.indexOf("docker_host_activate_after_revalidation", install);
  assert.ok(configure >= 0 && policy > configure && install > policy && start > install);
  assert.match(host, /docker_host_policy_content/u);
  assert.match(host, /Package installation activated Docker despite policy-rc\.d/u);
  assert.match(host, /docker\.socket/u);
});

test("managed files publish through unique same-directory temporary files", async () => {
  const host = await source("scripts/docker-host.sh");
  const adapter = await source("scripts/docker-host-debian.sh");
  assert.match(host, /mktemp "\$\{directory\}\/\.agent-relay-/u);
  assert.match(host, /\/usr\/bin\/mv -T -- "\$\{stage\}" "\$\{target\}"/u);
  assert.match(adapter, /MANAGED_KEY_STAGE_GLOB=.*\.tmp\./u);
  assert.match(adapter, /MANAGED_SOURCE_STAGE_GLOB=.*\.tmp\./u);
  assert.match(adapter, /docker_debian_remove_orphan_stages/u);
});

test("package transaction pins requested and resolver-selected packages", async () => {
  const adapter = await source("scripts/docker-host-debian.sh");
  assert.match(adapter, /selected_exact\+=\("\$\{selected_package\}=\$\{selected_version\}"\)/u);
  assert.match(adapter, /DOCKER_DEBIAN_DPKG_CONFFILE_OPTIONS=\(--force-confdef --force-confold\)/u);
  assert.match(adapter, /DOCKER_DEBIAN_APT_CONFFILE_OPTIONS=\([\s\S]*?-o Dpkg::Options::=--force-confdef[\s\S]*?-o Dpkg::Options::=--force-confold[\s\S]*?\)/u);
  assert.match(adapter, /docker_debian_install_exact_packages\(\) \{[\s\S]*?DEBIAN_FRONTEND=noninteractive[\s\S]*?\/usr\/bin\/apt-get[\s\S]*?"\$\{DOCKER_DEBIAN_APT_CONFFILE_OPTIONS\[@\]\}" install "\$@"[\s\S]*?\n\}/u);
  assert.match(adapter, /docker_debian_configure_pending_packages\(\) \{[\s\S]*?DEBIAN_FRONTEND=noninteractive[\s\S]*?\/usr\/bin\/dpkg[\s\S]*?"\$\{DOCKER_DEBIAN_DPKG_CONFFILE_OPTIONS\[@\]\}" --configure -a[\s\S]*?\n\}/u);
  assert.match(adapter, /docker_debian_install_exact_packages "\$\{selected_exact\[@\]\}"/u);
  assert.match(adapter, /rerun \.\/update\.sh to resume the recorded transaction/u);
  assert.doesNotMatch(adapter, /make dpkg clean/u);
  assert.match(adapter, /Installed version differs from resolved transaction/u);
  assert.match(adapter, /docker_debian_candidate_is_unambiguously_official/u);
  assert.doesNotMatch(adapter, /apt-cache depends --recurse/u);
});

test("transaction recovery starts only after the package-state boundary passes", async () => {
  const host = await source("scripts/docker-host.sh");
  const main = host.indexOf("docker_host_main() {");
  const boundary = host.indexOf('docker_host_validate_phase_boundary "${phase}"', main);
  const recovery = host.indexOf("docker_host_recover_transaction", boundary);
  assert.ok(main >= 0 && boundary > main && recovery > boundary);
  assert.match(host, /\[\[ "\$\{status:1:1\}" != c \]\] \|\| return 1/u);
  assert.match(host, /docker_debian_configure_pending_packages/u);
  assert.match(host, /docker_debian_install_exact_packages "\$\{exact\[@\]\}"/u);
});

test("effective roots, plugins, groups, socket and first-install registry check are validated", async () => {
  const host = await source("scripts/docker-host.sh");
  assert.match(host, /info --format '\{\{\.DockerRootDir\}\}'/u);
  assert.match(host, /ctr --address \/run\/containerd\/containerd\.sock plugins ls -d/u);
  assert.match(host, /timeout --signal=TERM --kill-after=2s/u);
  assert.match(host, /buildx version/u);
  assert.match(host, /compose version/u);
  assert.match(host, /DOCKER_HOST_FRESH == 1.*DOCKER_HOST_ACCEPTANCE/u);
  assert.match(host, /agent-relay-builder must not be in docker/u);
  assert.match(host, /DOCKER_CONFIG=\$\{client\}/u);
  assert.match(host, /DOCKER_HOST_CODEX_PATH=\/opt\/java\/openjdk\/bin:\/usr\/local\/go\/bin:\/opt\/rust\/cargo\/bin:\/usr\/local\/bin:\/usr\/bin:\/bin/u);
  assert.match(host, /systemctl is-enabled --quiet/u);
  assert.match(host, /DOCKER_HOST_OVERRIDE_UNIT_ROOTS=\([\s\S]*?\/run\/systemd\/transient[\s\S]*?\/run\/systemd\/generator\.early[\s\S]*?\/etc\/systemd\/system[\s\S]*?\/run\/systemd\/system[\s\S]*?\/usr\/local\/lib\/systemd\/system[\s\S]*?\/run\/systemd\/generator\.late\n\)/u);
  assert.match(host, /docker_host_plugin_inventory_validate exact/u);
  assert.match(host, /docker_host_unit_aliases_absent/u);
  assert.match(host, /docker_host_inspect_interrupted_service_state/u);
  assert.match(host, /Docker or containerd processes remained after recovery stop/u);
  assert.match(host, /docker_host_validate_phase_boundary "\$\{phase\}"/u);
});

test("Docker lifecycle remains with Codex and bind-mount ownership is explicit", async () => {
  const prompt = await source("src/execution/prompt.ts");
  const host = await source("scripts/docker-host.sh");
  assert.match(prompt, /ensure every path in the repository is owned by github-runner/u);
  assert.match(prompt, /container user mappings or repair ownership after bind mounts/u);
  assert.doesNotMatch(host, /docker compose (?:up|down|restart)|docker (?:rm|rmi|volume prune|system prune)/iu);
});
