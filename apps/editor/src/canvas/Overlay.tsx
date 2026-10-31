import { useEffect, useReducer, useRef, useState, type RefObject } from 'react';
import type { Box } from '@nib/layout';
import type { Node } from '@nib/format';
import { fontWeight, isItalic } from '@nib/render';
import { setProps } from '../app/actions.ts';
import { authHeaders } from '../app/connection.ts';
import { store, useEditor, type Tool, type View } from '../app/store.ts';
import { canvas, rectOf, resizedBox } from './Canvas.tsx';
import { PenOverlay } from './pen.tsx';
import { GradientOverlay } from './GradientOverlay.tsx';
import { CropOverlay } from './CropOverlay.tsx';
import { angleOf, apply, boundsOf, isAxisAligned, mul, placement, quad, type M } from './affine.ts';
import type { Placed } from './scenes.ts';
import { isPart, layerOf } from '../app/parts.ts';

type Point = { x: number; y: number };

/** A pointer gesture in progress on the canvas. */
export type Gesture =
  | { kind: 'pan'; sx: number; sy: number; view: View }
  | { kind: 'press'; start: Point; sx: number; sy: number; ids: string[] }
  | { kind: 'drag'; start: Point; end: Point; ids: string[] }
  | { kind: 'marquee'; start: Point; end: Point; add: string[] }
  | { kind: 'create'; tool: Tool; start: Point; end: Point; parent: string | null }
  /** `box` and `end` are in the node's own coordinates; `matrix` takes them to the document's. */
  | { kind: 'resize'; id: string; handle: string; box: Box; matrix: M; start: Point; end: Point | undefined; shift: boolean; scale?: boolean }
  /** Turning a w × h node around `center` (document coordinates); `from` is the pointer's angle when pressed. */
  | { kind: 'rotate'; id: string; w: number; h: number; center: Point; matrix: M; from: number; start: number; angle: number; shift: boolean };

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
/** Each handle's direction from the centre, in screen degrees (clockwise from the right). */
const DIRECTIONS: Record<string, number> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
const AXIS_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
/** The resize cursor for a handle of a node turned `deg` degrees (counter-clockwise). */
const cursorFor = (handle: string, deg: number) => AXIS_CURSORS[((Math.round((DIRECTIONS[handle] - deg) / 45) % 4) + 4) % 4];

const screen = (v: View, b: Box) => ({ x: b.x * v.zoom + v.tx, y: b.y * v.zoom + v.ty, width: b.width * v.zoom, height: b.height * v.zoom });

interface Props {
  gesture: RefObject<Gesture | undefined>;
  register: (force: () => void) => void;
  startResize: (handle: string) => void;
  /** `from`: where the rotate handle was pressed, in document coordinates. */
  startRotate: (from: Point) => void;
}

