import type { PenDocument, Variable } from '@nib/format';
import { toHex } from '@nib/export';

/**
 * A design system from a brand: the brand's color, font and corner radius, read from its website or its
 * logo, applied to a copy of one of nib's bundled libraries (each library says which of its variables
 * follow the brand).
 */

export interface Brand {
  /** The brand color, `#RRGGBB`. */
  primary: string;
  /** A font family nib can load; absent: keep the library's. */
  font?: string;
  /** Corner radius of the brand's buttons in px; absent (or pill buttons): keep the library's. */
  radius?: number;
}

/** What was read, with the other colors the person may pick instead (most used first). */
export interface BrandReading extends Brand { swatches: string[]; title?: string }

/**
 * How a library takes a brand. `anchor` becomes the brand color; each entry of `vars` is
 * - `brand`: the anchor's color, `brand/NN`: it at NN% opacity;
 * - `on`: text that reads on the anchor (white or near-black);
 * - `recolor`: the variable's own color turned to the brand's hue, keeping how it relates to the anchor.
 * Number variables named like the `radius` one scale with it.
 */
export interface BrandRecipe { anchor: string; radius?: string; font?: string; vars: Record<string, string> }

// Colors ----------------------------------------------------------------------------------------

interface Lch { L: number; C: number; h: number; alpha: number }

const lin = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const gam = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

function rgbaOf(hex: string): [number, number, number, number] {
  const h = hex.replace('#', '');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [n(0), n(2), n(4), h.length >= 8 ? n(6) : 1];
}

export function lchOf(color: string): Lch {
  const [r, g, b, alpha] = rgbaOf(toHex(color) ?? '#000000');
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(a, bb), h: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360, alpha };
}

