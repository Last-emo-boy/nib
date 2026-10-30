import type { PenDocument, Variable } from '@nib/format';

/**
 * A document's variables as design tokens, and back: CSS custom properties (one block per theme value),
 * a Tailwind v4 theme that points at them, and W3C design tokens JSON (themes in `$extensions`).
 */

type Value = string | number | boolean;
type Theme = Record<string, string>;

/** The value of a variable for a theme: the last themed entry that matches, else its plain value, else its first. */
function valueFor(v: Variable, theme: Theme): Value | undefined {
  const value = v.value as unknown;
  if (!Array.isArray(value)) return value as Value;
  let out: Value | undefined;
  for (const e of value as { value: Value; theme?: Theme }[]) {
    if (!e.theme) { out ??= e.value; continue; }
    if (Object.entries(e.theme).every(([k, x]) => theme[k] === x)) out = e.value;
  }
  return out ?? (value as { value: Value }[])[0]?.value;
}

/** The theme combinations a document's variables distinguish: each value of each axis, against the defaults. */
function themesOf(doc: PenDocument): { axis: string; value: string; theme: Theme }[] {
  const axes = Object.entries(doc.themes ?? {});
  const base = Object.fromEntries(axes.map(([a, vs]) => [a, vs[0]]));
  return axes.flatMap(([axis, values]) => values.slice(1).map((value) => ({ axis, value, theme: { ...base, [axis]: value } })));
}

const baseTheme = (doc: PenDocument): Theme => Object.fromEntries(Object.entries(doc.themes ?? {}).map(([a, vs]) => [a, vs[0]]));

