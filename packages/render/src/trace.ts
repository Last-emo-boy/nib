import type { PathPoint, Pt, SubPath } from '@nib/core';
import type { Pixels } from './compare.ts';

/**
 * Vectorize: a picture as flat-colored shapes. Its colors are reduced to a few (k-means), and each color's
 * region is traced along pixel edges into closed outlines, simplified and smoothed (corners kept). Layers
 * stack from the color covering most of the picture up, each also covering the area of the ones drawn
 * after it, so neighbouring shapes overlap instead of leaving hairline gaps.
 */

export interface TracedLayer { color: string; subs: SubPath[] }
export interface Traced { width: number; height: number; layers: TracedLayer[] }

/** The picture at most `maxSide` on its longer side, each pixel the average of what it covers. */
export function downscale(p: Pixels, maxSide: number): Pixels {
  const k = Math.max(p.width, p.height) / maxSide;
  if (k <= 1) return p;
  const w = Math.max(1, Math.round(p.width / k)), h = Math.max(1, Math.round(p.height / k));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * p.height) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * p.height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * p.width) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * p.width) / w));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const o = (yy * p.width + xx) * 4, al = p.rgba[o + 3];
        // Weighted by alpha, so transparent pixels do not darken the colors around them.
        r += p.rgba[o] * al; g += p.rgba[o + 1] * al; b += p.rgba[o + 2] * al; a += al; n++;
      }
      const o = (y * w + x) * 4;
      if (a) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
      out[o + 3] = a / n;
    }
  }
  return { width: w, height: h, rgba: out };
}

type RGB = [number, number, number];
const d2 = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** `k` colors that stand for the samples: k-means from spread-out starting colors (the same every time). */
export function kmeans(samples: RGB[], k: number): RGB[] {
  const mean = [0, 1, 2].map((c) => samples.reduce((s, x) => s + x[c], 0) / samples.length) as RGB;
  const centers: RGB[] = [samples.reduce((best, x) => (d2(x, mean) < d2(best, mean) ? x : best))];
  // Each next start is the sample farthest from those chosen.
  const near = samples.map((x) => d2(x, centers[0]));
  while (centers.length < k) {
    let far = -1, at = 0;
    for (let i = 0; i < samples.length; i++) if (near[i] > far) { far = near[i]; at = i; }
    if (far <= 0) break;
    centers.push([...samples[at]] as RGB);
    for (let i = 0; i < samples.length; i++) near[i] = Math.min(near[i], d2(samples[i], centers[centers.length - 1]));
  }
  for (let it = 0; it < 10; it++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (const x of samples) {
      let best = 0;
      for (let c = 1; c < centers.length; c++) if (d2(x, centers[c]) < d2(x, centers[best])) best = c;
      sum[best][0] += x[0]; sum[best][1] += x[1]; sum[best][2] += x[2]; sum[best][3]++;
    }
    for (let c = 0; c < centers.length; c++) if (sum[c][3]) centers[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
  }
  return centers;
}

/**
 * Outlines of a mask's regions along pixel edges, inside always on the right: outer outlines run clockwise
 * (y down) and holes the other way, so the nonzero fill rule leaves the holes open.
 */
export function traceMask(mask: Uint8Array, w: number, h: number): Pt[][] {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  const W = w + 1;
  const next = new Map<number, number[]>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const a = y0 * W + x0;
    const list = next.get(a);
    if (list) list.push(y1 * W + x1); else next.set(a, [y1 * W + x1]);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inside(x, y)) continue;
    if (!inside(x, y - 1)) add(x, y, x + 1, y);
    if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!inside(x - 1, y)) add(x, y + 1, x, y);
  }
  const loops: Pt[][] = [];
  const pt = (v: number): Pt => ({ x: v % W, y: Math.floor(v / W) });
  for (const start of [...next.keys()]) {
    while (next.get(start)?.length) {
      const loop: Pt[] = [pt(start)];
      let cur = start, dx = 0, dy = 0;
      for (let guard = 0; guard < 4 * (w + 1) * (h + 1); guard++) {
        const outs = next.get(cur)!;
        // Where two regions touch at a corner, turn right: they stay separate outlines.
        let pick = 0;
        if (outs.length > 1) {
          const dirOf = (v: number) => { const a = pt(cur), b = pt(v); return [b.x - a.x, b.y - a.y]; };
          const right = outs.findIndex((v) => { const [ex, ey] = dirOf(v); return ex === -dy && ey === dx; });
          if (right >= 0) pick = right;
        }
        const to = outs.splice(pick, 1)[0];
        if (!outs.length) next.delete(cur);
        const a = pt(cur), b = pt(to);
        dx = b.x - a.x; dy = b.y - a.y;
        cur = to;
        if (cur === start) break;
        loop.push(b);
      }
      loops.push(dropStraight(loop));
    }
  }
  return loops;
}

