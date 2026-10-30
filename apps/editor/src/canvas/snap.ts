import type { Box } from '@nib/layout';

/**
 * Smart guides: boxes being moved, resized or drawn snap their edges and centres to those of nearby
 * layers (siblings and the parent), and the lines they line up on are shown. Distances (Alt) between the
 * selection and another layer are measured here too. All in canvas coordinates.
 */

/** A line the moving box lines up on: vertical (axis x, at x) or horizontal, spanning from..to on the other axis. */
export interface Guide { axis: 'x' | 'y'; at: number; from: number; to: number }

/** Which lines of the moving box take part: all three, or only the edges a resize handle moves. */
export interface Lines { x: ('start' | 'center' | 'end')[]; y: ('start' | 'center' | 'end')[] }

const ALL: Lines = { x: ['start', 'center', 'end'], y: ['start', 'center', 'end'] };

const lines = (b: Box, axis: 'x' | 'y') => (axis === 'x' ? { start: b.x, center: b.x + b.width / 2, end: b.x + b.width } : { start: b.y, center: b.y + b.height / 2, end: b.y + b.height });

/**
 * How far to shift `box` (dx, dy) so that its lines meet the nearest lines of `others` within `threshold`, and the
 * guides it then lines up on.
 */
export function snap(box: Box, others: Box[], threshold: number, which: Lines = ALL): { dx: number; dy: number; guides: Guide[] } {
  const offset = (axis: 'x' | 'y') => {
    let best = Infinity;
    const mine = lines(box, axis);
    for (const o of others) {
      const theirs = lines(o, axis);
      for (const k of which[axis]) for (const v of Object.values(theirs)) {
        const d = v - mine[k];
        if (Math.abs(d) <= threshold && Math.abs(d) < Math.abs(best)) best = d;
      }
    }
    return best === Infinity ? 0 : best;
  };
  const dx = which.x.length ? offset('x') : 0, dy = which.y.length ? offset('y') : 0;
  const moved = { ...box, x: box.x + dx, y: box.y + dy };
  return { dx, dy, guides: guidesFor(moved, others, which) };
}

/** The lines `box` shares with `others` (within half a pixel), each drawn across both boxes. */
export function guidesFor(box: Box, others: Box[], which: Lines = ALL): Guide[] {
  const out: Guide[] = [];
  for (const axis of ['x', 'y'] as const) {
    const mine = lines(box, axis);
    const other = axis === 'x' ? 'y' : 'x';
    for (const o of others) {
      const theirs = lines(o, axis);
      for (const k of which[axis]) for (const v of Object.values(theirs)) {
        if (Math.abs(v - mine[k]) > 0.5) continue;
        const a = lines(box, other), b = lines(o, other);
        const g = { axis, at: mine[k], from: Math.min(a.start, b.start), to: Math.max(a.end, b.end) };
        if (!out.some((x) => x.axis === g.axis && Math.abs(x.at - g.at) < 0.5 && x.from === g.from && x.to === g.to)) out.push(g);
      }
    }
  }
  return out;
}

/** A point (a corner being drawn) snapped to the lines of `others`. */
export function snapPoint(p: { x: number; y: number }, others: Box[], threshold: number): { x: number; y: number; guides: Guide[] } {
  const r = snap({ x: p.x, y: p.y, width: 0, height: 0 }, others, threshold, { x: ['start'], y: ['start'] });
  return { x: p.x + r.dx, y: p.y + r.dy, guides: r.guides };
}

/** A distance to show: a line from (x1, y1) to (x2, y2) labelled with its length. */
export interface Measure { x1: number; y1: number; x2: number; y2: number; value: number }

/**
 * Distances from box `a` (the selection) to `b`: the gaps between them on each axis, or, when one holds the
 * other, from the inner box to each side of the outer one.
 */
export function measure(a: Box, b: Box): Measure[] {
  const contains = (o: Box, i: Box) => i.x >= o.x && i.y >= o.y && i.x + i.width <= o.x + o.width && i.y + i.height <= o.y + o.height;
  const out: Measure[] = [];
  const inner = contains(b, a) ? a : contains(a, b) ? b : undefined;
  if (inner) {
    const outer = inner === a ? b : a;
    const cy = inner.y + inner.height / 2, cx = inner.x + inner.width / 2;
    const add = (m: Measure) => { if (m.value > 0) out.push(m); };
    add({ x1: outer.x, y1: cy, x2: inner.x, y2: cy, value: inner.x - outer.x });
    add({ x1: inner.x + inner.width, y1: cy, x2: outer.x + outer.width, y2: cy, value: outer.x + outer.width - inner.x - inner.width });
    add({ x1: cx, y1: outer.y, x2: cx, y2: inner.y, value: inner.y - outer.y });
    add({ x1: cx, y1: inner.y + inner.height, x2: cx, y2: outer.y + outer.height, value: outer.y + outer.height - inner.y - inner.height });
    return out;
  }
  // Side by side: the gap, drawn where the boxes overlap on the other axis (or from the selection's middle).
  const overlapY = [Math.max(a.y, b.y), Math.min(a.y + a.height, b.y + b.height)];
  const overlapX = [Math.max(a.x, b.x), Math.min(a.x + a.width, b.x + b.width)];
  const y = overlapY[0] < overlapY[1] ? (overlapY[0] + overlapY[1]) / 2 : a.y + a.height / 2;
  const x = overlapX[0] < overlapX[1] ? (overlapX[0] + overlapX[1]) / 2 : a.x + a.width / 2;
  if (b.x >= a.x + a.width) out.push({ x1: a.x + a.width, y1: y, x2: b.x, y2: y, value: b.x - a.x - a.width });
  else if (a.x >= b.x + b.width) out.push({ x1: b.x + b.width, y1: y, x2: a.x, y2: y, value: a.x - b.x - b.width });
  if (b.y >= a.y + a.height) out.push({ x1: x, y1: a.y + a.height, x2: x, y2: b.y, value: b.y - a.y - a.height });
  else if (a.y >= b.y + b.height) out.push({ x1: x, y1: b.y + b.height, x2: x, y2: a.y, value: a.y - b.y - b.height });
  return out;
}
