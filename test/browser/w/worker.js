// Loaded by render_test.py as a module Web Worker, through page.html: the package where there is no page. base is
// read against this script, so 'files/' is test/browser/w/files/ (the test server answers it from assets/); read
// against the page it would be test/browser/files/, which does not exist.
import * as lib from '../../../src/index.js';

self.onmessage = async ({ data: { base, seed, size } }) => {
  const out = {};
  try {
    const avatars = await lib.createAvatars({ base });
    out.img = await avatars.render(seed, { size, background: 'transparent' });
    const blob = await avatars.toBlob(seed, { size: 64 });
    out.blob = [blob.type, blob.size];
    out.files = avatars.files(seed);
    out.canvas = await avatars.toCanvas(seed, { size: 64 }).then(() => 'made a canvas', (e) => e.message);
    try {
      avatars.define();
      out.define = 'defined';
    } catch (e) {
      out.define = e.message;
    }
  } catch (e) {
    out.error = String((e && e.stack) || e);
  }
  self.postMessage(out);
};
