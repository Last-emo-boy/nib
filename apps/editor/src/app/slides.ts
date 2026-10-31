import type { PenDoc } from '@nib/core';
import type { Node } from '@nib/format';

/**
 * Slides are the top-level frames of a design (and instances of frame components placed at the top level),
 * components left out, in reading order: rows from top to bottom, left to right in each row. Nothing is stored:
 * moving frames on the canvas reorders the slides, and reordering slides moves the frames.
 */

interface B { x: number; y: number; width: number; height: number }

export function isSlide(doc: PenDoc, n: Node): boolean {
  if (n.reusable) return false;
  if (n.type === 'frame') return true;
  if (n.type === 'ref') return doc.get((n as { ref: string }).ref)?.type === 'frame';
  return false;
}

/**
 * Ids in reading order. A box joins a row when it overlaps the row's vertical span by at least half of the
 * shorter of the two, so slightly uneven rows still read as rows.
 */
export function readingOrder(items: { id: string; box: B }[]): string[] {
  const sorted = [...items].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const rows: { top: number; bottom: number; items: typeof items }[] = [];
  for (const it of sorted) {
    const top = it.box.y, bottom = it.box.y + it.box.height;
    const row = rows.find((r) => Math.min(r.bottom, bottom) - Math.max(r.top, top) >= Math.min(r.bottom - r.top, bottom - top) / 2);
    if (row) { row.items.push(it); row.top = Math.min(row.top, top); row.bottom = Math.max(row.bottom, bottom); } else rows.push({ top, bottom, items: [it] });
  }
  return rows.sort((a, b) => a.top - b.top).flatMap((r) => r.items.sort((a, b) => a.box.x - b.box.x).map((i) => i.id));
}

/**
 * Where each slide goes when slide `from` moves to position `to`: the slides keep the places they had, in their
 * new order (each place being a top-left corner).
 */
export function moveSlide(order: string[], places: Record<string, { x: number; y: number }>, from: number, to: number): Record<string, { x: number; y: number }> {
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  const out: Record<string, { x: number; y: number }> = {};
  next.forEach((id, i) => { const place = places[order[i]]; if (place && (place.x !== places[id]?.x || place.y !== places[id]?.y)) out[id] = place; });
  return out;
}
