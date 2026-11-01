import type { Node, PenDocument } from '@nib/format';

/**
 * A three-way merge of .pen documents for git: what "theirs" changed since the common base is applied to
 * "ours", layer by layer (layers keep their ids). Property by property, a side that left a value as it was
 * takes the other side's; when both changed the same thing differently, ours stays and it is reported. The
 * result is always a valid document, never one with conflict markers in it.
 */

export interface MergeResult { doc: PenDocument; conflicts: string[] }

type Rec = Record<string, unknown>;
interface Entry { node: Node; parent: string | null; index: number }

function index(doc: PenDocument): Map<string, Entry> {
  const out = new Map<string, Entry>();
  const visit = (list: Node[], parent: string | null) => list.forEach((n, i) => {
    out.set(n.id, { node: n, parent, index: i });
    visit(((n as { children?: Node[] }).children ?? []), n.id);
  });
  visit(doc.children, null);
  return out;
}

const own = (n: Node): Rec => { const { children: _, ...rest } = n as Node & { children?: unknown }; return rest as Rec; };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const label = (n: Node) => (typeof n.name === 'string' && n.name ? `"${n.name}"` : n.id);

/** Merge records key by key; `what` names them in conflicts. */
function mergeRecords(base: Rec, ours: Rec, theirs: Rec, what: (k: string) => string, conflicts: string[]): Rec {
  const out: Rec = { ...ours };
  for (const k of new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])) {
    const b = base[k], o = ours[k], t = theirs[k];
    if (same(o, t) || same(t, b)) continue;
    if (same(o, b)) { if (t === undefined) delete out[k]; else out[k] = t; continue; }
    conflicts.push(`${what(k)}: changed on both sides; ours kept`);
  }
  return out;
}

export function mergeDocs(base: PenDocument, ours: PenDocument, theirs: PenDocument): MergeResult {
  const conflicts: string[] = [];
  const doc = structuredClone(ours);
  const B = index(base), O = index(ours), T = index(theirs);
  // The merged tree, found by id as it changes.
  const find = (id: string): { list: Node[]; i: number; node: Node } | undefined => {
    const walk = (list: Node[]): { list: Node[]; i: number; node: Node } | undefined => {
      for (let i = 0; i < list.length; i++) {
        if (list[i].id === id) return { list, i, node: list[i] };
        const r = walk(((list[i] as { children?: Node[] }).children ?? []));
        if (r) return r;
      }
      return undefined;
    };
    return walk(doc.children);
  };
  const childList = (parent: string | null): Node[] | undefined => {
    if (parent === null) return doc.children;
    const p = find(parent)?.node as (Node & { children?: Node[] }) | undefined;
    if (!p) return undefined;
    return (p.children ??= []);
  };
  /** Put `node` under `parent` right after its previous sibling in theirs (at the start when it has none there). */
  const place = (node: Node, parent: string | null) => {
    const list = childList(parent) ?? doc.children;
    const siblings = (parent === null ? theirs.children : (((T.get(parent)?.node as { children?: Node[] }) ?? {}).children ?? [])).map((c) => c.id);
    const before = siblings.slice(0, siblings.indexOf(node.id)).reverse().find((s) => list.some((c) => c.id === s));
    list.splice(before ? list.findIndex((c) => c.id === before) + 1 : 0, 0, node);
  };
  const remove = (id: string) => { const at = find(id); if (at) at.list.splice(at.i, 1); return at?.node; };

  // Layers they deleted go, unless we changed them.
  for (const [id, b] of B) {
    if (T.has(id) || !O.has(id)) continue;
    if (same(own(O.get(id)!.node), own(b.node))) remove(id);
    else conflicts.push(`${label(b.node)}: they deleted it, we changed it; kept`);
  }
  for (const [id, b] of B) if (!O.has(id) && T.has(id) && !same(own(T.get(id)!.node), own(b.node))) conflicts.push(`${label(b.node)}: we deleted it, they changed it; left deleted`);

  // Layers in all three: their changed properties, and where they moved it.
  for (const [id, t] of T) {
    const b = B.get(id), o = O.get(id);
    if (!b || !o) continue;
    const at = find(id);
    if (!at) continue;
    const merged = mergeRecords(own(b.node), own(o.node), own(t.node), (k) => `${label(o.node)}.${k}`, conflicts);
    const kids = (at.node as { children?: Node[] }).children;
    at.list[at.i] = { ...merged, ...(kids ? { children: kids } : {}) } as unknown as Node;
    const movedByThem = t.parent !== b.parent, movedByUs = o.parent !== b.parent;
    if (movedByThem && !movedByUs && (t.parent === null || find(t.parent))) place(remove(id)!, t.parent);
    else if (movedByThem && movedByUs && t.parent !== o.parent) conflicts.push(`${label(o.node)}: moved to different places on both sides; ours kept`);
  }

  // Layers they added, parents before children (an added parent brings its new children along).
  for (const [id, t] of T) {
    if (B.has(id) || O.has(id) || find(id)) continue;
    if (t.parent !== null && !B.has(t.parent) && !O.has(t.parent) && T.has(t.parent)) continue;
    const parent = t.parent === null || find(t.parent) ? t.parent : null;
    place(structuredClone(t.node), parent);
  }

  // The order of children they changed, where we kept it.
  for (const [id] of T) {
    const kids = (find(id)?.node as { children?: Node[] } | undefined)?.children;
    const order = (e: Entry | undefined) => ((e?.node as { children?: Node[] } | undefined)?.children ?? []).map((c) => c.id);
    const b = order(B.get(id)), o = order(O.get(id)), t = order(T.get(id));
    if (!kids || !B.has(id)) continue;
    const common = (x: string[]) => x.filter((c) => b.includes(c) && o.includes(c) && t.includes(c));
    if (same(common(t), common(b)) || !same(common(o), common(b))) continue;
    const want = common(t), slots = kids.map((c, i) => (want.includes(c.id) ? i : -1)).filter((i) => i >= 0);
    const moved = want.map((w) => kids.find((c) => c.id === w)!);
    slots.forEach((s, i) => { kids[s] = moved[i]; });
  }

  // Document-wide: variables and imports by name, theme axes as the union of their values.
  for (const k of ['variables', 'imports'] as const) {
    const merged = mergeRecords((base[k] ?? {}) as Rec, (ours[k] ?? {}) as Rec, (theirs[k] ?? {}) as Rec, (n) => `${k === 'variables' ? 'variable' : 'import'} ${n}`, conflicts);
    if (Object.keys(merged).length) (doc as unknown as Rec)[k] = merged; else delete (doc as unknown as Rec)[k];
  }
  const themes: Record<string, string[]> = structuredClone(ours.themes ?? {});
  for (const [axis, values] of Object.entries(theirs.themes ?? {})) {
    const list = (themes[axis] ??= []);
    for (const v of values) if (!list.includes(v) && !(base.themes?.[axis] ?? []).includes(v)) list.push(v);
  }
  if (Object.keys(themes).length) doc.themes = themes;
  return { doc, conflicts };
}
