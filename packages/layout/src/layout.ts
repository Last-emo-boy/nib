import type { SceneNode } from '@nib/core';

export interface Box { x: number; y: number; width: number; height: number }
export interface Size2 { width: number; height: number }

/** Size of a text box. Without `maxWidth` the text does not wrap (explicit line breaks still apply). */
export interface TextMeasurer {
  measure(node: SceneNode, maxWidth: number | undefined): Size2;
}

/** Layout boxes, each relative to its parent's top-left corner (the same space as `x`/`y`). */
export class LayoutResult {
  private boxes = new Map<SceneNode, Box>();
  set(node: SceneNode, box: Box): void { this.boxes.set(node, box); }
  box(node: SceneNode): Box {
    const b = this.boxes.get(node);
    if (!b) throw new Error(`node ${node.id} was not laid out`);
    return b;
  }
  get size(): number { return this.boxes.size; }
}

type Sizing =
  | { kind: 'fixed'; value: number }
  | { kind: 'fit' | 'fill'; fallback: number | undefined };

type Axis = 'width' | 'height';
type Dir = 'horizontal' | 'vertical' | 'none';

interface Insets { top: number; right: number; bottom: number; left: number }

/** A laid-out node: its size and where each child goes, with the size request it was laid out at. */
interface Plan {
  size: Size2;
  kids: { node: SceneNode; box: Box; w: number; h: number | undefined }[];
}

const SIZING_RE = /^(fit_content|fill_container)(?:\(\s*(-?\d+(?:\.\d+)?)\s*\))?$/;
const FIT: Sizing = { kind: 'fit', fallback: undefined };
const ZERO: Sizing = { kind: 'fixed', value: 0 };
const NOTE: Sizing = { kind: 'fixed', value: 200 };

function sizing(v: unknown, dflt: Sizing): Sizing {
  if (typeof v === 'number') return { kind: 'fixed', value: v };
  if (typeof v === 'string') {
    const m = SIZING_RE.exec(v);
    if (m) return { kind: m[1] === 'fit_content' ? 'fit' : 'fill', fallback: m[2] === undefined ? undefined : Number(m[2]) };
  }
  return dflt;
}

