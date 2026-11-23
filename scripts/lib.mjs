// Helpers shared by the maintainer scripts and the tests (Node only; not part of the published package).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const at = (...parts) => join(ROOT, ...parts);

// True when the module at this URL is the script Node was started with (not imported by another one).
export const isMain = (url) => Boolean(process.argv[1]) && fileURLToPath(url) === resolve(process.argv[1]);

export const readJSON = (path) => JSON.parse(readFileSync(path, 'utf8'));
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Files under a folder as paths relative to it, with forward slashes, in byte order of the path.
export function walk(dir, prefix = '') {
  const out = [];
  for (const e of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(dir, rel));
    else if (e.isFile()) out.push(rel);
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// The text of assets/SHA256SUMS for a folder: one "<sha256>  <path>" line per file, the sums file itself left out
// (the format of sha256sum, so `sha256sum -c SHA256SUMS` checks a copy).
export function sumsText(dir) {
  return walk(dir).filter((p) => p !== 'SHA256SUMS')
    .map((p) => `${sha256(readFileSync(join(dir, p)))}  ${p}\n`).join('');
}

// "1.2.3" -> [1, 2, 3]; anything else (ranges, pre-releases) -> null.
export function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v));
  return m ? m.slice(1).map(Number) : null;
}

export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
