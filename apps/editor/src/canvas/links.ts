import type { PenDoc } from '@nib/core';
import { layerOf } from '../app/parts.ts';
import { store } from '../app/store.ts';
import { canvas } from './Canvas.tsx';
import { goTo, type Transition } from './present.tsx';

/**
 * Prototype links: a layer that leads to another frame when clicked in Present mode. Kept in the layer's
 * `metadata` ({type: 'nib-link', to, transition}), so the file stays plain .pen; `to` is a top-level frame's
 * id, or 'next' / 'previous' for the slides around the one shown.
 */
export interface Link { to: string; transition: Transition }

export const LINK = 'nib-link';

export function linkOf(n: unknown): Link | undefined {
  const m = (n as { metadata?: { type?: string; to?: unknown; transition?: unknown } } | undefined)?.metadata;
  if (m?.type !== LINK || typeof m.to !== 'string') return undefined;
  const transition = m.transition === 'dissolve' || m.transition === 'move' ? m.transition : 'instant';
  return { to: m.to, transition };
}

/** The link a click at a document point follows: the innermost linked layer under it. */
export function linkAt(doc: PenDoc, x: number, y: number): Link | undefined {
  for (const id of canvas.cache?.hit(x, y) ?? []) {
    const link = linkOf(layerOf(doc, id));
    if (link) return link;
  }
  return undefined;
}

/** In Present mode, a click at a screen point: follows a link there, if any (true when it did). */
export function followLink(sx: number, sy: number): boolean {
  const s = store.get();
  if (!s.doc || !s.present) return false;
  const link = linkAt(s.doc, (sx - s.view.tx) / s.view.zoom, (sy - s.view.ty) / s.view.zoom);
  if (!link) return false;
  const { index } = s.present;
  if (link.to === 'next') goTo(index + 1, link.transition);
  else if (link.to === 'previous') goTo(index - 1, link.transition);
  else if (s.doc.has(link.to)) goTo(link.to, link.transition);
  else return false;
  return true;
}
