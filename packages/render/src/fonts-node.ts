import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FontFace, FontLoader } from './fonts.ts';

const CSS_API = 'https://fonts.googleapis.com/css2';

/**
 * Google Fonts, cached on disk. A plain client gets one TrueType file per face, CJK families included.
 * When a weight does not exist the nearest available one is used, as CSS font matching would.
 */
export class GoogleFontsLoader implements FontLoader {
  private dir: string;

  constructor(cacheDir = path.join(os.homedir(), '.cache', 'nib', 'fonts')) {
    this.dir = cacheDir;
  }

  async load(face: FontFace): Promise<Uint8Array | undefined> {
    const famDir = path.join(this.dir, face.family.replace(/[^\w.-]+/g, '_'));
    const base = (w: number) => path.join(famDir, `${w}${face.italic ? 'i' : ''}`);
    for (const w of nearestWeights(face.weight)) {
      const hit = await readOrUndefined(`${base(w)}.ttf`);
      if (hit) return hit;
      if (await readOrUndefined(`${base(w)}.missing`)) continue;
      const bytes = await this.download(face.family, w, face.italic);
      await fs.mkdir(famDir, { recursive: true });
      if (bytes) {
        await fs.writeFile(`${base(w)}.ttf`, bytes);
        return bytes;
      }
      await fs.writeFile(`${base(w)}.missing`, 'not on Google Fonts\n');
    }
    return undefined;
  }

  /** Undefined when Google Fonts has no such face (HTTP 400); network and server errors throw. */
  private async download(family: string, weight: number, italic: boolean): Promise<Uint8Array | undefined> {
    const url = `${CSS_API}?family=${encodeURIComponent(family).replace(/%20/g, '+')}:ital,wght@${italic ? 1 : 0},${weight}`;
    const res = await fetch(url);
    if (res.status === 400) return undefined;
    if (!res.ok) throw new Error(`Google Fonts ${res.status} for ${family} ${weight}`);
    const src = /url\((https:[^)]+)\)\s*format\('truetype'\)/.exec(await res.text())?.[1];
    if (!src) throw new Error(`no TrueType source for ${family} ${weight}`);
    const font = await fetch(src);
    if (!font.ok) throw new Error(`font download ${font.status}: ${src}`);
    return new Uint8Array(await font.arrayBuffer());
  }
}

/**
 * The requested weight, then the others in CSS fallback order: 400 tries 500 next, 500 tries 400,
 * lighter weights look lighter first, heavier weights look heavier first.
 */
export function nearestWeights(w: number): number[] {
  const target = Math.min(900, Math.max(100, Math.round(w / 100) * 100));
  const all = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  const lighter = all.filter((x) => x < target).reverse();
  const heavier = all.filter((x) => x > target);
  if (target === 400) return [400, 500, ...lighter, ...heavier.slice(1)];
  if (target === 500) return [500, 400, ...lighter.slice(1), ...heavier];
  return target < 400 ? [target, ...lighter, ...heavier] : [target, ...heavier, ...lighter];
}

async function readOrUndefined(file: string): Promise<Uint8Array | undefined> {
  try {
    return new Uint8Array(await fs.readFile(file));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}
