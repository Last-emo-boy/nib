import type { Node, PenDocument } from '@nib/format';

/**
 * What changed between two versions of a design, frame by frame: layers added, removed or changed (and
 * which properties), top-level frames that only moved, and document-wide changes (variables, themes,
 * imports). Layers are matched by id, which .pen keeps stable.
 */

export interface LayerChange { id: string; name: string; type: string; kind: 'added' | 'removed' | 'changed'; props?: string[] }
export interface FrameChange { id: string; name: string; kind: 'added' | 'removed' | 'changed' | 'moved'; layers: LayerChange[] }
export interface DocDiff { frames: FrameChange[]; document: string[] }

type Flat = Map<string, { node: Node; top: string; own: Record<string, unknown> }>;

function flatten(doc: PenDocument): Flat {
  const out: Flat = new Map();
  const visit = (n: Node, top: string) => {
    const { children: _, ...own } = n as Node & { children?: unknown };
    out.set(n.id, { node: n, top, own: own as Record<string, unknown> });
    for (const c of ((n as { children?: Node[] }).children ?? [])) visit(c, top);
  };
  for (const n of doc.children) visit(n, n.id);
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const nameOf = (n: Node) => (typeof n.name === 'string' && n.name ? n.name : n.type === 'text' && typeof (n as { content?: unknown }).content === 'string' ? String((n as { content: string }).content).slice(0, 40) : n.type);

export function diffDocs(a: PenDocument, b: PenDocument): DocDiff {
  const before = flatten(a), after = flatten(b);
  const frames = new Map<string, FrameChange>();
  const frame = (top: string, doc: 'a' | 'b') => {
    let f = frames.get(top);
    if (!f) {
      const n = (doc === 'a' ? before : after).get(top)!.node;
      frames.set(top, (f = { id: top, name: nameOf(n), kind: 'changed', layers: [] }));
    }
    return f;
  };
  for (const [id, x] of after) {
    const old = before.get(id);
    if (!old) { if (id !== x.top || before.has(x.top)) frame(x.top, 'b').layers.push({ id, name: nameOf(x.node), type: x.node.type, kind: 'added' }); continue; }
    const props = [...new Set([...Object.keys(old.own), ...Object.keys(x.own)])].filter((k) => !same(old.own[k], x.own[k]));
    // A layer moved to another top-level frame counts as removed there and added here.
    if (old.top !== x.top) {
      frame(old.top, 'a').layers.push({ id, name: nameOf(old.node), type: old.node.type, kind: 'removed' });
      frame(x.top, 'b').layers.push({ id, name: nameOf(x.node), type: x.node.type, kind: 'added' });
      continue;
    }
    // Reordered: the children both versions have are in another order (added and removed ones are listed themselves).
    const was = ((old.node as { children?: Node[] }).children ?? []).map((c) => c.id), is = ((x.node as { children?: Node[] }).children ?? []).map((c) => c.id);
    const order = !same(was.filter((c) => is.includes(c)), is.filter((c) => was.includes(c)));
    if (props.length || order) frame(x.top, 'b').layers.push({ id, name: nameOf(x.node), type: x.node.type, kind: 'changed', props: [...props, ...(order ? ['children order'] : [])] });
  }
  for (const [id, x] of before) if (!after.has(id) && (id !== x.top || after.has(x.top))) frame(x.top, 'a').layers.push({ id, name: nameOf(x.node), type: x.node.type, kind: 'removed' });
  for (const n of b.children) if (!before.has(n.id)) frames.set(n.id, { id: n.id, name: nameOf(n), kind: 'added', layers: [] });
  for (const n of a.children) if (!after.has(n.id)) frames.set(n.id, { id: n.id, name: nameOf(n), kind: 'removed', layers: [] });
  // A top-level frame whose only change is where it sits on the canvas.
  for (const f of frames.values()) {
    if (f.kind !== 'changed') continue;
    if (f.layers.length === 1 && f.layers[0].id === f.id && f.layers[0].props?.every((p) => p === 'x' || p === 'y')) { f.kind = 'moved'; f.layers = []; }
  }
  const document: string[] = [];
  for (const k of ['variables', 'themes', 'imports'] as const) {
    const va = (a[k] ?? {}) as Record<string, unknown>, vb = (b[k] ?? {}) as Record<string, unknown>;
    const added = Object.keys(vb).filter((x) => !(x in va)), removed = Object.keys(va).filter((x) => !(x in vb)), changed = Object.keys(vb).filter((x) => x in va && !same(va[x], vb[x]));
    if (added.length || removed.length || changed.length) document.push(`${k}: ${[added.length && `${added.length} added`, removed.length && `${removed.length} removed`, changed.length && `${changed.length} changed`].filter(Boolean).join(', ')}`);
  }
  const order = { removed: 0, added: 1, changed: 2, moved: 3 };
  return { frames: [...frames.values()].sort((x, y) => order[x.kind] - order[y.kind] || x.name.localeCompare(y.name)), document };
}

/** The diff as lines of plain text. */
export function diffText(d: DocDiff): string {
  if (!d.frames.length && !d.document.length) return 'No changes.';
  const lines: string[] = [];
  for (const f of d.frames) {
    lines.push(`${f.kind === 'added' ? '+' : f.kind === 'removed' ? '-' : '~'} ${f.name} (${f.kind}${f.layers.length ? `, ${f.layers.length} layer${f.layers.length === 1 ? '' : 's'}` : ''})`);
    for (const l of f.layers.slice(0, 40)) lines.push(`    ${l.kind === 'added' ? '+' : l.kind === 'removed' ? '-' : '~'} ${l.name} [${l.type}]${l.props?.length ? `: ${l.props.join(', ')}` : ''}`);
    if (f.layers.length > 40) lines.push(`    … ${f.layers.length - 40} more`);
  }
  for (const x of d.document) lines.push(`~ document ${x}`);
  return lines.join('\n');
}

/** The diff as markdown for a pull request: a section per frame, with its pictures when there are some. */
export function diffMarkdown(d: DocDiff, title: string, images: Map<string, { before?: string; after?: string; diff?: string; similarity?: number }>): string {
  const counts = (['changed', 'added', 'removed', 'moved'] as const).map((k) => [k, d.frames.filter((f) => f.kind === k).length] as const).filter(([, n]) => n);
  const lines = [`### ${title}`, '', counts.length ? `**${counts.map(([k, n]) => `${n} frame${n === 1 ? '' : 's'} ${k}`).join(', ')}.**` : '**No frames changed.**'];
  for (const x of d.document) lines.push(`- Document ${x}.`);
  for (const f of d.frames) {
    lines.push('', `#### ${f.name} — ${f.kind}`);
    const by = (k: LayerChange['kind']) => f.layers.filter((l) => l.kind === k);
    for (const k of ['changed', 'added', 'removed'] as const) {
      const ls = by(k);
      if (ls.length) lines.push(`- ${ls.length} ${k}: ${ls.slice(0, 12).map((l) => `${l.name}${l.props?.length ? ` (${l.props.join(', ')})` : ''}`).join('; ')}${ls.length > 12 ? '; …' : ''}`);
    }
    const img = images.get(f.id);
    if (img) {
      if (img.similarity !== undefined) lines.push(`- ${Math.round(img.similarity * 1000) / 10}% the same in pixels.`);
      const cells = [img.before && `![before](${img.before})`, img.after && `![after](${img.after})`, img.diff && `![difference](${img.diff})`].filter(Boolean);
      if (cells.length) lines.push('', `| ${['Before', 'After', 'Difference'].slice(0, cells.length).join(' | ')} |`, `|${' --- |'.repeat(cells.length)}`, `| ${cells.join(' | ')} |`);
    }
  }
  return lines.join('\n') + '\n';
}
