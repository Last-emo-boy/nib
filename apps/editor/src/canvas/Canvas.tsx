import { useEffect, useRef } from 'react';
import type { Surface } from 'canvaskit-wasm';
import { newId, svgToNodes, type PenDoc } from '@nib/core';
import type { Box } from '@nib/layout';
import { commit, insertNode, isContainer, isFree, pruneSelection } from '../app/actions.ts';
import { COMPONENT_MIME, post } from '../app/libraries.ts';
import type { Connection } from '../app/connection.ts';
import { store, toast, type View } from '../app/store.ts';
import { getEngine, imagesFor, type Engine } from './engine.ts';
import { AgentCursors } from './AgentCursors.tsx';
import { Overlay, type Gesture } from './Overlay.tsx';
import { presence } from './presence.ts';
import { SceneCache } from './scenes.ts';
import { editPath, finishEditing, penDown, penHover } from './pen.tsx';
import { finishSketch, sketchWidth } from './sketch.ts';
import { imageFillIndex } from './crop.ts';
import { measure, snap, snapPoint, type Guide, type Lines, type Measure } from './snap.ts';
import { apply, applyLinear, invert, isAxisAligned, placement, type P } from './affine.ts';
import { scaleTree } from '../app/geometry.ts';
import { isPart, layerOf } from '../app/parts.ts';
import { addFontFiles, isFontFile } from '../app/fonts.ts';

/** What other parts of the editor need from the canvas. */
export const canvas = {
  cache: undefined as SceneCache | undefined,
  /** Top-level nodes drawn shifted while they are dragged. */
  shift: new Map<string, { dx: number; dy: number }>(),
  redraw: () => {},
  size: { width: 0, height: 0 },
  /** When the person last panned or zoomed (performance.now()); following an agent waits after that. */
  userViewAt: 0,
  /** Smart guides of the gesture in progress, and distances shown while Alt is held. */
  guides: [] as Guide[],
  measures: [] as Measure[],
};

/** Screen pixels within which edges snap. */
const SNAP_PX = 5;

/**
 * Boxes a layer in `parent` (null: the canvas) can snap to: the parent and its other children, or the other
 * top-level layers near the view.
 */
function snapTargets(doc: PenDoc, parent: string | null, exclude: string[]): Box[] {
  const cache = canvas.cache;
  if (!cache) return [];
  const skip = new Set(exclude);
  const kids = parent ? (doc.get(parent) as { children?: { id: string; enabled?: unknown }[] } | undefined)?.children ?? [] : doc.data.children;
  const boxes = kids.filter((n) => !skip.has(n.id) && n.enabled !== false).map((n) => cache.bounds(n.id)).filter((b): b is Box => !!b);
  const own = parent ? cache.bounds(parent) : undefined;
  if (own) boxes.push(own);
  if (!parent) {
    // Of many top-level layers, those on screen.
    const { view } = store.get();
    const a = visibleArea();
    const v = { x: (a.x - view.tx) / view.zoom, y: (a.y - view.ty) / view.zoom, width: a.width / view.zoom, height: a.height / view.zoom };
    return boxes.filter((b) => b.x < v.x + v.width * 2 && b.x + b.width > v.x - v.width && b.y < v.y + v.height * 2 && b.y + b.height > v.y - v.height).slice(0, 400);
  }
  return boxes;
}

function unionOf(boxes: Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  return { x: x0, y: y0, width: Math.max(...boxes.map((b) => b.x + b.width)) - x0, height: Math.max(...boxes.map((b) => b.y + b.height)) - y0 };
}

export const toDoc = (v: View, sx: number, sy: number) => ({ x: (sx - v.tx) / v.zoom, y: (sy - v.ty) / v.zoom });

const BACKGROUND = { dark: [0.075, 0.075, 0.08, 1], light: [0.953, 0.953, 0.96, 1] } as const;
const DRAG_THRESHOLD = 3;

/** The part of the canvas not covered by panels, in screen pixels. */
export function visibleArea() {
  const { width, height } = canvas.size;
  const left = store.get().leftOpen ? 338 : 66;
  const { agentOpen, activityOpen, browserOpen } = store.get();
  // The properties panel, and the agent's chat, the browser or the activity feed beside it.
  const side = agentOpen ? store.get().agentWidth + 10 : browserOpen ? 394 : activityOpen ? 340 : 0;
  const right = (width > 900 ? 288 : 10) + side;
  return { x: left, y: 60, width: Math.max(100, width - left - right), height: Math.max(100, height - 120) };
}

