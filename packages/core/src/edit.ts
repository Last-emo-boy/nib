import type { Node, PenDocument, Variable } from '@nib/format';
import { childrenOf, type PenDoc } from './doc.ts';

/**
 * One reversible change to a document. Ops are plain JSON so they can be sent to other views of the
 * same document and replayed there.
 */
export type Op =
  | { op: 'set'; id: string; props: Record<string, unknown>; unset?: string[]; order?: string[] }
  | { op: 'insert'; parent: string | null; index: number; node: Node }
  | { op: 'remove'; parent: string | null; index: number }
  | { op: 'document'; props: Record<string, unknown>; unset?: string[]; order?: string[] };

export class EditError extends Error {}

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A random 5-character id, like the ones pen.dev writes, not used anywhere in `doc`. */
export function newId(doc: PenDoc, taken?: Set<string>): string {
  for (;;) {
    let id = '';
    for (let i = 0; i < 5; i++) id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
    if (!doc.has(id) && !taken?.has(id)) return id;
  }
}

/** Give `node` and its descendants fresh ids, returning old id -> new id. */
export function reassignIds(doc: PenDoc, node: Node, map = new Map<string, string>()): Map<string, string> {
  const taken = new Set(map.values());
  const visit = (n: Node) => {
    const fresh = newId(doc, taken);
    taken.add(fresh);
    if (typeof n.id === 'string') map.set(n.id, fresh);
    (n as { id: string }).id = fresh;
    for (const c of childrenOf(n) ?? []) visit(c);
  };
  visit(node);
  return map;
}

/**
 * Applies ops to a document and records their inverses. Changes made between `begin()` and `commit()`
 * form one transaction that `rollback()` undoes.
 */
export class DocEditor {
  readonly doc: PenDoc;
  private forward: Op[] = [];
  private inverse: Op[] = [];
  private open = false;

  constructor(doc: PenDoc) {
    this.doc = doc;
  }

  begin(): void {
    if (this.open) throw new EditError('a transaction is already open');
    this.open = true;
    this.forward = [];
    this.inverse = [];
  }

  /** End the transaction; returns the ops applied and the ops that undo them (in undo order). */
  commit(): { ops: Op[]; undo: Op[] } {
    this.open = false;
    return { ops: this.forward, undo: this.inverse.slice().reverse() };
  }

  rollback(): void {
    for (let i = this.inverse.length - 1; i >= 0; i--) applyOp(this.doc, this.inverse[i]);
    this.open = false;
    this.forward = [];
    this.inverse = [];
  }

  apply(op: Op): void {
    const inv = applyOp(this.doc, op);
    if (this.open) {
      this.forward.push(op);
      this.inverse.push(inv);
    }
  }

  insert(parent: Node | null, node: Node, index?: number): Node {
    const siblings = this.doc.siblings(parent);
    this.apply({ op: 'insert', parent: parent?.id ?? null, index: index ?? siblings.length, node });
    return node;
  }

  remove(id: string): Node {
    const at = this.doc.locate(id);
    if (!at) throw new EditError(`node "${id}" not found`);
    this.apply({ op: 'remove', parent: at.parent?.id ?? null, index: at.index });
    return at.node;
  }

  /** Set properties; `undefined` removes one. */
  set(id: string, props: Record<string, unknown>): void {
    const set: Record<string, unknown> = {};
    const unset: string[] = [];
    for (const [k, v] of Object.entries(props)) (v === undefined ? unset.push(k) : (set[k] = v));
    this.apply({ op: 'set', id, props: set, ...(unset.length ? { unset } : {}) });
  }

  move(id: string, parent: Node | null, index?: number): void {
    const node = this.remove(id);
    const siblings = this.doc.siblings(parent);
    this.insert(parent, node, index === undefined ? siblings.length : Math.max(0, Math.min(index, siblings.length)));
  }

  /** Change top-level document fields such as `variables` and `themes`. */
  setDocument(props: Partial<Pick<PenDocument, 'variables' | 'themes' | 'imports'>>): void {
    const set: Record<string, unknown> = {};
    const unset: string[] = [];
    for (const [k, v] of Object.entries(props)) (v === undefined ? unset.push(k) : (set[k] = v));
    this.apply({ op: 'document', props: set, ...(unset.length ? { unset } : {}) });
  }

  setVariables(variables: Record<string, Variable>, themes?: Record<string, string[]>): void {
    this.setDocument({ variables, ...(themes ? { themes } : {}) });
  }
}

/** Apply one op and return its inverse. */
export function applyOp(doc: PenDoc, op: Op): Op {
  switch (op.op) {
    case 'set': {
      const node = doc.get(op.id) as Record<string, unknown> | undefined;
      if (!node) throw new EditError(`node "${op.id}" not found`);
      for (const k of ['id', 'children']) {
        if (k in op.props || op.unset?.includes(k)) throw new EditError(`"${k}" cannot be set; use insert/remove ops`);
      }
      const { props, unset, order } = swap(node, op.props, op.unset, op.order);
      return { op: 'set', id: op.id, props, ...(unset.length ? { unset } : {}), order };
    }
    case 'document': {
      const { props, unset, order } = swap(doc.data as Record<string, unknown>, op.props, op.unset, op.order);
      return { op: 'document', props, ...(unset.length ? { unset } : {}), order };
    }
    case 'insert': {
      const parent = op.parent === null ? null : doc.get(op.parent) ?? null;
      if (op.parent !== null && !parent) throw new EditError(`parent "${op.parent}" not found`);
      doc.siblings(parent).splice(op.index, 0, op.node);
      doc.indexSubtree(op.node, parent);
      return { op: 'remove', parent: op.parent, index: op.index };
    }
    case 'remove': {
      const parent = op.parent === null ? null : doc.get(op.parent) ?? null;
      const siblings = doc.siblings(parent);
      const [node] = siblings.splice(op.index, 1);
      if (!node) throw new EditError(`nothing to remove at ${op.parent ?? 'document'}[${op.index}]`);
      doc.unindexSubtree(node);
      return { op: 'insert', parent: op.parent, index: op.index, node };
    }
  }
}

/**
 * Write `props` into `target`, delete `unset`, and return what restores the previous state, including the
 * previous key order (so undo gives back byte-identical files). With `order`, keys are arranged in it.
 */
function swap(target: Record<string, unknown>, props: Record<string, unknown>, unset: string[] | undefined, order: string[] | undefined) {
  const previousOrder = Object.keys(target);
  const back: Record<string, unknown> = {};
  const backUnset: string[] = [];
  const remember = (k: string) => {
    if (Object.prototype.hasOwnProperty.call(target, k)) back[k] = target[k];
    else backUnset.push(k);
  };
  for (const [k, v] of Object.entries(props)) { remember(k); target[k] = v; }
  for (const k of unset ?? []) { if (!(k in props)) { remember(k); delete target[k]; } }
  if (order) reorder(target, order);
  return { props: back, unset: backUnset.filter((k) => !(k in back)), order: previousOrder };
}

function reorder(target: Record<string, unknown>, order: string[]) {
  const entries = Object.entries(target);
  const rank = new Map(order.map((k, i) => [k, i]));
  entries.sort((a, b) => (rank.get(a[0]) ?? order.length) - (rank.get(b[0]) ?? order.length));
  for (const [k] of entries) delete target[k];
  for (const [k, v] of entries) target[k] = v;
}
