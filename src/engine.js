// 2.5D avatar engine: seeded part selection and layer compositing on plain RGBA buffers.
// Runs unchanged in the browser and in Node; image decoding is supplied by the caller.

// Version of the seed -> selection rule. A seed gives the same selection for as long as this number and the
// manifest's option lists stay the same; growing a list changes only the seeds that pick the new option.
export const SELECTION_VERSION = 3;

// ------------------------------------------------------------------ seeded choices
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

// A fixed number in (0, 1) for a seed, a category and one option of that category.
function unit(seed, cat, opt) {
  return (xmur3(`${seed}\u0001${cat}\u0001${opt}`)() + 0.5) / 4294967296;
}

// Options that seeds never draw: they are chosen only by name (an override, or a picker built from options()). An
// option that joins in a minor version waits here, so every seed keeps its selection; a major version can move it
// into the draw. goatee_mustache (1.5.0) has the images that "goatee" had up to 1.4.0, under a name that says what
// they show; "goatee" itself is now on the chin only. The other six tones of the Monk scale and light brown hair
// (1.9.0) wait here too.
const ON_REQUEST = { beard: ['goatee_mustache'], tone: [1, 3, 5, 6, 8, 10], hair_color: ['lightbrown'] };

// Weighted choice that stays put when a list grows: every option has its own fixed draw for the seed, and the
// smallest draw divided by its weight wins (so an option is chosen with probability weight / total). Adding an
// option changes only the seeds that now pick it; removing one changes only the seeds that had picked it.
function pick(seed, cat, items) {
  let best = items[0][0], low = Infinity;
  for (const [v, w] of items) {
    if (!(w > 0) || ON_REQUEST[cat]?.includes(v)) continue;
    const score = -Math.log(unit(seed, cat, v)) / w;
    if (score < low) { low = score; best = v; }
  }
  return best;
}

export const BACKGROUNDS = ['#f3d9c8', '#cfe8dc', '#d6e4f5', '#efe2b8', '#e4d7f2', '#f6d4dc', '#d9e6c3', '#d8d8d8'];

// Option lists. The first value of each colour list is the source colour (no colour map).
// Expressions, beards and glasses are made per face: with a face given, only the ones it has are listed.
export function options(man, t, face = null) {
  const o = man.options;
  const masc = man.templates[t].gender === 'masc';
  const on = (kind, v) => !face || `${t}.${face}.${kind}.${v}` in man.layers;
  return {
    t: Object.keys(man.templates),
    face: (o.face && o.face[t]) || ['f1', 'f2', 'f3'],
    expr: o.expr.filter((e) => e === 'neutral' || on('e', e)),
    tone: o.tone,
    eye: o.eye,
    hair: ['bald', ...o.hair[t]],
    hair_color: o.hair_color,
    beard: masc ? ['none', ...o.beard.filter((b) => on('b', b))] : ['none'],
    glasses: ['none', ...o.glasses.filter((g) => on('g', g))],
    hat: ['none', ...o.hat[t]],
    cloth: o.cloth,
    cloth_color: ['gray', ...o.cloth_color],
    bg: BACKGROUNDS,
  };
}

// Every category has its own draws, so overriding one choice never changes the others
// (the DiceBear contract: seed + options -> one fixed avatar).
const EXPR_W = { neutral: 4, wide: 3, smile: 3, oh: 1.5, laugh: 1.5, wink: 1, smirk: 1, sad: 0.7, angry: 0.7,
  tongue: 0.8, skeptical: 0.8, kiss: 0.8, sleepy: 0.7 };
const EYE_W = { darkbrown: 2 };
const HAIR_COLOR_W = { darkbrown: 7, black: 6, golden: 4, ginger: 3 };
// Pairings by the skin tone the seed draws: light hair and light eyes are rarer with the two darker tones (a
// factor on the weights above). Every pairing stays available: an override sets any value.
const TONE_W = { 7: { hair_color: { golden: 0.35, ginger: 0.35 }, eye: { green: 0.5, blue: 0.5 } },
  9: { hair_color: { golden: 0.15, ginger: 0.15 }, eye: { green: 0.25, blue: 0.25 } } };
// The light hair colours, and the share of a beard's own dark brown kept under each where a beard has no recolour
// of the model's (tuned by eye on full and short beards).
const BEARD_MIX = { golden: 0.35, ginger: 0.2, lightbrown: 0.5 };
// Hair behind the face (see Engine.hairBehind): rows of the fade in and out, px from an outline, and the reach of
// the depths.
const BEHIND_IN = 24, BEHIND_OUT = 40, BEHIND_EDGE = 3, BEHIND_DEPTH = 40, BEHIND_FADE = 8, FRONT_OUT = 3;
const DEPTH_LIM = 64, FILL_SOLID = [0.75, 0.95], FILL_REACH = 8, FILL_TOUCH = [0.2, 0.6];
// Below the chin line of a face a garment comes in over this many px (see Engine.headAbove).
const HEAD_SOFT = 8;
// The same lengths in pixels of a frame drawn at scale k of the 1024 px one (see Engine: k).
const behindAt = (k) => ({ IN: BEHIND_IN * k, OUT: BEHIND_OUT * k, EDGE: BEHIND_EDGE * k, DEPTH: BEHIND_DEPTH * k,
  FADE: BEHIND_FADE * k, FRONT: FRONT_OUT * k, LIM: DEPTH_LIM * k, ONE: k });

// Signed distance to the outline of a region (px, > 0 inside; inside: coverage of 0.5 or more), from its coverage
// cov (w x h, row by row): a two-pass chamfer distance (steps 3 and 4: within 4 % of the Euclidean), clamped at
// +-lim. On the soft edge (coverage between 0 and 1, next to the outline) the depth comes from the coverage itself,
// so it runs on smoothly through the edge.
function signedDepth(cov, w, h, lim) {
  const n = w * h, din = new Float32Array(n), dout = new Float32Array(n), big = 3 * lim + 3;
  for (let k = 0; k < n; k++) {
    if (cov[k] >= 0.5) din[k] = big; else dout[k] = big;
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i, d = din[k] > 0 ? din : dout;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + 3);
      if (j > 0) {
        v = Math.min(v, d[k - w] + 3);
        if (i > 0) v = Math.min(v, d[k - w - 1] + 4);
        if (i < w - 1) v = Math.min(v, d[k - w + 1] + 4);
      }
      d[k] = v;
    }
  }
  for (let j = h - 1; j >= 0; j--) {
    for (let i = w - 1; i >= 0; i--) {
      const k = j * w + i, d = din[k] > 0 ? din : dout;
      let v = d[k];
      if (i < w - 1) v = Math.min(v, d[k + 1] + 3);
      if (j < h - 1) {
        v = Math.min(v, d[k + w] + 3);
        if (i < w - 1) v = Math.min(v, d[k + w + 1] + 4);
        if (i > 0) v = Math.min(v, d[k + w - 1] + 4);
      }
      d[k] = v;
    }
  }
  const dep = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let v = din[k] > 0 ? din[k] / 3 - 0.5 : 0.5 - dout[k] / 3;
    if (v > -1.5 && v < 1.5 && cov[k] > 0.02 && cov[k] < 0.98) v = cov[k] - 0.5;
    dep[k] = v < -lim ? -lim : v > lim ? lim : v;
  }
  return dep;
}

// The pixels of the frame the pass after the clothing draws (dd: the depth of the outline that is drawn): from
// BEHIND_DEPTH px outside that outline to the soft edge of the skin (deeper in, the skin hides the hair; farther
// out, nothing lies over it and behindFront draws it).
function behindNear(dd, x, y) {
  const d = depthAt(dd, x, y);
  return d > -dd.c.DEPTH && d <= 1.5;
}

// The depth of a field d (see signedDepth) at a point, and its inward normal into n; NaN outside its box.
function depthAt(d, x, y, n = null) {
  const i = Math.round(x) - d.x0, j = Math.round(y) - d.y0;
  if (i < 0 || j < 0 || i >= d.w || j >= d.h) return NaN;
  const k = j * d.w + i;
  if (n) { n[0] = d.nx[k]; n[1] = d.ny[k]; }
  return d.dep[k];
}

// Hair behind the face at a source point o of a hair layer (template space; b: see Engine.hairBehind; alpha(x, y):
// the layer's alpha), for the pass drawn after the clothing, under the skin that shows: o[2] the alpha factor (0:
// nothing). Outside the template's outline (from BEHIND_EDGE px out) the hair itself. Inside it, only where the hair
// just outside that line is solid (alpha from FILL_SOLID[0], in full from [1]; none where the model left an opening
// between hair and face, beside braids, so the opening stays clear): the hair mirrored along the normal about the
// line (where the mirror image falls into an opening, the hair just outside the line), fading out over the last
// BEHIND_FADE px of BEHIND_DEPTH.
// The template's outline is that of its skin: not of its own t-shirt, nor of the shoulders under it (see
// Engine.shirtTop); hair over the shoulders lies over the garment, not behind anything.
const NRM = new Float64Array(2);
function behindBack(b, o, alpha) {
  const c = b.c, sy = Math.round(o[1]), z = sy >= 0 && sy < b.z.length ? b.z[sy] : 0;
  const dt = z > 0 ? depthAt(b.d, o[0], o[1], NRM) : NaN;
  if (dt !== dt) { o[2] = 0; return; }
  if (dt <= -c.EDGE) return;
  if (dt >= c.DEPTH) { o[2] = 0; return; }
  // Where the hair touches the line (alpha just outside it from FILL_TOUCH[0], in full from [1]) its edge against
  // the face is soft over a few px: the solid hair is looked for up to FILL_REACH px out from the line, and the
  // mirror line moves out to where it begins (so the soft edge, as the model drew it against the template's skin, is
  // not copied in as a see-through band with dark lines in it). Where it does not, there is an opening beside the
  // face: nothing.
  const a1 = alpha(Math.round(o[0] - (dt + c.EDGE + c.ONE) * NRM[0]), Math.round(o[1] - (dt + c.EDGE + c.ONE) * NRM[1]));
  const touch = Math.min(1, (a1 - FILL_TOUCH[0]) / (FILL_TOUCH[1] - FILL_TOUCH[0]));
  if (touch <= 0) { o[2] = 0; return; }
  let s0 = 0, best = 0;
  for (let s = 1; s <= FILL_REACH; s++) {
    const a = alpha(Math.round(o[0] - (dt + c.EDGE + s * c.ONE) * NRM[0]), Math.round(o[1] - (dt + c.EDGE + s * c.ONE) * NRM[1]));
    if (a > best) { best = a; s0 = s; }
    if (a >= FILL_SOLID[1]) break;
  }
  const edge = Math.min(1, Math.max(0, (best - FILL_SOLID[0]) / (FILL_SOLID[1] - FILL_SOLID[0])));
  if (edge <= 0) { o[2] = 0; return; }
  const line = dt + c.EDGE + (s0 - 1) * c.ONE;
  const ex = Math.round(o[0] - (line + c.ONE) * NRM[0]), ey = Math.round(o[1] - (line + c.ONE) * NRM[1]);
  const mx = Math.round(o[0] - (2 * line + c.ONE) * NRM[0]), my = Math.round(o[1] - (2 * line + c.ONE) * NRM[1]);
  if (alpha(mx, my) >= 0.5) { o[0] = mx; o[1] = my; } else { o[0] = ex; o[1] = ey; }
  o[2] *= touch * edge * (dt > c.DEPTH - c.FADE ? (c.DEPTH - dt) / c.FADE : 1);
}

// The hair drawn over the face at a pixel (x, y) of the frame whose source point is o (b: see Engine.hairBehind;
// dd: the depth of the outline that is drawn, in the frame). Above and below the rows, and BEHIND_DEPTH px or more
// outside the outline that is drawn: all of it (nothing lies over the hair there). Nearer outside it, from FRONT_OUT
// px: none (the pass after the clothing, behindNear, has it). Nearer still and inside: the hair at the same depth
// inside the template's outline, along its normal, moved that far by the weight of the row (so where the rows begin
// and end it comes to the face map's own point). Returns the alpha factor.
function behindFront(b, dd, x, y, o) {
  const sy = Math.round(o[1]), z = sy >= 0 && sy < b.z.length ? b.z[sy] : 0;
  if (z <= 0) return 1;
  const d = depthAt(dd, x, y), dt = depthAt(b.d, o[0], o[1], NRM);
  if (d !== d || dt !== dt || d <= -b.c.DEPTH) return 1;
  if (d <= -b.c.FRONT) return 0;
  const s = z * (d - dt);
  o[0] += s * NRM[0]; o[1] += s * NRM[1];
  return 1;
}

// The share of a brimmed or knitted hat's shadow that falls on the hair that comes out from under it (see compose).
const HAT_SHADE_HAIR = 0.5;
// Below the lower edge of a hat's side (hatZone) the hair comes out from under it no further than FLARE_W px outside the
// edge's outer end (reached over the first FLARE_D px down) and a curve that turns out from there, towards FLARE px
// sideways per px down (half of that FLARE_R px down).
const FLARE = 0.8, FLARE_R = 90, FLARE_W = 10, FLARE_D = 12;
// The most a row of hair is pressed together towards the head below a hat's side (the least share of its width kept).
const SQUEEZE_MIN = 0.06;
// Where hair comes out from under the lower edge of a hat's side: the part of the outline above the side's lowest point
// that moves in towards the face by at least MOUTH px per px down (over 25 rows), so faces down more than sideways.
const MOUTH = 1.5;
// A hat that covers the ears (a beanie) was drawn on the bald template, pulled down over the ears to the jaw. Over hair
// the image model draws it sitting on the hair (data/parts2/img/gt_tF_h_afro_medium_w_beanie.png): its edge over the
// forehead about 45 px higher, its sides ending above the ears, and the hair coming out from under it all round the
// face. So over hair (lift, see hatFit) the band of the hat below LIFT_PIVOT px above its lower edge over the
// forehead is drawn LIFT_C times shorter, and from where the band's lower edge then reaches LIFT_SIDE px below its
// middle, the sides end along a line that goes down LIFT_SLOPE px per px outwards.
const LIFT_PIVOT = 120, LIFT_C = 1.4, LIFT_SIDE = 82, LIFT_SLOPE = 0.35;
// Short hair at the sides of a hat is pressed down by the hat (see hatCut), far enough that its ends come out PRESS_OUT
// px below the lowest point of a side, when they end no more than PRESS_FROM px above that point.
const PRESS_OUT = 44, PRESS_FROM = 100;

export function select(seed, man, overrides = {}) {
  seed = String(seed);
  const even = (list) => list.map((v) => [v, 1]);
  const t = overrides.t in man.templates ? overrides.t : pick(seed, 't', even(Object.keys(man.templates)));
  const masc = man.templates[t].gender === 'masc';
  const s = { t };
  const faces = options(man, t).face;
  s.face = overrides.face != null && faces.includes(overrides.face) ? overrides.face : pick(seed, 'face', even(faces));
  const op = options(man, t, s.face);
  s.expr = pick(seed, 'expr', op.expr.map((e) => [e, EXPR_W[e] ?? 1]));
  s.tone = pick(seed, 'tone', even(op.tone));
  const byTone = (cat, v) => ((TONE_W[s.tone] || {})[cat] || {})[v] ?? 1; // the seed's own tone, not an override
  s.eye = pick(seed, 'eye', op.eye.map((e) => [e, (EYE_W[e] ?? 1) * byTone('eye', e)]));
  s.hair = pick(seed, 'hair', op.hair.map((h) => [h, h === 'bald' ? (masc ? 0.8 : 0.15) : 1]));
  s.hair_color = pick(seed, 'hair_color', op.hair_color.map((c) => [c, (HAIR_COLOR_W[c] ?? 2) * byTone('hair_color', c)]));
  s.beard = pick(seed, 'beard', op.beard.map((b) => [b, b === 'none' ? 2 : 1]));
  s.glasses = pick(seed, 'glasses', op.glasses.map((g) => [g, g === 'none' ? 3.5 : 1]));
  s.hat = pick(seed, 'hat', op.hat.map((h) => [h, h === 'none' ? 4.5 : 1]));
  s.cloth = pick(seed, 'cloth', even(op.cloth));
  s.cloth_color = pick(seed, 'cloth_color', even(op.cloth_color));
  s.bg = pick(seed, 'bg', even(op.bg));
  for (const [k, v] of Object.entries(overrides)) {
    if (k === 't' || k === 'face' || v == null || !op[k]) continue;
    if (k === 'bg') { // any colour, or no background at all
      if (v === 'transparent' || /^#[0-9a-f]{6}$/i.test(v)) s.bg = v;
      continue;
    }
    const hit = op[k].find((x) => String(x) === String(v)); // values may arrive as text (a URL, an attribute)
    if (hit !== undefined) s[k] = hit;
  }
  return s;
}

// ------------------------------------------------------------------ colour maps (3D LUT, trilinear)
export function lutFromImage(img, n) {
  // image layout: width n*n (x = b*n + r), height n (y = g); RGBA bytes
  const lut = new Float32Array(n * n * n * 3);
  const w = img.width;
  for (let g = 0; g < n; g++) {
    for (let b = 0; b < n; b++) {
      for (let r = 0; r < n; r++) {
        const p = (g * w + b * n + r) * 4;
        const q = ((r * n + g) * n + b) * 3;
        lut[q] = img.data[p] / 255;
        lut[q + 1] = img.data[p + 1] / 255;
        lut[q + 2] = img.data[p + 2] / 255;
      }
    }
  }
  return { n, lut };
}

// The share of the skin that shows between the hairs of a brow (see compose: brows under another hair colour).
const BROW_SKIN_SHOW = 0.3;
const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v) => (v <= 0.0031308 ? 12.92 * v : Math.min(1, 1.055 * v ** (1 / 2.4) - 0.055));
// The same two curves from tables (4096 steps, linear in between: within 0.01 of a level), for loops over many pixels.
const CURVE_N = 4096;
const LIN_T = Float32Array.from({ length: CURVE_N + 2 }, (_, i) => toLinear(Math.min(1, i / CURVE_N)));
const SRGB_T = Float32Array.from({ length: CURVE_N + 2 }, (_, i) => toSrgb(Math.min(1, i / CURVE_N)));
const curve = (T, v) => {
  const f = Math.min(Math.max(v, 0), 1) * CURVE_N, i = f | 0;
  return T[i] + (T[i + 1] - T[i]) * (f - i);
};