/** Zoom so that `box` (document coordinates) fills the visible canvas with a margin. */
export function fitView(box: Box | undefined, maxZoom = 1): View {
  if (!box || !canvas.size.width) return { tx: 80, ty: 80, zoom: 1 };
  const a = visibleArea();
  const zoom = Math.min(maxZoom, (a.width - 48) / Math.max(1, box.width), (a.height - 48) / Math.max(1, box.height));
  return { zoom, tx: a.x + a.width / 2 - (box.x + box.width / 2) * zoom, ty: a.y + a.height / 2 - (box.y + box.height / 2) * zoom };
}

/** Bounding box of top-level nodes from their stored position and fixed sizes, before layout. */
function storedBounds(doc: PenDoc): Box | undefined {
  const boxes = doc.data.children.filter((n) => n.enabled !== false).map((n) => {
    const w = (n as { width?: unknown }).width, h = (n as { height?: unknown }).height;
    return { x: n.x ?? 0, y: n.y ?? 0, width: typeof w === 'number' ? w : 0, height: typeof h === 'number' ? h : 0 };
  });
  if (!boxes.length) return undefined;
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)), y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

/** Bounding box of top-level nodes, or of the given ids. */
export function boundsOf(ids?: string[]): Box | undefined {
  const { doc } = store.get();
  const cache = canvas.cache;
  if (!doc || !cache) return undefined;
  const boxes = (ids ?? doc.data.children.map((n) => n.id)).map((id) => cache.bounds(id)).filter((b): b is Box => !!b);
  if (!boxes.length) return undefined;
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)), y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Which node a click selects. Like Figma: a click picks a child of a top-level frame (or the frame when
 * nothing else is there); once something is selected, clicks pick nodes at its depth; Cmd/Ctrl picks the
 * deepest node.
 */
function pick(doc: PenDoc, chain: string[], selection: string[], deep: boolean): string | undefined {
  if (!chain.length) return undefined;
  if (deep) return chain[0];
  for (const id of selection) if (chain.includes(id)) return id;
  // Next to a selected layer: the layer beside it under the pointer (inside an instance too, once entered).
  for (const id of selection) {
    const parent = canvas.cache?.placed(id)?.parentId ?? doc.locate(id)?.parent?.id;
    const i = parent ? chain.indexOf(parent) : -1;
    if (i > 0) return chain[i - 1];
  }
  // Otherwise the instance, not a part of it: a double-click steps in.
  const outer = chain.filter((id) => !isPart(id));
  return outer.length >= 2 ? outer[outer.length - 2] : outer[0];
}

/** The frame a new node drawn at a point goes into: the deepest frame under it. */
function containerAt(doc: PenDoc, chain: string[]): string | null {
  for (const id of chain) if (isContainer(doc.get(id)) && doc.get(id)?.type === 'frame') return id;
  return null;
}

/**
 * Put an instance of component `ref` (`alias:id` for a library's) where it was dropped, at a point on the
 * screen, or from a click into the selected frame or the middle of the view.
 */
export async function insertInstance(ref: string, screen?: { sx: number; sy: number }): Promise<void> {
  const s = store.get();
  const cache = canvas.cache;
  if (!s.doc || !cache) return;
  const a = visibleArea();
  const p = toDoc(s.view, screen?.sx ?? a.x + a.width / 2, screen?.sy ?? a.y + a.height / 2);
  const selected = s.selection.length === 1 && isContainer(s.doc.get(s.selection[0])) ? s.selection[0] : null;
  const parent = screen ? containerAt(s.doc, cache.hit(p.x, p.y)) : selected;
  const parentNode = parent ? s.doc.get(parent) : undefined;
  const flow = !!parentNode && parentNode.type === 'frame' && parentNode.layout !== 'none';
  const at = toParent(parent, p);
  const pos = flow ? {} : { x: Math.round(at.x), y: Math.round(at.y) };
  const name = s.doc.get(ref)?.name ?? 'component';
  await insertNode(parent, { type: 'ref', ref, ...pos }, `Insert ${name}`);
}

/**
 * Put a new node of a known size where it was dropped (centred on a screen point), else into the selected
 * frame, else in the middle of the view; in a frame with a layout it joins the flow.
 */
export async function placeNode(node: Record<string, unknown>, label: string, screen?: { sx: number; sy: number }): Promise<string | undefined> {
  const s = store.get();
  const cache = canvas.cache;
  if (!s.doc || !cache) return undefined;
  const a = visibleArea();
  const p = toDoc(s.view, screen?.sx ?? a.x + a.width / 2, screen?.sy ?? a.y + a.height / 2);
  const selected = s.selection.length === 1 && isContainer(s.doc.get(s.selection[0])) ? s.selection[0] : null;
  const parent = screen ? containerAt(s.doc, cache.hit(p.x, p.y)) : selected;
  const parentNode = parent ? s.doc.get(parent) : undefined;
  const flow = !!parentNode && parentNode.type === 'frame' && parentNode.layout !== 'none';
  const origin = parent ? cache.box(parent) : undefined;
  const w = Number(node.width) || 0, h = Number(node.height) || 0;
  // Dropped or pasted into a frame without a point: its middle.
  const at = !screen && origin ? { x: origin.width / 2, y: origin.height / 2 } : toParent(parent, p);
  const pos = flow ? {} : { x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2) };
  return insertNode(parent, { ...node, ...pos }, label);
}

