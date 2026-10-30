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
  if (!found) throw new ExecError(`instance "${first}" has no descendant "${rest.join('/')}"`);
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

/**
 * Turn `descendants` keys into id paths relative to the component: keys may already be ids or paths,
 * or unique names of descendants.
 */
export function normalizeDescendantKeys(doc: PenDoc, componentId: string, descendants: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const comp = doc.get(componentId);
  const tree = comp ? expandTree(doc, comp) : undefined;
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(descendants)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ExecError(`descendants["${key}"] must be an object of properties or a node`);
    let id = key;
    if (tree && !findById(tree, key) && !(comp?.type === 'ref' && hasPath(doc, comp as RefNode, key))) {
      const byName = tree ? findUniqueByName(tree, key, key) : undefined;
      if (!byName) throw new ExecError(`component "${componentId}" has no descendant "${key}"`);
      id = byName.id;
    }
    out[id] = value as Record<string, unknown>;
  }
  return out;
}

/** For a component that is itself an instance, descendant keys address the inner component. */
function hasPath(doc: PenDoc, ref: RefNode, key: string): boolean {
  const inner = doc.get(ref.ref);
  const tree = inner ? expandTree(doc, inner) : undefined;
  return !!tree && !!findById(tree, key);
}

/** The node `key` (an id path relative to the component) names inside component `comp`, as expanded. */
export function componentDescendant(doc: PenDoc, comp: Node, key: string): Node | undefined {
  const tree = expandTree(doc, comp);
  return tree ? findById(tree, comp.type === 'ref' ? `${comp.id}/${key}` : key) : undefined;
}

/** Root type of a component as instances see it (a reusable instance stands for its own component). */
export function componentRoot(doc: PenDoc, comp: Node): Node | undefined {
  return comp.type === 'ref' ? expandTree(doc, comp) : comp;
}