function applyLut(L, r, g, b, out, o) {
  const n = L.n, m = n - 1, lut = L.lut;
  const fr = Math.min(r * m, m - 1e-4), fg = Math.min(g * m, m - 1e-4), fb = Math.min(b * m, m - 1e-4);
  const r0 = fr | 0, g0 = fg | 0, b0 = fb | 0;
  const dr = fr - r0, dg = fg - g0, db = fb - b0;
  const s1 = n * n * 3, s2 = n * 3, s3 = 3;
  const base = r0 * s1 + g0 * s2 + b0 * s3;
  for (let c = 0; c < 3; c++) {
    const i = base + c;
    const c00 = lut[i] * (1 - db) + lut[i + s3] * db;
    const c01 = lut[i + s2] * (1 - db) + lut[i + s2 + s3] * db;
    const c10 = lut[i + s1] * (1 - db) + lut[i + s1 + s3] * db;
    const c11 = lut[i + s1 + s2] * (1 - db) + lut[i + s1 + s2 + s3] * db;
    out[o + c] = (c00 * (1 - dg) + c01 * dg) * (1 - dr) + (c10 * (1 - dg) + c11 * dg) * dr;
  }
}

// ------------------------------------------------------------------ bounded caches
// Least-recently-used cache with a byte budget: decoded layers are large (a 1024 px layer is 4 MB per image),
// so an unbounded cache grows with every option a visitor tries until a phone's tab runs out of memory.
class ByteCache {
  constructor(max) { this.max = max; this.bytes = 0; this.map = new Map(); }

  get(k) {
    const e = this.map.get(k);
    if (!e) return undefined;
    this.map.delete(k);
    this.map.set(k, e);
    return e.v;
  }

  set(k, v, size) {
    this.drop(k);
    this.map.set(k, { v, size });
    this.bytes += size;
    for (const [key, e] of this.map) {
      if (this.bytes <= this.max) break;
      if (key === k) continue;
      this.bytes -= e.size;
      this.map.delete(key);
    }
  }

  drop(k, only) {
    const e = this.map.get(k);
    if (!e || (only !== undefined && e.v !== only)) return;
    this.bytes -= e.size;
    this.map.delete(k);
  }
}

// The manifest of a frame drawn at scale k of its own (k = 0.5: 512 px), for the layer files made at that size
// (manifest.json of their folder: see avatars.js). Every position and length in it is multiplied by k. A layer's
// box is the one the files were cut to: the pixels 2i and 2i + 1 of the 1024 px frame make pixel i at 512 px, so
// it starts at floor(x * k) and ends at ceil((x + w) * k). Silhouette profiles keep -1 for an empty column, and
// maps their grids (only the origin and the spacing move) with their offsets scaled. Colours and options stay.
export function scaledManifest(man, k) {
  const prof = (a) => (a ? a.map((v) => (v < 0 ? v : v * k)) : a);
  const each = (o, f) => (o ? Object.fromEntries(Object.entries(o).map(([key, v]) => [key, f(v)])) : o);
  const layers = each(man.layers, (e) => {
    const x = Math.floor(e.x * k), y = Math.floor(e.y * k);
    const out = { ...e, x, y, w: Math.ceil((e.x + e.w) * k) - x, h: Math.ceil((e.y + e.h) * k) - y };
    for (const key of ['tp', 'pt', 'pb']) if (e[key]) out[key] = prof(e[key]);
    if (e.neck != null) out.neck = e.neck * k;
    return out;
  });
  const grid = (g) => ({ ...g, x: g.x * k, y: g.y * k, step: g.step * k }); // offsets: scaled where they are read
  return {
    ...man,
    size: Math.round(man.size * k),
    layers,
    bald_top: each(man.bald_top, prof),
    warps: each(man.warps, (faces) => each(faces, (w) => w.map((a) => a.map((v) => v * k)))),
    chin: each(man.chin, (faces) => each(faces, (c) => ({ ...c, x0: c.x0 * k, step: c.step * k,
      y: c.y.map((v) => v * k), dy: c.dy.map((v) => v * k) }))),
    behind: each(man.behind, (b) => ({ ...b, y0: b.y0 * k, y1: b.y1 * k })),
    rim: each(man.rim, (r) => ({ ...r, y: r.y * k, band: r.band * k })),
    ewarp: each(man.ewarp, grid),
    cfit: each(man.cfit, grid),
  };
}

// ------------------------------------------------------------------ compositing
export class Engine {
  // loadImage: async (relPath) -> {width, height, data: RGBA bytes}
  // scale: the size of the frame the engine draws, against the manifest's (1: manifest.size, 1024 px; 0.5: 512 px,
  // from layer files made at that size: see scaledManifest). Every length the engine works with follows it (k).
  constructor(man, loadImage, { imageBytes = 192e6, colorBytes = 128e6, scale = 1 } = {}) {
    this.base = man;
    this.k = scale;
    this.man = scale === 1 ? man : scaledManifest(man, scale);
    this.N = this.man.size;
    this.load = loadImage;
    this.cache = new Map(); // small derived data: colour maps, profiles, hat fits, face maps
    this.images = new ByteCache(imageBytes);
    this.colorCache = new ByteCache(colorBytes);
  }

  // Published files may carry short names (manifest.files: layer id -> file stem).
  fname(id) {
    return (this.man.files && this.man.files[id]) || id;
  }

  // A failed load is not kept: the next request for the file tries again.
  img(path) {
    let p = this.images.get(path);
    if (!p) {
      p = Promise.resolve().then(() => this.load(path));
      this.images.set(path, p, 0);
      p.then((im) => { if (this.images.map.has(path)) this.images.set(path, p, im.data.length); },
        () => this.images.drop(path, p));
    }
    return p;
  }

  lut(name) {
    if (!name) return Promise.resolve(null);
    const key = `lut:${name}`;
    if (!this.cache.has(key)) {
      const p = this.img(`lut/${name}.png`).then((im) => lutFromImage(im, this.man.lut));
      this.cache.set(key, p);
      p.catch(() => { if (this.cache.get(key) === p) this.cache.delete(key); });
    }
    return this.cache.get(key);
  }

  // The image files one compose() of selection s reads (paths as loadImage takes them), in a fixed order: the
  // same choices compose() makes, from the selection and the manifest alone. compose() starts them all at once, so
  // the files are fetched and decoded side by side and not one after another; avatars.js files() and preload() list
  // and load them for a host. The browser test checks this list against what compose() asks for, so a change to
  // compose() that reads another file has to change it too.
  needs(s) {
    const man = this.man, L = man.layers, t = s.t, has = (id) => !!id && id in L, out = new Set();
    // 's' is the shadow region, read only when the layer has one; lit = true: the light map of a face layer (rimLit),
    // in the same region
    const layer = (id, parts, lit = false) => {
      if (!has(id)) return;
      const f = this.fname(id);
      for (const k of parts) if (k !== 's' || L[id].s || lit) out.add(`l/${f}.${k}.webp`);
    };
    const lut = (name) => { if (name) out.add(`lut/${name}.png`); };
    const tile = (maps, key) => { const w = maps && maps[t]; return !!w && w.tiles[key] !== undefined && w.tiles[key] !== null; };
    const skin = s.tone !== man.options.base_tone ? `${t}.skin.${s.tone}` : null;
    const hairC = s.hair_color !== 'darkbrown' ? `${t}.hair.${s.hair_color}` : null;
    const clothC = s.cloth_color !== 'gray' ? `${t}.cloth.${s.cloth_color}` : null;
    const hatId = s.hat !== 'none' && has(`${t}.w.${s.hat}`) ? `${t}.w.${s.hat}` : null;
    const hideHair = hatId && L[hatId].mode === 'hide';
    const hairId = s.hair !== 'bald' && !hideHair && has(`${t}.h.${s.hair}`) ? `${t}.h.${s.hair}` : null;
    const exactHair = hairId && s.hair_color !== 'darkbrown' && has(`${hairId}.${s.hair_color}`) ? `${hairId}.${s.hair_color}` : null;
    const hairDraw = exactHair || hairId;
    const exprId = s.expr !== 'neutral' ? `${t}.${s.face}.e.${s.expr}` : null;
    const withExpr = has(exprId), ekey = `${s.face}.${s.expr}`;
    const bId = s.beard !== 'none' ? `${t}.${s.face}.b.${s.beard}` : null;
    const b = man.behind && man.behind[t], behindOn = !!hairId && !!b && b.y0 !== undefined;
    const behind = behindOn && L[hairDraw].y + L[hairDraw].h > b.y0;
    if (behindOn) layer(`${t}.f1.base`, ['m']); // hairBehind
    if (behind) layer(hairId, ['m']);
    // partCover: hair, headwear, a beard with its shadow; a wrapping hat follows the expression's map
    if (hairId) layer(hairId, ['m']);
    if (hatId) layer(hatId, ['m']);
    if (hatId && hideHair && withExpr && tile(man.ewarp, ekey)) lut(`${t}.ewarp`);
    if (has(bId)) { layer(bId, ['m', 's']); if (withExpr && tile(man.ewarp, ekey)) lut(`${t}.ewarp`); }
    // the face, its expression and eye colour (layerColor, rimLit, cheekFit)
    const baseId = `${t}.${s.face}.base`;
    lut(skin);
    layer(baseId, ['c', 'm']);
    if (L[baseId] && L[baseId].lt) layer(baseId, ['s'], true);
    if (withExpr) {
      layer(exprId, ['c', 'm']);
      if (L[exprId].lt) layer(exprId, ['s'], true);
      if (hatId && hideHair && tile(man.cfit, ekey)) lut(`${t}.cfit`);
    }
    const eyeId = s.eye !== 'darkbrown' ? `${t}.${s.face}.eye.${s.expr}.${s.eye}` : null;
    layer(eyeId, ['c', 'm']);
    // clothing, then the hair's colours
    const clothId = `${t}.c.${s.cloth}`;
    layer(clothId, ['s', 'c', 'm']);
    lut(clothC);
    // a garment that follows the chin lies behind the jaw of the expression (clothMap, headAbove)
    if (L[clothId] && L[clothId].jaw && man.chin && man.chin[t] && man.chin[t][s.face] && withExpr && tile(man.ewarp, ekey)) {
      lut(`${t}.ewarp`);
    }
    if (hairId) { layer(hairDraw, ['c', 'm']); if (!exactHair) lut(hairC); }
    // a beard, through the expression's map; its shadow from the dark brown layer when a colour has none
    if (has(bId)) {
      const exactBeard = s.hair_color !== 'darkbrown' && has(`${bId}.${s.hair_color}`) ? `${bId}.${s.hair_color}` : null;
      const beardDraw = exactBeard || bId;
      layer(L[beardDraw].s ? beardDraw : bId, ['s']);
      if (withExpr && tile(man.ewarp, ekey)) lut(`${t}.ewarp`);
      layer(beardDraw, ['c', 'm']);
      if (!exactBeard) lut(hairC);
    }
    const glId = s.glasses !== 'none' ? `${t}.${s.face}.g.${s.glasses}` : null;
    layer(glId, ['c', 'm', 's']);
    if (hairId) layer(L[hairDraw].s ? hairDraw : hairId, ['s']);
    if (hatId) layer(hatId, ['s', 'c', 'm']);
    return [...out];
  }

  // Colour of a layer after its colour maps, cached per layer and map combination.
  // A map may carry `sat`, the saturation kept after the map, and `mix`, the share of the layer's own colour
  // kept (beards: the hair maps are learned from glossy hair and are too strong for a matte beard).
  // An entry with `tint` (a change of the colour, [r, g, b] in 0..1) is no map: after the maps are blended, it
  // adds that change by its weight w (the brows of a face: hair of another colour in place of the brow hair).
  // The change is made in sRGB, so that the brow's strands keep the steps of lightness they have between them.
  // `own` and `mapped` are the colour the change is measured from, as the layer has it and after the maps: where
  // the hair is dense (by w^4), the strands keep the steps they have in the layer itself, which a dark skin map
  // flattens.
  async layerColor(id, maps) {
    const key = `${id}|${maps.map((m) => (m.tint ? `t${[...m.tint, ...m.own, ...m.mapped].map((v) => v.toFixed(5))}`
      : `${m.name || '-'}~${m.sat ?? ''}~${m.mix ?? ''}`)).join('|')}`;
    const hit = this.colorCache.get(key);
    if (hit) return hit;
    const e = this.man.layers[id];
    const f = this.fname(id);
    const [c, m] = await Promise.all([this.img(`l/${f}.c.webp`), this.img(`l/${f}.m.webp`)]);
    const luts = await Promise.all(maps.map((x) => this.lut(x.name)));
    const n = e.w * e.h;
    const out = new Float32Array(n * 3);
    const tmp = new Float32Array(3);
    for (let i = 0; i < n; i++) {
      const p = i * 4;
      const a = m.data[p];
      if (a === 0) continue;
      const r = c.data[p] / 255, g = c.data[p + 1] / 255, b = c.data[p + 2] / 255;
      let acc0 = 0, acc1 = 0, acc2 = 0, wsum = 0;
      for (let k = 0; k < maps.length; k++) {
        if (maps[k].tint) continue;
        const w = maps[k].weight(m.data, p);
        if (w <= 0) continue;
        if (luts[k]) applyLut(luts[k], r, g, b, tmp, 0);
        else { tmp[0] = r; tmp[1] = g; tmp[2] = b; }
        if (maps[k].sat != null) {
          const y = 0.2126 * tmp[0] + 0.7152 * tmp[1] + 0.0722 * tmp[2], st = maps[k].sat;
          tmp[0] = y + (tmp[0] - y) * st; tmp[1] = y + (tmp[1] - y) * st; tmp[2] = y + (tmp[2] - y) * st;
        }
        if (maps[k].mix) {
          const mx = maps[k].mix;
          tmp[0] += (r - tmp[0]) * mx; tmp[1] += (g - tmp[1]) * mx; tmp[2] += (b - tmp[2]) * mx;
        }
        acc0 += w * tmp[0]; acc1 += w * tmp[1]; acc2 += w * tmp[2]; wsum += w;
      }
      if (wsum < 1) { acc0 += (1 - wsum) * r; acc1 += (1 - wsum) * g; acc2 += (1 - wsum) * b; }
      else if (wsum > 1) { acc0 /= wsum; acc1 /= wsum; acc2 /= wsum; }
      for (let k = 0; k < maps.length; k++) {
        const tn = maps[k].tint;
        if (!tn) continue;
        const w = maps[k].weight(m.data, p);
        if (w <= 0) continue;
        const own = maps[k].own, mp = maps[k].mapped, w4 = w * w * w * w;
        acc0 = Math.min(1, Math.max(0, acc0 + w * tn[0] + w4 * (r - own[0] - (acc0 - mp[0]))));
        acc1 = Math.min(1, Math.max(0, acc1 + w * tn[1] + w4 * (g - own[1] - (acc1 - mp[1]))));
        acc2 = Math.min(1, Math.max(0, acc2 + w * tn[2] + w4 * (b - own[2] - (acc2 - mp[2]))));
      }
      out[i * 3] = acc0; out[i * 3 + 1] = acc1; out[i * 3 + 2] = acc2;
    }
    const res = { e, color: out, mask: m };
    this.colorCache.set(key, res, out.byteLength);
    return res;
  }

  // ---------------------------------------------------------------- geometry (template face space)
  // Silhouette profiles come every 4th column; -1 marks an empty column.
  prof(key, p) {
    const k = `prof:${key}`;
    if (!this.cache.has(k)) {
      const N = this.N, out = new Float32Array(N).fill(NaN), step = 4 * this.k;
      if (p) {
        for (let x = 0; x < N; x++) {
          const i = x / step, i0 = Math.min(Math.floor(i), p.length - 1), i1 = Math.min(i0 + 1, p.length - 1);
          const f = i - i0, u = p[i0], v = p[i1];
          if (u < 0 && v < 0) continue;
          out[x] = u < 0 ? v : v < 0 ? u : u * (1 - f) + v * f;
        }
      }
      this.cache.set(k, out);
    }
    return this.cache.get(k);
  }

  // Hair top per column.
  hairTop(hairId) {
    const k = `top:${hairId}`;
    if (!this.cache.has(k)) this.cache.set(k, { top: this.prof(hairId, this.man.layers[hairId].tp) });
    return this.cache.get(k);
  }

