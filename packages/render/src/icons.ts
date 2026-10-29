/** One drawable part of an icon, in the icon's viewBox units. */
export interface IconShape {
  d: string;
  fill: boolean;
  stroke: boolean;
  opacity: number;
}

export interface IconGeometry {
  viewBox: [number, number, number, number];
  shapes: IconShape[];
  strokeWidth: number;
  linecap: 'butt' | 'round' | 'square';
  linejoin: 'miter' | 'round' | 'bevel';
}

/** Vector icon libraries. Material Symbols are not here: they render from their ligature fonts. */
export interface IconSource {
  load(library: string, name: string, weight: number | undefined): Promise<IconGeometry | undefined>;
}

export const isFontIconLibrary = (library: string) => library.startsWith('Material Symbols');

const attrsOf = (s: string) => Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const n = (v: string | undefined) => (v === undefined ? 0 : Number(v));

/** Parse the simple SVG files icon libraries ship: path, circle, ellipse, rect, line, polyline, polygon. */
export function parseSvgIcon(svg: string): IconGeometry | undefined {
  const root = /<svg\b([^>]*)>/.exec(svg);
  if (!root) return undefined;
  const ra = attrsOf(root[1]);
  const vb = (ra.viewBox ?? `0 0 ${ra.width ?? 24} ${ra.height ?? 24}`).trim().split(/[\s,]+/).map(Number) as IconGeometry['viewBox'];
  const rootFill = ra.fill ?? 'currentColor';
  const rootStroke = ra.stroke ?? 'none';
  const shapes: IconShape[] = [];
  for (const m of svg.matchAll(/<(path|circle|ellipse|rect|line|polyline|polygon)\b([^>]*?)\/?>/g)) {
    const a = attrsOf(m[2]);
    const d = toPath(m[1], a);
    if (!d) continue;
    const fill = (a.fill ?? rootFill) !== 'none';
    const stroke = (a.stroke ?? rootStroke) !== 'none';
    shapes.push({ d, fill, stroke, opacity: a.opacity === undefined ? 1 : Number(a.opacity) });
  }
  return {
    viewBox: vb,
    shapes,
    strokeWidth: n(ra['stroke-width'] ?? '1'),
    linecap: (ra['stroke-linecap'] as IconGeometry['linecap']) ?? 'butt',
    linejoin: (ra['stroke-linejoin'] as IconGeometry['linejoin']) ?? 'miter',
  };
}

function toPath(tag: string, a: Record<string, string>): string | undefined {
  switch (tag) {
    case 'path': return a.d;
    case 'circle': return ellipse(n(a.cx), n(a.cy), n(a.r), n(a.r));
    case 'ellipse': return ellipse(n(a.cx), n(a.cy), n(a.rx), n(a.ry));
    case 'line': return `M${n(a.x1)} ${n(a.y1)}L${n(a.x2)} ${n(a.y2)}`;
    case 'polyline': case 'polygon': {
      const pts = (a.points ?? '').trim().split(/[\s,]+/).map(Number);
      if (pts.length < 4) return undefined;
      let d = `M${pts[0]} ${pts[1]}`;
      for (let i = 2; i + 1 < pts.length; i += 2) d += `L${pts[i]} ${pts[i + 1]}`;
      return tag === 'polygon' ? `${d}Z` : d;
    }
    case 'rect': {
      const x = n(a.x), y = n(a.y), w = n(a.width), h = n(a.height);
      let rx = a.rx === undefined ? n(a.ry) : n(a.rx);
      let ry = a.ry === undefined ? rx : n(a.ry);
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}`
        + `H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
  }
  return undefined;
}

function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
}

/** Phosphor ships discrete weights; map a 100-700 weight onto them. */
export function phosphorWeight(weight: number | undefined): string {
  if (weight === undefined) return 'regular';
  if (weight <= 150) return 'thin';
  if (weight <= 350) return 'light';
  if (weight <= 500) return 'regular';
  return 'bold';
}
