import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (path: string): Promise<string> => readFile(path, "utf8");

test("containerd dpkg-dist reconciliation is wired into every package boundary", async () => {
  const adapter = await source("scripts/docker-host-debian.sh");
  assert.match(adapter, /docker_debian_remove_discarded_conffile containerd\.io \/etc\/containerd\/config\.toml/u);
  assert.match(adapter, /docker_debian_install_exact_packages\(\) \{[\s\S]*?apt-get[\s\S]*?docker_debian_reconcile_conffile_artifacts/u);
  assert.match(adapter, /docker_debian_assert_clean_dpkg\(\) \{[\s\S]*?docker_debian_reconcile_conffile_artifacts/u);
  assert.match(adapter, /docker_debian_assert_recovery_dpkg_bounded\(\) \{[\s\S]*?docker_debian_reconcile_conffile_artifacts/u);
  assert.match(adapter, /docker_host_exact_metadata "\$\{artifact\}" file "\$\{DOCKER_HOST_OWNER_UID\}:\$\{DOCKER_HOST_OWNER_GID\}\|644"/u);
  assert.match(adapter, /docker_debian_conffile_digest "\$\{package\}" "\$\{conffile\}" "\$\{admindir\}"/u);
  assert.match(adapter, /actual_digest="\$\(\/usr\/bin\/md5sum -- "\$\{artifact\}"\)"/u);
});