export function Overlay({ gesture, register, startResize, startRotate }: Props) {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => register(force), [register]);
  const view = useEditor((s) => s.view);
  const selection = useEditor((s) => s.selection);
  const hover = useEditor((s) => s.hover);
  const doc = useEditor((s) => s.doc);
  useEditor((s) => s.layoutVersion);
  useEditor((s) => s.version);
  const text = useEditor((s) => s.editingText);
  const pen = useEditor((s) => s.pen);
  const crop = useEditor((s) => s.crop);
  const pixelGrid = useEditor((s) => s.pixelGrid);
  // Points being edited take the place of the selection's handles.
  const editing = text ?? (pen ? 'pen' : crop ? 'crop' : undefined);
  const cache = canvas.cache;
  if (!doc || !cache) return null;

  const g = gesture.current;
  const placed = selection.map((id) => cache.placed(id)).filter((p): p is Placed => !!p);
  const single = selection.length === 1 && placed.length === 1 ? placed[0] : undefined;
  const all = placed.length ? union(placed.map((p) => p.bounds)) : undefined;
  const hovered = hover && !selection.includes(hover) ? cache.placed(hover) : undefined;
  const resized = g?.kind === 'resize' ? resizedBox(g) : undefined;
  // The size shown under the selection: a single node's own width and height, else the box around it all.
  const label = resized && g?.kind === 'resize' ? { at: boundsOf(quad(mul(g.matrix, [1, 0, 0, 1, resized.x, resized.y]), resized.width, resized.height)), real: resized }
    : single ? { at: single.bounds, real: single.abs } : all ? { at: all, real: all } : undefined;
  const drag = g?.kind === 'drag' ? { dx: g.end.x - g.start.x, dy: g.end.y - g.start.y } : undefined;

  return (
    <div className="overlay">
      <svg width="100%" height="100%">
        {view.zoom >= 8 && pixelGrid && (
          <>
            <defs>
              <pattern id="pixel-grid" width={view.zoom} height={view.zoom} x={view.tx} y={view.ty} patternUnits="userSpaceOnUse">
                <path d={`M${view.zoom} 0L0 0 0 ${view.zoom}`} className="pixel-grid" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#pixel-grid)" />
          </>
        )}
        {doc.data.children.map((n) => {
          // Like Figma, only frames (screens, artboards), instances and browser windows get a name label.
          if (n.type !== 'frame' && n.type !== 'ref' && n.type !== 'browser') return null;
          const b = cache.box(n.id);
          if (!b) return null;
          const s = screen(view, b);
          const shift = canvas.shift.get(n.id);
          const x = s.x + (shift ? shift.dx * view.zoom : 0), y = s.y + (shift ? shift.dy * view.zoom : 0);
          return (
            <text key={n.id} x={x} y={y - 6} className={`frame-label${selection.includes(n.id) ? ' selected' : ''}`}
              onPointerDown={(e) => { e.stopPropagation(); store.set({ selection: e.shiftKey ? [...selection, n.id] : [n.id] }); }}>
              {clip(n.name ?? pageHost(n) ?? (n.type === 'ref' ? doc.get(n.ref)?.name : undefined) ?? n.type, s.width / 6.5)}{n.reusable ? ' ◇' : ''}
            </text>
          );
        })}
        {hovered && <Frame m={hovered.matrix} w={hovered.abs.width} h={hovered.abs.height} view={view} className="hover" />}
        {!drag && placed.map((p, i) => <Frame key={i} m={p.matrix} w={p.abs.width} h={p.abs.height} view={view} className="selected" />)}
        {drag && placed.map((p, i) => <Frame key={i} m={mul([1, 0, 0, 1, drag.dx, drag.dy], p.matrix)} w={p.abs.width} h={p.abs.height} view={view} className="selected ghost" />)}
        {g?.kind === 'marquee' && <Outline box={screen(view, rectOf(g.start, g.end))} className="marquee" />}
        {g?.kind === 'create' && <Outline box={screen(view, rectOf(g.start, g.end))} className="selected" />}
        {g?.kind === 'resize' && resized && <Frame m={mul(g.matrix, [1, 0, 0, 1, resized.x, resized.y])} w={resized.width} h={resized.height} view={view} className="selected ghost" />}
        {single && !drag && !editing && !isPart(single.id) && (() => {
          const { matrix: m, abs: { width: w, height: h } } = single;
          const deg = angleOf(m);
          return HANDLES.map((hd) => {
            if ((hd === 'n' || hd === 's') && w * view.zoom < 24) return null;
            if ((hd === 'e' || hd === 'w') && h * view.zoom < 24) return null;
            const d = apply(m, hd.includes('w') ? 0 : hd.includes('e') ? w : w / 2, hd.includes('n') ? 0 : hd.includes('s') ? h : h / 2);
            const hx = d.x * view.zoom + view.tx, hy = d.y * view.zoom + view.ty;
            return (
              <rect key={hd} className="handle" x={hx - 4} y={hy - 4} width={8} height={8} style={{ cursor: cursorFor(hd, deg) }} transform={deg ? `rotate(${-deg} ${hx} ${hy})` : undefined}
                onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); startResize(hd); }} />
            );
          });
        })()}
        {single && !drag && !editing && !isPart(single.id) && g?.kind !== 'resize' && (() => {
          // Above the middle of the node's top side, on its own up.
          const d = apply(single.matrix, single.abs.width / 2, -18 / view.zoom);
          return <circle className="handle rotate" cx={d.x * view.zoom + view.tx} cy={d.y * view.zoom + view.ty} r={4.5}
            onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); startRotate(d); }} />;
        })()}
        {g?.kind === 'rotate' && (() => {
          // The node as it was, turned around its centre by as much as the gesture has turned it.
          const c = g.center;
          const m = mul([1, 0, 0, 1, c.x, c.y], mul(placement(0, 0, g.angle - g.start), mul([1, 0, 0, 1, -c.x, -c.y], g.matrix)));
          const top = boundsOf(quad(m, g.w, g.h));
          return (
            <g>
              <Frame m={m} w={g.w} h={g.h} view={view} className="selected ghost" />
              <text className="angle-label" x={c.x * view.zoom + view.tx} y={top.y * view.zoom + view.ty - 14}>{Math.round(g.angle)}°</text>
            </g>
          );
        })()}
        <PenOverlay />
        <GradientOverlay />
        <CropOverlay />
        {canvas.guides.map((gd, i) => {
          const a = gd.axis === 'x' ? { x: gd.at, y: gd.from } : { x: gd.from, y: gd.at };
          const b = gd.axis === 'x' ? { x: gd.at, y: gd.to } : { x: gd.to, y: gd.at };
          return <line key={`g${i}`} className="guide" x1={a.x * view.zoom + view.tx} y1={a.y * view.zoom + view.ty} x2={b.x * view.zoom + view.tx} y2={b.y * view.zoom + view.ty} />;
        })}
        {canvas.measures.map((m, i) => <MeasureLine key={`m${i}`} m={m} view={view} />)}
        {label && !editing && g?.kind !== 'rotate' && <SizeLabel box={screen(view, label.at)} real={label.real} />}
      </svg>
      {text && <TextEditor id={text} />}
    </div>
  );
}

