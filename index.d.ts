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
  /** The avatar as RGBA bytes. */
  render(seedOrSelection: SeedOrSelection, options?: RenderOptions): Promise<RGBAImage>;
  toCanvas(seedOrSelection: SeedOrSelection, options?: RenderOptions): Promise<HTMLCanvasElement>;
  toBlob(seedOrSelection: SeedOrSelection, options?: BlobOptions): Promise<Blob>;
  /** An object URL for an <img>. Call URL.revokeObjectURL on it when the image is no longer shown. */
  toURL(seedOrSelection: SeedOrSelection, options?: BlobOptions): Promise<string>;
  /**
   * Registers the custom element (default name "pixitoons-avatar"):
   * <pixitoons-avatar seed="dana" size="96" background="transparent" hair_color="ginger" alt="Dana">.
   */
  define(name?: string): void;
}

export interface CreateOptions {
  /** The folder that holds manifest.json, l/ and lut/ of this version. Default: CDN_BASE. */
  base?: string;
  /** Memory budget of the engine's layer cache, in bytes (default 192 MB). */
  imageBytes?: number;
  /** Memory budget of the engine's colour cache, in bytes (default 128 MB). */
  colorBytes?: number;
}

/** Loads the manifest and returns the avatar API. Runs in the browser only. */
export function createAvatars(options?: CreateOptions): Promise<Avatars>;
