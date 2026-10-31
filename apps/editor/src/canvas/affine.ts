import type { Box } from '@nib/layout';

/**
 * 2D affine transforms as [a, b, c, d, e, f]: a point (x, y) maps to (a·x + c·y + e, b·x + d·y + f), the order
 * SVG's matrix() uses. Nodes are placed the way the renderer draws them: moved to their x/y, turned by their
 * rotation (degrees counter-clockwise around the top-left corner), and their contents mirrored by flipX/flipY.
 */
export type M = [number, number, number, number, number, number];
export interface P { x: number; y: number }

export const IDENTITY: M = [1, 0, 0, 1, 0, 0];

/** m after n: points go through n first. */
export function mul(m: M, n: M): M {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export const apply = (m: M, x: number, y: number): P => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

/** Only the turning and scaling part: for offsets rather than points. */
export const applyLinear = (m: M, x: number, y: number): P => ({ x: m[0] * x + m[2] * y, y: m[1] * x + m[3] * y });

export function invert(m: M): M {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/** Moving to (x, y), then turning `deg` degrees counter-clockwise on screen (y points down). */
export function placement(x: number, y: number, deg: number): M {
  if (!deg) return [1, 0, 0, 1, x, y];
  const r = (deg * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  return [cos, -sin, sin, cos, x, y];
}

/** Mirroring a w × h box in place. */
export const flip = (w: number, h: number, x: boolean, y: boolean): M => [x ? -1 : 1, 0, 0, y ? -1 : 1, x ? w : 0, y ? h : 0];

/** The corners of a w × h box under m: top-left, top-right, bottom-right, bottom-left. */
export const quad = (m: M, w: number, h: number): P[] => [apply(m, 0, 0), apply(m, w, 0), apply(m, w, h), apply(m, 0, h)];

export function boundsOf(points: P[]): Box {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Whether m only moves (and scales positively): boxes stay boxes. */
export const isAxisAligned = (m: M) => Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && m[0] > 0 && m[3] > 0;

/** The turn m makes, in degrees counter-clockwise on screen. */
export const angleOf = (m: M) => (Math.atan2(-m[1], m[0]) * 180) / Math.PI;

/** An SVG transform attribute for m in document space shown at `view`. */
export const svgMatrix = (m: M, v: { zoom: number; tx: number; ty: number }) =>
  `matrix(${m[0] * v.zoom} ${m[1] * v.zoom} ${m[2] * v.zoom} ${m[3] * v.zoom} ${m[4] * v.zoom + v.tx} ${m[5] * v.zoom + v.ty})`;
