import type { CanvasKit } from 'canvaskit-wasm';

/**
 * Comparing a rendered design with a reference picture (a screenshot to recreate, a page as built): both at
 * the same size, composited over white, compared pixel by pixel.
 */

export interface Pixels { width: number; height: number; rgba: Uint8Array }

export interface Comparison {
  /** 1 identical .. 0 opposite: one minus the mean color difference. */
  similarity: number;
  /** Share of pixels that differ noticeably (more than 10% in color). */
  changed: number;
  /** The design in gray with the differing pixels in red, stronger where they differ more. */
  diff: Pixels;
  /** Share of differing pixels in each ninth of the picture, rows from the top: top-left … bottom-right. */
  cells: number[];
}

export const CELL_NAMES = ['top-left', 'top', 'top-right', 'left', 'middle', 'right', 'bottom-left', 'bottom', 'bottom-right'];

const THRESHOLD = 0.1;

/** Compare two pictures of the same size. */
export function comparePixels(a: Pixels, b: Pixels): Comparison {
  if (a.width !== b.width || a.height !== b.height) throw new Error('pictures to compare must have the same size');
  const n = a.width * a.height;
  const diff = new Uint8Array(n * 4);
  const cellChanged = new Array(9).fill(0), cellSize = new Array(9).fill(0);
  let total = 0, changed = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const cell = Math.min(2, Math.floor((Math.floor(i / a.width) * 3) / a.height)) * 3 + Math.min(2, Math.floor(((i % a.width) * 3) / a.width));
    cellSize[cell]++;
    // Over white, so transparent and white read the same.
    const over = (p: Uint8Array, k: number) => p[o + k] * (p[o + 3] / 255) + 255 * (1 - p[o + 3] / 255);
    const ar = over(a.rgba, 0), ag = over(a.rgba, 1), ab = over(a.rgba, 2);
    const d = (Math.abs(ar - over(b.rgba, 0)) + Math.abs(ag - over(b.rgba, 1)) + Math.abs(ab - over(b.rgba, 2))) / (3 * 255);
    total += d;
    const gray = 255 - (255 - (0.3 * ar + 0.59 * ag + 0.11 * ab)) * 0.4;
    if (d > THRESHOLD) {
      changed++;
      cellChanged[cell]++;
      const k = Math.min(1, 0.35 + d);
      diff[o] = Math.round(gray * (1 - k) + 230 * k);
      diff[o + 1] = Math.round(gray * (1 - k) + 40 * k);
      diff[o + 2] = Math.round(gray * (1 - k) + 40 * k);
    } else {
      diff[o] = diff[o + 1] = diff[o + 2] = Math.round(gray);
    }
    diff[o + 3] = 255;
  }
  return {
    similarity: n ? 1 - total / n : 1, changed: n ? changed / n : 0, diff: { width: a.width, height: a.height, rgba: diff },
    cells: cellChanged.map((c, i) => (cellSize[i] ? c / cellSize[i] : 0)),
  };
}

/** The top-left `width` × `height` of a picture, transparent (white when compared) where it is smaller. */
export function cropPixels(p: Pixels, width: number, height: number): Pixels {
  if (p.width === width && p.height === height) return p;
  const rgba = new Uint8Array(width * height * 4);
  const w = Math.min(width, p.width) * 4;
  for (let y = 0; y < Math.min(height, p.height); y++) rgba.set(p.rgba.subarray(y * p.width * 4, y * p.width * 4 + w), y * width * 4);
  return { width, height, rgba };
}

/** An encoded picture (PNG, JPEG, WebP, GIF) as pixels. */
export function decodePixels(ck: CanvasKit, bytes: Uint8Array): Pixels {
  const img = ck.MakeImageFromEncoded(bytes);
  if (!img) throw new Error('not a picture nib can read (PNG, JPEG, WebP, GIF)');
  try {
    const width = img.width(), height = img.height();
    const rgba = img.readPixels(0, 0, { width, height, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB });
    if (!rgba) throw new Error('cannot read the picture');
    return { width, height, rgba: rgba as Uint8Array };
  } finally {
    img.delete();
  }
}

/** Pixels drawn at another size (smoothly). */
export function resizePixels(ck: CanvasKit, p: Pixels, width: number, height: number): Pixels {
  if (p.width === width && p.height === height) return p;
  const info = { width: p.width, height: p.height, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB };
  const img = ck.MakeImage(info, p.rgba, p.width * 4);
  const surface = ck.MakeSurface(width, height);
  if (!img || !surface) throw new Error('cannot resize the picture');
  try {
    const c = surface.getCanvas();
    c.clear(ck.TRANSPARENT);
    c.drawImageRectOptions(img, ck.LTRBRect(0, 0, p.width, p.height), ck.LTRBRect(0, 0, width, height), ck.FilterMode.Linear, ck.MipmapMode.Linear, null);
    const snap = surface.makeImageSnapshot();
    const rgba = snap.readPixels(0, 0, { width, height, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB });
    snap.delete();
    if (!rgba) throw new Error('cannot resize the picture');
    return { width, height, rgba: rgba as Uint8Array };
  } finally {
    img.delete();
    surface.delete();
  }
}

/** Pixels as a PNG. */
export function encodePng(ck: CanvasKit, p: Pixels): Uint8Array {
  const img = ck.MakeImage({ width: p.width, height: p.height, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }, p.rgba, p.width * 4);
  if (!img) throw new Error('cannot encode the picture');
  try {
    const bytes = img.encodeToBytes(ck.ImageFormat.PNG, 100);
    if (!bytes) throw new Error('cannot encode the picture');
    return bytes;
  } finally {
    img.delete();
  }
}
