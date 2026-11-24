// Types of Pixitoons, 3D avatar library.

/** The version of this package, for example "1.0.0". */
export const VERSION: string;
/** The build of the avatar files this version was released with (assets/manifest.json "build"). */
export const BUILD: string;
/** Where the avatar files of this version are served: jsDelivr, from the GitHub release of this version. */
export const CDN_BASE: string;
/** Version of the seed -> selection rule. */
export const SELECTION_VERSION: number;
/** The background colours a seed can draw. */
export const BACKGROUNDS: readonly string[];
/** The parts that `render(..., { parts })` can keep apart. */
export const PARTS: readonly PartName[];

export type PartName = 'cloth' | 'hair' | 'beard' | 'glasses' | 'hat';

/** Everything that makes one avatar. `select(seed)` gives one; `options()` lists the values of each field. */
export interface Selection {
  /** Template: "tF" (feminine) or "tM" (masculine). */
  t: string;
  face: string;
  expr: string;
  /** Skin tone. */
  tone: number;
  eye: string;
  hair: string;
  hair_color: string;
  beard: string;
  glasses: string;
  hat: string;
  cloth: string;
  cloth_color: string;
  /** "#rrggbb", or "transparent". */
  bg: string;
}

/** Fields to fix; the others keep what the seed gives. Values may be text, as they arrive from a URL or an attribute. */
export type Overrides = Partial<{ [K in keyof Selection]: string | number }>;

export interface RenderOptions {
  /** Output edge in pixels, up to 1024 (the size the avatar is composed at). */
  size?: number;
  /** "#rrggbb", or "transparent". Default: the background the seed draws. */
  background?: string;
  /** With a seed: fields to fix. */
  overrides?: Overrides;
  /** Default true: every avatar moves down by one fixed amount, so the tallest hair and headwear stay in the image. */
  frame?: boolean;
  /**
   * Parts to keep apart, from the same compose as the picture (which stays the same): the result then has `parts`
   * with a PartResult for each.
   */
  parts?: readonly PartName[];
}

export interface BlobOptions extends RenderOptions {
  /** Image type, default "image/png". */
  type?: string;
  /** Quality for lossy types (0 to 1). */
  quality?: number;
}

export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** The colours of a part as it shows in the picture, as "#rrggbb": the mean, and the means of its darkest and lightest fifth. */
export interface PartTones {
  mean: string;
  dark: string;
  light: string;
}

export interface PartResult {
  /** size * size bytes: how much of each pixel the part makes up in the picture, after everything drawn over it (0 to 255). */
  cover: Uint8ClampedArray;
  /**
   * The picture with the part cut out: transparent (or the background) where the part was, since what it covers is
   * not drawn again, and the shadows it casts stay. For the garment: the head without it, for a body that wears it.
   * To see what lies under a beard, glasses or a hat, render again with it set to "none" in `overrides`.
   */
  without: RGBAImage;
  /** null when the selection has no such part (for example glasses "none"). */
  tones: PartTones | null;
}

export interface RGBAImageWithParts<P extends PartName = PartName> extends RGBAImage {
  parts: { [K in P]: PartResult };
}

export type SeedOrSelection = string | number | Selection;

export interface Avatars {
  /** The manifest of the avatar files (layers, option lists, build). */
  readonly manifest: { size: number; build: string; [key: string]: unknown };
  /** The engine that composes the layers. */
  readonly engine: unknown;
  /** The selection a seed gives, with any fields fixed by `overrides`. */
  select(seed: string | number, overrides?: Overrides): Selection;
  /** The values each field can take for a template (and, for per-face parts, a face). */
  options(t: string, face?: string | null): { [K in keyof Selection]: Array<string | number> };
  /** The avatar as RGBA bytes; with `parts`, also the parts kept apart. */
  render<P extends PartName>(
    seedOrSelection: SeedOrSelection,
    options: RenderOptions & { parts: readonly P[] },
  ): Promise<RGBAImageWithParts<P>>;
  render(seedOrSelection: SeedOrSelection, options?: RenderOptions): Promise<RGBAImage>;
  /**
   * The addresses of the files a seed or a selection needs, each once, for fetching ahead or for a service worker.
   * A render fetches all of them together.
   */
  files(seedOrSelection: SeedOrSelection, options?: { overrides?: Overrides }): string[];
  /** Fetches and decodes the files of seeds or selections into this instance's caches; resolves when all are in. */
  preload(seedsOrSelections: SeedOrSelection | SeedOrSelection[], options?: { overrides?: Overrides }): Promise<void>;
  /** Needs a page: in a Web Worker it throws (use render, toBlob or toURL there). */
  toCanvas(seedOrSelection: SeedOrSelection, options?: RenderOptions): Promise<HTMLCanvasElement>;
  /** A PNG by default. In a Web Worker it is encoded with OffscreenCanvas.convertToBlob. */
  toBlob(seedOrSelection: SeedOrSelection, options?: BlobOptions): Promise<Blob>;
  /** An object URL for an <img>. Call URL.revokeObjectURL on it when the image is no longer shown. */
  toURL(seedOrSelection: SeedOrSelection, options?: BlobOptions): Promise<string>;
  /**
   * Registers the custom element (default name "pixitoons-avatar"):
   * <pixitoons-avatar seed="dana" size="96" background="transparent" hair_color="ginger" alt="Dana">.
   * Needs a page: in a Web Worker it throws.
   */
  define(name?: string): void;
}

export interface CreateOptions {
  /**
   * The folder that holds manifest.json, l/ and lut/ of this version. Default: CDN_BASE. A relative address is read
   * against the page, or in a Web Worker against the worker's script.
   */
  base?: string;
  /** Memory budget of this instance's layer cache, in bytes (default 192 MB). Each instance (each worker) has its own. */
  imageBytes?: number;
  /** Memory budget of this instance's colour cache, in bytes (default 128 MB). Each instance (each worker) has its own. */
  colorBytes?: number;
}

/** Loads the manifest and returns the avatar API. Runs in the browser, on a page or in a Web Worker. */
export function createAvatars(options?: CreateOptions): Promise<Avatars>;
