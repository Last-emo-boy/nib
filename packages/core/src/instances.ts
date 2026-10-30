import type { Node, RefNode } from '@nib/format';
import type { PenDoc } from './doc.ts';

type Props = Record<string, unknown>;
/** Override entries keyed by id path relative to an instance. */
type Overrides = ReadonlyMap<string, Props>;

/** Instance properties that are not overrides of the component root. */
const INSTANCE_KEYS = new Set(['id', 'type', 'ref', 'descendants']);
const MAX_NESTING = 64;

export interface ExpandIssue {
  /** Id path of the instance. */
  instance: string;
  message: string;
}

export interface ExpandOptions {
  /** Collects missing components, cycles, and override keys that match nothing. */
  issues?: ExpandIssue[];
}

/**
 * Copy of `node`'s subtree with every `ref` replaced by the component tree it points to.
 * Nodes inside an instance get id paths (`instanceId/childId`, `outer/inner/childId`).
 * Instances whose component is missing are dropped and reported.
 */
export function expandTree(doc: PenDoc, node: Node, opts: ExpandOptions = {}): Node | undefined {
  return new Expander(doc, opts.issues).node(node, undefined);
}

class Expander {
  private stack: string[] = [];
  private doc: PenDoc;
  private issues: ExpandIssue[] | undefined;
  private importedCache = new Map<string, Node | undefined>();

  constructor(doc: PenDoc, issues: ExpandIssue[] | undefined) {
    this.doc = doc;
    this.issues = issues;
  }

  /** A node outside of any instance, or inside one when `scope` is set. */
  node(node: Node, scope: Scope | undefined): Node | undefined {
    if (node.type === 'ref') {
      const id = scope ? `${scope.prefix}/${node.id}` : node.id;
      return this.instance(node, id, scope?.sub(node.id));
    }
    const out = { ...node } as Props;
    if (scope) out.id = `${scope.prefix}/${node.id}`;
    const children = (node as { children?: Node[] }).children;
    if (children) out.children = this.children(children, scope);
    return out as unknown as Node;
  }

  private children(children: Node[], scope: Scope | undefined): Node[] {
    const out: Node[] = [];
    for (const child of children) {
      const expanded = scope ? this.scoped(child, scope) : this.node(child, undefined);
      if (expanded) out.push(expanded);
    }
    return out;
  }

  /** A component node seen through an instance: apply that instance's override for it, if any. */
  private scoped(child: Node, scope: Scope): Node | undefined {
    const entry = scope.take(child.id);
    if (entry && 'type' in entry) return this.node(entry as unknown as Node, scope);
    if (child.type === 'ref') {
      const inst = this.instance(child, `${scope.prefix}/${child.id}`, scope.sub(child.id));
      if (inst && entry) applyProps(inst as unknown as Props, entry, this, scope);
      return inst;
    }
    const out = this.node(child, scope);
    if (out && entry) applyProps(out as unknown as Props, entry, this, scope);
    return out;
  }

  /**
   * The component `ref` points to. One from an imported document (`alias:id`) comes with its own
   * references (nested components, variables it defines) prefixed by the alias, so they resolve there.
   */
  private component(ref: string): Node | undefined {
    const colon = ref.lastIndexOf(':');
    if (colon <= 0) return this.doc.get(ref);
    if (!this.importedCache.has(ref)) {
      const prefix = ref.slice(0, colon);
      const lib = importedDoc(this.doc, prefix);
      const comp = this.doc.get(ref);
      this.importedCache.set(ref, comp && lib ? (qualify(comp, prefix, lib) as Node) : comp);
    }
    return this.importedCache.get(ref);
  }

