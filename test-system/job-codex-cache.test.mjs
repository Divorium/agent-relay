import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cacheDigest } from '../scripts/codex-cache-digest.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'relay-cache-test-'));
  const bin = join(root, 'bin'), temp = join(root, 'temp'), home = join(root, 'home');
  for (const directory of [bin, temp, home]) await mkdir(directory, { mode: 0o700 });
  const count = join(root, 'install-count');
  const npm = join(bin, 'npm');
  await writeFile(npm, `#!/usr/bin/env python3
import os, pathlib, sys
args=sys.argv[1:]
assert '--global' in args and '--prefix' in args
assert 'CODEX_TOKEN' not in os.environ and 'GITHUB_TOKEN' not in os.environ
prefix=pathlib.Path(args[args.index('--prefix')+1])
version=[a for a in args if a.startswith('@openai/codex@')][0].split('@')[-1]
with open(${JSON.stringify(count)},'a') as f: f.write(version+'\\n')
(prefix/'bin').mkdir(parents=True,exist_ok=True)
p=prefix/'bin'/'codex'
p.write_text("""#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == --version ]]; then echo "codex-cli VERSION"; exit 0; fi
if [[ "$1" == login ]]; then IFS= read -r token || true; echo '{}' > "$CODEX_HOME/auth.json"; exit 0; fi
exit 99
""".replace('VERSION',version))
p.chmod(0o700)
`, { mode: 0o700 });
  await chmod(npm, 0o700);
  const wrapper = join(root, 'relay/scripts/run-job-codex');
  await mkdir(join(root, 'relay/scripts'), { recursive: true });
  await mkdir(join(root, 'relay/config'));
  await cp('scripts/run-job-codex', wrapper);
  await cp('scripts/codex-cache-digest.mjs', join(root, 'relay/scripts/codex-cache-digest.mjs'));
  const pins = {};
  const golden = join(root, 'golden');
  await mkdir(join(golden, 'bin'), { recursive: true });
  for (const version of ['0.161.0', '0.162.0', '0.163.0', '0.164.0']) {
    await writeFile(join(golden, 'bin/codex'), `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == --version ]]; then echo "codex-cli ${version}"; exit 0; fi
if [[ "$1" == login ]]; then IFS= read -r token || true; echo '{}' > "$CODEX_HOME/auth.json"; exit 0; fi
exit 99
`, { mode: 0o700 });
    pins[version] = { [`${process.platform}-${process.arch}`]: await cacheDigest(golden) };
  }
  await writeFile(join(root, 'relay/config/codex-integrity.json'), JSON.stringify(pins));
  await rm(golden, { recursive: true, force: true });
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: temp,
    CODEX_VERSION: '0.164.0', CODEX_CACHE_ROOT: join(root, 'cache'), CODEX_TOKEN: 'at-synthetic-fixture', GITHUB_TOKEN: 'synthetic-gh' };
  delete env.GITHUB_OUTPUT;
  return { root, bin, temp, home, count, npm, env, wrapper };
}
async function run(f, command = 'test -x "$CODEX_BINARY"; test -f "$CODEX_HOME/auth.json"; test -z "${CODEX_TOKEN-}"; test -z "${GITHUB_TOKEN-}"', env = f.env) {
  return await new Promise((resolve, reject) => {
    const child = spawn('bash', [f.wrapper, 'bash', '-euc', command], { env });
    let stdout = '', stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('cold install becomes a network-free cache hit and job authentication is removed', async () => {
  const f = await fixture();
  try {
    const first = await run(f);
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /CODEX_CACHE_MISS/);
    await writeFile(f.npm, '#!/bin/sh\necho unexpected-install >&2\nexit 91\n', { mode: 0o700 });
    const second = await run(f);
    assert.equal(second.code, 0, second.stderr);
    assert.match(second.stdout, /CODEX_CACHE_HIT/);
    assert.equal(await readFile(f.count, 'utf8'), '0.164.0\n');
    assert.deepEqual(await readdir(f.temp), []);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('concurrent jobs install one version once and keep authentication separate', async () => {
  const f = await fixture();
  try {
    const results = await Promise.all([run(f, 'echo "AUTH=$CODEX_HOME"'), run(f, 'echo "AUTH=$CODEX_HOME"')]);
    for (const result of results) assert.equal(result.code, 0, result.stderr);
    assert.notEqual(results[0].stdout.match(/AUTH=(.+)/)?.[1], results[1].stdout.match(/AUTH=(.+)/)?.[1]);
    assert.equal(await readFile(f.count, 'utf8'), '0.164.0\n');
    assert.deepEqual(await readdir(f.temp), []);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('failed execution keeps its exit code but not job credentials', async () => {
  const f = await fixture();
  try {
    const result = await run(f, 'exit 17');
    assert.equal(result.code, 17, result.stderr);
    assert.deepEqual(await readdir(f.temp), []);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('version retention removes idle old installations', async () => {
  const f = await fixture();
  try {
    for (const version of ['0.162.0', '0.163.0', '0.164.0']) {
      const result = await run(f, 'true', { ...f.env, CODEX_VERSION: version });
      assert.equal(result.code, 0, result.stderr);
    }
    const versions = (await readdir(join(f.root, 'cache', `${process.platform}-${process.arch}`))).filter((name) => /^\d+\.\d+\.\d+$/.test(name));
    assert.equal(versions.length, 2);
    assert.ok(versions.includes('0.164.0'));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('installation failure does not publish partial cache or leave authentication', async () => {
  const f = await fixture();
  try {
    await writeFile(f.npm, '#!/bin/sh\nexit 23\n', { mode: 0o700 });
    const result = await run(f);
    assert.equal(result.code, 23, result.stderr);
    assert.deepEqual(await readdir(f.temp), []);
    const entries = await readdir(join(f.root, 'cache', `${process.platform}-${process.arch}`));
    assert.ok(!entries.includes('0.164.0'));
    assert.ok(entries.every((name) => !name.startsWith('.stage-')));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('an active cache lease survives pruning and cancellation removes authentication', async () => {
  const f = await fixture();
  let child;
  try {
    child = spawn('bash', [f.wrapper, process.execPath, '-e', 'process.on("SIGTERM", () => process.exit(0)); console.log("READY"); setInterval(() => {}, 1000);'], {
      env: { ...f.env, CODEX_VERSION: '0.161.0' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '', errors = '';
    child.stderr.on('data', (data) => { errors += data; });
    const closed = new Promise((resolve) => child.once('close', resolve));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No READY marker: ${errors}`)), 10000);
      child.stdout.on('data', (data) => { output += data; if (output.includes('READY')) { clearTimeout(timer); resolve(); } });
      child.once('error', reject);
    });
    for (const version of ['0.162.0', '0.163.0', '0.164.0']) {
      const result = await run(f, 'true', { ...f.env, CODEX_VERSION: version });
      assert.equal(result.code, 0, result.stderr);
    }
    const versions = await readdir(join(f.root, 'cache', `${process.platform}-${process.arch}`));
    assert.ok(versions.includes('0.161.0'));
    child.kill('SIGTERM');
    assert.equal(await closed, 143);
    assert.deepEqual(await readdir(f.temp), []);
  } finally {
    child?.kill('SIGKILL');
    await rm(f.root, { recursive: true, force: true });
  }
});

test('a cache replacement with the expected version cannot receive credentials', async () => {
  const f = await fixture();
  try {
    const first = await run(f);
    assert.equal(first.code, 0, first.stderr);
    const binary = join(f.root, 'cache', `${process.platform}-${process.arch}`, '0.164.0/bin/codex');
    const marker = join(f.root, 'poison-executed');
    await writeFile(binary, `#!/bin/sh\nprintf compromised > '${marker}'\nif [ "$1" = --version ]; then echo 'codex-cli 0.164.0'; exit 0; fi\necho '{}' > "$CODEX_HOME/auth.json"\n`);
    const second = await run(f);
    assert.notEqual(second.code, 0);
    assert.match(second.stderr, /integrity/);
    await assert.rejects(readFile(marker));
    assert.deepEqual(await readdir(f.temp), []);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
