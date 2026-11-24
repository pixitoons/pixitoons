// Brings a build of the avatar factory into this package: the engine and the browser entry go to src/, the files
// the engine loads (manifest.json, l/, lut/, and the half-size half/l/) to assets/. Then it writes assets/SHA256SUMS
// and src/version.js.
//   node scripts/import-build.mjs <build_dir>            stop if assets/ holds files the build no longer has
//   node scripts/import-build.mjs <build_dir> --prune    remove those files (to the Recycle Bin on Windows)
// The demo page of the factory (index.html, cmp/) is not part of the package.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { at, readJSON, sha256, sumsText, walk } from './lib.mjs';
import { versionText } from './sync-version.mjs';

const args = process.argv.slice(2);
const prune = args.includes('--prune');
const buildDir = args.find((a) => !a.startsWith('--'));
if (!buildDir) {
  console.error('usage: node scripts/import-build.mjs <build_dir> [--prune]');
  process.exit(2);
}
const build = resolve(buildDir);
for (const need of ['manifest.json', 'engine.js', 'avatars.js', 'l', 'lut']) {
  if (!existsSync(join(build, need))) {
    console.error(`${build}: no ${need}; is this a build folder of the factory?`);
    process.exit(2);
  }
}

// What assets/ should hold afterwards, and what it holds now that the build does not.
const dirs = ['l', 'lut', 'half/l'].filter((d) => existsSync(join(build, d)));
const wanted = ['manifest.json', ...dirs.flatMap((d) => walk(join(build, d)).map((p) => `${d}/${p}`))];
const assets = at('assets');
const have = existsSync(assets) ? walk(assets).filter((p) => p !== 'SHA256SUMS') : [];
const keep = new Set(wanted);
const stale = have.filter((p) => !keep.has(p));
if (stale.length && !prune) {
  console.error(`assets/ holds ${stale.length} files that this build does not have, for example:`);
  for (const p of stale.slice(0, 10)) console.error(`  ${p}`);
  console.error('Run again with --prune to remove them.');
  process.exit(1);
}

// Removes a file; on Windows it goes to the Recycle Bin, so nothing is lost on the maintainer's computer.
function remove(path) {
  if (process.platform !== 'win32') return rmSync(path);
  const ps = 'Add-Type -AssemblyName Microsoft.VisualBasic; '
    + `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${path.replace(/'/g, "''")}', 'OnlyErrorDialogs', 'SendToRecycleBin')`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`could not move ${path} to the Recycle Bin: ${r.stderr}`);
}
for (const p of stale) remove(join(assets, p));

let changed = 0;
const put = (from, to) => {
  const bytes = readFileSync(from);
  if (existsSync(to) && sha256(readFileSync(to)) === sha256(bytes)) return;
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  changed++;
};
for (const p of wanted) put(join(build, p), join(assets, p));
for (const f of ['engine.js', 'avatars.js']) put(join(build, f), at('src', f));

const sums = sumsText(assets);
writeFileSync(join(assets, 'SHA256SUMS'), sums);
writeFileSync(at('src', 'version.js'), versionText());

const { build: id } = readJSON(join(assets, 'manifest.json'));
const bytes = wanted.reduce((n, p) => n + statSync(join(assets, p)).size, 0);
console.log(`build ${id}: ${wanted.length} asset files, ${bytes} bytes; ${changed} files written, ${stale.length} removed`);
console.log(`assets/SHA256SUMS ${sha256(sums)}`);