/** A CSS value for a variable: numbers in px (they are px on the canvas) unless the name says otherwise. */
function css(name: string, v: Variable, value: Value): string {
  if (v.type === 'number' && typeof value === 'number') return /opacity|weight|scale|ratio|z-index|line-height|leading/i.test(name) ? String(value) : `${value}px`;
  if (v.type === 'string' && typeof value === 'string' && /\s/.test(value) && !/^["']/.test(value)) return `"${value}"`;
  return String(value);
}

/** A selector for a theme value: `.dark` for a Dark mode (the common convention), a data attribute otherwise. */
function selector(axis: string, value: string): string {
  const attr = `[data-${axis.toLowerCase()}="${value.toLowerCase()}"]`;
  return /^dark$/i.test(value) ? `.dark, ${attr}` : attr;
}

const cssName = (name: string) => `--${name.replace(/[^A-Za-z0-9_-]+/g, '-')}`;

/** CSS custom properties: defaults in :root, each other theme value in its own block (only what changes). */
export function tokensToCss(doc: PenDocument): string {
  const vars = Object.entries(doc.variables ?? {}).filter(([, v]) => v.type !== 'boolean');
  const base = baseTheme(doc);
  const block = (sel: string, entries: [string, string][]) => (entries.length ? `${sel} {\n${entries.map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}` : '');
  const root = vars.flatMap(([name, v]) => { const x = valueFor(v, base); return x === undefined ? [] : [[cssName(name), css(name, v, x)] as [string, string]]; });
  const out = [block(':root', root)];
  for (const t of themesOf(doc)) {
    const changed = vars.flatMap(([name, v]) => {
      const x = valueFor(v, t.theme);
      return x === undefined || x === valueFor(v, base) ? [] : [[cssName(name), css(name, v, x)] as [string, string]];
    });
    out.push(block(selector(t.axis, t.value), changed));
  }
  return `${out.filter(Boolean).join('\n\n')}\n`;
}

/** A Tailwind v4 theme whose colors, radii and fonts use the CSS variables (`bg-primary`, `rounded-card`). */
export function tokensToTailwind(doc: PenDocument): string {
  const lines: string[] = [];
  for (const [name, v] of Object.entries(doc.variables ?? {})) {
    const n = name.replace(/[^A-Za-z0-9_-]+/g, '-');
    if (v.type === 'color') lines.push(`  --color-${n}: var(--${n});`);
    else if (v.type === 'number' && /radius|rounded|corner/i.test(name)) lines.push(`  --radius-${n.replace(/^radius-?/, '') || 'DEFAULT'}: var(--${n});`);
    else if (v.type === 'number' && /space|spacing|gap|padding/i.test(name)) lines.push(`  --spacing-${n.replace(/^(space|spacing)-?/, '')}: var(--${n});`);
    else if (v.type === 'string' && /font/i.test(name)) lines.push(`  --font-${n.replace(/^font-?/, '') || 'sans'}: var(--${n});`);
  }
  return `@import "tailwindcss";\n\n/* The values are in tokens.css (the CSS variables nib exports). */\n@theme inline {\n${lines.join('\n')}\n}\n`;
}

/** W3C design tokens (DTCG): one token per variable; the values of other themes under `$extensions.nib.themes`. */
export function tokensToJson(doc: PenDocument): string {
  const base = baseTheme(doc);
  const type = (v: Variable) => (v.type === 'color' ? 'color' : v.type === 'number' ? 'dimension' : v.type === 'string' ? 'fontFamily' : 'boolean');
  const out: Record<string, unknown> = {};
  for (const [name, v] of Object.entries(doc.variables ?? {})) {
    const value = valueFor(v, base);
    if (value === undefined) continue;
    const themes: Record<string, Value> = {};
    for (const t of themesOf(doc)) {
      const x = valueFor(v, t.theme);
      if (x !== undefined && x !== value) themes[`${t.axis}=${t.value}`] = v.type === 'number' && typeof x === 'number' ? `${x}px` : x;
    }
    out[name] = {
      $type: type(v),
      $value: v.type === 'number' && typeof value === 'number' ? `${value}px` : value,
      ...(Object.keys(themes).length ? { $extensions: { nib: { themes } } } : {}),
    };
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** Variables and themes read from tokens: CSS custom properties or W3C design tokens JSON. */
export interface ImportedTokens { variables: Record<string, Variable>; themes?: Record<string, string[]>; skipped: string[] }

/** Read CSS custom properties: :root (or html) gives defaults; `.dark` and `[data-*="…"]` blocks give theme values. */
export function tokensFromCss(text: string): ImportedTokens {
  const values = new Map<string, { base?: Value; themed: { theme: Theme; value: Value }[]; type: Variable['type'] }>();
  const themes = new Map<string, Set<string>>();
  const skipped: string[] = [];
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    const theme = themeOfSelector(sel);
    if (theme === null) continue;
    for (const d of m[2].matchAll(/--([\w-]+)\s*:\s*([^;]+);?/g)) {
      const name = d[1], raw = d[2].trim();
      const parsed = parseValue(raw);
      if (!parsed) { if (!skipped.includes(name)) skipped.push(name); continue; }
      const entry = values.get(name) ?? { themed: [], type: parsed.type };
      if (theme === undefined) entry.base = parsed.value;
      else {
        entry.themed.push({ theme, value: parsed.value });
        for (const [axis, value] of Object.entries(theme)) (themes.get(axis) ?? themes.set(axis, new Set()).get(axis)!).add(value);
      }
      values.set(name, entry);
    }
  }
  return build(values, themes, skipped);
}

/** `:root` -> undefined (defaults); `.dark` -> {Mode: Dark}; `[data-theme="x"]` -> {Theme: X}; other selectors -> null (ignored). */
function themeOfSelector(sel: string): Theme | undefined | null {
  const parts = sel.split(',').map((s) => s.trim());
  if (parts.some((p) => p === ':root' || p === 'html' || p === ':host' || p === '@theme' || p.startsWith('@theme'))) return undefined;
  for (const p of parts) {
    if (/^\.dark$|^\[data-(?:mode|theme|color-scheme)=["']?dark["']?\]$|^:root\.dark$|^html\.dark$/i.test(p)) return { Mode: 'Dark' };
    const m = /\[data-([\w-]+)=["']?([\w-]+)["']?\]/.exec(p);
    if (m) return { [cap(m[1])]: cap(m[2]) };
  }
  return null;
}

const cap = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);

/** W3C design tokens JSON: groups nest, tokens have `$value`; a name is its path joined with "-". */
export function tokensFromJson(text: string): ImportedTokens {
  const values = new Map<string, { base?: Value; themed: { theme: Theme; value: Value }[]; type: Variable['type'] }>();
  const themes = new Map<string, Set<string>>();
  const skipped: string[] = [];
  const walk = (node: unknown, path: string[], inherited?: string) => {
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    const type = typeof o.$type === 'string' ? o.$type : inherited;
    if ('$value' in o) {
      const name = path.join('-');
      const parsed = parseValue(String(o.$value), type);
      if (!parsed) { skipped.push(name); return; }
      const entry = { base: parsed.value, themed: [] as { theme: Theme; value: Value }[], type: parsed.type };
      const ext = ((o.$extensions as Record<string, unknown> | undefined)?.nib as { themes?: Record<string, unknown> } | undefined)?.themes ?? {};
      for (const [key, v] of Object.entries(ext)) {
        const [axis, value] = key.split('=');
        const p = parseValue(String(v), type);
        if (!axis || !value || !p) continue;
        entry.themed.push({ theme: { [axis]: value }, value: p.value });
        (themes.get(axis) ?? themes.set(axis, new Set()).get(axis)!).add(value);
      }
      values.set(name, entry);
      return;
    }
    for (const [k, v] of Object.entries(o)) if (!k.startsWith('$')) walk(v, [...path, k], type);
  };
  walk(JSON.parse(text), []);
  return build(values, themes, skipped);
}

function build(values: Map<string, { base?: Value; themed: { theme: Theme; value: Value }[]; type: Variable['type'] }>, themes: Map<string, Set<string>>, skipped: string[]): ImportedTokens {
  // Each axis starts with the defaults' value: Light before Dark.
  const axes: Record<string, string[]> = {};
  for (const [axis, set] of themes) axes[axis] = [axis === 'Mode' ? 'Light' : 'Default', ...[...set].filter((v) => v !== 'Light' && v !== 'Default')];
  const variables: Record<string, Variable> = {};
  for (const [name, e] of values) {
    if (e.base === undefined && !e.themed.length) continue;
    const base = e.base ?? e.themed[0].value;
    if (!e.themed.length) { variables[name] = { type: e.type, value: base } as Variable; continue; }
    const first = Object.fromEntries(Object.entries(axes).map(([a, vs]) => [a, vs[0]]));
    variables[name] = { type: e.type, value: [{ value: base, theme: first }, ...e.themed.map((t) => ({ value: t.value, theme: t.theme }))] } as unknown as Variable;
  }
  return { variables, ...(Object.keys(axes).length ? { themes: axes } : {}), skipped };
}

/** A token's value as a variable: colors to hex, lengths to px numbers, fonts and other words to strings. */
function parseValue(raw: string, type?: string): { type: Variable['type']; value: Value } | undefined {
  const v = raw.trim().replace(/\s*!important$/, '');
  const color = toHex(v);
  if (color) return { type: 'color', value: color };
  const len = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(v);
  if (len) return { type: 'number', value: Math.round(parseFloat(len[1]) * (len[2] === 'rem' || len[2] === 'em' ? 16 : 1) * 100) / 100 };
  if (/^var\(|calc\(|color-mix\(/.test(v)) return undefined;
  if (type === 'color') return undefined;
  return { type: 'string', value: v.replace(/^["']|["']$/g, '') };
}

const NAMED: Record<string, string> = { white: '#FFFFFF', black: '#000000', transparent: '#00000000', red: '#FF0000', blue: '#0000FF', green: '#008000' };

/** CSS colors nib can store: hex, rgb(), hsl(), oklch(), a few names. */
export function toHex(v: string): string | undefined {
  const s = v.trim().toLowerCase();
  if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(s)) {
    const h = s.length <= 5 ? `#${s.slice(1).split('').map((c) => c + c).join('')}` : s;
    return h.toUpperCase();
  }
  if (NAMED[s]) return NAMED[s];
  const fn = /^(rgba?|hsla?|oklch)\(\s*([^)]+)\)$/.exec(s);
  if (!fn) return undefined;
  const parts = fn[2].replace(/\s*\/\s*/, ' / ').split(/[\s,]+/).filter(Boolean);
  const slash = parts.indexOf('/');
  const nums = (slash >= 0 ? parts.slice(0, slash) : parts.slice(0, 3));
  const alphaRaw = slash >= 0 ? parts[slash + 1] : parts[3];
  const alpha = alphaRaw === undefined ? 1 : alphaRaw.endsWith('%') ? parseFloat(alphaRaw) / 100 : parseFloat(alphaRaw);
  const pct = (x: string, scale: number) => (x.endsWith('%') ? (parseFloat(x) / 100) * scale : parseFloat(x));
  let rgb: number[];
  if (fn[1].startsWith('rgb')) rgb = nums.map((x) => pct(x, 255) / 255);
  else if (fn[1].startsWith('hsl')) rgb = hsl(parseFloat(nums[0]), pct(nums[1], 1) * (nums[1].endsWith('%') ? 1 : 0.01), pct(nums[2], 1) * (nums[2].endsWith('%') ? 1 : 0.01));
  else rgb = oklch(pct(nums[0], 1), parseFloat(nums[1]), parseFloat(nums[2] ?? '0'));
  if (rgb.some((x) => Number.isNaN(x))) return undefined;
  const hex = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${rgb.map(hex).join('')}${alpha < 1 ? hex(alpha) : ''}`;
}

function hsl(h: number, s: number, l: number): number[] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))));
}

function oklch(L: number, C: number, hDeg: number): number[] {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin.map((x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
}