/** A document point in the space a child of `parent` (null: the canvas) is placed in. */
export function toParent(parent: string | null, p: P): P {
  const placed = parent ? canvas.cache?.placed(parent) : undefined;
  return placed ? apply(invert(placed.inner), p.x, p.y) : p;
}

/** Whether a file is a picture nib places as an image (SVG is imported as layers instead). */
export const isImageFile = (f: File) => /^image\/(png|jpe?g|webp|gif)$/.test(f.type) || /\.(png|jpe?g|webp|gif)$/i.test(f.name);

/**
 * Image files as rectangles filled with them, placed like `placeNode`: each is saved in images/ beside the
 * document and shown at its own size (the longest side at most 1000).
 */
export async function importImages(files: File[], screen?: { sx: number; sy: number }): Promise<void> {
  const { conn } = store.get();
  if (!conn) return;
  for (const f of files) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const r = await post<{ url: string; width: number; height: number }>('/api/asset', { path: conn.path, name: f.name || 'image.png', data: btoa(bin) });
      const k = Math.min(1, 1000 / Math.max(r.width, r.height));
      const name = (f.name || 'Image').replace(/\.[^.]+$/, '');
      const id = await placeNode({ type: 'rectangle', name, width: Math.round(r.width * k), height: Math.round(r.height * k), fill: { type: 'image', url: r.url, mode: 'cover' } }, `Place ${name}`, screen);
      if (id) store.set({ selection: [id] });
    } catch (e) {
      toast(`${f.name || 'Image'}: ${(e as Error).message}`);
    }
  }
}

/** Ask for image files and place them (SVG files come in as layers). */
export function pickImages(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg';
  input.multiple = true;
  input.onchange = () => {
    const files = [...(input.files ?? [])];
    for (const f of files) if (/\.svg$/i.test(f.name)) void f.text().then((text) => importSvg(text, undefined, f.name.replace(/\.svg$/i, '')));
    void importImages(files.filter(isImageFile));
  };
  input.click();
}

/** SVG markup as editable layers, placed like `placeNode`. */
export async function importSvg(text: string, screen?: { sx: number; sy: number }, name?: string): Promise<void> {
  const { doc } = store.get();
  if (!doc) return;
  const taken = new Set<string>();
  const id = () => { const i = newId(doc, taken); taken.add(i); return i; };
  try {
    const { node, skipped } = svgToNodes(text, id, name);
    const { id: _, ...rest } = node;
    await placeNode(rest, `Import ${String(node.name)}`, screen);
    const left = Object.entries(skipped).map(([k, n]) => `${n} ${k}`).join(', ');
    if (left) toast(`Imported the SVG's shapes; left out: ${left}.`);
  } catch (e) {
    toast(`SVG: ${(e as Error).message}`);
  }
}

