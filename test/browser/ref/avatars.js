// Browser entry of Pixitoons, the 3D avatar library. It loads the manifest and the packed layer files from one
// folder on any static host and renders avatars on the visitor's device: no server, and a seed always gives the
// same avatar.
//
//   import { createAvatars } from './avatars.js';
//   const avatars = await createAvatars();                        // the files next to this module
//   img.src = await avatars.toURL('dana', { size: 256 });         // the avatar of the seed "dana"
//   const sel = avatars.select('dana', { hair_color: 'ginger' });  // or build one: seed plus chosen options
//   const blob = await avatars.toBlob(sel, { size: 512, background: 'transparent' });
//
// As an element: avatars.define() registers <pixitoons-avatar seed="dana" size="96" background="transparent">.
import { BACKGROUNDS, Engine, SELECTION_VERSION, options, resize, select } from './engine.js';

export { BACKGROUNDS, SELECTION_VERSION };

async function decode(blob) {
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height)
    : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  if (bmp.close) bmp.close();
  return ctx.getImageData(0, 0, c.width, c.height);
}

function canvasOf(img) {
  const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
  c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return c;
}

// base: the folder that holds manifest.json, l/ and lut/ (default: the folder of this module).
// imageBytes, colorBytes: memory budgets of the engine's caches (see engine.js).
export async function createAvatars({ base, imageBytes, colorBytes } = {}) {
  // import.meta.url is read into a name first: bundlers (webpack, Turbopack, Vite) take the literal form
  // new URL('<path>', import.meta.url) for a file to copy into the bundle, and a folder there breaks the build.
  const here = import.meta.url;
  const root = base ? new URL(base.endsWith('/') ? base : `${base}/`, document.baseURI) : new URL('./', here);
  const get = async (rel) => {
    const res = await fetch(new URL(rel, root));
    if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`);
    return res;
  };
  const man = await (await get('manifest.json')).json();

  // Layers are packed one file per layer: the colour with its alpha, and below it the class weights and the
  // shadow as extra regions; the small eye patches of a face or an expression sit in the file of that layer. A
  // decoded sheet is kept only while its regions are being cut out, so it is not held in memory twice.
  const sheets = new Map();
  const sheet = (stem) => {
    if (!sheets.has(stem)) {
      const p = get(`l/${stem}.webp`).then(async (r) => decode(await r.blob()));
      sheets.set(stem, p);
      const forget = () => setTimeout(() => { if (sheets.get(stem) === p) sheets.delete(stem); }, 4000);
      p.then(forget, () => sheets.delete(stem));
    }
    return sheets.get(stem);
  };
  const loadImage = async (rel) => {
    const part = rel.match(/^l\/(.+)\.([cms])\.webp$/);
    const sp = part && man.sprites && man.sprites[part[1]];
    if (!sp) {
      const d = await decode(await (await get(rel)).blob());
      return { width: d.width, height: d.height, data: d.data };
    }
    const img = await sheet(sp.f);
    const W = img.width, d = img.data, [, , w, h] = sp.C, out = new Uint8ClampedArray(w * h * 4);
    const at = (r, i) => ((r[1] + Math.floor(i / w)) * W + r[0] + (i % w)) * 4;
    for (let i = 0; i < w * h; i++) {
      const q = i * 4;
      if (part[2] === 'c') {
        const p = at(sp.C, i);
        out[q] = d[p]; out[q + 1] = d[p + 1]; out[q + 2] = d[p + 2];
      } else if (part[2] === 'm') {
        out[q] = d[at(sp.C, i) + 3];
        out[q + 1] = sp.G ? d[at(sp.G, i)] : 0;
        out[q + 2] = sp.B ? d[at(sp.B, i)] : 0;
        // W: the brow weight of a face layer, in the mask's alpha. Its region holds only the layer rows from
        // W[4] on that carry brows; every other row has none.
        const rw = sp.W, y = rw ? Math.floor(i / w) - rw[4] : -1;
        out[q + 3] = !rw ? 255 : y >= 0 && y < rw[3] ? d[((rw[1] + y) * W + rw[0] + (i % w)) * 4] : 0;
        continue;
      } else {
        const p = at(sp.S, i);
        out[q] = d[p]; out[q + 1] = d[p + 1]; out[q + 2] = d[p + 2];
      }
      out[q + 3] = 255;
    }
    return { width: w, height: h, data: out };
  };

  const engine = new Engine(man, loadImage, { imageBytes, colorBytes });
  const api = {
    manifest: man,
    engine,
    // The selection a seed gives: {t, face, expr, tone, eye, hair, hair_color, beard, glasses, hat, cloth,
    // cloth_color, bg}. `overrides` fixes any of them; the other choices do not change.
    select: (seed, overrides = {}) => select(seed, man, overrides),
    // The values each option can take for a template (and, for per-face parts, a face).
    options: (t, face = null) => options(man, t, face),
    // Renders a seed (text) or a selection (object) to {width, height, data: RGBA bytes}.
    // size: output edge in pixels, up to manifest.size. background: '#rrggbb' or 'transparent'.
    async render(seedOrSelection, { size, background, overrides, frame = true } = {}) {
      const sel = typeof seedOrSelection === 'object' && seedOrSelection ? { ...seedOrSelection }
        : select(seedOrSelection, man, overrides);
      if (background !== undefined) sel.bg = background;
      const img = await engine.compose(sel, { frame });
      return size && size < img.width ? resize(img, Math.max(1, Math.round(size))) : img;
    },
    async toCanvas(seedOrSelection, opts) {
      return canvasOf(await api.render(seedOrSelection, opts));
    },
    async toBlob(seedOrSelection, opts = {}) {
      const c = await api.toCanvas(seedOrSelection, opts);
      return new Promise((done) => c.toBlob(done, opts.type || 'image/png', opts.quality));
    },
    // An object URL for an <img>; call URL.revokeObjectURL on it when the image is no longer shown.
    async toURL(seedOrSelection, opts) {
      return URL.createObjectURL(await api.toBlob(seedOrSelection, opts));
    },
    // Registers a custom element: <pixitoons-avatar seed="dana" size="96" background="#d6e4f5">.
    // Other attributes fix options, for example hair="pixie" or hair_color="ginger".
    define(name = 'pixitoons-avatar') {
      if (customElements.get(name)) return;
      const keys = ['t', 'face', 'expr', 'tone', 'eye', 'hair', 'hair_color', 'beard', 'glasses', 'hat', 'cloth', 'cloth_color'];
      customElements.define(name, class extends HTMLElement {
        static get observedAttributes() { return ['seed', 'size', 'background', ...keys]; }

        connectedCallback() { this.draw(); }

        attributeChangedCallback() { if (this.isConnected) this.draw(); }

        async draw() {
          const turn = (this.turn = (this.turn || 0) + 1);
          const size = Number(this.getAttribute('size')) || 128;
          const px = Math.min(man.size, Math.round(size * (window.devicePixelRatio || 1))); // sharp on dense screens
          const overrides = Object.fromEntries(keys.filter((k) => this.hasAttribute(k)).map((k) => [k, this.getAttribute(k)]));
          const bg = this.getAttribute('background');
          if (bg) overrides.bg = bg;
          const c = await api.toCanvas(this.getAttribute('seed') || '', { size: px, overrides });
          if (turn !== this.turn) return; // a newer draw has started
          c.style.cssText = `width:${size}px;height:${size}px;display:block;border-radius:inherit`;
          c.setAttribute('role', 'img');
          c.setAttribute('aria-label', this.getAttribute('alt') || 'avatar');
          this.style.display = this.style.display || 'inline-block';
          this.replaceChildren(c);
        }
      });
    },
  };
  return api;
}
