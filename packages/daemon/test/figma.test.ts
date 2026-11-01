import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { expandTree, PenDoc } from '@nib/core';
import { parsePen, validateNode, type Node } from '@nib/format';
import { figToPen, importFigma, readFig } from '../src/figma/index.ts';
import { decodeMessage, decodeSchema } from '../src/figma/kiwi.ts';
import { encodeMessage, encodeSchema, figFile, message, type Def } from './figma-fixture.ts';

const find = (nodes: Node[], name: string): Record<string, any> | undefined => {
  for (const n of nodes) {
    if (n.name === name) return n as Record<string, any>;
    const deeper = find(((n as { children?: Node[] }).children ?? []), name);
    if (deeper) return deeper;
  }
  return undefined;
};

describe('figma import', () => {
  it('decodes kiwi values as they were encoded', () => {
    const defs: Def[] = [message('M', [['i', 'int'], ['u', 'uint'], ['f', 'float', true], ['s', 'string'], ['b', 'bool']])];
    const m = decodeMessage(decodeSchema(encodeSchema(defs)), encodeMessage(defs, 'M', { i: -123456, u: 300, f: [0, 1.5, -2.25, 1e-3], s: 'héllo 世界', b: true }), 'M');
    expect(m.i).toBe(-123456);
    expect(m.u).toBe(300);
    expect((m.f as number[]).map((v) => Math.round(v * 1e4) / 1e4)).toEqual([0, 1.5, -2.25, 0.001]);
    expect(m.s).toBe('héllo 世界');
    expect(m.b).toBe(true);
  });

  it('turns a Figma file into a .pen document', () => {
    const r = figToPen(readFig(figFile()));
    const tops = r.doc.children;
    expect(tops.flatMap((n) => validateNode(n)).filter((i) => i.level === 'error')).toEqual([]);
    // Variables with modes become a theme axis with themed values.
    expect(r.doc.themes).toEqual({ Theme: ['Light', 'Dark'] });
    expect(r.doc.variables?.['color/bg']).toEqual({ type: 'color', value: [{ value: '#ffffff', theme: { Theme: 'Light' } }, { value: '#000000', theme: { Theme: 'Dark' } }] });
    const card = find(tops, 'Card')!;
    expect(card).toMatchObject({ type: 'frame', x: 100, y: 50, width: 200, height: 'fit_content(120)', layout: 'vertical', gap: 8, padding: 16, fill: '$color/bg', cornerRadius: 12, clip: true, theme: { Theme: 'Dark' } });
    expect(card.effect).toEqual({ type: 'shadow', offset: { x: 0, y: 4 }, blur: 12, color: '#00000040' });
    const title = find(tops, 'Title')!;
    expect(title).toMatchObject({ type: 'text', content: 'Hello', fontFamily: 'Inter', fontWeight: '700', fontSize: 20, textGrowth: 'auto', fill: '#1a1a1a' });
    expect(title.x).toBeUndefined(); // placed by its auto layout
    const check = find(tops, 'Check')!;
    expect(check).toMatchObject({ type: 'path', width: 'fill_container(20)', height: 20, viewBox: [0, 0, 20, 20], geometry: 'M10 0 L20 20 L0 20 Z', fill: '#008000' });
    // Components: the symbol is reusable, the instance a ref with its text override.
    const button = find(tops, 'Button')!;
    expect(button).toMatchObject({ type: 'frame', reusable: true, layout: 'none' });
    expect(button.clip).toBeUndefined();
    const instance = tops.find((n) => n.type === 'ref')! as Record<string, any>;
    expect(instance).toMatchObject({ ref: button.id, x: 400, y: 120 });
    const label = find(tops, 'Label')!;
    expect(instance.descendants).toEqual({ [label.id]: { content: 'Buy' } });
    const expanded = expandTree(new PenDoc(r.doc), instance as unknown as Node) as unknown as Record<string, any>;
    expect(expanded.children[0].content).toBe('Buy');
    // Rotation (counter-clockwise in both), and a picture from the file.
    expect(find(tops, 'Tilted')).toMatchObject({ rotation: 30, fill: { type: 'image', url: 'images/figma-0102030405060708.png', mode: 'contain' } });
    expect([...r.images.keys()]).toEqual(['images/figma-0102030405060708.png']);
    // The second page comes below the first, and pages are named in each top-level layer's context.
    const second = find(tops, 'Second page')!;
    expect(second.y).toBeGreaterThan(170);
    expect(second.context).toBe('Figma page "Page 2"');
    expect(r.notes).toEqual([]);
  });

  it('writes the document and its pictures beside each other, never over another file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nib-figma-'));
    const a = await importFigma(figFile(), dir, 'Design');
    const b = await importFigma(figFile(), dir, 'Design');
    expect(a.path).toBe(join(dir, 'Design.pen'));
    expect(b.path).toBe(join(dir, 'Design 2.pen'));
    expect(a.layers).toBeGreaterThan(5);
    expect(await readdir(join(dir, 'images'))).toEqual(['figma-0102030405060708.png']);
    expect(find(parsePen(await readFile(a.path, 'utf8')).children, 'Card')).toBeDefined();
    await expect(importFigma(new Uint8Array([1, 2, 3]), dir, 'Bad')).rejects.toThrow(/not a Figma file/);
  });
});
