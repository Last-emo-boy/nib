import { useEffect, useRef } from 'react';
import type { Surface } from 'canvaskit-wasm';
import type { PenDoc } from '@nib/core';
import type { Box } from '@nib/layout';
import { commit, insertNode, isContainer, isFree, pruneSelection } from '../app/actions.ts';
import { store, type View } from '../app/store.ts';
import { getEngine, imagesFor, type Engine } from './engine.ts';
import { Overlay, type Gesture } from './Overlay.tsx';
import { SceneCache } from './scenes.ts';

/** What other parts of the editor need from the canvas. */
export const canvas = {
  cache: undefined as SceneCache | undefined,
  /** Top-level nodes drawn shifted while they are dragged. */
  shift: new Map<string, { dx: number; dy: number }>(),
  redraw: () => {},
  size: { width: 0, height: 0 },
};

export const toDoc = (v: View, sx: number, sy: number) => ({ x: (sx - v.tx) / v.zoom, y: (sy - v.ty) / v.zoom });

const BACKGROUND = [0.075, 0.075, 0.08, 1] as const;
const DRAG_THRESHOLD = 3;

/** The part of the canvas not covered by panels, in screen pixels. */
function visibleArea() {
  const { width, height } = canvas.size;
  const left = store.get().leftOpen ? 338 : 66;
  const right = width > 900 ? 288 : 10;
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
  const boxes = (ids ?? doc.data.children.map((n) => n.id)).map((id) => cache.box(id)).filter((b): b is Box => !!b);
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
  for (const id of selection) {
    const parent = doc.locate(id)?.parent?.id;
    const i = parent ? chain.indexOf(parent) : -1;
    if (i > 0) return chain[i - 1];
  }
  return chain.length >= 2 ? chain[chain.length - 2] : chain[0];
}

/** The frame a new node drawn at a point goes into: the deepest frame under it. */
function containerAt(doc: PenDoc, chain: string[]): string | null {
  for (const id of chain) if (isContainer(doc.get(id)) && doc.get(id)?.type === 'frame') return id;
  return null;
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
      c.clear(Float32Array.from(BACKGROUND));
      const { view } = store.get();
      c.save();
      c.scale(dpr, dpr);
      c.translate(view.tx, view.ty);
      c.scale(view.zoom, view.zoom);
      canvas.cache?.draw(c, canvas.shift);
      c.restore();
      surface.flush();
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

    const offStore = store.subscribe(() => {
      const s = store.get();
      if (s.doc && s.doc !== cacheDoc) attach(s.doc, !cacheDoc);
      canvas.redraw();
    });
    const offConn = store.get().conn?.on((e) => {
      if (e.t === 'change' && canvas.cache && store.get().doc) {
        canvas.cache.invalidate(e.change.ops);
        pruneSelection(store.get().doc!);
      }
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
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') { space.current = false; host.current?.classList.remove('panning'); } };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = host.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  const onWheel = (e: React.WheelEvent) => {
    const { view } = store.get();
    const { sx, sy } = local(e);
    if (e.ctrlKey || e.metaKey) {
      // Pinch on a trackpad arrives as ctrl+wheel.
      const zoom = clamp(view.zoom * Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.002)), 0.02, 64);
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
      return;
    }
    if (e.button !== 0) return;
    const chain = canvas.cache.hit(p.x, p.y);
    if (s.tool !== 'move') {
      gesture.current = { kind: 'create', tool: s.tool, start: p, end: p, parent: containerAt(s.doc, chain) };
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
      if (s.tool === 'move' && !space.current) {
        const hover = pick(s.doc, canvas.cache.hit(p.x, p.y), s.selection, e.metaKey || e.ctrlKey);
        if (hover !== s.hover) store.set({ hover });
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
        g.end = p;
        canvas.shift.clear();
        for (const id of g.ids) if (!s.doc.locate(id)?.parent) canvas.shift.set(id, { dx: p.x - g.start.x, dy: p.y - g.start.y });
        canvas.redraw();
        break;
      }
      case 'marquee':
      case 'create':
        g.end = p;
        break;
      case 'resize':
        g.end = p;
        g.shift = e.shiftKey;
        break;
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
    else if (g.kind === 'resize') finishResize(s.doc, g);
    canvas.shift.clear();
    canvas.redraw();
    forceOverlay();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const s = store.get();
    if (!s.doc || !canvas.cache) return;
    const { sx, sy } = local(e);
    const p = toDoc(s.view, sx, sy);
    const chain = canvas.cache.hit(p.x, p.y);
    const current = s.selection.find((id) => chain.includes(id));
    const i = current ? chain.indexOf(current) : -1;
    if (current && s.doc.get(current)?.type === 'text') { store.set({ editingText: current }); return; }
    if (i > 0) store.set({ selection: [chain[i - 1]] });
    else if (i === 0 && s.doc.get(chain[0])?.type === 'text') store.set({ editingText: chain[0] });
  };

  const forceOverlayRef = useRef(() => {});
  const forceOverlay = () => forceOverlayRef.current();

  return (
    <div ref={host} className={`canvas tool-${store.get().tool}`} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onDoubleClick={onDoubleClick} onPointerLeave={() => store.get().hover && store.set({ hover: undefined })}>
      <canvas ref={el} />
      <Overlay gesture={gesture} register={(f) => { forceOverlayRef.current = f; }} startResize={(handle, box) => {
        const s = store.get();
        gesture.current = { kind: 'resize', id: s.selection[0], handle, box, start: { x: 0, y: 0 }, end: undefined, shift: false };
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
      ed.set(id, { x: Math.round((n.x ?? 0) + dx), y: Math.round((n.y ?? 0) + dy) });
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
  const parentBox = parent ? canvas.cache?.box(parent) : undefined;
  const flow = !!parentNode && parentNode.type === 'frame' && parentNode.layout !== 'none';
  const pos = parentBox ? { x: Math.round(r.x - parentBox.x), y: Math.round(r.y - parentBox.y) } : { x: Math.round(r.x), y: Math.round(r.y) };
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
  if (isFree(doc, g.id)) {
    props.x = Math.round((node.x ?? 0) + (b.x - g.box.x));
    props.y = Math.round((node.y ?? 0) + (b.y - g.box.y));
  }
  if (node.type === 'text') {
    // Dragging a text box's height fixes both sides; its width alone makes it wrap.
    props.textGrowth = g.handle.includes('n') || g.handle.includes('s') ? 'fixed-width-height' : 'fixed-width';
    if (props.textGrowth === 'fixed-width') delete props.height;
  }
  void commit('Resize', (ed) => ed.set(g.id, props));
}

/** The box a resize gesture would give, in document coordinates. */
export function resizedBox(g: Extract<Gesture, { kind: 'resize' }>): Box | undefined {
  if (!g.end) return undefined;
  let { x, y, width, height } = g.box;
  const right = x + width, bottom = y + height;
  if (g.handle.includes('w')) { x = Math.min(g.end.x, right - 1); width = right - x; }
  if (g.handle.includes('e')) width = Math.max(1, g.end.x - x);
  if (g.handle.includes('n')) { y = Math.min(g.end.y, bottom - 1); height = bottom - y; }
  if (g.handle.includes('s')) height = Math.max(1, g.end.y - y);
  if (g.shift && g.box.width && g.box.height) {
    const ratio = g.box.width / g.box.height;
    if (g.handle.length === 2) height = width / ratio;
    if (g.handle.includes('n')) y = bottom - height;
  }
  return { x, y, width, height };
}

export function rectOf(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
};
