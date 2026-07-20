import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("update validates the private runtime through the builder identity before adoption", async () => {
  const update = await readFile("update.sh", "utf8");
  const privateRuntime = 'sudo -n /usr/bin/install -d -o "${BUILD_USER}" -g "${BUILD_USER}" -m 0700 "${SOURCE_ROOT}/dist"';
  const compile = '/usr/local/bin/tsc -p "${SOURCE_ROOT}/tsconfig.runtime.json" --outDir "${SOURCE_ROOT}/dist"';
  const validate = 'sudo -n -u "${BUILD_USER}" /usr/bin/test -f "${SOURCE_ROOT}/dist/src/run-codex.js" || {';
  const oldValidation = '[[ -f "${SOURCE_ROOT}/dist/src/run-codex.js" ]] || {';
  const adopt = 'sudo -n /usr/bin/find -P "${SOURCE_ROOT}/dist" -xdev -exec /usr/bin/chown -h root:root {} +';
  const normalizeDirectories = 'sudo -n /usr/bin/find -P "${SOURCE_ROOT}/dist" -xdev -type d -exec /usr/bin/chmod 0755 {} +';
  const normalizeFiles = 'sudo -n /usr/bin/find -P "${SOURCE_ROOT}/dist" -xdev -type f -exec /usr/bin/chmod 0644 {} +';
  const finalized = "runtime_finalized=1";

  const privateRuntimeIndex = update.indexOf(privateRuntime);
  const compileIndex = update.indexOf(compile, privateRuntimeIndex);
  const validateIndex = update.indexOf(validate, compileIndex);
  const adoptIndex = update.indexOf(adopt, validateIndex);
  const normalizeDirectoriesIndex = update.indexOf(normalizeDirectories, adoptIndex);
  const normalizeFilesIndex = update.indexOf(normalizeFiles, normalizeDirectoriesIndex);
  const finalizedIndex = update.indexOf(finalized, normalizeFilesIndex);

  assert.equal(update.includes(oldValidation), false, "the administrator must not inspect the private builder directory directly");
  assert.ok(privateRuntimeIndex >= 0, "the runtime directory must remain builder-owned and mode 0700");
  assert.ok(compileIndex > privateRuntimeIndex, "compilation must run after private runtime creation");
  assert.ok(validateIndex > compileIndex, "entrypoint validation must run through the builder after compilation");
  assert.ok(adoptIndex > validateIndex, "root ownership adoption must follow builder validation");
  assert.ok(normalizeDirectoriesIndex > adoptIndex, "directory mode normalization must follow adoption");
  assert.ok(normalizeFilesIndex > normalizeDirectoriesIndex, "file mode normalization must follow directory normalization");
  assert.ok(finalizedIndex > normalizeFilesIndex, "runtime finalization must be recorded only after validation and normalization");
});
