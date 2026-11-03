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
