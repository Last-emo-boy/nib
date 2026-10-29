// Compare two PNGs of the same frame.
//   node scripts/compare.ts <expected.png> <actual.png> [diff.png] [x y w h]
// Prints the share of differing pixels, the mean channel error, and the vertical/horizontal shift of the
// region's ink that best aligns actual with expected (a quick way to spot layout offsets).
import fs from 'node:fs';
import { loadCanvasKit } from '@nib/render';

const [expPath, actPath, diffPath, ...region] = process.argv.slice(2);
const ck = await loadCanvasKit();

function pixels(file: string) {
  const img = ck.MakeImageFromEncoded(fs.readFileSync(file));
  if (!img) throw new Error(`cannot decode ${file}`);
  const w = img.width(), h = img.height();
  const data = img.readPixels(0, 0, { width: w, height: h, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
  img.delete();
  return { w, h, data };
}

const a = pixels(expPath), b = pixels(actPath);
const w = Math.min(a.w, b.w), h = Math.min(a.h, b.h);
const [rx, ry, rw, rh] = region.length === 4 ? region.map(Number) : [0, 0, w, h];

/** Composite over white so transparent and white compare equal. */
const lum = (p: { w: number; data: Uint8Array }, x: number, y: number, c: number) => {
  const i = (y * p.w + x) * 4;
  const al = p.data[i + 3] / 255;
  return p.data[i + c] * al + 255 * (1 - al);
};

let differing = 0, total = 0, err = 0;
const diff = new Uint8Array(w * h * 4);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  let d = 0;
  for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(lum(a, x, y, c) - lum(b, x, y, c)));
  err += d; total++;
  if (d > 24) differing++;
  const i = (y * w + x) * 4;
  const g = 255 - lum(a, x, y, 0) * 0.15;
  diff[i] = d > 24 ? 255 : g; diff[i + 1] = d > 24 ? 0 : g; diff[i + 2] = d > 24 ? 0 : g; diff[i + 3] = 255;
}
console.log(`size expected ${a.w}x${a.h} actual ${b.w}x${b.h}`);
console.log(`differing ${(100 * differing / total).toFixed(2)}% (channel delta > 24), mean delta ${(err / total).toFixed(2)}`);

/** Ink (darkness) profile along one axis of the rect at (x, y) sized w x h. */
const profile = (p: typeof a, axis: 'x' | 'y', x0: number, y0: number, pw: number, ph: number) => {
  const out = new Float64Array(axis === 'y' ? ph : pw);
  for (let j = 0; j < ph; j++) for (let i = 0; i < pw; i++) {
    const x = x0 + i, y = y0 + j;
    if (x < 0 || y < 0 || x >= p.w || y >= p.h) continue;
    out[axis === 'y' ? j : i] += 255 - (lum(p, x, y, 0) + lum(p, x, y, 1) + lum(p, x, y, 2)) / 3;
  }
  return out;
};
const M = 12;
/** Shift s such that actual[i + s] best matches expected[i]; actual is profiled with a margin M on both sides. */
const bestShift = (pa: Float64Array, pb: Float64Array) => {
  let best = 0, bestScore = Infinity;
  for (let s = -M; s <= M; s++) {
    let score = 0;
    for (let i = 0; i < pa.length; i++) score += Math.abs(pa[i] - pb[i + s + M]);
    if (score < bestScore) { bestScore = score; best = s; }
  }
  return best;
};
const dx = bestShift(profile(a, 'x', rx, ry, rw, rh), profile(b, 'x', rx - M, ry, rw + 2 * M, rh));
const dy = bestShift(profile(a, 'y', rx, ry, rw, rh), profile(b, 'y', rx, ry - M, rw, rh + 2 * M));
console.log(`region ${rx},${ry} ${rw}x${rh}: actual is shifted by dx ${dx}, dy ${dy}`);

if (diffPath) {
  const img = ck.MakeImage({ width: w, height: h, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }, diff, w * 4);
  fs.writeFileSync(diffPath, img!.encodeToBytes()!);
}
