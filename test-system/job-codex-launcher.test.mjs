import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile, chmod, symlink, rename } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'relay-job-'));
  const source = join(root, 'relay');
  for (const directory of ['scripts']) await mkdir(join(source, directory), { recursive: true });
  for (const file of ['codex-run', 'toolchain-environment.sh'])
    await cp(join(process.cwd(), 'scripts', file), join(source, 'scripts', file));
  const home = join(root, 'runner-home'), auth = join(root, 'auth');
  const install = join(root, 'tools'), state = join(root, 'state');
  for (const directory of [home, auth, install, state]) await mkdir(directory, { mode: 0o700 });
  await mkdir(join(install, 'bin'));
  await writeFile(join(auth, 'auth.json'), '{"synthetic":true}\n', { mode: 0o600 });
  const binary = join(install, 'bin', 'codex'), record = join(root, 'record');
  await writeFile(binary, `#!/bin/bash\nset -eu\nprintf '%s\\n' "$CODEX_HOME" "$NPM_CONFIG_CACHE" "\${GITHUB_TOKEN-unset}" > '${record}'\nexit "\${1:-0}"\n`, { mode: 0o700 });
  const env = { ...process.env, CODEX_ALLOW_DOCKER: '', HOME: home, CODEX_RUNTIME_ROOT: state, CODEX_BINARY: binary,
    CODEX_HOME: auth, CODEX_INSTALL_ROOT: install, GITHUB_TOKEN: 'synthetic-github-token' };
  return { root, source, home, auth, binary, install, state, record, env };
}
async function run(f, env = f.env, args = []) {
  return await new Promise((resolve, reject) => {
    const child = spawn(join(f.source, 'scripts', 'codex-run'), args, { env });
    let stdout = '', stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
async function close(f) { await rm(f.root, { recursive: true, force: true }); }

test('selected CLI runs without global Codex or persistent host login and cleans tool state', async () => {
  const f = await fixture();
  try {
    const result = await run(f);
    assert.equal(result.code, 0, result.stderr);
    const record = (await readFile(f.record, 'utf8')).trim().split('\n');
    assert.equal(record[0], f.auth);
    assert.ok(record[1].startsWith(`${f.state}/run.`));
    assert.equal(record[2], 'unset');
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


test('Docker opt-in validates real Unix sockets and sanitizes the final child environment', async () => {
  const f = await fixture();
  // A short checkout-local path avoids the Unix socket pathname length limit.
  const socketRoot = await mkdtemp(join(process.cwd(), '.d-'));
  const socketPath = join(socketRoot, 's');
  const launcher = join(f.source, 'scripts', 'codex-run');
  const server = createServer((socket) => socket.end());
  try {
    const source = await readFile(launcher, 'utf8');
    assert.ok(source.includes('const path = "/run/docker.sock";'));
    await writeFile(launcher, source.replace('const path = "/run/docker.sock";', `const path = ${JSON.stringify(socketPath)};`));
    await writeFile(f.binary, `#!/bin/bash
set -eu
printf '%s\\n' "\${CODEX_ALLOW_DOCKER-unset}" "\${DOCKER_HOST-unset}" "\${DOCKER_CONTEXT-unset}" > '${f.record}'
exit "\${1:-0}"
`, { mode: 0o700 });
    const poisoned = { ...f.env, CODEX_ALLOW_DOCKER: '', DOCKER_HOST: 'tcp://untrusted:2375', DOCKER_CONTEXT: 'untrusted' };
    let result = await run(f, poisoned);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(await readFile(f.record, 'utf8'), 'unset\nunset\nunset\n');
    await rm(f.record);
    for (const value of ['0', 'true', ' 1', '1\n']) {
      result = await run(f, { ...poisoned, CODEX_ALLOW_DOCKER: value });
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /CODEX_ALLOW_DOCKER/);
    }
    const enabled = { ...poisoned, CODEX_ALLOW_DOCKER: '1' };
    // Missing, regular file, directory, and symlink must fail before invoking the CLI.
    for (const kind of ['missing', 'file', 'directory', 'symlink']) {
      if (kind === 'file') await writeFile(socketPath, '');
      if (kind === 'directory') await mkdir(socketPath);
      if (kind === 'symlink') await symlink('/run/docker.sock', socketPath);
      result = await run(f, enabled);
      assert.notEqual(result.code, 0, kind);
      assert.match(result.stderr, /Packaged Docker socket/);
      await assert.rejects(readFile(f.record));
      await rm(socketPath, { recursive: true, force: true });
      assert.deepEqual(await readdir(f.state), []);
    }
    server.listen(socketPath); await once(server, 'listening');
    await chmod(socketPath, 0o000);
    result = await run(f, enabled);
    assert.notEqual(result.code, 0);
    await assert.rejects(readFile(f.record));
    await chmod(socketPath, 0o600);
    result = await run(f, enabled);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(await readFile(f.record, 'utf8'), '1\nunix:///run/docker.sock\nunset\n');
    result = await run(f, enabled, ['7']);
    assert.equal(result.code, 7, result.stderr);
    assert.deepEqual(await readdir(f.state), []);
    // A socket inode without a listener must also fail closed.
    await new Promise((resolve) => server.close(resolve));
    const dead = createServer();
    dead.listen(socketPath); await once(dead, 'listening');
    await rename(socketPath, `${socketPath}-closed`);
    await new Promise((resolve) => dead.close(resolve));
    await rename(`${socketPath}-closed`, socketPath);
    await rm(f.record);
    result = await run(f, enabled);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Packaged Docker socket is inaccessible/);
    await assert.rejects(readFile(f.record));
    assert.deepEqual(await readdir(f.state), []);
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await rm(socketRoot, { recursive: true, force: true });
    await close(f);
  }
});
