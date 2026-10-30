import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildScene, PenDoc } from '@nib/core';
import type { PenDocument } from '@nib/format';
import type { Renderer } from '@nib/render';
import { createNodeRenderer } from '@nib/render/node';
import { exportHtml, exportReact, writePdf, type CodeMap } from '../src/index.ts';

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
});
