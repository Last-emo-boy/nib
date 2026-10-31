import { addStroke, isSketchFrame, pathNodeProps, smoothStroke, strokeNode, transformPaths, newId, type Pt } from '@nib/core';
import type { Node } from '@nib/format';
import { commit } from '../app/actions.ts';
import { store } from '../app/store.ts';
import { canvas } from './Canvas.tsx';
import { invert } from './affine.ts';

/**
 * The pencil: freehand strokes, smoothed. On the canvas they collect in a sketch frame (paper that grows to
 * hold them); drawn over a design, they go into the frame under the pointer, as notes on it.
 */

/** A line about 2.5 screen pixels wide at the zoom it is drawn at. */
export const sketchWidth = (zoom: number) => Math.min(12, Math.max(1, Math.round((2.5 / zoom) * 2) / 2));

/** The sketch strokes went into last, selected when the pencil is put down. */
let lastSketch: string | undefined;

export async function finishSketch(points: Pt[], parent: string | null, width: number): Promise<void> {
  const { doc, view } = store.get();
  if (!doc || !points.length) return;
  const sub = smoothStroke(points, 1.2 / view.zoom);
  const top = parent ? doc.topLevel(parent) : undefined;
  const into = parent && doc.has(parent) && !isSketchFrame(top) ? parent : null;
  await commit('Sketch', (ed, d) => {
    if (!into) { lastSketch = addStroke(ed, d, sub, width); return; }
    const space = canvas.cache?.placed(into)?.inner;
    const props = pathNodeProps(space ? transformPaths([sub], invert(space)) : [sub], 1);
    if (!props) return;
    const flow = (d.get(into) as { layout?: string }).layout !== 'none';
    ed.insert(d.get(into)!, { ...strokeNode(newId(d), props, width), ...(flow ? { layoutPosition: 'absolute' } : {}) } as Node);
    lastSketch = into;
  });
}

// Putting the pencil down selects the sketch it drew, so it can be built.
let tool = store.get().tool;
store.subscribe(() => {
  const s = store.get();
  if (s.tool === tool) return;
  const was = tool;
  tool = s.tool;
  if (was === 'pencil' && !s.selection.length && lastSketch && s.doc?.has(lastSketch)) store.set({ selection: [lastSketch] });
});
