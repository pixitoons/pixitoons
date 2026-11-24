# Pixitoons

3D avatar library: a seed (any text, such as a user id or a name) gives the same avatar every time. The avatar is
composed in the browser from layered images, so there is no server to run and nothing to sign up for.

- 2 templates (feminine and masculine), 6 face shapes each, 13 expressions, 4 skin tones, 3 eye colours.
- 16 and 15 hairstyles and bald, in 4 hair colours; up to 10 beards; 3 glasses; 3 kinds of headwear per template;
  3 garments in 5 colours; 8 background colours, any colour, or transparent.
- Any choice can be fixed and the rest still comes from the seed.

## Quick start, no build step

```html
<img id="me" width="128" height="128" alt="">
<script type="module">
  import { createAvatars } from 'https://cdn.jsdelivr.net/gh/pixitoons/pixitoons@v1.2.0/src/index.js';

  const avatars = await createAvatars();
  document.getElementById('me').src = await avatars.toURL('dana', { size: 256 });
</script>
```

## Install in a project

```sh
npm install pixitoons
```

Or straight from a GitHub release: `npm install github:pixitoons/pixitoons#v1.2.0`.

```js
import { createAvatars } from 'pixitoons';

const avatars = await createAvatars();                                   // in the browser
img.src = await avatars.toURL('dana', { size: 256 });                   // the avatar of the seed "dana"
const sel = avatars.select('dana', { hair_color: 'ginger' });            // the same avatar with ginger hair
const blob = await avatars.toBlob(sel, { size: 512, background: 'transparent' });
```

The package can be imported anywhere, server rendering included; `createAvatars()` itself runs in the browser.

### React and Next.js

```jsx
'use client';

import { useEffect, useState } from 'react';
import { createAvatars } from 'pixitoons';

let loading = null; // one loader for the whole page

export default function Avatar({ seed, size = 96, alt = '' }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let url = null;
    let live = true;
    loading ??= createAvatars().catch((e) => { loading = null; throw e; });
    loading
      .then((avatars) => avatars.toURL(seed, { size: Math.min(1024, size * 2) })) // sharp on dense screens
      .then((u) => { if (live) setSrc((url = u)); else URL.revokeObjectURL(u); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [seed, size]);
  return src
    ? <img src={src} width={size} height={size} alt={alt} />
    : <span style={{ display: 'inline-block', width: size, height: size }} />;
}
```

### The custom element

```js
const avatars = await createAvatars();
avatars.define(); // registers <pixitoons-avatar>
```

```html
<pixitoons-avatar seed="dana" size="96"></pixitoons-avatar>
<pixitoons-avatar seed="dana" size="96" hair_color="ginger" background="transparent" alt="Dana"></pixitoons-avatar>
```

`size` is in CSS pixels; the element draws at the screen's pixel density. Any field of the selection can be fixed
with an attribute of the same name.

## API

- `createAvatars({ base, imageBytes, colorBytes })` loads the manifest and returns the avatar API. `base` is the
  folder of the avatar files (default: `CDN_BASE`); `imageBytes` and `colorBytes` bound the engine's caches
  (default 192 MB and 128 MB).
- `avatars.select(seed, overrides)` gives the selection of a seed:
  `{ t, face, expr, tone, eye, hair, hair_color, beard, glasses, hat, cloth, cloth_color, bg }`. `overrides` fixes
  any of these; the other choices do not change.
- `avatars.options(t, face)` lists the values each field can take for a template (`'tF'` or `'tM'`) and a face.
- `avatars.render(seedOrSelection, { size, background, overrides, frame })` gives `{ width, height, data }` (RGBA).
  `size` is the output edge in pixels, up to 1024. `background` is `'#rrggbb'` or `'transparent'`.
- `avatars.toCanvas(...)`, `avatars.toBlob(..., { type, quality })` and `avatars.toURL(...)` take the same arguments.
  Call `URL.revokeObjectURL` on a URL from `toURL` when the image is no longer shown.
- `avatars.define(name = 'pixitoons-avatar')` registers the custom element.
- `VERSION`, `BUILD` (the build of the avatar files), `CDN_BASE`, `BACKGROUNDS`, `SELECTION_VERSION`.

Types are in `index.d.ts`.

## Where the avatar files come from

