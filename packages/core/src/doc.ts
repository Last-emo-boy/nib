import type { Node, PenDocument, Variable } from '@nib/format';

export interface Located {
  node: Node;
  /** null when the node sits directly in the document. */
  parent: Node | null;
  index: number;
}

interface Entry { node: Node; parent: Node | null }

/**
 * A .pen document with an id index. The document JSON stays the single source of truth;
 * edits go through `DocEditor`, which keeps the index current. `reindex()` rebuilds it after
 * the tree was changed some other way.
 */
export class PenDoc {
  readonly data: PenDocument;
  /** Imported documents by alias (`imports` in the file). Filled by the host, which owns file access. */
  readonly imports = new Map<string, PenDoc>();
  private index = new Map<string, Entry>();

  constructor(data: PenDocument) {
    this.data = data;
    this.reindex();
  }

  reindex(): void {
    this.index.clear();
    for (const n of this.data.children) this.indexSubtree(n, null);
  }

  /** Add `node` and its descendants to the index under `parent`. */
  indexSubtree(node: Node, parent: Node | null): void {
    if (typeof node.id === 'string') this.index.set(node.id, { node, parent });
    for (const c of childrenOf(node) ?? []) this.indexSubtree(c, node);
  }

  unindexSubtree(node: Node): void {
    if (typeof node.id === 'string' && this.index.get(node.id)?.node === node) this.index.delete(node.id);
    for (const c of childrenOf(node) ?? []) this.unindexSubtree(c);
  }

  get(id: string): Node | undefined {
    return this.locate(id)?.node;
  }

  locate(id: string): Located | undefined {
    const colon = id.indexOf(':');
    if (colon > 0) return this.imports.get(id.slice(0, colon))?.locate(id.slice(colon + 1));
    const e = this.index.get(id);
    if (!e) return undefined;
    return { ...e, index: this.siblings(e.parent).indexOf(e.node) };
  }

  has(id: string): boolean {
    return this.locate(id) !== undefined;
  }

  /** The child list of `parent` (the document's when null), created if a container has none yet. */
  siblings(parent: Node | null): Node[] {
    if (!parent) return this.data.children;
    const p = parent as { children?: Node[] };
    return (p.children ??= []);
  }

  /** Ancestors of a node, nearest first. */
  ancestors(id: string): Node[] {
    const out: Node[] = [];
    for (let p = this.index.get(id)?.parent; p; p = this.index.get(p.id)?.parent ?? null) out.push(p);
    return out;
  }

  /** The top-level node containing `id` (itself when it is top-level). */
  topLevel(id: string): Node | undefined {
    const anc = this.ancestors(id);
    return anc.length ? anc[anc.length - 1] : this.get(id);
  }

  /** `alias:name` reads a variable from an imported document. */
  variable(name: string): Variable | undefined {
    const colon = name.indexOf(':');
    if (colon > 0) return this.imports.get(name.slice(0, colon))?.variable(name.slice(colon + 1));
    return this.data.variables?.[name];
  }

  get size(): number {
    return this.index.size;
  }

  ids(): IterableIterator<string> {
    return this.index.keys();
  }
}

export function childrenOf(node: Node): Node[] | undefined {
  const c = (node as { children?: unknown }).children;
  return Array.isArray(c) ? (c as Node[]) : undefined;
}
