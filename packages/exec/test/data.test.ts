import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PenDoc } from '@nib/core';
import type { PenDocument } from '@nib/format';
import { createNodeRenderer } from '@nib/render/node';
import type { Renderer } from '@nib/render';
import { ExecSession, fakeRows, fieldKind, fill, parseCsv, parseRows, placeholders } from '../src/index.ts';

let renderer: Renderer;
beforeAll(async () => { renderer = await createNodeRenderer(); });

describe('data', () => {
  it('reads CSV with quotes, and JSON lists', () => {
    expect(parseCsv('name,quote\n"Chen, Ava","She said ""hi"""\r\nKim,ok\n\n')).toEqual([{ name: 'Chen, Ava', quote: 'She said "hi"' }, { name: 'Kim', quote: 'ok' }]);
    expect(parseCsv('a;b\n1;2')).toEqual([{ a: '1', b: '2' }]);
    expect(parseRows('{"items": [{"x": 1}, 2]}', 'd.json')).toEqual([{ x: 1 }, { value: 2 }]);
    expect(() => parseRows('{"x": 1}', 'd.json')).toThrow('no list of rows');
  });

  it('finds placeholders and fills them, nested fields too', () => {
    const node = { type: 'frame', id: 'row', name: '{{name}} row', children: [
      { type: 'text', id: 't', content: 'Hi {{ name }}, from {{address.city}}' },
      { type: 'rectangle', id: 'r', fill: { type: 'image', url: '{{photo}}' } },
    ] };
    expect(placeholders(node)).toEqual(['name', 'address.city', 'photo']);
    const out = fill(node as never, { name: 'Ava', address: { city: 'Lisbon' } }) as unknown as { name: string; children: { id: string; content?: string; fill?: { url: string } }[] };
    expect(out.name).toBe('Ava row');
    expect(out.children[0]).toMatchObject({ id: 't', content: 'Hi Ava, from Lisbon' });
    expect(out.children[1].fill!.url).toBe('');
  });

  it('makes up believable values by field name, the same every time', () => {
    expect(['email', 'fullName', 'price', 'createdAt', 'status', 'avatarColor', 'bio', 'title'].map(fieldKind)).toEqual(['email', 'name', 'price', 'date', 'status', 'color', 'sentence', 'job']);
    const a = fakeRows(['name', 'email', 'price'], 3), b = fakeRows(['name', 'email', 'price'], 3);
    expect(a).toEqual(b);
    expect(a[0].email).toMatch(/^[a-z.]+@[a-z.]+$/);
    expect(String(a[0].email).split('@')[0]).toBe(String(a[0].name).toLowerCase().replace(' ', '.'));
    expect(a[0].price).toMatch(/^\$\d+\.\d\d$/);
    expect(fakeRows(['name'], 1, { seed: 2 })).not.toEqual(fakeRows(['name'], 1));
    const zh = fakeRows(['name', 'city', 'date'], 2, { locale: 'zh' });
    expect(zh[0].name).toMatch(/^[一-鿿]{2,3}$/);
    expect(zh[0].date).toMatch(/^2026年\d+月\d+日$/);
  });

  it('repeats a template once per row, hides it, and replaces its rows when repeated again', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nib-data-'));
    await writeFile(join(dir, 'people.csv'), 'name,role\nAva Chen,Designer\nLiam Kim,Engineer\n');
    const doc = new PenDoc({ version: '2.20', children: [
      { type: 'frame', id: 'list', x: 0, y: 0, width: 300, layout: 'vertical', gap: 8, children: [
        { type: 'frame', id: 'row', name: 'Person', width: 'fill_container', layout: 'horizontal', children: [{ type: 'text', id: 'n', content: '{{name}} · {{role}} · {{team}}' }] },
      ] },
      { type: 'frame', id: 'board', x: 400, y: 0, width: 300, height: 300, layout: 'none', children: [{ type: 'rectangle', id: 'card', x: 10, y: 10, width: 100, height: 40, name: '{{status}}' }] },
    ] } as unknown as PenDocument);
    const s = await ExecSession.open(doc, { renderer, images: { load: async () => undefined }, baseDir: dir });
    const r = await s.execute({ input: 'ids = Repeat("row", ReadData("people.csv"))' });
    expect(r.ok, r.text).toBe(true);
    expect(r.text).toContain('no row has "team"');
    const list = () => (doc.get('list') as unknown as { children: { id: string; enabled?: boolean; metadata?: unknown; children: { content: string }[] }[] }).children;
    expect(list().map((c) => [c.enabled ?? true, c.children[0].content])).toEqual([[false, '{{name}} · {{role}} · {{team}}'], [true, 'Ava Chen · Designer · '], [true, 'Liam Kim · Engineer · ']]);
    expect(list()[1].metadata).toEqual({ type: 'nib-row', template: 'row', index: 0 });
    // Again, with other rows: the old copies go.
    expect((await s.execute({ input: 'Repeat("row", FakeData(["name", "role", "team"], 4))' })).ok).toBe(true);
    expect(list()).toHaveLength(5);
    expect(list()[1].children[0].content).not.toContain('{{');
    // In a frame without a layout, rows go down from the template.
    expect((await s.execute({ input: 'Repeat("card", FakeData(["status"], 3), {gap: 10})' })).ok).toBe(true);
    const board = (doc.get('board') as unknown as { children: { y: number; name: string }[] }).children;
    expect(board.map((c) => c.y)).toEqual([10, 10, 60, 110]);
    // Repeated again, the hidden template still spaces the rows by its height.
    expect((await s.execute({ input: 'Repeat("card", FakeData(["status"], 2), {gap: 10})' })).ok).toBe(true);
    expect((doc.get('board') as unknown as { children: { y: number }[] }).children.map((c) => c.y)).toEqual([10, 10, 60]);
    // Colors (which placeholders cannot hold) come through bind, by layer name.
    expect((await s.execute({ input: 'Repeat("card", [{status: "A", tone: "#FF0000"}], {bind: {"{{status}}": {fill: "tone"}}})' })).ok).toBe(true);
    expect((doc.get('board') as unknown as { children: { name: string; fill?: string }[] }).children[1]).toMatchObject({ name: 'A', fill: '#FF0000' });
    expect((await s.execute({ input: 'Repeat("card", [{}], {bind: {"x": {fill: 3}}})' })).text).toContain('bind maps layer names');
    expect((await s.execute({ input: 'Repeat("list", [{a: 1}])' })).text).toContain('put the template inside a frame');
    expect((await s.execute({ input: 'ReadData("nope.csv")' })).text).toContain('cannot read nope.csv');
  });
});