  // How far out the hair may come below the lowest point of a hat's side, d px below it (see hatCut).
  flare(d) {
    if (d <= 0) return 0;
    const k1 = this.k, u = Math.min(d / (FLARE_D * k1), 1);
    return FLARE_W * k1 * u * u * (3 - 2 * u) + (FLARE * d * d) / (d + FLARE_R * k1);
  }

  // How a hat sits on a hairstyle. A kippah ('top') moves up by the robust hair thickness under it (a bun or a
  // crest does not lift it). A brimmed or knitted hat ('part') grows a little to cover the hair's thickness and hides
  // the hair above its lower edge; what shows of the hair around it, see hatZone and hatCut.
  hatFit(t, hairId, hatId) {
    const k = `fit:${t}:${hairId}:${hatId}`;
    if (this.cache.has(k)) return this.cache.get(k);
    const N = this.N, man = this.man, hat = man.layers[hatId], k1 = this.k;
    const pt = this.prof(`${hatId}:pt`, hat.pt), pb = this.prof(`${hatId}:pb`, hat.pb);
    const bald = this.prof(`bald:${t}`, man.bald_top[t]);
    let x0 = N, x1 = -1, top = Infinity;
    for (let x = 0; x < N; x++) if (pt[x] === pt[x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); top = Math.min(top, pt[x]); }
    const hair = hairId ? this.hairTop(hairId) : null;
    const thickness = (xa, xb) => {
      const v = [];
      for (let x = Math.ceil(xa); x <= xb; x++) {
        if (hair.top[x] === hair.top[x] && bald[x] === bald[x]) v.push(Math.max(0, bald[x] - hair.top[x]));
      }
      if (!v.length) return 0;
      v.sort((p, q) => p - q);
      return v[Math.floor(0.35 * (v.length - 1))];
    };
    let fit;
    if (hat.mode === 'top') {
      const shift = hair ? -thickness(x0, x1) : 0;
      fit = { mode: 'top', shift, top: top + shift };
    } else {
      const w = x1 - x0, cx = (x0 + x1) / 2;
      // anchor: the hat's lower edge over the forehead (the middle third of its columns)
      const mid = [];
      for (let x = Math.round(cx - w / 6); x <= cx + w / 6; x++) if (pb[x] === pb[x]) mid.push(pb[x]);
      mid.sort((p, q) => p - q);
      const ay = mid.length ? mid[mid.length >> 1] : top + 200 * k1;
      let sx = 1, sy = 1, r0 = 0;
      if (hair) {
        const yr = ay - 30 * k1;
        const first = (arr, fromLeft) => {
          for (let i = 0; i < N; i++) { const x = fromLeft ? i : N - 1 - i; if (arr[x] === arr[x] && arr[x] <= yr) return x; }
          return null;
        };
        const hl = first(hair.top, true), hr = first(hair.top, false), bl = first(bald, true), br = first(bald, false);
        if (hl != null && bl != null) {
          const extra = Math.min(Math.max(((bl - hl) + (hr - br)) / 2, 0), 0.06 * w);
          sx = 1 + (2 * extra) / w;
          r0 = Math.min(Math.max(Math.min(cx - bl, br - cx) - 6 * k1, 0), 0.9 * w / 2);
        }
        const h = ay - top;
        sy = 1 + Math.min(thickness(cx - 0.25 * w, cx + 0.25 * w), 0.18 * h) / h;
      }
      // The hat grows wider only outside the width of the bare head (r0 from its middle): what lies over the face
      // stays where it is, so the opening for the face keeps its size and no gap opens beside the cheeks.
      const half = w / 2, k = (half - r0) / (half * sx - r0);
      const xl = cx - (cx - x0) * sx, xr = cx + (x1 - cx) * sx;
      const clip = new Float32Array(N).fill(NaN);
      const srcBottom = (x) => {
        const dxs = x - cx, rr = Math.abs(dxs);
        let xs = Math.round(rr <= r0 ? x : cx + Math.sign(dxs) * (r0 + (rr - r0) * k));
        xs = Math.min(Math.max(xs, x0), x1);
        for (let d = 0; d < 40 * k1; d++) {
          if (pb[xs + d] === pb[xs + d]) return pb[xs + d];
          if (pb[xs - d] === pb[xs - d]) return pb[xs - d];
        }
        return ay;
      };
      let lift = null;
      if (hair && hat.ears) {
        const P = ay - LIFT_PIVOT * k1, c = LIFT_C;
        const back = (b) => { // the row of the frame that shows the layer's row b
          const b0 = b > P ? P + (b - P) / c : b;
          return b0 < ay ? ay + (b0 - ay) * sy : b0;
        };
        const Y0 = back(ay) + LIFT_SIDE * k1, D = [Infinity, Infinity];
        for (const [i, dir] of [[0, -1], [1, 1]]) { // per side, how far out the band's lower edge reaches Y0
          for (let x = Math.round(cx); x >= Math.ceil(xl) && x <= Math.floor(xr); x += dir) {
            if (back(srcBottom(x)) >= Y0) { D[i] = Math.abs(x - cx); break; }
          }
        }
        // where the hat ends in each column: just below the band's lower edge (what lies further down in that column,
        // a piece of a side, is left out), and from D out along the line
        const cut = new Float32Array(N).fill(Infinity);
        for (let x = Math.max(0, Math.floor(xl) - 2); x <= Math.min(N - 1, Math.ceil(xr) + 2); x++) {
          const dd = x - cx, i = dd < 0 ? 0 : 1, dist = dd < 0 ? -dd : dd;
          cut[x] = dist < D[i] ? back(srcBottom(Math.min(Math.max(x, Math.ceil(xl)), Math.floor(xr)))) + 4 * k1
            : Y0 + LIFT_SLOPE * (dist - D[i]);
        }
        const ycut = (x) => { const i = Math.round(x); return i < 0 || i >= N ? Infinity : cut[i]; };
        lift = { P, c, back, ycut, soft: 3 * k1, shade: 24 * k1 };
      }
      for (let x = Math.ceil(xl); x <= Math.floor(xr); x++) {
        const b = srcBottom(x);
        clip[x] = (lift ? Math.min(lift.back(b), lift.ycut(x)) : b < ay ? ay + (b - ay) * sy : b) - 10 * k1;
      }
      fit = { mode: 'part', sx, sy, r0, k, ax: cx, ay, xl, xr, clip, lift, top: ay - (ay - top) * sy };
    }
    this.cache.set(k, fit);
    return fit;
  }

