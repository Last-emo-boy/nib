import { DocEditor, newId, reassignIds, type Op, type PenDoc } from '@nib/core';
import type { Node } from '@nib/format';
import { authHeaders } from './connection.ts';
import { store, toast } from './store.ts';

/**
 * Work out the ops for a change by making it on the editor's copy and rolling it back. The daemon then
 * applies exactly these ops, in order, and sends them back; only then does this copy change for real.
 */
export function plan(doc: PenDoc, change: (ed: DocEditor) => void): Op[] {
  const ed = new DocEditor(doc);
  ed.begin();
  try {
    change(ed);
    return ed.pending();
  } finally {
    ed.rollback();
  }
}

/** Plan and send one undoable change; changes with the same `merge` key in a row undo as one. */
export async function commit(label: string, change: (ed: DocEditor, doc: PenDoc) => void, merge?: string): Promise<boolean> {
  const { conn, doc } = store.get();
  if (!conn || !doc) return false;
  let ops: Op[];
  try {
    ops = plan(doc, (ed) => change(ed, doc));
  } catch (e) {
    toast((e as Error).message);
    return false;
  }
  try {
    await conn.edit(ops, label, merge);
    return true;
  } catch (e) {
    toast(`${label}: ${(e as Error).message}`);
    return false;
  }
}

export const isContainer = (n: Node | undefined) => n?.type === 'frame' || n?.type === 'group';

/** Whether the node sits at its own x/y (on the canvas, in a free frame or group, or absolute), rather than in a flex flow. */
export function isFree(doc: PenDoc, id: string): boolean {
  const at = doc.locate(id);
  if (!at) return false;
  if (!at.parent || at.node.layoutPosition === 'absolute' || at.parent.type === 'group') return true;
  return at.parent.type === 'frame' && at.parent.layout === 'none';
}

export function setProps(ids: string[], props: Record<string, unknown>, label = 'Change'): Promise<boolean> {
  return commit(label, (ed, doc) => {
    for (const id of ids) if (doc.has(id)) ed.set(id, props);
  });
}

export function deleteSelection(): void {
  const { selection } = store.get();
  if (!selection.length) return;
  void commit(selection.length > 1 ? `Delete ${selection.length} layers` : 'Delete', (ed, doc) => {
    for (const id of selection) if (doc.has(id)) ed.remove(id);
  });
  store.set({ selection: [] });
}

/** Copies of the selection next to the originals (free nodes shifted, flow nodes after them). */
export async function duplicateSelection(): Promise<void> {
  const { selection, doc } = store.get();
  if (!doc || !selection.length) return;
  const created: string[] = [];
  await commit('Duplicate', (ed) => {
    for (const id of selection) {
      const at = doc.locate(id);
      if (!at) continue;
      const copy = structuredClone(at.node);
      reassignIds(doc, copy);
      if (isFree(doc, id)) Object.assign(copy, { x: (at.node.x ?? 0) + (at.parent ? 10 : 40), y: (at.node.y ?? 0) + (at.parent ? 10 : 40) });
      ed.insert(at.parent, copy, doc.siblings(at.parent).indexOf(at.node) + 1);
      created.push(copy.id);
    }
  });
  store.set({ selection: created });
}

export function nudge(dx: number, dy: number): void {
  const { selection, doc } = store.get();
  if (!doc) return;
  const free = selection.filter((id) => isFree(doc, id));
  if (!free.length) return;
  void commit('Move', (ed) => {
    for (const id of free) {
      const n = doc.get(id)!;
      ed.set(id, { x: Math.round((n.x ?? 0) + dx), y: Math.round((n.y ?? 0) + dy) });
    }
  });
}

/** Insert a new node into `parent` (null: the canvas) and select it. */
export async function insertNode(parent: string | null, node: Record<string, unknown>, label: string): Promise<string | undefined> {
  const { doc } = store.get();
  if (!doc) return undefined;
  const id = newId(doc);
  const ok = await commit(label, (ed) => {
    ed.insert(parent ? doc.get(parent)! : null, { ...node, id } as unknown as Node);
  });
  if (!ok) return undefined;
  store.set({ selection: [id], tool: 'move' });
  return id;
}

