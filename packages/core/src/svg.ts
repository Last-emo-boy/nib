import { multiply, parsePath, pathNodeProps, transformPaths, type Matrix, type SubPath } from './paths.ts';

/**
 * SVG markup as editable .pen layers: one frame the size of the drawing, holding a path node per shape
 * (path, rect, circle, ellipse, line, polyline, polygon) with its fill, stroke and opacity. Transforms,
 * the viewBox, inherited styles, <style> class rules, <use> and linear and radial gradients are followed;
 * text, images, masks and filters are left out (and counted).
 */

interface El { tag: string; attrs: Record<string, string>; children: El[]; text: string }

/** A small XML reader: elements, attributes, text; comments, CDATA, doctype and processing instructions skipped. */
export function parseXml(src: string): El {
  const root: El = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack: El[] = [root];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { stack[stack.length - 1].text += src.slice(i); break; }
    if (lt > i) stack[stack.length - 1].text += src.slice(i, lt);
    if (src.startsWith('<!--', lt)) { i = end(src.indexOf('-->', lt), 3); continue; }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt); stack[stack.length - 1].text += src.slice(lt + 9, e < 0 ? undefined : e); i = end(e, 3); continue; }
    if (src.startsWith('<?', lt) || src.startsWith('<!', lt)) { i = end(src.indexOf('>', lt), 1); continue; }
    if (src[lt + 1] === '/') {
      const gt = src.indexOf('>', lt);
      const tag = src.slice(lt + 2, gt).trim();
      while (stack.length > 1 && stack[stack.length - 1].tag !== tag) stack.pop();
      if (stack.length > 1) stack.pop();
      i = end(gt, 1);
      continue;
    }
    const m = /^<([\w:.-]+)/.exec(src.slice(lt, lt + 200));
    if (!m) { stack[stack.length - 1].text += '<'; i = lt + 1; continue; }
    let j = lt + m[0].length;
    const attrs: Record<string, string> = {};
    const attr = /\s*([\w:.-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/y;
    for (;;) {
      attr.lastIndex = j;
      const a = attr.exec(src);
      if (!a || !a[0].trim()) break;
      attrs[a[1]] = decode(a[2] ?? a[3] ?? a[4] ?? '');
      j = attr.lastIndex;
    }
    while (j < src.length && /\s/.test(src[j])) j++;
    const selfClosing = src[j] === '/';
    const gt = src.indexOf('>', j);
    const el: El = { tag: m[1].replace(/^svg:/, ''), attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(el);
    if (!selfClosing) stack.push(el);
    i = end(gt, 1);
  }
  return root;

  function end(at: number, len: number) { return at < 0 ? src.length : at + len; }
}

const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()];
});

/** An SVG transform list as one matrix. */
export function parseTransform(s: string | undefined): Matrix {
  let m: Matrix = [1, 0, 0, 1, 0, 0];
  if (!s) return m;
  for (const [, fn, args] of s.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const v = args.split(/[\s,]+/).filter(Boolean).map(Number);
    let t: Matrix = [1, 0, 0, 1, 0, 0];
    const rad = (d: number) => (d * Math.PI) / 180;
    switch (fn) {
      case 'matrix': if (v.length === 6) t = v as Matrix; break;
      case 'translate': t = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0]; break;
      case 'scale': t = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const a = rad(v[0] ?? 0), c = Math.cos(a), sn = Math.sin(a);
        const r: Matrix = [c, sn, -sn, c, 0, 0];
        t = v.length >= 3 ? multiply(multiply([1, 0, 0, 1, v[1], v[2]], r), [1, 0, 0, 1, -v[1], -v[2]]) : r;
        break;
      }
      case 'skewX': t = [1, 0, Math.tan(rad(v[0] ?? 0)), 1, 0, 0]; break;
      case 'skewY': t = [1, Math.tan(rad(v[0] ?? 0)), 0, 1, 0, 0]; break;
    }
    m = multiply(m, t);
  }
  return m;
}

