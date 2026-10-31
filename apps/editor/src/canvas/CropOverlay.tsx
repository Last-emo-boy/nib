import { useEffect, useState } from 'react';
import { commit } from '../app/actions.ts';
import { token } from '../app/connection.ts';
import { store, useEditor } from '../app/store.ts';
import { canvas } from './Canvas.tsx';
import { coverBox, cropFill, imageRect, type R } from './crop.ts';

/** The image fill being cropped: which node, which entry of its fills. */
export interface CropEdit { id: string; index: number }

type Fill = Record<string, any>;

const list = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Natural sizes of images by url, loaded once. */
const sizes = new Map<string, Promise<{ w: number; h: number }>>();
function naturalSize(src: string): Promise<{ w: number; h: number }> {
  let p = sizes.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight }); img.onerror = reject; img.src = src; });
    sizes.set(src, p);
  }
  return p;
}

/**
 * Crop mode: the whole image shows faintly around the node; drag it to move it, drag its corners to scale it
 * (keeping its proportions, always covering the node). The node keeps showing what falls inside it.
 */
export function CropOverlay() {
  const crop = useEditor((s) => s.crop);
  const doc = useEditor((s) => s.doc);
  const view = useEditor((s) => s.view);
  const conn = useEditor((s) => s.conn);
  useEditor((s) => s.version);
  useEditor((s) => s.layoutVersion);
  const [natural, setNatural] = useState<{ url: string; w: number; h: number } | undefined>();
  const [live, setLive] = useState<R | undefined>();
  const node = crop && doc ? (doc.get(crop.id) as Record<string, unknown> | undefined) : undefined;
  const fill = node && crop ? (list(node.fill)[crop.index] as Fill | undefined) : undefined;
  const src = fill?.type === 'image' && typeof fill.url === 'string' && conn ? `/api/image?${new URLSearchParams({ doc: conn.path, url: fill.url, t: token() })}` : undefined;
  useEffect(() => {
    if (!src || natural?.url === src) return;
    void naturalSize(src).then((s) => setNatural({ url: src, ...s }), () => store.set({ crop: undefined }));
  }, [src]);
  const box = crop ? canvas.cache?.box(crop.id) : undefined;
  if (!crop || !node || !fill || !src || !box || natural?.url !== src) return null;
  const r = live ?? imageRect(fill, natural.w, natural.h, box.width, box.height);
  const sx = (x: number) => (box.x + x) * view.zoom + view.tx, sy = (y: number) => (box.y + y) * view.zoom + view.ty;
  const screen = { x: sx(r.x), y: sy(r.y), width: r.width * view.zoom, height: r.height * view.zoom };
  const b = { x: sx(0), y: sy(0), width: box.width * view.zoom, height: box.height * view.zoom };

  const write = (next: R, merge: string) => {
    const value = node.fill;
    const all = list(value).map((x, i) => (i === crop.index ? cropFill(fill, next, box.width, box.height) : x));
    return commit('Crop image', (ed) => ed.set(crop.id, { fill: Array.isArray(value) ? all : all[0] }), merge);
  };
  const drag = (e: React.PointerEvent, change: (dx: number, dy: number, start: R) => R) => {
    e.stopPropagation();
    e.preventDefault();
    const start = { ...r };
    const merge = `crop:${crop.id}:${performance.now()}`;
    const x0 = e.clientX, y0 = e.clientY;
    let last: R | undefined, sent = 0;
    const move = (ev: PointerEvent) => {
      const z = store.get().view.zoom;
      last = coverBox(change((ev.clientX - x0) / z, (ev.clientY - y0) / z, start), box.width, box.height);
      setLive(last);
      if (performance.now() - sent > 60) { sent = performance.now(); void write(last, merge); }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (last) void write(last, merge).finally(() => setLive(undefined));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  /** A corner drag: the opposite corner stays, the image keeps its proportions. */
  const corner = (cx: 0 | 1, cy: 0 | 1) => (e: React.PointerEvent) => drag(e, (dx, dy, s) => {
    const ratio = s.width / s.height;
    let width = Math.max(4, s.width + (cx ? dx : -dx));
    let height = width / ratio;
    if (Math.abs(dy) > Math.abs(dx)) { height = Math.max(4, s.height + (cy ? dy : -dy)); width = height * ratio; }
    return { x: cx ? s.x : s.x + s.width - width, y: cy ? s.y : s.y + s.height - height, width, height };
  });
  const outside = `M${screen.x} ${screen.y}h${screen.width}v${screen.height}h${-screen.width}Z M${b.x} ${b.y}h${b.width}v${b.height}h${-b.width}Z`;
  return (
    <g className="crop">
      <defs><clipPath id="crop-outside"><path d={outside} clipRule="evenodd" /></clipPath></defs>
      <image href={src} x={screen.x} y={screen.y} width={screen.width} height={screen.height} preserveAspectRatio="none" opacity={0.4} clipPath="url(#crop-outside)" />
      <rect className="crop-image" x={screen.x} y={screen.y} width={screen.width} height={screen.height} onPointerDown={(e) => drag(e, (dx, dy, s) => ({ ...s, x: s.x + dx, y: s.y + dy }))} />
      <rect className="crop-box" x={b.x} y={b.y} width={b.width} height={b.height} />
      {([[0, 0], [1, 0], [0, 1], [1, 1]] as const).map(([cx, cy]) => (
        <rect key={`${cx}${cy}`} className="handle" x={screen.x + cx * screen.width - 5} y={screen.y + cy * screen.height - 5} width={10} height={10}
          style={{ cursor: cx === cy ? 'nwse-resize' : 'nesw-resize' }} onPointerDown={corner(cx, cy)} />
      ))}
    </g>
  );
}

// Selecting something else ends cropping.
store.subscribe(() => {
  const s = store.get();
  if (s.crop && (s.selection.length !== 1 || s.selection[0] !== s.crop.id)) store.set({ crop: undefined });
});
