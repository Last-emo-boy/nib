import { expandTree, type PenDoc } from '@nib/core';
import type { Node } from '@nib/format';

/**
 * Parts of instances: the layers an instance shows from its component. On the canvas they have id paths
 * (`instance/part`, `instance/inner/part` through nested instances); the first segment is the instance in the
 * document, the rest is the key its `descendants` overrides use. Editing a part writes an override.
 */

type Props = Record<string, unknown>;

export const isPart = (id: string) => id.includes('/');
export const ownerOf = (id: string) => (isPart(id) ? id.slice(0, id.indexOf('/')) : id);
export const keyOf = (id: string) => id.slice(id.indexOf('/') + 1);

/** A part as its instance shows it: the component's layer with the instance's overrides applied. */
export function resolvePart(doc: PenDoc, id: string): Node | undefined {
  const owner = doc.get(ownerOf(id));
  if (!owner) return undefined;
  const find = (n: Node): Node | undefined => {
    if (n.id === id) return n;
    for (const c of (n as { children?: Node[] }).children ?? []) { const f = find(c); if (f) return f; }
    return undefined;
  };
  const tree = expandTree(doc, owner);
  return tree ? find(tree) : undefined;
}

/** A layer by id, whether a document node or a part of an instance. */
export const layerOf = (doc: PenDoc, id: string): Node | undefined => (isPart(id) ? resolvePart(doc, id) : doc.get(id));

/** The override the instance holds for a part, if any. */
export function overrideOf(doc: PenDoc, id: string): Props | undefined {
  const owner = doc.get(ownerOf(id)) as { descendants?: Record<string, Props> } | undefined;
  return owner?.descendants?.[keyOf(id)];
}

/**
 * An instance's overrides (`descendants`) with `props` set on the parts at `keys` (`undefined` drops a
 * property's override, so the part shows its component's value again). Empty overrides are removed.
 */
export function withOverrides(descendants: Record<string, Props> | undefined, keys: string[], props: Props): Record<string, Props> | undefined {
  const all = { ...(descendants ?? {}) };
  for (const key of keys) {
    const entry = { ...(all[key] ?? {}) };
    for (const [k, v] of Object.entries(props)) { if (v === undefined) delete entry[k]; else entry[k] = v; }
    if (Object.keys(entry).length) all[key] = entry; else delete all[key];
  }
  return Object.keys(all).length ? all : undefined;
}
