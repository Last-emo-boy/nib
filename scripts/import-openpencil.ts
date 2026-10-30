// Convert ZSeven-W/openpencil's scene templates (.op, MIT) to .pen templates for nib's dashboard.
// node scripts/import-openpencil.ts <openpencil checkout or download dir> <commit sha>
// The source dir needs: scenes/*.op, scene_templates*.toml, i18n-en_*.rs, i18n-zh_cn_*.rs, LICENSE.
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Json = Record<string, any>;

const OUT = fileURLToPath(new URL('../packages/daemon/templates/openpencil/', import.meta.url));

/** CSS rgb()/rgba() colors become hex (with alpha); hex and $variables pass through. */
function color(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v.trim());
  if (!m) return v;
  const hex = (x: number) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0').toUpperCase();
  const a = m[4] === undefined ? 1 : Number(m[4]);
  return `#${hex(+m[1])}${hex(+m[2])}${hex(+m[3])}${a < 1 ? hex(a * 255) : ''}`;
}

/** One `.op` paint to a `.pen` fill (or undefined when it has no visible effect). */
function fill(f: Json): unknown {
  switch (f?.type) {
    case 'solid': return color(f.color);
    case 'linear_gradient':
      // openpencil angles are CSS angles (clockwise, 0 = towards the top); .pen rotation is counter-clockwise.
      return { type: 'gradient', gradientType: 'linear', rotation: (360 - Number(f.angle ?? 180)) % 360, colors: stops(f.stops) };
    case 'radial_gradient':
      return { type: 'gradient', gradientType: 'radial', center: { x: f.cx ?? 0.5, y: f.cy ?? 0.5 }, size: { width: 2 * (f.radius ?? 0.5), height: 2 * (f.radius ?? 0.5) }, colors: stops(f.stops) };
    case 'image': {
      const url = f.url || f.src;
      return url ? { type: 'image', url, mode: f.mode === 'fit' ? 'contain' : f.mode === 'stretch' ? 'stretch' : 'cover' } : undefined;
    }
    case 'mesh_gradient': {
      const colors = (f.stops ?? []).map((s: Json) => s.color).filter(Boolean);
      return colors.length ? { type: 'gradient', gradientType: 'linear', rotation: 225, colors: colors.map((c: string, i: number) => ({ color: c, position: colors.length > 1 ? i / (colors.length - 1) : 0 })) } : undefined;
    }
    default: return undefined;
  }
}

const stops = (list: Json[] = []) => list.map((s) => ({ color: color(s.color), position: s.offset ?? 0 }));

function fills(v: unknown): unknown {
  const list = (Array.isArray(v) ? v : v ? [v] : []).map((f) => fill(f as Json)).filter((f) => f !== undefined);
  return list.length === 0 ? undefined : list.length === 1 ? list[0] : list;
}

/** Common properties: identity, position, sizing, opacity, rotation, paint, stroke, effects. */
function base(n: Json, out: Json): Json {
  for (const k of ['id', 'name', 'x', 'y', 'width', 'height', 'opacity', 'rotation', 'cornerRadius']) if (n[k] !== undefined) out[k] = n[k];
  if (out.rotation !== undefined) out.rotation = -out.rotation; // openpencil turns clockwise, .pen counter-clockwise
  const f = fills(n.fill);
  if (f !== undefined) out.fill = f;
  if (n.stroke && typeof n.stroke === 'object') {
    const s = fills(n.stroke.fill);
    const t = n.stroke.thickness;
    const zero = typeof t === 'number' ? t === 0 : !!t && Object.values(t).every((x) => !x);
    if (s !== undefined && !zero) {
      out.stroke = s;
      out.strokeWidth = Array.isArray(t) ? { top: t[0] ?? 0, right: t[1] ?? 0, bottom: t[2] ?? 0, left: t[3] ?? 0 } : t ?? 1;
      if (n.stroke.align === 'center') out.strokeAlignment = 'center';
      if (n.stroke.align === 'outside') out.strokeAlignment = 'outer';
    }
  }
  const effects = (n.effects ?? []).filter((e: Json) => e.type === 'shadow').map((e: Json) => ({
    type: 'shadow', ...(e.inner ? { shadowType: 'inner' } : {}), offset: { x: e.offsetX ?? 0, y: e.offsetY ?? 0 }, blur: e.blur ?? 0, ...(e.spread ? { spread: e.spread } : {}), color: color(e.color ?? '#00000040'),
  }));
  if (effects.length) out.effect = effects.length === 1 ? effects[0] : effects;
  return out;
}

