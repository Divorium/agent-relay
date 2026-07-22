import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("installer validates the private build stage before adopting the runtime", async () => {
  const installer = await readFile("install.sh", "utf8");
  const createStage = 'stage_dir="$(mktemp -d "${SOURCE_ROOT}/.dist.stage.XXXXXXXX")"';
  const chownStage = 'sudo -n chown "${BUILD_USER}:${BUILD_USER}" "${stage_dir}"';
  const protectStage = 'sudo -n chmod 0700 "${stage_dir}"';
  const compile = 'sudo -n -u "${BUILD_USER}" /usr/bin/env -i';
  const validate = 'validate_stage_tree "${stage_dir}"';
  const adopt = 'sudo -n find -P "${stage_dir}" -xdev -exec chown -h root:root {} +';
  const normalizeDirectories = 'sudo -n find -P "${stage_dir}" -xdev -type d -exec chmod 0755 {} +';
  const normalizeFiles = 'sudo -n find -P "${stage_dir}" -xdev -type f -exec chmod 0644 {} +';
  const publish = 'sudo -n mv -- "${stage_dir}" "${SOURCE_ROOT}/dist"';

  const createStageIndex = installer.indexOf(createStage);
  const chownStageIndex = installer.indexOf(chownStage, createStageIndex);
  const protectStageIndex = installer.indexOf(protectStage, chownStageIndex);
  const compileIndex = installer.indexOf(compile, protectStageIndex);
  const validateIndex = installer.indexOf(validate, compileIndex);
  const adoptIndex = installer.indexOf(adopt, validateIndex);
  const normalizeDirectoriesIndex = installer.indexOf(normalizeDirectories, adoptIndex);
  const normalizeFilesIndex = installer.indexOf(normalizeFiles, normalizeDirectoriesIndex);
  const publishIndex = installer.indexOf(publish, normalizeFilesIndex);

  assert.ok(createStageIndex >= 0, "the build stage must be created inside the source root");
  assert.ok(chownStageIndex > createStageIndex, "the build stage must be assigned to the builder");
  assert.ok(protectStageIndex > chownStageIndex, "the build stage must be private");
  assert.ok(compileIndex > protectStageIndex, "compilation must run through the builder after stage creation");
  assert.ok(validateIndex > compileIndex, "the compiled stage must be validated before adoption");
  assert.ok(adoptIndex > validateIndex, "root ownership adoption must follow validation");
  assert.ok(normalizeDirectoriesIndex > adoptIndex, "directory normalization must follow adoption");
  assert.ok(normalizeFilesIndex > normalizeDirectoriesIndex, "file normalization must follow directory normalization");
  assert.ok(publishIndex > normalizeFilesIndex, "the runtime must be published only after validation and normalization");
});
