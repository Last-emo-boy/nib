import { DocEditor, PenDoc, reassignIds, type Op } from '@nib/core';
import type { Node } from '@nib/format';

/**
 * Variants: several agents at once, each on its own copy of a frame, side by side, so the person can compare
 * takes on one request and keep the one they like. The copies sit in a row to the right of the original, in
 * space no other top-level layer takes.
 */

export interface VariantInfo {
  /** The set of variants made together. */
  group: string;
  /** The frame they are variants of, and the copy this one works on. */
  of: string;
  frame: string;
  index: number;
  count: number;
}

type Box = { x: number; y: number; width: number; height: number };

const GAP = 120;

/** How far each variant goes: the first stays close to the original, the last is the boldest. */
const DIRECTIONS = [
  'Stay closest to the original: change what the request asks for and little else.',
  'Take a clearly different direction from the original in layout or style, still meeting the request.',
  'Be bold: make the most different take of the set.',
  'Try an unexpected idea that still meets the request.',
];

export function directionFor(index: number, count: number): string {
  const pick = count <= 1 ? [0] : count === 2 ? [0, 2] : count === 3 ? [0, 1, 2] : [0, 1, 2, 3];
  return DIRECTIONS[pick[Math.min(index, pick.length - 1)]];
}

/**
 * The copies of top-level frame `frameId` for `count` variants, as ops that insert them, placed in a row right
 * of the original where nothing else is.
 */
export function planVariants(doc: PenDoc, frameId: string, count: number, box: (id: string) => Box | undefined): { ops: Op[]; frames: { id: string; name: string }[] } {
  const at = doc.locate(frameId);
  if (!at || at.parent) throw new Error('variants are made of a top-level frame');
  const b = box(frameId);
  if (!b) throw new Error('the frame has no size yet');
  const row: Box = { x: b.x + b.width + GAP, y: b.y, width: count * b.width + (count - 1) * GAP, height: b.height };
  const others = doc.data.children.map((n) => box(n.id)).filter((x): x is Box => !!x && x.width + x.height > 0);
  for (let i = 0; i <= others.length; i++) {
    const hit = others.find((o) => row.x < o.x + o.width + GAP && row.x + row.width + GAP > o.x && row.y < o.y + o.height + GAP && row.y + row.height + GAP > o.y);
    if (!hit) break;
    row.x = hit.x + hit.width + GAP;
  }
  const base = String(at.node.name ?? frameId);
  // Inserted into a copy of the document as they are made, so no two copies share an id.
  const plan = new PenDoc(structuredClone(doc.data));
  const ed = new DocEditor(plan);
  ed.begin();
  const frames: { id: string; name: string }[] = [];
  for (let k = 0; k < count; k++) {
    const copy = structuredClone(at.node) as Node & { name?: string; x?: number; y?: number };
    reassignIds(plan, copy);
    copy.name = `${base} · Variant ${k + 1}`;
    copy.x = Math.round(row.x + k * (b.width + GAP));
    copy.y = Math.round(row.y);
    ed.insert(null, copy);
    frames.push({ id: copy.id, name: copy.name });
  }
  const ops = ed.pending();
  return { ops, frames };
}

/** What each variant's agent is told besides the request. */
export function variantPrompt(v: { index: number; count: number; frame: string; name: string; original: string }): string {
  return `<variant>
Make this as variant ${v.index + 1} of ${v.count}, in the frame "${v.name}" (id ${v.frame}): a copy of "${v.original}" made so ${v.count} agents can each try their own take on this request, side by side. Work only inside that frame: change, add or remove what is in it, and leave every other layer of the document alone (the other variants are being made next to it right now). ${directionFor(v.index, v.count)}
</variant>`;
}
