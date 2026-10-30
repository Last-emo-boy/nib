import { dirname, isAbsolute, relative, resolve as resolvePath } from 'node:path';
import type { SceneNode } from '@nib/core';
import type { Box, LayoutResult } from '@nib/layout';
import { cornerRadii, fillList, fontWeight, isFontIconLibrary, isItalic, shapePath, type ImageLoader, type Renderer } from '@nib/render';
import type { CapturedScene, ExportOptions } from '@nib/exec';

type Decl = [string, string];
type Dir = 'horizontal' | 'vertical' | 'none';

export interface HtmlContext {
  renderer: Renderer;
  images: ImageLoader;
  /** Folder of the .pen file: image paths in it are relative to this. */
  baseDir: string;
}

const SIZE_RE = /^(fit_content|fill_container)(?:\(\s*(-?\d+(?:\.\d+)?)\s*\))?$/;
const JUSTIFY: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', space_between: 'space-between', space_around: 'space-around' };
const ALIGN: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end' };
const TEXT_TYPES = new Set(['text']);
const SKIPPED = new Set(['note', 'prompt', 'context']);

const px = (v: number) => `${round(v)}px`;
const round = (v: number) => Math.round(v * 100) / 100;
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * HTML for scene nodes. Frames become flexbox containers with the same sizing rules as the canvas
 * (fit_content, fill_container, fixed); free-placed children become absolutely positioned. Shapes that
 * CSS cannot draw become inline SVG. With `tailwind`, styles are utility classes instead of a stylesheet.
 */
export async function exportHtml(scenes: CapturedScene[], outputPath: string, options: ExportOptions, ctx: HtmlContext, tailwind: boolean): Promise<string> {
  const writer = new HtmlWriter(ctx, dirname(outputPath), tailwind, options.includeLayerNames ?? true, options.includeLayerIds ?? false);
  const parts: string[] = [];
  for (const s of scenes) {
    const prepared = await ctx.renderer.prepare(s.root, ctx.images);
    try {
      parts.push(writer.root(s.target, prepared.layout));
    } finally {
      prepared.dispose();
    }
  }
  const body = parts.join('\n');
  if (options.includeHtmlScaffold === false) return tailwind ? `${body}\n` : `<style>\n${writer.css()}\n</style>\n${body}\n`;
  const title = scenes.length === 1 && typeof scenes[0].target.name === 'string' ? scenes[0].target.name : 'nib export';
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
    ...writer.fontLinks(),
    ...(tailwind ? ['<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>'] : []),
    `<style>\n${writer.baseCss(scenes.length > 1)}${tailwind ? '' : `\n${writer.css()}`}\n</style>`,
  ];
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n${head.join('\n')}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

class HtmlWriter {
  private ctx: HtmlContext;
  private outDir: string;
  private tailwind: boolean;
  private names: boolean;
  private ids: boolean;
  private rules: string[] = [];
  private classes = new Map<string, number>();
  private fonts = new Map<string, Set<string>>();
  private materialIcons = new Set<string>();
  private gradients = 0;
  private layout!: LayoutResult;

  constructor(ctx: HtmlContext, outDir: string, tailwind: boolean, names: boolean, ids: boolean) {
    this.ctx = ctx;
    this.outDir = outDir;
    this.tailwind = tailwind;
    this.names = names;
    this.ids = ids;
  }

  root(node: SceneNode, layout: LayoutResult): string {
    this.layout = layout;
    return this.node(node, undefined, 0);
  }

  baseCss(several: boolean): string {
    const body = several ? 'body { margin: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 40px; padding: 40px; }' : 'body { margin: 0; }';
    return `*, *::before, *::after { box-sizing: border-box; margin: 0; }\n${body}`;
  }

  css(): string {
    return this.rules.join('\n');
  }

