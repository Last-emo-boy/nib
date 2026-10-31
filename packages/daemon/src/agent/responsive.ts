import { DocEditor, PenDoc, reassignIds, type Op } from '@nib/core';
import type { Node } from '@nib/format';

/**
 * Responsive versions: copies of a frame at tablet and phone widths in a row beside it, each adapted by its
 * own agent at the same time, which checks its work with Review before it stops.
 */

export interface Device { id: 'tablet' | 'phone'; label: string; width: number; height: number }
export const DEVICES: Device[] = [
  { id: 'tablet', label: 'Tablet', width: 768, height: 1024 },
  { id: 'phone', label: 'Phone', width: 390, height: 844 },
];

type Box = { x: number; y: number; width: number; height: number };
const GAP = 120;

/** Copies of top-level frame `frameId` for every device narrower than it, right of it where nothing else is. */
export function planResponsive(doc: PenDoc, frameId: string, box: (id: string) => Box | undefined): { ops: Op[]; frames: { id: string; name: string; device: Device }[] } {
  const at = doc.locate(frameId);
  if (!at || at.parent) throw new Error('responsive versions are made of a top-level frame');
  const b = box(frameId);
  if (!b) throw new Error('the frame has no size yet');
  const devices = DEVICES.filter((d) => d.width < b.width - 40);
  if (!devices.length) throw new Error(`the frame is ${Math.round(b.width)} wide: it is already phone-sized`);
  const height = (d: Device) => Math.max(d.height, Math.round(b.height));
  const row: Box = { x: b.x + b.width + GAP, y: b.y, width: devices.reduce((w, d) => w + d.width + GAP, -GAP), height: Math.max(...devices.map(height)) };
  const others = doc.data.children.map((n) => box(n.id)).filter((x): x is Box => !!x && x.width + x.height > 0);
  for (let i = 0; i <= others.length; i++) {
    const hit = others.find((o) => row.x < o.x + o.width + GAP && row.x + row.width + GAP > o.x && row.y < o.y + o.height + GAP && row.y + row.height + GAP > o.y);
    if (!hit) break;
    row.x = hit.x + hit.width + GAP;
  }
  const base = String(at.node.name ?? frameId);
  const plan = new PenDoc(structuredClone(doc.data));
  const ed = new DocEditor(plan);
  ed.begin();
  const frames: { id: string; name: string; device: Device }[] = [];
  let x = row.x;
  for (const device of devices) {
    const copy = structuredClone(at.node) as Node & { name?: string; x?: number; y?: number; width?: unknown; height?: unknown };
    reassignIds(plan, copy);
    copy.name = `${base} · ${device.label}`;
    copy.x = Math.round(x);
    copy.y = Math.round(row.y);
    copy.width = device.width;
    // A fixed height becomes the device's screen (or the original's, if taller); content-sized stays so.
    if (typeof copy.height === 'number') copy.height = height(device);
    ed.insert(null, copy);
    frames.push({ id: copy.id, name: copy.name, device });
    x += device.width + GAP;
  }
  return { ops: ed.pending(), frames };
}

/** What each version's agent is told besides the request. */
export function responsivePrompt(v: { device: Device; frame: string; name: string; of: string; original: string; others: number }): string {
  const { device: d } = v;
  return `<responsive>
Adapt the frame "${v.name}" (id ${v.frame}) for a ${d.label.toLowerCase()} screen ${d.width} wide: it is a copy of "${v.original}" (id ${v.of}), already made ${d.width} wide. Keep the content, its order and the style, and reflow it for this width: stack columns that no longer fit side by side, let text wrap, make headings smaller where they are too big for the width, ${d.id === 'phone' ? 'turn a row of navigation links into a compact bar with a menu button, ' : ''}give buttons and links at least 44×44 to tap, and make the frame as tall as its content needs. Work only inside that frame: the original stays as it is${v.others ? ', and another agent is making the other version next to it right now' : ''}. When it is done, call Review("${v.frame}") and fix what it lists until it finds nothing, then take a screenshot to check.
</responsive>`;
}