/** Container layout; `alignItems: stretch` (not in .pen) becomes start with children filling the cross axis. */
function container(n: Json, out: Json, children: Json[]): Json {
  if (n.layout) out.layout = n.layout;
  for (const k of ['gap', 'padding', 'justifyContent']) if (n[k] !== undefined) out[k] = n[k];
  if (n.alignItems && n.alignItems !== 'stretch') out.alignItems = n.alignItems;
  if (n.clipContent) out.clip = true;
  if (n.alignItems === 'stretch') {
    const cross = n.layout === 'vertical' ? 'width' : 'height';
    for (const c of children) if (typeof c[cross] !== 'number') c[cross] = 'fill_container';
  }
  out.children = children;
  return out;
}

const text = (content: string, color: string, size: number, extra: Json = {}): Json => ({ type: 'text', content, fill: color, fontSize: size, fontFamily: 'Inter', ...extra });
const strokeColor = (n: Json) => (fills(n.stroke?.fill) as string | undefined) ?? '#3F3F46';

/** Convert one node; ids stay (they are unique within a template). */
function node(n: Json): Json | undefined {
  const kids = () => (n.children ?? []).map(node).filter((c: Json | undefined): c is Json => !!c);
  switch (n.type) {
    case 'frame':
      return container(n, base(n, { type: 'frame' }), kids());
    case 'group':
      // .pen groups take their size from their children; these have their own, so they become free frames.
      return container({ ...n, layout: 'none' }, base(n, { type: 'frame' }), kids());
    case 'rectangle':
      return n.children?.length ? container({ ...n, layout: 'none' }, base(n, { type: 'frame' }), kids()) : base(n, { type: 'rectangle' });
    case 'ellipse':
      return base(n, { type: 'ellipse' });
    case 'polygon':
      return base(n, { type: 'polygon', polygonCount: n.polygonCount ?? 6 });
    case 'path': {
      const out = base(n, { type: 'path', geometry: n.d });
      if (typeof n.width === 'number' && typeof n.height === 'number') out.viewBox = [0, 0, n.width, n.height];
      return out;
    }
    case 'text': {
      const out = base(n, { type: 'text', content: n.content ?? '' });
      for (const k of ['fontFamily', 'fontSize', 'lineHeight', 'letterSpacing', 'textAlign', 'textGrowth', 'fontStyle']) if (n[k] !== undefined) out[k] = n[k];
      if (n.fontWeight !== undefined) out.fontWeight = String(n.fontWeight);
      if ((out.textGrowth ?? 'auto') === 'auto') { delete out.width; delete out.height; }
      if (out.textGrowth === 'fixed-width') delete out.height;
      if (out.textGrowth === 'fixed-width' && typeof out.width !== 'number' && typeof out.width !== 'string') out.textGrowth = 'auto';
      return out;
    }
    case 'icon_font':
      return base(n, { type: 'icon', library: n.iconFontFamily === 'lucide' || !n.iconFontFamily ? 'lucide' : n.iconFontFamily, icon: n.iconFontName });
    case 'image': {
      const out = base(n, { type: 'rectangle' });
      const src = typeof n.src === 'string' && n.src ? n.src : undefined;
      out.fill = src ? { type: 'image', url: src, mode: 'cover' } : (fills(n.fill) ?? '#D9DCE3');
      if (n.imagePrompt) out.context = `Image placeholder: ${n.imagePrompt}`;
      return out;
    }
    case 'switch': {
      const h = typeof n.height === 'number' ? n.height : 24;
      const out = base(n, { type: 'frame', padding: 2, alignItems: 'center', justifyContent: n.checked ? 'end' : 'start' });
      if (!n.checked) out.fill = strokeColor(n);
      delete out.stroke; delete out.strokeWidth;
      out.children = [{ type: 'ellipse', id: `${n.id}-knob`, name: 'Knob', width: h - 4, height: h - 4, fill: '#FFFFFF' }];
      return out;
    }
    case 'progress':
    case 'slider': {
      const ratio = Math.max(0, Math.min(1, ((n.value ?? 0) - (n.min ?? 0)) / ((n.max ?? 100) - (n.min ?? 0) || 1)));
      const width = typeof n.width === 'number' ? n.width : 280;
      const track = n.type === 'slider' ? 4 : (typeof n.height === 'number' ? n.height : 6);
      const out = base(n, { type: 'frame', layout: 'none' });
      out.fill = undefined;
      delete out.fill; delete out.stroke; delete out.strokeWidth;
      const accent = (fills(n.fill) as string | undefined) ?? '#3B82F6';
      const top = n.type === 'slider' && typeof n.height === 'number' ? (n.height - track) / 2 : 0;
      out.children = [
        { type: 'rectangle', id: `${n.id}-track`, name: 'Track', x: 0, y: top, width: 'fill_container', height: track, cornerRadius: track / 2, fill: strokeColor(n), layoutPosition: 'absolute' },
        { type: 'rectangle', id: `${n.id}-value`, name: 'Value', x: 0, y: top, width: Math.round(width * ratio), height: track, cornerRadius: track / 2, fill: accent },
      ];
      out.children[0].width = width;
      delete out.children[0].layoutPosition;
      if (n.type === 'slider') out.children.push({ type: 'ellipse', id: `${n.id}-thumb`, name: 'Thumb', x: Math.round(width * ratio) - 8, y: top + track / 2 - 8, width: 16, height: 16, fill: '#FFFFFF', stroke: accent, strokeWidth: 2 });
      return out;
    }
    case 'select': {
      const label = (n.options ?? []).find((o: Json) => o.value === n.value)?.label ?? n.value ?? '';
      const out = base(n, { type: 'frame', padding: [0, 10], alignItems: 'center', justifyContent: 'space_between', gap: 6 });
      out.children = [text(String(label), '#E4E4E7', 13, { id: `${n.id}-label`, name: 'Value' }), { type: 'icon', id: `${n.id}-chevron`, name: 'Chevron', library: 'lucide', icon: 'chevron-down', width: 14, height: 14, fill: '#A1A1AA' }];
      return out;
    }
    case 'text_input': {
      const out = base(n, { type: 'frame', padding: [0, 14], alignItems: 'center', gap: 8 });
      const kids: Json[] = [];
      if (n.leadingIcon) kids.push({ type: 'icon', id: `${n.id}-icon`, name: 'Icon', library: 'lucide', icon: n.leadingIcon, width: 16, height: 16, fill: '#A1A1AA' });
      kids.push(text(n.value || n.placeholder || '', n.value ? '#F4F4F5' : '#71717A', 14, { id: `${n.id}-text`, name: n.value ? 'Value' : 'Placeholder' }));
      out.children = kids;
      return out;
    }
    default:
      return undefined;
  }
}