function rgbOfLch({ L, C, h }: Lch): number[] {
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

/** A color as hex, with chroma lowered until it fits in sRGB. */
export function hexOfLch(c: Lch): string {
  let C = c.C, rgb = rgbOfLch({ ...c, C });
  while (C > 0 && rgb.some((x) => x < -1e-4 || x > 1 + 1e-4)) { C = Math.max(0, C - 0.004); rgb = rgbOfLch({ ...c, C }); }
  const hex = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${rgb.map((x) => hex(gam(x))).join('')}${c.alpha < 1 ? hex(c.alpha) : ''}`;
}

function luminance(color: string): number {
  const [r, g, b] = rgbaOf(toHex(color) ?? '#000000');
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Text for a filled button in `color`: white unless it reads poorly (bold button text needs 3:1). */
export const onColor = (color: string) => (contrast(color, '#FFFFFF') >= 3 ? '#FFFFFF' : '#0A0A0A');

const distance = (a: Lch, b: Lch) => {
  const ab = (c: Lch) => [c.C * Math.cos((c.h * Math.PI) / 180), c.C * Math.sin((c.h * Math.PI) / 180)];
  const [a1, b1] = ab(a), [a2, b2] = ab(b);
  return Math.hypot(a.L - b.L, a1 - a2, b1 - b2);
};

/** A color that can be a brand: colorful, neither near white nor near black. */
const colorful = (c: Lch) => c.C >= 0.05 && c.L >= 0.25 && c.L <= 0.93;

/**
 * Colors by weight, similar ones merged (the heavier one's value kept), most used first; colorful ones
 * ahead of grays, which only lead when there is nothing else (a black-and-white brand).
 */
export function rankColors(weighted: [string, number][]): string[] {
  return ranked(weighted).map((g) => g.hex);
}

function ranked(weighted: [string, number][]): { hex: string; lch: Lch; score: number }[] {
  const groups: { hex: string; lch: Lch; weight: number; top: number }[] = [];
  for (const [color, weight] of weighted) {
    const hex = toHex(color);
    if (!hex || weight <= 0) continue;
    const lch = lchOf(hex);
    if (lch.alpha < 0.5) continue;
    const solid = hex.slice(0, 7);
    const g = groups.find((x) => distance(x.lch, lch) < 0.06);
    if (!g) groups.push({ hex: solid, lch: { ...lch, alpha: 1 }, weight, top: weight });
    else {
      g.weight += weight;
      if (weight > g.top) Object.assign(g, { hex: solid, lch: { ...lch, alpha: 1 }, top: weight });
    }
  }
  return groups.map((g) => ({ hex: g.hex, lch: g.lch, score: g.weight * (colorful(g.lch) ? 4 : 1) })).sort((a, b) => b.score - a.score);
}

// Reading a website ------------------------------------------------------------------------------

/** What the page script collects (colors already `#RRGGBBAA`). */
export interface PageSample {
  title: string;
  /** Custom properties of :root whose names say brand, primary or accent. */
  vars: Record<string, string>;
  themeColor?: string;
  /** Buttons and button-like links: fill, text, border, corner radius, size, distance from the top. */
  buttons: { bg?: string; border?: string; color: string; radius: number; width: number; height: number; top: number }[];
  /** Colors of plain links. */
  links: string[];
  headings: string[];
  /** Colors an inline SVG logo near the top of the page is drawn in. */
  logo: string[];
  body: { bg: string; color: string; font: string };
}

/** Runs in the page; returns a PageSample. Colors go through a canvas so every CSS color syntax comes out as hex. */
export const PAGE_SCRIPT = `(() => {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const hex = (c) => {
    if (!c || c === 'transparent' || /^rgba\\(0, 0, 0, 0\\)$/.test(c)) return undefined;
    ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    if (a === 0) return undefined;
    return '#' + [r, g, b, a].map((x) => x.toString(16).padStart(2, '0')).join('');
  };
  const box = (el) => { const r = el.getBoundingClientRect(); return r.width >= 8 && r.height >= 8 && r.top + scrollY < 4000 ? r : undefined; };
  const out = { title: document.title, vars: {}, buttons: [], links: [], headings: [], logo: [], body: {} };
  if (!(document.documentElement instanceof Element) || !document.body) return null;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) out.themeColor = hex(meta.getAttribute('content'));
  const root = getComputedStyle(document.documentElement);
  const names = new Set();
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) {
      if (!rule.style || !/^(:root|html)$/.test((rule.selectorText || '').trim())) continue;
      for (const p of rule.style) if (p.startsWith('--') && /brand|primary|accent/i.test(p) && !/foreground|text|fg|contrast|on-/i.test(p)) names.add(p);
    }
  }
  for (const p of names) { const v = hex(root.getPropertyValue(p).trim()); if (v) out.vars[p] = v; }
  let bg; for (let el = document.body; el && !bg; el = el.parentElement) bg = hex(getComputedStyle(el).backgroundColor);
  const bs = getComputedStyle(document.body);
  out.body = { bg: bg || '#ffffffff', color: hex(bs.color) || '#000000ff', font: bs.fontFamily };
  for (const el of document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]')) {
    const r = box(el); if (!r) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.3) continue;
    const fill = hex(cs.backgroundColor);
    const border = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' ? hex(cs.borderTopColor) : undefined;
    if ((fill && fill !== out.body.bg) || border) {
      if (out.buttons.length < 200) out.buttons.push({ bg: fill, border, color: hex(cs.color) || '', radius: parseFloat(cs.borderTopLeftRadius) || 0, width: r.width, height: r.height, top: r.top + scrollY });
    } else if (el.tagName === 'A' && out.links.length < 300) { const c = hex(cs.color); if (c) out.links.push(c); }
  }
  const logo = [...document.querySelectorAll('header svg, nav svg, a[href="/"] svg, [class*="logo" i] svg, svg[class*="logo" i], svg[aria-label*="logo" i]')]
    .find((s) => { const r = s.getBoundingClientRect(); return r.width >= 16 && r.height >= 12 && r.top + scrollY < 240; });
  if (logo) for (const el of logo.querySelectorAll('path, rect, circle, ellipse, polygon, text')) {
    const cs = getComputedStyle(el);
    for (const c of [cs.fill, cs.stroke]) { const v = hex(c); if (v && out.logo.length < 60) out.logo.push(v); }
  }
  for (const h of document.querySelectorAll('h1, h2, h3')) { if (!box(h)) continue; const c = hex(getComputedStyle(h).color); if (c) out.headings.push(c); if (out.headings.length >= 30) break; }
  return out;
})()`;

/** The brand a page shows: its declared brand color if any, else the color of its buttons and links. */
export function brandFromPage(sample: PageSample): Omit<BrandReading, 'font'> {
  const weighted: [string, number][] = [];
  for (const v of Object.values(sample.vars)) weighted.push([v, 40]);
  if (sample.themeColor) weighted.push([sample.themeColor, 20]);
  for (const b of sample.buttons) {
    // Filled buttons near the top of the page say the most.
    const near = b.top < 1000 ? 2 : 1;
    if (b.bg) weighted.push([b.bg, 6 * near]);
    else if (b.border && colorful(lchOf(b.border))) weighted.push([b.border, 2 * near]);
    if (!b.bg) weighted.push([b.color, 1]);
  }
  for (const l of sample.links) weighted.push([l, 1]);
  for (const h of sample.headings) weighted.push([h, 1]);
  for (const c of sample.logo ?? []) weighted.push([c, 8]);
  const bg = lchOf(toHex(sample.body.bg) ?? '#FFFFFF');
  const groups = ranked(weighted).filter((g) => distance(g.lch, bg) > 0.04);
  const swatches = groups.map((g) => g.hex);
  // A color with a fair share beats black and grays (black text and outlines are everywhere); near white cannot
  // be the brand, since the brand color fills buttons on a light background too (a dark site's white buttons).
  const candidates = groups.filter((g) => g.lch.L <= 0.9);
  const vivid = candidates.find((g) => colorful(g.lch));
  const primary = (vivid && candidates[0] && vivid.score >= candidates[0].score * 0.15 ? vivid : candidates[0])?.hex ?? (toHex(sample.body.color) ?? '#171717').slice(0, 7);
  // The corner radius of filled buttons: the median, unless they are pills (a component's shape, not the system's).
  const radii = sample.buttons.filter((b) => b.bg && b.height <= 72).map((b) => ({ r: b.radius, pill: b.radius >= b.height / 2 - 1 })).sort((a, b) => a.r - b.r);
  const mid = radii[Math.floor(radii.length / 2)];
  const radius = mid && !mid.pill ? Math.min(24, Math.round(mid.r)) : undefined;
  return { primary, swatches: swatches.slice(0, 8), ...(radius !== undefined ? { radius } : {}), ...(sample.title ? { title: sample.title } : {}) };
}

// Reading a logo ---------------------------------------------------------------------------------

/** The colors of a logo's pixels (RGBA), most used first, transparent and near-white background left out. */
export function paletteFromPixels(rgba: Uint8Array, width: number, height: number): string[] {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 40000)));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (rgba[i + 3] < 160) continue;
      const key = ((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3);
      const k = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
      k.r += rgba[i]; k.g += rgba[i + 1]; k.b += rgba[i + 2]; k.n++;
      buckets.set(key, k);
    }
  }
  const hex2 = (x: number) => Math.round(x).toString(16).padStart(2, '0');
  const weighted = [...buckets.values()].map((k) => [`#${hex2(k.r / k.n)}${hex2(k.g / k.n)}${hex2(k.b / k.n)}`, k.n] as [string, number]);
  return rankColors(weighted).filter((c) => lchOf(c).L < 0.97);
}

