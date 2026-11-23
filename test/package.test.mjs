// Checks of the package that need no browser: versions, avatar files, seed identities, and loading in Node.
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { changelogSection } from '../scripts/changelog.mjs';
import { changedLines, identityText, IDENTITY } from '../scripts/identity.mjs';
import { at, readJSON, sumsText, walk } from '../scripts/lib.mjs';
import { versionText } from '../scripts/sync-version.mjs';

const man = readJSON(at('assets', 'manifest.json'));

test('src/version.js matches package.json and assets/manifest.json', () => {
  assert.equal(readFileSync(at('src', 'version.js'), 'utf8'), versionText(), 'run: node scripts/sync-version.mjs');
});

test('CHANGELOG.md has a section for this version', () => {
  const { version } = readJSON(at('package.json'));
  assert.ok(changelogSection(version), `add a "## ${version}" section to CHANGELOG.md`);
});

test('assets/SHA256SUMS lists every avatar file with its hash', () => {
  assert.equal(readFileSync(at('assets', 'SHA256SUMS'), 'utf8'), sumsText(at('assets')),
    'run: node scripts/import-build.mjs <build_dir>');
});

test('assets/ holds exactly the files the manifest names', () => {
  const want = new Set(['manifest.json']);
  for (const sp of Object.values(man.sprites)) want.add(`l/${sp.f}.webp`);
  for (const name of man.luts) want.add(`lut/${name}.png`);
  for (const t of Object.keys(man.ewarp)) want.add(`lut/${t}.ewarp.png`);
  for (const t of Object.keys(man.cfit)) want.add(`lut/${t}.cfit.png`);
  const have = new Set(walk(at('assets')).filter((p) => p !== 'SHA256SUMS'));
  assert.deepEqual([...want].filter((p) => !have.has(p)), [], 'files the manifest names but assets/ lacks');
  assert.deepEqual([...have].filter((p) => !want.has(p)), [], 'files in assets/ that nothing names');
});

// The limits of jsDelivr, which serves the files (github.com/jsdelivr/jsdelivr, "Restrictions", 2026-11-23):
// packages up to 150 MB, and from GitHub single files up to 20 MB.
test('the package fits the limits of jsDelivr', () => {
  const files = ['src', 'assets', 'bin'].flatMap((d) => walk(at(d)).map((p) => at(d, p)));
  const sizes = files.map((p) => statSync(p).size);
  const big = files.filter((_, i) => sizes[i] > 20e6);
  assert.deepEqual(big, [], 'files over 20 MB');
  assert.ok(sizes.reduce((a, b) => a + b, 0) < 150e6, 'package over 150 MB');
});

test('the seeds seed0 to seed999 are who test/identity.txt says', () => {
  const diff = changedLines(readFileSync(IDENTITY, 'utf8'), identityText());
  assert.equal(diff.length, 0, `${diff.length} seeds changed, first: ${JSON.stringify(diff[0])}. If this is meant, `
    + 'it needs a major version; then run: node scripts/identity.mjs --update');
});

test('the package loads in Node (server rendering) and tells the browser-only part apart', async () => {
  const lib = await import('../src/index.js');
  const { version } = readJSON(at('package.json'));
  assert.equal(lib.VERSION, version);
  assert.equal(lib.BUILD, man.build);
  assert.equal(lib.CDN_BASE, `https://cdn.jsdelivr.net/gh/pixitoons/pixitoons@v${version}/assets/`);
  assert.equal(lib.BACKGROUNDS.length, 8);
  assert.equal(typeof lib.SELECTION_VERSION, 'number');
  await assert.rejects(lib.createAvatars(), /runs in the browser/);
});

test('the code has no literal new URL(<path>, import.meta.url), which bundlers would copy as a file', () => {
  for (const f of walk(at('src'))) {
    const code = readFileSync(at('src', f), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(code, /new URL\(\s*['"`][^'"`]*['"`]\s*,\s*import\.meta\.url\s*\)/, f);
  }
});

test('README.md names this version in its addresses and commands', async () => {
  const { readmeText } = await import('../scripts/sync-version.mjs');
  assert.equal(readFileSync(at('README.md'), 'utf8'), readmeText(), 'run: node scripts/sync-version.mjs');
});
