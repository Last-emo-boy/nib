import type { Node } from '@nib/format';
import { childrenOf, type PenDoc } from './doc.ts';
import { newId, type DocEditor } from './edit.ts';
import { bezier, pathNodeProps, type PathPoint, type Pt, type SubPath } from './paths.ts';

/**
 * Freehand sketches: strokes drawn with the pencil smoothed into curves, and read back as the shapes they
 * were meant to be (boxes, circles, lines, scribbled text), so a model that cannot see the sketch can still
 * build it.
 */

/** Sketch strokes and the frames that hold them carry this metadata type. */
export const SKETCH = 'nib-sketch';

type Box = { x: number; y: number; width: number; height: number };

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  if (!len) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The points that matter: ones within `tolerance` of the line between their neighbours go (Ramer–Douglas–Peucker). */
export function simplify(points: Pt[], tolerance: number): Pt[] {
  if (points.length <= 2) return points.slice();
  const keep = points.map((_, i) => i === 0 || i === points.length - 1);
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1, far = tolerance;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(points[i], points[a], points[b]);
      if (d > far) { far = d; worst = i; }
    }
    if (worst >= 0) { keep[worst] = true; stack.push([a, worst], [worst, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * A smooth curve through a stroke's points (Catmull-Rom as cubic curves), sharp where the stroke turns
 * sharply (a box's corners stay corners instead of bulging out); a tap becomes a dot.
 */
export function smoothStroke(points: Pt[], tolerance = 1.5): SubPath {
  const p = simplify(points, tolerance);
  if (p.length === 1) p.push({ x: p[0].x + 0.1, y: p[0].y });
  const corner = p.map((q, i) => {
    const a = p[i - 1], b = p[i + 1];
    if (!a || !b) return false;
    const turn = Math.abs(Math.atan2(b.y - q.y, b.x - q.x) - Math.atan2(q.y - a.y, q.x - a.x));
    // Rounder than this is a small curve simplified to a few points (a circle 12px across turns about 60°).
    return Math.min(turn, 2 * Math.PI - turn) > (65 * Math.PI) / 180;
  });
  const out: PathPoint[] = p.map((q) => ({ x: q.x, y: q.y }));
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] ?? p2;
    if (!corner[i]) out[i].out = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    if (!corner[i + 1]) out[i + 1].in = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
  }
  return { points: out, closed: false };
}

/** A subpath as points along it. */
export function flatten(sub: SubPath, steps = 8): Pt[] {
  const pts = sub.points;
  if (!pts.length) return [];
  const out: Pt[] = [{ x: pts[0].x, y: pts[0].y }];
  const n = sub.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if (!a.out && !b.in) { out.push({ x: b.x, y: b.y }); continue; }
    for (let s = 1; s <= steps; s++) out.push(bezier(a, a.out ?? a, b.in ?? b, b, s / steps));
  }
  return out;
}

function boundsOf(points: Pt[]): Box {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export type SketchShape = 'box' | 'ellipse' | 'line' | 'text' | 'mark';
export interface SketchItem { shape: SketchShape; box: Box; /** For lines: from where to where. */ ends?: [Pt, Pt] }

/** What one stroke was meant to be. */
export function classifyStroke(points: Pt[]): SketchItem {
  const box = boundsOf(points);
  const diag = Math.hypot(box.width, box.height);
  if (points.length < 2 || diag < 10) return { shape: 'mark', box };
  const first = points[0], last = points[points.length - 1];
  let length = 0;
  for (let i = 1; i < points.length; i++) length += dist(points[i - 1], points[i]);
  const chord = dist(first, last);
  // Straight: nothing strays far from the line between its ends, and it does not go back and forth.
  const off = Math.max(...points.map((p) => distToSegment(p, first, last)));
  if (chord > 0.5 * diag && length < 1.25 * chord && off <= Math.max(4, chord * 0.08)) return { shape: 'line', box, ends: [first, last] };
  // Closed: it ends near where it began, after going around.
  if (dist(first, last) < Math.max(14, 0.25 * diag) && length > 1.6 * diag) {
    // A box reaches into the corners of its bounds; an ellipse stays about 15% of the diagonal away.
    const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]];
    const reach = corners.reduce((s, [cx, cy]) => s + Math.min(...points.map((p) => Math.hypot(p.x - cx, p.y - cy))), 0) / 4 / diag;
    return { shape: reach < 0.09 ? 'box' : 'ellipse', box };
  }
  // A long low wave is handwriting standing in for a line of text.
  if (box.height < 0.6 * box.width && length > 1.3 * box.width) return { shape: 'text', box };
  return { shape: 'mark', box };
}