  private instance(ref: RefNode, id: string, outer: Overrides | undefined): Node | undefined {
    const comp = this.component(ref.ref);
    if (!comp) {
      this.issues?.push({ instance: id, message: `component "${ref.ref}" not found` });
      return undefined;
    }
    if (this.stack.includes(ref.ref) || this.stack.length >= MAX_NESTING) {
      this.issues?.push({ instance: id, message: `component "${ref.ref}" contains itself` });
      return undefined;
    }
    this.stack.push(ref.ref);
    const scope = new Scope(id, merge(ref.descendants, outer));
    let root: Props | undefined;
    if (comp.type === 'ref') {
      // A reusable instance: its own overrides and this instance's both address the inner component.
      root = this.instance(comp, id, scope.remaining()) as Props | undefined;
    } else {
      root = { ...comp, id } as Props;
      const children = (comp as { children?: Node[] }).children;
      if (children) root.children = this.children(children, scope);
    }
    this.stack.pop();
    if (!root) return undefined;
    for (const [k, v] of Object.entries(ref)) if (!INSTANCE_KEYS.has(k)) root[k] = v;
    root.id = id;
    if (!ref.reusable) delete root.reusable;
    if (comp.type !== 'ref') for (const key of scope.unused()) {
      this.issues?.push({ instance: id, message: `override "${key}" matches no descendant of "${ref.ref}"` });
    }
    return root as unknown as Node;
  }

  /** Children given by an override entry replace the component's children. */
  replacementChildren(children: Node[], scope: Scope): Node[] {
    return this.children(children, scope);
  }
}

function applyProps(target: Props, entry: Props, ex: Expander, scope: Scope) {
  for (const [k, v] of Object.entries(entry)) {
    if (k === 'id' || k === 'type') continue;
    target[k] = k === 'children' && Array.isArray(v) ? ex.replacementChildren(v as Node[], scope) : v;
  }
}

/** The overrides visible inside one instance, and which of them were used. */
class Scope {
  readonly prefix: string;
  private map: Map<string, Props>;
  private used: Set<string>;

  constructor(prefix: string, map: Map<string, Props>, used = new Set<string>()) {
    this.prefix = prefix;
    this.map = map;
    this.used = used;
  }

  take(key: string): Props | undefined {
    const e = this.map.get(key);
    if (e) this.used.add(key);
    return e;
  }

  /** Overrides addressed to the nested instance `key`, re-keyed relative to it. */
  sub(key: string): Overrides | undefined {
    let out: Map<string, Props> | undefined;
    const p = `${key}/`;
    for (const [k, v] of this.map) {
      if (!k.startsWith(p)) continue;
      (out ??= new Map()).set(k.slice(p.length), v);
      this.used.add(k);
    }
    return out;
  }

  remaining(): Overrides {
    for (const k of this.map.keys()) this.used.add(k);
    return this.map;
  }

  unused(): string[] {
    return [...this.map.keys()].filter((k) => !this.used.has(k));
  }
}

/** An instance's own overrides, with overrides from enclosing instances taking precedence. */
function merge(own: RefNode['descendants'], outer: Overrides | undefined): Map<string, Props> {
  const map = new Map<string, Props>(Object.entries(own ?? {}));
  if (outer) for (const [k, v] of outer) {
    const base = map.get(k);
    map.set(k, base && !('type' in v) ? { ...base, ...v } : v);
  }
  return map;
}

/** The document imported under `prefix` (`alias` or `alias:inner` for a library's own imports). */
function importedDoc(doc: PenDoc, prefix: string): PenDoc | undefined {
  let d: PenDoc | undefined = doc;
  for (const alias of prefix.split(':')) d = d?.imports.get(alias);
  return d;
}

/** Copy of a node from the document imported as `prefix`, its component and variable references prefixed. */
function qualify(value: unknown, prefix: string, lib: PenDoc, key?: string): unknown {
  if (typeof value === 'string') {
    if (key === 'ref') return `${prefix}:${value}`;
    if (value.length > 1 && value.startsWith('$') && lib.variable(value.slice(1))) return `$${prefix}:${value.slice(1)}`;
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => (key === 'slot' && typeof v === 'string' ? `${prefix}:${v}` : qualify(v, prefix, lib)));
  if (value && typeof value === 'object') {
    const out: Props = {};
    for (const [k, v] of Object.entries(value)) out[k] = k === 'id' ? v : qualify(v, prefix, lib, k);
    return out;
  }
  return value;
}
