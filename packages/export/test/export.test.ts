import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildScene, PenDoc } from '@nib/core';
import type { PenDocument } from '@nib/format';
import type { Renderer } from '@nib/render';
import { createNodeRenderer } from '@nib/render/node';
import { EXPORTERS, pageColor, pageFiles, exportHtml, exportReact, tokensFromCss, tokensFromJson, tokensToCss, tokensToJson, tokensToTailwind, writePdf, type CodeMap } from '../src/index.ts';

let renderer: Renderer;
const images = { load: async () => undefined };
beforeAll(async () => { renderer = await createNodeRenderer(); });

async function html(children: unknown[], tailwind = false) {
  const doc = new PenDoc({ version: '2.20', children } as PenDocument);
  const root = buildScene(doc, doc.data.children[0])!;
  return exportHtml([{ id: root.id, root, target: root }], join(tmpdir(), 'out', 'page.html'), {}, { renderer, images, baseDir: tmpdir() }, tailwind);
}

describe('html export', () => {
  const page = [{ type: 'frame', id: 'page', name: 'Page', x: 0, y: 0, width: 400, layout: 'vertical', gap: 8, padding: [16, 24], fill: '#ffffff', children: [
    { type: 'text', id: 't', name: 'Title', content: 'Hi <there>', fontSize: 20, fontWeight: 'bold', fill: '#111111' },
    { type: 'frame', id: 'row', name: 'Row', width: 'fill_container', gap: 4, children: [
      { type: 'rectangle', id: 'a', name: 'A', width: 'fill_container', height: 10, fill: '#ff0000', cornerRadius: [4, 4, 0, 0] },
      { type: 'rectangle', id: 'b', name: 'B', width: 30, height: 10, fill: '#0000ff', stroke: '#000000', strokeWidth: { bottom: 2 } },
    ] },
    { type: 'rectangle', id: 'abs', name: 'Badge', layoutPosition: 'absolute', x: 300, y: 4, width: 8, height: 8, fill: '#00ff00' },
  ] }];

  it('maps frames to flexbox with the canvas sizing rules', async () => {
    const out = await html(page);
    expect(out).toContain('.page { position: relative; width: 400px; background-color: #ffffff; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; padding: 16px 24px; }');
    expect(out).toMatch(/\.row \{[^}]*align-self: stretch;[^}]*flex-direction: row; gap: 4px;/);
    expect(out).toMatch(/\.a \{[^}]*flex: 1 1 0; min-width: 0;[^}]*border-radius: 4px 4px 0px 0px;/);
    expect(out).toMatch(/\.b \{[^}]*box-shadow: inset 0px -2px 0 0 #000000;/);
    expect(out).toMatch(/\.badge \{ position: absolute; left: 300px; top: 4px; width: 8px; height: 8px;/);
    expect(out).toMatch(/\.title \{[^}]*font-weight: 700;[^}]*white-space: pre; color: #111111;/);
    expect(out).toContain('>Hi &lt;there&gt;</div>');
    expect(out).toContain('family=Inter:wght@700');
  });

  it('writes the same styles as Tailwind classes', async () => {
    const out = await html(page, true);
    expect(out).toContain('cdn.jsdelivr.net/npm/@tailwindcss/browser@4');
    expect(out).toContain('class="relative w-[400px] bg-[#ffffff] flex flex-col gap-[8px] items-start p-[16px_24px]"');
    expect(out).toContain('flex-1 min-w-0');
  });

  it('takes a design\'s own fonts from its fonts/ folder, others from Google Fonts', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nib-fonts-'));
    await mkdir(join(base, 'fonts'));
    await copyFile(join(import.meta.dirname, '..', '..', '..', 'apps', 'editor', 'node_modules', 'lucide-static', 'font', 'lucide.ttf'), join(base, 'fonts', 'lucide.ttf'));
    const doc = new PenDoc({ version: '2.20', children: [{ type: 'frame', id: 'f', x: 0, y: 0, width: 100, layout: 'vertical', children: [
      { type: 'text', id: 'a', content: 'a', fontFamily: 'lucide' }, { type: 'text', id: 'b', content: 'b', fontFamily: 'Inter' },
    ] }] } as PenDocument);
    const root = buildScene(doc, doc.data.children[0])!;
    const out = await exportHtml([{ id: root.id, root, target: root }], join(base, 'out', 'page.html'), {}, { renderer, images, baseDir: base }, false);
    expect(out).toContain('@font-face { font-family: "lucide"; src: url("../fonts/lucide.ttf"); font-weight: 400; font-style: normal; }');
    expect(out).toContain('family=Inter:wght@400');
    expect(out).not.toContain('family=lucide');
  });

  it('writes a site: a page per frame, prototype links as links, local images copied in', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nib-site-'));
    await mkdir(join(base, 'images'));
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    await writeFile(join(base, 'images', 'hero.png'), png);
    const doc = new PenDoc({ version: '2.20', children: [
      { type: 'frame', id: 'home', name: 'Home', x: 0, y: 0, width: 400, layout: 'vertical', fill: '#0F172A', children: [
        { type: 'rectangle', id: 'hero', width: 400, height: 200, fill: { type: 'image', url: 'images/hero.png' } },
        { type: 'frame', id: 'cta', name: 'See pricing', padding: 12, fill: '#000000', metadata: { type: 'nib-link', to: 'pricing' }, children: [{ type: 'text', id: 'cta-t', content: 'Pricing', fill: '#ffffff' }] },
      ] },
      { type: 'frame', id: 'pricing', name: 'Pricing', x: 500, y: 0, width: 400, height: 300, children: [
        { type: 'text', id: 'back', content: 'Back', metadata: { type: 'nib-link', to: 'previous' } },
      ] },
    ] } as PenDocument);
    const scenes = ['home', 'pricing'].map((id) => { const root = buildScene(doc, doc.get(id)!)!; return { id, root, target: root }; });
    const out = join(base, 'site');
    await EXPORTERS.site!(scenes, out, {}, { doc, renderer, images, baseDir: base });
    expect((await readdir(out)).sort()).toEqual(['assets', 'index.html', 'pricing.html']);
    const home = await readFile(join(out, 'index.html'), 'utf8');
    expect(home).toMatch(/<a class="[^"]*see-pricing[^"]*" data-name="See pricing" href="pricing.html">|<a [^>]*href="pricing.html"/);
    expect(home).toContain('url("assets/hero.png")');
    // The page fills the window: zoomed to its width, the rest in its own color.
    expect(home).toContain('html { background: #0F172A;');
    expect(home).toContain('clientWidth / 400');
    expect(await readFile(join(out, 'pricing.html'), 'utf8')).toContain('html { background: #FFFFFF;');
    expect(pageColor([{ type: 'gradient', colors: [{ color: '#000000', position: 1 }, { color: '#FF0000', position: 0 }] }])).toBe('#000000');
    expect(pageColor(['#111111', { type: 'color', color: 'red;} body{' }])).toBe('#111111');
    expect(await readFile(join(out, 'assets', 'hero.png'))).toEqual(png);
    expect(await readFile(join(out, 'pricing.html'), 'utf8')).toMatch(/<a [^>]*href="index.html"[^>]*>Back<\/a>/);
    expect(pageFiles(['Home', 'Über uns', 'Über uns', '价格'])).toEqual(['index.html', 'uber-uns.html', 'uber-uns-2.html', '价格.html']);
  });

  it('turns gradients, icons and shapes into CSS and SVG', async () => {
    const out = await html([{ type: 'frame', id: 'f', x: 0, y: 0, width: 100, height: 100, fill: { type: 'gradient', gradientType: 'linear', rotation: 90, colors: [{ color: '#000000', position: 0 }, { color: '#ffffff', position: 1 }] }, children: [
      { type: 'icon', id: 'i', icon: 'check', width: 20, height: 20, fill: '#00aa00' },
      { type: 'polygon', id: 'p', polygonCount: 3, width: 20, height: 20, fill: '#ff0000' },
    ] }]);
    expect(out).toContain('linear-gradient(270deg, #000000 0%, #ffffff 100%)');
    expect(out).toMatch(/<svg class="icon"[^>]*viewBox="0 0 24 24"[^>]*><path d="M20 6 9 17l-5-5"/);
    expect(out).toMatch(/<svg class="polygon"[^>]*><path d="M10 0L/);
  });
});