const containsBox = (o: Box, i: Box, e = 4) => i.x >= o.x - e && i.y >= o.y - e && i.x + i.width <= o.x + o.width + e && i.y + i.height <= o.y + o.height + e;

/** Two diagonal lines crossing over most of a box: the usual sign for a picture. */
function crossed(box: Box, lines: SketchItem[]): boolean {
  const diagonal = lines.filter((l) => l.shape === 'line' && l.box.width > 0.6 * box.width && l.box.height > 0.6 * box.height);
  const down = diagonal.some((l) => (l.ends![1].x - l.ends![0].x) * (l.ends![1].y - l.ends![0].y) > 0);
  const up = diagonal.some((l) => (l.ends![1].x - l.ends![0].x) * (l.ends![1].y - l.ends![0].y) < 0);
  return down && up;
}

/** The sketch as an indented outline: shapes inside boxes under them, top to bottom, left to right. */
export function sketchOutline(items: SketchItem[]): string {
  if (!items.length) return '';
  const all = boundsOf(items.flatMap((i) => [{ x: i.box.x, y: i.box.y }, { x: i.box.x + i.box.width, y: i.box.y + i.box.height }]));
  const area = (b: Box) => b.width * b.height;
  // Each item sits in the smallest box or ellipse around it.
  const holders = items.filter((i) => i.shape === 'box' || i.shape === 'ellipse');
  const parent = new Map<SketchItem, SketchItem | undefined>(items.map((i) => [i, holders.filter((h) => h !== i && area(h.box) > area(i.box) && containsBox(h.box, i.box)).sort((a, b) => area(a.box) - area(b.box))[0]]));
  const r = (v: number) => Math.round(v);
  const at = (b: Box) => `at (${r(b.x - all.x)}, ${r(b.y - all.y)})`;
  const lines: string[] = [`Sketch outline (${r(all.width)}×${r(all.height)}; positions from its top-left corner):`];
  const print = (holder: SketchItem | undefined, depth: number) => {
    const kids = items.filter((i) => parent.get(i) === holder).sort((a, b) => (Math.abs(a.box.y - b.box.y) > 8 ? a.box.y - b.box.y : a.box.x - b.box.x));
    const isCross = holder?.shape === 'box' && crossed(holder.box, kids);
    for (const k of kids) {
      if (isCross && k.shape === 'line') continue;
      const b = k.box, size = `${r(b.width)}×${r(b.height)}`;
      let text: string;
      if (k.shape === 'box') text = `box ${size}${crossed(b, items.filter((i) => parent.get(i) === k)) ? ', crossed out (a picture)' : ''}`;
      else if (k.shape === 'ellipse') text = `${Math.abs(b.width - b.height) < 0.2 * Math.max(b.width, b.height) ? 'circle' : 'ellipse'} ${size}`;
      else if (k.shape === 'line') text = b.height < 0.2 * b.width ? `horizontal line ${r(b.width)} long` : b.width < 0.2 * b.height ? `vertical line ${r(b.height)} long` : `diagonal line ${size}`;
      else if (k.shape === 'text') text = `scribbled text ${size}`;
      else text = `mark ${size}`;
      lines.push(`${'  '.repeat(depth)}- ${text} ${at(b)}`);
      if (k.shape === 'box' || k.shape === 'ellipse') print(k, depth + 1);
    }
  };
  print(undefined, 0);
  return lines.join('\n');
}

