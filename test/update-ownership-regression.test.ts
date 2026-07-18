import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function updater(): Promise<string> {
  return readFile("update.sh", "utf8");
}

test("update validates every persistent ownership trust anchor", async () => {
  const update = await updater();
  assert.match(update, /assert_admin_state_file\(\)/u);
  assert.match(update, /Administrator state must be root:root and not group\/other-writable/u);
  assert.match(update, /assert_secure_storage_root\(\)/u);
  assert.match(update, /Storage root must be root:root and not group\/other-writable/u);
  assert.match(update, /assert_private_directory\(\)/u);
  assert.match(update, /assert_private_directory "\$\{BUILD_ROOT\}" "\$\{BUILD_USER\}" "\$\{BUILD_USER\}" "Build root"/u);
  assert.match(update, /assert_private_directory "\$\{BUILD_HOME\}" "\$\{BUILD_USER\}" "\$\{BUILD_USER\}" "Builder home"/u);
  assert.match(update, /assert_tree_ownership "\$\{SOURCE_ROOT\}\/dist" root "Active runtime"/u);
});

test("reexec rollback state is loaded before ownership preflight can fail", async () => {
  const update = await updater();
  const phase = update.indexOf('if [[ "${AGENT_RELAY_UPDATE_PHASE:-}" == reexec ]]');
  const originalHead = update.indexOf('original_head="${AGENT_RELAY_ORIGINAL_HEAD:-}"', phase);
  const serviceState = update.indexOf('service_was_active="${AGENT_RELAY_SERVICE_WAS_ACTIVE}"', originalHead);
  const adminState = update.indexOf("assert_admin_state_file", serviceState);
  const storage = update.indexOf("assert_secure_storage_root", adminState);
  const ownership = update.indexOf("assert_source_ownership", storage);
  const catFile = update.indexOf('cat-file -e "${original_head}^{commit}"', ownership);
  assert.ok(phase >= 0 && originalHead > phase && serviceState > originalHead);
  assert.ok(adminState > serviceState && storage > adminState && ownership > storage && catFile > ownership);
  assert.match(update, /reexec_phase=1/u);
  assert.match(update, /if \(\( reexec_phase == 1 \)\); then/u);
});

test("builder-owned directories are created without privileged path following", async () => {
  const update = await updater();
  assert.match(update, /sudo -u "\$\{BUILD_USER\}" \/usr\/bin\/mkdir -m 0700 -- "\$\{build_workspace\}" "\$\{stage\}"/u);
  assert.match(update, /sudo -u "\$\{BUILD_USER\}" \/usr\/bin\/mkdir -m 0700 -- "\$\{state_paths\[@\]\}"/u);
  assert.doesNotMatch(update, /sudo install -d -o "\$\{BUILD_USER\}"/u);
  assert.match(update, /assert_no_builder_processes/u);
  assert.match(update, /\/usr\/bin\/pgrep -u "\$\{BUILD_USER\}"/u);
});

test("activation locks the moved stage before privileged recursive adoption", async () => {
  const update = await updater();
  const move = update.indexOf('sudo mv -- "${stage}" "${activation_stage}"');
  const chownRoot = update.indexOf('sudo chown -h root:root "${activation_stage}"', move);
  const chmodRoot = update.indexOf('sudo chmod 0700 "${activation_stage}"', chownRoot);
  const validate = update.indexOf('assert_runtime_tree_safe "${activation_stage}" "Staged runtime"', chmodRoot);
  const adopt = update.indexOf('adopt_runtime_tree "${activation_stage}"', validate);
  const verify = update.indexOf('assert_tree_ownership "${activation_stage}" root "Staged runtime"', adopt);
  assert.ok(move >= 0 && chownRoot > move && chmodRoot > chownRoot);
  assert.ok(validate > chmodRoot && adopt > validate && verify > adopt);
});
