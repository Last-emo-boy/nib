import { DocEditor, newId, reassignIds, type Op, type PenDoc } from '@nib/core';
import type { Node } from '@nib/format';
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

/** Plan and send one undoable change. */
export async function commit(label: string, change: (ed: DocEditor, doc: PenDoc) => void): Promise<boolean> {
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
    await conn.edit(ops, label);
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
export function copySelection(): void {
  const { selection, doc } = store.get();
  if (!doc || !selection.length) return;
  const at = selection.map((id) => doc.locate(id)).filter((a) => !!a);
  clipboard = { nib: 1, nodes: at.map((a) => structuredClone(a.node)), parent: at[0].parent?.id ?? null };
  void navigator.clipboard?.writeText(JSON.stringify(clipboard)).catch(() => {});
}

export function cutSelection(): void {
  copySelection();
  deleteSelection();
}

/**
 * Paste into the selected frame, else next to where the nodes were copied from (shifted when they sit
 * at their own x/y), else onto the canvas.
 */
export async function paste(): Promise<void> {
  let clip = clipboard;
  try {
    const text = await navigator.clipboard?.readText();
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
