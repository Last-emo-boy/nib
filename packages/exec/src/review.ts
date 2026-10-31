import type { Node } from '@nib/format';
import { childrenOf, inheritedTheme, resolveDeep, type PenDoc } from '@nib/core';
import { parseColor, type RGBA } from '@nib/render';
import { problemOf } from './bounds.ts';

/**
 * A design review: things a careful designer would point out, found from the document itself (no model
 * needed), worded so a person or an agent can fix them: text that is hard to read against what is behind it
 * (WCAG contrast), text that is too small, links and buttons too small to tap, text cut off by a frame that
 * clips it, layers almost but not quite aligned, and gaps almost but not quite equal.
 */

export type ReviewKind = 'contrast' | 'small-text' | 'touch-target' | 'cut-off' | 'alignment' | 'spacing';
export interface ReviewItem { id: string; kind: ReviewKind; message: string }

type Box = { x: number; y: number; width: number; height: number };
type Props = Record<string, unknown>;

const label = (n: Node) => {
  const content = n.type === 'text' ? (n as { content?: unknown }).content : undefined;
  return typeof n.name === 'string' && n.name ? `"${n.name}"` : typeof content === 'string' ? `"${content.slice(0, 30)}"` : n.id;
};

/** WCAG relative luminance of an sRGB color. */
function luminance([r, g, b]: RGBA): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: RGBA, b: RGBA): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` (with its alpha) over the opaque `bg`. */
const over = (fg: RGBA, bg: RGBA): RGBA => [0, 1, 2].map((k) => fg[k] * fg[3] + bg[k] * (1 - fg[3])).concat(1) as RGBA;

/** The top solid color of a fill value, if its fills are all solid colors (gradients and images: unknown). */
function solid(fill: unknown): RGBA | undefined {
  const list = (Array.isArray(fill) ? fill : fill === undefined ? [] : [fill]).filter((f) => !(f && typeof f === 'object' && (f as Props).enabled === false));
  let out: RGBA | undefined;
  for (const f of list) {
    const c = typeof f === 'string' ? parseColor(f) : f && typeof f === 'object' && (f as Props).type === 'color' ? parseColor((f as Props).color) : undefined;
    if (!c) return undefined;
    out = out ? over(c, out) : c;
  }
  return out;
}

const contains = (o: Box, i: Box) => i.x >= o.x - 0.5 && i.y >= o.y - 0.5 && i.x + i.width <= o.x + o.width + 0.5 && i.y + i.height <= o.y + o.height + 0.5;
const PAINTED = new Set(['frame', 'rectangle', 'ellipse', 'polygon', 'path']);
const TAPPABLE = /button|btn|link|tab\b|toggle|switch|checkbox|radio|chip/i;

export function reviewIssues(doc: PenDoc, box: (id: string) => Box | undefined, scope?: string): ReviewItem[] {
  const out: ReviewItem[] = [];
  const val = (n: Node, k: string) => resolveDeep(doc, (n as Props)[k], inheritedTheme(doc, n.id));
  const tops = scope ? doc.data.children.filter((n) => n.id === scope) : doc.data.children;

  /** The opaque color right behind `n`: a painted layer under it in its parent, or an ancestor's own fill. */
  const backdrop = (n: Node): RGBA | undefined => {
    let cur = n;
    for (let at = doc.locate(cur.id); at?.parent; at = doc.locate(cur.id)) {
      const b = box(cur.id);
      const siblings = childrenOf(at.parent) ?? [];
      for (let i = at.index - 1; i >= 0 && b; i--) {
        const s = siblings[i];
        if (!PAINTED.has(s.type) || val(s, 'enabled') === false) continue;
        const sb = box(s.id);
        if (sb && contains(sb, b)) { const c = solid(val(s, 'fill')); return c && c[3] >= 0.99 ? c : undefined; }
      }
      const own = solid(val(at.parent, 'fill'));
      if (own) return own[3] >= 0.99 ? own : undefined;
      cur = at.parent;
    }
    return undefined;
  };

  const visit = (n: Node, top: Node, parent: Node | undefined) => {
    if (val(n, 'enabled') === false || n.type === 'note' || n.type === 'context' || n.type === 'prompt') return;
    const b = box(n.id);
    if (n.type === 'text' && b && b.width > 0) {
      const size = Number(val(n, 'fontSize') ?? 14);
      const weight = Number(String(val(n, 'fontWeight') ?? '400').replace(/\D/g, '') || 400);
      const fg = solid(val(n, 'fill') ?? '#000000');
      const bg = backdrop(n);
      if (fg && bg) {
        const opacity = Number(val(n, 'opacity') ?? 1);
        const ratio = contrastRatio(over([fg[0], fg[1], fg[2], fg[3] * opacity], bg), bg);
        const large = size >= 24 || (size >= 18.66 && weight >= 700);
        const need = large ? 3 : 4.5;
        if (ratio < need) out.push({ id: n.id, kind: 'contrast', message: `${label(n)} is hard to read: its contrast with what is behind it is ${ratio.toFixed(1)}:1, and ${large ? 'large ' : ''}text needs ${need}:1 (WCAG AA). Darken or lighten the text or its background.` });
      }
      if (size < 11) out.push({ id: n.id, kind: 'small-text', message: `${label(n)} is ${size}px: text under 11px is hard to read. Make it at least 12px.` });
      if (parent && parent.type === 'frame' && val(parent, 'clip') === true) {
        const pb = box(parent.id);
        if (pb && problemOf(b, pb) === 'partially clipped') out.push({ id: n.id, kind: 'cut-off', message: `${label(n)} is cut off: it reaches past ${label(parent)}, which clips what is outside it. Give the text room or let it wrap.` });
      }
    }
    // Things people tap: prototype links, and instances or frames named like controls.
    const meta = (n as Props).metadata as Props | undefined;
    const name = n.type === 'ref' ? `${String(n.name ?? '')} ${String(doc.get((n as Props).ref as string)?.name ?? '')}` : String(n.name ?? '');
    if (b && (meta?.type === 'nib-link' || ((n.type === 'ref' || n.type === 'frame') && TAPPABLE.test(name)))) {
      const mobile = (box(top.id)?.width ?? Infinity) <= 500;
      const min = mobile ? 44 : 24;
      if (b.width < min || b.height < min) out.push({ id: n.id, kind: 'touch-target', message: `${label(n)} is ${Math.round(b.width)}×${Math.round(b.height)}: ${mobile ? 'on a phone, things to tap need at least 44×44' : 'things to click need at least 24×24 (WCAG 2.2)'}. Make it or its tap area larger.` });
    }
    const kids = (childrenOf(n) ?? []).filter((k) => val(k, 'enabled') !== false);
    // Many free-placed children are a pattern or an illustration (dots, a QR code), not a layout.
    if (kids.length >= 2 && kids.length <= 24 && (n.type === 'group' || val(n, 'layout') === 'none')) arrangement(n, kids);
    for (const k of kids) visit(k, top, n);
  };

  /** Free-placed children: edges a few pixels off from each other, and gaps a few pixels unequal. */
  const arrangement = (parent: Node, kids: Node[]) => {
    // Dots and hairlines are decoration: lining them up is not the point.
    const boxes = kids.map((k) => ({ k, b: box(k.id) })).filter((x): x is { k: Node; b: Box } => !!x.b && (x.b.width >= 12 || x.b.height >= 12) && x.b.width > 0 && x.b.height > 0);
    // Two layers lined up on one axis share an edge or center exactly; a few pixels off on every one of
    // them looks like a slip, not a choice.
    const reported = new Set<string>(), pairs = new Set<string>();
    const axes: [string, (b: Box) => number][][] = [
      [['left edge', (b) => b.x], ['right edge', (b) => b.x + b.width], ['horizontal center', (b) => b.x + b.width / 2]],
      [['top edge', (b) => b.y], ['bottom edge', (b) => b.y + b.height], ['vertical center', (b) => b.y + b.height / 2]],
    ];
    // Edges across (left, right) only matter for layers in a column, ones down (top, bottom) in a row.
    const shareColumn = (p: Box, q: Box) => p.x < q.x + q.width && q.x < p.x + p.width;
    const shareRow = (p: Box, q: Box) => p.y < q.y + q.height && q.y < p.y + p.height;
    // The odd one out: a layer lined up exactly with none of the layers beside it, but a few pixels off one.
    for (const a of boxes) {
      for (const [i, edges] of axes.entries()) {
        if (reported.has(a.k.id)) break;
        const mates = boxes.filter((o) => o !== a && (i === 0 ? shareColumn(a.b, o.b) : shareRow(a.b, o.b)));
        const offsOf = (o: { b: Box }) => edges.map(([edge, at]) => ({ edge, d: Math.abs(at(o.b) - at(a.b)) }));
        if (mates.some((o) => offsOf(o).some((x) => x.d <= 0.5))) continue;
        for (const o of mates) {
          const near = offsOf(o).find((x) => x.d <= 3);
          const pair = [a.k.id, o.k.id].sort().join('|');
          if (!near || pairs.has(pair)) continue;
          pairs.add(pair);
          reported.add(a.k.id);
          out.push({ id: a.k.id, kind: 'alignment', message: `${label(a.k)}'s ${near.edge} is ${Math.round(near.d * 10) / 10}px off ${label(o.k)}'s: align them, or move it clearly apart.` });
          break;
        }
      }
    }
    // Rows (and columns) of three or more among them: gaps that are nearly, but not, the same.
    for (const axis of ['x', 'y'] as const) {
      const other = axis === 'x' ? 'y' : 'x';
      const size = axis === 'x' ? 'width' : 'height', across = axis === 'x' ? 'height' : 'width';
      const mid = (b: Box) => b[other] + b[across] / 2;
      const lines: { k: Node; b: Box }[][] = [];
      for (const x of [...boxes].sort((p, q) => mid(p.b) - mid(q.b))) {
        const line = lines.find((l) => Math.abs(mid(l[0].b) - mid(x.b)) < Math.min(l[0].b[across], x.b[across]) / 4);
        if (line) line.push(x); else lines.push([x]);
      }
      for (const line of lines) {
        if (line.length < 3) continue;
        const sorted = line.sort((p, q) => p.b[axis] - q.b[axis]);
        const gaps = sorted.slice(1).map((x, i) => x.b[axis] - (sorted[i].b[axis] + sorted[i].b[size]));
        if (gaps.some((g) => g < 0)) continue;
        const spread = Math.max(...gaps) - Math.min(...gaps);
        if (spread > 0.5 && spread <= 6) out.push({ id: parent.id, kind: 'spacing', message: `The ${axis === 'x' ? 'row' : 'column'} of ${sorted.map((x) => label(x.k)).join(', ')} in ${label(parent)} has gaps of ${gaps.map((g) => Math.round(g)).join(', ')}px: make them equal (or use a layout with a gap).` });
      }
    }
  };

  for (const top of tops) visit(top, top, undefined);
  return out;
}
