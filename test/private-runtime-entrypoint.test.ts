import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("installer validates the private build stage before adopting the runtime", async () => {
  const installer = await readFile("install.sh", "utf8");
  const createStage = 'sudo -n install -d -o "${BUILD_USER}" -g "${BUILD_USER}" -m 0700 "${stage_dir}"';
  const compile = 'sudo -n -u "${BUILD_USER}" env -i';
  const validate = 'validate_stage_tree "${stage_dir}"';
  const adopt = 'sudo -n find -P "${stage_dir}" -xdev -exec chown -h root:root {} +';
  const normalizeDirectories = 'sudo -n find -P "${stage_dir}" -xdev -type d -exec chmod 0755 {} +';
  const normalizeFiles = 'sudo -n find -P "${stage_dir}" -xdev -type f -exec chmod 0644 {} +';
  const publish = 'sudo -n mv -T -- "${stage_dir}" "${SOURCE_ROOT}/dist"';

  const createStageIndex = installer.indexOf(createStage);
  const compileIndex = installer.indexOf(compile, createStageIndex);
  const validateIndex = installer.indexOf(validate, compileIndex);
  const adoptIndex = installer.indexOf(adopt, validateIndex);
  const normalizeDirectoriesIndex = installer.indexOf(normalizeDirectories, adoptIndex);
  const normalizeFilesIndex = installer.indexOf(normalizeFiles, normalizeDirectoriesIndex);
  const publishIndex = installer.indexOf(publish, normalizeFilesIndex);

  assert.ok(createStageIndex >= 0, "the build stage must be builder-owned and private");
  assert.ok(compileIndex > createStageIndex, "compilation must run through the builder after stage creation");
  assert.ok(validateIndex > compileIndex, "the compiled stage must be validated before adoption");
  assert.ok(adoptIndex > validateIndex, "root ownership adoption must follow validation");
  assert.ok(normalizeDirectoriesIndex > adoptIndex, "directory normalization must follow adoption");
  assert.ok(normalizeFilesIndex > normalizeDirectoriesIndex, "file normalization must follow directory normalization");
  assert.ok(publishIndex > normalizeFilesIndex, "the runtime must be published only after validation and normalization");
});