export function CanvasView() {
  const host = useRef<HTMLDivElement>(null);
  const el = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<Gesture | undefined>(undefined);
  const space = useRef(false);

  useEffect(() => {
    let surface: Surface | null = null;
    let engine: Engine | undefined;
    let frame = 0;
    let disposed = false;
    let cacheDoc: PenDoc | undefined;
    const dpr = window.devicePixelRatio || 1;

    const draw = () => {
      frame = 0;
      if (!surface || !engine) return;
      const c = surface.getCanvas();
      c.clear(Float32Array.from(store.get().present ? [0, 0, 0, 1] : BACKGROUND[document.documentElement.dataset.theme === 'light' ? 'light' : 'dark']));
      const { view } = store.get();
      c.save();
      c.scale(dpr, dpr);
      c.translate(view.tx, view.ty);
      c.scale(view.zoom, view.zoom);
      canvas.cache?.draw(c, canvas.shift);
      c.restore();
      surface.flush();
      // Keep drawing while nodes fade in.
      if (canvas.cache?.animating()) canvas.redraw();
    };
    canvas.redraw = () => { if (!frame) frame = requestAnimationFrame(draw); };

    const makeSurface = () => {
      const node = el.current!;
      const { width, height } = host.current!.getBoundingClientRect();
      canvas.size = { width, height };
      node.width = Math.max(1, Math.round(width * dpr));
      node.height = Math.max(1, Math.round(height * dpr));
      surface?.delete();
      surface = engine!.ck.MakeWebGLCanvasSurface(node) ?? engine!.ck.MakeSWCanvasSurface(node);
      canvas.redraw();
    };

    /** A new document (first load or reload from disk): new scenes, framed in view the first time. */
    const attach = (doc: PenDoc, first: boolean) => {
      if (!engine || doc === cacheDoc) return;
      cacheDoc = doc;
      canvas.cache?.dispose();
      const { conn } = store.get();
      const cache = new SceneCache(engine, doc, imagesFor(conn!.path));
      cache.reveal = presence.reveal;
      canvas.cache = cache;
      cache.onUpdate = () => {
        store.set((s) => ({ layoutVersion: s.layoutVersion + 1 }));
        canvas.redraw();
      };
      // Frame the whole document at once from its stored sizes, then again with the laid-out boxes,
      // unless the view was moved meanwhile.
      let auto: View | undefined;
      if (first) { auto = fitView(storedBounds(doc)); store.set({ view: auto }); }
      void cache.rebuild().then(() => {
        if (auto && store.get().view === auto) store.set({ view: fitView(boundsOf()) });
      });
    };

    (async () => {
      engine = await getEngine();
      if (disposed) return;
      makeSurface();
      const { doc } = store.get();
      if (doc) attach(doc, true);
    })();

    // The connection is made by App after this effect runs (children's effects run first), and is
    // replaced when another file opens: follow whichever one the store holds.
    let conn: Connection | undefined;
    let offConn: (() => void) | undefined;
    const follow = (next: Connection | undefined) => {
      if (next === conn) return;
      offConn?.();
      conn = next;
      offConn = next?.on((e) => {
        if (e.t === 'change' && canvas.cache && store.get().doc) {
          // An agent's change plays out: its cursor visits each node and new nodes fade in (not for undo and redo).
          // It starts once the change is laid out (fonts may still be loading).
          const { source, label, ops } = e.change;
          const play = source.kind === 'agent' && !/^(Undo|Redo) /.test(label) ? presence.add(source.name, ops) : undefined;
          const built = canvas.cache.invalidate(ops);
          if (play) void built.finally(() => play(performance.now()));
          pruneSelection(store.get().doc!);
        }
        if (e.t === 'asset') canvas.cache?.refreshImage(e.url);
      });
    };
    follow(store.get().conn);
    const offStore = store.subscribe(() => {
      const s = store.get();
      follow(s.conn);
      if (s.doc && s.doc !== cacheDoc) attach(s.doc, !cacheDoc);
      canvas.redraw();
    });
    const ro = new ResizeObserver(() => engine && makeSurface());
    ro.observe(host.current!);
    return () => {
      disposed = true;
      offStore();
      offConn?.();
      ro.disconnect();
      cancelAnimationFrame(frame);
      surface?.delete();
      canvas.cache?.dispose();
      canvas.cache = undefined;
    };
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !isTyping(e)) { space.current = true; host.current?.classList.add('panning'); } };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') { space.current = false; host.current?.classList.remove('panning'); }
      if (e.key === 'Alt' && canvas.measures.length) { canvas.measures = []; forceOverlay(); }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = host.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  const onWheel = (e: React.WheelEvent) => {
    canvas.userViewAt = performance.now();
    const { view } = store.get();
    const { sx, sy } = local(e);
    if (e.ctrlKey || e.metaKey) {
      // Pinch on a trackpad arrives as ctrl+wheel.
      const zoom = clamp(view.zoom * Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.002) * store.get().prefs.zoomSpeed), 0.02, 64);
      const p = toDoc(view, sx, sy);
      store.set({ view: { zoom, tx: sx - p.x * zoom, ty: sy - p.y * zoom } });
    } else {
      store.set({ view: { ...view, tx: view.tx - e.deltaX, ty: view.ty - e.deltaY } });
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const s = store.get();
    if (!s.doc || !canvas.cache) return;
    if (s.editingText) store.set({ editingText: undefined });
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const { sx, sy } = local(e);
    const p = toDoc(s.view, sx, sy);
    if (e.button === 1 || space.current || s.tool === 'hand') {
      gesture.current = { kind: 'pan', sx, sy, view: s.view };
      canvas.userViewAt = performance.now();
      return;
    }
    if (e.button !== 0) return;
    const chain = canvas.cache.hit(p.x, p.y);
    if (s.tool === 'pen') { penDown(p, e, containerAt(s.doc, chain)); return; }
    if (s.tool === 'pencil') {
      // No selection handles in the way while sketching.
      if (s.selection.length) store.set({ selection: [] });
      gesture.current = { kind: 'sketch', points: [p], parent: containerAt(s.doc, chain), width: sketchWidth(s.view.zoom) };
      return;
    }
    // A press on the canvas (not on a point or handle) ends point editing.
    if (s.pen?.mode === 'edit') finishEditing();
    // The scale tool selects and moves like the move tool; only its handles differ.
    if (s.tool !== 'move' && s.tool !== 'scale') {
      const parent = containerAt(s.doc, chain);
      const start = e.metaKey || e.ctrlKey ? p : snapPoint(p, snapTargets(s.doc, parent, []), SNAP_PX / s.view.zoom);
      gesture.current = { kind: 'create', tool: s.tool, start: { x: start.x, y: start.y }, end: { x: start.x, y: start.y }, parent };
      return;
    }
    const target = pick(s.doc, chain, s.selection, e.metaKey || e.ctrlKey);
    if (!target) {
      if (!e.shiftKey) store.set({ selection: [] });
      gesture.current = { kind: 'marquee', start: p, end: p, add: e.shiftKey ? s.selection : [] };
      return;
    }
    let selection = s.selection;
    if (e.shiftKey) selection = selection.includes(target) ? selection.filter((id) => id !== target) : [...selection, target];
    else if (!selection.includes(target)) selection = [target];
    store.set({ selection });
    gesture.current = { kind: 'press', start: p, sx, sy, ids: selection };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = store.get();
    if (!canvas.cache || !s.doc) return;
    const { sx, sy } = local(e);
    const p = toDoc(s.view, sx, sy);
    const g = gesture.current;
    if (!g) {
      if (s.tool === 'pen') { penHover(p, e.shiftKey); return; }
      if ((s.tool === 'move' || s.tool === 'scale') && !space.current) {
        const hover = pick(s.doc, canvas.cache.hit(p.x, p.y), s.selection, e.metaKey || e.ctrlKey);
        if (hover !== s.hover) store.set({ hover });
        // Alt: distances from the selection to the layer under the pointer, or to its parent.
        const before = canvas.measures.length;
        canvas.measures = e.altKey ? measuresTo(s.doc, s.selection, hover) : [];
        if (before || canvas.measures.length) forceOverlay();
      }
      return;
    }
    switch (g.kind) {
      case 'pan':
        store.set({ view: { ...g.view, tx: g.view.tx + sx - g.sx, ty: g.view.ty + sy - g.sy } });
        break;
      case 'press':
        if (Math.hypot(sx - g.sx, sy - g.sy) < DRAG_THRESHOLD) break;
        gesture.current = { kind: 'drag', start: g.start, end: p, ids: g.ids.filter((id) => s.doc!.has(id)) };
        break;
      case 'drag': {
        let dx = p.x - g.start.x, dy = p.y - g.start.y;
        // Shift keeps the move on one axis.
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        canvas.guides = [];
        const free = g.ids.filter((id) => isFree(s.doc!, id));
        if (free.length && !e.metaKey && !e.ctrlKey) {
          const boxes = free.map((id) => canvas.cache!.bounds(id)).filter((b): b is Box => !!b);
          if (boxes.length) {
            const u = unionOf(boxes);
            const parent = s.doc.locate(free[0])?.parent?.id ?? null;
            const r = snap({ ...u, x: u.x + dx, y: u.y + dy }, snapTargets(s.doc, parent, g.ids), SNAP_PX / s.view.zoom, { x: e.shiftKey && !dx ? [] : ['start', 'center', 'end'], y: e.shiftKey && !dy ? [] : ['start', 'center', 'end'] });
            dx += r.dx; dy += r.dy;
            canvas.guides = r.guides;
          }
        }
        g.end = { x: g.start.x + dx, y: g.start.y + dy };
        canvas.shift.clear();
        for (const id of g.ids) if (!s.doc.locate(id)?.parent) canvas.shift.set(id, { dx, dy });
        canvas.redraw();
        break;
      }
      case 'marquee':
        g.end = p;
        break;
      case 'sketch': {
        const last = g.points[g.points.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) * s.view.zoom >= 1.5) g.points.push(p);
        break;
      }
      case 'create': {
        const r = e.metaKey || e.ctrlKey ? { ...p, guides: [] } : snapPoint(p, snapTargets(s.doc, g.parent, []), SNAP_PX / s.view.zoom);
        g.end = { x: r.x, y: r.y };
        canvas.guides = r.guides;
        break;
      }
      case 'resize': {
        // In the node's own coordinates, so a turned node resizes along its own sides.
        const q = apply(invert(g.matrix), p.x, p.y);
        g.end = q;
        g.shift = e.shiftKey;
        canvas.guides = [];
        const b = resizedBox(g);
        if (b && isAxisAligned(g.matrix) && !e.metaKey && !e.ctrlKey) {
          // Only the edges the handle moves snap.
          const which: Lines = { x: g.handle.includes('w') ? ['start'] : g.handle.includes('e') ? ['end'] : [], y: g.handle.includes('n') ? ['start'] : g.handle.includes('s') ? ['end'] : [] };
          const parent = s.doc.locate(g.id)?.parent?.id ?? null;
          const r = snap({ ...b, x: b.x + g.matrix[4], y: b.y + g.matrix[5] }, snapTargets(s.doc, parent, [g.id]), SNAP_PX / s.view.zoom, which);
          g.end = { x: q.x + r.dx, y: q.y + r.dy };
          canvas.guides = r.guides;
        }
        break;
      }
      case 'rotate': {
        // Screen angles grow clockwise (y points down); .pen rotation is counter-clockwise. The node turns as
        // far as the pointer has turned around its centre since the handle was pressed.
        const pointer = (Math.atan2(p.y - g.center.y, p.x - g.center.x) * 180) / Math.PI;
        let angle = g.start + (g.from - pointer);
        angle = ((angle % 360) + 540) % 360 - 180;
        if (e.shiftKey) angle = Math.round(angle / 15) * 15;
        g.angle = angle;
        g.shift = e.shiftKey;
        break;
      }
    }
    forceOverlay();
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = undefined;
    const s = store.get();
    if (!g || !s.doc || !canvas.cache) return;
    if (g.kind === 'drag') finishDrag(s.doc, g);
    else if (g.kind === 'marquee') {
      const r = rectOf(g.start, g.end);
      if (r.width > 1 || r.height > 1) store.set({ selection: [...new Set([...g.add, ...canvas.cache.within(r, 0)])] });
    } else if (g.kind === 'create') void finishCreate(s.doc, g);
    else if (g.kind === 'sketch') void finishSketch(g.points, g.parent, g.width);
    else if (g.kind === 'resize') finishResize(s.doc, g);
    else if (g.kind === 'rotate') finishRotate(s.doc, g);
    canvas.shift.clear();
    canvas.guides = [];
    canvas.redraw();
    forceOverlay();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const s = store.get();
    if (!s.doc || !canvas.cache) return;
    const { sx, sy } = local(e);
    const p = toDoc(s.view, sx, sy);
    const chain = canvas.cache.hit(p.x, p.y);
    if (s.tool === 'pen') return;
    const current = s.selection.find((id) => chain.includes(id));
    const i = current ? chain.indexOf(current) : -1;
    if (current && layerOf(s.doc, current)?.type === 'text') { store.set({ editingText: current }); return; }
    if (current && s.doc.get(current)?.type === 'path' && editPath(current)) return;
    if (current && imageFillIndex(s.doc.get(current)) >= 0) { store.set({ crop: { id: current, index: imageFillIndex(s.doc.get(current)) } }); return; }
    if (i === 0 && s.doc.get(chain[0])?.type === 'path' && editPath(chain[0])) return;
    if (i > 0) store.set({ selection: [chain[i - 1]] });
    else if (i === 0 && layerOf(s.doc, chain[0])?.type === 'text') store.set({ editingText: chain[0] });
  };

  const forceOverlayRef = useRef(() => {});
  const forceOverlay = () => forceOverlayRef.current();

  return (
    <div ref={host} className={`canvas tool-${store.get().tool}`} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onDoubleClick={onDoubleClick} onPointerLeave={() => store.get().hover && store.set({ hover: undefined })}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(COMPONENT_MIME) || e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
      onDrop={(e) => {
        const ref = e.dataTransfer.getData(COMPONENT_MIME);
        if (ref) { e.preventDefault(); void insertInstance(ref, local(e)); return; }
        const files = [...e.dataTransfer.files];
        if (!files.length) return;
        e.preventDefault();
        const at = local(e);
        for (const f of files) if (/\.svg$/i.test(f.name) || f.type === 'image/svg+xml') void f.text().then((text) => importSvg(text, at, f.name.replace(/\.svg$/i, '')));
        const images = files.filter(isImageFile);
        if (images.length) void importImages(images, at);
        const fonts = files.filter(isFontFile);
        if (fonts.length) void addFontFiles(fonts);
      }}>
      <canvas ref={el} />
      <AgentCursors />
      <Overlay gesture={gesture} register={(f) => { forceOverlayRef.current = f; }} startResize={(handle) => {
        const s = store.get();
        const placed = canvas.cache?.placed(s.selection[0]);
        if (!placed) return;
        gesture.current = { kind: 'resize', id: s.selection[0], handle, box: { x: 0, y: 0, width: placed.abs.width, height: placed.abs.height }, matrix: placed.matrix, start: { x: 0, y: 0 }, end: undefined, shift: false, scale: s.tool === 'scale' };
      }} startRotate={(from) => {
        const s = store.get();
        const placed = canvas.cache?.placed(s.selection[0]);
        if (!placed) return;
        const r = s.doc?.get(s.selection[0])?.rotation;
        const start = typeof r === 'number' ? r : 0;
        const { width: w, height: h } = placed.abs;
        const center = apply(placed.matrix, w / 2, h / 2);
        gesture.current = { kind: 'rotate', id: s.selection[0], w, h, center, matrix: placed.matrix, from: (Math.atan2(from.y - center.y, from.x - center.x) * 180) / Math.PI, start, angle: start, shift: false };
      }} />
    </div>
  );
}

