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
//
// It runs on a page and in a Web Worker alike (render, toBlob, toURL, files, preload); toCanvas and define need a
// page. Each createAvatars() has its own engines and caches (see imageBytes and colorBytes).
//
// The layer files come in two sizes: l/ for the 1024 px frame, and half/l/ for 512 px. A render at 512 px or less
// loads the half-size files and composes at 512 (a quarter of the pixels to fetch, decode and draw); a larger one,
// the full-size files at 1024.
import { BACKGROUNDS, Engine, PARTS, SELECTION_VERSION, options, resize, select } from './engine.js';

export { BACKGROUNDS, PARTS, SELECTION_VERSION };

const onPage = typeof document !== 'undefined';
// Little-endian (every browser in use): a pixel of RGBA bytes is one 32-bit word with A in its high byte.
const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

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
  if (!onPage) throw new Error('pixitoons: toCanvas() needs a page; in a Web Worker use render(), toBlob() or toURL()');
  const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
  c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return c;
}

// The regions of a layer file (see the packing in pipeline/sprites.py), cut out row by row: 'c' the colour (alpha
// 255), 's' the shadow (alpha 255), 'm' the mask: R the alpha of the colour region, G and B the class weights, A
// the brow weight (W: only rows W[4] to W[4] + W[3] of the layer carry one) or 255 for a layer without W.
function cut(img, sp, kind) {
  const W = img.width, d = img.data, [, , w, h] = sp.C, out = new Uint8ClampedArray(w * h * 4);
  if (kind !== 'm') {
    const r = kind === 'c' ? sp.C : sp.S;
    if (LE) {
      const s32 = new Uint32Array(d.buffer, d.byteOffset, d.length >> 2), o32 = new Uint32Array(out.buffer);
      for (let y = 0; y < h; y++) {
        const s0 = (r[1] + y) * W + r[0], o0 = y * w;
        for (let x = 0; x < w; x++) o32[o0 + x] = s32[s0 + x] | 0xff000000;
      }
    } else {
      for (let y = 0; y < h; y++) {
        for (let x = 0, s0 = ((r[1] + y) * W + r[0]) * 4, o0 = y * w * 4; x < w; x++, s0 += 4, o0 += 4) {
          out[o0] = d[s0]; out[o0 + 1] = d[s0 + 1]; out[o0 + 2] = d[s0 + 2]; out[o0 + 3] = 255;
        }
      }
    }
    return out;
  }
  const C = sp.C, G = sp.G, B = sp.B, Wr = sp.W;
  for (let y = 0; y < h; y++) {
    const o0 = y * w * 4, c0 = ((C[1] + y) * W + C[0]) * 4 + 3;
    const g0 = G ? ((G[1] + y) * W + G[0]) * 4 : -1, b0 = B ? ((B[1] + y) * W + B[0]) * 4 : -1;
    const wy = Wr ? y - Wr[4] : -1, w0 = Wr && wy >= 0 && wy < Wr[3] ? ((Wr[1] + wy) * W + Wr[0]) * 4 : -1;
    for (let x = 0; x < w; x++) {
      const o = o0 + x * 4, x4 = x * 4;
      out[o] = d[c0 + x4];
      out[o + 1] = g0 >= 0 ? d[g0 + x4] : 0;
      out[o + 2] = b0 >= 0 ? d[b0 + x4] : 0;
      out[o + 3] = !Wr ? 255 : w0 >= 0 ? d[w0 + x4] : 0;
    }
  }
  return out;
}