/** Wrap the selection (siblings) in a new frame laid out like their parent. */
export function frameSelection(): void {
  const { selection, doc } = store.get();
  if (!doc || !selection.length) return;
  const at = selection.map((id) => doc.locate(id)).filter((a) => !!a);
  const parent = at[0].parent;
  if (at.some((a) => a.parent !== parent)) { toast('Select layers with the same parent'); return; }
  const id = newId(doc);
  void commit('Frame selection', (ed) => {
    const free = !parent || (parent as { layout?: string }).layout === 'none' || parent.type === 'group';
    const xs = at.map((a) => a.node.x ?? 0), ys = at.map((a) => a.node.y ?? 0);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const index = Math.min(...at.map((a) => a.index));
    const frame = { type: 'frame', id, name: 'Frame', ...(free ? { x: x0, y: y0, layout: 'none' } : {}), children: [] } as unknown as Node;
    const nodes = at.sort((a, b) => a.index - b.index).map((a) => ed.remove(a.node.id));
    ed.insert(parent, frame, index);
    for (const n of nodes) {
      ed.insert(frame, n);
      if (free) ed.set(n.id, { x: (n.x ?? 0) - x0, y: (n.y ?? 0) - y0 });
    }
  });
  store.set({ selection: [id] });
}

/** Keep only selected ids that still exist after a change. */
export function pruneSelection(doc: PenDoc): void {
  const { selection } = store.get();
  const kept = selection.filter((id) => doc.has(id));
  if (kept.length !== selection.length) store.set({ selection: kept });
}

/** What was copied: deep copies of nodes, with where they came from. */
interface Clip { nib: 1; nodes: Node[]; parent: string | null }
let clipboard: Clip | undefined;

/** Copy the selection, to nib's own clipboard and as JSON text to the system's (so it pastes into other nib windows). */
export function copySelection(data?: DataTransfer): void {
  const { selection, doc } = store.get();
  if (!doc || !selection.length) return;
  const at = selection.map((id) => doc.locate(id)).filter((a) => !!a);
  clipboard = { nib: 1, nodes: at.map((a) => structuredClone(a.node)), parent: at[0].parent?.id ?? null };
  const text = JSON.stringify(clipboard);
  if (data) data.setData('text/plain', text);
  else void navigator.clipboard?.writeText(text).catch(() => {});
}

export function cutSelection(): void {
  copySelection();
  deleteSelection();
}

/**
 * Paste into the selected frame, else next to where the nodes were copied from (shifted when they sit
 * at their own x/y), else onto the canvas.
 */
export async function paste(given?: string): Promise<void> {
  let clip = clipboard;
  try {
    const text = given ?? (await navigator.clipboard?.readText());
    // SVG markup (copied from an icon site or a drawing app) comes in as editable paths.
    if (text && /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(text)) {
      const { importSvg } = await import('../canvas/Canvas.tsx');
      await importSvg(text);
      return;
    }
    const parsed = text ? JSON.parse(text) : undefined;
    if (parsed?.nib === 1 && Array.isArray(parsed.nodes)) clip = parsed as Clip;
  } catch {
    // Not nib content, or no clipboard permission: use what was copied in this window.
  }
  const { doc, selection } = store.get();
  if (!clip || !doc) return;
  const target = selection.length === 1 && isContainer(doc.get(selection[0])) && !clip.nodes.some((n) => n.id === selection[0]) ? selection[0] : clip.parent && doc.has(clip.parent) ? clip.parent : null;
  const parent = target ? doc.get(target)! : null;
  const free = !parent || parent.type === 'group' || (parent as { layout?: string }).layout === 'none';
  const nodes = clip.nodes.map((n) => {
    const copy = structuredClone(n);
    reassignIds(doc, copy);
    if (free && target === clip!.parent) Object.assign(copy, { x: (n.x ?? 0) + (parent ? 10 : 40), y: (n.y ?? 0) + (parent ? 10 : 40) });
    return copy;
  });
  const ok = await commit(nodes.length > 1 ? `Paste ${nodes.length} layers` : 'Paste', (ed) => {
    for (const n of nodes) ed.insert(parent, n);
  });
  if (ok) store.set({ selection: nodes.map((n) => n.id) });
}

export type Align = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/**
 * Align free-placed layers: several to their common bounds, one to its parent. `boxes` gives laid-out
 * boxes in canvas coordinates.
 */
