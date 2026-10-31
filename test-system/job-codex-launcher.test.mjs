import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile, chmod, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'relay-job-'));
  const source = join(root, 'relay');
  for (const directory of ['scripts', 'config']) await mkdir(join(source, directory), { recursive: true });
  for (const file of ['codex-run', 'toolchain-environment.sh', 'host-config.sh'])
    await cp(join(process.cwd(), 'scripts', file), join(source, 'scripts', file));
  const socketDir = join(root, 'socket'), home = join(root, 'runner-home'), auth = join(root, 'auth');
  const install = join(root, 'tools'), state = join(root, 'state');
  for (const directory of [socketDir, home, auth, install, state]) await mkdir(directory, { mode: 0o700 });
  await mkdir(join(install, 'bin'));
  await writeFile(join(auth, 'auth.json'), '{"synthetic":true}\n', { mode: 0o600 });
  const config = JSON.parse(await readFile('config/runner-host.json', 'utf8'));
  config.docker_socket_path = join(socketDir, 'docker.sock');
  await writeFile(join(source, 'config', 'runner-host.json'), JSON.stringify(config));
  const server = createServer();
  await new Promise((resolve, reject) => { server.on('error', reject); server.listen(config.docker_socket_path, resolve); });
  const binary = join(install, 'bin', 'codex'), record = join(root, 'record');
  await writeFile(binary, `#!/bin/bash\nset -eu\nprintf '%s\\n' "$CODEX_HOME" "$DOCKER_HOST" "$NPM_CONFIG_CACHE" "\${GITHUB_TOKEN-unset}" > '${record}'\nexit "\${1:-0}"\n`, { mode: 0o700 });
  const env = { ...process.env, HOME: home, CODEX_RUNTIME_ROOT: state, CODEX_BINARY: binary,
    CODEX_HOME: auth, CODEX_INSTALL_ROOT: install, GITHUB_TOKEN: 'synthetic-github-token' };
  return { root, source, home, auth, binary, install, state, record, env, server };
}
async function run(f, env = f.env, args = []) {
  return await new Promise((resolve, reject) => {
    const child = spawn('bash', [join(f.source, 'scripts', 'codex-run'), ...args], { env });
    let stdout = '', stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
async function close(f) { await new Promise((resolve) => f.server.close(resolve)); await rm(f.root, { recursive: true, force: true }); }

test('selected CLI runs without global Codex or persistent host login and cleans tool state', async () => {
  const f = await fixture();
  try {
    const result = await run(f);
    assert.equal(result.code, 0, result.stderr);
    const record = (await readFile(f.record, 'utf8')).trim().split('\n');
    assert.equal(record[0], f.auth);
    assert.equal(record[1], `unix://${join(f.root, 'socket', 'docker.sock')}`);
    assert.ok(record[2].startsWith(`${f.state}/run.`));
    assert.equal(record[3], 'unset');
    assert.deepEqual(await readdir(f.state), []);
    assert.equal(await readFile(join(f.auth, 'auth.json'), 'utf8'), '{"synthetic":true}\n');
  } finally { await close(f); }
});

test('selected CLI failure remains nonzero and removes temporary runtime', async () => {
  const f = await fixture();
  try {
    const result = await run(f, f.env, ['7']);
    assert.equal(result.code, 7, result.stderr);
    assert.deepEqual(await readdir(f.state), []);
  } finally { await close(f); }
});

test('missing job executable is rejected instead of falling back to host installation', async () => {
  const f = await fixture();
  try {
    const env = { ...f.env }; delete env.CODEX_BINARY;
    const result = await run(f, env);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /CODEX_BINARY/);
    await assert.rejects(readFile(f.record));
  } finally { await close(f); }
});

test('authentication directory symlink and group-readable auth are refused', async () => {
  const f = await fixture();
  try {
    const link = join(f.root, 'auth-link');
    await symlink(f.auth, link);
    let result = await run(f, { ...f.env, CODEX_HOME: link });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Codex home/);
    await chmod(join(f.auth, 'auth.json'), 0o644);
    result = await run(f);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /authentication/);
    await assert.rejects(readFile(f.record));
  } finally { await close(f); }
});

test('executable outside the declared installation is refused', async () => {
  const f = await fixture();
  try {
    const result = await run(f, { ...f.env, CODEX_BINARY: '/bin/true' });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /installation/);
  } finally { await close(f); }
});
