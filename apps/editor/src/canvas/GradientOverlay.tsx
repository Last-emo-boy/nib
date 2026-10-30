import { useRef, useState } from 'react';
import { commit } from '../app/actions.ts';
import { store, useEditor } from '../app/store.ts';
import { canvas } from './Canvas.tsx';
import { ellipseHandles, fromAxis, fromEnds, linearEnds, meshPoints, moveMeshPoint, offsetOn, type U } from './gradient.ts';

/** The fill whose gradient is edited on the canvas: which node, fill or stroke, which entry. */
export interface GradientEdit { id: string; prop: 'fill' | 'stroke'; index: number }

type Fill = Record<string, any>;

const list = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/**
 * Handles for the gradient being edited: a linear gradient's ends and stops, a radial or angular one's centre,
 * axes and stops, a mesh's points. Drags change the fill live, as one undo step.
 */
export function GradientOverlay() {
  const edit = useEditor((s) => s.gradientEdit);
  const doc = useEditor((s) => s.doc);
  const view = useEditor((s) => s.view);
  const selection = useEditor((s) => s.selection);
  useEditor((s) => s.version);
  useEditor((s) => s.layoutVersion);
  const [live, setLive] = useState<Fill | undefined>();
  const sent = useRef(0);
  if (!edit || !doc || selection.length !== 1 || selection[0] !== edit.id) return null;
  const node = doc.get(edit.id) as Record<string, unknown> | undefined;
  const box = canvas.cache?.box(edit.id);
  const stored = node ? list(node[edit.prop])[edit.index] : undefined;
  const f = (live ?? stored) as Fill | undefined;
  if (!node || !box || !f || typeof f !== 'object' || (f.type !== 'gradient' && f.type !== 'mesh_gradient')) return null;

  const sc = (u: U) => ({ x: (box.x + u.x * box.width) * view.zoom + view.tx, y: (box.y + u.y * box.height) * view.zoom + view.ty });
  const unit = (clientX: number, clientY: number): U => {
    const host = document.querySelector('.canvas')!.getBoundingClientRect();
    const v = store.get().view;
    const x = (clientX - host.left - v.tx) / v.zoom, y = (clientY - host.top - v.ty) / v.zoom;
    return { x: box.width ? (x - box.x) / box.width : 0, y: box.height ? (y - box.y) / box.height : 0 };
  };
  const write = (next: Fill, merge: string) => {
    const value = node[edit.prop];
    const all = list(value).map((x, i) => (i === edit.index ? next : x));
    return commit('Edit gradient', (ed) => ed.set(edit.id, { [edit.prop]: Array.isArray(value) ? all : all[0] }), merge);
  };
  /** Follow a drag from a handle; `change` gives the fill for a pointer position in the unit box. */
  const drag = (e: React.PointerEvent, change: (p: U, base: Fill) => Fill) => {
    e.stopPropagation();
    e.preventDefault();
    const base = structuredClone(f);
    const merge = `gradient:${edit.id}:${performance.now()}`;
    let last: Fill | undefined;
    const move = (ev: PointerEvent) => {
      last = change(unit(ev.clientX, ev.clientY), base);
      setLive(last);
      // Live, but not more often than the document can take.
      if (performance.now() - sent.current > 60) { sent.current = performance.now(); void write(last, merge); }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (last) void write(last, merge).finally(() => setLive(undefined));
      else setLive(undefined);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const stops = (Array.isArray(f.colors) ? f.colors : []) as { color: string; position: number }[];
  const stopHandles = (a: U, b: U) => stops.map((s, i) => {
    const p = sc({ x: a.x + (b.x - a.x) * s.position, y: a.y + (b.y - a.y) * s.position });
    return <circle key={`s${i}`} className="grad-stop" cx={p.x} cy={p.y} r={6} style={{ fill: typeof s.color === 'string' && s.color.startsWith('#') ? s.color : '#888' }}
      onPointerDown={(e) => drag(e, (q, base) => ({ ...base, colors: base.colors.map((c: Fill, j: number) => (j === i ? { ...c, position: Math.round(offsetOn(a, b, q) * 1000) / 1000 } : c)) }))} />;
  });
  const square = (key: string, u: U, onDown: (e: React.PointerEvent) => void) => { const p = sc(u); return <rect key={key} className="grad-handle" x={p.x - 5} y={p.y - 5} width={10} height={10} rx={2} onPointerDown={onDown} />; };

  if (f.type === 'mesh_gradient') {
    const pts = meshPoints(f);
    const columns = Math.max(2, Math.round(f.columns ?? 2)), rows = Math.max(2, Math.round(f.rows ?? 2));
    const lines: [U, U][] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
      if (c < columns - 1) lines.push([pts[r * columns + c], pts[r * columns + c + 1]]);
      if (r < rows - 1) lines.push([pts[r * columns + c], pts[(r + 1) * columns + c]]);
    }
    return (
      <g className="gradient-edit">
        {lines.map(([a, b], i) => { const p = sc(a), q = sc(b); return <line key={i} className="grad-line" x1={p.x} y1={p.y} x2={q.x} y2={q.y} />; })}
        {pts.map((u, i) => { const p = sc(u); return <circle key={i} className="grad-stop" cx={p.x} cy={p.y} r={6} style={{ fill: String(f.colors?.[i] ?? '#888').startsWith('#') ? f.colors[i] : '#888' }}
          onPointerDown={(e) => drag(e, (q, base) => moveMeshPoint(base, i, q))} />; })}
      </g>
    );
  }
  if ((f.gradientType ?? 'linear') === 'linear') {
    const { start, end } = linearEnds(f);
    const a = sc(start), b = sc(end);
    return (
      <g className="gradient-edit">
        <line className="grad-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        {stopHandles(start, end)}
        {square('start', start, (e) => drag(e, (q, base) => ({ ...base, ...fromEnds(q, linearEnds(base).end) })))}
        {square('end', end, (e) => drag(e, (q, base) => ({ ...base, ...fromEnds(linearEnds(base).start, q) })))}
      </g>
    );
  }
  const h = ellipseHandles(f);
  const ring = Array.from({ length: 49 }, (_, i) => {
    const t = (i / 48) * Math.PI * 2;
    const u = { x: h.center.x + (h.a.x - h.center.x) * Math.cos(t) + (h.b.x - h.center.x) * Math.sin(t), y: h.center.y + (h.a.y - h.center.y) * Math.cos(t) + (h.b.y - h.center.y) * Math.sin(t) };
    const p = sc(u);
    return `${i ? 'L' : 'M'}${p.x} ${p.y}`;
  }).join('');
  const c = sc(h.center), pa = sc(h.a), pb = sc(h.b);
  return (
    <g className="gradient-edit">
      <path className="grad-line" d={ring} fill="none" />
      <line className="grad-line" x1={c.x} y1={c.y} x2={pa.x} y2={pa.y} />
      <line className="grad-line dim" x1={c.x} y1={c.y} x2={pb.x} y2={pb.y} />
      {stopHandles(h.center, h.a)}
      {square('center', h.center, (e) => drag(e, (q, base) => ({ ...base, center: { x: Math.round(q.x * 10000) / 10000, y: Math.round(q.y * 10000) / 10000 } })))}
      {square('a', h.a, (e) => drag(e, (q, base) => ({ ...base, ...fromAxis(base, 'a', q) })))}
      {square('b', h.b, (e) => drag(e, (q, base) => ({ ...base, ...fromAxis(base, 'b', q) })))}
    </g>
  );
}

// Selecting something else ends gradient editing.
store.subscribe(() => {
  const s = store.get();
  if (s.gradientEdit && (s.selection.length !== 1 || s.selection[0] !== s.gradientEdit.id)) store.set({ gradientEdit: undefined });
});
