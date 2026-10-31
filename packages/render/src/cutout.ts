import type { Pixels } from './compare.ts';

/**
 * Remove a picture's background when it is a plain color (a product shot, a portrait against a wall): the
 * color its edges share is taken away from the edges inwards, as far as it reaches, and the subject's own
 * edge is softened where it blends into it.
 */
export function removeBackground(p: Pixels, tolerance = 0.12): { pixels: Pixels; removed: number } {
  const { width: w, height: h, rgba } = p;
  const n = w * h;
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  const solid = border.filter((i) => rgba[i * 4 + 3] >= 128);
  if (!solid.length) throw new Error('the picture already has a transparent background');
  // The background: the median color along the edges.
  const median = (c: number) => { const v = solid.map((i) => rgba[i * 4 + c]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const bg = [median(0), median(1), median(2)];
  const dist = (i: number) => Math.hypot(rgba[i * 4] - bg[0], rgba[i * 4 + 1] - bg[1], rgba[i * 4 + 2] - bg[2]) / (255 * Math.sqrt(3));
  if (solid.filter((i) => dist(i) < tolerance).length < solid.length * 0.5) throw new Error('the picture has no plain background around its edges to take away');
  const isBg = new Uint8Array(n);
  const queue: number[] = [];
  for (const i of border) if (!isBg[i] && (rgba[i * 4 + 3] < 128 || dist(i) < tolerance)) { isBg[i] = 1; queue.push(i); }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], x = i % w, y = (i - x) / w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j >= 0 && !isBg[j] && (rgba[j * 4 + 3] < 128 || dist(j) < tolerance)) { isBg[j] = 1; queue.push(j); }
    }
  }
  const out = new Uint8Array(rgba);
  let removed = 0;
  for (let i = 0; i < n; i++) {
    if (isBg[i]) { out[i * 4 + 3] = 0; removed++; continue; }
    const x = i % w, y = (i - x) / w;
    const touches = (x > 0 && isBg[i - 1]) || (x < w - 1 && isBg[i + 1]) || (y > 0 && isBg[i - w]) || (y < h - 1 && isBg[i + w]);
    if (!touches) continue;
    // An edge pixel partly the background's color: partly see-through, its own color recovered.
    const a = Math.max(0, Math.min(1, (dist(i) - tolerance * 0.5) / tolerance));
    if (a < 1) {
      for (let c = 0; c < 3; c++) out[i * 4 + c] = a > 0.05 ? Math.max(0, Math.min(255, Math.round((rgba[i * 4 + c] - (1 - a) * bg[c]) / a))) : rgba[i * 4 + c];
      out[i * 4 + 3] = Math.round(rgba[i * 4 + 3] * a);
    }
  }
  if (removed < n * 0.01) throw new Error('found no background to take away at the picture\'s edges');
  return { pixels: { width: w, height: h, rgba: out }, removed: removed / n };
}