function finishDrag(doc: PenDoc, g: Extract<Gesture, { kind: 'drag' }>): void {
  const dx = Math.round(g.end.x - g.start.x), dy = Math.round(g.end.y - g.start.y);
  if (!dx && !dy) return;
  const free = g.ids.filter((id) => isFree(doc, id));
  const flow = g.ids.filter((id) => !isFree(doc, id));
  void commit('Move', (ed) => {
    for (const id of free) {
      const n = doc.get(id)!;
      // The move on screen, in the space the node's x/y are in (its parent may be turned or mirrored).
      const placed = canvas.cache?.placed(id);
      const d = placed ? applyLinear(invert(placed.parent), dx, dy) : { x: dx, y: dy };
      ed.set(id, { x: Math.round((n.x ?? 0) + d.x), y: Math.round((n.y ?? 0) + d.y) });
    }
    // Nodes in a flex flow move to the position among their siblings nearest the pointer.
    if (flow.length === 1) {
      const id = flow[0];
      const at = doc.locate(id)!;
      const parent = at.parent!;
      const vertical = (parent as { layout?: string }).layout === 'vertical';
      const siblings = doc.siblings(parent).filter((n) => n.id !== id && n.layoutPosition !== 'absolute' && n.enabled !== false);
      const centre = (b: Box) => (vertical ? b.y + b.height / 2 : b.x + b.width / 2);
      const pos = vertical ? g.end.y : g.end.x;
      let index = siblings.findIndex((n) => { const b = canvas.cache!.box(n.id); return !!b && pos < centre(b); });
      if (index < 0) index = siblings.length;
      const target = index < siblings.length ? doc.siblings(parent).indexOf(siblings[index]) : doc.siblings(parent).length;
      const current = at.index;
      const final = target > current ? target - 1 : target;
      if (final !== current) ed.move(id, parent, final);
    }
  });
}

