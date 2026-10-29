import type { Node, PenDocument, Variable } from '@nib/format';

export interface Located {
  node: Node;
  /** null when the node sits directly in the document. */
  parent: Node | null;
  index: number;
}

/**
 * A .pen document with an id index. The document JSON stays the single source of truth;
 * `reindex()` must run after the tree is changed outside the mutation API.
 */
export class PenDoc {
  readonly data: PenDocument;
  /** Imported documents by alias (`imports` in the file). Filled by the host, which owns file access. */
  readonly imports = new Map<string, PenDoc>();
  private index = new Map<string, Located>();

  constructor(data: PenDocument) {
    this.data = data;
    this.reindex();
  }

  reindex(): void {
    this.index.clear();
    const visit = (nodes: Node[], parent: Node | null) => {
      nodes.forEach((node, index) => {
        if (typeof node.id === 'string') this.index.set(node.id, { node, parent, index });
        const children = (node as { children?: Node[] }).children;
        if (Array.isArray(children)) visit(children, node);
      });
    };
    visit(this.data.children, null);
  }

  get(id: string): Node | undefined {
    return this.locate(id)?.node;
  }

  locate(id: string): Located | undefined {
    const colon = id.indexOf(':');
    if (colon > 0) return this.imports.get(id.slice(0, colon))?.locate(id.slice(colon + 1));
    return this.index.get(id);
  }

  has(id: string): boolean {
    return this.locate(id) !== undefined;
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
