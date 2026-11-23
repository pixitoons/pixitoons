// The text of one version's section in CHANGELOG.md (the notes of its GitHub release).
//   node scripts/changelog.mjs 1.2.0
import { readFileSync } from 'node:fs';
import { at, isMain } from './lib.mjs';

export function changelogSection(version) {
  const lines = readFileSync(at('CHANGELOG.md'), 'utf8').split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${version}`);
  if (start < 0) return '';
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join('\n').trim();
}

if (isMain(import.meta.url)) {
  const text = changelogSection(process.argv[2]);
  if (!text) {
    console.error(`CHANGELOG.md has no section "## ${process.argv[2]}"`);
    process.exit(1);
  }
  console.log(text);
}
