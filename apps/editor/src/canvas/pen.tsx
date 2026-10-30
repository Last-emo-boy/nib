import { bezier, formatPath, pathInBox, pathNodeProps, transformPaths, type PathPoint, type Pt, type SubPath } from '@nib/core';
import { commit, insertNode, isFree } from '../app/actions.ts';
import { store, toast, useEditor } from '../app/store.ts';
import { canvas, toDoc } from './Canvas.tsx';

/**
 * The pen tool and point editing. Drawing: a click adds a corner point, a click-drag a smooth one with
 * handles, a click on the first point closes the path; Enter or Escape finishes an open one. Editing (double-click
 * a path, or Enter): drag points and handles, click a segment to add a point, Alt-click a point to make it a
 * corner or smooth, Backspace deletes points. Points are kept in canvas coordinates while working.
 */
export interface PenSession {
  mode: 'draw' | 'edit';
  /** The path being edited. */
  id?: string;
  /** The frame a drawn path goes into. */
  parent: string | null;
  subs: SubPath[];
  /** Selected points, as "subpath:index". */
  selected: string[];
  /** The pointer while drawing, for the segment it would add. */
  hover?: Pt;
}

/** Screen distance within which a click lands on a point. */
const NEAR = 7;

const session = () => store.get().pen;
const update = (pen: PenSession | undefined) => store.set({ pen });
const clone = (subs: SubPath[]): SubPath[] => subs.map((s) => ({ closed: s.closed, points: s.points.map((p) => ({ ...p, ...(p.in ? { in: { ...p.in } } : {}), ...(p.out ? { out: { ...p.out } } : {}) })) }));
const screenDistance = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) * store.get().view.zoom;