/** The colors an SVG logo is drawn with (fill, stroke and stop colors), most used first. */
export function paletteFromSvg(svg: string): string[] {
  const counts = new Map<string, number>();
  for (const m of svg.matchAll(/(?:fill|stroke|stop-color|color)\s*[:=]\s*["']?\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))/g)) {
    const hex = toHex(m[1]);
    if (hex) counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return rankColors([...counts]).filter((c) => lchOf(c).L < 0.97);
}

export function brandFromPalette(palette: string[]): BrandReading {
  return { primary: palette[0] ?? '#171717', swatches: palette.slice(0, 8) };
}

// Theming a library ------------------------------------------------------------------------------

type Entry = { value: unknown; theme?: Record<string, string> };

/** A copy of library `base` in the brand's color, font and radius. */
export function brandedLibrary(base: PenDocument, recipe: BrandRecipe, brand: Brand): PenDocument {
  const doc = structuredClone(base);
  const vars = (doc.variables ?? {}) as Record<string, Variable>;
  const anchorVar = vars[recipe.anchor];
  if (!anchorVar) throw new Error(`the library has no variable "${recipe.anchor}"`);
  const entries = (v: Variable): Entry[] => (Array.isArray(v.value) ? (v.value as Entry[]) : [{ value: v.value }]);
  const sameTheme = (a?: Record<string, string>, b?: Record<string, string>) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
  const anchorEntries = entries(anchorVar);
  const anchorBase = lchOf(String(anchorEntries[0].value));
  const brandHex = toHex(brand.primary)?.slice(0, 7);
  if (!brandHex) throw new Error(`"${brand.primary}" is not a color`);
  const b = lchOf(brandHex);

  /** Turn `color` (the library's value in some theme) to the brand: hue moved as far as the anchor's, chroma in proportion, lightness pulled along near the anchor's. */
  const recolor = (color: string): string => {
    const c = lchOf(color);
    const ratio = anchorBase.C > 0.02 ? b.C / anchorBase.C : 1;
    const near = Math.max(0, 1 - Math.abs(c.L - anchorBase.L) / 0.35);
    return hexOfLch({ L: Math.min(0.99, Math.max(0, c.L + (b.L - anchorBase.L) * near)), C: c.C * ratio, h: (b.h + (c.h - anchorBase.h) + 360) % 360, alpha: c.alpha });
  };

  // The anchor in each theme: the brand itself where the library's anchor is its light value (or the same in every
  // theme); in other themes, the library's value recolored, or for a neutral library (black and white primary) the
  // brand made light enough to stand out on a dark background.
  const anchorIn = anchorEntries.map((e, i) => {
    const v = String(e.value);
    if (i === 0 || toHex(v) === toHex(String(anchorEntries[0].value))) return brandHex;
    if (lchOf(v).C < 0.03) return hexOfLch({ ...b, L: Math.max(b.L, 0.62), alpha: 1 });
    return recolor(v);
  });
  const anchorFor = (theme?: Record<string, string>) => anchorIn[Math.max(0, anchorEntries.findIndex((e) => sameTheme(e.theme, theme)))];

  const apply = (name: string, fn: (value: string, theme?: Record<string, string>) => string) => {
    const v = vars[name];
    if (!v || v.type !== 'color') return;
    const next = entries(v).map((e) => ({ ...e, value: fn(String(e.value), e.theme) }));
    (v as { value: unknown }).value = Array.isArray(v.value) ? next : next[0].value;
  };
  apply(recipe.anchor, (_, theme) => anchorFor(theme));
  for (const [name, how] of Object.entries(recipe.vars)) {
    const alpha = /^brand\/(\d+)$/.exec(how);
    if (how === 'brand') apply(name, (_, theme) => anchorFor(theme));
    else if (alpha) apply(name, (_, theme) => `${anchorFor(theme)}${Math.round((Number(alpha[1]) / 100) * 255).toString(16).padStart(2, '0').toUpperCase()}`);
    else if (how === 'on') apply(name, (_, theme) => onColor(anchorFor(theme)));
    else if (how === 'recolor') apply(name, (value) => recolor(value));
    else throw new Error(`unknown brand recipe "${how}" for ${name}`);
  }

  if (brand.radius !== undefined && recipe.radius && vars[recipe.radius]?.type === 'number') {
    const baseR = Number(vars[recipe.radius].value);
    const family = recipe.radius.replace(/[-\d]+.*$/, '');
    for (const [name, v] of Object.entries(vars)) {
      if (v.type !== 'number' || !name.includes(family) || typeof v.value !== 'number' || v.value >= 999) continue;
      (v as { value: number }).value = baseR > 0 ? Math.round((v.value * brand.radius) / baseR) : brand.radius;
    }
  }
  if (brand.font && recipe.font && vars[recipe.font]) (vars[recipe.font] as { value: unknown }).value = brand.font;
  return doc;
}
