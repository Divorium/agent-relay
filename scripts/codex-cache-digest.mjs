import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export async function cacheDigest(directory) {
  const root = await fs.realpath(directory);
  const digest = createHash('sha256');
  async function visit(relative) {
    const absolute = path.join(root, relative);
    const stat = await fs.lstat(absolute);
    if (stat.isDirectory()) {
      digest.update(`directory\0${relative}\0`);
      for (const name of (await fs.readdir(absolute)).sort()) {
        const child = relative ? `${relative}/${name}` : name;
        if (child === '.last-used' || child === 'lib/node_modules/.package-lock.json') continue;
        await visit(child);
      }
    } else if (stat.isSymbolicLink()) {
      const target = await fs.realpath(absolute);
      if (!target.startsWith(`${root}${path.sep}`)) throw new Error('Cache symlink escapes its installation');
      digest.update(`link\0${relative}\0${await fs.readlink(absolute)}\0`);
    } else if (stat.isFile()) {
      digest.update(`file\0${relative}\0${stat.mode & 0o111}\0`);
      digest.update(createHash('sha256').update(await fs.readFile(absolute)).digest());
    } else {
      throw new Error('Unsupported file type in Codex installation');
    }
  }
  await visit('');
  return digest.digest('hex');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const actual = await cacheDigest(process.argv[2]);
    if (process.argv.length > 3) {
      const pins = JSON.parse(await fs.readFile(new URL('../config/codex-integrity.json', import.meta.url), 'utf8'));
      const expected = pins[process.argv[3]]?.[process.argv[4]];
      if (!/^[a-f0-9]{64}$/.test(expected ?? '') || actual !== expected) throw new Error('Codex cache integrity mismatch or missing trusted version pin');
    }
    console.log(actual);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
