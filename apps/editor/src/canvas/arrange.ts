import { commit, isFree } from '../app/actions.ts';
import { reorder, scaleTree, type Order } from '../app/geometry.ts';
import { store, toast } from '../app/store.ts';
import { canvas } from './Canvas.tsx';
import { apply, applyLinear, boundsOf, invert, placement } from './affine.ts';

/** Move the selected layers up or down among their siblings (each parent on its own). */
export function arrange(how: Order): void {
  const { selection, doc } = store.get();
  if (!doc || !selection.length) return;
  const parents = new Map<string | null, Set<string>>();
  for (const id of selection) {
    const at = doc.locate(id);
    if (!at) continue;
    const key = at.parent?.id ?? null;
    if (!parents.has(key)) parents.set(key, new Set());
    parents.get(key)!.add(id);
  }
  void commit({ forward: 'Bring forward', backward: 'Send backward', front: 'Bring to front', back: 'Send to back' }[how], (ed) => {
    for (const [pid, chosen] of parents) {
      const parent = pid ? doc.get(pid)! : null;
      const target = reorder(doc.siblings(parent).map((n) => n.id), chosen, how);
      // Put each in its place from the bottom up.
      target.forEach((id, i) => { if (doc.siblings(parent)[i]?.id !== id) ed.move(id, parent, i); });
    }
  });
}

/**
 * Mirror the selection left to right (`x`) or top to bottom: each layer's contents flip, a turned layer turns
 * the other way, and layers placed by x/y swap places across the middle of the selection.
 */
export function flipSelection(axis: 'x' | 'y'): void {
  const { selection, doc } = store.get();
  const cache = canvas.cache;
  if (!doc || !cache || !selection.length) return;
  const placed = selection.map((id) => ({ id, p: cache.placed(id) })).filter((x) => !!x.p);
  if (!placed.length) return;
  const all = boundsOf(placed.flatMap(({ p }) => [{ x: p!.bounds.x, y: p!.bounds.y }, { x: p!.bounds.x + p!.bounds.width, y: p!.bounds.y + p!.bounds.height }]));
  const mid = { x: all.x + all.width / 2, y: all.y + all.height / 2 };
  const key = axis === 'x' ? 'flipX' : 'flipY';
  void commit(axis === 'x' ? 'Flip horizontal' : 'Flip vertical', (ed) => {
    for (const { id, p } of placed) {
      const n = doc.get(id)! as Record<string, unknown>;
      const rot = typeof n.rotation === 'number' ? n.rotation : 0;
      const props: Record<string, unknown> = { [key]: n[key] === true ? undefined : true, ...(rot ? { rotation: -rot } : {}) };
      if (isFree(doc, id)) {
        const { width: w, height: h } = p!.abs;
        const c = apply(p!.matrix, w / 2, h / 2);
        const mirrored = axis === 'x' ? { x: 2 * mid.x - c.x, y: c.y } : { x: c.x, y: 2 * mid.y - c.y };
        // The new top-left corner: the mirrored centre, less the half box turned the new way.
        const q = apply(invert(p!.parent), mirrored.x, mirrored.y);
        const half = applyLinear(placement(0, 0, -rot), w / 2, h / 2);
        props.x = Math.round((q.x - half.x) * 100) / 100;
        props.y = Math.round((q.y - half.y) * 100) / 100;
      }
      ed.set(id, props);
    }
  });
}

/** Scale the selected layers by k with everything in them (their top-left corners stay). */
export function scaleSelection(k: number): void {
  const { selection, doc } = store.get();
  if (!doc || !selection.length) return;
  if (!(k > 0) || k === 1) return;
  if (k > 100) { toast('Scale by at most 10000%'); return; }
  void commit('Scale', (ed) => {
    for (const id of selection) {
      const n = doc.get(id);
      if (!n) continue;
      for (const [nid, props] of scaleTree(n, k)) ed.set(nid, props);
    }
  });
}