/** Follow the pointer until it is released; `move` gets canvas points. */
function track(move: (p: Pt, e: PointerEvent) => void, up: (moved: boolean) => void): void {
  let moved = false;
  const host = document.querySelector('.canvas')!.getBoundingClientRect();
  const onMove = (e: PointerEvent) => {
    moved = true;
    move(toDoc(store.get().view, e.clientX - host.left, e.clientY - host.top), e);
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    up(moved);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

/** Shift: keep the new point at a multiple of 45° from the previous one. */
function constrain(from: Pt | undefined, p: Pt, shift: boolean): Pt {
  if (!from || !shift) return p;
  const a = Math.round(Math.atan2(p.y - from.y, p.x - from.x) / (Math.PI / 4)) * (Math.PI / 4);
  const d = Math.hypot(p.x - from.x, p.y - from.y);
  return { x: from.x + Math.cos(a) * d, y: from.y + Math.sin(a) * d };
}

// Drawing ---------------------------------------------------------------------------------------

/** A press with the pen tool at canvas point `p`; `parent` is the frame under the first point. */
export function penDown(p: Pt, e: { shiftKey: boolean }, parent: string | null): void {
  let s = session();
  if (s?.mode === 'edit') { finishEditing(); s = undefined; }
  if (!s) s = { mode: 'draw', parent, subs: [{ points: [], closed: false }], selected: [] };
  const subs = clone(s.subs);
  const sub = subs[subs.length - 1];
  const first = sub.points[0], last = sub.points[sub.points.length - 1];
  const closing = sub.points.length >= 2 && screenDistance(first, p) <= NEAR;
  let point: PathPoint;
  if (closing) {
    sub.closed = true;
    point = sub.points[0];
  } else {
    point = { ...constrain(last, p, e.shiftKey) };
    sub.points.push(point);
  }
  update({ ...s, subs, hover: undefined });
  // Dragging pulls out the point's handles: the one ahead follows the pointer, the one behind mirrors it.
  track((q) => {
    const cur = session();
    if (!cur) return;
    const next = clone(cur.subs);
    const target = closing ? next[next.length - 1].points[0] : next[next.length - 1].points[next[next.length - 1].points.length - 1];
    if (screenDistance(target, q) < 2) { delete target.in; delete target.out; } else {
      target.out = { x: q.x, y: q.y };
      target.in = { x: 2 * target.x - q.x, y: 2 * target.y - q.y };
    }
    update({ ...cur, subs: next });
  }, () => { if (closing) void finishDrawing(); });
}

/** The pointer moving while drawing (no button). */
export function penHover(p: Pt, shift: boolean): void {
  const s = session();
  if (s?.mode !== 'draw') return;
  const sub = s.subs[s.subs.length - 1];
  update({ ...s, hover: constrain(sub.points[sub.points.length - 1], p, shift) });
}

/** Put the drawn path in the document (two points or more), and stop drawing. */
export async function finishDrawing(): Promise<void> {
  const s = session();
  if (s?.mode !== 'draw') return;
  update(undefined);
  const subs = s.subs.filter((x) => x.points.length >= 2);
  if (!subs.length) return;
  const { doc } = store.get();
  const parent = s.parent && doc?.has(s.parent) ? s.parent : null;
  const origin = parent ? canvas.cache?.box(parent) : undefined;
  const props = pathNodeProps(transformPaths(subs, [1, 0, 0, 1, -(origin?.x ?? 0), -(origin?.y ?? 0)]));
  if (!props) return;
  const flow = parent ? (doc!.get(parent) as { layout?: string }).layout !== 'none' : false;
  const closed = subs.some((x) => x.closed);
  await insertNode(parent, {
    type: 'path', name: 'Path', ...props, ...(flow ? { layoutPosition: 'absolute' } : {}),
    ...(closed ? { fill: '#D9D9D9' } : {}), stroke: '#111111', strokeWidth: 2, strokeAlignment: 'center',
  }, 'Draw path');
}

// Editing ---------------------------------------------------------------------------------------

/** Start editing the points of path `id`. */
export function editPath(id: string): boolean {
  const { doc } = store.get();
  const node = doc?.get(id) as { type?: string; geometry?: unknown; rotation?: unknown; viewBox?: number[] } | undefined;
  const box = canvas.cache?.box(id);
  if (node?.type !== 'path' || typeof node.geometry !== 'string' || !box) return false;
  if (typeof node.rotation === 'number' && node.rotation % 360 !== 0) { toast('Rotated paths cannot be edited point by point yet: set rotation to 0 first.'); return false; }
  let subs: SubPath[];
  try {
    subs = transformPaths(pathInBox(node.geometry, box.width, box.height, node.viewBox), [1, 0, 0, 1, box.x, box.y]);
  } catch (e) {
    toast((e as Error).message);
    return false;
  }
  store.set({ pen: { mode: 'edit', id, parent: doc!.locate(id)?.parent?.id ?? null, subs, selected: [] }, selection: [id], tool: 'move' });
  return true;
}

export function finishEditing(): void {
  if (session()?.mode === 'edit') update(undefined);
}

/** Write the edited points to the path node: its box becomes their bounds. */
async function save(subs: SubPath[], label: string): Promise<void> {
  const s = session();
  const { doc } = store.get();
  if (!s?.id || !doc?.has(s.id)) return;
  const id = s.id;
  const kept = subs.filter((x) => x.points.length >= 2);
  if (!kept.length) {
    update(undefined);
    await commit(label, (ed) => ed.remove(id));
    return;
  }
  const parent = doc.locate(id)?.parent;
  const origin = parent ? canvas.cache?.box(parent.id) : undefined;
  const props = pathNodeProps(transformPaths(kept, [1, 0, 0, 1, -(origin?.x ?? 0), -(origin?.y ?? 0)]));
  if (!props) return;
  const { x, y, ...shape } = props;
  update({ ...s, subs: kept, selected: s.selected.filter((k) => { const [si, pi] = k.split(':').map(Number); return kept[si]?.points[pi]; }) });
  await commit(label, (ed) => ed.set(id, isFree(doc, id) ? { x, y, ...shape } : shape));
}

const keyOf = (si: number, pi: number) => `${si}:${pi}`;

/** A press on point `si:pi` while editing: select it and drag the selected points. Alt toggles corner/smooth. */
export function pointDown(si: number, pi: number, e: { shiftKey: boolean; altKey: boolean }): void {
  const s = session();
  if (s?.mode !== 'edit') return;
  const key = keyOf(si, pi);
  if (e.altKey) {
    const subs = clone(s.subs);
    toggleSmooth(subs[si], pi);
    void save(subs, 'Change point');
    return;
  }
  const selected = e.shiftKey ? (s.selected.includes(key) ? s.selected.filter((k) => k !== key) : [...s.selected, key]) : s.selected.includes(key) ? s.selected : [key];
  update({ ...s, selected });
  const start = s.subs[si].points[pi];
  const base = clone(s.subs);
  track((q) => {
    const cur = session();
    if (!cur) return;
    const dx = q.x - start.x, dy = q.y - start.y;
    const subs = clone(base);
    for (const k of selected) {
      const [a, b] = k.split(':').map(Number);
      const p = subs[a]?.points[b];
      if (!p) continue;
      const shift = (v: Pt) => ({ x: v.x + dx, y: v.y + dy });
      Object.assign(p, shift(p));
      if (p.in) p.in = shift(p.in);
      if (p.out) p.out = shift(p.out);
    }
    update({ ...cur, subs });
  }, (moved) => { if (moved) void save(session()!.subs, 'Move points'); });
}

/** A press on a handle: drag it; the other handle of a smooth point turns with it (Alt: only this one). */
export function handleDown(si: number, pi: number, which: 'in' | 'out', e: { altKey: boolean }): void {
  const s = session();
  if (!s) return;
  const base = clone(s.subs);
  const p = base[si].points[pi];
  const other = which === 'in' ? p.out : p.in;
  const own = p[which]!;
  // Smooth: both handles on one line through the point.
  const smooth = !!other && Math.abs((own.x - p.x) * (other.y - p.y) - (own.y - p.y) * (other.x - p.x)) < 1e-3 * Math.max(1, Math.hypot(own.x - p.x, own.y - p.y) * Math.hypot(other.x - p.x, other.y - p.y));
  const otherLength = other ? Math.hypot(other.x - p.x, other.y - p.y) : 0;
  track((q, ev) => {
    const cur = session();
    if (!cur) return;
    const subs = clone(base);
    const pt = subs[si].points[pi];
    pt[which] = { x: q.x, y: q.y };
    if (smooth && !ev.altKey && !e.altKey) {
      const d = Math.hypot(q.x - pt.x, q.y - pt.y) || 1;
      pt[which === 'in' ? 'out' : 'in'] = { x: pt.x - ((q.x - pt.x) / d) * otherLength, y: pt.y - ((q.y - pt.y) / d) * otherLength };
    }
    update({ ...cur, subs });
  }, (moved) => { if (moved && session()?.mode === 'edit') void save(session()!.subs, 'Move handle'); });
}

/** A click on segment `seg` of subpath `si` (from point seg to the next): a new point there. */
export function segmentDown(si: number, seg: number, p: Pt): void {
  const s = session();
  if (s?.mode !== 'edit') return;
  const subs = clone(s.subs);
  const sub = subs[si];
  const a = sub.points[seg], b = sub.points[(seg + 1) % sub.points.length];
  const c1 = a.out ?? a, c2 = b.in ?? b;
  // The nearest point of the segment, to a hundredth of its length.
  let best = 0, dist = Infinity;
  for (let i = 0; i <= 100; i++) {
    const q = bezier(a, c1, c2, b, i / 100);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < dist) { dist = d; best = i / 100; }
  }
  const curved = !!(a.out || b.in);
  const [left, right] = split(a, c1, c2, b, best);
  const point: PathPoint = { ...left[3] };
  if (curved) {
    a.out = left[1];
    point.in = left[2];
    point.out = right[1];
    b.in = right[2];
  }
  sub.points.splice(seg + 1, 0, point);
  update({ ...s, subs, selected: [keyOf(si, seg + 1)] });
  void save(subs, 'Add point');
}

/** de Casteljau: a cubic split at t into two. */
function split(a: Pt, c1: Pt, c2: Pt, b: Pt, t: number): [Pt[], Pt[]] {
  const lerp = (p: Pt, q: Pt) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  const ab = lerp(a, c1), bc = lerp(c1, c2), cd = lerp(c2, b);
  const abc = lerp(ab, bc), bcd = lerp(bc, cd), m = lerp(abc, bcd);
  return [[a, ab, abc, m], [m, bcd, cd, b]];
}

/** A corner point gets handles along its neighbours' direction; a smooth one loses them. */
function toggleSmooth(sub: SubPath, i: number): void {
  const p = sub.points[i];
  if (p.in || p.out) { delete p.in; delete p.out; return; }
  const n = sub.points.length;
  const prev = sub.points[i > 0 ? i - 1 : sub.closed ? n - 1 : i];
  const next = sub.points[i < n - 1 ? i + 1 : sub.closed ? 0 : i];
  const dx = next.x - prev.x, dy = next.y - prev.y;
  const d = Math.hypot(dx, dy) || 1;
  const len = Math.min(Math.hypot(p.x - prev.x, p.y - prev.y), Math.hypot(next.x - p.x, next.y - p.y)) / 3 || 20;
  p.in = { x: p.x - (dx / d) * len, y: p.y - (dy / d) * len };
  p.out = { x: p.x + (dx / d) * len, y: p.y + (dy / d) * len };
}

/** Backspace: remove the selected points (editing), or the last point (drawing). */
export function deletePoints(): void {
  const s = session();
  if (!s) return;
  if (s.mode === 'draw') {
    const subs = clone(s.subs);
    subs[subs.length - 1].points.pop();
    if (!subs[subs.length - 1].points.length) { update(undefined); return; }
    update({ ...s, subs });
    return;
  }
  if (!s.selected.length) return;
  const drop = new Set(s.selected);
  const subs = clone(s.subs).map((sub, si) => ({ ...sub, points: sub.points.filter((_, pi) => !drop.has(keyOf(si, pi))) }));
  update({ ...s, selected: [] });
  void save(subs.filter((x) => x.points.length), 'Delete points');
}

// Drawing it ------------------------------------------------------------------------------------

/** The path being drawn or edited, its points and handles, over the canvas. */
export function PenOverlay() {
  const pen = useEditor((s) => s.pen);
  const view = useEditor((s) => s.view);
  if (!pen) return null;
  const m: [number, number, number, number, number, number] = [view.zoom, 0, 0, view.zoom, view.tx, view.ty];
  const subs = transformPaths(pen.subs, m);
  const sc = (p: Pt) => ({ x: p.x * view.zoom + view.tx, y: p.y * view.zoom + view.ty });
  const drawing = pen.mode === 'draw';
  const live = drawing ? subs[subs.length - 1] : undefined;
  const last = live?.points[live.points.length - 1];
  const hover = pen.hover ? sc(pen.hover) : undefined;
  const closingHover = !!(live && hover && live.points.length >= 2 && Math.hypot(hover.x - live.points[0].x, hover.y - live.points[0].y) <= NEAR);
  const handlesOf = (si: number, pi: number) => (drawing ? si === subs.length - 1 && pi === (subs[si].points.length - 1) : pen.selected.includes(keyOf(si, pi)) || pen.selected.some((k) => { const [a, b] = k.split(':').map(Number); return a === si && Math.abs(b - pi) === 1; }));
  return (
    <g className="pen">
      {subs.map((sub, si) => <path key={si} className="pen-path" d={formatPath([sub])} />)}
      {!drawing && subs.map((sub, si) => {
        const n = sub.closed ? sub.points.length : sub.points.length - 1;
        return Array.from({ length: Math.max(0, n) }, (_, seg) => {
          const a = sub.points[seg], b = sub.points[(seg + 1) % sub.points.length];
          const d = a.out || b.in ? `M${a.x} ${a.y}C${(a.out ?? a).x} ${(a.out ?? a).y} ${(b.in ?? b).x} ${(b.in ?? b).y} ${b.x} ${b.y}` : `M${a.x} ${a.y}L${b.x} ${b.y}`;
          return <path key={`${si}-${seg}`} className="pen-segment" d={d}
            onPointerDown={(e) => { e.stopPropagation(); segmentDown(si, seg, toCanvas(e)); }} />;
        });
      })}
      {live && last && hover && !closingHover && (
        <path className="pen-next" d={last.out ? `M${last.x} ${last.y}Q${last.out.x} ${last.out.y} ${hover.x} ${hover.y}` : `M${last.x} ${last.y}L${hover.x} ${hover.y}`} />
      )}
      {subs.map((sub, si) => sub.points.map((p, pi) => handlesOf(si, pi) && (['in', 'out'] as const).map((w) => p[w] && (
        <g key={`${si}-${pi}-${w}`}>
          <line className="pen-handle-line" x1={p.x} y1={p.y} x2={p[w]!.x} y2={p[w]!.y} />
          <circle className="pen-handle" cx={p[w]!.x} cy={p[w]!.y} r={3.5}
            onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); handleDown(si, pi, w, e); }} />
        </g>
      )))) }
      {subs.map((sub, si) => sub.points.map((p, pi) => {
        const on = !drawing && pen.selected.includes(keyOf(si, pi));
        const first = drawing && si === subs.length - 1 && pi === 0;
        return <rect key={`${si}-${pi}`} className={`pen-point${on ? ' on' : ''}${first && closingHover ? ' closing' : ''}`} x={p.x - 4} y={p.y - 4} width={8} height={8} rx={first ? 4 : 1.5}
          onPointerDown={(e) => {
            if (drawing) return;
            e.stopPropagation();
            pointDown(si, pi, e);
          }} />;
      }))}
    </g>
  );
}

function toCanvas(e: { clientX: number; clientY: number }): Pt {
  const host = document.querySelector('.canvas')!.getBoundingClientRect();
  return toDoc(store.get().view, e.clientX - host.left, e.clientY - host.top);
}

// Leaving the pen tool finishes what it was drawing.
store.subscribe(() => {
  const s = store.get();
  if (s.pen?.mode === 'draw' && s.tool !== 'pen') void finishDrawing();
  if (s.pen?.mode === 'edit' && (!s.pen.id || !s.doc?.has(s.pen.id))) update(undefined);
});
