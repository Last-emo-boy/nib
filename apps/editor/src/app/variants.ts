import type { DocEditor, PenDoc } from '@nib/core';

/**
 * Settling a set of variants (copies of one frame that agents worked on side by side): keep one in the
 * original's place, or discard them all. Both are one change, undone at once.
 */

/** Keep variant `chosen`: it takes the original's place, name and position; the original and the other copies go. */
export function keepVariant(ed: DocEditor, doc: PenDoc, of: string, frames: string[], chosen: string): void {
  if (!doc.has(chosen)) throw new Error('that variant is gone');
  for (const f of frames) if (f !== chosen && doc.has(f)) ed.remove(f);
  const original = doc.locate(of);
  if (!original) {
    // The original is gone: the variant stays where it is, under the name it was copied with.
    const name = doc.get(chosen)?.name;
    if (typeof name === 'string') ed.set(chosen, { name: name.replace(/ · Variant \d+$/, '') });
    return;
  }
  const { name, x, y } = original.node as { name?: string; x?: number; y?: number };
  ed.set(chosen, { name, x, y });
  ed.move(chosen, original.parent, original.index);
  ed.remove(of);
}

/** Discard every copy of the set; the original stays. */
export function discardVariants(ed: DocEditor, doc: PenDoc, frames: string[]): void {
  for (const f of frames) if (doc.has(f)) ed.remove(f);
}