export function align(how: Align, box: (id: string) => { x: number; y: number; width: number; height: number } | undefined): void {
  const { selection, doc } = store.get();
  if (!doc) return;
  const ids = selection.filter((id) => isFree(doc, id) && box(id));
  if (!ids.length) { toast('Only layers placed by x/y can be aligned; layers in a layout follow it.'); return; }
  let ref: { x: number; y: number; width: number; height: number } | undefined;
  if (ids.length === 1) {
    const parent = doc.locate(ids[0])?.parent;
    ref = parent ? box(parent.id) : undefined;
    if (!ref) return;
  } else {
    const bs = ids.map((id) => box(id)!);
    const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
    ref = { x: x0, y: y0, width: Math.max(...bs.map((b) => b.x + b.width)) - x0, height: Math.max(...bs.map((b) => b.y + b.height)) - y0 };
  }
  const r = ref;
  void commit('Align', (ed) => {
    for (const id of ids) {
      const b = box(id)!;
      const n = doc.get(id)!;
      let dx = 0, dy = 0;
      if (how === 'left') dx = r.x - b.x;
      if (how === 'hcenter') dx = r.x + r.width / 2 - (b.x + b.width / 2);
      if (how === 'right') dx = r.x + r.width - (b.x + b.width);
      if (how === 'top') dy = r.y - b.y;
      if (how === 'vcenter') dy = r.y + r.height / 2 - (b.y + b.height / 2);
      if (how === 'bottom') dy = r.y + r.height - (b.y + b.height);
      if (dx || dy) ed.set(id, { x: Math.round((n.x ?? 0) + dx), y: Math.round((n.y ?? 0) + dy) });
    }
  });
}

async function exportFiles(ids: string[], format: string, scale = 2): Promise<{ name: string; data: string }[]> {
  const conn = store.get().conn;
  if (!conn) return [];
  const r = await fetch('/api/export', { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ filePath: conn.path, ids, format, scale }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j.files;
}

/** Put the selection on the system clipboard as a PNG image (2×). */
export async function copyAsPng(): Promise<void> {
  const { selection } = store.get();
  if (!selection.length) return;
  try {
    const [f] = await exportFiles(selection.slice(0, 1), 'png');
    const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
    toast('Copied as PNG');
  } catch (e) {
    toast(`Copy as PNG: ${(e as Error).message}`);
  }
}

/** Put the selection on the system clipboard as HTML with its styles (no page scaffold). */
export async function copyAsHtml(tailwind = false): Promise<void> {
  const { selection } = store.get();
  if (!selection.length) return;
  try {
    const conn = store.get().conn!;
      const r = await fetch('/api/export', { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ filePath: conn.path, ids: selection, format: tailwind ? 'html-tailwind' : 'html-css', fragment: true }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    const html = new TextDecoder().decode(Uint8Array.from(atob(j.files[0].data), (c) => c.charCodeAt(0)));
    await navigator.clipboard.writeText(html);
    toast(tailwind ? 'Copied as HTML (Tailwind)' : 'Copied as HTML');
  } catch (e) {
    toast(`Copy as HTML: ${(e as Error).message}`);
  }
}

/** Put the selection on the clipboard as a React component (library instances as their components). */
export async function copyAsReact(): Promise<void> {
  const { selection, conn } = store.get();
  if (!selection.length || !conn) return;
  try {
    const r = await fetch('/api/export', { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ filePath: conn.path, ids: selection, format: 'react-tailwind' }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    await navigator.clipboard.writeText(new TextDecoder().decode(Uint8Array.from(atob(j.files[0].data), (c) => c.charCodeAt(0))));
    toast('Copied as React');
  } catch (e) {
    toast(`Copy as React: ${(e as Error).message}`);
  }
}

/** Save the document under a new path and switch to it. */
export async function saveAs(): Promise<void> {
  const conn = store.get().conn;
  if (!conn) return;
  const target = prompt('Save a copy as (absolute path, .pen):', conn.path.replace(/\.pen$/, ' copy.pen'));
  if (!target) return;
  const r = await fetch('/api/save-as', { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ filePath: conn.path, target }) });
  const j = await r.json();
  if (!r.ok) { toast(`Save as: ${j.error}`); return; }
  location.hash = new URLSearchParams({ file: j.path }).toString();
  location.reload();
}
