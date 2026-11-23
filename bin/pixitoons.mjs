#!/usr/bin/env node
// Command line of Pixitoons.
//   npx pixitoons copy-assets <folder>   copies the avatar files of this version to <folder>/<version>/ and checks
//                                        every file against assets/SHA256SUMS. Serve that folder and pass its URL as
//                                        `base`: createAvatars({ base: '/pixitoons/<version>/' }).
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const [cmd, folder] = process.argv.slice(2);

if (cmd !== 'copy-assets' || !folder) {
  console.log('usage: npx pixitoons copy-assets <folder>');
  console.log(`  copies the avatar files of pixitoons ${version} to <folder>/${version}/`);
  process.exit(cmd ? 2 : 0);
}

const src = join(root, 'assets');
const dest = resolve(folder, version);
const lines = readFileSync(join(src, 'SHA256SUMS'), 'utf8').split('\n').filter(Boolean);
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const bad = () => lines.filter((l) => {
  const [sum, rel] = [l.slice(0, 64), l.slice(66)];
  const p = join(dest, rel);
  return !existsSync(p) || sha(p) !== sum;
});

if (existsSync(dest) && bad().length === 0) {
  console.log(`${dest} already holds the ${lines.length} files of pixitoons ${version}`);
  process.exit(0);
}
cpSync(src, dest, { recursive: true, force: true });
const wrong = bad();
if (wrong.length) {
  console.error(`${wrong.length} files in ${dest} do not match SHA256SUMS, for example ${wrong[0].slice(66)}`);
  process.exit(1);
}
console.log(`copied the ${lines.length} files of pixitoons ${version} to ${dest}`);
console.log(`serve that folder and pass its URL: createAvatars({ base: '<url of that folder>/' })`);
