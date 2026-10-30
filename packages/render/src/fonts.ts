import type { CanvasKit, Typeface, TypefaceFontProvider } from 'canvaskit-wasm';
import { faceInfo } from './sfnt.ts';

export interface FontFace {
  family: string;
  weight: number;
  italic: boolean;
}

/** Fetches font files. Returns undefined when the family or face does not exist. */
export interface FontLoader {
  load(face: FontFace): Promise<Uint8Array | undefined>;
}

const WEIGHT_NAMES: Record<string, number> = {
  thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, normal: 400, regular: 400,
  book: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800,
  black: 900, heavy: 900,
};

/** `fontWeight` as a number: "600", "semibold", "bold" ... Default 400. */
export function fontWeight(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
    const named = WEIGHT_NAMES[v.toLowerCase().replace(/[\s_-]/g, '')];
    if (named) return named;
  }
  return 400;
}

export const isItalic = (style: unknown) => typeof style === 'string' && /italic|oblique/i.test(style);

export const faceKey = (f: FontFace) => `${f.family}|${f.weight}|${f.italic ? 'i' : ''}`;

/** Vertical metrics in px, rounded to whole pixels the way Chromium rounds them for layout. */
export interface LineMetricsPx { ascent: number; descent: number; lineGap: number }

interface Registered { weight: number; italic: boolean; typeface: Typeface }

/** Fonts registered with CanvasKit, loaded on demand. */
export class FontStore {
  readonly provider: TypefaceFontProvider;
  private ck: CanvasKit;
  private loader: FontLoader;
  private pending = new Map<string, Promise<boolean>>();
  private settled = new Set<string>();
  private missingFaces = new Map<string, FontFace>();
  private faces = new Map<string, Registered[]>();
  private metricsCache = new Map<string, LineMetricsPx>();

  constructor(ck: CanvasKit, loader: FontLoader) {
    this.ck = ck;
    this.provider = ck.TypefaceFontProvider.Make();
    this.loader = loader;
  }

  /** Whether any face of `family` is loaded. */
  has(family: string): boolean {
    return (this.faces.get(family.toLowerCase())?.length ?? 0) > 0;
  }

  /** The loaded face of `family` closest to `weight`/`italic`. */
  private face(family: string, weight: number, italic: boolean): Registered | undefined {
    const list = this.faces.get(family.toLowerCase());
    if (!list?.length) return undefined;
    const cost = (f: Registered) => (f.italic === italic ? 0 : 1e4) + Math.abs(f.weight - weight);
    return list.reduce((a, b) => (cost(b) < cost(a) ? b : a));
  }

  /** Whether that face has a glyph for every character of `text`. */
  covers(family: string, weight: number, italic: boolean, text: string): boolean {
    const face = this.face(family, weight, italic);
    if (!face) return false;
    const chars = [...text].filter((c) => c.trim() !== '');
    return chars.length === 0 || [...face.typeface.getGlyphIDs(chars.join(''))].every((g) => g !== 0);
  }

  /**
   * Metrics of the loaded face of `family` closest to `weight`/`italic`, at `size` px. Ascent, descent and
   * line gap are each rounded, as Chromium does before it builds line boxes.
   */
  metrics(family: string, weight: number, italic: boolean, size: number): LineMetricsPx | undefined {
    const face = this.face(family, weight, italic);
    if (!face) return undefined;
    const key = `${family}|${face.weight}|${face.italic}|${size}`;
    let m = this.metricsCache.get(key);
    if (!m) {
      const font = new this.ck.Font(face.typeface, size);
      const fm = font.getMetrics();
      font.delete();
      m = { ascent: Math.round(-fm.ascent), descent: Math.round(fm.descent), lineGap: Math.round(fm.leading) };
      this.metricsCache.set(key, m);
    }
    return m;
  }

  /** Load every face that is not loaded yet. Faces that cannot be found are remembered as missing. */
  async ensure(faces: Iterable<FontFace>): Promise<void> {
    const work: Promise<boolean>[] = [];
    for (const face of faces) {
      const key = faceKey(face);
      let p = this.pending.get(key);
      if (!p) {
        p = this.loader.load(face).then(
          (bytes) => {
            if (!bytes) { this.missingFaces.set(key, face); return false; }
            this.register(bytes, face);
            return true;
          },
          () => { this.missingFaces.set(key, face); return false; },
        ).finally(() => this.settled.add(key));
        this.pending.set(key, p);
      }
      work.push(p);
    }
    await Promise.all(work);
  }

  /** Faces whose loading has not finished (or not started). */
  unsettled(faces: Iterable<FontFace>): FontFace[] {
    const out = new Map<string, FontFace>();
    for (const f of faces) if (!this.settled.has(faceKey(f))) out.set(faceKey(f), f);
    return [...out.values()];
  }

  missing(): FontFace[] {
    return [...this.missingFaces.values()];
  }

  /** Register a face once, even when several requested weights resolve to the same file. */
  private register(bytes: Uint8Array, requested: FontFace): void {
    const info = faceInfo(bytes, 0);
    const weight = info?.weight ?? requested.weight, italic = info?.italic ?? requested.italic;
    const key = requested.family.toLowerCase();
    const list = this.faces.get(key) ?? [];
    if (list.some((f) => f.weight === weight && f.italic === italic)) return;
    const typeface = this.ck.Typeface.MakeTypefaceFromData(bytes.slice().buffer);
    if (!typeface) return;
    this.provider.registerFont(bytes, requested.family);
    list.push({ weight, italic, typeface });
    this.faces.set(key, list);
  }
}
