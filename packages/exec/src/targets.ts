import type { Node, RefNode } from '@nib/format';
import { childrenOf, expandTree, type PenDoc } from '@nib/core';
import { ExecError } from './errors.ts';

/**
 * Where a path points. Plain ids name document nodes. `instanceId/childId` (any depth) names a node as
 * seen inside a component instance; changing it writes overrides into the instance's `descendants`.
 */
export type Target =
  | { kind: 'node'; node: Node }
  | { kind: 'inside'; path: string; ref: RefNode; key: string; expanded: Node };

export const DOCUMENT = 'document';

export function resolve(doc: PenDoc, path: string): Target {
  if (typeof path !== 'string' || !path) throw new ExecError(`expected a node id or path string, got ${JSON.stringify(path)}; pass node.id, not the node`);
  if (!path.includes('/')) {
    const node = doc.get(path);
    if (!node) throw new ExecError(`node "${path}" not found`);
    return { kind: 'node', node };
  }
  const [first, ...rest] = path.split('/');
  const ref = doc.get(first);
  if (!ref) throw new ExecError(`node "${first}" not found (in path "${path}")`);
  if (ref.type !== 'ref') throw new ExecError(`"${first}" is a ${ref.type}, not a component instance; slash paths only address nodes inside instances`);
  const tree = expandTree(doc, ref);
  if (!tree) throw new ExecError(`instance "${first}" cannot be expanded: its component is missing`);
  let found = findById(tree, path);
  if (!found && rest.length === 1) found = findUniqueByName(tree, rest[0], path);
  if (!found) {
    const parts = partsOf(doc, (ref as RefNode).ref);
    throw new ExecError(`instance "${first}" has no descendant "${rest.join('/')}"${parts.length ? `; its texts and icons are ${describeParts(parts)}` : ''}`);
  }
  return { kind: 'inside', path: found.id, ref: ref as RefNode, key: found.id.slice(first.length + 1), expanded: found };
}

export function findById(tree: Node, id: string): Node | undefined {
  if (tree.id === id) return tree;
  for (const c of childrenOf(tree) ?? []) {
    const hit = findById(c, id);
    if (hit) return hit;
  }
  return undefined;
}

function findUniqueByName(tree: Node, name: string, path: string): Node | undefined {
  const hits: Node[] = [];
  const visit = (n: Node) => { if (n !== tree && n.name === name) hits.push(n); childrenOf(n)?.forEach(visit); };
  visit(tree);
  if (hits.length > 1) throw new ExecError(`"${path}": several descendants are named "${name}"; use the id path`);
  return hits[0];
}

/** Id prefix of the instance `componentTree` expands. */
const PROBE = '__component';

/**
 * Component `refId` (an id, or `alias:id` for an imported one) as an instance of it would show it: nested
 * instances expanded, references inside an imported component resolved in its own document. Node ids are
 * `__component/<key>`, where key is what `descendants` overrides use.
 */
export function componentTree(doc: PenDoc, refId: string): Node | undefined {
  return expandTree(doc, { type: 'ref', id: PROBE, ref: refId } as unknown as Node);
}

const keyOf = (n: Node) => n.id.slice(PROBE.length + 1);

/** A text or icon inside a component that instances can change, by its override key. */
export interface Part { key: string; kind: 'text' | 'icon'; value: string }

/** The visible texts and icons of component `refId` (nested instances' too), at most `limit`. */
export function partsOf(doc: PenDoc, refId: string, limit = 12): Part[] {
  const tree = componentTree(doc, refId);
  const out: Part[] = [];
  const visit = (n: Node) => {
    if (out.length >= limit || n.enabled === false) return;
    if (n !== tree && n.type === 'text') out.push({ key: keyOf(n), kind: 'text', value: String(n.content ?? '') });
    else if (n !== tree && n.type === 'icon') out.push({ key: keyOf(n), kind: 'icon', value: String((n as { icon?: unknown }).icon ?? '') });
    childrenOf(n)?.forEach(visit);
  };
  if (tree) visit(tree);
  return out;
}

export const describeParts = (parts: Part[]) => parts.map((p) => `"${p.key}" (${p.kind} ${JSON.stringify(p.value.slice(0, 32))})`).join(', ');

/**
 * Turn `descendants` keys into id paths relative to the component: keys may already be ids or paths,
 * or unique names of descendants. A string value is shorthand for a text's content or an icon's name.
 */
export function normalizeDescendantKeys(doc: PenDoc, refId: string, descendants: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const tree = componentTree(doc, refId);
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(descendants)) {
    let node = tree ? findById(tree, `${PROBE}/${key}`) : undefined;
    if (tree && !node) {
      node = findUniqueByName(tree, key, key);
      if (!node) {
        const parts = partsOf(doc, refId);
        throw new ExecError(`component "${refId}" has no descendant "${key}"${parts.length ? `; its texts and icons are ${describeParts(parts)}` : ''}`);
      }
    }
    const id = node ? keyOf(node) : key;
    if (typeof value === 'string') {
      if (node?.type === 'text') out[id] = { content: value };
      else if (node?.type === 'icon') out[id] = { icon: value };
      else throw new ExecError(`descendants["${key}"]: a string sets a text's content or an icon's name, but this is a ${node?.type ?? 'missing node'}; give an object of properties`);
      continue;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ExecError(`descendants["${key}"] must be an object of properties, a node, or a string for a text or icon`);
    out[id] = value as Record<string, unknown>;
  }
  return out;
}

/** The node `key` (an override key) names inside component `refId`, as an instance shows it. */
export function componentDescendant(doc: PenDoc, refId: string, key: string): Node | undefined {
  const tree = componentTree(doc, refId);
  return tree ? findById(tree, `${PROBE}/${key}`) : undefined;
}

/**
 * The component of the nested instance `key` inside component `refId`, as a reference that resolves from
 * this document (`alias:id` when the outer component is imported), or undefined when `key` is no instance.
 */
export function nestedComponent(doc: PenDoc, refId: string, key: string): string | undefined {
  let ref = refId;
  for (const seg of key.split('/')) {
    let root = doc.get(ref);
    // A reusable instance addresses its own component's nodes.
    while (root?.type === 'ref') { ref = qualifiedRef(ref, (root as RefNode).ref); root = doc.get(ref); }
    const hit = root ? findById(root, seg) : undefined;
    if (hit?.type !== 'ref') return undefined;
    ref = qualifiedRef(ref, (hit as RefNode).ref);
  }
  return ref;
}

/** A reference written inside the component `from` points into the same document as `from`. */
function qualifiedRef(from: string, ref: string): string {
  const colon = from.lastIndexOf(':');
  return colon > 0 ? `${from.slice(0, colon + 1)}${ref}` : ref;
}

/** Root type of a component as instances see it (a reusable instance stands for its own component). */
export function componentRoot(doc: PenDoc, refId: string): Node | undefined {
  return componentTree(doc, refId);
}