describe('pdf', () => {
  it('writes pages with a valid cross-reference table', () => {
    const rgba = new Uint8Array(4 * 4 * 4).fill(255);
    const bytes = Buffer.from(writePdf([{ width: 4, height: 4, image: { width: 4, height: 4, rgba } }, { width: 2, height: 2, image: { width: 4, height: 4, rgba } }], 'Tést'));
    const text = bytes.toString('latin1');
    expect(text.startsWith('%PDF-1.7')).toBe(true);
    expect(text).toContain('/Count 2');
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe('xref');
    const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(11);
    offsets.forEach((o, i) => expect(text.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });
});

describe('react export', () => {
  it('writes library instances as their components, library colors as tokens, and lucide icons as components', async () => {
    const lib = new PenDoc({ version: '2.20', variables: { primary: { type: 'color', value: '#111111' }, 'primary-foreground': { type: 'color', value: '#ffffff' }, font: { type: 'string', value: 'Geist' } }, children: [
      { type: 'frame', id: 'button', reusable: true, x: 0, y: 0, padding: [8, 16], fill: '$primary', children: [{ type: 'text', id: 'button-label', content: 'Button', fill: '$primary-foreground', fontFamily: '$font' }] },
    ] } as unknown as PenDocument);
    const doc = new PenDoc({ version: '2.20', imports: { ui: './ui.lib.pen' }, children: [
      { type: 'frame', id: 'page', name: 'Sign in page', x: 0, y: 0, width: 400, layout: 'vertical', gap: 8, fill: '$ui:primary', children: [
        { type: 'text', id: 't', content: 'Hello {name}', fill: '$ui:primary-foreground', fontFamily: '$ui:font' },
        { type: 'icon', id: 'i', library: 'lucide', icon: 'arrow-right', width: 16, height: 16, fill: '#ff0000' },
        { type: 'ref', id: 'go', ref: 'ui:button', width: 'fill_container', descendants: { 'button-label': { content: 'Go' } } },
      ] },
    ] } as unknown as PenDocument);
    doc.imports.set('ui', lib);
    const map: CodeMap = { library: 'ui', setup: 'add the ui kit', tokens: ['primary', 'primary-foreground'], inherited: ['font'], components: {
      button: { template: '<Button{class}>{text:button-label}</Button>', imports: { Button: '@/components/ui/button' } },
    } };
    const root = buildScene(doc, doc.data.children[0])!;
    const out = await exportReact([{ id: root.id, root, target: root }], join(tmpdir(), 'out', 'page.tsx'), {}, { renderer, images, baseDir: tmpdir() }, new Map([['ui', map]]));
    expect(out).toContain('// ui: add the ui kit.');
    expect(out).toContain('import { ArrowRight } from "lucide-react";');
    expect(out).toContain('import { Button } from "@/components/ui/button";');
    expect(out).toContain('export function SignInPage() {');
    expect(out).toContain('<div className="w-[400px] bg-primary flex flex-col gap-[8px] items-start">');
    expect(out).toContain('{"Hello {name}"}');
    expect(out).toContain('text-primary-foreground');
    expect(out).not.toContain('Geist');
    expect(out).toContain('<ArrowRight className="flex-none h-[16px] w-[16px] text-[color:#ff0000]" />');
    expect(out).toContain('<Button className="w-full">Go</Button>');
  });

  it('imports a module that registers custom elements for its side effect', async () => {
    const lib = new PenDoc({ version: '2.20', children: [
      { type: 'frame', id: 'button', reusable: true, x: 0, y: 0, padding: [8, 16], children: [{ type: 'text', id: 'button-label', content: 'Button' }] },
    ] } as unknown as PenDocument);
    const doc = new PenDoc({ version: '2.20', imports: { md: './md.lib.pen' }, children: [
      { type: 'frame', id: 'page', name: 'Page', x: 0, y: 0, width: 200, layout: 'vertical', children: [{ type: 'ref', id: 'go', ref: 'md:button', descendants: { 'button-label': { content: 'Go' } } }] },
    ] } as unknown as PenDocument);
    doc.imports.set('md', lib);
    const map: CodeMap = { library: 'Material Web', tokens: [], components: {
      button: { template: '<md-filled-button{class}>{text:button-label}</md-filled-button>', imports: { '@material/web/button/filled-button.js': 'side-effect' } },
    } };
    const root = buildScene(doc, doc.data.children[0])!;
    const out = await exportReact([{ id: root.id, root, target: root }], join(tmpdir(), 'out', 'page.tsx'), {}, { renderer, images, baseDir: tmpdir() }, new Map([['md', map]]));
    expect(out).toContain('import "@material/web/button/filled-button.js";');
    expect(out).toContain('// Material Web');
    expect(out).toContain('>Go</md-filled-button>');
  });
});

describe('design tokens', () => {
  const doc = { version: '2.20', themes: { Mode: ['Light', 'Dark'] }, children: [], variables: {
    primary: { type: 'color', value: [{ value: '#111111', theme: { Mode: 'Light' } }, { value: '#EEEEEE', theme: { Mode: 'Dark' } }] },
    'radius-card': { type: 'number', value: 12 },
    'font-sans': { type: 'string', value: 'Inter' },
  } } as unknown as PenDocument;

  it('writes CSS variables per theme, a Tailwind theme and DTCG JSON', () => {
    expect(tokensToCss(doc)).toBe(':root {\n  --primary: #111111;\n  --radius-card: 12px;\n  --font-sans: Inter;\n}\n\n.dark, [data-mode="dark"] {\n  --primary: #EEEEEE;\n}\n');
    expect(tokensToTailwind(doc)).toContain('--color-primary: var(--primary);');
    expect(tokensToTailwind(doc)).toContain('--radius-card: var(--radius-card);');
    expect(JSON.parse(tokensToJson(doc)).primary).toEqual({ $type: 'color', $value: '#111111', $extensions: { nib: { themes: { 'Mode=Dark': '#EEEEEE' } } } });
  });

  it('reads them back, and reads a project\'s CSS variables in oklch, hsl and rem', () => {
    expect(tokensFromCss(tokensToCss(doc)).variables).toEqual(doc.variables);
    expect(tokensFromJson(tokensToJson(doc)).variables).toEqual(doc.variables);
    const r = tokensFromCss(':root { --background: oklch(1 0 0); --ring: hsl(0 0% 50%); --radius: 0.625rem; --chart: var(--x); }\n.dark { --background: oklch(0.145 0 0); }');
    expect(r.themes).toEqual({ Mode: ['Light', 'Dark'] });
    expect(r.variables.background).toEqual({ type: 'color', value: [{ value: '#FFFFFF', theme: { Mode: 'Light' } }, { value: '#0A0A0A', theme: { Mode: 'Dark' } }] });
    expect(r.variables.ring).toEqual({ type: 'color', value: '#808080' });
    expect(r.variables.radius).toEqual({ type: 'number', value: 10 });
    expect(r.skipped).toEqual(['chart']);
  });
});
