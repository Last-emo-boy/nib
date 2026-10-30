import { useEffect, useReducer, useRef, useState, type RefObject } from 'react';
import type { Box } from '@nib/layout';
import type { Node } from '@nib/format';
import { fontWeight, isItalic } from '@nib/render';
import { setProps } from '../app/actions.ts';
import { authHeaders } from '../app/connection.ts';
import { store, useEditor, type Tool, type View } from '../app/store.ts';
import { canvas, rectOf, resizedBox } from './Canvas.tsx';
import { PenOverlay } from './pen.tsx';

type Point = { x: number; y: number };

/** A pointer gesture in progress on the canvas. */
export type Gesture =
  | { kind: 'pan'; sx: number; sy: number; view: View }
  | { kind: 'press'; start: Point; sx: number; sy: number; ids: string[] }
  | { kind: 'drag'; start: Point; end: Point; ids: string[] }
  | { kind: 'marquee'; start: Point; end: Point; add: string[] }
  | { kind: 'create'; tool: Tool; start: Point; end: Point; parent: string | null }
  | { kind: 'resize'; id: string; handle: string; box: Box; start: Point; end: Point | undefined; shift: boolean }
  | { kind: 'rotate'; id: string; box: Box; start: number; angle: number; shift: boolean };

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
const CURSORS: Record<string, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

const screen = (v: View, b: Box) => ({ x: b.x * v.zoom + v.tx, y: b.y * v.zoom + v.ty, width: b.width * v.zoom, height: b.height * v.zoom });

interface Props {
  gesture: RefObject<Gesture | undefined>;
  register: (force: () => void) => void;
  startResize: (handle: string, box: Box) => void;
  startRotate: (box: Box) => void;
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
  // Points being edited take the place of the selection's handles.
  const editing = text ?? (pen ? 'pen' : undefined);
  const cache = canvas.cache;
  if (!doc || !cache) return null;

  const g = gesture.current;
  const boxes = selection.map((id) => cache.box(id)).filter((b): b is Box => !!b);
  const single = selection.length === 1 && boxes.length === 1 ? boxes[0] : undefined;
  const all = boxes.length ? union(boxes) : undefined;
  const hoverBox = hover && !selection.includes(hover) ? cache.box(hover) : undefined;
  const drag = g?.kind === 'drag' ? { dx: g.end.x - g.start.x, dy: g.end.y - g.start.y } : undefined;

  return (
    <div className="overlay">
      <svg width="100%" height="100%">
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
        {hoverBox && <Outline box={screen(view, hoverBox)} className="hover" />}
        {!drag && boxes.map((b, i) => <Outline key={i} box={screen(view, b)} className="selected" />)}
        {drag && boxes.map((b, i) => <Outline key={i} box={screen(view, { ...b, x: b.x + drag.dx, y: b.y + drag.dy })} className="selected ghost" />)}
        {g?.kind === 'marquee' && <Outline box={screen(view, rectOf(g.start, g.end))} className="marquee" />}
        {g?.kind === 'create' && <Outline box={screen(view, rectOf(g.start, g.end))} className="selected" />}
        {g?.kind === 'resize' && resizedBox(g) && <Outline box={screen(view, resizedBox(g)!)} className="selected ghost" />}
        {single && !drag && !editing && HANDLES.map((h) => {
          const s = screen(view, single);
          const hx = h.includes('w') ? s.x : h.includes('e') ? s.x + s.width : s.x + s.width / 2;
          const hy = h.includes('n') ? s.y : h.includes('s') ? s.y + s.height : s.y + s.height / 2;
          if ((h === 'n' || h === 's') && s.width < 24) return null;
          if ((h === 'e' || h === 'w') && s.height < 24) return null;
          return (
            <rect key={h} className="handle" x={hx - 4} y={hy - 4} width={8} height={8} style={{ cursor: CURSORS[h] }}
              onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); startResize(h, single); }} />
          );
        })}
        {single && !drag && !editing && g?.kind !== 'resize' && (() => {
          const s = screen(view, single);
          return <circle className="handle rotate" cx={s.x + s.width / 2} cy={s.y - 18} r={4.5}
            onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); startRotate(single); }} />;
        })()}
        {g?.kind === 'rotate' && (() => {
          const s = screen(view, g.box);
          return (
            <g>
              <rect className="selected ghost" x={s.x} y={s.y} width={s.width} height={s.height} transform={`rotate(${-g.angle} ${s.x + s.width / 2} ${s.y + s.height / 2})`} />
              <text className="angle-label" x={s.x + s.width / 2} y={s.y - 30}>{Math.round(g.angle)}°</text>
            </g>
          );
        })()}
        <PenOverlay />
        {all && !editing && <SizeLabel box={screen(view, g?.kind === 'resize' && resizedBox(g) ? resizedBox(g)! : all)} real={g?.kind === 'resize' && resizedBox(g) ? resizedBox(g)! : all} />}
      </svg>
      {text && <TextEditor id={text} />}
    </div>
  );
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
  const node = doc.get(id) as Record<string, any> | undefined;
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
