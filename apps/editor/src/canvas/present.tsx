import { useEffect, useRef, useState } from 'react';
import type { View } from '../app/store.ts';
import { store, useEditor } from '../app/store.ts';
import { isSlide, readingOrder } from '../app/slides.ts';
import { canvas } from './Canvas.tsx';
import { ease } from './presence.ts';

/**
 * Present mode: the canvas fills the screen and shows one slide at a time, fitted, with everything around it
 * dark. It is the live canvas, so changes (an agent's too) show while presenting.
 */

export type Transition = 'instant' | 'dissolve' | 'move';

/** The slides of the open design, in reading order. */
export function slideIds(): string[] {
  const { doc } = store.get();
  const cache = canvas.cache;
  if (!doc || !cache) return [];
  const items = doc.data.children.filter((n) => isSlide(doc, n) && n.enabled !== false).map((n) => ({ id: n.id, box: cache.bounds(n.id) })).filter((i) => !!i.box) as { id: string; box: NonNullable<ReturnType<typeof cache.bounds>> }[];
  return readingOrder(items);
}

/** What presenting replaced, put back when it ends. */
let before: { view: View; selection: string[]; leftOpen: boolean } | undefined;

/** Present from slide `from` (default: the selected slide, else the first). */
export function startPresenting(from?: string): void {
  const s = store.get();
  const ids = slideIds();
  if (!ids.length) return;
  const selected = s.selection.map((id) => s.doc?.topLevel(id)?.id).find((id) => id && ids.includes(id));
  const index = Math.max(0, ids.indexOf(from ?? selected ?? ids[0]));
  before = { view: s.view, selection: s.selection, leftOpen: s.leftOpen };
  store.set({ present: { ids, index }, selection: [], hover: undefined, editingText: undefined, pen: undefined, crop: undefined, gradientEdit: undefined });
  void document.documentElement.requestFullscreen?.().catch(() => {});
  requestAnimationFrame(() => fit(ids[index]));
}

export function stopPresenting(): void {
  if (!store.get().present) return;
  store.set({ present: undefined, ...(before ?? {}) });
  before = undefined;
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
}

/** The view showing slide `id` as large as the screen allows, centred. */
function fitView(id: string): View | undefined {
  const b = canvas.cache?.bounds(id);
  const host = document.querySelector('.canvas')?.getBoundingClientRect();
  if (!b || !host || !b.width || !b.height) return undefined;
  const zoom = Math.min(host.width / b.width, host.height / b.height);
  return { zoom, tx: (host.width - b.width * zoom) / 2 - b.x * zoom, ty: (host.height - b.height * zoom) / 2 - b.y * zoom };
}

const fit = (id: string) => { const v = fitView(id); if (v) store.set({ view: v }); };

let animation = 0;
const reduced = () => document.documentElement.dataset.motion === 'reduced';

/** Show slide `index` (or frame `to`, given by a prototype link), with a transition. */
export function goTo(target: number | string, transition: Transition = 'instant'): void {
  const p = store.get().present;
  if (!p) return;
  const ids = typeof target === 'string' && !p.ids.includes(target) ? [...p.ids, target] : p.ids;
  const index = typeof target === 'string' ? ids.indexOf(target) : Math.max(0, Math.min(ids.length - 1, target));
  if (index === p.index && ids === p.ids) return;
  const next = fitView(ids[index]);
  if (!next) return;
  cancelAnimationFrame(animation);
  const kind = reduced() ? 'instant' : transition;
  if (kind === 'move') {
    // The view glides from this slide to the next across the canvas.
    const from = store.get().view, start = performance.now(), ms = 450;
    const step = (now: number) => {
      const t = ease(Math.min(1, (now - start) / ms));
      // Zoom moves in log space so the glide keeps a steady pace.
      const zoom = Math.exp(Math.log(from.zoom) + (Math.log(next.zoom) - Math.log(from.zoom)) * t);
      store.set({ view: { zoom, tx: from.tx + (next.tx - from.tx) * t, ty: from.ty + (next.ty - from.ty) * t } });
      if (t < 1) animation = requestAnimationFrame(step);
      else store.set({ present: { ids, index } });
    };
    // Both slides show while the view glides; the dark surround comes back when it arrives.
    store.set({ present: { ids, index, moving: true } });
    animation = requestAnimationFrame(step);
  } else if (kind === 'dissolve') {
    // Through black: the screen darkens, the slide changes, it lightens again.
    store.set({ present: { ...p, fading: true } });
    setTimeout(() => { store.set({ present: { ids, index, fading: false }, view: next }); }, 180);
  } else {
    store.set({ present: { ids, index }, view: next });
  }
}

/** On top of the canvas while presenting: the dark surround, the slide number, keys and clicks. */
export function Present({ onClick }: { onClick?: (x: number, y: number) => boolean }) {
  const present = useEditor((s) => s.present);
  const view = useEditor((s) => s.view);
  const [controls, setControls] = useState(false);
  const hide = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!present) return;
    const onKey = (e: KeyboardEvent) => {
      const p = store.get().present;
      if (!p) return;
      const k = e.key;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) goTo(p.index + 1);
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) goTo(p.index - 1);
      else if (k === 'Home') goTo(0);
      else if (k === 'End') goTo(p.ids.length - 1);
      else if (k === 'Escape') stopPresenting();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onResize = () => { const p = store.get().present; if (p) fit(p.ids[p.index]); };
    const onFullscreen = () => { if (!document.fullscreenElement) stopPresenting(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onResize); document.removeEventListener('fullscreenchange', onFullscreen); };
  }, [!!present]);
  if (!present) return null;
  const id = present.ids[present.index];
  const b = id ? canvas.cache?.bounds(id) : undefined;
  const r = b ? { x: b.x * view.zoom + view.tx, y: b.y * view.zoom + view.ty, w: b.width * view.zoom, h: b.height * view.zoom } : undefined;
  return (
    <div className={`present${controls ? ' show-controls' : ''}`}
      onPointerMove={() => { setControls(true); clearTimeout(hide.current); hide.current = setTimeout(() => setControls(false), 1800); }}
      onClick={(e) => {
        const host = (e.currentTarget as HTMLElement).getBoundingClientRect();
        if (onClick?.(e.clientX - host.left, e.clientY - host.top)) return;
        goTo(present.index + (e.shiftKey ? -1 : 1));
      }}>
      <svg width="100%" height="100%">
        {r && !present.moving && <path className="present-surround" fillRule="evenodd" d={`M-10 -10H100000V100000H-10Z M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}Z`} />}
      </svg>
      <div className={`present-fade${present.fading ? ' on' : ''}`} />
      <div className="present-controls" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => goTo(present.index - 1)} disabled={present.index === 0}>‹</button>
        <span>{present.index + 1} / {present.ids.length}</span>
        <button onClick={() => goTo(present.index + 1)} disabled={present.index >= present.ids.length - 1}>›</button>
        <button onClick={stopPresenting}>✕</button>
      </div>
    </div>
  );
}
