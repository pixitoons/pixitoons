// Who the seeds seed0 to seed999 are under this version: their selection (face, expression, skin tone, hair, clothes,
// background and the rest), one line per seed, in test/identity.txt. A version that changes any line changes who
// those seeds are, and that is allowed only in a major version (see "Versions" in README.md).
//   node scripts/identity.mjs            compare test/identity.txt with the code and assets; exit 1 if they differ
//   node scripts/identity.mjs --update   write test/identity.txt
import { readFileSync, writeFileSync } from 'node:fs';
import { SELECTION_VERSION, select } from '../src/engine.js';
import { at, isMain, readJSON } from './lib.mjs';

export const FIELDS = ['t', 'face', 'expr', 'tone', 'eye', 'hair', 'hair_color', 'beard', 'glasses', 'hat', 'cloth',
  'cloth_color', 'bg'];
export const SEEDS = Array.from({ length: 1000 }, (_, i) => `seed${i}`);
export const IDENTITY = at('test', 'identity.txt');

export function identityText() {
  const man = readJSON(at('assets', 'manifest.json'));
  const lines = [`# seed ${FIELDS.join(' ')} (SELECTION_VERSION ${SELECTION_VERSION})`];
  for (const seed of SEEDS) {
    const s = select(seed, man);
    lines.push([seed, ...FIELDS.map((k) => s[k])].join(' '));
  }
  return `${lines.join('\n')}\n`;
}

// The lines of two identity texts that differ, as [old, new] pairs.
export function changedLines(before, after) {
  const a = before.split('\n'), b = after.split('\n'), out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push([a[i] ?? '', b[i] ?? '']);
  return out;
}

if (isMain(import.meta.url)) {
  const now = identityText();
  if (process.argv.includes('--update')) {
    writeFileSync(IDENTITY, now);
    console.log(`wrote test/identity.txt (${SEEDS.length} seeds)`);
  } else {
    const diff = changedLines(readFileSync(IDENTITY, 'utf8'), now);
    if (diff.length) {
      console.error(`${diff.length} lines of test/identity.txt differ from what this code and these assets give, e.g.:`);
      for (const [x, y] of diff.slice(0, 5)) console.error(`  was: ${x}\n  now: ${y}`);
      process.exit(1);
    }
    console.log(`test/identity.txt matches (${SEEDS.length} seeds)`);
  }
}