const FILL = /^fill_container/;
const isFit = (n: Json, axis: 'width' | 'height') => n[axis] === undefined || (typeof n[axis] === 'string' && n[axis].startsWith('fit_content'));

/**
 * openpencil sizes a fit_content frame from children that fill it (text at its natural width); in .pen
 * those collapse to zero. Such text becomes auto-sized and such frames fit their content. Children
 * filling a free-placed frame of fixed size get that size.
 */
function settleSizes(n: Json): void {
  const kids: Json[] = n.children ?? [];
  if (n.type === 'frame') {
    for (const axis of ['width', 'height'] as const) {
      for (const c of kids) {
        if (typeof c[axis] !== 'string' || !FILL.test(c[axis])) continue;
        if (n.layout === 'none') {
          const pad = 0;
          if (typeof n[axis] === 'number') c[axis] = n[axis] - pad - (c[axis === 'width' ? 'x' : 'y'] ?? 0);
          else c[axis] = 'fit_content';
        } else if (isFit(n, axis) && c.layoutPosition !== 'absolute') {
          if (c.type === 'text') { c.textGrowth = 'auto'; delete c.width; delete c.height; }
          else c[axis] = 'fit_content';
        }
      }
    }
  }
  kids.forEach(settleSizes);
}

export function opToPen(op: Json): Json {
  const out: Json = { version: '2.20' };
  if (op.themes) out.themes = op.themes;
  if (op.variables) out.variables = op.variables;
  out.children = (op.children ?? []).map(node).filter(Boolean);
  out.children.forEach(settleSizes);
  return out;
}

