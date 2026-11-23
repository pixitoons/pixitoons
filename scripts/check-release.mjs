// Checks a release before it is published. The Release workflow runs it on the tag; CI runs the last check with
// --warn on every change, so a change that needs a major version is visible before anyone tags it.
//   node scripts/check-release.mjs v1.2.0   1. the tag is v<version of package.json>, and src/version.js agrees with
//                                              package.json and assets/manifest.json;
//                                           2. CHANGELOG.md has a section for the version;
//                                           3. the version is above every earlier release, and if test/identity.txt
//                                              differs from the one of the release before it, the first number went up.
//   node scripts/check-release.mjs --warn   check 3 only, against the last release, as a warning.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { BUILD, VERSION } from '../src/version.js';
import { changedLines } from './identity.mjs';
import { at, compareVersions, parseVersion, readJSON } from './lib.mjs';
import { changelogSection } from './changelog.mjs';

const git = (...a) => spawnSync('git', a, { cwd: at(), encoding: 'utf8' });
const fail = (msg) => { console.error(`release check failed: ${msg}`); process.exit(1); };

// Release tags of the repository, highest version first: [{ tag, v: [major, minor, patch] }].
function releases() {
  const r = git('tag', '--list', 'v*');
  if (r.status !== 0) fail(`git tag: ${r.stderr}`);
  return r.stdout.split('\n').map((tag) => ({ tag, v: parseVersion(tag.slice(1)) })).filter((x) => x.v)
    .sort((a, b) => compareVersions(b.v, a.v));
}

// The identity check against an earlier release. Returns a message, or null when it passes.
function identityProblem(prev, current) {
  const old = git('show', `${prev.tag}:test/identity.txt`);
  if (old.status !== 0) return null; // that release had no identity file
  const diff = changedLines(old.stdout, readFileSync(at('test', 'identity.txt'), 'utf8'));
  if (!diff.length || (current && current[0] > prev.v[0])) return null;
  const [was, now] = diff[0];
  return `${diff.length} of the seed lines in test/identity.txt differ from ${prev.tag} (first: "${was}" -> "${now}"), `
    + 'so these seeds would look like other people. That needs a major version (the first number up).';
}

const arg = process.argv[2];
if (arg === '--warn') {
  const [last] = releases();
  const problem = last && identityProblem(last, null);
  if (problem) console.log(`::warning title=Seed identities changed::${problem}`);
  else console.log(last ? `seed identities match ${last.tag}` : 'no release yet');
  process.exit(0);
}

const m = /^v(.+)$/.exec(arg || '');
const version = m && parseVersion(m[1]);
if (!version) fail(`"${arg}" is not a release tag like v1.2.3`);
const pkg = readJSON(at('package.json'));
const { build } = readJSON(at('assets', 'manifest.json'));
if (pkg.version !== m[1]) fail(`the tag is ${arg} but package.json says ${pkg.version}`);
if (VERSION !== pkg.version || BUILD !== build) {
  fail(`src/version.js (${VERSION}, build ${BUILD}) does not match package.json (${pkg.version}) and `
    + `assets/manifest.json (build ${build}); run node scripts/sync-version.mjs`);
}
if (!changelogSection(m[1])) fail(`CHANGELOG.md has no section "## ${m[1]}" with text under it`);
const earlier = releases().filter((x) => compareVersions(x.v, version) < 0);
const later = releases().filter((x) => compareVersions(x.v, version) > 0);
if (later.length) fail(`${later[0].tag} is already released; a new release must be above it`);
const problem = earlier.length && identityProblem(earlier[0], version);
if (problem) fail(problem);
console.log(`release ${arg} ok: build ${build}${earlier.length ? `, after ${earlier[0].tag}` : ', the first release'}`);