const isSketch = (n: Node | undefined) => (n as { metadata?: { type?: unknown } } | undefined)?.metadata?.type === SKETCH;
export const isSketchFrame = (n: Node | undefined) => n?.type === 'frame' && isSketch(n);
export const isSketchStroke = (n: Node | undefined) => n?.type === 'path' && isSketch(n);

/** Whether `n` is a sketch stroke or holds one. */
export function hasSketch(n: Node | undefined): boolean {
  return !!n && (isSketchStroke(n) || (childrenOf(n) ?? []).some(hasSketch));
}

export const SKETCH_INK = '#2B2B2B';
export const SKETCH_PAPER = '#FAFAF7';
const PAD = 24, JOIN = 80;

/** A stroke as a path node at `props` (its box in the space it goes into). */
export function strokeNode(id: string, props: NonNullable<ReturnType<typeof pathNodeProps>>, width: number): Node {
  return { type: 'path', id, name: 'Stroke', ...props, stroke: SKETCH_INK, strokeWidth: width, strokeAlignment: 'center', strokeLinecap: 'round', strokeLinejoin: 'round', metadata: { type: SKETCH } } as unknown as Node;
}

/**
 * Put a stroke drawn on the canvas (`sub` in document coordinates) into the sketch it was drawn next to, a
 * top-level sketch frame that grows to hold it, or into a new one. Returns the sketch frame's id.
 */
export function addStroke(ed: DocEditor, doc: PenDoc, sub: SubPath, width: number): string {
  const props = pathNodeProps([sub], 1);
  if (!props) throw new Error('nothing drawn');
  const r = Math.round;
  const want = { x: r(props.x - PAD), y: r(props.y - PAD), width: r(props.width + 2 * PAD), height: r(props.height + 2 * PAD) };
  const near = doc.data.children.find((n) => {
    if (!isSketchFrame(n) || n.enabled === false) return false;
    const f = n as unknown as { x?: number; y?: number; width?: unknown; height?: unknown };
    if (typeof f.width !== 'number' || typeof f.height !== 'number') return false;
    const x = f.x ?? 0, y = f.y ?? 0;
    return want.x < x + f.width + JOIN && want.x + want.width + JOIN > x && want.y < y + f.height + JOIN && want.y + want.height + JOIN > y;
  }) as (Node & { x?: number; y?: number; width: number; height: number }) | undefined;
  const taken = new Set<string>();
  const id = () => { const v = newId(doc, taken); taken.add(v); return v; };
  if (!near) {
    const frame = id();
    ed.insert(null, { type: 'frame', id: frame, name: 'Sketch', ...want, layout: 'none', fill: SKETCH_PAPER, cornerRadius: 8, metadata: { type: SKETCH },
      children: [strokeNode(id(), { ...props, x: props.x - want.x, y: props.y - want.y }, width)] } as unknown as Node);
    return frame;
  }
  const fx = near.x ?? 0, fy = near.y ?? 0;
  const x0 = Math.min(fx, want.x), y0 = Math.min(fy, want.y);
  const x1 = Math.max(fx + near.width, want.x + want.width), y1 = Math.max(fy + near.height, want.y + want.height);
  // Growing left or up moves what is already in it, so it stays where it was drawn.
  const dx = fx - x0, dy = fy - y0;
  if (dx || dy) for (const c of childrenOf(near) ?? []) ed.set(c.id, { x: ((c as { x?: number }).x ?? 0) + dx, y: ((c as { y?: number }).y ?? 0) + dy });
  if (dx || dy || x1 - x0 !== near.width || y1 - y0 !== near.height) ed.set(near.id, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  ed.insert(near, strokeNode(id(), { ...props, x: Number((props.x - x0).toFixed(1)), y: Number((props.y - y0).toFixed(1)) }, width));
  return near.id;
}