/** Only the corners of an outline along pixel edges. */
function dropStraight(loop: Pt[]): Pt[] {
  const n = loop.length;
  return loop.filter((p, i) => {
    const a = loop[(i - 1 + n) % n], b = loop[(i + 1) % n];
    return (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x) !== 0;
  });
}

/** Signed area (positive clockwise with y down). */
export function loopArea(loop: Pt[]): number {
  let s = 0;
  for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length]; s += a.x * b.y - b.x * a.y; }
  return s / 2;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** A closed outline with fewer points: ones within `tolerance` of the line between kept neighbours go. */
export function simplifyLoop(loop: Pt[], tolerance: number): Pt[] {
  if (loop.length <= 4) return loop;
  // Split at the point farthest from the first, so both halves are simplified as open lines.
  let far = 0;
  for (let i = 1; i < loop.length; i++) if (Math.hypot(loop[i].x - loop[0].x, loop[i].y - loop[0].y) > Math.hypot(loop[far].x - loop[0].x, loop[far].y - loop[0].y)) far = i;
  const half = (pts: Pt[]) => {
    const keep = pts.map((_, i) => i === 0 || i === pts.length - 1);
    const stack: [number, number][] = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop()!;
      let worst = -1, d = tolerance;
      for (let i = a + 1; i < b; i++) { const e = distToSegment(pts[i], pts[a], pts[b]); if (e > d) { d = e; worst = i; } }
      if (worst >= 0) { keep[worst] = true; stack.push([a, worst], [worst, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  };
  const first = half(loop.slice(0, far + 1)), second = half([...loop.slice(far), loop[0]]);
  return [...first, ...second.slice(1, -1)];
}

/** A smooth closed curve through the points (Catmull-Rom), sharp where it turns more than 65°. */
export function smoothLoop(p: Pt[]): SubPath {
  const n = p.length;
  const at = (i: number) => p[(i + n) % n];
  const corner = p.map((q, i) => {
    const a = at(i - 1), b = at(i + 1);
    const turn = Math.abs(Math.atan2(b.y - q.y, b.x - q.x) - Math.atan2(q.y - a.y, q.x - a.x));
    return Math.min(turn, 2 * Math.PI - turn) > (65 * Math.PI) / 180;
  });
  const out: PathPoint[] = p.map((q) => ({ x: q.x, y: q.y }));
  if (n >= 3) for (let i = 0; i < n; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2), j = (i + 1) % n;
    if (!corner[i]) out[i].out = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    if (!corner[j]) out[j].in = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
  }
  return { points: out, closed: true };
}

const hex = (c: RGB) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/**
 * The picture as layers of flat color, in drawing order, in the coordinates of a `width` × `height` box:
 * `colors` colors (2–24), traced at most `maxSide` pixels across; regions smaller than `minArea` traced
 * pixels are left out as specks.
 */
export function traceImage(src: Pixels, width: number, height: number, opts: { colors?: number; maxSide?: number; minArea?: number } = {}): TracedLayer[] {
  const k = Math.max(2, Math.min(24, Math.round(opts.colors ?? 8)));
  const p = downscale(src, opts.maxSide ?? 360);
  const n = p.width * p.height;
  const rgb = (i: number): RGB => [p.rgba[i * 4], p.rgba[i * 4 + 1], p.rgba[i * 4 + 2]];
  const opaque = (i: number) => p.rgba[i * 4 + 3] >= 128;
  const samples: RGB[] = [];
  const step = Math.max(1, Math.floor(n / 20_000));
  for (let i = 0; i < n; i += step) if (opaque(i)) samples.push(rgb(i));
  if (!samples.length) return [];
  const centers = kmeans(samples, k);
  const labels = new Int16Array(n).fill(-1), counts = new Array(centers.length).fill(0);
  for (let i = 0; i < n; i++) {
    if (!opaque(i)) continue;
    const c = rgb(i);
    let best = 0;
    for (let j = 1; j < centers.length; j++) if (d2(c, centers[j]) < d2(c, centers[best])) best = j;
    labels[i] = best;
    counts[best]++;
  }
  const order = centers.map((_, i) => i).filter((i) => counts[i]).sort((a, b) => counts[b] - counts[a]);
  const rank = new Int16Array(centers.length);
  order.forEach((c, j) => { rank[c] = j; });
  const sx = width / p.width, sy = height / p.height;
  const minArea = opts.minArea ?? 4;
  const layers: TracedLayer[] = [];
  for (let j = 0; j < order.length; j++) {
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (labels[i] >= 0 && rank[labels[i]] >= j) mask[i] = 1;
    const subs = traceMask(mask, p.width, p.height)
      .filter((l) => Math.abs(loopArea(l)) >= minArea)
      .map((l) => smoothLoop(simplifyLoop(l, 0.75).map((q) => ({ x: q.x * sx, y: q.y * sy }))));
    if (subs.length) layers.push({ color: hex(centers[order[j]]), subs });
  }
  return layers;
}