/** Styles that pass from a group to what it holds. */
const INHERITED = ['fill', 'stroke', 'stroke-width', 'fill-rule', 'fill-opacity', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'color', 'visibility'];

type Style = Record<string, string>;

const styleAttr = (s: string | undefined): Style => Object.fromEntries((s ?? '').split(';').map((d) => d.split(':').map((x) => x.trim())).filter((d) => d.length === 2 && d[0] && d[1]) as [string, string][]);

const NAMED: Record<string, string> = {
  black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000', blue: '#0000FF', yellow: '#FFFF00', gray: '#808080', grey: '#808080',
  orange: '#FFA500', purple: '#800080', silver: '#C0C0C0', navy: '#000080', teal: '#008080', maroon: '#800000', lime: '#00FF00', aqua: '#00FFFF', fuchsia: '#FF00FF', olive: '#808000',
};

/** A CSS color as #RRGGBB(AA), with an extra opacity; undefined for none, transparent or unknown. */
function color(v: string | undefined, opacity = 1): string | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase();
  let r: number, g: number, b: number, a = 1;
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  const fn = /^rgba?\(([^)]*)\)$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    if (h.length === 8) a = parseInt(h.slice(6, 8), 16) / 255;
  } else if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    [r, g, b] = parts.slice(0, 3).map((p) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p)));
    if (parts[3] !== undefined) a = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  } else if (NAMED[s]) {
    return color(NAMED[s], opacity);
  } else return undefined;
  a *= opacity;
  const x = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0').toUpperCase();
  return `#${x(r)}${x(g)}${x(b)}${a < 1 ? x(a * 255) : ''}`;
}

const length = (v: string | undefined, fallback = 0) => {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : fallback;
};

