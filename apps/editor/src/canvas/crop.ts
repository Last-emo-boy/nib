/**
 * Image crops in the node's own box: where an image fill draws its whole image (as the renderer does: the
 * mode fits the crop region into the box, the transform picks the crop region), and the fill for a placement.
 */

type Fill = Record<string, any>;
export type R = { x: number; y: number; width: number; height: number };

const list = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Where the whole image (iw × ih pixels) sits relative to the node's box (w × h). */
export function imageRect(f: Fill, iw: number, ih: number, w: number, h: number): R {
  const t: number[] = Array.isArray(f.transform) && f.transform.length === 6 ? f.transform : [1, 0, 0, 1, 0, 0];
  const [a, , , d, e, fy] = t;
  const cw = iw / Math.abs(a || 1), ch = ih / Math.abs(d || 1);
  const mode = f.mode ?? 'cover';
  let sx: number, sy: number;
  if (mode === 'stretch') { sx = w / cw; sy = h / ch; } else {
    const s = mode === 'contain' || mode === 'fit' ? Math.min(w / cw, h / ch) : Math.max(w / cw, h / ch);
    sx = sy = s;
  }
  const W = cw * sx, H = ch * sy, ox = (w - W) / 2, oy = (h - H) / 2;
  return { x: ox + e * W, y: oy + fy * H, width: a * W, height: d * H };
}

/** The fill showing the image at `r` (relative to the box): stretched over a transform that places it. */
export function cropFill(f: Fill, r: R, w: number, h: number): Fill {
  const k = (v: number) => Math.round(v * 100000) / 100000;
  return { ...f, mode: 'stretch', transform: [k(r.width / w), 0, 0, k(r.height / h), k(r.x / w), k(r.y / h)] };
}

/** `r` kept covering the box (w × h): at least as large, never leaving a gap at an edge. */
export function coverBox(r: R, w: number, h: number): R {
  const k = Math.max(1, w / r.width, h / r.height);
  const width = r.width * k, height = r.height * k;
  return { width, height, x: Math.min(0, Math.max(w - width, r.x)), y: Math.min(0, Math.max(h - height, r.y)) };
}

/** The first image fill of a node, as an index into its fills. */
export function imageFillIndex(node: unknown): number {
  return list((node as { fill?: unknown } | undefined)?.fill).findIndex((f) => !!f && typeof f === 'object' && (f as Fill).type === 'image');
}
