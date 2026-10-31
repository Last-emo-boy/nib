import { newId } from '@nib/core';
import type { Node } from '@nib/format';
import { commit } from '../app/actions.ts';
import { store, toast } from '../app/store.ts';
import { canvas } from './Canvas.tsx';

/**
 * Masks, kept within the .pen format: the bottom layer of the selection becomes a clipping frame of its shape,
 * holding the other layers. The frame remembers the shape (metadata `nib-mask`) so the mask can be released.
 * Shapes a frame can take: rectangles and frames (with their corner radius) and circles.
 */

type N = Record<string, any>;

export const isMask = (n: unknown): boolean => (n as N | undefined)?.metadata?.type === 'nib-mask';

/** The corner radius of a frame clipping to `n`, or why `n` cannot be a mask. */
function maskRadius(n: N, w: number, h: number): number | number[] | string {
  if (n.rotation) return 'a mask cannot be rotated';
  if (n.type === 'rectangle' || n.type === 'frame') return n.cornerRadius ?? 0;
  if (n.type === 'ellipse') return Math.abs(w - h) < 0.5 && !n.innerRadius && n.sweepAngle === undefined ? w / 2 : 'only circles, not ellipses, can be masks';
  return 'use a rectangle, frame or circle as the mask';
}

/** Mask the selection with its bottom layer. */
export function maskSelection(): void {
  const { selection, doc } = store.get();
  const cache = canvas.cache;
  if (!doc || !cache || selection.length < 2) { toast('Select a shape and the layers to show through it'); return; }
  const at = selection.map((id) => doc.locate(id)).filter((a) => !!a).sort((a, b) => a.index - b.index);
  const parent = at[0].parent;
  if (at.some((a) => a.parent !== parent)) { toast('Select layers with the same parent'); return; }
  const mask = at[0].node as N;
  const mb = cache.box(mask.id);
  if (!mb) return;
  const radius = maskRadius(mask, mb.width, mb.height);
  if (typeof radius === 'string') { toast(`Mask: ${radius}`); return; }
  const free = !parent || (parent as N).layout === 'none' || parent.type === 'group';
  const id = newId(doc);
  void commit('Mask', (ed) => {
    const frame = {
      type: 'frame', id, name: mask.name ?? 'Mask',
      ...(free ? { x: mask.x ?? 0, y: mask.y ?? 0 } : {}),
      width: typeof mask.width === 'number' ? mask.width : mb.width, height: typeof mask.height === 'number' ? mask.height : mb.height,
      ...(radius ? { cornerRadius: radius } : {}),
      clip: true, layout: 'none', metadata: { type: 'nib-mask', mask: structuredClone(mask) }, children: [],
    } as unknown as Node;
    const index = at[0].index;
    const placed = at.slice(1).map((a) => ({ node: ed.remove(a.node.id), box: cache.box(a.node.id) }));
    ed.remove(mask.id);
    ed.insert(parent, frame, index);
    for (const { node, box } of placed) {
      ed.insert(frame, node);
      // Where it was, now inside the frame.
      const x = free ? (node.x ?? 0) - (mask.x ?? 0) : (box?.x ?? mb.x) - mb.x;
      const y = free ? (node.y ?? 0) - (mask.y ?? 0) : (box?.y ?? mb.y) - mb.y;
      ed.set(node.id, { x, y });
    }
  });
  store.set({ selection: [id] });
}

/** Turn a mask frame back into its shape and the layers it held. */
export function releaseMask(): void {
  const { selection, doc } = store.get();
  if (!doc) return;
  const targets = selection.filter((id) => isMask(doc.get(id)));
  if (!targets.length) { toast('Select a mask to release'); return; }
  const out: string[] = [];
  void commit('Release mask', (ed) => {
    for (const fid of targets) {
      const a = doc.locate(fid);
      if (!a) continue;
      const f = a.node as N;
      const free = !a.parent || (a.parent as N).layout === 'none' || a.parent.type === 'group';
      const ox = f.x ?? 0, oy = f.y ?? 0;
      const shape = { ...structuredClone(f.metadata.mask), width: f.width, height: f.height, ...(free ? { x: ox, y: oy } : {}) } as N;
      if (doc.has(shape.id)) shape.id = newId(doc);
      const kids = ((f.children ?? []) as N[]).map((k) => k.id);
      const moved = kids.map((k) => ed.remove(k));
      ed.remove(fid);
      ed.insert(a.parent, shape as unknown as Node, a.index);
      moved.forEach((n, i) => {
        ed.insert(a.parent, n, a.index + 1 + i);
        ed.set(n.id, free ? { x: (n.x ?? 0) + ox, y: (n.y ?? 0) + oy } : {});
      });
      out.push(shape.id, ...kids);
    }
  });
  store.set({ selection: out });
}
