import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('trusted Codex pins are 64-character SHA-256 values for supported platforms', async () => {
  const pins = JSON.parse(await readFile(new URL('../config/codex-integrity.json', import.meta.url), 'utf8'));
  assert.ok(Object.keys(pins).length > 0);
  for (const [version, platforms] of Object.entries(pins)) {
    assert.match(version, /^\d+\.\d+\.\d+$/);
    assert.ok(Object.keys(platforms).length > 0);
    for (const [platform, digest] of Object.entries(platforms)) {
      assert.match(platform, /^linux-(?:x64|arm64)$/);
      assert.match(digest, /^[a-f0-9]{64}$/, `Invalid SHA-256 pin for ${version}/${platform}`);
    }
  }
});


test('fresh distribution execution follows trusted integrity verification', async () => {
  const workflow = await readFile(new URL('../.github/workflows/codex-integrity.yml', import.meta.url), 'utf8');
  const verification = workflow.indexOf('node scripts/codex-cache-digest.mjs "$staging" "$version" "$platform" >/dev/null');
  const execution = workflow.indexOf('test "$("$staging/bin/codex" --version)" = "codex-cli $version"');
  assert.ok(verification >= 0);
  assert.ok(execution > verification);
  assert.match(workflow, /--ignore-scripts/);
});