/** The flat `[[template]]` tables of the catalogue (strings, numbers, string arrays). */
function parseCatalogue(text: string): Json[] {
  const out: Json[] = [];
  let cur: Json | undefined;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '[[template]]') { cur = {}; out.push(cur); continue; }
    const m = /^([a-z_]+)\s*=\s*(.+)$/.exec(line);
    if (!m || !cur) continue;
    cur[m[1]] = JSON.parse(m[2]);
  }
  return out;
}

function strings(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of text.matchAll(/"(sceneTemplate\.item\.[A-Za-z0-9]+\.(?:title|summary))"\s*=>\s*"((?:[^"\\]|\\.)*)"/g)) map.set(m[1], JSON.parse(`"${m[2]}"`));
  return map;
}

async function main() {
  const [src, sha] = process.argv.slice(2);
  if (!src || !sha) { console.error('usage: node scripts/import-openpencil.ts <dir> <commit>'); process.exit(2); }
  const files = await readdir(src);
  const catalogue = (await Promise.all(files.filter((f) => /^scene_templates.*\.toml$/.test(f)).map(async (f) => parseCatalogue(await readFile(join(src, f), 'utf8'))))).flat();
  const en = strings((await Promise.all(files.filter((f) => /^i18n-en_.*\.rs$/.test(f)).map((f) => readFile(join(src, f), 'utf8')))).join('\n'));
  const zh = strings((await Promise.all(files.filter((f) => /^i18n-zh_cn_.*\.rs$/.test(f)).map((f) => readFile(join(src, f), 'utf8')))).join('\n'));
  await mkdir(OUT, { recursive: true });
  const index: Json[] = [];
  for (const t of catalogue) {
    const op = JSON.parse(await readFile(join(src, 'scenes', `${t.id}.op`), 'utf8').catch(() => 'null'));
    if (!op) { console.warn(`no scene for ${t.id}`); continue; }
    await writeFile(join(OUT, `${t.id}.pen`), JSON.stringify(opToPen(op)));
    index.push({
      id: t.id, scene: t.scene, frames: t.frames, width: t.frame_width, height: t.frame_height, styleGuide: t.style_guide,
      title: { en: en.get(t.title_key) ?? t.title_fallback, zh: zh.get(t.title_key) ?? t.title_fallback },
      summary: { en: en.get(t.summary_key) ?? t.summary_fallback, zh: zh.get(t.summary_key) ?? t.summary_fallback },
      tags: t.tags ?? [],
    });
  }
  await writeFile(join(OUT, 'catalog.json'), JSON.stringify(index, null, 1));
  await copyFile(join(src, 'LICENSE'), join(OUT, 'LICENSE'));
  await writeFile(join(OUT, 'SOURCE.md'), `Scene templates from [ZSeven-W/openpencil](https://github.com/ZSeven-W/openpencil) at commit ${sha} (\`crates/op-editor-core/assets/scene_templates\`), converted from \`.op\` to \`.pen\` by \`scripts/import-openpencil.ts\`, used under the MIT License in \`LICENSE\`.\n`);
  console.log(`${index.length} templates written to ${OUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
