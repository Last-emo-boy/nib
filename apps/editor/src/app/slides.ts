/**
 * Slides in the editor: reordering them moves their frames (which slides there are, and their order, come from
 * `@nib/core`).
 */
export { isSlide, readingOrder } from '@nib/core';

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