/** A measured distance: a red line, its ends, and its length in a label. */
function MeasureLine({ m, view }: { m: { x1: number; y1: number; x2: number; y2: number; value: number }; view: View }) {
  const p = (x: number, y: number) => ({ x: x * view.zoom + view.tx, y: y * view.zoom + view.ty });
  const a = p(m.x1, m.y1), b = p(m.x2, m.y2);
  const text = String(round(m.value));
  const w = text.length * 6.4 + 10;
  const horizontal = Math.abs(a.y - b.y) < 0.5;
  const tick = (q: { x: number; y: number }) => (horizontal ? <line className="measure" x1={q.x} y1={q.y - 4} x2={q.x} y2={q.y + 4} /> : <line className="measure" x1={q.x - 4} y1={q.y} x2={q.x + 4} y2={q.y} />);
  const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
  return (
    <g>
      <line className="measure" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      {tick(a)}{tick(b)}
      <g className="measure-label">
        <rect x={horizontal ? cx - w / 2 : cx + 6} y={horizontal ? cy + 6 : cy - 9} width={w} height={18} rx={4} />
        <text x={horizontal ? cx : cx + 6 + w / 2} y={horizontal ? cy + 19 : cy + 4}>{text}</text>
      </g>
    </g>
  );
}

/** The outline of a w × h node placed by `m`: a crisp rectangle when it is not turned. */
function Frame({ m, w, h, view, className }: { m: M; w: number; h: number; view: View; className: string }) {
  if (isAxisAligned(m)) return <Outline box={screen(view, { x: m[4], y: m[5], width: w, height: h })} className={className} />;
  const points = quad(m, w, h).map((p) => `${p.x * view.zoom + view.tx},${p.y * view.zoom + view.ty}`).join(' ');
  return <polygon className={className} points={points} />;
}

function Outline({ box, className }: { box: Box; className: string }) {
  return <rect className={className} x={box.x + 0.5} y={box.y + 0.5} width={Math.max(0, box.width - 1)} height={Math.max(0, box.height - 1)} />;
}