function shapePaths(el: El): SubPath[] | undefined {
  const a = el.attrs;
  const n = (k: string) => length(a[k]);
  switch (el.tag) {
    case 'path': return a.d ? parsePath(a.d) : undefined;
    case 'rect': {
      const x = n('x'), y = n('y'), w = n('width'), h = n('height');
      if (w <= 0 || h <= 0) return undefined;
      let rx = a.rx !== undefined ? n('rx') : n('ry'), ry = a.ry !== undefined ? n('ry') : rx;
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      if (!rx || !ry) return parsePath(`M${x} ${y}H${x + w}V${y + h}H${x}Z`);
      return parsePath(`M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`);
    }
    case 'circle': case 'ellipse': {
      const cx = n('cx'), cy = n('cy'), rx = el.tag === 'circle' ? n('r') : n('rx'), ry = el.tag === 'circle' ? n('r') : n('ry');
      if (rx <= 0 || ry <= 0) return undefined;
      return parsePath(`M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`);
    }
    case 'line': return parsePath(`M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`);
    case 'polyline': case 'polygon': {
      const v = (a.points ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (v.length < 4) return undefined;
      let d = `M${v[0]} ${v[1]}`;
      for (let i = 2; i + 1 < v.length; i += 2) d += `L${v[i]} ${v[i + 1]}`;
      return parsePath(el.tag === 'polygon' ? `${d}Z` : d);
    }
  }
  return undefined;
}

export interface SvgImport {
  /** A frame the size of the drawing, holding the shapes. */
  node: Record<string, unknown>;
  /** Elements that could not be brought in, by kind: { text: 2, image: 1 }. */
  skipped: Record<string, number>;
}

/**
 * SVG markup as a frame of path layers. `newId` gives ids for the new nodes; `name` names the frame (else the
 * SVG's title or id).
 */
export function svgToNodes(src: string, newId: () => string, name?: string): SvgImport {
  const doc = parseXml(src);
  const svg = find(doc, (e) => e.tag === 'svg');
  if (!svg) throw new Error('not an SVG: no <svg> element');
  const ids = new Map<string, El>();
  const classes = new Map<string, Style>();
  const walkIds = (e: El) => { if (e.attrs.id) ids.set(e.attrs.id, e); if (e.tag === 'style') readCss(e.text, classes); e.children.forEach(walkIds); };
  walkIds(svg);

  // The drawing's size and the viewBox mapped onto it.
  const vb = (svg.attrs.viewBox ?? svg.attrs.viewbox ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
  const hasVb = vb.length === 4 && vb[2] > 0 && vb[3] > 0;
  const width = length(svg.attrs.width, hasVb ? vb[2] : 300) || (hasVb ? vb[2] : 300);
  const height = length(svg.attrs.height, hasVb ? vb[3] : 150) || (hasVb ? vb[3] : 150);
  const root: Matrix = hasVb ? fitViewBox(vb, width, height, svg.attrs.preserveAspectRatio) : [1, 0, 0, 1, 0, 0];

  const children: Record<string, unknown>[] = [];
  const skipped: Record<string, number> = {};
  const skip = (k: string) => { skipped[k] = (skipped[k] ?? 0) + 1; };

  const visit = (e: El, m: Matrix, inherited: Style, opacity: number, depth: number) => {
    if (depth > 64) return;
    const own: Style = { ...pick(e.attrs), ...classStyle(e, classes), ...styleAttr(e.attrs.style) };
    if (own.display === 'none' || e.tag === 'defs' || e.tag === 'symbol' || e.tag === 'clipPath' || e.tag === 'mask' || e.tag === 'linearGradient' || e.tag === 'radialGradient' || e.tag === 'style' || e.tag === 'title' || e.tag === 'desc' || e.tag === 'metadata' || e.tag === 'pattern' || e.tag === 'marker' || e.tag === 'filter') return;
    const style: Style = { ...inherited };
    for (const k of INHERITED) if (own[k] !== undefined && own[k] !== 'inherit') style[k] = own[k];
    const local = multiply(m, parseTransform(e.attrs.transform));
    const op = opacity * (own.opacity !== undefined ? length(own.opacity, 1) : 1);
    if (e.tag === 'g' || e.tag === 'svg' || e.tag === 'a' || e.tag === 'switch') {
      const inner = e === svg ? local : e.tag === 'svg' ? multiply(local, nestedSvg(e)) : local;
      for (const c of e.children) visit(c, inner, style, op, depth + 1);
      return;
    }
    if (e.tag === 'use') {
      const href = (e.attrs.href ?? e.attrs['xlink:href'] ?? '').replace(/^#/, '');
      const target = ids.get(href);
      if (!target) return;
      visit(target, multiply(local, [1, 0, 0, 1, length(e.attrs.x), length(e.attrs.y)]), style, op, depth + 1);
      return;
    }
    if (['text', 'image', 'foreignObject'].includes(e.tag)) { skip(e.tag); return; }
    const subs = shapePaths(e);
    if (!subs?.length || style.visibility === 'hidden') return;
    const mapped = transformPaths(subs, local);
    const props = pathNodeProps(mapped);
    if (!props) return;
    const scale = Math.sqrt(Math.abs(local[0] * local[3] - local[1] * local[2])) || 1;
    const current = style.color;
    const paint = (v: string | undefined, alpha: number) => {
      if (!v || v === 'none') return undefined;
      const value = v === 'currentColor' ? current ?? '#000000' : v;
      const url = /^url\(\s*#([^)\s]+)\s*\)/.exec(value);
      if (url) {
        const g = ids.get(url[1]);
        return g ? gradient(g, ids, alpha, local, props) ?? color(value.replace(/^url\([^)]*\)\s*/, ''), alpha) : undefined;
      }
      return color(value, alpha);
    };
    // Unset fill is black; unset stroke is none, as in SVG.
    const fill = paint(style.fill ?? '#000000', length(style['fill-opacity'], 1));
    const stroke = paint(style.stroke, length(style['stroke-opacity'], 1));
    const strokeWidth = length(style['stroke-width'], 1) * scale;
    if (!fill && !stroke) return;
    children.push({
      type: 'path', id: newId(), name: e.attrs.id ?? e.attrs['inkscape:label'] ?? cap(e.tag),
      ...props,
      ...(fill ? { fill } : {}),
      ...(stroke && strokeWidth > 0 ? {
        stroke, strokeWidth: Math.round(strokeWidth * 100) / 100, strokeAlignment: 'center',
        ...(['round', 'square'].includes(style['stroke-linecap']) ? { strokeLinecap: style['stroke-linecap'] } : {}),
        ...(['round', 'bevel'].includes(style['stroke-linejoin']) ? { strokeLinejoin: style['stroke-linejoin'] } : {}),
      } : {}),
      ...(style['fill-rule'] === 'evenodd' ? { fillRule: 'evenodd' } : {}),
      ...(op < 1 ? { opacity: Math.round(op * 1000) / 1000 } : {}),
    });
  };
  // The root's own presentation attributes (fill="none" stroke="currentColor" on icon sets) pass to everything.
  visit(svg, root, {}, 1, 0);
  const title = find(svg, (e) => e.tag === 'title')?.text.trim();
  return {
    node: { type: 'frame', id: newId(), name: name ?? (title || svg.attrs.id || 'SVG'), width: round(width), height: round(height), layout: 'none', children },
    skipped,
  };
}

const round = (v: number) => Math.round(v * 100) / 100;
const cap = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);

/** Presentation attributes (fill="…" and the like) as style. */
function pick(attrs: Record<string, string>): Style {
  const out: Style = {};
  for (const k of [...INHERITED, 'opacity', 'display']) if (attrs[k] !== undefined) out[k] = attrs[k];
  return out;
}

/** Rules of a <style> element for classes, ids and element names (`.a, .b { fill: red }`). */
function readCss(css: string, into: Map<string, Style>): void {
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const style = styleAttr(m[2]);
    for (const sel of m[1].split(',').map((s) => s.trim()).filter(Boolean)) into.set(sel, { ...(into.get(sel) ?? {}), ...style });
  }
}

function classStyle(e: El, rules: Map<string, Style>): Style {
  if (!rules.size) return {};
  let out: Style = { ...(rules.get(e.tag) ?? {}) };
  for (const c of (e.attrs.class ?? '').split(/\s+/).filter(Boolean)) out = { ...out, ...(rules.get(`.${c}`) ?? {}), ...(rules.get(`${e.tag}.${c}`) ?? {}) };
  if (e.attrs.id) out = { ...out, ...(rules.get(`#${e.attrs.id}`) ?? {}) };
  return out;
}

function find(e: El, pred: (e: El) => boolean): El | undefined {
  if (pred(e)) return e;
  for (const c of e.children) { const f = find(c, pred); if (f) return f; }
  return undefined;
}

/** The viewBox onto a width × height viewport, centered and fitted (xMidYMid meet) unless told otherwise. */
function fitViewBox(vb: number[], w: number, h: number, aspect = 'xMidYMid meet'): Matrix {
  const [vx, vy, vw, vh] = vb;
  if (aspect.trim() === 'none') return [w / vw, 0, 0, h / vh, -vx * (w / vw), -vy * (h / vh)];
  const s = /slice/.test(aspect) ? Math.max(w / vw, h / vh) : Math.min(w / vw, h / vh);
  const align = /x(Min|Mid|Max)Y(Min|Mid|Max)/.exec(aspect) ?? ['', 'Mid', 'Mid'];
  const off = (k: string, room: number) => (k === 'Min' ? 0 : k === 'Max' ? room : room / 2);
  return [s, 0, 0, s, off(align[1], w - vw * s) - vx * s, off(align[2], h - vh * s) - vy * s];
}

function nestedSvg(e: El): Matrix {
  const x = length(e.attrs.x), y = length(e.attrs.y);
  const vb = (e.attrs.viewBox ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
  const w = length(e.attrs.width, vb[2] ?? 0), h = length(e.attrs.height, vb[3] ?? 0);
  const inner: Matrix = vb.length === 4 && vb[2] > 0 && vb[3] > 0 && w && h ? fitViewBox(vb, w, h, e.attrs.preserveAspectRatio) : [1, 0, 0, 1, 0, 0];
  return multiply([1, 0, 0, 1, x, y], inner);
}

/** A gradient paint server as a .pen gradient fill over the shape's box. */
function gradient(g: El, ids: Map<string, El>, alpha: number, m: Matrix, box: { x: number; y: number; width: number; height: number }): Record<string, unknown> | undefined {
  // Stops and attributes may come from the gradient it links to.
  const chain: El[] = [];
  for (let e: El | undefined = g; e && chain.length < 8; e = ids.get((e.attrs.href ?? e.attrs['xlink:href'] ?? '').replace(/^#/, ''))) chain.push(e);
  const attr = (k: string) => chain.find((e) => e.attrs[k] !== undefined)?.attrs[k];
  const stopsOf = chain.find((e) => e.children.some((c) => c.tag === 'stop'))?.children.filter((c) => c.tag === 'stop') ?? [];
  const colors = stopsOf.map((s) => {
    const st = { ...pick(s.attrs), ...styleAttr(s.attrs.style) } as Style;
    const c = color(st['stop-color'] ?? s.attrs['stop-color'] ?? '#000000', length(st['stop-opacity'] ?? s.attrs['stop-opacity'], 1) * alpha) ?? '#00000000';
    const off = s.attrs.offset ?? '0';
    return { color: c, position: Math.max(0, Math.min(1, off.endsWith('%') ? parseFloat(off) / 100 : parseFloat(off))) };
  });
  if (!colors.length) return undefined;
  if (colors.length === 1) return colors[0].color as unknown as Record<string, unknown>;
  // Gradient points in the shape's box (0..1): user space ones go through the shape's transform first.
  const user = attr('gradientUnits') === 'userSpaceOnUse';
  const gt = parseTransform(attr('gradientTransform'));
  const toUnit = (x: number, y: number) => {
    let p = { x, y };
    if (user) { const q = multiplyPoint(multiply(m, gt), p); p = { x: (q.x - box.x) / box.width, y: (q.y - box.y) / box.height }; } else {
      const q = multiplyPoint(gt, p);
      p = q;
    }
    return p;
  };
  const frac = (v: string | undefined, d: number) => (v === undefined ? d : v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v));
  if (g.tag === 'linearGradient') {
    const a = toUnit(frac(attr('x1'), 0), frac(attr('y1'), 0)), b = toUnit(frac(attr('x2'), 1), frac(attr('y2'), 0));
    // .pen draws a linear gradient in the box's unit square, from center + (sin, cos)·length/2 to center −
    // (sin, cos)·length/2 of its rotation (counter-clockwise degrees, 0 pointing up).
    const dx = b.x - a.x, dy = b.y - a.y;
    const rotation = Math.round(((((Math.atan2(-dx, -dy) * 180) / Math.PI) + 360) % 360) * 10) / 10;
    const len = Math.hypot(dx, dy) || 1;
    return { type: 'gradient', gradientType: 'linear', rotation, center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, size: { height: len }, colors };
  }
  const c = toUnit(frac(attr('cx'), 0.5), frac(attr('cy'), 0.5));
  const r = frac(attr('r'), 0.5);
  const edge = toUnit(frac(attr('cx'), 0.5) + r, frac(attr('cy'), 0.5) + r);
  return { type: 'gradient', gradientType: 'radial', center: c, size: { width: Math.abs(edge.x - c.x) * 2, height: Math.abs(edge.y - c.y) * 2 }, colors };
}

const multiplyPoint = (m: Matrix, p: { x: number; y: number }) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
