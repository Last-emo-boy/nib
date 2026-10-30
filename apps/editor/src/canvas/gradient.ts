/**
 * Gradient geometry as handles in the node's unit box (0..1 on both axes, as the renderer draws them):
 * a linear gradient runs from `start` to `end`; radial and angular ones have a centre and two axis ends.
 * Moving a handle gives the fill's new center, size and rotation.
 */

export interface U { x: number; y: number }
type Fill = Record<string, any>;

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => Math.round(((((r * 180) / Math.PI) % 360) + 360) % 360 * 10) / 10;
const center = (f: Fill): U => ({ x: f.center?.x ?? 0.5, y: f.center?.y ?? 0.5 });
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** Where a linear gradient starts and ends (offset 0 and 1). */
export function linearEnds(f: Fill): { start: U; end: U } {
  const c = center(f), t = rad(f.rotation ?? 0), L = f.size?.height ?? 1;
  const d = { x: (Math.sin(t) * L) / 2, y: (Math.cos(t) * L) / 2 };
  return { start: { x: c.x + d.x, y: c.y + d.y }, end: { x: c.x - d.x, y: c.y - d.y } };
}

/** A linear gradient's props for new ends. */
export function fromEnds(start: U, end: U): Pick<Fill, 'center' | 'rotation' | 'size'> {
  const dx = end.x - start.x, dy = end.y - start.y;
  return { center: { x: r4((start.x + end.x) / 2), y: r4((start.y + end.y) / 2) }, rotation: deg(Math.atan2(-dx, -dy)), size: { height: r4(Math.hypot(dx, dy) || 0.0001) } };
}

/** A radial or angular gradient's centre and the ends of its two axes (width and height of its ellipse). */
export function ellipseHandles(f: Fill): { center: U; a: U; b: U } {
  const c = center(f), t = rad(f.rotation ?? 0);
  const sw = f.size?.width ?? 1, sh = f.size?.height ?? 1;
  return {
    center: c,
    a: { x: c.x + (sw / 2) * Math.cos(t), y: c.y - (sw / 2) * Math.sin(t) },
    b: { x: c.x + (sh / 2) * Math.sin(t), y: c.y + (sh / 2) * Math.cos(t) },
  };
}

/** New props when the first axis end moves to `a` (turning the ellipse), or the second to `b` (its height). */
export function fromAxis(f: Fill, which: 'a' | 'b', p: U): Pick<Fill, 'rotation' | 'size'> {
  const c = center(f);
  const v = { x: p.x - c.x, y: p.y - c.y };
  const size = { width: f.size?.width ?? 1, height: f.size?.height ?? 1 };
  if (which === 'a') return { rotation: deg(Math.atan2(-v.y, v.x)), size: { ...size, width: r4(2 * Math.hypot(v.x, v.y)) } };
  return { rotation: deg(Math.atan2(v.x, v.y)), size: { ...size, height: r4(2 * Math.hypot(v.x, v.y)) } };
}

/** The offset (0..1) along a line from `a` to `b` nearest to `p`. */
export function offsetOn(a: U, b: U, p: U): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  return len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
}

/** A mesh fill's points as positions, the grid filled in where they are missing. */
export function meshPoints(f: Fill): U[] {
  const columns = Math.max(2, Math.round(f.columns ?? 2)), rows = Math.max(2, Math.round(f.rows ?? 2));
  const out: U[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    const p = f.points?.[r * columns + c];
    const at = Array.isArray(p) ? p : p?.position;
    out.push(Array.isArray(at) ? { x: at[0], y: at[1] } : { x: c / (columns - 1), y: r / (rows - 1) });
  }
  return out;
}

/** A mesh fill with point `i` moved to `p` (its control points move with it). */
export function moveMeshPoint(f: Fill, i: number, p: U): Fill {
  const columns = Math.max(2, Math.round(f.columns ?? 2)), rows = Math.max(2, Math.round(f.rows ?? 2));
  const now = meshPoints(f);
  const points = now.map((q, j) => {
    const raw = f.points?.[j];
    if (j !== i) return raw ?? [r4(q.x), r4(q.y)];
    const dx = p.x - q.x, dy = p.y - q.y;
    if (raw && !Array.isArray(raw)) {
      const shift = (h?: number[]) => (h ? [r4(h[0] + dx), r4(h[1] + dy)] : undefined);
      return Object.fromEntries(Object.entries({ position: [r4(p.x), r4(p.y)], leftHandle: shift(raw.leftHandle), rightHandle: shift(raw.rightHandle), topHandle: shift(raw.topHandle), bottomHandle: shift(raw.bottomHandle) }).filter(([, v]) => v));
    }
    return [r4(p.x), r4(p.y)];
  });
  return { ...f, columns, rows, points };
}

/** A mesh with a new number of columns and rows: points back on a grid, colors kept where they were. */
export function resizeMesh(f: Fill, columns: number, rows: number): Fill {
  const oc = Math.max(2, Math.round(f.columns ?? 2)), or = Math.max(2, Math.round(f.rows ?? 2));
  const colors: string[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    // The nearest old point's color.
    const oc2 = Math.round((c / (columns - 1)) * (oc - 1)), or2 = Math.round((r / (rows - 1)) * (or - 1));
    colors.push(f.colors?.[or2 * oc + oc2] ?? f.colors?.[0] ?? '#D9D9D9');
  }
  const { points: _, ...rest } = f;
  return { ...rest, columns, rows, colors };
}
