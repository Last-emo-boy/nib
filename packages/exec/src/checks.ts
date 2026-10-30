import type { Node } from '@nib/format';
import { childrenOf, inheritedTheme, resolveDeep, type PenDoc, type SceneNode } from '@nib/core';
import { fontWeight, isFontIconLibrary, type Renderer } from '@nib/render';
import type { BoundsCache } from './bounds.ts';

type Axis = 'width' | 'height';
const AXES: Axis[] = ['width', 'height'];
const FILL_RE = /^fill_container(?:\(\s*(-?\d+(?:\.\d+)?)\s*\))?$/;

const label = (n: { id: string; name?: unknown }) => (typeof n.name === 'string' ? `"${n.name}" (${n.id})` : n.id);

/** A problem with a node, worded for both people and agents. */
export interface Problem {
  id: string;
  message: string;
}

/** Collects problems once each. */
class Problems {
  private seen = new Set<string>();
  readonly list: Problem[] = [];
  add(id: string, message: string): void {
    if (this.seen.has(message)) return;
    this.seen.add(message);
    this.list.push({ id, message });
  }
}

/**
 * Layout mistakes in and around the nodes a snippet changed: sizes that collapse to zero, and
 * `fill_container` where nothing lays the node out.
 */
export function layoutIssues(doc: PenDoc, bounds: BoundsCache, ids: Iterable<string>): Problem[] {
  const out = new Problems();
  const seen = new Set<Node>();
  const consider = (node: Node, parent: Node | null) => {
    if (seen.has(node)) return;
    seen.add(node);
    const box = bounds.box(node.id);
    if (!box) return;
    const ctx = inheritedTheme(doc, node.id);
    const val = (n: Node, k: string) => resolveDeep(doc, (n as Record<string, unknown>)[k], ctx);
    for (const axis of AXES) {
      const v = val(node, axis);
      const fill = typeof v === 'string' ? FILL_RE.exec(v) : null;
      if (!fill) continue;
      let why: string | undefined;
      if (!parent) why = 'it sits directly on the canvas';
      else if (node.layoutPosition === 'absolute') why = 'it is positioned absolutely';
      else if (parent.type === 'group') why = 'its parent is a group';
      else if (val(parent, 'layout') === 'none') why = 'its parent has layout "none"';
      if (why) out.add(node.id, `${label(node)} has ${axis} fill_container, but ${why}, so nothing gives it a size and it falls back to ${fill[1] ?? 0}px. Put it in a frame with layout "horizontal" or "vertical", or give it a fixed ${axis}.`);
    }
    if (node.type !== 'frame') return;
    for (const axis of AXES) {
      const v = val(node, axis) ?? 'fit_content';
      if (typeof v !== 'string' || !v.startsWith('fit_content') || box[axis] >= 0.5) continue;
      const kids = (childrenOf(node) ?? []).filter((k) => val(k, 'enabled') !== false);
      const flow = val(node, 'layout') === 'none' ? [] : kids.filter((k) => k.layoutPosition !== 'absolute');
      if (!kids.length) {
        out.add(node.id, `${label(node)} is fit_content in ${axis} but has no children, so its ${axis} collapses to 0 and it is invisible. Add children, or give it a fixed or fill_container ${axis}.`);
      } else if (!flow.length) {
        out.add(node.id, `${label(node)} is fit_content in ${axis}, but its children are placed by x/y (layout "none" or absolute) and do not size it, so its ${axis} collapses to 0. Give it a fixed ${axis}.`);
      } else if (flow.some((k) => { const s = val(k, axis); return typeof s === 'string' && FILL_RE.test(s); })) {
        out.add(node.id, `${label(node)} is fit_content in ${axis} while its children fill_container in ${axis}: each waits for the other, so both collapse to 0. Give ${label(node)} a fixed ${axis}, or the children a fixed or fit_content ${axis}.`);
      }
    }
  };
  for (const id of ids) {
    const at = doc.locate(id);
    if (!at) continue;
    consider(at.node, at.parent);
    if (at.parent) consider(at.parent, doc.locate(at.parent.id)?.parent ?? null);
  }
  return out.list;
}

/** Icons, fonts and images the changed nodes use that could not be loaded. Call after loading their scenes. */
export function assetIssues(renderer: Renderer, scenes: SceneNode[], ids: Set<string>, imageFailures: [string, string][]): Problem[] {
  const out = new Problems();
  const missingFonts = renderer.fonts.missing();
  const failed = new Map(imageFailures);
  const visit = (n: SceneNode) => {
    if (ids.has(n.id)) {
      if (n.type === 'icon' && typeof n.icon === 'string') {
        const library = String(n.library ?? 'lucide');
        const weight = typeof n.weight === 'number' ? n.weight : undefined;
        if (!isFontIconLibrary(library) && renderer.hasIcon(library, n.icon, weight) === false) {
          out.add(n.id, `icon "${n.icon}" on ${label(n)} is not in the "${library}" icon set; it draws nothing.`);
        }
      }
      if (n.type === 'text' || n.type === 'note' || n.type === 'prompt' || n.type === 'context') {
        const family = typeof n.fontFamily === 'string' ? n.fontFamily : 'Inter';
        const weight = fontWeight(n.fontWeight);
        if (missingFonts.some((f) => f.family.toLowerCase() === family.toLowerCase() && f.weight === weight) && !renderer.fonts.has(family)) {
          out.add(n.id, `font "${family}" is not available (used by ${label(n)}); the text is drawn in a fallback font.`);
        }
      }
      for (const f of [n.fill, n.stroke].flat()) {
        const url = f && typeof f === 'object' && (f as { type?: unknown }).type === 'image' ? (f as { url?: unknown }).url : undefined;
        if (typeof url === 'string' && failed.has(url)) out.add(n.id, `image "${url}" on ${label(n)} could not be loaded: ${failed.get(url)}.`);
      }
    }
    n.children?.forEach(visit);
  };
  scenes.forEach(visit);
  return out.list;
}

/** Keys whose strings are text or identifiers, never variable references. */
const LITERAL_KEYS = new Set(['id', 'type', 'name', 'content', 'context', 'metadata', 'href', 'url', 'icon', 'library', 'ref', 'children', 'descendants', 'geometry']);

/** `"$name"` references in the changed nodes that name no variable (they are drawn as if unset). */
export function variableIssues(doc: PenDoc, ids: Iterable<string>): Problem[] {
  const out = new Problems();
  for (const id of ids) {
    const node = doc.get(id);
    if (!node) continue;
    const visit = (v: unknown, key: string) => {
      if (typeof v === 'string') {
        if (v.length > 1 && v.startsWith('$') && !doc.variable(v.slice(1))) out.add(node.id, `"${v}" (${key} of ${label(node)}) is not a variable, so it has no effect. Define it with SetVariables or use a value.`);
      } else if (Array.isArray(v)) v.forEach((x) => visit(x, key));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!LITERAL_KEYS.has(k)) visit(x, key);
    };
    for (const [k, v] of Object.entries(node)) if (!LITERAL_KEYS.has(k)) visit(v, k);
  }
  return out.list;
}
