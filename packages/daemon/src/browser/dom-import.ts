// Runs inside a web page (sent with Runtime.evaluate), so it must not use anything outside itself.

/** The most layers one import makes (a page with more stops there). */
export const MAX_IMPORT = 4000;

/**
 * Reproduce a part of a page as .pen nodes: elements that draw something (background, border, shadow,
 * clipping, opacity) become free frames at their exact boxes, wrappers that draw nothing are skipped
 * (their children move up), text runs become text nodes, images become image fills and SVG shapes
 * become paths. Each node's `context` holds the source tag, prefixed with its React component when found.
 */
export function domToPen(root: Element, opts: { maxNodes: number; fullPage: boolean }): { node: Record<string, unknown>; count: number; truncated: boolean } {
  type N = Record<string, unknown>;
  let count = 0;
  let truncated = false;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const px = (v: string) => parseFloat(v) || 0;

  // Any CSS color (rgb, hsl, oklch, lab, color(), named) to hex: the page paints it on a 1×1 canvas and
  // reads the pixel back, so every syntax the browser knows works.
  const ink = document.createElement('canvas');
  ink.width = ink.height = 1;
  const ctx = ink.getContext('2d', { willReadFrequently: true })!;
  const colors = new Map<string, string | undefined>();
  const hex = (c: string | null | undefined): string | undefined => {
    if (!c || c === 'transparent' || c === 'none') return undefined;
    if (colors.has(c)) return colors.get(c);
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#010203';
    ctx.fillStyle = c;
    let out: string | undefined;
    if (ctx.fillStyle !== '#010203' || /^#010203$/i.test(c)) {
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      const h = (x: number) => x.toString(16).padStart(2, '0').toUpperCase();
      out = a === 0 ? undefined : `#${h(r)}${h(g)}${h(b)}${a < 255 ? h(a) : ''}`;
    }
    colors.set(c, out);
    return out;
  };

  const family = (f: string): string => {
    const first = f.split(',')[0].trim().replace(/^["']|["']$/g, '');
    const generic: Record<string, string> = { 'system-ui': 'Inter', '-apple-system': 'Inter', 'BlinkMacSystemFont': 'Inter', 'sans-serif': 'Inter', 'ui-sans-serif': 'Inter', serif: 'Noto Serif', 'ui-serif': 'Noto Serif', monospace: 'JetBrains Mono', 'ui-monospace': 'JetBrains Mono', Menlo: 'JetBrains Mono', Monaco: 'JetBrains Mono' };
    return generic[first] ?? first;
  };

  const component = (el: Element): string | undefined => {
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    let f = key ? (el as unknown as Record<string, any>)[key] : undefined;
    while (f) {
      const t = f.type;
      if (typeof t === 'function' && (t.displayName || t.name)) return t.displayName || t.name;
      f = f.return;
    }
    return undefined;
  };

  const context = (el: Element) => { const c = component(el); const tag = el.tagName.toLowerCase(); return c ? `${c} - ${tag}` : tag; };
  const nameOf = (el: Element) => (el.getAttribute('aria-label') || el.id || (typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className.split(/\s+/).find(Boolean) : '') || el.tagName.toLowerCase()).slice(0, 60);

  const gradient = (bg: string): N | undefined => {
    const m = /linear-gradient\((.*)\)/.exec(bg);
    if (!m) return undefined;
    const args: string[] = [];
    let depth = 0, cur = '';
    for (const ch of m[1]) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { args.push(cur.trim()); cur = ''; } else cur += ch;
    }
    args.push(cur.trim());
    let angle = 180;
    const dirs: Record<string, number> = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270, 'to top right': 45, 'to right top': 45, 'to bottom right': 135, 'to right bottom': 135, 'to bottom left': 225, 'to left bottom': 225, 'to top left': 315, 'to left top': 315 };
    if (/deg$/.test(args[0])) angle = parseFloat(args.shift()!);
    else if (dirs[args[0]] !== undefined) angle = dirs[args.shift()!];
    const stops = args.map((s, i) => {
      const c = /^([a-z-]+\([^)]*\)|#[0-9a-f]+|[a-z]+)/i.exec(s)?.[1];
      const p = /(-?[\d.]+)%/.exec(s);
      return { color: hex(c) ?? '#00000000', position: p ? parseFloat(p[1]) / 100 : args.length > 1 ? i / (args.length - 1) : 0 };
    });
    return { type: 'gradient', gradientType: 'linear', rotation: (360 - angle) % 360, colors: stops };
  };

  const fills = (cs: CSSStyleDeclaration): unknown => {
    const out: unknown[] = [];
    const bg = hex(cs.backgroundColor);
    if (bg) out.push(bg);
    const img = cs.backgroundImage;
    if (img && img !== 'none') {
      const g = gradient(img);
      if (g) out.push(g);
      const u = /url\(["']?([^"')]+)["']?\)/.exec(img)?.[1];
      if (u && !u.startsWith('data:image/svg')) out.push({ type: 'image', url: new URL(u, location.href).href, mode: cs.backgroundSize === 'contain' ? 'contain' : 'cover' });
    }
    return out.length === 0 ? undefined : out.length === 1 ? out[0] : out;
  };

  const radius = (cs: CSSStyleDeclaration): unknown => {
    const v = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(px);
    if (v.every((x) => x === 0)) return undefined;
    return v.every((x) => x === v[0]) ? r2(v[0]) : v.map(r2);
  };

  const strokeOf = (cs: CSSStyleDeclaration, out: N) => {
    const sides = (['Top', 'Right', 'Bottom', 'Left'] as const).map((s) => ({
      w: cs.getPropertyValue(`border-${s.toLowerCase()}-style`) === 'none' ? 0 : px(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)),
      c: hex(cs.getPropertyValue(`border-${s.toLowerCase()}-color`)),
    }));
    const drawn = sides.filter((s) => s.w > 0 && s.c);
    if (!drawn.length) return;
    out.stroke = drawn[0].c;
    out.strokeWidth = sides.every((s) => s.w === sides[0].w && s.c === sides[0].c) ? r2(sides[0].w) : { top: r2(sides[0].c ? sides[0].w : 0), right: r2(sides[1].c ? sides[1].w : 0), bottom: r2(sides[2].c ? sides[2].w : 0), left: r2(sides[3].c ? sides[3].w : 0) };
  };

  const shadows = (cs: CSSStyleDeclaration): N[] => {
    const v = cs.boxShadow;
    if (!v || v === 'none') return [];
    const parts: string[] = [];
    let depth = 0, cur = '';
    for (const ch of v) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
    }
    parts.push(cur.trim());
    return parts.map((p) => {
      const colorText = /[a-z-]+\([^)]*\)|#[0-9a-f]{3,8}/i.exec(p)?.[0];
      const color = hex(colorText);
      const nums = (colorText ? p.replace(colorText, '') : p).match(/-?[\d.]+px|\b0\b/g)?.map(px) ?? [];
      return { type: 'shadow', ...(p.includes('inset') ? { shadowType: 'inner' } : {}), offset: { x: nums[0] ?? 0, y: nums[1] ?? 0 }, blur: nums[2] ?? 0, ...(nums[3] ? { spread: nums[3] } : {}), color: color ?? '#00000040' };
    }).filter((s) => s.color);
  };

  const textStyle = (cs: CSSStyleDeclaration): N => {
    const size = px(cs.fontSize) || 16;
    // fontStack (the whole CSS list) is resolved by the host to the first family it can load, then dropped.
    const out: N = { fontFamily: family(cs.fontFamily), fontStack: cs.fontFamily, fontSize: r2(size), fill: hex(cs.color) ?? '#000000' };
    if (cs.fontWeight !== '400') out.fontWeight = cs.fontWeight;
    if (cs.fontStyle === 'italic') out.fontStyle = 'italic';
    if (cs.lineHeight !== 'normal') out.lineHeight = r2(px(cs.lineHeight) / size);
    if (cs.letterSpacing !== 'normal' && px(cs.letterSpacing)) out.letterSpacing = r2(px(cs.letterSpacing));
    const align = cs.textAlign === 'center' ? 'center' : cs.textAlign === 'right' || cs.textAlign === 'end' ? 'right' : cs.textAlign === 'justify' ? 'justify' : undefined;
    if (align) out.textAlign = align;
    if (cs.textDecorationLine.includes('underline')) out.underline = true;
    if (cs.textDecorationLine.includes('line-through')) out.strikethrough = true;
    return out;
  };

  const transform = (s: string, cs: CSSStyleDeclaration) => {
    let t = /pre/.test(cs.whiteSpace) ? s : s.replace(/\s+/g, ' ');
    if (cs.textTransform === 'uppercase') t = t.toUpperCase();
    if (cs.textTransform === 'lowercase') t = t.toLowerCase();
    return t;
  };

  const box = (r: DOMRect, origin: { x: number; y: number }) => ({ x: r2(r.left + scrollX - origin.x), y: r2(r.top + scrollY - origin.y), width: r2(r.width), height: r2(r.height) });

  const svgNodes = (svg: SVGSVGElement, origin: { x: number; y: number }): N[] => {
    const r = svg.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return [];
    const vb = svg.viewBox?.baseVal;
    const viewBox = vb && vb.width ? [vb.x, vb.y, vb.width, vb.height] : [0, 0, r.width, r.height];
    const groups = new Map<string, { d: string[]; fill?: string; stroke?: string; width: number; cap: string; join: string }>();
    for (const el of Array.from(svg.querySelectorAll('path, circle, ellipse, rect, line, polyline, polygon'))) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      const a = (n: string) => parseFloat(el.getAttribute(n) ?? '0') || 0;
      let d = '';
      switch (el.tagName.toLowerCase()) {
        case 'path': d = el.getAttribute('d') ?? ''; break;
        case 'circle': { const cx = a('cx'), cy = a('cy'), rr = a('r'); d = `M${cx - rr} ${cy}a${rr} ${rr} 0 1 0 ${2 * rr} 0a${rr} ${rr} 0 1 0 ${-2 * rr} 0Z`; break; }
        case 'ellipse': { const cx = a('cx'), cy = a('cy'), rx = a('rx'), ry = a('ry'); d = `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`; break; }
        case 'rect': { const x = a('x'), y = a('y'), w = a('width'), h = a('height'); d = `M${x} ${y}h${w}v${h}h${-w}Z`; break; }
        case 'line': d = `M${a('x1')} ${a('y1')}L${a('x2')} ${a('y2')}`; break;
        default: { const pts = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number); for (let i = 0; i + 1 < pts.length; i += 2) d += `${i ? 'L' : 'M'}${pts[i]} ${pts[i + 1]}`; if (el.tagName.toLowerCase() === 'polygon') d += 'Z'; }
      }
      if (!d) continue;
      const fill = cs.fill === 'none' ? undefined : hex(cs.fill);
      const stroke = cs.stroke === 'none' ? undefined : hex(cs.stroke);
      if (!fill && !stroke) continue;
      const key = `${fill}|${stroke}|${cs.strokeWidth}|${cs.strokeLinecap}|${cs.strokeLinejoin}`;
      const g = groups.get(key) ?? { d: [], fill, stroke, width: px(cs.strokeWidth) || 1, cap: cs.strokeLinecap, join: cs.strokeLinejoin };
      g.d.push(d);
      groups.set(key, g);
    }
    return [...groups.values()].map((g) => {
      const n: N = { type: 'path', name: nameOf(svg), context: context(svg), ...box(r, origin), geometry: g.d.join(' '), viewBox };
      if (g.fill) n.fill = g.fill;
      if (g.stroke) { n.stroke = g.stroke; n.strokeWidth = r2(g.width * (r.width / viewBox[2])); n.strokeAlignment = 'center'; if (g.cap === 'round' || g.cap === 'square') n.strokeLinecap = g.cap; if (g.join === 'round' || g.join === 'bevel') n.strokeLinejoin = g.join; }
      return n;
    });
  };

  /**
   * A text run as text nodes. A run that is its element's only content becomes one box wrapping at the
   * element's content width (editable as a paragraph); a run among inline elements becomes one node per
   * line at its exact position.
   */
  const textNodes = (node: Text, el: Element, cs: CSSStyleDeclaration, origin: { x: number; y: number }): N[] => {
    const raw = node.textContent ?? '';
    const first = raw.search(/\S/);
    if (first < 0) return [];
    const last = raw.length - (raw.match(/\s*$/)?.[0].length ?? 0);
    const range = document.createRange();
    range.setStart(node, first);
    range.setEnd(node, last);
    const all = range.getBoundingClientRect();
    if (all.width === 0 || all.height === 0) return [];
    const style = textStyle(cs);
    const alone = el.childNodes.length === 1 && !/^inline/.test(cs.display);
    const tops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top / 2)));
    if (tops.size <= 1 || alone) {
      const t: N = { type: 'text', name: raw.trim().slice(0, 40), ...box(all, origin), content: transform(raw, cs).trim(), ...style };
      if (tops.size > 1) {
        const er = el.getBoundingClientRect();
        const left = er.left + px(cs.paddingLeft) + px(cs.borderLeftWidth);
        const width = er.width - px(cs.paddingLeft) - px(cs.paddingRight) - px(cs.borderLeftWidth) - px(cs.borderRightWidth);
        t.x = r2(left + scrollX - origin.x);
        t.textGrowth = 'fixed-width';
        t.width = r2(width);
      }
      delete t.height;
      if (t.textGrowth !== 'fixed-width') delete t.width;
      return [t];
    }
    // Several lines among inline siblings: find where each line starts, one character at a time.
    const lines: { start: number; end: number; top: number }[] = [];
    const ch = document.createRange();
    for (let i = first; i < last; i++) {
      ch.setStart(node, i);
      ch.setEnd(node, i + 1);
      const r = ch.getClientRects()[0];
      if (!r) continue;
      const top = Math.round(r.top);
      const cur = lines[lines.length - 1];
      if (!cur || Math.abs(top - cur.top) > 2) lines.push({ start: i, end: i + 1, top });
      else cur.end = i + 1;
    }
    const out: N[] = [];
    for (const line of lines) {
      const text = raw.slice(line.start, line.end);
      const lead = text.search(/\S/);
      if (lead < 0) continue;
      const trail = text.length - (text.match(/\s*$/)?.[0].length ?? 0);
      ch.setStart(node, line.start + lead);
      ch.setEnd(node, line.start + trail);
      const r = ch.getBoundingClientRect();
      const t: N = { type: 'text', name: text.trim().slice(0, 40), ...box(r, origin), content: transform(text, cs).trim(), ...style };
      delete t.width;
      delete t.height;
      out.push(t);
    }
    return out;
  };

  /** Nodes for `el` placed relative to `origin` (the page position of the nearest emitted frame). */
  const walk = (el: Element, origin: { x: number; y: number }, isRoot: boolean): N[] => {
    if (count >= opts.maxNodes) { truncated = true; return []; }
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return [];
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'template', 'head', 'meta', 'link'].includes(tag)) return [];
    const r = el.getBoundingClientRect();
    const b = isRoot && opts.fullPage ? { x: 0, y: 0, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight } : box(r, origin);
    if (tag === 'svg') { const nodes = svgNodes(el as SVGSVGElement, origin); count += nodes.length; return nodes; }
    if (tag === 'img' || tag === 'picture' || tag === 'video' || tag === 'canvas' || tag === 'iframe') {
      if (r.width === 0 || r.height === 0) return [];
      count++;
      const src = tag === 'img' ? ((el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src) : tag === 'video' ? (el as HTMLVideoElement).poster : '';
      const fit = cs.objectFit === 'cover' ? 'cover' : cs.objectFit === 'contain' || cs.objectFit === 'scale-down' ? 'contain' : 'stretch';
      const n: N = { type: 'rectangle', name: nameOf(el), context: context(el), ...b, fill: src && !src.startsWith('blob:') ? { type: 'image', url: src, mode: fit } : '#D9DCE3' };
      const rad = radius(cs);
      if (rad !== undefined) n.cornerRadius = rad;
      return [n];
    }
    const fill = fills(cs);
    const shadow = shadows(cs);
    const node: N = { type: 'frame', name: nameOf(el), context: context(el), layout: 'none', ...b };
    if (fill !== undefined) node.fill = fill;
    strokeOf(cs, node);
    const rad = radius(cs);
    if (rad !== undefined && (fill !== undefined || node.stroke !== undefined || shadow.length)) node.cornerRadius = rad;
    if (shadow.length) node.effect = shadow.length === 1 ? shadow[0] : shadow;
    const opacity = parseFloat(cs.opacity);
    if (opacity < 1) node.opacity = r2(opacity);
    const clips = cs.overflow !== 'visible' && cs.overflow !== 'unset' && el.children.length > 0;
    if (clips) node.clip = true;
    const draws = isRoot || fill !== undefined || node.stroke !== undefined || shadow.length > 0 || opacity < 1 || clips || tag === 'input' || tag === 'textarea' || tag === 'button' || tag === 'select';
    const inner = draws ? { x: origin.x + (b.x as number), y: origin.y + (b.y as number) } : origin;
    const kids: N[] = [];
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) kids.push(...walk(child as Element, inner, false));
      else if (child.nodeType === Node.TEXT_NODE) {
        const nodes = textNodes(child as Text, el, cs, inner);
        kids.push(...nodes);
        count += nodes.length;
      }
      if (count >= opts.maxNodes) { truncated = true; break; }
    }
    if ((tag === 'input' || tag === 'textarea') && !(el as HTMLInputElement).type?.match(/checkbox|radio|range|color/)) {
      const value = (el as HTMLInputElement).value || (el as HTMLInputElement).placeholder;
      if (value) {
        const pad = { x: px(cs.paddingLeft) + px(cs.borderLeftWidth), y: (b.height as number) / 2 - px(cs.fontSize) * 0.6 };
        kids.push({ type: 'text', name: (el as HTMLInputElement).value ? 'Value' : 'Placeholder', x: r2(pad.x), y: r2(pad.y), content: value, ...textStyle(cs), ...((el as HTMLInputElement).value ? {} : { opacity: 0.55 }) });
      }
    }
    if (!draws) return kids;
    count++;
    node.children = kids;
    return [node];
  };

  const origin = opts.fullPage ? { x: 0, y: 0 } : (() => { const r = root.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY }; })();
  const [node] = walk(root, { x: origin.x, y: origin.y }, true);
  const result = node ?? { type: 'frame', name: 'Imported page', layout: 'none', x: 0, y: 0, width: 100, height: 100, children: [] };
  result.x = 0;
  result.y = 0;
  if (!result.fill) {
    const bg = hex(getComputedStyle(document.body).backgroundColor) ?? hex(getComputedStyle(document.documentElement).backgroundColor);
    result.fill = bg ?? '#FFFFFF';
  }
  if (opts.fullPage) result.name = document.title || location.hostname;
  return { node: result, count, truncated };
}
