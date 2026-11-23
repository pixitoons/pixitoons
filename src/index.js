// Pixitoons, 3D avatar library: the entry of the package. It is avatars.js with one difference: by default the
// avatar files come from this exact version on the jsDelivr CDN, served from the GitHub release of this version,
// which cannot change. So the code and the images always belong together.
//
//   import { createAvatars } from 'pixitoons';
//   const avatars = await createAvatars();                   // in the browser
//   img.src = await avatars.toURL('dana', { size: 256 });    // the avatar of the seed "dana"
//
// Hosting the files yourself: `npx pixitoons copy-assets public/pixitoons` copies them to public/pixitoons/<version>/,
// then createAvatars({ base: '/pixitoons/<version>/' }).
import { createAvatars as createFrom } from './avatars.js';
import { BUILD, VERSION } from './version.js';

export { BACKGROUNDS, SELECTION_VERSION } from './avatars.js';
export { BUILD, VERSION };

// The avatar files of this version.
export const CDN_BASE = `https://cdn.jsdelivr.net/gh/pixitoons/pixitoons@v${VERSION}/assets/`;

// base: the folder that holds manifest.json, l/ and lut/ of this version (default CDN_BASE).
// imageBytes, colorBytes: memory budgets of the engine's caches.
export async function createAvatars({ base = CDN_BASE, imageBytes, colorBytes } = {}) {
  if (typeof document === 'undefined') {
    throw new Error('pixitoons: createAvatars() runs in the browser. Call it from client code, for example in useEffect.');
  }
  const avatars = await createFrom({ base, imageBytes, colorBytes });
  if (avatars.manifest.build !== BUILD) {
    throw new Error(`pixitoons ${VERSION}: the avatar files at ${base} are build ${avatars.manifest.build}, but this `
      + `version needs build ${BUILD}. Copy the files of this version: npx pixitoons copy-assets <folder>.`);
  }
  return avatars;
}
