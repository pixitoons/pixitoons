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
  assert.ok(man.half && man.half.sprites, 'the manifest has no half-size files (manifest.half)');
  for (const sp of Object.values(man.half.sprites)) want.add(`half/l/${sp.f}.webp`);
  for (const name of man.luts) want.add(`lut/${name}.png`);
  for (const t of Object.keys(man.ewarp)) want.add(`lut/${t}.ewarp.png`);
  for (const t of Object.keys(man.cfit)) want.add(`lut/${t}.cfit.png`);
  const have = new Set(walk(at('assets')).filter((p) => p !== 'SHA256SUMS'));
  assert.deepEqual([...want].filter((p) => !have.has(p)), [], 'files the manifest names but assets/ lacks');
  assert.deepEqual([...have].filter((p) => !want.has(p)), [], 'files in assets/ that nothing names');
});

// The limits of jsDelivr, which serves the files: from npm, packages up to 150 MB; from GitHub, a whole tag up to
// 50 MB and single files up to 20 MB (github.com/jsdelivr/data.jsdelivr.com and github.com/jsdelivr/jsdelivr,
// "Restrictions", read on 2026-11-24). Since 1.4.0 the avatar files load from the npm package by default (CDN_BASE):
// with the half-size files the repository is more than a GitHub tag can hold. Counted: the files npm packs
// (package.json "files", with package.json and README.md).
test('the package fits the limits of jsDelivr for an npm package', () => {
  const pkg = readJSON(at('package.json'));
  const files = ['package.json', 'README.md', ...pkg.files.flatMap((f) => (statSync(at(f)).isDirectory()
    ? walk(at(f)).map((p) => `${f}/${p}`) : [f]))];
  const sizes = files.map((p) => statSync(at(p)).size);
  assert.deepEqual(files.filter((_, i) => sizes[i] > 20e6), [], 'files over 20 MB');
  const total = sizes.reduce((a, b) => a + b, 0);
  assert.ok(total < 150e6, `the package holds ${(total / 1e6).toFixed(1)} MB; jsDelivr serves an npm package up to 150 MB`);
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
  assert.equal(lib.CDN_BASE, `https://cdn.jsdelivr.net/npm/pixitoons@${version}/assets/`);
  assert.equal(lib.BACKGROUNDS.length, 8);
  assert.equal(typeof lib.SELECTION_VERSION, 'number');
  assert.deepEqual(lib.PARTS, ['cloth', 'hair', 'beard', 'glasses', 'hat']);
  await assert.rejects(lib.createAvatars(), /runs in the browser/);
});

// A render fetches the files that needs() lists, all at once (the browser test checks the list against what compose()
// asks for). Here: every one of them is in assets/, at both sizes, over the seeds of test/identity.txt and every
// value of each option on every face, so a new option or part cannot point at a file that is not published.
test('every file a selection needs is one of the avatar files', async () => {
  const { Engine, options, select } = await import('../src/engine.js');
  const engine = new Engine(man, () => Promise.reject(new Error('no images here')));
  const have = new Set(walk(at('assets')));
  const sels = [];
  for (let i = 0; i < 1000; i++) sels.push(select(`seed${i}`, man));
  for (const t of Object.keys(man.templates)) {
    for (const face of options(man, t).face) {
      const op = options(man, t, face);
      for (const k of ['expr', 'tone', 'eye', 'hair', 'hair_color', 'beard', 'glasses', 'hat', 'cloth', 'cloth_color']) {
        for (const v of op[k]) sels.push(select(`${t}.${face}.${k}.${v}`, man, { t, face, [k]: v }));
      }
    }
  }
  const bad = new Set();
  for (const s of sels) {
    for (const path of engine.needs(s)) {
      const m = /^l\/(.+)\.([cms])\.webp$/.exec(path);
      // in both sizes: the layer's region in a file of l/ and of half/l/
      for (const [dir, sprites] of [['l', man.sprites], ['half/l', man.half.sprites]]) {
        const sp = m && sprites[m[1]];
        const ok = m ? sp && have.has(`${dir}/${sp.f}.webp`) && (m[2] !== 's' || sp.S) : have.has(path);
        if (!ok) bad.add(`${path} (${dir})`);
      }
    }
  }
  assert.deepEqual([...bad].slice(0, 10), [], `${bad.size} paths that needs() gives have no file (or no shadow region)`);
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
