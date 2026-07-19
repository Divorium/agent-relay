import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path: string): Promise<string> {
  return readFile(path, "utf8");
}

test("Docker provisioning is serialized after runtime finalization and before runner restoration", async () => {
  const update = await source("update.sh");
  const lock = update.indexOf('exec 9<"${ADMIN_FILE}"');
  const stop = update.indexOf('sudo systemctl stop "${SERVICE_NAME}"', lock);
  const compile = update.indexOf('/usr/local/bin/tsc -p "${SOURCE_ROOT}/tsconfig.runtime.json"', stop);
  const finalized = update.indexOf("runtime_finalized=1", compile);
  const provision = update.indexOf("/usr/bin/setsid --wait", finalized);
  const dockerStatus = update.indexOf("docker_status=$?", provision);
  const restore = update.indexOf("\nrestore_runner\nrunner_status=", dockerStatus);
  assert.ok(lock >= 0 && stop > lock && compile > stop && finalized > compile);
  assert.ok(provision > finalized && dockerStatus > provision && restore > dockerStatus);
  assert.match(update, /Docker provisioning failed with status .* the runner was restored with the finalized runtime/u);
  assert.match(update, /runtime_finalized == 1/u);
  assert.doesNotMatch(update, /data-root|containerd.*root|rsync|daemon\.json|config\.toml/iu);
});

test("installer protects Docker entrypoints without provisioning Docker", async () => {
  const install = await source("install.sh");
  assert.match(install, /scripts\/docker-host\.sh/u);
  assert.match(install, /scripts\/docker-host-debian\.sh/u);
  assert.match(install, /chmod 0755/u);
  assert.doesNotMatch(install, /docker-ce|containerd\.io|groupadd docker|usermod[^\n]*docker|systemctl[^\n]*docker/iu);
  assert.doesNotMatch(install, /\brsync\b/u);
});

test("host orchestrator classifies official components without requiring daemon access", async () => {
  const host = await source("scripts/docker-host.sh");
  for (const packageName of [
    "docker-ce", "docker-ce-cli", "containerd.io", "docker-buildx-plugin", "docker-compose-plugin",
  ]) {
    assert.ok(host.includes(packageName), `missing package contract for ${packageName}`);
  }
  assert.match(host, /docker-ce-cli\) printf '\/usr\/bin\/docker\|--version\|\\n'/u);
  assert.doesNotMatch(host, /docker version --client|\/usr\/bin\/docker\|version\|--client/u);
  assert.match(host, /DOCKER_HOST_CLASSIFICATION=fresh/u);
  assert.match(host, /DOCKER_HOST_CLASSIFICATION=complete-compatible/u);
  assert.match(host, /DOCKER_HOST_CLASSIFICATION=missing-plugin/u);
  assert.match(host, /plugin package exists without the official Docker core/i);
});

test("runner client state is reachable while provisioner state remains private", async () => {
  const host = await source("scripts/docker-host.sh");
  assert.match(host, /chmod 0711 "\$\{DOCKER_HOST_STATE_CONTAINER\}"/u);
  assert.match(host, /DOCKER_HOST_STATE_ROOT=\$\{DOCKER_HOST_STATE_CONTAINER\}\/private/u);
  assert.match(host, /install -d -o root -g root -m 0700/u);
  assert.match(host, /mktemp -d "\$\{DOCKER_HOST_STATE_CONTAINER\}\/client\.XXXXXXXX"/u);
  assert.match(host, /chown "\$\{DOCKER_HOST_RUNNER_USER\}:\$\{DOCKER_HOST_RUNNER_USER\}" "\$\{client\}"/u);
  assert.match(host, /chmod 0700 "\$\{client\}"/u);
  assert.match(host, /DOCKER_CONFIG=\$\{client\}/u);
  assert.match(host, /--host unix:\/\/\/var\/run\/docker\.sock/u);
});