function insets(p: unknown): Insets {
  if (typeof p === 'number') return { top: p, right: p, bottom: p, left: p };
  if (Array.isArray(p) && p.length === 2) return { top: p[0], right: p[1], bottom: p[0], left: p[1] };
  if (Array.isArray(p) && p.length === 4) return { top: p[0], right: p[1], bottom: p[2], left: p[3] };
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const isContainer = (n: SceneNode) => n.type === 'frame' || n.type === 'group';

/**
 * pen.dev layout: single-axis flex without wrapping.
 * - Frames default to `layout: horizontal` and `fit_content` on both axes.
 * - `fill_container` takes an equal share of the parent's free space on the main axis and the parent's
 *   inner size on the cross axis. It needs a laid-out parent; elsewhere (root, `layout: none`, absolute)
 *   it uses its fallback, default 0. A `fit_content` parent counts a filling child at its fallback, so a
 *   parent whose only children fill it collapses.
 * - `fit_content` is the children's combined size plus padding; frames without flow children use the fallback.
 * - Absolute children, and all children of `layout: none` frames and groups, sit at their `x`/`y`
 *   and take no part in the flow.
 * - Widths resolve before heights, so wrapping text knows its width before its height is measured.
 */
export class LayoutEngine {
  private text: TextMeasurer;
  private plans = new Map<SceneNode, Map<string, Plan>>();
  private widths = new Map<SceneNode, number>();
  private shareCache = new Map<SceneNode, Map<string, Map<SceneNode, number>>>();

  constructor(text: TextMeasurer) {
    this.text = text;
  }

  /** Lay out a root node at its own `x`/`y`. */
  layoutRoot(node: SceneNode, result = new LayoutResult()): LayoutResult {
    const w = this.contribution(node, 'width');
    const hs = this.sizingOf(node, 'height');
    const h = hs.kind === 'fixed' ? hs.value : hs.kind === 'fill' ? hs.fallback ?? 0 : undefined;
    const plan = this.plan(node, w, h);
    result.set(node, { x: num(node.x), y: num(node.y), ...plan.size });
    this.commit(plan, result);
    return result;
  }

  private commit(plan: Plan, result: LayoutResult): void {
    for (const k of plan.kids) {
      result.set(k.node, k.box);
      this.commit(this.plan(k.node, k.w, k.h), result);
    }
  }

  private sizingOf(node: SceneNode, axis: Axis): Sizing {
    switch (node.type) {
      case 'frame': return sizing(node[axis], FIT);
      case 'group': return FIT;
      case 'text': {
        const growth = node.textGrowth ?? 'auto';
        if (growth === 'auto' || (growth === 'fixed-width' && axis === 'height')) return FIT;
        return sizing(node[axis], ZERO);
      }
      case 'note': case 'prompt': case 'context': case 'script': return sizing(node[axis], NOTE);
      default: return sizing(node[axis], ZERO);
    }
  }

  private dir(node: SceneNode): Dir {
    if (node.type !== 'frame') return 'none';
    return node.layout === 'vertical' ? 'vertical' : node.layout === 'none' ? 'none' : 'horizontal';
  }

  private flow(node: SceneNode): SceneNode[] {
    if (this.dir(node) === 'none') return [];
    return (node.children ?? []).filter((k) => k.layoutPosition !== 'absolute');
  }

  private pad(node: SceneNode): Insets {
    return insets(node.type === 'frame' ? node.padding : undefined);
  }

  /** Width or height a node takes when its own size and content decide it (fill counts as its fallback). */
  private contribution(node: SceneNode, axis: Axis, width?: number): number {
    const s = this.sizingOf(node, axis);
    if (s.kind === 'fixed') return s.value;
    if (s.kind === 'fill') return s.fallback ?? 0;
    if (axis === 'width') return this.intrinsicWidth(node);
    return this.plan(node, width ?? this.contribution(node, 'width'), undefined).size.height;
  }

  /** Content width of a `fit_content` node. */
  private intrinsicWidth(node: SceneNode): number {
    let w = this.widths.get(node);
    if (w !== undefined) return w;
    const s = this.sizingOf(node, 'width');
    const fallback = s.kind === 'fixed' ? undefined : s.fallback;
    if (node.type === 'text') w = this.text.measure(node, undefined).width;
    else if (!isContainer(node)) w = fallback ?? 0;
    else {
      const pad = this.pad(node);
      const dir = this.dir(node);
      const flow = this.flow(node);
      const kids = node.children ?? [];
      if (dir === 'none' && kids.length) {
        w = Math.max(...kids.map((k) => num(k.x) + this.contribution(k, 'width')));
      } else if (flow.length === 0) {
        w = fallback ?? pad.left + pad.right;
      } else {
        const sizes = flow.map((k) => this.contribution(k, 'width'));
        w = pad.left + pad.right + (dir === 'horizontal'
          ? sizes.reduce((a, b) => a + b, 0) + num(node.gap) * (flow.length - 1)
          : Math.max(...sizes));
      }
    }
    this.widths.set(node, w);
    return w;
  }

  /** Content height of a `fit_content` container laid out at `width`. */
  private intrinsicHeight(node: SceneNode, width: number): number {
    const s = this.sizingOf(node, 'height');
    const fallback = s.kind === 'fixed' ? undefined : s.fallback;
    const pad = this.pad(node);
    const dir = this.dir(node);
    const kids = node.children ?? [];
    if (dir === 'none' && kids.length) {
      return Math.max(...kids.map((k) => num(k.y) + this.contribution(k, 'height', this.childWidth(k, node, width))));
    }
    const flow = this.flow(node);
    if (flow.length === 0) return fallback ?? pad.top + pad.bottom;
    const sizes = flow.map((k) => this.contribution(k, 'height', this.childWidth(k, node, width)));
    return pad.top + pad.bottom + (dir === 'vertical'
      ? sizes.reduce((a, b) => a + b, 0) + num(node.gap) * (flow.length - 1)
      : Math.max(...sizes));
  }

  /** Width of `child` inside `parent` laid out at `parentWidth`. */
  private childWidth(child: SceneNode, parent: SceneNode, parentWidth: number): number {
    const s = this.sizingOf(child, 'width');
    if (s.kind !== 'fill') return this.contribution(child, 'width');
    const dir = this.dir(parent);
    if (dir === 'none' || child.layoutPosition === 'absolute') return s.fallback ?? 0;
    const pad = this.pad(parent);
    if (dir === 'vertical') return Math.max(0, parentWidth - pad.left - pad.right);
    return this.shares(parent, parentWidth, parentWidth).get(child) ?? 0;
  }

  /** Main-axis sizes of a flex frame's flow children; `fill_container` children split the free space. */
  private shares(frame: SceneNode, mainSize: number, width: number): Map<SceneNode, number> {
    const key = `${mainSize}|${width}`;
    let bySize = this.shareCache.get(frame);
    const hit = bySize?.get(key);
    if (hit) return hit;
    const out = this.computeShares(frame, mainSize, width);
    if (!bySize) this.shareCache.set(frame, (bySize = new Map()));
    bySize.set(key, out);
    return out;
  }

  private computeShares(frame: SceneNode, mainSize: number, width: number): Map<SceneNode, number> {
    const horizontal = this.dir(frame) === 'horizontal';
    const axis: Axis = horizontal ? 'width' : 'height';
    const flow = this.flow(frame);
    const pad = this.pad(frame);
    const inner = horizontal ? mainSize - pad.left - pad.right : mainSize - pad.top - pad.bottom;
    const out = new Map<SceneNode, number>();
    let used = num(frame.gap) * Math.max(0, flow.length - 1);
    const fills: SceneNode[] = [];
    for (const k of flow) {
      if (this.sizingOf(k, axis).kind === 'fill') { fills.push(k); continue; }
      const v = horizontal ? this.contribution(k, 'width') : this.contribution(k, 'height', this.childWidth(k, frame, width));
      out.set(k, v);
      used += v;
    }
    const share = fills.length ? Math.max(0, inner - used) / fills.length : 0;
    for (const k of fills) out.set(k, share);
    return out;
  }

  /** Lay out `node` at `width` (and `height`, when the parent decides it). Memoized per request. */
  private plan(node: SceneNode, width: number, height: number | undefined): Plan {
    const key = `${width}|${height ?? ''}`;
    let byReq = this.plans.get(node);
    const hit = byReq?.get(key);
    if (hit) return hit;
    const plan = this.compute(node, width, height);
    if (!byReq) this.plans.set(node, (byReq = new Map()));
    byReq.set(key, plan);
    return plan;
  }

  private compute(node: SceneNode, width: number, height: number | undefined): Plan {
    if (node.type === 'text') {
      const growth = node.textGrowth ?? 'auto';
      if (growth === 'fixed-width-height') return { size: { width, height: height ?? num(node.height) }, kids: [] };
      const m = this.text.measure(node, growth === 'auto' ? undefined : width);
      return { size: { width: growth === 'auto' ? m.width : width, height: height ?? m.height }, kids: [] };
    }
    if (!isContainer(node)) {
      const s = this.sizingOf(node, 'height');
      return { size: { width, height: height ?? (s.kind === 'fixed' ? s.value : s.fallback ?? 0) }, kids: [] };
    }
    const hs = this.sizingOf(node, 'height');
    const h = height ?? (hs.kind === 'fixed' ? hs.value : this.intrinsicHeight(node, width));
    return { size: { width, height: h }, kids: this.arrange(node, width, h) };
  }

  /** Where a container's children go inside a `width` x `height` box. */
  private arrange(node: SceneNode, width: number, height: number): Plan['kids'] {
    const out: Plan['kids'] = [];
    const dir = this.dir(node);
    const flow = this.flow(node);
    const pad = this.pad(node);
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;

    for (const k of node.children ?? []) {
      if (flow.includes(k)) continue;
      const w = this.childWidth(k, node, width);
      const hs = this.sizingOf(k, 'height');
      const h = hs.kind === 'fixed' ? hs.value : hs.kind === 'fill' ? hs.fallback ?? 0 : undefined;
      out.push({ node: k, box: { x: num(k.x), y: num(k.y), ...this.plan(k, w, h).size }, w, h });
    }
    if (flow.length === 0) return out;

    const horizontal = dir === 'horizontal';
    const shares = this.shares(node, horizontal ? width : height, width);
    const reqs = flow.map((k) => {
      const main = shares.get(k) ?? 0;
      if (!horizontal) return { w: this.childWidth(k, node, width), h: main as number | undefined };
      const hs = this.sizingOf(k, 'height');
      return { w: main, h: hs.kind === 'fixed' ? hs.value : hs.kind === 'fill' ? Math.max(0, innerH) : undefined };
    });
    const sizes = flow.map((k, i) => this.plan(k, reqs[i].w, reqs[i].h).size);

    const gap = num(node.gap);
    const used = sizes.reduce((s, z) => s + (horizontal ? z.width : z.height), 0) + gap * (flow.length - 1);
    const free = (horizontal ? innerW : innerH) - used;
    let offset = 0;
    let step = gap;
    switch (node.justifyContent) {
      case 'center': offset = free / 2; break;
      case 'end': offset = free; break;
      case 'space_between': if (flow.length > 1) step = gap + free / (flow.length - 1); break;
      case 'space_around': offset = free / (2 * flow.length); step = gap + free / flow.length; break;
    }
    let cursor = (horizontal ? pad.left : pad.top) + offset;
    flow.forEach((k, i) => {
      const z = sizes[i];
      const crossFree = horizontal ? innerH - z.height : innerW - z.width;
      const cross = (horizontal ? pad.top : pad.left)
        + (node.alignItems === 'center' ? crossFree / 2 : node.alignItems === 'end' ? crossFree : 0);
      const box = horizontal
        ? { x: cursor, y: cross, width: z.width, height: z.height }
        : { x: cross, y: cursor, width: z.width, height: z.height };
      out.push({ node: k, box, ...reqs[i] });
      cursor += (horizontal ? z.width : z.height) + step;
    });
    return out;
  }
}

export function layoutScene(root: SceneNode, text: TextMeasurer, result?: LayoutResult): LayoutResult {
  return new LayoutEngine(text).layoutRoot(root, result);
}