// base: the folder that holds manifest.json, l/ and lut/ (default: the folder of this module).
// imageBytes, colorBytes: memory budgets of the engine's caches (see engine.js).
export async function createAvatars({ base, imageBytes, colorBytes } = {}) {
  // import.meta.url is read into a name first: bundlers (webpack, Turbopack, Vite) take the literal form
  // new URL('<path>', import.meta.url) for a file to copy into the bundle, and a folder there breaks the build.
  const here = import.meta.url;
  // on a page relative to the page, in a worker relative to the worker's script
  const from = onPage ? document.baseURI : self.location.href;
  const root = base ? new URL(base.endsWith('/') ? base : `${base}/`, from) : new URL('./', here);
  const get = async (rel) => {
    const res = await fetch(new URL(rel, root));
    if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`);
    return res;
  };
  const man = await (await get('manifest.json')).json();

  // Layers are packed one file per layer: the colour with its alpha, and below it the class weights and the
  // shadow as extra regions; the small eye patches of a face or an expression sit in the file of that layer. A
  // decoded sheet is kept only while its regions are being cut out, so it is not held in memory twice.
  // dir: the folder of a set's layer files (l/ or half/l/); sprites: its regions (manifest.sprites, or
  // manifest.half.sprites). The colour maps (lut/) are the same for both sizes.
  const loader = (dir, sprites) => {
    const sheets = new Map();
    const sheet = (stem) => {
      if (!sheets.has(stem)) {
        const p = get(`${dir}${stem}.webp`).then(async (r) => decode(await r.blob()));
        sheets.set(stem, p);
        const forget = () => setTimeout(() => { if (sheets.get(stem) === p) sheets.delete(stem); }, 4000);
        p.then(forget, () => sheets.delete(stem));
      }
      return sheets.get(stem);
    };
    return async (rel) => {
      const part = rel.match(/^l\/(.+)\.([cms])\.webp$/);
      const sp = part && sprites && sprites[part[1]];
      if (!sp) {
        const d = await decode(await (await get(rel)).blob());
        return { width: d.width, height: d.height, data: d.data };
      }
      const img = await sheet(sp.f);
      return { width: sp.C[2], height: sp.C[3], data: cut(img, sp, part[2]) };
    };
  };
  const HALF = man.half ? Math.round(man.size * man.half.scale) : 0;
  const small = (size) => size != null && size <= HALF;
  // the file a path of the engine is read from: a region of a layer's sheet (a sheet has the same name in both
  // sizes), or a file of its own (lut/)
  const fileOf = (rel, half) => {
    const part = rel.match(/^l\/(.+)\.([cms])\.webp$/);
    const sp = part && man.sprites && man.sprites[part[1]];
    return sp ? `${half && man.half ? 'half/' : ''}l/${sp.f}.webp` : rel;
  };

  const engine = new Engine(man, loader('l/', man.sprites), { imageBytes, colorBytes });
  // The engine of the half-size files, made at the first small render. A build without them (manifest.half)
  // renders small sizes from the full-size files.
  let halfEngine = null;
  const engineFor = (size) => {
    if (!small(size) || !man.half) return Promise.resolve(engine);
    halfEngine ??= new Engine(man, loader('half/l/', man.half.sprites), { imageBytes, colorBytes, scale: man.half.scale });
    return Promise.resolve(halfEngine);
  };
  const selOf = (x, overrides) => (typeof x === 'object' && x ? { ...x } : select(x, man, overrides));
  const api = {
    manifest: man,
    engine,
    // The engine that renders at a size: the half-size one at 512 px and below (for tools and tests).
    engineFor,
    // The selection a seed gives: {t, face, expr, tone, eye, hair, hair_color, beard, glasses, hat, cloth,
    // cloth_color, bg}. `overrides` fixes any of them; the other choices do not change.
    select: (seed, overrides = {}) => select(seed, man, overrides),
    // The values each option can take for a template (and, for per-face parts, a face).
    options: (t, face = null) => options(man, t, face),
    // The addresses of the files a render of a seed or a selection fetches, each once, for the size it renders at
    // (size: as in render; none: the full-size files). A host can fetch them ahead, or list them for a service
    // worker. All the files of one render are fetched together, not one after another.
    files(seedOrSelection, { overrides, size } = {}) {
      const half = small(size);
      return [...new Set(engine.needs(selOf(seedOrSelection, overrides)).map((p) => fileOf(p, half)))]
        .map((f) => new URL(f, root).href);
    },
    // Fetches and decodes, all at once, the files of seeds or selections for renders at a size into the caches of
    // the engine of that size (within imageBytes), so their renders only compose. Resolves when all are in.
    async preload(seedsOrSelections, { overrides, size } = {}) {
      const eng = await engineFor(size);
      const list = Array.isArray(seedsOrSelections) ? seedsOrSelections : [seedsOrSelections];
      const paths = new Set(list.flatMap((x) => eng.needs(selOf(x, overrides))));
      await Promise.all([...paths].map((p) => eng.img(p)));
    },
    // Renders a seed (text) or a selection (object) to {width, height, data: RGBA bytes}.
    // size: output edge in pixels, up to manifest.size (none: manifest.size). At 512 and below it composes from the
    // half-size files at 512, above that from the full-size files at 1024, and scales down to size.
    // background: '#rrggbb' or 'transparent'.
    // parts: names of PARTS (for example ['cloth']), from the same compose as the picture, which stays the same.
    // The result then also has parts[name] = {cover: Uint8ClampedArray of size * size, how much of each pixel the
    // part makes up in the picture after everything drawn over it (0 to 255); without: the picture with the part cut
    // out and its shadows undone, as {width, height, data}: transparent (or the background) where the part was,
    // since what it covers is not drawn again (the head without its garment, for a body that wears it); tones:
    // {mean, dark, light} of the part as it shows, as '#rrggbb', or null when nothing of it shows (no such part, or
    // stubble, which is only a shade of the skin)}. To see what lies under a beard, glasses or a hat instead,
    // render again with it set to 'none' in overrides.
    async render(seedOrSelection, { size, background, overrides, frame = true, parts } = {}) {
      const sel = selOf(seedOrSelection, overrides);
      if (background !== undefined) sel.bg = background;
      const img = await (await engineFor(size)).compose(sel, { frame, parts });
      const n = size && size < img.width ? Math.max(1, Math.round(size)) : img.width;
      const fit = (im) => (n < im.width ? resize(im, n) : im);
      const out = fit(img);
      if (!img.parts) return out;
      const res = { width: out.width, height: out.height, data: out.data, parts: {} };
      for (const [name, pt] of Object.entries(img.parts)) {
        res.parts[name] = { cover: coverAt(pt.cover, img.width, n), without: fit(pt.without), tones: pt.tones };
      }
      return res;
    },
    async toCanvas(seedOrSelection, opts) {
      return canvasOf(await api.render(seedOrSelection, opts));
    },
    async toBlob(seedOrSelection, opts = {}) {
      if (!onPage) { // a worker: an OffscreenCanvas encodes it
        const img = await api.render(seedOrSelection, opts);
        const c = new OffscreenCanvas(img.width, img.height);
        c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
        return c.convertToBlob({ type: opts.type || 'image/png', quality: opts.quality });
      }
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
      if (!onPage || typeof customElements === 'undefined') throw new Error('pixitoons: define() needs a page');
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

// A part's cover (0 to 1, n0 x n0) as bytes at n x n, averaged over the area of each output pixel as resize() does.
function coverAt(cover, n0, n) {
  const out = new Uint8ClampedArray(n * n);
  if (n >= n0) {
    for (let i = 0; i < n0 * n0; i++) out[i] = cover[i] * 255 + 0.5;
    return out;
  }
  const r = n0 / n;
  for (let y = 0; y < n; y++) {
    const y0 = y * r, y1 = (y + 1) * r;
    for (let x = 0; x < n; x++) {
      const x0 = x * r, x1 = (x + 1) * r;
      let v = 0, W = 0;
      for (let sy = Math.floor(y0); sy < y1; sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        for (let sx = Math.floor(x0); sx < x1; sx++) {
          const w = wy * (Math.min(sx + 1, x1) - Math.max(sx, x0));
          W += w;
          v += cover[sy * n0 + sx] * w;
        }
      }
      out[y * n + x] = (v / W) * 255 + 0.5;
    }
  }
  return out;
}
