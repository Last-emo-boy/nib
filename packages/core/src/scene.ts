import type { Node, NodeType } from '@nib/format';
import type { PenDoc } from './doc.ts';
import { expandTree, INSTANCE, type ExpandIssue } from './instances.ts';

/** On a scene node: the node before variables were resolved (its `$name` references), for code export. */
export const UNRESOLVED = Symbol('nib.unresolved');
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
  /** The layers a script node draws (from running its script); none: it draws only its own fill. */
  scripts?: (node: Node) => Node[] | undefined;
  /** Theme values that win over every node's own (the editor previewing all frames in one language). */
  force?: ThemeContext;
}

const scriptSources = new WeakMap<PenDoc, NonNullable<SceneOptions['scripts']>>();

/** Where `doc`'s script nodes get their layers when a scene is built: the session or editor holding it. */
export function setScriptSource(doc: PenDoc, source: SceneOptions['scripts'] | undefined): void {
  if (source) scriptSources.set(doc, source); else scriptSources.delete(doc);
}

export function buildScene(doc: PenDoc, node: Node, opts: SceneOptions = {}): SceneNode | undefined {
  const expanded = expandTree(doc, node, { issues: opts.issues });
  if (!expanded) return undefined;
  const start = opts.theme ?? inheritedTheme(doc, node.id);
  return resolveNode(doc, expanded, opts.force ? { ...start, ...opts.force } : start, { scripts: opts.scripts ?? scriptSources.get(doc), force: opts.force });
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

function resolveNode(doc: PenDoc, node: Node, outer: ThemeContext, ro: { scripts?: SceneOptions['scripts']; force?: ThemeContext }): SceneNode | undefined {
  const own = withTheme(outer, node.theme);
  const ctx = ro.force ? { ...own, ...ro.force } : own;
  const out = { ...resolveDeep(doc, node, ctx) } as SceneNode;
  if (out.enabled === false) return undefined;
  const marks = out as unknown as Record<symbol, unknown>;
  marks[UNRESOLVED] = node;
  if (INSTANCE in node) marks[INSTANCE] = (node as unknown as Record<symbol, unknown>)[INSTANCE];
  // A script node holds what its script made, placed freely in its box (scene only: never stored).
  const made = node.type === 'script' ? ro.scripts?.(node) : undefined;
  if (node.type === 'script') out.layout = 'none';
  const children = made ?? (node as { children?: Node[] }).children;
  if (children) {
    out.children = [];
    for (const c of children) {
      const r = resolveNode(doc, c, ctx, ro);
      if (r) out.children.push(r);
    }
  }
  return out;
}
