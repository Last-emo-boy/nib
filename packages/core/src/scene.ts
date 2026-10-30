import type { Node, NodeType } from '@nib/format';
import type { PenDoc } from './doc.ts';
import { expandTree, type ExpandIssue } from './instances.ts';
import { defaultTheme, resolveDeep, withTheme, type ThemeContext } from './variables.ts';

/**
 * A node ready for layout and rendering: instances expanded (no `ref` nodes), variables resolved,
 * disabled nodes removed. Property names and shapes are those of the .pen format.
 */
export interface SceneNode {
  id: string;
  type: Exclude<NodeType, 'ref'>;
  children?: SceneNode[];
  [key: string]: any;
}

export interface SceneOptions {
  /** Theme axes to start from; default: each axis' first value, then the themes set on `node`'s ancestors. */
  theme?: ThemeContext;
  issues?: ExpandIssue[];
}

export function buildScene(doc: PenDoc, node: Node, opts: SceneOptions = {}): SceneNode | undefined {
  const expanded = expandTree(doc, node, { issues: opts.issues });
  if (!expanded) return undefined;
  return resolveNode(doc, expanded, opts.theme ?? inheritedTheme(doc, node.id));
}

/** Theme context in effect at a document node: defaults overridden by each ancestor's `theme`. */
export function inheritedTheme(doc: PenDoc, id: string): ThemeContext {
  const chain: Node[] = [];
  for (let p = doc.locate(id)?.parent; p; p = doc.locate(p.id)?.parent) chain.unshift(p);
  return chain.reduce((ctx, n) => withTheme(ctx, n.theme), documentTheme(doc));
}

/** Default theme of a document, with the defaults of axes only its imports define (a library's Mode). */
function documentTheme(doc: PenDoc): ThemeContext {
  let ctx: ThemeContext = {};
  for (const lib of doc.imports.values()) ctx = { ...documentTheme(lib), ...ctx };
  return { ...ctx, ...defaultTheme(doc.data) };
}

function resolveNode(doc: PenDoc, node: Node, outer: ThemeContext): SceneNode | undefined {
  const ctx = withTheme(outer, node.theme);
  const out = { ...resolveDeep(doc, node, ctx) } as SceneNode;
  if (out.enabled === false) return undefined;
  const children = (node as { children?: Node[] }).children;
  if (children) {
    out.children = [];
    for (const c of children) {
      const r = resolveNode(doc, c, ctx);
      if (r) out.children.push(r);
    }
  }
  return out;
}