By default from jsDelivr, at the GitHub release of the installed version:
`https://cdn.jsdelivr.net/gh/pixitoons/pixitoons@v1.2.0/assets/`. A release cannot change after it is published, so
the code and the images of a version always belong together, and a site sees a new look only when it moves to a new
version itself.

To serve the files from your own site:

```sh
npx pixitoons copy-assets public/pixitoons     # copies them to public/pixitoons/1.2.0/ and checks every file
```

```js
const avatars = await createAvatars({ base: '/pixitoons/1.2.0/' });
```

`createAvatars` refuses files of another version with a message, so copy them again after an update.

What one avatar costs: composing takes about 0.2 to 1 second on a desktop, and the layer files of one avatar are
0.1 to 0.9 MB (0.4 MB typical). Once per site: `manifest.json` 266 KB and the code about 100 KB, before compression.

## Versions

Every release is a git tag `vX.Y.Z` with a GitHub release that cannot change after it is published.

- **Patch** (1.0.0 to 1.0.1): fixes that change no avatar.
- **Minor** (1.0.0 to 1.1.0): new features, and sharper or cleaner images. Every seed keeps its selection (the same
  face, expression, skin tone, hair, clothes and colours), so a person keeps their avatar.
- **Major** (1.x to 2.0.0): a seed may get another selection (for example when new hairstyles join the draw), or the
  API changes.

This is checked by code. `test/identity.txt` holds the selection of the seeds `seed0` to `seed999`; a pull request
that changes it is marked with a warning, and a release that changes it without raising the first number is refused.
`test/browser/golden/` holds rendered avatars, so a change of the look shows up in the pull request as an image diff.

### Updating a project

1. Read `CHANGELOG.md` for what changed.
2. In `package.json`, change the tag at the end of the dependency to the new version (for example `#v1.0.0` to
   `#v1.1.0`) and run `npm install`.
3. Check your pages, then deploy. Until you deploy, nothing changes for your visitors.

## Making a release

1. Bring in a new build of the avatar files: `node scripts/import-build.mjs <build_dir>` (add `--prune` when files
   were removed; on Windows they go to the Recycle Bin).
2. `npm test`, and the browser test: `python3 test/browser/render_test.py` (needs `pip install -r
   test/browser/requirements.txt` and `python -m playwright install chromium`). When the look changed on purpose,
   write the new golden images with `--update`. When seeds changed on purpose (a major version),
   `node scripts/identity.mjs --update`.
3. Add a `## <new version>` section to `CHANGELOG.md`, and commit everything (`git add -A`, `git commit`).
4. `npm version patch` (or `minor`, `major`): this sets the version in `package.json`, `src/version.js` and the
   addresses in this README, commits, and tags.
5. `git push --follow-tags`. The Release workflow runs the tests again, checks the version, the changelog and the
   seed identities, and publishes the GitHub release with the package file.

### Publishing to npm

The Release workflow publishes every release to npm as well, with npm's trusted publishing (no token). It was set up
once, like this:

1. An npm account with two-factor authentication.
2. The first version by hand, from the package file of the GitHub release: `npm login`, then
   `npm publish pixitoons-<version>.tgz --access public`, in a terminal window (npm asks for the second factor only
   there).
3. On npmjs.com, the package's settings: a trusted publisher for GitHub Actions, organization `pixitoons`,
   repository `pixitoons`, workflow `release.yml`, allowed to publish.
4. On GitHub, the repository's settings: Secrets and variables, Actions, Variables: `NPM_PUBLISH` = `true`.

## How the avatars are made

Every part (face, expression, hair, beard, glasses, headwear, clothing) was drawn once by an image model as an edit of
a bald template, cut out as a layer, and packed with maps for colours, skin tones and expressions. The engine in
`src/engine.js` puts the layers together for a selection: the face and its expression, clothing, beard, glasses and
hair, headwear, and the background, with each part fitted to the face shape.

## License

- Code: MIT, see `LICENSE`.
- Avatar files (everything under `assets/`) and every avatar composed from them: CC0 1.0, see `LICENSE-ASSETS`. No
  credit is needed, commercial use included.
- The images were made with openly licensed models, none of which limits the use of its outputs: Qwen-Image-2512,
  Qwen-Image-Edit-2511, the lightx2v Lightning LoRAs and Qwen3-VL-8B-Instruct (Apache-2.0), and
  BiRefNet_HR-matting (MIT).