  // The outline of a brimmed or knitted hat on each side of the face, from its mask as the fit places it (template
  // face space; hm: the hat's mask image). L and R: per row, the outermost point of the hat on that side (out, NaN in
  // a row where that side has none); the lowest point of that side (lx, low), followed down the outline from the
  // hat's widest row (a jump of more than 12 px in a row ends it); and the side's lower edge above that point, the
  // part of the outline that faces down (MOUTH), from its outer end (x, y). Beside the hat, above that edge, no hair
  // shows outside the outline: hair there hung behind the hat ("Afro puffs", "Short locs" under a beanie). The hair
  // comes out from under the hat inside its outline (under the rim, and between a flap and the cheek, where the ear
  // comes out), from under that lower edge (where a flap lies over the ear), and below it.
  hatZone(t, hairId, hatId, fit, hm) {
    const key = `zone:${t}:${hairId}:${hatId}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const N = this.N, e = this.man.layers[hatId], d = hm.data, k1 = this.k;
    const { ax, ay, sx, sy, r0, k, lift } = fit, grown = sx !== 1 || sy !== 1;
    const place = (x, y) => { // where a point of the frame reads the hat's layer (see compose: the hat's own map)
      let xs = x, ys = y;
      if (grown) {
        const dd = x - ax, r = dd < 0 ? -dd : dd;
        if (r > r0) xs = ax + (dd < 0 ? -1 : 1) * (r0 + (r - r0) * k);
        if (ys < ay) ys = ay + (ys - ay) / sy;
      }
      if (lift && ys > lift.P) ys = lift.P + (ys - lift.P) * lift.c;
      return [xs - e.x, ys - e.y];
    };
    const cut = (x, y) => (lift ? Math.min(Math.max((lift.ycut(x) - y) / lift.soft, 0), 1) : 1);
    const at = (lx, ly) => (lx < 0 || ly < 0 || lx >= e.w || ly >= e.h ? 0 : d[(ly * e.w + lx) * 4]);
    const alpha = (x, y) => { // the hat's alpha (0..255) at a point, as drawn
      const [lx, ly] = place(x, y);
      return at(Math.round(lx), Math.round(ly)) * cut(x, y);
    };
    const soft = (x, y) => { // the same, read between the layer's pixels and averaged over 5 px by 5 of the full frame
      let a = 0;
      for (let j = -2; j <= 2; j++) {
        for (let i = -2; i <= 2; i++) {
          const [lx, ly] = place(x + i * k1, y + j * k1), c = Math.floor(lx), r = Math.floor(ly), u = lx - c, v = ly - r;
          a += ((at(c, r) * (1 - u) + at(c + 1, r) * u) * (1 - v) + (at(c, r + 1) * (1 - u) + at(c + 1, r + 1) * u) * v) * cut(x + i * k1, y + j * k1);
        }
      }
      return a / 25;
    };
    const y0 = Math.max(0, Math.floor(fit.top) - 2), y1 = Math.min(N - 1, Math.ceil(e.y + e.h) + 2);
    const side = (dir) => { // dir: -1 the left side, 1 the right
      const out = new Float32Array(N).fill(NaN);
      const x0 = dir < 0 ? 0 : N - 1, n = dir < 0 ? Math.ceil(ax) : N - Math.floor(ax);
      for (let y = y0; y <= y1; y++) {
        let prev = 0;
        for (let i = 0; i < n; i++) {
          const x = x0 - dir * i, a = alpha(x, y);
          if (a > 128) { out[y] = x + dir * (1 - (128 - prev) / (a - prev)); break; } // where the alpha crosses half
          prev = a;
        }
      }
      let yw = -1;
      for (let y = y0; y <= y1; y++) if (out[y] === out[y] && (yw < 0 || (out[y] - out[yw]) * dir >= 0)) yw = y;
      if (yw < 0) return null;
      let y = yw;
      while (y + 1 <= y1 && out[y + 1] === out[y + 1] && (out[y] - out[y + 1]) * dir <= 12 * k1) y++;
      // The lowest point, measured to an eighth of a pixel of the full frame on the hat's alpha averaged over 5 px (soft):
      // from 3 px above the last row down, as far as it still crosses half within 12 px of the point above; and where
      // it crosses 2 px above that (bx), which the very bottom of a rounded corner leaves uncertain sideways. The edge
      // of a hat is soft at its lower corners, and the last row whose alpha crosses half is a coarse cut of it: at
      // half size it was up to a row of the full frame higher, and at the narrow lower corner of a cap's side 6 px
      // further out, and the hair below it moved with it.
      const W = 12 * k1, f8 = k1 / 8, ys = Math.max(y0, y - 3 * k1), cross = [];
      let px = out[Math.round(ys)], by = ys;
      for (let yy = ys; yy <= y + 3 * k1; yy += f8) {
        let found = NaN, prev = 0;
        for (let i = 0; i <= 24; i++) {
          const x = px + dir * (W - i * k1), a = soft(x, yy);
          if (a > 128) { found = i === 0 ? x : x + dir * k1 * (1 - (128 - prev) / (a - prev)); break; }
          prev = a;
        }
        if (!(found === found)) break;
        px = found; by = yy;
        cross.push([yy, found]);
      }
      let bx = px;
      for (const [yy, x] of cross) if (yy <= by - 2 * k1 + f8 / 2) bx = x;
      const h = Math.max(1, Math.round(12 * k1));
      const inward = (r) => { // how far the outline moves in per px down about row r (not past the lowest point)
        const a = Math.max(r - h, y0), b = Math.min(r + h, y), va = out[a], vb = out[b];
        return va === va && vb === vb && b > a ? ((va - vb) * dir) / (b - a) : 0;
      };
      let ym = y;
      while (ym - 1 > yw && inward(ym - 1) >= MOUTH) ym--;
      return ym < y ? { out, x: out[ym], y: ym, lx: px, low: by } : { out, x: bx, y: by, lx: px, low: by };
    };
    const zone = { L: side(-1), R: side(1) };
    this.cache.set(key, zone);
    return zone;
  }

  // What shows of a hairstyle around a brimmed or knitted hat (zone: its outline, see hatZone), per column of the
  // template face space and, below the hat's sides, per row.
  // Below a side's lower edge the hair comes out from under the hat: no further out than a curve that leaves the
  // edge's outer end straight down and turns out (FLARE); the hair further out is pressed together towards it, row by
  // row (sL, sR: the share of its width each row keeps). Wide curls and locs come out of the hat beside the head and
  // widen as they fall; hair that falls within the curve stays as it is.
  // Under the hat: edge is the level above which the hair is hidden (the hat's lower edge), press how far the hair
  // of a column is pressed down (short hair at the hat's sides, see below), and gone marks the columns whose hair
  // below the edge is left out, because what would show of it is a speck and not hair coming out from under a hat:
  //   - over the forehead, anything less than a fringe: a piece narrower than 80 px (the tip of a twist, of a curl
  //     or of a lock under the brim) or less than 2500 px2 of hair. The end of a swept fringe shows, even when only
  //     its tips come out under a hat pulled down to the brows (a pixie under a beanie);
  //   - at the temples, a strip too thin to read as hair.
  // shade(x, y) is the weight of the hair's shadow at a point under the hat: hair that the hat hides casts none.
  hatCut(hairId, hatId, fit, zone, e, mask) {
    const k = `cut:${hairId}:${hatId}`;
    if (this.cache.has(k)) return this.cache.get(k);
    // md: the hair as one mass (class B of a hair layer made with it: where skin shows through thin hair the
    // alpha is low, and a fade would count as no hair), or else its alpha
    const N = this.N, k1 = this.k, k2 = k1 * k1;
    const n6 = 6 * k1;
    const md = this.man.layers[hairId].wm ? mask.data.subarray(2) : mask.data;
    const hairAt = (x, y) => {
      const lx = x - e.x, ly = y - e.y;
      return lx >= 0 && ly >= 0 && lx < e.w && ly < e.h && md[(ly * e.w + lx) * 4] > 128;
    };
    // Below each side: the outermost hair of the rows past the outer end of the side's lower edge (as the press
    // moves it), over the rows from 6 px above to 36 px below, so the hair keeps its own outline as it widens below
    // and a short tuft its own width; the share of its width a row keeps to come within the curve, smoothed over the
    // rows and never larger than a row needs (row by row the hair sheared).
    const squeeze = (Z, dir) => {
      const s = new Float32Array(N).fill(1);
      if (!Z) return s;
      const ya = Math.max(Math.ceil(Z.y), e.y), yb = Math.min(N - 1, Math.ceil(e.y + e.h - 1 + (PRESS_FROM + PRESS_OUT) * k1));
      if (ya > yb) return s;
      const eo = new Float32Array(N).fill(NaN);
      for (let y = ya; y <= yb; y++) { // what shows in each column lay press px higher
        if (dir < 0) { for (let x = e.x; x < Z.x; x++) if (hairAt(x, Math.round(y - press[x]))) { eo[y] = x; break; } }
        else for (let x = e.x + e.w - 1; x > Z.x; x--) if (hairAt(x, Math.round(y - press[x]))) { eo[y] = x; break; }
      }
      const up = Math.round(6 * k1), dn = Math.round(36 * k1), u3 = Math.round(4 * k1), d3 = Math.round(16 * k1);
      const need = new Float32Array(N).fill(1);
      for (let y = ya; y <= yb; y++) {
        let m = NaN;
        for (let y2 = Math.max(ya, y - up); y2 <= Math.min(yb, y + dn); y2++) {
          const v = eo[y2];
          if (v === v && !(m === m && (v - m) * dir <= 0)) m = v;
        }
        if (!(m === m)) continue;
        const wide = (m - Z.x) * dir, room = this.flare(y - Z.y);
        if (wide > room) need[y] = Math.max(SQUEEZE_MIN, room / wide);
      }
      const lo = new Float32Array(N).fill(1);
      for (let y = ya; y <= yb; y++) {
        let m = 1;
        for (let y2 = Math.max(ya, y - u3); y2 <= Math.min(yb, y + d3); y2++) if (need[y2] < m) m = need[y2];
        lo[y] = m;
      }
      for (let y = ya; y <= yb; y++) { // the mean of rows whose minimum took this row in
        let a = 0, n = 0;
        for (let y2 = Math.max(ya, y - (d3 >> 1)); y2 <= Math.min(yb, y + u3); y2++) { a += lo[y2]; n++; }
        s[y] = a / n;
      }
      return s;
    };
    // under the hat: how much hair each column shows below the edge (pressed down by press)
    const edge = Float32Array.from(fit.clip);
    const gone = new Uint8Array(N), cnt = new Int32Array(N), press = new Float32Array(N);
    const xa = Math.max(Math.ceil(fit.xl), e.x), xb = Math.min(Math.floor(fit.xr), e.x + e.w - 1);
    const scan = () => {
      cnt.fill(0);
      for (let c = xa; c <= xb; c++) {
        const cl = edge[c];
        if (!(cl === cl)) continue;
        const lx = c - e.x;
        for (let ly = Math.max(0, Math.ceil(cl - press[c]) - e.y); ly < e.h; ly++) {
          if (md[(ly * e.w + lx) * 4] > 128) cnt[c]++;
        }
      }
    };
    const w = fit.xr - fit.xl;
    // Short hair at the hat's sides (outside each side's lowest point it ends no more than PRESS_FROM px above that
    // point, and less than PRESS_OUT px below it): the hat presses it down, and its ends come out as small tufts
    // PRESS_OUT px below that point ("Pixie" under a beanie: nothing showed at the sides). Both sides move by the same
    // amount, the less of what each would need (one side alone gave a tuft on one side of the face), the hair
    // outside each point together, and the press eases out over 16 px inwards (a step between columns would shear the
    // hair). Long hair, hair that comes out below that point already, and the hair over the forehead stay as they
    // are.
    {
      const need = (Z, left) => {
        if (!Z) return 0;
        let deep = -Infinity; // where the hair outside that point ends lowest
        for (let c = e.x; c < e.x + e.w; c++) {
          if (left ? c > Z.lx : c < Z.lx) continue;
          const lx = c - e.x;
          for (let ly = e.h - 1; ly >= 0; ly--) if (md[(ly * e.w + lx) * 4] > 128) { deep = Math.max(deep, e.y + ly); break; }
        }
        return deep >= Z.low - PRESS_FROM * k1 ? Math.max(0, Z.low + PRESS_OUT * k1 - deep) : 0;
      };
      const p = Math.min(need(zone.L, true), need(zone.R, false)), r2 = 16 * k1;
      if (p > 0) {
        for (let c = 0; c < N; c++) {
          const ds = Math.max(zone.L.lx - c, c - zone.R.lx); // how far outside a side's lowest point
          if (ds > -r2) press[c] = p * Math.min(1, 1 + ds / r2);
        }
      }
    }
    const sL = squeeze(zone.L, -1), sR = squeeze(zone.R, 1);
    scan();
    const inL = fit.xl + 0.24 * w, inR = fit.xr - 0.24 * w;
    for (let c = xa; c <= xb; c++) gone[c] = 1; // what is not part of a run that stays (the fuzz along the edge)
    const close = (a, b) => { // one run of columns with hair below the edge (gaps of a few columns bridged)
      let area = 0, tall = 0;
      for (let c = a; c <= b; c++) { area += cnt[c]; tall = Math.max(tall, cnt[c]); }
      const width = b - a + 1, mid = (a + b) / 2;
      const face = mid > inL && mid < inR;
      // under a hat that sits on the hair (lift) a lock that hangs from it over the forehead stays ("Short twists")
      const lock = fit.lift && tall >= 60 * k1;
      const drop = face ? (width < 80 * k1 && !lock) || area < 2500 * k2 : width < 26 * k1 || area < 900 * k2;
      // over the face a speck is left out in every row (2); beside it only above the side's lowest point (1), where
      // the hair below comes out from under the hat
      for (let c = a; c <= b; c++) gone[c] = drop ? (face ? 2 : 1) : 0;
    };
    let s = -1, last = -1;
    for (let c = xa; c <= xb + 1; c++) {
      if (c <= xb && cnt[c] >= n6) { if (s < 0) s = c; last = c; }
      else if (s >= 0 && c - last > n6) { close(s, last); s = -1; }
    }
    if (s >= 0) close(s, last);
    // The hair's shadow under the hat. The shadow map holds the shadow of all the hair; the hair that the hat
    // hides casts none, and the hair that still shows keeps its own. On a coarse grid: the distance to the
    // nearest hair that shows (dv) and to the nearest hidden hair (dh). The shadow stays in full near hair that
    // shows and away from hidden hair, and fades out in between (cut along the hat's edge, column by column, it
    // left a line across the forehead and a box around the eyes).
    const Q = Math.max(1, Math.round(4 * k1)), GW = Math.ceil(N / Q), GN = GW * GW;
    const dv = new Float32Array(GN).fill(1e9), dh = new Float32Array(GN).fill(1e9);
    for (let ly = 0; ly < e.h; ly++) {
      const y = e.y + ly;
      if (y < 0 || y >= N) continue;
      for (let lx = 0; lx < e.w; lx++) {
        if (md[(ly * e.w + lx) * 4] <= 128) continue;
        const c = e.x + lx;
        if (c < 0 || c >= N) continue;
        const Z = c < fit.ax ? zone.L : zone.R, dir = c < fit.ax ? -1 : 1, cl = edge[c];
        const above = Z && y < Z.y, out = above ? Z.out[y] : NaN;
        const hidden = above && (!(out === out) || (c - out) * dir > 0) ? true
          : cl === cl ? (gone[c] && (gone[c] === 2 || !Z || y < Z.low)) || y < cl - press[c] : false;
        (hidden ? dh : dv)[((y / Q) | 0) * GW + ((c / Q) | 0)] = 0;
      }
    }
    const spread = (d) => { // distance to the nearest marked cell (two chamfer passes)
      const b = Math.SQRT2;
      for (let y = 0; y < GW; y++) {
        for (let x = 0; x < GW; x++) {
          const i = y * GW + x;
          let v = d[i];
          if (x > 0) v = Math.min(v, d[i - 1] + 1);
          if (y > 0) {
            v = Math.min(v, d[i - GW] + 1);
            if (x > 0) v = Math.min(v, d[i - GW - 1] + b);
            if (x < GW - 1) v = Math.min(v, d[i - GW + 1] + b);
          }
          d[i] = v;
        }
      }
      for (let y = GW - 1; y >= 0; y--) {
        for (let x = GW - 1; x >= 0; x--) {
          const i = y * GW + x;
          let v = d[i];
          if (x < GW - 1) v = Math.min(v, d[i + 1] + 1);
          if (y < GW - 1) {
            v = Math.min(v, d[i + GW] + 1);
            if (x < GW - 1) v = Math.min(v, d[i + GW + 1] + b);
            if (x > 0) v = Math.min(v, d[i + GW - 1] + b);
          }
          d[i] = v;
        }
      }
    };
    spread(dv);
    spread(dh);
    // px: full weight within V1 of showing hair; no loss beyond H2 of hidden hair
    const V1 = 12 * k1, V2 = 48 * k1, H1 = 40 * k1, H2 = 72 * k1;
    const W = new Float32Array(GN);
    for (let i = 0; i < GN; i++) {
      const wv = Math.min(Math.max((V2 - dv[i] * Q) / (V2 - V1), 0), 1);
      const wh = Math.min(Math.max((H2 - dh[i] * Q) / (H2 - H1), 0), 1);
      W[i] = 1 - wh * (1 - wv);
    }
    const shade = (x, y) => {
      const gx = Math.min(Math.max(x / Q - 0.5, 0), GW - 1), gy = Math.min(Math.max(y / Q - 0.5, 0), GW - 1);
      const x0 = Math.min(gx | 0, GW - 2), y0 = Math.min(gy | 0, GW - 2), fx = gx - x0, fy = gy - y0, i = y0 * GW + x0;
      return (W[i] * (1 - fx) + W[i + 1] * fx) * (1 - fy) + (W[i + GW] * (1 - fx) + W[i + GW + 1] * fx) * fy;
    };
    const cut = { edge, gone, press, shade, sL, sR };
    this.cache.set(k, cut);
    return cut;
  }

  // One shift down for every avatar, so the tallest hair and headwear combination keeps its top in the frame.
  frameDy() {
    if (this._frame != null) return this._frame;
    if (this.k !== 1) return (this._frame = Math.round(new Engine(this.base, null).frameDy() * this.k));
    const man = this.man;
    let minTop = Infinity;
    for (const t of Object.keys(man.templates)) {
      const hairs = man.options.hair[t].map((h) => `${t}.h.${h}`).filter((id) => id in man.layers);
      for (const id of hairs) {
        const tp = this.hairTop(id).top;
        for (let x = 0; x < this.N; x++) if (tp[x] === tp[x]) minTop = Math.min(minTop, tp[x]);
      }
      for (const w of man.options.hat[t]) {
        const hatId = `${t}.w.${w}`;
        if (!(hatId in man.layers) || man.layers[hatId].mode === 'hide') continue;
        for (const h of [null, ...hairs]) minTop = Math.min(minTop, this.hatFit(t, h, hatId).top);
      }
    }
    this._frame = Math.max(0, Math.min(96, Math.ceil(16 - minTop)));
    return this._frame;
  }

  // Face shapes: backward map from a face's space to the template face (grid of quarter pixels, 32 px apart).
  faceMap(t, f) {
    const w = this.man.warps && this.man.warps[t] && this.man.warps[t][f];
    if (!w) return null;
    const k = `warp:${t}:${f}`;
    if (!this.cache.has(k)) {
      const g = Math.round(Math.sqrt(w[0].length)), step = (this.N) / (g - 1);
      const dx = Float32Array.from(w[0], (v) => v / 4), dy = Float32Array.from(w[1], (v) => v / 4);
      let max = 0;
      for (let i = 0; i < dx.length; i++) max = Math.max(max, Math.abs(dx[i]), Math.abs(dy[i]));
      const fn = (x, y, o) => {
        const gx = Math.min(Math.max(x / step, 0), g - 1.001), gy = Math.min(Math.max(y / step, 0), g - 1.001);
        const i = gx | 0, j = gy | 0, fx = gx - i, fy = gy - j, p = j * g + i;
        const ux = dx[p] * (1 - fx) + dx[p + 1] * fx, lx = dx[p + g] * (1 - fx) + dx[p + g + 1] * fx;
        const uy = dy[p] * (1 - fx) + dy[p + 1] * fx, ly = dy[p + g] * (1 - fx) + dy[p + g + 1] * fx;
        // whole-pixel offsets: parts are moved, not resampled, so hair strands stay as sharp as the source
        o[0] = x + Math.round(ux * (1 - fy) + lx * fy);
        o[1] = y + Math.round(uy * (1 - fy) + ly * fy);
      };
      fn.max = max;
      this.cache.set(k, fn);
    }
    return this.cache.get(k);
  }

  // Below the ears hair hangs beside the face, behind it. It is made on the template face, where its inner edge is
  // the template's own outline, and the face map lays that edge on a face shape only roughly (it matches the two
  // silhouettes along the template's normals: tF f2's jaw is wider and ends about 45 px lower) and not at all on an
  // expression (a dropped jaw narrows the cheeks): drawn over the face, hair cut into a wider jaw with a notch and
  // stood off a narrower one. So on the template's rows manifest.behind[t] (y0: below the ears and the nose; y1:
  // 120 px below the chin):
  //  - near the outline of the skin that is drawn (from BEHIND_DEPTH px outside it to its soft edge), the hair is
  //    drawn after the clothing, under the skin that shows and over everything else (see drawMapped's `under`); a
  //    beard lies over it only on the face. Where the face is wider than the template it covers the hair, so the
  //    outline between them is the one the model drew for that face and expression;
  //  - behind the face the hair goes on inwards, mirrored about the line BEHIND_EDGE px outside the template's
  //    outline, down to BEHIND_DEPTH px (behindBack): beside a face or an expression narrower than the template it
  //    shows hair, not the background (the widest such gap is 23 px, tM f3);
  //  - the hair along the outline, from FRONT_OUT px outside it inwards (the edge of the hair as the model drew it
  //    against the face, the soft edge that reaches in over a cheek, up to 15 px, a strand across it), is drawn over
  //    the face at the same depth inside the outline that is drawn as it lay inside the template's (behindFront).
  //    Over the BEHIND_IN rows below y0 and the BEHIND_OUT rows above y1 it moves there by degrees, so where the
  //    rows begin and end it lies at the face map's own point.
  // Depths are signed distances to an outline (px, > 0 inside), see signedDepth. Per template: the rows' weight,
  // and the template's depth and inward normal over the rows; null when the manifest has no rows.
  hairBehind(t) {
    const b = this.man.behind && this.man.behind[t];
    if (!b || b.y0 === undefined) return Promise.resolve(null);
    const key = `behind:${t}`;
    if (!this.cache.has(key)) {
      const id = `${t}.f1.base`, e = this.man.layers[id], c = behindAt(this.k);
      const p = Promise.all([this.img(`l/${this.fname(id)}.m.webp`), this.shirtTop(id)]).then(([m, top]) => {
        const N = this.N, md = m.data, z = new Float32Array(N);
        for (let y = 0; y < N; y++) z[y] = Math.max(0, Math.min(1, (y - b.y0) / c.IN, (b.y1 - y) / c.OUT));
        const y0 = Math.max(0, Math.round(b.y0 - c.LIM)), y1 = Math.min(N, Math.round(b.y1 + c.LIM)), w = N, h = y1 - y0;
        const cov = new Float32Array(w * h);
        // the skin only: not the template's own t-shirt (G channel of a face base layer), which a garment covers
        for (let j = 0; j < h; j++) {
          const ly = y0 + j - e.y;
          if (ly < 0 || ly >= e.h) continue;
          for (let lx = 0; lx < e.w; lx++) {
            const q = (ly * e.w + lx) * 4;
            if (top && y0 + j >= top[e.x + lx]) continue;
            cov[j * w + e.x + lx] = (md[q] / 255) * (1 - md[q + 1] / 255);
          }
        }
        const dep = signedDepth(cov, w, h, c.LIM);
        // the inward normal: the gradient of the depth (where it is level: across, towards the middle of the frame)
        const nx = new Float32Array(w * h), ny = new Float32Array(w * h);
        for (let j = 0; j < h; j++) {
          for (let i = 0; i < w; i++) {
            const k = j * w + i;
            const gx = i > 0 && i < w - 1 ? (dep[k + 1] - dep[k - 1]) / 2 : 0;
            const gy = j > 0 && j < h - 1 ? (dep[k + w] - dep[k - w]) / 2 : 0;
            const g = Math.hypot(gx, gy);
            if (g > 0.2) { nx[k] = gx / g; ny[k] = gy / g; } else nx[k] = i < N / 2 ? 1 : -1;
          }
        }
        return { z, y0: b.y0, y1: b.y1, c, d: { x0: 0, y0, w, h, dep, nx, ny } };
      });
      this.cache.set(key, p);
      p.catch(() => { if (this.cache.get(key) === p) this.cache.delete(key); });
    }
    return this.cache.get(key);
  }

  // The face image's own t-shirt (G channel of a face base layer; every avatar wears a garment over it): per column of
  // the frame, the row where it begins (face space). Past the ends of the shirt's band the row at its nearest end, so
  // the shoulders of an expression layer (which carries its own image's shirt) are below it too. null without one.
  shirtTop(baseId) {
    const key = `shirt:${baseId}`;
    if (!this.cache.has(key)) {
      const e = this.man.layers[baseId];
      const p = this.img(`l/${this.fname(baseId)}.m.webp`).then((m) => {
        const md = m.data, N = this.N, top = new Float32Array(N).fill(NaN);
        let first = -1, last = -1;
        for (let lx = 0; lx < e.w; lx++) {
          for (let ly = 0; ly < e.h; ly++) {
            if (md[(ly * e.w + lx) * 4 + 1] >= 128) { top[e.x + lx] = e.y + ly; break; }
          }
          if (top[e.x + lx] === top[e.x + lx]) { if (first < 0) first = e.x + lx; last = e.x + lx; }
        }
        if (first < 0) return null;
        for (let x = 0; x < first; x++) top[x] = top[first];
        for (let x = last + 1; x < N; x++) top[x] = top[last];
        for (let x = first; x <= last; x++) if (top[x] !== top[x]) top[x] = top[x - 1];
        return top;
      });
      this.cache.set(key, p);
      p.catch(() => { if (this.cache.get(key) === p) this.cache.delete(key); });
    }
    return this.cache.get(key);
  }

  // The alpha of a layer drawn through the face map (null: none) at a pixel of the frame (F: the frame shift).
  async maskAt(id, fm, F) {
    const e = this.man.layers[id];
    if (!e) return () => 0;
    const m = (await this.img(`l/${this.fname(id)}.m.webp`)).data, o = new Float64Array(7);
    return (x, y) => {
      if (fm) fm(x, y - F, o); else { o[0] = x; o[1] = y - F; }
      const lx = Math.round(o[0]) - e.x, ly = Math.round(o[1]) - e.y;
      return lx < 0 || ly < 0 || lx >= e.w || ly >= e.h ? 0 : m[(ly * e.w + lx) * 4] / 255;
    };
  }

  // Headwear that wraps the face (mode 'hide', the hijab) is made on the template face, and the face map moves
  // only its sides with the outline of each face: the chin lies inside the outline, so the map leaves it where it
  // is, and on a face whose chin comes lower (tF f2: about 40 px) the rim of the face opening crossed the chin.
  // Backward map, within a neutral face's space, that puts the template's chin line on the face's
  // (manifest.chin[t][f]: per column of a grid from x0, step px apart, the template's chin line y and the shift
  // dy in quarter pixels; past the grid nothing moves). It applies in full from 70 px above the face's chin line to
  // 30 px below it, and fades out over the 120 px above (the open face) and the 220 px below (the fabric over the
  // neck, which keeps its drape on the shoulders). null when the face has no such shift.
  chinMap(t, f) {
    const c = this.man.chin && this.man.chin[t] && this.man.chin[t][f];
    if (!c) return null;
    const k = `chin:${t}:${f}`;
    if (!this.cache.has(k)) {
      const n = c.dy.length, dy = Float32Array.from(c.dy, (v) => v / 4), y = Float32Array.from(c.y), k1 = this.k;
      let max = 0;
      for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(dy[i]));
      const ease = (u) => u * u * (3 - 2 * u);
      const fn = (x, yy, o) => {
        o[0] = x; o[1] = yy;
        const g = (x - c.x0) / c.step;
        if (g < 0 || g > n - 1) return;
        const i = Math.min(n - 2, g | 0), fx = g - i;
        const d = dy[i] * (1 - fx) + dy[i + 1] * fx;
        if (d === 0) return;
        const u = yy - (y[i] * (1 - fx) + y[i + 1] * fx + d); // from the face's chin line
        const v = u < -190 * k1 || u > 250 * k1 ? 0 : u < -70 * k1 ? ease((u + 190 * k1) / (120 * k1))
          : u <= 30 * k1 ? 1 : 1 - ease((u - 30 * k1) / (220 * k1));
        o[1] = yy - d * v;
      };
      fn.max = max;
      this.cache.set(k, fn);
    }
    return this.cache.get(k);
  }

  // Garments are made on the template, under its jaw. On a face whose chin comes lower (tF f2: about 40 px) the
  // parts that rise beside the jaw (the tips of a hood, the points of a collar) ran into it and were cut by it. A
  // garment that reaches within 60 px of the template's chin line, in the columns of the chin map (its layer entry
  // has `jaw`, set by the extraction), is drawn through the chin map before the face map, as headwear that wraps the
  // face is (see chinMap): it keeps its distance from the jaw, and its drape on the shoulders stays. One that ends
  // lower (a t-shirt) is not moved. Returns the map to draw the garment with: fm itself, or fm after the chin map
  // (its `down`: the chin map's reach).
  clothMap(t, f, id, fm) {
    const cm = this.chinMap(t, f), e = this.man.layers[id];
    if (!cm || !e || !e.jaw) return fm;
    const join = (x, y, o) => {
      cm(x, y, o);
      if (fm) fm(o[0], o[1], o);
    };
    join.max = fm ? fm.max : 0;
    join.down = cm.max;
    return join;
  }

  // The head above the chin line of a face shape (manifest.chin: the template's line moved by the face's shift) and
  // of its expression (through the expression's smooth map): a weight at a pixel of the frame, 1 down to the line and
  // 0 from HEAD_SOFT px below it; 0 too above the top of the garment `id` drawn through `map` (see compose).
  async headAbove(t, f, e, F, id, map) {
    const c = this.man.chin && this.man.chin[t] && this.man.chin[t][f], ce = this.man.layers[id];
    if (!c || !ce) return null;
    const em = e ? await this.exprMap(t, f, e, true) : null, n = c.y.length, soft = HEAD_SOFT * this.k;
    const ly = Float32Array.from(c.y, (v, i) => v + c.dy[i] / 4);
    let low = -Infinity;
    for (let i = 0; i < n; i++) low = Math.max(low, ly[i]);
    const r0 = ce.y + F - (map ? map.max : 0) - 1, r1 = low + F + soft + (em ? em.max : 0) + 1;
    const o = new Float64Array(7);
    return (cx, cy) => {
      if (cy < r0 || cy > r1) return 0;
      let x = cx, y = cy - F;
      if (em) { em(x, y, o); x = o[0]; y = o[1]; }
      const g = Math.min(Math.max((x - c.x0) / c.step, 0), n - 1), i = Math.min(n - 2, g | 0), fx = g - i;
      const u = (ly[i] * (1 - fx) + ly[i + 1] * fx - y) / soft + 1;
      return u <= 0 ? 0 : u >= 1 ? 1 : u;
    };
  }

  // Expressions: backward map from the face of an expression to the neutral face it was made from (a grid of
  // whole-pixel offsets, one tile per face and expression in lut/<t>.ewarp.png). Beards, and headwear that wraps
  // the face, are made on a neutral face; this map draws them where the expression moved the skin they lie on.
  // smooth: only the broad movement (the drop of the jaw, the rise of the cheeks), for a part with a clean edge
  // such as fabric, on which the fine movement around the mouth would show as ripples.
  exprMap(t, f, e, smooth = false) {
    const w = this.man.ewarp && this.man.ewarp[t];
    const k = w && w.tiles[`${f}.${e}`];
    if (k === undefined || k === null) return Promise.resolve(null);
    const key = `ewarp:${t}:${f}:${e}:${smooth ? 1 : 0}`;
    if (!this.cache.has(key)) {
      const p = this.img(`lut/${t}.ewarp.png`).then((im) => {
        const { cols, rows, step, x: X0, y: Y0 } = w;
        const tx = (k % w.per_row) * cols, ty = Math.floor(k / w.per_row) * rows;
        const dx = new Float32Array(cols * rows), dy = new Float32Array(cols * rows);
        let max = 0;
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols; i++) {
            const q = ((ty + j) * im.width + tx + i) * 4, n = j * cols + i;
            dx[n] = (im.data[q] - 128) * this.k;
            dy[n] = (im.data[q + 1] - 128) * this.k;
          }
        }
        if (smooth) { // three box blurs of 5 grid points along each axis (close to a Gaussian of 2.4 points)
          const tmp = new Float32Array(cols * rows);
          const blur = (a, len, count, stride, step2) => {
            for (let c = 0; c < count; c++) {
              for (let i = 0; i < len; i++) {
                let sum = 0, num = 0;
                for (let d = -2; d <= 2; d++) {
                  const j = Math.min(len - 1, Math.max(0, i + d));
                  sum += a[c * stride + j * step2]; num++;
                }
                tmp[c * stride + i * step2] = sum / num;
              }
            }
            a.set(tmp);
          };
          for (const a of [dx, dy]) {
            for (let pass = 0; pass < 3; pass++) {
              blur(a, cols, rows, cols, 1); // along x: one row at a time
              blur(a, rows, cols, 1, cols); // along y: one column at a time
            }
          }
        }
        for (let n = 0; n < dx.length; n++) max = Math.max(max, Math.abs(dx[n]), Math.abs(dy[n]));
        // sampled between the grid points; past the grid its edge values hold (a long beard hangs with the chin)
        const fn = (x, y, o) => {
          const gx = Math.min(Math.max((x - X0) / step, 0), cols - 1.001);
          const gy = Math.min(Math.max((y - Y0) / step, 0), rows - 1.001);
          const i = gx | 0, j = gy | 0, fx = gx - i, fy = gy - j, n = j * cols + i;
          o[0] = x + (dx[n] * (1 - fx) + dx[n + 1] * fx) * (1 - fy) + (dx[n + cols] * (1 - fx) + dx[n + cols + 1] * fx) * fy;
          o[1] = y + (dy[n] * (1 - fx) + dy[n + 1] * fx) * (1 - fy) + (dy[n + cols] * (1 - fx) + dy[n + cols + 1] * fx) * fy;
        };
        fn.max = max;
        return fn;
      });
      this.cache.set(key, p);
      p.catch(() => { if (this.cache.get(key) === p) this.cache.delete(key); });
    }
    return this.cache.get(key);
  }

  // What the parts drawn after the face cover at a point of the frame (0..1). parts: [{id, ch, map, alt, shadow}]:
  // the channel of the layer's mask that holds the part, the map from a point of the frame to the layer's own space
  // (null: the same point), a second map whose point counts too, by the weight it leaves in o[2] (the hair behind a
  // face narrower than the template, see hairBehind), and whether its shadow counts too (stubble is all shadow).
  async partCover(parts) {
    const o = new Float64Array(7);
    const src = [];
    for (const pt of parts) {
      const e = this.man.layers[pt.id];
      const f = this.fname(pt.id);
      const m = await this.img(`l/${f}.m.webp`);
      const sh = pt.shadow && e.s ? await this.img(`l/${f}.s.webp`) : null;
      src.push({ e, m: m.data, sh: sh && sh.data, ch: pt.ch, map: pt.map, alt: pt.alt });
    }
    return (x, y) => {
      let best = 0;
      for (const p of src) {
        for (let k = 0; k < (p.alt ? 2 : 1); k++) {
          const map = k ? p.alt : p.map;
          o[0] = x; o[1] = y; o[2] = 1;
          if (map) map(x, y, o);
          if (o[2] <= 0) continue;
          const lx = Math.round(o[0]) - p.e.x, ly = Math.round(o[1]) - p.e.y;
          if (lx < 0 || ly < 0 || lx >= p.e.w || ly >= p.e.h) continue;
          const i = (ly * p.e.w + lx) * 4;
          let v = p.m[i + p.ch] / 255;
          if (p.sh) v = Math.max(v, Math.min(1, 2 * (1 - Math.min(p.sh[i], p.sh[i + 1], p.sh[i + 2]) / 255)));
          v *= Math.min(o[2], 1);
          if (v > best) best = v;
        }
      }
      return best;
    };
  }

  // The rim of light along a face layer's silhouette, light from behind the head. The layer's colour has it taken
  // out, and its light map (entry `lt`: the 's' slot, grey, the square root of the linear light) adds it back, the
  // same in the three channels, by the skin tone's strength (manifest.rim[t]: per tone [skull, sides], fitted to the
  // model's own images of each tone; going from the skull's to the sides' over `band` px around the eye line `y`;
  // 1 on the base tone, rim null). Beside a part drawn after the face (hair, a beard, headwear) the part takes the
  // light, and the rim is left out there: by how much a part covers within 10 px, on a grid of 8 px, smoothed.
  // cover: see partCover (null: no such part). Returns the layer with its colour lit, a copy.
  async rimLit(L, id, rim, tone, cover) {
    const e = this.man.layers[id];
    if (!e.lt) return L;
    const { w, h } = e, step = Math.max(1, Math.round(8 * this.k)), gw = Math.ceil(w / step) + 2, gh = Math.ceil(h / step) + 2;
    const key = `rim|${id}`;
    if (!this.cache.has(key)) { // the lit pixels of the layer, once: where, the linear light, and the grid cells near
      const p = this.img(`l/${this.fname(id)}.s.webp`).then((lt) => {
        const ld = lt.data, at = [], val = [], near = new Uint8Array(gw * gh);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const v = ld[(y * w + x) * 4];
            if (v === 0) continue;
            at.push(y * w + x);
            val.push((v / 255) * (v / 255));
            const i = Math.floor(x / step), j = Math.floor(y / step);
            near[j * gw + i] = near[j * gw + i + 1] = near[(j + 1) * gw + i] = near[(j + 1) * gw + i + 1] = 1;
          }
        }
        const n = at.length, cell = new Int32Array(n), fx = new Float32Array(n), fy = new Float32Array(n);
        for (let a = 0; a < n; a++) { // the cell of the grid of each lit pixel, and where in it
          const y = (at[a] / w) | 0, x = at[a] - y * w, gx = x / step, gy = y / step;
          cell[a] = (gy | 0) * gw + (gx | 0); fx[a] = gx - (gx | 0); fy[a] = gy - (gy | 0);
        }
        return { at: Int32Array.from(at), val: Float32Array.from(val), near, cell, fx, fy };
      });
      this.cache.set(key, p);
      p.catch(() => { if (this.cache.get(key) === p) this.cache.delete(key); });
    }
    const { at, val, near, cell, fx, fy } = await this.cache.get(key);
    const keep = new Float32Array(gw * gh).fill(1);
    if (cover) {
      const r = 10 * this.k, ring = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [0.7 * r, 0.7 * r], [-0.7 * r, 0.7 * r],
        [0.7 * r, -0.7 * r], [-0.7 * r, -0.7 * r]];
      for (let j = 0; j < gh; j++) {
        for (let i = 0; i < gw; i++) {
          if (!near[j * gw + i]) continue;
          let c = 0;
          for (const [ox, oy] of ring) c = Math.max(c, cover(e.x + i * step + ox, e.y + j * step + oy));
          keep[j * gw + i] = 1 - Math.min(1, Math.max(0, (c - 0.05) / 0.25));
        }
      }
      for (let pass = 0; pass < 2; pass++) { // 3 x 3 box, twice
        const b = keep.slice();
        for (let j = 0; j < gh; j++) {
          for (let i = 0; i < gw; i++) {
            let sum = 0;
            for (let dj = -1; dj <= 1; dj++) {
              for (let di = -1; di <= 1; di++) {
                sum += b[Math.min(gh - 1, Math.max(0, j + dj)) * gw + Math.min(gw - 1, Math.max(0, i + di))];
              }
            }
            keep[j * gw + i] = sum / 9;
          }
        }
      }
    }
    const ks = rim && rim[String(tone)], kRow = new Float32Array(h).fill(1);
    if (ks) { // the strength on each row of the layer, from the skull's to the sides'
      const half = (rim.band || 40 * this.k) / 2 || 1;
      for (let y = 0; y < h; y++) {
        const f = Math.min(1, Math.max(0, (e.y + y - (rim.y - half)) / (2 * half)));
        kRow[y] = ks[0] + (ks[1] - ks[0]) * f;
      }
    }
    const color = L.color.slice();
    for (let a = 0; a < at.length; a++) {
      const n = cell[a], u = fx[a], v = fy[a];
      const kp = (keep[n] * (1 - u) + keep[n + 1] * u) * (1 - v) + (keep[n + gw] * (1 - u) + keep[n + gw + 1] * u) * v;
      const add = kRow[(at[a] / w) | 0] * kp * val[a];
      if (add <= 0) continue;
      const q = at[a] * 3;
      for (let c = 0; c < 3; c++) color[q + c] = curve(SRGB_T, curve(LIN_T, color[q + c]) + add);
    }
    return { e: L.e, color, mask: L.mask };
  }

  // Expressions keep the cheeks and the jaw that the model drew. Headwear that wraps the face (the hijab) is made on
  // the neutral face, and its opening is the neutral outline: where it lies beside a cheek that came out thinner (a
  // dropped jaw pulls the cheeks in), that cheek is moved out to the neutral outline by the expression's cheek map (a
  // tile of lut/<t>.cfit.png: the shift in quarter pixels, 128 + 4 * shift, on a grid of 8 px; past the grid its
  // edge values hold). Nothing else needs it: hair beside the face lies behind it (hairBehind), and a beard follows
  // the expression's own skin (exprMap); stretched beside them, the cheeks met the dropped jaw at an angle. cover:
  // what the headwear covers at a point of the frame (see partCover). How near it is decides how much of the map
  // applies, per row of the grid and side of the face, so the stretch inside the cheek keeps its shape. Returns a
  // backward map for drawMapped (with .max, its reach), or null when nothing moves.
  async cheekFit(t, f, e, cover, F) {
    const c = this.man.cfit && this.man.cfit[t];
    const k = c && c.tiles[`${f}.${e}`];
    if (k === undefined || k === null) return null;
    const key = `cfit:${t}:${f}:${e}`;
    if (!this.cache.has(key)) {
      const p = this.img(`lut/${t}.cfit.png`).then((im) => {
        const { cols, rows, q } = c;
        const tx = (k % c.per_row) * cols, ty = Math.floor(k / c.per_row) * rows;
        const dx = new Float32Array(cols * rows), dy = new Float32Array(cols * rows);
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols; i++) {
            const o = ((ty + j) * im.width + tx + i) * 4, n = j * cols + i;
            dx[n] = ((im.data[o] - 128) / q) * this.k;
            dy[n] = ((im.data[o + 1] - 128) / q) * this.k;
          }
        }
        return { dx, dy };
      });
      this.cache.set(key, p);
      p.catch(() => { if (this.cache.get(key) === p) this.cache.delete(key); });
    }
    const { dx, dy } = await this.cache.get(key);
    const { x: X0, y: Y0, step, cols, rows } = c, k1 = this.k, mid = this.N / 2;
    // the need of each row and side: a part within 16 px of a moved point (32 px across, beside the cheek)
    const R = 16 * k1, ring = [[0, 0], [R, 0], [-R, 0], [0, R], [0, -R], [0.7 * R, 0.7 * R], [-0.7 * R, 0.7 * R],
      [0.7 * R, -0.7 * R], [-0.7 * R, -0.7 * R], [2 * R, 0], [-2 * R, 0]];
    const need = [new Float32Array(rows), new Float32Array(rows)];
    let any = false;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const n = j * cols + i;
        if (Math.abs(dx[n]) + Math.abs(dy[n]) < 0.25 * k1) continue;
        any = true;
        const x = X0 + i * step, y = Y0 + j * step, side = x < mid ? 0 : 1;
        if (need[side][j] >= 1) continue;
        for (const [ox, oy] of ring) {
          const v = Math.min(1, Math.max(0, (cover(x + ox, y + oy) - 0.05) / 0.25));
          if (v > need[side][j]) need[side][j] = v;
          if (v >= 1) break;
        }
      }
    }
    if (!any) return null;
    // smoothed along the rows (two passes over 5 rows: about 40 px), so a part that ends lets the cheek go back
    // to the expression's own shape gradually
    for (const a of need) {
      for (let pass = 0; pass < 2; pass++) {
        const b = Float32Array.from(a);
        for (let j = 0; j < rows; j++) {
          let sum = 0;
          for (let d = -2; d <= 2; d++) sum += b[Math.min(rows - 1, Math.max(0, j + d))];
          a[j] = sum / 5;
        }
      }
    }
    const wx = new Float32Array(cols * rows), wy = new Float32Array(cols * rows);
    let max = 0;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const n = j * cols + i, x = X0 + i * step;
        const sr = Math.min(1, Math.max(0, (x - mid) / (64 * k1) + 0.5)); // left side to right side, across the chin
        const w = need[0][j] * (1 - sr) + need[1][j] * sr;
        wx[n] = dx[n] * w; wy[n] = dy[n] * w;
        max = Math.max(max, Math.abs(wx[n]), Math.abs(wy[n]));
      }
    }
    if (max < 0.05 * k1) return null;
    // The cells of the grid that move anything (one of their corners shifts by more than 0.01 px), as spans of
    // canvas columns per row of cells. Past the grid its edge cells hold: the first and last row of cells reach
    // to the top and the bottom of the canvas, the first and last column to its sides.
    const N = this.N, moves = (m) => Math.abs(wx[m]) + Math.abs(wy[m]) > 0.01 * k1;
    const spans = [];
    for (let j = 0; j < rows - 1; j++) {
      const row = [];
      for (let i = 0; i < cols - 1; i++) {
        const n = j * cols + i;
        if (!(moves(n) || moves(n + 1) || moves(n + cols) || moves(n + cols + 1))) continue;
        const xa = i === 0 ? 0 : X0 + i * step, xb = i === cols - 2 ? N : X0 + (i + 1) * step;
        if (row.length && row[row.length - 1] === xa) row[row.length - 1] = xb;
        else row.push(xa, xb);
      }
      spans.push(row);
    }
    const fn = (x, y, out) => {
      const fy = y - F;
      const gx = Math.min(Math.max((x - X0) / step, 0), cols - 1.001);
      const gy = Math.min(Math.max((fy - Y0) / step, 0), rows - 1.001);
      const i = gx | 0, j = gy | 0, ax = gx - i, ay = gy - j, n = j * cols + i;
      out[0] = x + (wx[n] * (1 - ax) + wx[n + 1] * ax) * (1 - ay) + (wx[n + cols] * (1 - ax) + wx[n + cols + 1] * ax) * ay;
      out[1] = fy + (wy[n] * (1 - ax) + wy[n + 1] * ax) * (1 - ay) + (wy[n + cols] * (1 - ax) + wy[n + cols + 1] * ax) * ay;
    };
    // the row of cells of a canvas row
    fn.row = (cy) => Math.min(Math.max(Math.floor((cy - F - Y0) / step), 0), rows - 2);
    fn.rowTop = (j) => (j === 0 ? 0 : Y0 + j * step + F);
    fn.rowEnd = (j) => (j === rows - 2 ? N : Y0 + (j + 1) * step + F);
    fn.spans = spans;
    fn.max = max;
    return fn;
  }

  // An expression layer through its cheek map (see cheekFit): the pixels the map moves are sampled through it,
  // every other pixel is copied as draw() copies it.
  drawCheeks(cv, L, fn, F, alphaFn = null) {
    const { e, color, mask } = L, N = this.N, rgb = cv.rgb, cov = cv.cov, md = mask.data, T = this.tracked(cv);
    // 1. the pixels outside the moving spans, copied (as draw() copies them)
    for (let y = 0; y < e.h; y++) {
      const cy = e.y + y + F;
      if (cy < 0 || cy >= N) continue;
      const sp = fn.spans[fn.row(cy)];
      let k = 0;
      for (let x = 0; x < e.w; x++) {
        const cx = e.x + x;
        while (k < sp.length && sp[k + 1] <= cx) k += 2;
        if (k < sp.length && cx >= sp[k]) continue;
        const i = y * e.w + x;
        let a = md[i * 4] / 255;
        if (a <= 0) continue;
        if (alphaFn) a *= alphaFn(cx, cy, md, i * 4);
        if (a <= 0) continue;
        const p = cy * N + cx, q = p * 3;
        rgb[q] += (color[i * 3] - rgb[q]) * a;
        rgb[q + 1] += (color[i * 3 + 1] - rgb[q + 1]) * a;
        rgb[q + 2] += (color[i * 3 + 2] - rgb[q + 2]) * a;
        cov[p] += (1 - cov[p]) * a;
        if (T) this.trackOver(T, cv.part, p, a, color[i * 3] * a, color[i * 3 + 1] * a, color[i * 3 + 2] * a, a);
      }
    }
    // 2. the moving spans, through the map (only where the layer, moved by the map's reach, can land)
    const lb = this.box(e, F, Array(4).fill(fn.max + 2));
    for (let j = 0; j < fn.spans.length; j++) {
      const y0 = Math.max(fn.rowTop(j), lb[1]), y1 = Math.min(fn.rowEnd(j), lb[3]);
      if (y0 >= y1) continue;
      const sp = fn.spans[j];
      for (let k = 0; k < sp.length; k += 2) {
        const x0 = Math.max(sp[k], lb[0]), x1 = Math.min(sp[k + 1], lb[2]);
        if (x0 < x1) this.drawMapped(cv, L, fn, [x0, y0, x1, y1], alphaFn);
      }
    }
  }

  // ---------------------------------------------------------------- drawing
  // The canvas `cv` holds the layers drawn so far, without the background: rgb (N*N*3, already weighted by
  // coverage) and cov (N*N, how much of the pixel they cover). The background is added once, at the end, so an
  // avatar can also come out with no background, and a part's shadow never darkens the backdrop.
  // gain: how much of the shadow is applied (1: all of it); sat: how much of its own tint it keeps (0: grey)
  shadow(cv, id, dy = 0, gain = 1, sat = 1) {
    const e = this.man.layers[id];
    if (!e.s) return Promise.resolve();
    return this.img(`l/${this.fname(id)}.s.webp`).then((s) => {
      const N = this.N, rgb = cv.rgb, g = gain / 255, T = this.tracked(cv);
      for (let y = 0; y < e.h; y++) {
        const cy = e.y + y + dy;
        if (cy < 0 || cy >= N) continue;
        for (let x = 0; x < e.w; x++) {
          const p = (y * e.w + x) * 4;
          let kr = s.data[p], kg = s.data[p + 1], kb = s.data[p + 2];
          if (kr === 255 && kg === 255 && kb === 255) continue;
          if (sat !== 1) {
            const m = (kr + kg + kb) / 3;
            kr = m + (kr - m) * sat; kg = m + (kg - m) * sat; kb = m + (kb - m) * sat;
          }
          const q = (cy * N + e.x + x) * 3, fr = 1 - g * (255 - kr), fg = 1 - g * (255 - kg), fb = 1 - g * (255 - kb);
          if (T) this.trackShade(T, cv.part, rgb, q, fr, fg, fb);
          rgb[q] *= fr;
          rgb[q + 1] *= fg;
          rgb[q + 2] *= fb;
        }
      }
    });
  }

  draw(cv, L, { dy = 0, alphaFn = null } = {}) {
    const { e, color, mask } = L;
    const N = this.N, rgb = cv.rgb, cov = cv.cov, T = this.tracked(cv);
    for (let y = 0; y < e.h; y++) {
      const cy = e.y + y + dy;
      if (cy < 0 || cy >= N) continue;
      for (let x = 0; x < e.w; x++) {
        const i = y * e.w + x;
        let a = mask.data[i * 4] / 255;
        if (a <= 0) continue;
        const cx = e.x + x;
        if (alphaFn) a *= alphaFn(cx, cy, mask.data, i * 4);
        if (a <= 0) continue;
        const p = cy * N + cx, q = p * 3;
        rgb[q] += (color[i * 3] - rgb[q]) * a;
        rgb[q + 1] += (color[i * 3 + 1] - rgb[q + 1]) * a;
        rgb[q + 2] += (color[i * 3 + 2] - rgb[q + 2]) * a;
        cov[p] += (1 - cov[p]) * a;
        if (T) this.trackOver(T, cv.part, p, a, color[i * 3] * a, color[i * 3 + 1] * a, color[i * 3 + 2] * a, a);
      }
    }
  }

  // ---------------------------------------------------------------- the parts asked for (compose's `parts`)
  // For each part asked for, cv.track keeps two things as the canvas holds colour (rgb weighted by coverage):
  //   rgb, cov: the part's own share of the canvas, what of it shows. What the part draws (cv.part) goes over it as
  //     it goes over the canvas; anything else drawn over it covers it by its alpha; any shadow darkens it.
  //   u (from the part's first shadow): how much the part's own shadows took from the rest of the canvas, as it
  //     still shows (covered and darkened by what comes after, like the rest).
  // The picture without the part is the canvas less its share plus u: the part cut out (what it covers is not drawn
  // again) and its shadows undone. The picture itself is computed as before. Nothing is kept for a part until it
  // first draws (d.on), so what is drawn before it costs nothing.

  // The parts a draw has to keep up: null when none is asked for, or none has drawn yet and this draw is not one.
  tracked(cv) {
    if (!cv.track) return null;
    for (const d of cv.track) if (d.on || d.name === cv.part) return cv.track;
    return null;
  }

  // An over draw at pixel p with alpha a; (pr, pg, pb, pc): what the drawing part itself put down there (its colour
  // times its own alpha, and that alpha).
  trackOver(T, part, p, a, pr, pg, pb, pc) {
    const q = p * 3, k = 1 - a;
    for (let j = 0; j < T.length; j++) {
      const d = T[j];
      if (d.name === part) {
        d.on = true;
        d.rgb[q] = d.rgb[q] * k + pr; d.rgb[q + 1] = d.rgb[q + 1] * k + pg; d.rgb[q + 2] = d.rgb[q + 2] * k + pb;
        d.cov[p] = d.cov[p] * k + pc;
      } else if (d.on) {
        d.rgb[q] *= k; d.rgb[q + 1] *= k; d.rgb[q + 2] *= k; d.cov[p] *= k;
      } else continue;
      if (d.u) { d.u[q] *= k; d.u[q + 1] *= k; d.u[q + 2] *= k; }
    }
  }

  // A shadow of `part` (or of none) at rgb index q, darkening by the factors (fr, fg, fb); called before the canvas
  // rgb is darkened.
  trackShade(T, part, rgb, q, fr, fg, fb) {
    for (let j = 0; j < T.length; j++) {
      const d = T[j];
      if (d.name === part) {
        d.on = true;
        const u = d.u || (d.u = new Float32Array(d.rgb.length));
        // what it takes from the rest of the pixel (all but its own share)
        u[q] += (rgb[q] - d.rgb[q]) * (1 - fr);
        u[q + 1] += (rgb[q + 1] - d.rgb[q + 1]) * (1 - fg);
        u[q + 2] += (rgb[q + 2] - d.rgb[q + 2]) * (1 - fb);
      } else if (!d.on) continue;
      else if (d.u) { d.u[q] *= fr; d.u[q + 1] *= fg; d.u[q + 2] *= fb; }
      d.rgb[q] *= fr; d.rgb[q + 1] *= fg; d.rgb[q + 2] *= fb;
    }
  }

  // Destination box of a mapped layer: its own box, moved by the frame and grown by the map's reach.
  box(e, dy, grow) {
    const N = this.N, [l, tp, r, b] = grow;
    return [Math.max(0, Math.floor(e.x - l)), Math.max(0, Math.floor(e.y + dy - tp)),
      Math.min(N, Math.ceil(e.x + e.w + r)), Math.min(N, Math.ceil(e.y + e.h + dy + b))];
  }

  // Inverse-mapped drawing: map(x, y, o) gives the source point (o[0], o[1]) of a destination pixel and an
  // alpha factor o[2]; colour and alpha are sampled bilinearly (alpha-weighted). alphaFn, as in draw(), scales
  // the alpha of each source pixel. o[5], o[6] hold the destination pixel, for a map that looks at what is
  // already drawn there.
  // under: {snap, cloth, shown} for hair behind the face (see hairBehind), drawn after the clothing: it goes over the
  // clothing and over what is empty, and under the skin that shows. snap: the canvas as it was after the face, from
  // row snap.y0 (only the rows the map reaches), and in snap.skin what of its coverage is skin;
  // cloth(x, y): the clothing's alpha at a pixel of the frame (it covers that much of the skin); shown (optional,
  // N x N): gathers how much of the hair shows at each pixel. dest(x, y), optional: a factor on the alpha at a pixel
  // of the frame.
  drawMapped(cv, L, map, box, alphaFn = null, under = null, dest = null) {
    const { e, color, mask } = L, N = this.N, w = e.w, h = e.h, md = mask.data, rgb = cv.rgb, cov = cv.cov;
    const o = new Float64Array(8), T = this.tracked(cv);
    let A = 0, R = 0, G = 0, B = 0;
    const sample = (lx, ly, s) => {
      if (lx <= -1 || ly <= -1 || lx >= w || ly >= h) return;
      const x0 = Math.floor(lx), y0 = Math.floor(ly), fx = lx - x0, fy = ly - y0;
      for (let k = 0; k < 4; k++) {
        const xx = x0 + (k & 1), yy = y0 + (k >> 1);
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const wt = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy) * s;
        if (wt <= 0) continue;
        const i = yy * w + xx;
        let a = (md[i * 4] / 255) * wt;
        if (a > 0 && alphaFn) a *= alphaFn(e.x + xx, e.y + yy, md, i * 4);
        if (a <= 0) continue;
        A += a; R += a * color[i * 3]; G += a * color[i * 3 + 1]; B += a * color[i * 3 + 2];
      }
    };
    for (let cy = box[1]; cy < box[3]; cy++) {
      for (let cx = box[0]; cx < box[2]; cx++) {
        o[2] = 1; o[3] = 1; o[5] = cx; o[6] = cy; o[7] = 1;
        map(cx, cy, o);
        if (o[2] <= 0) continue;
        A = 0; R = 0; G = 0; B = 0;
        const lx = o[0] - e.x, ly = o[1] - e.y;
        if (o[3] > 1.25) { // squashed rows: average over the rows this pixel covers (no aliasing of fine strands)
          const d = o[3] / 3;
          sample(lx, ly - d, 1 / 3); sample(lx, ly, 1 / 3); sample(lx, ly + d, 1 / 3);
        } else if (o[7] > 1.25) { // columns pressed together: the same across the columns it covers
          const d = o[7] / 3;
          sample(lx - d, ly, 1 / 3); sample(lx, ly, 1 / 3); sample(lx + d, ly, 1 / 3);
        } else sample(lx, ly, 1);
        if (A <= 0) continue;
        const a = Math.min(A, 1) * o[2] * (dest ? dest(cx, cy) : 1), p = cy * N + cx, q = p * 3;
        if (a <= 0) continue;
        // m: the share of the alpha that is this layer's own (the rest puts back the skin that shows: see under)
        let m = a;
        if (under) { // the pixel as it is, with the hair over all of it but the skin that shows
          // (snap.skin: what of the face's coverage is skin, not the face image's own t-shirt: see hairBehind)
          const sp = p - under.snap.y0 * N, s0 = under.snap.cov[sp], s1 = under.snap.skin ? under.snap.skin[sp] : s0;
          const c = s1 > 0 ? under.cloth(cx, cy) : 0, f = s0 > 0 ? (s1 / s0) * (1 - c) : 0;
          const sr = under.snap.rgb, sq = sp * 3, k = 1 - s1 * (1 - c);
          rgb[q] += (sr[sq] * f + (k * R) / A - rgb[q]) * a;
          rgb[q + 1] += (sr[sq + 1] * f + (k * G) / A - rgb[q + 1]) * a;
          rgb[q + 2] += (sr[sq + 2] * f + (k * B) / A - rgb[q + 2]) * a;
          if (under.shown) under.shown[p] = 1 - (1 - under.shown[p]) * (1 - a * k);
          m = a * k;
        } else {
          rgb[q] += (R / A - rgb[q]) * a;
          rgb[q + 1] += (G / A - rgb[q + 1]) * a;
          rgb[q + 2] += (B / A - rgb[q + 2]) * a;
        }
        cov[p] += (1 - cov[p]) * a;
        if (cv.hairCov && cv.part === 'hair') cv.hairCov[p] += (1 - cv.hairCov[p]) * a;
        if (T) this.trackOver(T, cv.part, p, a, (R / A) * m, (G / A) * m, (B / A) * m, m);
      }
    }
  }

  async shadowMapped(cv, id, map, box, gain = 1, sat = 1) {
    const e = this.man.layers[id];
    if (!e.s) return;
    const s = await this.img(`l/${this.fname(id)}.s.webp`);
    const N = this.N, w = e.w, h = e.h, sd = s.data, o = new Float64Array(8), rgb = cv.rgb, T = this.tracked(cv);
    for (let cy = box[1]; cy < box[3]; cy++) {
      for (let cx = box[0]; cx < box[2]; cx++) {
        o[2] = 1; o[4] = NaN; o[5] = cx; o[6] = cy;
        map(cx, cy, o);
        if (o[4] === o[4]) o[2] = o[4]; // a map may weigh the shadow apart from the part (hair under a hat)
        if (o[2] <= 0) continue;
        const lx = o[0] - e.x, ly = o[1] - e.y;
        if (lx <= -1 || ly <= -1 || lx >= w || ly >= h) continue;
        const x0 = Math.floor(lx), y0 = Math.floor(ly), fx = lx - x0, fy = ly - y0;
        let kr = 0, kg = 0, kb = 0;
        for (let k = 0; k < 4; k++) {
          const xx = x0 + (k & 1), yy = y0 + (k >> 1);
          const wt = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy);
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) { kr += wt; kg += wt; kb += wt; continue; }
          const p = (yy * w + xx) * 4;
          kr += wt * sd[p] / 255; kg += wt * sd[p + 1] / 255; kb += wt * sd[p + 2] / 255;
        }
        if (kr > 0.999 && kg > 0.999 && kb > 0.999) continue;
        if (sat !== 1) {
          const m = (kr + kg + kb) / 3;
          kr = m + (kr - m) * sat; kg = m + (kg - m) * sat; kb = m + (kb - m) * sat;
        }
        const f = o[2] * gain, q = (cy * N + cx) * 3, fr = 1 - f * (1 - kr), fg = 1 - f * (1 - kg), fb = 1 - f * (1 - kb);
        if (T) this.trackShade(T, cv.part, rgb, q, fr, fg, fb);
        rgb[q] *= fr;
        rgb[q + 1] *= fg;
        rgb[q + 2] *= fb;
      }
    }
  }

  // A part made on the template face, drawn through the face map, the frame shift and its own map.
  // ctx: {F, fm}, the frame shift and face map of this one compose call (calls may run side by side).
  // sid: the layer whose shadow is cast (a recoloured hairstyle casts the shadow of its base layer)
  async drawPart(cv, ctx, id, maps, own = null, grow = [0, 0, 0, 0], sid = id) {
    const e = this.man.layers[id], { F, fm } = ctx;
    if (!fm && !own) {
      await this.shadow(cv, sid, F);
      this.draw(cv, await this.layerColor(id, maps), { dy: F });
      return;
    }
    const m = fm ? fm.max + 2 : 0, g = [grow[0] + m, grow[1] + m, grow[2] + m, grow[3] + m];
    const box = this.box(e, F, g);
    const map = (x, y, o) => {
      if (fm) fm(x, y - F, o); else { o[0] = x; o[1] = y - F; }
      if (own) own(o);
    };
    await this.shadowMapped(cv, sid, map, sid === id ? box : this.box(this.man.layers[sid], F, g));
    this.drawMapped(cv, await this.layerColor(id, maps), map, box);
  }

  // Composes one selection. s.bg is a '#rrggbb' colour, or 'transparent' (or missing) for no background:
  // the result then carries the avatar's own alpha. Returns {width, height, data: RGBA bytes, straight alpha}.
  // parts: names of PARTS to keep apart. The result then also has parts[name] = {cover: how much of each pixel the
  // part makes up in the picture (0 to 1, after everything drawn over it), without: the picture with the part cut
  // out and its shadows undone (what it covers is not drawn again, so it is transparent, or the background, where
  // the part was), tones: its colours as they show (null when nothing of it shows: no such part, or stubble, which
  // is only a shade of the skin)}. The picture itself is the same as without `parts`.
  async compose(s, { frame = true, parts: apart = null } = {}) {
    const man = this.man, N = this.N, t = s.t;
    for (const name of apart || []) if (!PARTS.includes(name)) throw new Error(`pixitoons: no part "${name}"; parts: ${PARTS.join(', ')}`);
    // every file of the selection at once (see needs): the awaits below find them loading or loaded
    for (const path of this.needs(s)) this.img(path);
    const base = man.options.base_tone;
    const skin = s.tone !== base ? `${t}.skin.${s.tone}` : null;
    const hairC = s.hair_color !== 'darkbrown' ? `${t}.hair.${s.hair_color}` : null;
    const clothC = s.cloth_color !== 'gray' ? `${t}.cloth.${s.cloth_color}` : null;
    const F = frame ? this.frameDy() : 0;
    const ctx = { F, fm: this.faceMap(t, s.face) };
    // class weights from the mask: R = alpha, G = A, B = B, alpha = W
    const G = (d, p) => d[p + 1] / 255, Bc = (d, p) => d[p + 2] / 255, W = (d, p) => d[p + 3] / 255;
    // face layers: B = iris (irises keep their colour; other eye colours are exact patches). The skin map covers
    // the brows too. Under a hair colour other than dark brown, brow hair of the colour the model gives brows
    // under that hair colour (manifest.brows, seen on the base skin tone) takes the place of the layer's own brow
    // hair (its entry's `brows`), by the layer's brow weight W (its coverage). The hair colour does not change
    // with the skin tone, but the skin that shows between the hairs does: under another tone the new colour is
    // darkened (or lightened) by BROW_SKIN_SHOW of the change the skin map makes to the luminance of the skin
    // around the brows (`brow_skin`). A layer without brows (faint brows are left as they are) and a build
    // without brow colours keep the dark brown.
    const faceMaps = [{ name: skin, weight: (d, p) => Math.max(0, 1 - Bc(d, p)) }];
    const browTo = s.hair_color !== 'darkbrown' && man.brows && man.brows[t] && man.brows[t][s.hair_color];
    const skinLut = browTo ? await this.lut(skin) : null;
    const faceMapsOf = (id) => {
      const e = man.layers[id];
      if (!browTo || !e.brows) return faceMaps;
      const h = e.brows.map((v) => v / 255), hs = [...h];
      let k = 1;
      if (skinLut) {
        applyLut(skinLut, h[0], h[1], h[2], hs, 0);
        const sk = e.brow_skin.map((v) => v / 255), sks = [0, 0, 0];
        applyLut(skinLut, sk[0], sk[1], sk[2], sks, 0);
        const lum = (v) => 0.2126 * toLinear(v[0]) + 0.7152 * toLinear(v[1]) + 0.0722 * toLinear(v[2]);
        k = 1 + BROW_SKIN_SHOW * (lum(sks) / Math.max(lum(sk), 1e-4) - 1);
      }
      const tint = [0, 1, 2].map((c) => toSrgb(toLinear(browTo[c] / 255) * k) - hs[c]);
      return [...faceMaps, { tint, own: h, mapped: hs, weight: W }];
    };
    const cv = { rgb: new Float32Array(N * N * 3), cov: new Float32Array(N * N), part: null, track: null, hairCov: null };
    if (apart && apart.length) {
      cv.track = [...new Set(apart)].map((name) => ({ name, on: false, rgb: new Float32Array(N * N * 3),
        cov: new Float32Array(N * N) }));
    }
    const has = (id) => id in man.layers;
    const hatId = s.hat !== 'none' && has(`${t}.w.${s.hat}`) ? `${t}.w.${s.hat}` : null;
    const hat = hatId ? man.layers[hatId] : null;
    const hideHair = hat && hat.mode === 'hide';
    const hairId = s.hair !== 'bald' && !hideHair && has(`${t}.h.${s.hair}`) ? `${t}.h.${s.hair}` : null;
    // a hairstyle recoloured by the model is drawn as it is; otherwise the colour map recolours the dark brown one
    const exactHair = hairId && s.hair_color !== 'darkbrown' && has(`${hairId}.${s.hair_color}`)
      ? `${hairId}.${s.hair_color}` : null;
    const hairDraw = exactHair || hairId;
    const hairMaps = exactHair ? null : hairC;
    // 1. face base and expression (made on this face: only the frame shift)
    const exprId = s.expr !== 'neutral' ? `${t}.${s.face}.e.${s.expr}` : null;
    // An expression layer holds the whole head of its own image and fades out over the 30 rows above `neck`,
    // low on the neck. The neutral face is drawn only from there down: where an expression makes the head
    // narrower (a dropped jaw pulls the cheeks in), the neutral face around it showed as a second, paler outline.
    const neck = exprId && has(exprId) ? man.layers[exprId].neck : null;
    const k1 = this.k, below = neck ? (cx, cy) => Math.min(Math.max((cy - F - neck + 60 * k1) / (30 * k1), 0), 1) : null;
    // The parts drawn after the face that were made on the neutral face: beside them the cheeks of an expression
    // move out to the neutral outline (cheekFit), and they take the rim of light along the face (rimLit).
    const withExpr = exprId && has(exprId);
    const parts = [], fm = ctx.fm;
    // Below the ears, hair beside the face lies behind it (see hairBehind): not for a hairstyle that ends above.
    let behind = hairId ? await this.hairBehind(t) : null;
    if (behind && man.layers[hairDraw].y + man.layers[hairDraw].h <= behind.y0) behind = null;
    if (hairId) {
      // the hair behind a face narrower than the template covers too (see partCover)
      const he = man.layers[hairId], hm = behind ? (await this.img(`l/${this.fname(hairId)}.m.webp`)).data : null;
      const alpha = (x, y) => {
        const lx = x - he.x, ly = y - he.y;
        return lx < 0 || ly < 0 || lx >= he.w || ly >= he.h ? 0 : hm[(ly * he.w + lx) * 4] / 255;
      };
      const alt = behind ? (x, y, o) => {
        if (fm) fm(x, y, o);
        const x0 = o[0], y0 = o[1];
        behindBack(behind, o, alpha);
        if (o[0] === x0 && o[1] === y0) o[2] = 0; // not behind the template's outline: the face map's point has it
      } : null;
      parts.push({ id: hairId, ch: man.layers[hairId].wm ? 2 : 0, map: fm, alt, hair: true });
    }
    // headwear that wraps the face: the expression's map (its chin and cheeks), then the chin of the face shape,
    // then the face map
    const wrapMap = async () => {
      const em = withExpr ? await this.exprMap(t, s.face, s.expr, true) : null, cm = this.chinMap(t, s.face);
      if (!em && !cm) return fm;
      const join = (x, y, o) => {
        if (em) em(x, y, o); else { o[0] = x; o[1] = y; }
        if (cm) cm(o[0], o[1], o);
        if (fm) fm(o[0], o[1], o);
      };
      // the chin map moves things only down (see chinMap): its reach goes to the bottom of the box (`down`), not
      // to all four sides as `max` does
      join.max = (em ? em.max : 0) + (fm ? fm.max : 0);
      join.down = cm ? cm.max : 0;
      return join;
    };
    const hatMap = hatId ? (hideHair ? await wrapMap() : fm) : null;
    if (hatId) parts.push({ id: hatId, ch: 0, map: hatMap, wraps: hideHair });
    const bId = s.beard !== 'none' ? `${t}.${s.face}.b.${s.beard}` : null;
    if (bId && has(bId)) parts.push({ id: bId, ch: 0, shadow: true, map: withExpr ? await this.exprMap(t, s.face, s.expr) : null });
    const cover = parts.length ? await this.partCover(parts) : null;
    // the cheeks of an expression move out only beside headwear that wraps the face (see cheekFit)
    const wraps = parts.filter((pt) => pt.wraps);
    const coverFit = wraps.length ? await this.partCover(wraps) : null;
    const rim = s.tone === base ? null : (man.rim && man.rim[t]) || null;
    const baseId = `${t}.${s.face}.base`;
    this.draw(cv, await this.rimLit(await this.layerColor(baseId, faceMapsOf(baseId)), baseId, rim, s.tone, cover),
      { dy: F, alphaFn: below });
    let expr = null, cheeks = null;
    if (withExpr) {
      expr = await this.rimLit(await this.layerColor(exprId, faceMapsOf(exprId)), exprId, rim, s.tone, cover);
      // its cheeks move out to the neutral outline only beside headwear that wraps the face (see cheekFit)
      cheeks = coverFit ? await this.cheekFit(t, s.face, s.expr, coverFit, F) : null;
      if (cheeks) this.drawCheeks(cv, expr, cheeks, F);
      else this.draw(cv, expr, { dy: F });
    }
    const eyeId = s.eye !== 'darkbrown' ? `${t}.${s.face}.eye.${s.expr}.${s.eye}` : null;
    if (eyeId && has(eyeId)) this.draw(cv, await this.layerColor(eyeId, []), { dy: F });
    // the canvas after the face over the rows of the hair behind it (see hairBehind), and the depth of the outline of
    // the skin it holds
    const m0 = fm ? fm.max + 2 : 2;
    let snap = null, drawn = null;
    if (behind) {
      const y0 = Math.max(0, Math.floor(behind.y0 + F - m0)), y1 = Math.min(N, Math.ceil(behind.y1 + F + m0));
      const h = Math.max(0, y1 - y0);
      snap = { y0, rgb: cv.rgb.slice(y0 * N * 3, y1 * N * 3), cov: cv.cov.slice(y0 * N, y1 * N) };
      // the outline of the skin that is drawn: not of the face image's own t-shirt (see hairBehind)
      const skinCov = snap.cov.slice(), be = man.layers[baseId], bm = (await this.img(`l/${this.fname(baseId)}.m.webp`)).data;
      const top = await this.shirtTop(baseId);
      for (let j = 0; j < h; j++) {
        const fy = y0 + j - F, ly = fy - be.y;
        if (top) for (let x = 0; x < N; x++) if (fy >= top[x]) skinCov[j * N + x] = 0;
        if (ly < 0 || ly >= be.h) continue;
        for (let lx = 0; lx < be.w; lx++) {
          const q = (ly * be.w + lx) * 4;
          if (bm[q + 1] === 0) continue;
          const k = j * N + be.x + lx;
          skinCov[k] = Math.max(0, skinCov[k] - (bm[q] / 255) * (bm[q + 1] / 255));
        }
      }
      snap.skin = skinCov;
      drawn = { x0: 0, y0, w: N, h, dep: signedDepth(skinCov, N, h, behind.c.LIM), c: behind.c };
    }
    // 2. clothing (made on the template face; its own skin pixels follow the skin tone)
    const clothId = `${t}.c.${s.cloth}`;
    // beside the jaw a garment follows the chin of the face shape (see clothMap)
    const clothFm = this.clothMap(t, s.face, clothId, fm);
    const cctx = clothFm === fm ? ctx : { F, fm: clothFm };
    // What of it still rises above the chin line of the face (or of its expression), at the corners of the jaw, lies
    // behind the jaw: it is not drawn there, nor is its shadow, so the line of the jaw is the one the model drew.
    // (Not under headwear that wraps the face, which covers the jaw.) The hair behind the face takes the garment as
    // it shows (clothShown).
    const head = clothFm !== fm && !cheeks ? await this.headAbove(t, s.face, withExpr ? s.expr : null, F, clothId, clothFm) : null;
    const hide = head ? (o) => { o[2] *= 1 - head(o[5], o[6]); } : null;
    cv.part = 'cloth';
    await this.drawPart(cv, cctx, clothId, [
      { name: skin, weight: G },
      { name: clothC, weight: (d, p) => Math.max(0, 1 - G(d, p)) },
    ], hide, [0, 0, 0, clothFm && clothFm.down ? clothFm.down : 0]);
    cv.part = null;
    let clothShown = null;
    if (head) {
      const ca = await this.maskAt(clothId, clothFm, F);
      clothShown = (cx, cy) => ca(cx, cy) * (1 - head(cx, cy));
    }
    // part layers: G = skin pixels inside the part (they follow the skin tone)
    const partMaps = (partLut, tune = null) => [{ name: skin, weight: G },
      { name: partLut, weight: (d, p) => 1 - G(d, p), ...(partLut && tune ? tune : {}) }];
    // the hair's colours, and under a hat that sits on it what of it shows (hatCut)
    const fit = hat && hat.mode !== 'hide' ? this.hatFit(t, hairId, hatId) : null;
    if (fit && fit.mode === 'part' && hairId) cv.hairCov = new Float32Array(N * N); // how much hair each pixel holds
    let hairL = null, own = null, down = 0; // down: how far below its layer the hair may come (pressed down)
    if (hairId) {
      hairL = await this.layerColor(hairDraw, partMaps(hairMaps));
      if (fit && fit.mode === 'part') {
        const { e, mask } = hairL;
        const hm = await this.img(`l/${this.fname(hatId)}.m.webp`);
        const zone = this.hatZone(t, hairId, hatId, fit, hm);
        const { edge, gone, press, shade, sL, sR } = this.hatCut(hairDraw, hatId, fit, zone, e, mask);
        for (let c = 0; c < N; c++) if (press[c] > down) down = press[c];
        const md = man.layers[hairDraw].wm ? mask.data.subarray(2) : mask.data;
        own = (o) => {
          const x = o[0], y = o[1], c = Math.round(x);
          if (c < 0 || c >= N) return;
          const left = x < fit.ax, Z = left ? zone.L : zone.R, dir = left ? -1 : 1, yi = Math.round(y);
          let xs = x; // where the hair is read: below a side of the hat, further out (pressed in towards the head)
          if (Z) {
            if (y < Z.y) { // above the side's lower edge: nothing outside the hat's outline
              const out = yi >= 0 && yi < N ? Z.out[yi] : NaN;
              if (!(out === out) || (x - out) * dir > 0) { o[2] = 0; return; }
            } else if ((x - Z.x) * dir > 0) { // below it and outside its outer end: within the curve, pressed in
              const past = (x - Z.x) * dir - this.flare(y - Z.y);
              if (past >= 0.5) { o[2] = 0; return; }
              if (past > -0.5) o[2] *= 0.5 - past;
              const q = yi >= 0 && yi < N ? (left ? sL : sR)[yi] : 1;
              if (q < 1) { xs = Z.x + (x - Z.x) / q; o[7] = 1 / q; }
            }
          }
          const cl = edge[c];
          if (cl === cl) { // under the hat: hidden above its edge
            const d = y - cl, k4 = 4 * k1;
            let shown = d >= k4 ? 1 : d <= -k4 ? 0 : (d + k4) / (2 * k4);
            if (gone[c] && (gone[c] === 2 || !Z || y < Z.low)) shown = 0;
            // The hair that would shade the forehead is under the hat: its shadow stays only near hair that
            // shows. Where the hidden hair itself lay, the shadow map holds the hair's darkness, not a shadow.
            const cr = Math.min(Math.max(Math.round(xs), 0), N - 1), yr = o[1] - press[cr]; // where it is read
            const lx = cr - e.x, ly = Math.round(yr) - e.y;
            const ha = lx >= 0 && ly >= 0 && lx < e.w && ly < e.h ? md[(ly * e.w + lx) * 4] / 255 : 0;
            o[4] = o[2] * shade(xs, yr) * (1 - ha * (1 - shown));
            o[2] *= shown;
          }
          o[0] = xs;
          const cs = Math.round(xs);
          if (cs >= 0 && cs < N) o[1] -= press[cs]; // short hair pressed down by the hat: what shows here lay higher
        };
      }
    }
    const hairSrc = (x, y, o) => { if (fm) fm(x, y - F, o); else { o[0] = x; o[1] = y - F; } };
    // 2b. the hair near the outline of the skin, on the rows where it lies behind the face (see hairBehind): over the
    // clothing, under the skin that shows and under a beard on the face (drawn next)
    let shown = null;
    if (snap) {
      const box = this.box(hairL.e, F, [m0, m0, m0, m0 + down]);
      box[1] = Math.max(box[1], drawn.y0);
      box[3] = Math.min(box[3], drawn.y0 + drawn.h);
      const md = hairL.mask.data, he = hairL.e;
      const alpha = (x, y) => {
        const lx = x - he.x, ly = y - he.y;
        return lx < 0 || ly < 0 || lx >= he.w || ly >= he.h ? 0 : md[(ly * he.w + lx) * 4] / 255;
      };
      const map = (x, y, o) => {
        if (!behindNear(drawn, x, y)) { o[2] = 0; return; }
        hairSrc(x, y, o);
        behindBack(behind, o, alpha);
        if (o[2] > 0 && own) own(o);
      };
      // what of it shows (not behind the skin): a beard lies over the hair only where it lies on the face
      shown = s.beard !== 'none' ? new Float32Array(N * N) : null;
      const cloth = clothShown || await this.maskAt(clothId, clothFm, F);
      cv.part = 'hair';
      if (box[3] > box[1]) this.drawMapped(cv, hairL, map, box, null, { snap, cloth, shown });
      cv.part = null;
    }
    // 3. beard, then the mouth of the expression back on top of it
    const beardId = s.beard !== 'none' ? `${t}.${s.face}.b.${s.beard}` : null;
    if (beardId && has(beardId)) {
      // A beard that the model itself drew in this hair colour is drawn as it is (a light beard has its own
      // shading and highlights); otherwise the colour map recolours the dark brown one.
      const exactBeard = s.hair_color !== 'darkbrown' && has(`${beardId}.${s.hair_color}`)
        ? `${beardId}.${s.hair_color}` : null;
      const beardDraw = exactBeard || beardId;
      // its shadow is in the dark brown layer (a packed colour layer carries a copy, so one file is enough)
      const beardShadow = man.layers[beardDraw].s ? beardDraw : beardId;
      // a beard is made on the neutral face: under an expression it is drawn through the expression's map
      const em = expr ? await this.exprMap(t, s.face, s.expr) : null;
      const emBox = em ? this.box(man.layers[beardShadow], F, Array(4).fill(em.max + 2)) : null;
      const emMap = em ? (x, y, o) => em(x, y - F, o) : null;
      // Stubble has no layer of its own: it is all in its shadow map, which multiplies the skin (every hair and
      // the shade between them darken whatever skin tone is under them). The map is dark brown: under a light
      // hair colour it is kept softer, as the shadow of light stubble, and under black hair nearly grey.
      // The shadow that a fuller beard casts was drawn for a dark beard: beside a light one its deep parts
      // (under the ends of a mustache) read as dark stains, so a light beard keeps a third of it.
      const light = s.hair_color in BEARD_MIX;
      const stubble = s.beard.startsWith('stubble');
      const gain = !light ? 1 : stubble ? 0.6 : 0.33, sat = stubble && s.hair_color === 'black' ? 0.25 : 1;
      cv.part = 'beard';
      if (em) await this.shadowMapped(cv, beardShadow, emMap, emBox, gain, sat);
      else await this.shadow(cv, beardShadow, F, gain, sat);
      cv.part = null;
      // Light beard colours from the colour map: the thin wash at the edge of a beard fades out (over skin it
      // reads as paint). The model's own light beard keeps its edge.
      const alphaFn = !light || exactBeard ? null : (cx, cy, d, p) => {
        const a = d[p] / 255;
        return a <= 0.1 ? 0 : a >= 0.45 ? 1 : (a - 0.1) / 0.35;
      };
      // The hair maps are learned from glossy hair. On a matte beard the black map reads as navy, so a black
      // beard keeps only a little of the map's colour; the light maps read as paint, so a light beard keeps part
      // of its own darker colour (a blond man's beard is darker than his hair).
      const tune = s.hair_color === 'black' ? { sat: 0.25 } : light ? { mix: BEARD_MIX[s.hair_color] } : null;
      const beard = await this.layerColor(beardDraw, exactBeard ? partMaps(null) : partMaps(hairC, tune));
      const emDraw = em && exactBeard ? this.box(man.layers[beardDraw], F, Array(4).fill(em.max + 2)) : emBox;
      // beside the face, where hair behind it shows, the hair lies over the beard (as over everything else there)
      const off = shown ? (cx, cy) => 1 - shown[cy * N + cx] : null;
      cv.part = 'beard';
      if (em) this.drawMapped(cv, beard, emMap, emDraw, alphaFn, null, off);
      else this.draw(cv, beard, { dy: F, alphaFn: !off ? alphaFn : (cx, cy, d, p) => (alphaFn ? alphaFn(cx, cy, d, p) : 1) * off(cx, cy) });
      cv.part = null;
      if (expr && man.layers[exprId].mouth) {
        // the mouth of the expression (G channel of its mask: lips, teeth, tongue) goes back over the beard
        const mouthFn = (cx, cy, d, p) => d[p + 1] / 255;
        if (cheeks) this.drawCheeks(cv, expr, cheeks, F, mouthFn);
        else this.draw(cv, expr, { dy: F, alphaFn: mouthFn });
      }
    }
    // 4. glasses temple arms (behind the hair), hair, glasses front (in front of the hair)
    const glId = s.glasses !== 'none' ? `${t}.${s.face}.g.${s.glasses}` : null;
    let gl = null;
    if (glId && has(glId)) {
      gl = await this.layerColor(glId, partMaps(null));
      cv.part = 'glasses';
      await this.shadow(cv, glId, F);
      this.draw(cv, gl, { dy: F, alphaFn: (cx, cy, d, p) => 1 - d[p + 2] / 255 });
      cv.part = null;
    }
    if (hairId) {
      // a packed recoloured hairstyle carries its base layer's shadow; otherwise the base layer casts it
      const sid = man.layers[hairDraw].s ? hairDraw : hairId;
      const m = fm ? fm.max + 2 : 0, g = [m, m, m, m + down], box = this.box(hairL.e, F, g);
      const plain = (x, y, o) => { hairSrc(x, y, o); if (own) own(o); };
      // below the ears only what lay inside the template's outline goes over the face (see hairBehind)
      const front = !behind ? plain : (x, y, o) => {
        hairSrc(x, y, o);
        o[2] = behindFront(behind, drawn, x, y, o);
        if (o[2] > 0 && own) own(o);
      };
      cv.part = 'hair';
      await this.shadowMapped(cv, sid, plain, sid === hairDraw ? box : this.box(man.layers[sid], F, g));
      this.drawMapped(cv, hairL, front, box);
      cv.part = null;
    }
    if (gl) {
      cv.part = 'glasses';
      this.draw(cv, gl, { dy: F, alphaFn: (cx, cy, d, p) => d[p + 2] / 255 });
      cv.part = null;
    }
    // 5. headwear
    if (hat) {
      let own = null, grow = [0, 0, 0, 0];
      if (fit && fit.mode === 'top' && fit.shift) {
        const sh = fit.shift;
        own = (o) => { o[1] -= sh; };
        grow = [0, -sh, 0, 0];
      } else if (fit && fit.mode === 'part' && (fit.sx !== 1 || fit.sy !== 1 || fit.lift)) {
        const { ax, ay, sx, sy, r0, k, lift } = fit;
        // wider outside the width of the bare head, taller only above its lower edge over the forehead; over hair
        // a knitted hat sits higher (lift): its band drawn shorter, and its sides cut where they end, the shade it
        // casts fading out below that line
        own = (o) => {
          const x0 = o[0], y0 = o[1], d = o[0] - ax, r = d < 0 ? -d : d;
          if (r > r0) o[0] = ax + (d < 0 ? -1 : 1) * (r0 + (r - r0) * k);
          if (o[1] < ay) o[1] = ay + (o[1] - ay) / sy;
          if (lift) {
            if (o[1] > lift.P) { o[1] = lift.P + (o[1] - lift.P) * lift.c; o[3] = lift.c; }
            const yc = lift.ycut(x0);
            if (y0 > yc - lift.soft) {
              const a = o[2];
              o[2] = a * Math.min(Math.max((yc - y0) / lift.soft, 0), 1);
              o[4] = a * Math.min(Math.max((yc + lift.shade - y0) / lift.shade, 0), 1);
            }
          }
        };
        const g = (sx - 1) * hat.w / 2 + 2;
        grow = [g, (sy - 1) * (ay - hat.y) + 2, g, 2];
      }
      // headwear that wraps the face follows the chin and the cheeks of an expression and the chin of the face
      // shape (see wrapMap)
      const hctx = hatMap !== ctx.fm ? { F, fm: hatMap } : ctx;
      // The image model drew the hat's shadow on the bare skin under it. Hair that comes out from under the hat lies
      // in front of that skin and catches the light around the brim, so it takes only a share of that shadow
      // (HAT_SHADE_HAIR): in all of it the tips of a fringe under a cap's brim read as shadow, not as hair.
      if (cv.hairCov) {
        const place = own, hc = cv.hairCov;
        own = (o) => {
          o[4] = NaN;
          if (place) place(o);
          o[4] = (o[4] === o[4] ? o[4] : o[2]) * (1 - HAT_SHADE_HAIR * hc[(o[6] | 0) * N + (o[5] | 0)]);
        };
      }
      if (hatMap && hatMap.down) grow = [grow[0], grow[1], grow[2], grow[3] + hatMap.down];
      cv.part = 'hat';
      await this.drawPart(cv, hctx, hatId, partMaps(null), own, grow);
      cv.part = null;
    }
    // 6. background, or none
    const out = finish(N, cv.rgb, cv.cov, s.bg);
    if (!cv.track) return { width: N, height: N, data: out };
    const res = { width: N, height: N, data: out, parts: {} };
    for (const d of cv.track) {
      if (!d.on) { // nothing of it was drawn: no cover, and the picture as it is
        res.parts[d.name] = { cover: new Float32Array(N * N), without: { width: N, height: N, data: out.slice() },
          tones: null };
        continue;
      }
      const tones = partTones(d.rgb, d.cov);
      // in place: the share becomes the picture without the part (the canvas less the share, plus u), its coverage
      // the cover
      const C = cv.rgb, Cc = cv.cov, rgb = d.rgb, cover = d.cov, u = d.u, cov = new Float32Array(N * N);
      for (let i = 0, q = 0; i < N * N; i++, q += 3) {
        const c = cover[i] < 0 ? 0 : cover[i] > 1 ? 1 : cover[i], w = Cc[i] - c;
        cover[i] = c;
        cov[i] = w < 0 ? 0 : w > 1 ? 1 : w;
        let r = C[q] - rgb[q], g = C[q + 1] - rgb[q + 1], b = C[q + 2] - rgb[q + 2];
        if (u) { r += u[q]; g += u[q + 1]; b += u[q + 2]; }
        rgb[q] = r < 0 ? 0 : r; rgb[q + 1] = g < 0 ? 0 : g; rgb[q + 2] = b < 0 ? 0 : b;
      }
      res.parts[d.name] = { cover, without: { width: N, height: N, data: finish(N, rgb, cov, s.bg) }, tones };
    }
    return res;
  }
}

// The parts compose() can keep apart (its `parts`): those drawn after the face.
export const PARTS = ['cloth', 'hair', 'beard', 'glasses', 'hat'];

// The canvas (rgb weighted by coverage, and cov) on a background: '#rrggbb', or 'transparent' (or none) for the
// avatar's own alpha. RGBA bytes, straight alpha.
function finish(N, rgb, cov, bgHex) {
  const out = new Uint8ClampedArray(N * N * 4);
  if (!bgHex || bgHex === 'transparent') {
    for (let i = 0; i < N * N; i++) {
      const c = cov[i];
      if (c <= 0) continue;
      out[i * 4] = (rgb[i * 3] / c) * 255 + 0.5;
      out[i * 4 + 1] = (rgb[i * 3 + 1] / c) * 255 + 0.5;
      out[i * 4 + 2] = (rgb[i * 3 + 2] / c) * 255 + 0.5;
      out[i * 4 + 3] = c * 255 + 0.5;
    }
  } else {
    const bg = hexRgb(bgHex);
    for (let i = 0; i < N * N; i++) {
      const k = 1 - cov[i];
      out[i * 4] = (rgb[i * 3] + k * bg[0]) * 255 + 0.5;
      out[i * 4 + 1] = (rgb[i * 3 + 1] + k * bg[1]) * 255 + 0.5;
      out[i * 4 + 2] = (rgb[i * 3 + 2] + k * bg[2]) * 255 + 0.5;
      out[i * 4 + 3] = 255;
    }
  }
  return out;
}

// The colours of a part as they show in the picture (its own share, see trackOver; rgb weighted by coverage):
// `mean`, weighted by how much of each pixel it makes up, and `dark` and `light`, the means of the darkest and the
// lightest fifth (by luminance, in 256 steps) of the pixels it makes up at least half of. '#rrggbb' each; null when
// the part does not show.
function partTones(rgb, cov) {
  let R = 0, G = 0, B = 0, W = 0, n = 0;
  const bins = new Uint32Array(256), bin = new Uint8Array(cov.length);
  for (let i = 0; i < cov.length; i++) {
    const c = cov[i];
    if (c < 0.002) continue; // under half a step of a byte: nothing that shows
    R += rgb[i * 3]; G += rgb[i * 3 + 1]; B += rgb[i * 3 + 2]; W += c;
    if (c < 0.5) continue;
    const y = (0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2]) / c;
    const b = Math.min(255, Math.max(0, Math.round(y * 255)));
    bin[i] = b + 1; bins[b]++; n++; // bin + 1: 0 marks a pixel that does not count
  }
  if (W <= 0) return null;
  const hex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
  const m = hex(R / W, G / W, B / W);
  if (!n) return { mean: m, dark: m, light: m };
  // the bins that hold the darkest and the lightest fifth (a bin that crosses the line counts whole)
  const fifth = Math.max(1, Math.round(n / 5));
  let lo = 0, hi = 255;
  for (let s = 0; lo < 255 && (s += bins[lo]) < fifth; lo++);
  for (let s = 0; hi > 0 && (s += bins[hi]) < fifth; hi--);
  const mean = (inside) => {
    let r = 0, g = 0, b = 0, k = 0;
    for (let i = 0; i < cov.length; i++) {
      if (!bin[i] || !inside(bin[i] - 1)) continue;
      r += rgb[i * 3] / cov[i]; g += rgb[i * 3 + 1] / cov[i]; b += rgb[i * 3 + 2] / cov[i]; k++;
    }
    return hex(r / k, g / k, b / k);
  };
  return { mean: m, dark: mean((v) => v <= lo), light: mean((v) => v >= hi) };
}

export function hexRgb(h) {
  const v = parseInt(h.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

// Scales a square RGBA image down to size x size by area averaging (alpha-weighted, so a transparent
// background does not darken the avatar's edge).
export function resize(img, size) {
  const N = img.width;
  if (size >= N) return img;
  const src = img.data, out = new Uint8ClampedArray(size * size * 4), r = N / size;
  for (let y = 0; y < size; y++) {
    const y0 = y * r, y1 = (y + 1) * r;
    for (let x = 0; x < size; x++) {
      const x0 = x * r, x1 = (x + 1) * r;
      let A = 0, R = 0, G = 0, B = 0, W = 0;
      for (let sy = Math.floor(y0); sy < y1; sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        for (let sx = Math.floor(x0); sx < x1; sx++) {
          const w = wy * (Math.min(sx + 1, x1) - Math.max(sx, x0)), p = (sy * N + sx) * 4, a = src[p + 3] * w;
          W += w; A += a; R += src[p] * a; G += src[p + 1] * a; B += src[p + 2] * a;
        }
      }
      const q = (y * size + x) * 4;
      if (A > 0) { out[q] = R / A + 0.5; out[q + 1] = G / A + 0.5; out[q + 2] = B / A + 0.5; }
      out[q + 3] = A / W + 0.5;
    }
  }
  return { width: size, height: size, data: out };
}