test("systemd units and pre-existing administrator drop-ins are inspected before package work", async () => {
  const host = await source("scripts/docker-host.sh");
  const classify = host.indexOf("docker_host_classify");
  const inspect = host.lastIndexOf("docker_host_inspect_services", host.indexOf("docker_debian_install_components"));
  const install = host.indexOf("docker_debian_install_components");
  assert.ok(classify >= 0 && inspect > classify && install > inspect);
  assert.match(host, /docker_host_inspect_admin_dropins/u);
  assert.match(host, /\/etc\/systemd\/system\/\$\{unit\}\.d/u);
  assert.match(host, /\/run\/systemd\/system\/\$\{unit\}\.d/u);
  assert.match(host, /unowned unit file before package installation/u);
  assert.match(host, /does not use its secure official package unit file/u);
});

test("repository handling isolates GnuPG and validates exactly one primary fingerprint", async () => {
  const adapter = await source("scripts/docker-host-debian.sh");
  assert.match(adapter, /docker_debian_primary_fingerprint_from_colons/u);
  assert.match(adapter, /pubs==1 && primary!="" && waiting==""/u);
  assert.match(adapter, /\$1=="sub"/u);
  assert.match(adapter, /length\(value\)!=40/u);
  assert.match(adapter, /GNUPGHOME="\$\{home\}"/u);
  assert.match(adapter, /\/usr\/bin\/env -i HOME="\$\{home\}"/u);
  assert.match(adapter, /--no-options --no-default-keyring --show-keys --with-colons/u);
  assert.doesNotMatch(adapter, /\/root\/\.gnupg/u);
});

test("managed apt publication is atomic, restartable and apt-readable", async () => {
  const adapter = await source("scripts/docker-host-debian.sh");
  assert.match(adapter, /DOCKER_DEBIAN_MANAGED_KEY_STAGE=.*\.agent-relay-docker\.asc\.new/u);
  assert.match(adapter, /DOCKER_DEBIAN_MANAGED_SOURCE_STAGE=.*\.agent-relay-docker\.sources\.new/u);
  assert.match(adapter, /docker_debian_recover_key_stage/u);
  assert.match(adapter, /docker_debian_recover_source_stage/u);
  assert.match(adapter, /docker_debian_staged_key_valid/u);
  assert.match(adapter, /docker_debian_mode_has_other_bit "\$\{path\}" 4/u);
  assert.match(adapter, /\/usr\/bin\/mv -T -- "\$\{DOCKER_DEBIAN_MANAGED_KEY_STAGE\}" "\$\{DOCKER_DEBIAN_MANAGED_KEY\}"/u);
  assert.match(adapter, /\/usr\/bin\/mv -T -- "\$\{DOCKER_DEBIAN_MANAGED_SOURCE_STAGE\}" "\$\{DOCKER_DEBIAN_MANAGED_SOURCE\}"/u);
  assert.match(adapter, /unreferenced managed Docker key path is occupied beside an external source/u);
});

test("package candidate and simulation policies reject ambiguous or unrelated changes", async () => {
  const adapter = await source("scripts/docker-host-debian.sh");
  assert.match(adapter, /docker_debian_candidate_is_unambiguously_official/u);
  assert.match(adapter, /rows>=1 && !bad/u);
  assert.match(adapter, /source !~ \/download\\\.docker\\\.com\\\/linux\\\/debian\//u);
  assert.match(adapter, /\^\(Remv\|Purg\) \|DOWNGRADED\|unauthenticated/u);
  assert.match(adapter, /Docker package simulation contains an unapproved change/u);
  assert.match(adapter, /--no-install-recommends/u);
  assert.doesNotMatch(adapter, /--allow-downgrades|--allow-unauthenticated/u);
});

test("provisioner never manages Docker data, configuration or application lifecycle", async () => {
  const host = await source("scripts/docker-host.sh");
  const adapter = await source("scripts/docker-host-debian.sh");
  for (const text of [host, adapter]) {
    assert.doesNotMatch(text, /data-root|\/var\/lib\/docker|\/var\/lib\/containerd|daemon\.json|containerd\/config\.toml/iu);
    assert.doesNotMatch(text, /\brsync\b|docker compose (?:up|down|restart)|docker (?:rm|rmi|volume prune|system prune)/iu);
  }
});
