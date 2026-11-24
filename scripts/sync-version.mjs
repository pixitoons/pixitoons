// Writes src/version.js from package.json (the version) and assets/manifest.json (the build of the avatar files),
// and puts the version into the addresses and commands of README.md. `npm version` runs it (the "version" script in
// package.json), and so does scripts/import-build.mjs.
//   node scripts/sync-version.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { at, isMain, readJSON } from './lib.mjs';

// The places in README.md that name the installed version: pixitoons@1.2.3 (CDN, from npm), pixitoons@v1.2.3 (CDN,
// from GitHub), pixitoons#v1.2.3 (npm install from GitHub) and pixitoons/1.2.3/ (the folder of copy-assets).
export const README_VERSION = /(pixitoons@v|pixitoons@|pixitoons#v|pixitoons\/)(\d+\.\d+\.\d+)/g;

export function readmeText() {
  const { version } = readJSON(at('package.json'));
  return readFileSync(at('README.md'), 'utf8').replace(README_VERSION, (_, head) => `${head}${version}`);
}

export function versionText() {
  const { version } = readJSON(at('package.json'));
  const { build } = readJSON(at('assets', 'manifest.json'));
  return [
    '// Written by scripts/sync-version.mjs, which `npm version` runs: the version of this package and the build of the',
    '// avatar files in assets/ that it was released with. Do not edit by hand.',
    `export const VERSION = '${version}';`,
    `export const BUILD = '${build}';`,
    '',
  ].join('\n');
}

if (isMain(import.meta.url)) {
  writeFileSync(at('src', 'version.js'), versionText());
  writeFileSync(at('README.md'), readmeText());
  console.log(versionText().split('\n').slice(2, 4).join('\n'));
}