function SizeLabel({ box, real }: { box: Box; real: Box }) {
  const text = `${round(real.width)} × ${round(real.height)}`;
  const w = text.length * 6.4 + 12;
  return (
    <g className="size-label">
      <rect x={box.x + box.width / 2 - w / 2} y={box.y + box.height + 8} width={w} height={18} rx={4} />
      <text x={box.x + box.width / 2} y={box.y + box.height + 21}>{text}</text>
    </g>
  );
}

/** Edits a text node in place: a text area over it in the same font, committed on blur. */
function TextEditor({ id }: { id: string }) {
  const doc = store.get().doc!;
  // A part of an instance is edited as the instance shows it, and its text becomes an override.
  const node = layerOf(doc, id) as Record<string, any> | undefined;
  const view = useEditor((s) => s.view);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(String(node?.content ?? ''));
  const latest = useRef(value);
  latest.current = value;
  const done = useRef(false);
  // Commits once: on blur, Escape, Cmd+Enter, or when the editor closes for another reason (a click on the
  // canvas closes it before the text area loses focus).
  const finish = () => {
    if (done.current) return;
    done.current = true;
    if (node && latest.current !== String(node.content ?? '')) void setProps([id], { content: latest.current }, 'Edit text');
    if (store.get().editingText === id) store.set({ editingText: undefined });
  };
  useEffect(() => {
    canvas.cache?.setHidden(id);
    ref.current?.focus();
    ref.current?.select();
    if (node) void loadWebFont(String(node.fontFamily ?? 'Inter'), fontWeight(node.fontWeight), isItalic(node.fontStyle));
    return () => { finish(); canvas.cache?.setHidden(undefined); };
  }, [id]);
  const box = canvas.cache?.box(id);
  if (!node || !box) return null;
  const s = screen(view, box);
  const fill = typeof node.fill === 'string' && node.fill.startsWith('#') ? node.fill : '#000000';
  const growth = node.textGrowth ?? 'auto';
  return (
    <textarea ref={ref} className="text-editor" value={value} spellCheck={false}
      onChange={(e) => setValue(e.target.value)} onBlur={finish}
      onKeyDown={(e) => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); finish(); } e.stopPropagation(); }}
      style={{
        left: s.x, top: s.y, width: growth === 'auto' ? Math.max(s.width, 20) + 40 : s.width, height: Math.max(s.height, 10),
        fontFamily: `'${node.fontFamily ?? 'Inter'}'`, fontSize: (typeof node.fontSize === 'number' ? node.fontSize : 14) * view.zoom,
        fontWeight: fontWeight(node.fontWeight), fontStyle: isItalic(node.fontStyle) ? 'italic' : 'normal',
        lineHeight: typeof node.lineHeight === 'number' ? node.lineHeight : 'normal', letterSpacing: (typeof node.letterSpacing === 'number' ? node.letterSpacing : 0) * view.zoom,
        textAlign: node.textAlign ?? 'left', color: fill, whiteSpace: growth === 'auto' ? 'pre' : 'pre-wrap',
      }} />
  );
}

const loadedFonts = new Set<string>();
/** Make a design font available to HTML text (the in-place editor), from the same bytes the canvas uses. */
async function loadWebFont(family: string, weight: number, italic: boolean): Promise<void> {
  const key = `${family}|${weight}|${italic}`;
  if (loadedFonts.has(key)) return;
  loadedFonts.add(key);
  const r = await fetch(`/api/font?${new URLSearchParams({ family, weight: String(weight), italic: italic ? '1' : '0' })}`, { headers: authHeaders() });
  if (!r.ok) return;
  const face = new FontFace(family, await r.arrayBuffer(), { weight: String(weight), style: italic ? 'italic' : 'normal' });
  document.fonts.add(await face.load());
}

function union(boxes: Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)), y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

const round = (v: number) => Math.round(v * 10) / 10;
const clip = (s: string, chars: number) => (s.length > chars ? `${s.slice(0, Math.max(1, Math.floor(chars) - 1))}…` : s);

/** A browser node's page host, for its label when it has no name. */
function pageHost(n: Node): string | undefined {
  const url = (n as { url?: unknown }).url;
  if (n.type !== 'browser' || typeof url !== 'string') return undefined;
  try { return new URL(url).host || url; } catch { return url; }
}
