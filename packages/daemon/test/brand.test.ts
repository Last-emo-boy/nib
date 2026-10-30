import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePen, type PenDocument } from '@nib/format';
import { brandedLibrary, brandFromPage, contrast, lchOf, paletteFromPixels, paletteFromSvg, type PageSample } from '../src/brand.ts';
import { LIBRARY_DIR, libraries } from '../src/libraries.ts';

const library = async (id: string) => {
  const lib = (await libraries()).find((l) => l.id === id)!;
  return { recipe: lib.brand!, doc: parsePen(await readFile(join(LIBRARY_DIR, `${id}.lib.pen`), 'utf8')) };
};
const value = (doc: PenDocument, name: string, mode?: string) => {
  const v = doc.variables![name].value as unknown;
  return Array.isArray(v) ? (v as { value: unknown; theme?: { Mode: string } }[]).find((e) => !mode || e.theme?.Mode === mode)!.value : v;
};

describe('brand', () => {
  it('reads the brand color, radius and swatches off a page sample', () => {
    const sample: PageSample = {
      title: 'Acme', vars: {}, themeColor: undefined,
      buttons: [
        { bg: '#e8590cff', color: '#ffffffff', radius: 6, width: 120, height: 40, top: 300 },
        { bg: '#e8590cff', color: '#ffffffff', radius: 6, width: 90, height: 36, top: 2400 },
        { bg: '#f1f3f5ff', color: '#212529ff', radius: 6, width: 90, height: 36, top: 500 },
        { border: '#1971c2ff', color: '#1971c2ff', radius: 6, width: 90, height: 36, top: 600 },
      ],
      links: ['#1971c2ff', '#1971c2ff', '#212529ff'], headings: ['#212529ff'], logo: [],
      body: { bg: '#ffffffff', color: '#212529ff', font: 'Inter, sans-serif' },
    };
    const b = brandFromPage(sample);
    expect(b.primary).toBe('#E8590C');
    expect(b.radius).toBe(6);
    expect(b.swatches).toContain('#1971C2');
    expect(b.swatches).not.toContain('#FFFFFF');
    // A declared brand variable wins over button colors; pill buttons leave the radius alone.
    const declared = brandFromPage({ ...sample, vars: { '--brand': '#7048e8ff' }, buttons: sample.buttons.map((x) => ({ ...x, radius: 99 })) });
    expect(declared.primary).toBe('#7048E8');
    expect(declared.radius).toBeUndefined();
    // On a dark site with white buttons, the logo's color is the brand.
    const dark = brandFromPage({ ...sample, body: { ...sample.body, bg: '#030712ff' }, buttons: [{ bg: '#ffffffff', color: '#030712ff', radius: 8, width: 120, height: 40, top: 300 }], links: [], logo: ['#38bdf8ff', '#38bdf8ff', '#ffffffff'] });
    expect(dark.primary).toBe('#38BDF8');
  });

  it('finds a logo\'s colors in its pixels and in its SVG', () => {
    const w = 10, h = 10, rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const [r, g, b, a] = i < 60 ? [0, 0, 0, 0] : i < 90 ? [16, 122, 87, 255] : [250, 176, 5, 255];
      rgba.set([r, g, b, a], i * 4);
    }
    expect(paletteFromPixels(rgba, w, h)).toEqual(['#107A57', '#FAB005']);
    expect(paletteFromSvg('<svg><path fill="#FFF"/><path fill="#0B7285"/><circle style="fill:#0b7285"/><path stroke="rgb(240, 62, 62)"/></svg>')).toEqual(['#0B7285', '#F03E3E']);
  });

  it('themes a neutral library: the brand in both modes, readable text, scaled radii, the brand font', async () => {
    const { recipe, doc } = await library('shadcn');
    const out = brandedLibrary(doc, recipe, { primary: '#E8590C', radius: 4, font: 'Manrope' });
    expect(value(out, 'primary', 'Light')).toBe('#E8590C');
    expect(lchOf(String(value(out, 'primary', 'Dark'))).L).toBeGreaterThanOrEqual(0.61);
    expect(value(out, 'primary-foreground', 'Light')).toBe('#FFFFFF');
    expect(value(out, 'primary-soft', 'Light')).toBe('#E8590C33');
    expect(value(out, 'radius')).toBe(4);
    expect(value(out, 'radius-sm')).toBe(Math.round((6 * 4) / 10));
    expect(value(out, 'font-sans')).toBe('Manrope');
    // Everything else is the library's own.
    expect(value(out, 'background', 'Light')).toBe(value(doc, 'background', 'Light'));
    expect(out.children).toEqual(doc.children);
    // A light brand gets dark text.
    expect(value(brandedLibrary(doc, recipe, { primary: '#FAB005' }), 'primary-foreground', 'Light')).toBe('#0A0A0A');
  });

  it('turns a colored library\'s scale to the brand\'s hue', async () => {
    const { recipe, doc } = await library('radix');
    const out = brandedLibrary(doc, recipe, { primary: '#0CA678' });
    expect(value(out, 'accent-9', 'Light')).toBe('#0CA678');
    const hue = lchOf('#0CA678').h;
    for (const step of [3, 6, 11]) {
      const c = lchOf(String(value(out, `accent-${step}`, 'Light')));
      const before = lchOf(String(value(doc, `accent-${step}`, 'Light')));
      expect(Math.abs(c.h - (hue + before.h - lchOf(String(value(doc, 'accent-9', 'Light'))).h))).toBeLessThan(6);
    }
    // Text on the scale's solid step stays readable.
    expect(contrast(String(value(out, 'accent-9', 'Light')), String(value(out, 'accent-contrast', 'Light')))).toBeGreaterThanOrEqual(3);
    // Grays are left alone.
    expect(value(out, 'gray-9', 'Light')).toBe(value(doc, 'gray-9', 'Light'));
  });

  it('gives every bundled library a recipe that applies cleanly', async () => {
    for (const lib of await libraries()) {
      const { recipe, doc } = await library(lib.id);
      const out = brandedLibrary(doc, recipe, { primary: '#7048E8', radius: 8, font: 'Manrope' });
      expect(value(out, recipe.anchor, 'Light')).toBe('#7048E8');
      for (const name of Object.keys(recipe.vars)) expect(doc.variables![name], `${lib.id} ${name}`).toBeDefined();
    }
  });
});

describe('component states', () => {
  it('makes each state an instance of its base, written in code like the base', async () => {
    for (const lib of await libraries()) {
      const doc = parsePen(await readFile(join(LIBRARY_DIR, `${lib.id}.lib.pen`), 'utf8'));
      const code = JSON.parse(await readFile(join(LIBRARY_DIR, `${lib.id}.code.json`), 'utf8')).components as Record<string, { template: string }>;
      const all = new Map<string, Record<string, unknown>>();
      const visit = (n: Record<string, unknown>) => { if (n.reusable) all.set(n.id as string, n); for (const c of (n.children as Record<string, unknown>[] | undefined) ?? []) visit(c); };
      doc.children.forEach((n) => visit(n as unknown as Record<string, unknown>));
      const states = [...all.values()].filter((n) => / \/ (Hover|Pressed|Focus|Disabled|Invalid)$/.test(n.name as string));
      expect(states.length, lib.id).toBeGreaterThan(20);
      for (const s of states) {
        expect(s.type, `${lib.id} ${s.id}`).toBe('ref');
        expect(all.has(s.ref as string), `${lib.id} ${s.id}`).toBe(true);
        const base = code[s.ref as string];
        if (base && String(s.id).endsWith('-hover')) expect(code[s.id as string]).toEqual(base);
      }
    }
  });
});