async function finishCreate(doc: PenDoc, g: Extract<Gesture, { kind: 'create' }>): Promise<void> {
  const r = rectOf(g.start, g.end);
  const dragged = r.width > 2 || r.height > 2;
  const parent = g.parent;
  const parentNode = parent ? doc.get(parent) : undefined;
  const flow = !!parentNode && parentNode.type === 'frame' && parentNode.layout !== 'none';
  const at = toParent(parent, r);
  const pos = { x: Math.round(at.x), y: Math.round(at.y) };
  const size = (w: number, h: number) => (dragged ? { width: Math.round(r.width), height: Math.round(r.height) } : { width: w, height: h });
  const place = flow ? {} : pos;
  const names: Record<string, string> = { frame: 'Frame', rectangle: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', icon: 'Icon', text: 'Text', note: 'Note' };
  let node: Record<string, unknown>;
  switch (g.tool) {
    case 'frame': node = { type: 'frame', ...place, ...size(400, 300), layout: 'none', fill: '#FFFFFF', clip: true }; break;
    case 'rectangle': node = { type: 'rectangle', ...place, ...size(100, 100), fill: '#D9D9D9' }; break;
    case 'ellipse': node = { type: 'ellipse', ...place, ...size(100, 100), fill: '#D9D9D9' }; break;
    case 'polygon': node = { type: 'polygon', ...place, ...size(100, 100), polygonCount: 6, fill: '#D9D9D9' }; break;
    case 'icon': node = { type: 'icon', ...place, ...size(24, 24), library: 'lucide', icon: 'star', fill: '#111111' }; break;
    case 'note': node = { type: 'note', ...place, ...size(200, 120), content: '' }; break;
    case 'text': node = { type: 'text', ...place, ...(dragged ? { textGrowth: 'fixed-width', width: Math.round(r.width) } : {}), content: 'Text', fontFamily: 'Inter', fontSize: 16, fill: '#000000' }; break;
    default: return;
  }
  const id = await insertNode(parent, { type: node.type, name: names[g.tool], ...node }, `Insert ${names[g.tool]?.toLowerCase()}`);
  if (id && g.tool === 'text') store.set({ editingText: id });
}

function finishResize(doc: PenDoc, g: Extract<Gesture, { kind: 'resize' }>): void {
  const b = resizedBox(g);
  if (!b) return;
  const node = doc.get(g.id);
  if (!node) return;
  const props: Record<string, unknown> = { width: Math.round(b.width), height: Math.round(b.height) };
  if (g.scale) {
    // Everything inside scales too; the node's own corner moves as the handle chose.
    const k = b.width / g.box.width;
    const tree = scaleTree(node, k);
    const d = applyLinear(placement(0, 0, typeof node.rotation === 'number' ? node.rotation : 0), b.x, b.y);
    const own = { ...tree.get(g.id), ...(isFree(doc, g.id) ? { x: Math.round(((node.x ?? 0) + d.x) * 100) / 100, y: Math.round(((node.y ?? 0) + d.y) * 100) / 100 } : {}) };
    tree.set(g.id, own);
    void commit('Scale', (ed) => { for (const [id, p] of tree) ed.set(id, p); });
    return;
  }
  if (isFree(doc, g.id)) {
    // The top-left corner moved along the node's own sides.
    const d = applyLinear(placement(0, 0, typeof node.rotation === 'number' ? node.rotation : 0), b.x, b.y);
    props.x = Math.round((node.x ?? 0) + d.x);
    props.y = Math.round((node.y ?? 0) + d.y);
  }
  if (node.type === 'text') {
    // Dragging a text box's height fixes both sides; its width alone makes it wrap.
    props.textGrowth = g.handle.includes('n') || g.handle.includes('s') ? 'fixed-width-height' : 'fixed-width';
    if (props.textGrowth === 'fixed-width') delete props.height;
  }
  void commit('Resize', (ed) => ed.set(g.id, props));
}

/**
 * Set the rotation a rotate gesture chose. `.pen` rotates around the top-left corner; nodes placed by
 * x/y also move so that their centre stays where it was, as people expect when turning a shape.
 */
function finishRotate(doc: PenDoc, g: Extract<Gesture, { kind: 'rotate' }>): void {
  const node = doc.get(g.id);
  if (!node || Math.abs(g.angle - g.start) < 0.01) return;
  const props: Record<string, unknown> = { rotation: Math.round(g.angle * 10) / 10 || undefined };
  if (isFree(doc, g.id)) {
    const { w, h } = g;
    // Centre of a w×h box rotated by a (counter-clockwise on screen) about its top-left corner.
    const centre = (deg: number) => { const a = (deg * Math.PI) / 180; return { x: (w / 2) * Math.cos(a) + (h / 2) * Math.sin(a), y: -(w / 2) * Math.sin(a) + (h / 2) * Math.cos(a) }; };
    const before = centre(g.start), after = centre(g.angle);
    props.x = Math.round((node.x ?? 0) + before.x - after.x);
    props.y = Math.round((node.y ?? 0) + before.y - after.y);
  }
  void commit('Rotate', (ed) => ed.set(g.id, props));
}

/** The box a resize gesture would give, in the node's own coordinates (its top-left corner was at 0, 0). */
export function resizedBox(g: Extract<Gesture, { kind: 'resize' }>): Box | undefined {
  if (!g.end) return undefined;
  let { x, y, width, height } = g.box;
  const right = x + width, bottom = y + height;
  if (g.handle.includes('w')) { x = Math.min(g.end.x, right - 1); width = right - x; }
  if (g.handle.includes('e')) width = Math.max(1, g.end.x - x);
  if (g.handle.includes('n')) { y = Math.min(g.end.y, bottom - 1); height = bottom - y; }
  if (g.handle.includes('s')) height = Math.max(1, g.end.y - y);
  if (g.scale && g.box.width && g.box.height) {
    // The scale tool keeps proportions: the side the handle moves sets the size, the opposite side (or, from an
    // edge handle, the middle of the other axis) stays.
    const k = g.handle.includes('e') || g.handle.includes('w') ? width / g.box.width : height / g.box.height;
    width = g.box.width * k;
    height = g.box.height * k;
    x = g.handle.includes('w') ? right - width : g.handle.includes('e') ? g.box.x : g.box.x + (g.box.width - width) / 2;
    y = g.handle.includes('n') ? bottom - height : g.handle.includes('s') ? g.box.y : g.box.y + (g.box.height - height) / 2;
    return { x, y, width, height };
  }
  if (g.shift && g.box.width && g.box.height) {
    const ratio = g.box.width / g.box.height;
    if (g.handle.length === 2) height = width / ratio;
    if (g.handle.includes('n')) y = bottom - height;
  }
  return { x, y, width, height };
}

/** Distances from the selection to layer `to`, or (pointing at nothing or the selection itself) to its parent. */
function measuresTo(doc: PenDoc, selection: string[], to: string | undefined): Measure[] {
  const cache = canvas.cache;
  if (!cache || !selection.length) return [];
  const boxes = selection.map((id) => cache.bounds(id)).filter((b): b is Box => !!b);
  if (!boxes.length) return [];
  const target = to && !selection.includes(to) ? to : doc.locate(selection[0])?.parent?.id;
  const b = target ? cache.bounds(target) : undefined;
  return b ? measure(unionOf(boxes), b) : [];
}

export function rectOf(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
};