  fontLinks(): string[] {
    const links: string[] = [];
    if (this.fonts.size) links.push('<link rel="preconnect" href="https://fonts.googleapis.com">', '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
    for (const [family, styles] of this.fonts) {
      const axes = [...styles].sort();
      const italic = axes.some((a) => a.startsWith('1,'));
      const spec = italic ? `ital,wght@${axes.join(';')}` : `wght@${axes.map((a) => a.slice(2)).join(';')}`;
      links.push(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:${spec}&display=swap">`);
    }
    for (const lib of this.materialIcons) {
      links.push(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${lib.replace(/ /g, '+')}">`);
    }
    return links;
  }

  private box(n: SceneNode): Box {
    return this.layout.box(n);
  }

  private node(n: SceneNode, parent: SceneNode | undefined, depth: number): string {
    if (SKIPPED.has(n.type)) return '';
    const decls = [...this.placement(n, parent), ...this.common(n)];
    const indent = '  '.repeat(depth);
    const attrs: string[] = [];
    if (this.names && typeof n.name === 'string') attrs.push(`data-name="${esc(n.name)}"`);
    if (this.ids) attrs.push(`data-id="${esc(n.id)}"`);

    if (TEXT_TYPES.has(n.type)) {
      decls.push(...this.text(n));
      const tag = typeof n.href === 'string' ? 'a' : 'div';
      if (tag === 'a') attrs.push(`href="${esc(n.href)}"`);
      return `${indent}<${tag}${this.attr(n, decls, attrs)}>${esc(n.content === undefined || n.content === null ? '' : String(n.content))}</${tag}>`;
    }
    if (n.type === 'icon') return `${indent}${this.icon(n, decls, attrs)}`;
    if (n.type === 'ellipse' || n.type === 'polygon' || n.type === 'path') {
      const simple = n.type === 'ellipse' && !num(n.innerRadius) && Math.abs(num(n.sweepAngle, 360)) >= 360;
      if (!simple) return `${indent}${this.svgShape(n, decls, attrs)}`;
      decls.push(['border-radius', '50%']);
    }
    decls.push(...this.paint(n));
    if (n.type === 'frame' || n.type === 'group') decls.push(...this.container(n));
    const open = `${indent}<div${this.attr(n, decls, attrs)}>`;
    const kids = (n.children ?? []).map((c) => this.node(c, n, depth + 1)).filter(Boolean);
    return kids.length ? `${open}\n${kids.join('\n')}\n${indent}</div>` : `${open}</div>`;
  }

  /** Position and size, which depend on how the parent lays the node out. */
  private placement(n: SceneNode, parent: SceneNode | undefined): Decl[] {
    const out: Decl[] = [];
    const b = this.box(n);
    const pdir = parent ? dirOf(parent) : 'none';
    const free = !parent || pdir === 'none' || n.layoutPosition === 'absolute';
    if (free) {
      out.push(['position', parent ? 'absolute' : 'relative']);
      if (parent) out.push(['left', px(b.x)], ['top', px(b.y)]);
      // Free nodes take their laid-out size: there is no flex parent to resolve fit or fill against.
      out.push(...this.freeSize(n, b));
      return out;
    }
    out.push(['position', 'relative']);
    const main = pdir === 'horizontal' ? 'width' : 'height';
    const cross = pdir === 'horizontal' ? 'height' : 'width';
    const ms = sizing(n, main), cs = sizing(n, cross);
    if (ms.kind === 'fill') out.push(['flex', '1 1 0'], [`min-${main}`, '0']);
    else {
      out.push(['flex', 'none']);
      if (ms.kind === 'fixed') out.push([main, px(ms.value)]);
      else if (ms.kind === 'zero') out.push([main, px(main === 'width' ? b.width : b.height)]);
    }
    if (cs.kind === 'fill') out.push(['align-self', 'stretch']);
    else if (cs.kind === 'fixed') out.push([cross, px(cs.value)]);
    else if (cs.kind === 'zero') out.push([cross, px(cross === 'width' ? b.width : b.height)]);
    return out;
  }

  private freeSize(n: SceneNode, b: Box): Decl[] {
    const out: Decl[] = [];
    for (const axis of ['width', 'height'] as const) {
      const s = sizing(n, axis);
      if (s.kind === 'fit' && n.type !== 'group' && dirOf(n) !== 'none') continue;
      out.push([axis, px(axis === 'width' ? b.width : b.height)]);
    }
    if (n.type === 'text' && !out.some(([k]) => k === 'width') && (n.textGrowth ?? 'auto') === 'auto') out.push(['width', 'max-content']);
    return out;
  }

  private container(n: SceneNode): Decl[] {
    const out: Decl[] = [];
    const dir = dirOf(n);
    if (dir !== 'none') {
      out.push(['display', 'flex'], ['flex-direction', dir === 'vertical' ? 'column' : 'row']);
      if (num(n.gap)) out.push(['gap', px(num(n.gap))]);
      if (n.justifyContent && n.justifyContent !== 'start') out.push(['justify-content', JUSTIFY[n.justifyContent] ?? 'flex-start']);
      out.push(['align-items', ALIGN[n.alignItems] ?? 'flex-start']);
    }
    const p = padding(n.padding);
    if (p) out.push(['padding', p]);
    if (n.clip === true) out.push(['overflow', 'hidden']);
    return out;
  }

  private common(n: SceneNode): Decl[] {
    const out: Decl[] = [];
    if (typeof n.opacity === 'number' && n.opacity < 1) out.push(['opacity', String(round(n.opacity))]);
    const t: string[] = [];
    const b = this.box(n);
    if (num(n.rotation)) t.push(`rotate(${round(-num(n.rotation))}deg)`);
    if (n.flipX === true) t.push(`translateX(${px(b.width)}) scaleX(-1)`);
    if (n.flipY === true) t.push(`translateY(${px(b.height)}) scaleY(-1)`);
    if (t.length) out.push(['transform-origin', '0 0'], ['transform', t.join(' ')]);
    return out;
  }

  /** Background, corners, strokes (as box shadows, which like canvas strokes take no space) and effects. */
  private paint(n: SceneNode): Decl[] {
    const out: Decl[] = [];
    const layers = fillList(n.fill).filter(enabled).map((f) => this.background(f)).filter((x): x is string => !!x).reverse();
    if (layers.length === 1 && layers[0].startsWith('#')) out.push(['background-color', layers[0]]);
    else if (layers.length) out.push(['background', layers.map((l) => (l.startsWith('#') ? `linear-gradient(${l}, ${l})` : l)).join(', ')]);
    if (n.type === 'frame' || n.type === 'rectangle') {
      const r = cornerRadii(n);
      if (r.some((x) => x > 0)) out.push(['border-radius', r.every((x) => x === r[0]) ? px(r[0]) : r.map(px).join(' ')]);
    }
    const shadows = [...this.strokeShadows(n), ...this.effectShadows(n)];
    if (shadows.length) out.push(['box-shadow', shadows.join(', ')]);
    out.push(...this.filters(n, false));
    return out;
  }

  private background(f: unknown): string | undefined {
    if (typeof f === 'string') return isColor(f) ? f : undefined;
    const fill = f as Record<string, any>;
    switch (fill.type) {
      case 'color': return isColor(fill.color) ? fill.color : undefined;
      case 'gradient': return gradient(fill);
      case 'image': {
        if (typeof fill.url !== 'string') return undefined;
        const size = fill.mode === 'contain' || fill.mode === 'fit' ? 'contain' : fill.mode === 'stretch' ? '100% 100%' : 'cover';
        return `url("${this.url(fill.url)}") center / ${size} no-repeat`;
      }
      case 'mesh_gradient': {
        const colors = (fill.colors ?? []).filter(isColor);
        return colors.length ? `linear-gradient(135deg, ${colors.join(', ')})` : undefined;
      }
      default: return undefined;
    }
  }

  private url(u: string): string {
    if (/^(https?:|data:)/.test(u)) return u;
    const file = isAbsolute(u) ? u : resolvePath(this.ctx.baseDir, u);
    return relative(this.outDir, file).split('\\').join('/');
  }

  private strokeShadows(n: SceneNode): string[] {
    const color = solid(n.stroke);
    if (!color) return [];
    const align = n.strokeAlignment ?? 'inner';
    const w = n.strokeWidth;
    const sides = typeof w === 'object' && w !== null
      ? { top: num(w.top), right: num(w.right), bottom: num(w.bottom), left: num(w.left) }
      : undefined;
    const width = sides ? 0 : num(w, 1);
    const inset = (s: number) => (align === 'inner' ? s : align === 'center' ? s / 2 : 0);
    const outset = (s: number) => (align === 'outer' ? s : align === 'center' ? s / 2 : 0);
    if (!sides) {
      const out: string[] = [];
      if (inset(width)) out.push(`inset 0 0 0 ${px(inset(width))} ${color}`);
      if (outset(width)) out.push(`0 0 0 ${px(outset(width))} ${color}`);
      return out;
    }
    const out: string[] = [];
    // (ix, iy) points from the side into the box: an inset shadow shifted that way paints a band along the side.
    const side = (s: number, ix: number, iy: number) => {
      if (inset(s)) out.push(`inset ${px(ix * inset(s))} ${px(iy * inset(s))} 0 0 ${color}`);
      if (outset(s)) out.push(`${px(-ix * outset(s))} ${px(-iy * outset(s))} 0 0 ${color}`);
    };
    side(sides.top, 0, 1);
    side(sides.bottom, 0, -1);
    side(sides.left, 1, 0);
    side(sides.right, -1, 0);
    return out;
  }

  private effectShadows(n: SceneNode): string[] {
    return effects(n).filter((e) => e.type === 'shadow').map((e) => {
      const c = isColor(e.color) ? e.color : '#00000040';
      return `${e.shadowType === 'inner' ? 'inset ' : ''}${px(num(e.offset?.x))} ${px(num(e.offset?.y))} ${px(num(e.blur))} ${px(num(e.spread))} ${c}`;
    });
  }

  /** Layer blur and backdrop blur; shapes drawn as SVG and icons take their shadows as drop-shadow filters. */
  private filters(n: SceneNode, dropShadows: boolean): Decl[] {
    const out: Decl[] = [];
    const f: string[] = [];
    for (const e of effects(n)) {
      if (e.type === 'blur' && num(e.radius)) f.push(`blur(${px(num(e.radius) / 2)})`);
      if (dropShadows && e.type === 'shadow' && e.shadowType !== 'inner') f.push(`drop-shadow(${px(num(e.offset?.x))} ${px(num(e.offset?.y))} ${px(num(e.blur) / 2)} ${isColor(e.color) ? e.color : '#00000040'})`);
      if (e.type === 'background_blur' && num(e.radius)) out.push(['backdrop-filter', `blur(${px(num(e.radius) / 2)})`]);
    }
    if (f.length) out.push(['filter', f.join(' ')]);
    return out;
  }

  private text(n: SceneNode): Decl[] {
    const out: Decl[] = [];
    const family = typeof n.fontFamily === 'string' ? n.fontFamily : 'Inter';
    const weight = fontWeight(n.fontWeight);
    const italic = isItalic(n.fontStyle);
    const styles = this.fonts.get(family) ?? this.fonts.set(family, new Set()).get(family)!;
    styles.add(`${italic ? 1 : 0},${weight}`);
    out.push(['font-family', `'${family.replace(/'/g, "\\'")}', sans-serif`], ['font-size', px(num(n.fontSize, 14))]);
    if (weight !== 400) out.push(['font-weight', String(weight)]);
    if (italic) out.push(['font-style', 'italic']);
    out.push(['line-height', typeof n.lineHeight === 'number' ? String(n.lineHeight) : 'normal']);
    if (num(n.letterSpacing)) out.push(['letter-spacing', px(num(n.letterSpacing))]);
    if (n.textAlign && n.textAlign !== 'left') out.push(['text-align', n.textAlign]);
    const deco = [n.underline === true && 'underline', n.strikethrough === true && 'line-through'].filter(Boolean);
    if (deco.length) out.push(['text-decoration', deco.join(' ')]);
    const growth = n.textGrowth ?? 'auto';
    out.push(['white-space', growth === 'auto' ? 'pre' : 'pre-wrap']);
    if (growth === 'fixed-width-height' && n.textAlignVertical && n.textAlignVertical !== 'top') {
      out.push(['display', 'flex'], ['flex-direction', 'column'], ['justify-content', n.textAlignVertical === 'middle' ? 'center' : 'flex-end']);
    }
    const fills = fillList(n.fill).filter(enabled);
    const color = solid(n.fill);
    const grad = fills.map((f) => (typeof f === 'object' && f && (f as { type?: string }).type === 'gradient' ? gradient(f as Record<string, any>) : undefined)).find(Boolean);
    if (grad && !color) out.push(['background', grad], ['-webkit-background-clip', 'text'], ['background-clip', 'text'], ['color', 'transparent']);
    else if (color) out.push(['color', color]);
    const shadows = effects(n).filter((e) => e.type === 'shadow' && e.shadowType !== 'inner')
      .map((e) => `${px(num(e.offset?.x))} ${px(num(e.offset?.y))} ${px(num(e.blur))} ${isColor(e.color) ? e.color : '#00000040'}`);
    if (shadows.length) out.push(['text-shadow', shadows.join(', ')]);
    out.push(...this.filters(n, false));
    return out;
  }

  private icon(n: SceneNode, decls: Decl[], attrs: string[]): string {
    const library = String(n.library ?? 'lucide');
    const color = solid(n.fill) ?? '#000000';
    decls.push(['color', color], ...this.filters(n, true));
    const b = this.box(n);
    if (isFontIconLibrary(library)) {
      this.materialIcons.add(library);
      decls.push(['font-family', `'${library}'`], ['font-size', px(Math.min(b.width, b.height))], ['line-height', '1'], ['display', 'flex'], ['align-items', 'center'], ['justify-content', 'center']);
      return `<span${this.attr(n, decls, attrs)}>${esc(String(n.icon ?? ''))}</span>`;
    }
    const g = this.ctx.renderer.icon(library, String(n.icon ?? ''), typeof n.weight === 'number' ? n.weight : undefined);
    if (!g) return `<span${this.attr(n, decls, attrs)}></span>`;
    const paths = g.shapes.map((s) => `<path d="${esc(s.d)}" fill="${s.fill ? 'currentColor' : 'none'}" stroke="${s.stroke ? 'currentColor' : 'none'}"${s.opacity < 1 ? ` opacity="${s.opacity}"` : ''}/>`).join('');
    return `<svg${this.attr(n, decls, attrs)} width="${round(b.width)}" height="${round(b.height)}" viewBox="${g.viewBox.join(' ')}" stroke-width="${g.strokeWidth}" stroke-linecap="${g.linecap}" stroke-linejoin="${g.linejoin}">${paths}</svg>`;
  }

  /** Ellipse arcs and rings, polygons and paths, drawn by the same geometry as the canvas. */
  private svgShape(n: SceneNode, decls: Decl[], attrs: string[]): string {
    const { ck } = this.ctx.renderer;
    const b = this.box(n);
    const path = shapePath(ck, n, b.width, b.height);
    const d = path?.toSVGString() ?? '';
    const evenOdd = path?.getFillType() === ck.FillType.EvenOdd;
    path?.delete();
    decls.push(['overflow', 'visible'], ...this.filters(n, true));
    const defs: string[] = [];
    const paintOf = (v: unknown, id: string) => {
      const c = solid(v);
      if (c) return c;
      const g = fillList(v).filter(enabled).find((f) => typeof f === 'object' && f && (f as { type?: string }).type === 'gradient') as Record<string, any> | undefined;
      if (!g) return 'none';
      defs.push(svgGradient(g, id));
      return `url(#${id})`;
    };
    const gid = `nib-gradient-${++this.gradients}`;
    const fill = paintOf(n.fill, `${gid}-f`);
    const stroke = paintOf(n.stroke, `${gid}-s`);
    const sw = typeof n.strokeWidth === 'number' ? n.strokeWidth : 1;
    const strokeAttrs = stroke === 'none' ? '' : ` stroke="${stroke}" stroke-width="${sw}"${n.strokeLinecap ? ` stroke-linecap="${n.strokeLinecap}"` : ''}${n.strokeLinejoin ? ` stroke-linejoin="${n.strokeLinejoin}"` : ''}`;
    return `<svg${this.attr(n, decls, attrs)} width="${round(b.width)}" height="${round(b.height)}" viewBox="0 0 ${round(b.width)} ${round(b.height)}">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}<path d="${esc(d)}" fill="${fill}"${evenOdd ? ' fill-rule="evenodd"' : ''}${strokeAttrs}/></svg>`;
  }

  /** Attributes for one element: its styles as a class (css) or utility classes (tailwind), plus data attributes. */
  private attr(n: SceneNode, decls: Decl[], attrs: string[]): string {
    const merged = dedupe(decls);
    let cls: string;
    if (this.tailwind) cls = merged.map(([k, v]) => utility(k, v)).join(' ');
    else {
      cls = this.className(n);
      this.rules.push(`.${cls} { ${merged.map(([k, v]) => `${k}: ${v};`).join(' ')} }`);
    }
    return `${cls ? ` class="${esc(cls)}"` : ''}${attrs.length ? ` ${attrs.join(' ')}` : ''}`;
  }

  private className(n: SceneNode): string {
    const base = (typeof n.name === 'string' ? n.name : n.type).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || n.type;
    const start = /^[a-z]/.test(base) ? base : `n-${base}`;
    const count = (this.classes.get(start) ?? 0) + 1;
    this.classes.set(start, count);
    return count === 1 ? start : `${start}-${count}`;
  }
}

type Sizing = { kind: 'fixed'; value: number } | { kind: 'fit' } | { kind: 'fill' } | { kind: 'zero' };

/** How a node sizes on an axis, with the canvas defaults: frames fit, auto text fits, other shapes are 0 unless sized. */
function sizing(n: SceneNode, axis: 'width' | 'height'): Sizing {
  if (n.type === 'text') {
    const growth = n.textGrowth ?? 'auto';
    if (growth === 'auto' || (growth === 'fixed-width' && axis === 'height')) return { kind: 'fit' };
  }
  const v = n[axis];
  if (typeof v === 'number') return { kind: 'fixed', value: v };
  if (typeof v === 'string') {
    const m = SIZE_RE.exec(v);
    if (m) return m[1] === 'fill_container' ? { kind: 'fill' } : { kind: 'fit' };
  }
  return n.type === 'frame' || n.type === 'group' ? { kind: 'fit' } : { kind: 'zero' };
}

function dirOf(n: SceneNode): Dir {
  if (n.type !== 'frame') return 'none';
  return n.layout === 'vertical' ? 'vertical' : n.layout === 'none' ? 'none' : 'horizontal';
}

function padding(p: unknown): string | undefined {
  if (typeof p === 'number') return p ? px(p) : undefined;
  if (Array.isArray(p) && p.every((x) => typeof x === 'number')) return p.some((x) => x) ? p.map(px).join(' ') : undefined;
  return undefined;
}

const isColor = (v: unknown): v is string => typeof v === 'string' && /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v);
const enabled = (f: unknown) => !(typeof f === 'object' && f !== null && (f as { enabled?: unknown }).enabled === false);

/** The topmost solid color among fills. */
function solid(v: unknown): string | undefined {
  const list = fillList(v).filter(enabled);
  for (let i = list.length - 1; i >= 0; i--) {
    const f = list[i];
    if (isColor(f)) return f;
    if (typeof f === 'object' && f !== null && (f as { type?: string }).type === 'color' && isColor((f as { color?: unknown }).color)) return (f as { color: string }).color;
  }
  return undefined;
}

function effects(n: SceneNode): Record<string, any>[] {
  const e = n.effect;
  return (Array.isArray(e) ? e : e ? [e] : []).filter((x) => x && typeof x === 'object' && x.enabled !== false);
}

function stops(f: Record<string, any>, turn = false): string {
  const alpha = typeof f.opacity === 'number' ? f.opacity : 1;
  return (f.colors ?? []).filter((s: { color?: unknown }) => isColor(s.color))
    .map((s: { color: string; position?: number }) => `${withAlpha(s.color, alpha)} ${round(num(s.position) * 100)}%`).join(', ') || (turn ? 'transparent 0%' : 'transparent, transparent');
}

/** CSS for a gradient fill. Canvas rotation is counter-clockwise with 0 pointing up; CSS angles run clockwise. */
function gradient(f: Record<string, any>): string {
  const angle = round((360 - num(f.rotation)) % 360);
  const cx = round(num(f.center?.x, 0.5) * 100), cy = round(num(f.center?.y, 0.5) * 100);
  if (f.gradientType === 'radial') return `radial-gradient(ellipse ${round(num(f.size?.width, 1) * 50)}% ${round(num(f.size?.height, 1) * 50)}% at ${cx}% ${cy}%, ${stops(f)})`;
  if (f.gradientType === 'angular') return `conic-gradient(from ${angle}deg at ${cx}% ${cy}%, ${stops(f, true)})`;
  return `linear-gradient(${angle}deg, ${stops(f)})`;
}

function svgGradient(f: Record<string, any>, id: string): string {
  const s = (f.colors ?? []).filter((c: { color?: unknown }) => isColor(c.color))
    .map((c: { color: string; position?: number }) => `<stop offset="${round(num(c.position))}" stop-color="${c.color.slice(0, 7)}"${c.color.length === 9 ? ` stop-opacity="${round(parseInt(c.color.slice(7), 16) / 255)}"` : ''}/>`).join('');
  if (f.gradientType === 'radial') return `<radialGradient id="${id}" cx="${num(f.center?.x, 0.5)}" cy="${num(f.center?.y, 0.5)}" r="0.5">${s}</radialGradient>`;
  const a = (num(f.rotation) * Math.PI) / 180;
  const dx = -Math.sin(a) / 2, dy = -Math.cos(a) / 2;
  return `<linearGradient id="${id}" x1="${round(0.5 - dx)}" y1="${round(0.5 - dy)}" x2="${round(0.5 + dx)}" y2="${round(0.5 + dy)}">${s}</linearGradient>`;
}

function withAlpha(color: string, alpha: number): string {
  if (alpha >= 1) return color;
  const hex = color.length <= 5 ? color.slice(1).split('').map((c) => c + c).join('') : color.slice(1);
  const a = hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1;
  return `#${hex.slice(0, 6)}${Math.round(a * alpha * 255).toString(16).padStart(2, '0')}`;
}

function dedupe(decls: Decl[]): Decl[] {
  const map = new Map<string, string>();
  for (const [k, v] of decls) map.set(k, v);
  return [...map];
}

/** One declaration as a Tailwind class: named utilities where they exist, arbitrary values otherwise. */
function utility(k: string, v: string): string {
  const arb = (prefix: string) => `${prefix}-[${tw(v)}]`;
  switch (k) {
    case 'display': return v === 'flex' ? 'flex' : v === 'block' ? 'block' : `[display:${tw(v)}]`;
    case 'flex-direction': return v === 'column' ? 'flex-col' : 'flex-row';
    case 'flex': return v === '1 1 0' ? 'flex-1' : v === 'none' ? 'flex-none' : `[flex:${tw(v)}]`;
    case 'position': return v;
    case 'overflow': return v === 'hidden' ? 'overflow-hidden' : `overflow-${v}`;
    case 'align-self': return v === 'stretch' ? 'self-stretch' : `self-${v}`;
    case 'align-items': return { 'flex-start': 'items-start', center: 'items-center', 'flex-end': 'items-end' }[v] ?? `[align-items:${v}]`;
    case 'justify-content': return { 'flex-start': 'justify-start', center: 'justify-center', 'flex-end': 'justify-end', 'space-between': 'justify-between', 'space-around': 'justify-around' }[v] ?? `[justify-content:${v}]`;
    case 'white-space': return v === 'pre' ? 'whitespace-pre' : v === 'pre-wrap' ? 'whitespace-pre-wrap' : `[white-space:${v}]`;
    case 'text-align': return `text-${v}`;
    case 'min-width': return v === '0' ? 'min-w-0' : arb('min-w');
    case 'min-height': return v === '0' ? 'min-h-0' : arb('min-h');
    case 'width': return arb('w');
    case 'height': return arb('h');
    case 'left': return arb('left');
    case 'top': return arb('top');
    case 'gap': return arb('gap');
    case 'padding': return arb('p');
    case 'border-radius': return arb('rounded');
    case 'background-color': return arb('bg');
    case 'color': return `text-[color:${tw(v)}]`;
    case 'font-size': return `text-[length:${tw(v)}]`;
    case 'font-weight': return arb('font');
    case 'font-family': return `font-[family-name:${tw(v)}]`;
    case 'line-height': return arb('leading');
    case 'letter-spacing': return arb('tracking');
    case 'opacity': return arb('opacity');
    case 'box-shadow': return arb('shadow');
    default: return `[${k}:${tw(v)}]`;
  }
}

/** A CSS value inside a Tailwind arbitrary value: underscores stand for spaces. */
const tw = (v: string) => v.replace(/_/g, '\\_').replace(/\s+/g, '_');
