import type { CanvasKit, Path } from 'canvaskit-wasm';
import type { SceneNode } from '@nib/core';

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Corner radii [top-left, top-right, bottom-right, bottom-left]. */
export type Radii = [number, number, number, number];

export function cornerRadii(node: SceneNode): Radii {
  const r = node.cornerRadius;
  if (Array.isArray(r) && r.length === 4) return r.map((x) => Math.max(0, num(x))) as Radii;
  const v = Math.max(0, num(r));
  return [v, v, v, v];
}

export const isRectLike = (node: SceneNode) => node.type === 'frame' || node.type === 'rectangle' || node.type === 'browser';

/** Per-corner elliptical radii [[rx, ry] x4] for a rect, scaled down like CSS when they overlap. */
export function rrectPath(ck: CanvasKit, l: number, t: number, r: number, b: number, radii: [number, number][]): Path {
  const w = Math.max(0, r - l), h = Math.max(0, b - t);
  const [tl, tr, br, bl] = radii.map(([x, y]) => [Math.max(0, x), Math.max(0, y)]);
  const f = Math.min(1,
    w / Math.max(1e-9, tl[0] + tr[0]), w / Math.max(1e-9, bl[0] + br[0]),
    h / Math.max(1e-9, tl[1] + bl[1]), h / Math.max(1e-9, tr[1] + br[1]));
  const rr = Float32Array.of(l, t, r, b, tl[0] * f, tl[1] * f, tr[0] * f, tr[1] * f, br[0] * f, br[1] * f, bl[0] * f, bl[1] * f);
  return new ck.PathBuilder().addRRect(rr).detachAndDelete();
}

/** The node's outline in its local space, or undefined for nodes without one (text, icons, groups). */
export function shapePath(ck: CanvasKit, node: SceneNode, w: number, h: number): Path | undefined {
  switch (node.type) {
    case 'frame': case 'rectangle': case 'browser': case 'note': case 'prompt': case 'context': case 'script':
      return rrectPath(ck, 0, 0, w, h, cornerRadii(node).map((x) => [x, x] as [number, number]));
    case 'ellipse': return ellipsePath(ck, node, w, h);
    case 'polygon': return polygonPath(ck, node, w, h);
    case 'path': return svgPath(ck, node, w, h);
    default: return undefined;
  }
}

/** Ellipse with optional arc (`startAngle`, `sweepAngle`, degrees counter-clockwise from 3 o'clock) and ring (`innerRadius`). */
function ellipsePath(ck: CanvasKit, node: SceneNode, w: number, h: number): Path {
  const inner = Math.min(1, Math.max(0, num(node.innerRadius)));
  const sweep = Math.max(-360, Math.min(360, num(node.sweepAngle, 360)));
  const start = num(node.startAngle);
  const oval = ck.LTRBRect(0, 0, w, h);
  const innerOval = ck.LTRBRect(w / 2 * (1 - inner), h / 2 * (1 - inner), w / 2 * (1 + inner), h / 2 * (1 + inner));
  const pb = new ck.PathBuilder();
  if (Math.abs(sweep) >= 360) {
    pb.addOval(oval);
    if (inner > 0) pb.addOval(innerOval, true);
  } else {
    // Skia measures angles clockwise in y-down space.
    pb.arcToOval(oval, -start, -sweep, true);
    if (inner > 0) pb.arcToOval(innerOval, -(start + sweep), sweep, false);
    else pb.lineTo(w / 2, h / 2);
    pb.close();
  }
  return pb.detachAndDelete();
}

/** Regular polygon inscribed in the box, first vertex at the top. Corners are rounded at paint time. */
function polygonPath(ck: CanvasKit, node: SceneNode, w: number, h: number): Path {
  const n = Math.max(3, Math.round(num(node.polygonCount, 3)));
  const pb = new ck.PathBuilder();
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const x = w / 2 + (w / 2) * Math.cos(a), y = h / 2 + (h / 2) * Math.sin(a);
    if (i === 0) pb.moveTo(x, y); else pb.lineTo(x, y);
  }
  pb.close();
  return pb.detachAndDelete();
}

/** SVG path data mapped from its `viewBox` (default: the geometry's tight bounds) onto the node box. */
function svgPath(ck: CanvasKit, node: SceneNode, w: number, h: number): Path | undefined {
  if (typeof node.geometry !== 'string') return undefined;
  const raw = ck.Path.MakeFromSVGString(node.geometry);
  if (!raw) return undefined;
  let [vx, vy, vw, vh] = Array.isArray(node.viewBox) && node.viewBox.length === 4 ? node.viewBox.map((v: unknown) => num(v)) : [0, 0, 0, 0];
  if (!(Array.isArray(node.viewBox) && node.viewBox.length === 4)) {
    const b = raw.computeTightBounds();
    [vx, vy, vw, vh] = [b[0], b[1], b[2] - b[0], b[3] - b[1]];
  }
  const sx = vw > 0 ? w / vw : 1, sy = vh > 0 ? h / vh : 1;
  const out = new ck.PathBuilder(raw).transform([sx, 0, -vx * sx, 0, sy, -vy * sy, 0, 0, 1]).detachAndDelete();
  raw.delete();
  out.setFillType(node.fillRule === 'evenodd' ? ck.FillType.EvenOdd : ck.FillType.Winding);
  return out;
}
