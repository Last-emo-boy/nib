import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PenDoc } from '@nib/core';
import { serializePen, type PenDocument } from '@nib/format';
import type { Renderer } from '@nib/render';
import { createNodeRenderer } from '@nib/render/node';
import { applyEdits, ExecSession } from '../src/index.ts';

let renderer: Renderer;
const noImages = { load: async () => undefined };

beforeAll(async () => {
  renderer = await createNodeRenderer();
});

async function session(children: unknown[] = [], extra: Partial<PenDocument> = {}) {
  const doc = new PenDoc({ version: '2.20', ...extra, children } as PenDocument);
  const s = await ExecSession.open(doc, { renderer, images: noImages, baseDir: tmpdir() });
  const run = async (input: string) => s.execute({ input });
  return { doc, s, run };
}

/** The id the report lists for a created node name. */
const createdId = (text: string, name: string) => new RegExp(`"${name}": "([^"]+)"`).exec(text)?.[1];

describe('execute', () => {
  it('inserts nodes and names the globals that hold their ids', async () => {
    const { doc, run } = await session();
    const r = await run(`card = Insert(document, {type: "frame", name: "Card", layout: "vertical", gap: 8, padding: 16, fill: "#ffffff", width: 300})
const title = Insert(card, {type: "text", name: "Title", content: "Hello", fontSize: 20, fill: "#111111"})
Print("title is", title, {n: 1})`);
    expect(r.ok).toBe(true);
    const id = createdId(r.text, 'Card')!;
    expect(r.text).toContain(`"Card": "${id}" (= card)`);
    expect(r.text).toMatch(/## Print output\ntitle is \w+ \{"n":1\}/);
    expect(doc.data.children).toHaveLength(1);
    expect(doc.get(id)?.type).toBe('frame');
    expect(r.ops.length).toBe(2);
    const again = await run('Print(card, typeof title)');
    expect(again.text).toContain(`${id} undefined`);
  });

  it('rolls back a failed snippet and its globals, then runs it patched by editId', async () => {
    const { doc, run, s } = await session([{ type: 'frame', id: 'root', x: 0, y: 0, width: 100, height: 100 }]);
    const before = serializePen(doc.data);
    const r = await run(`a = Insert("root", {type: "rectangle", width: 10, height: 10, fill: "#ff0000"})
b = Insert(missing, {type: "rectangle", width: 10, height: 10})`);
    expect(r.ok).toBe(false);
    expect(r.text).toContain("ReferenceError: 'missing' is not defined");
    expect(r.text).toContain('at line 2: `b = Insert(missing');
    expect(serializePen(doc.data)).toBe(before);
    const editId = /`editId`: "(\w+)"/.exec(r.text)![1];
    expect((await run('Print(typeof a)')).text).toContain('undefined');
    const fixed = await s.execute({ editId, edits: [{ find: 'Insert(missing', replace: 'Insert("root"' }] });
    expect(fixed.ok).toBe(true);
    expect((doc.get('root') as { children: unknown[] }).children).toHaveLength(2);
    expect((await s.execute({ editId, edits: [{ find: 'x', replace: 'y' }] })).text).toContain('Unknown editId');
  });

  it('rejects invalid properties with the schema message', async () => {
    const { run } = await session();
    const r = await run('Insert(document, {type: "frame", margin: 10, fill: null})');
    expect(r.ok).toBe(false);
    expect(r.text).toContain('margin is not supported');
    expect(r.text).toContain('fill: expected a color');
  });

  it('keeps nothing of a failed call that the snippet caught', async () => {
    const { doc, run } = await session();
    const r = await run(`try { Insert(document, {type: "frame", children: [{type: "text", content: "x", fill: "#000000"}, {type: "blob"}]}) } catch (e) { Print("caught") }
Insert(document, {type: "rectangle", width: 5, height: 5, fill: "#000000"})`);
    expect(r.ok).toBe(true);
    expect(r.text).toContain('caught');
    expect(doc.data.children.map((n) => n.type)).toEqual(['rectangle']);
  });

  it('builds a component, instances with overrides, and reads them expanded', async () => {
    const { doc, run } = await session();
    const r = await run(`metric = Insert(document, {type: "frame", name: "Metric", reusable: true, layout: "vertical", gap: 4, padding: 12, fill: "#ffffff"})
label = Insert(metric, {type: "text", name: "Label", content: "Label", fontSize: 12, fill: "#666666"})
value = Insert(metric, {type: "text", name: "Value", content: "0", fontSize: 28, fill: "#111111"})
row = Insert(document, {type: "frame", name: "Row", gap: 16, x: 0, y: 200})
m1 = Insert(row, {type: "ref", ref: metric, descendants: {Label: {content: "Revenue"}, [value]: {content: "$48.2K"}}})
m2 = Insert(row, {type: "ref", ref: metric})
Update(m2 + "/" + label, {content: "Users"})
Update(m2 + "/" + value, {content: "1,204", fill: "#0055ff"})`);
    expect(r.ok, r.text).toBe(true);
    const ids = Object.fromEntries(['metric', 'label', 'value', 'm1', 'm2'].map((k) => [k, new RegExp(`"(\\w+)" \\(= ${k}\\)`).exec(r.text)?.[1]]));
    const m1 = doc.get(ids.m1!) as { descendants: Record<string, unknown> };
    expect(m1.descendants).toEqual({ [ids.label!]: { content: 'Revenue' }, [ids.value!]: { content: '$48.2K' } });
    const m2 = doc.get(ids.m2!) as { descendants: Record<string, unknown> };
    expect(m2.descendants).toEqual({ [ids.label!]: { content: 'Users' }, [ids.value!]: { content: '1,204', fill: '#0055ff' } });
    const get = await run(`Print(JSON.stringify(Get(m2, {resolveInstances: true}).children.map(c => c.content)))`);
    expect(get.text).toContain('["Users","1,204"]');
    const notReusable = await run('Insert(document, {type: "ref", ref: row})');
    expect(notReusable.text).toContain('is not a component');
  });

  it('copies components as instances and plain nodes with fresh ids', async () => {
    const { doc, run } = await session([
      { type: 'frame', id: 'comp', name: 'Button', reusable: true, x: 0, y: 0, padding: 8, children: [{ type: 'text', id: 'lbl', name: 'Label', content: 'Go', fill: '#000000' }] },
      { type: 'frame', id: 'card', name: 'Card', x: 0, y: 100, children: [{ type: 'text', id: 'ttl', name: 'Title', content: 'Old', fill: '#000000' }] },
    ]);
    const r = await run(`inst = Copy("comp", document, {x: 300})
copy = Copy("card", document, {x: 300, y: 100, descendants: {Title: {content: "New"}}})`);
    expect(r.ok, r.text).toBe(true);
    const inst = doc.get(/"(\w+)" \(= inst\)/.exec(r.text)![1])!;
    expect(inst).toMatchObject({ type: 'ref', ref: 'comp', x: 300, y: 0 });
    const copy = doc.get(/"(\w+)" \(= copy\)/.exec(r.text)![1]) as { children: { id: string; content: string }[] };
    expect(copy.children[0].id).not.toBe('ttl');
    expect(copy.children[0].content).toBe('New');
    expect((doc.get('ttl') as { content: string }).content).toBe('Old');
  });

  it('replaces a node inside an instance and keeps editing the replacement', async () => {
    const { doc, run } = await session([
      { type: 'frame', id: 'comp', reusable: true, x: 0, y: 0, layout: 'vertical', children: [{ type: 'frame', id: 'slot', name: 'Content', width: 100, height: 40 }] },
      { type: 'ref', id: 'inst', ref: 'comp', x: 0, y: 100 },
    ]);
    const r = await run(`p = Replace("inst/slot", {type: "frame", name: "Content", layout: "vertical", padding: 4})
t = Insert(p, {type: "text", content: "inside", fill: "#000000"})
Update(p, {gap: 6})`);
    expect(r.ok, r.text).toBe(true);
    const p = /"(\S+)" \(= p\)/.exec(r.text)![1];
    expect(p.startsWith('inst/')).toBe(true);
    const entry = (doc.get("inst") as unknown as { descendants: Record<string, { type: string; gap: number; children: unknown[] }> }).descendants.slot;
    expect(entry).toMatchObject({ type: 'frame', gap: 6, padding: 4 });
    expect(entry.children).toHaveLength(1);
    const del = await run('Delete(p)');
    expect(del.text).toContain('enabled: false');
  });

  it('sets themed variables and registers their theme values', async () => {
    const { doc, run } = await session();
    const r = await run(`SetVariables({bg: {type: "color", value: [{value: "#ffffff", theme: {mode: "light"}}, {value: "#000000", theme: {mode: "dark"}}]}, gap: {type: "number", value: 12}})
Print(GetVariables())`);
    expect(r.ok, r.text).toBe(true);
    expect(doc.data.themes).toEqual({ mode: ['light', 'dark'] });
    expect(r.text).toContain('"gap":{"type":"number","value":12}');
    const bad = await run('SetVariables({c: {type: "color", value: "red"}})');
    expect(bad.text).toContain('expected a hex color');
  });

  it('visits subtrees with bounds, problems, depth and skipChildren', async () => {
    const { run } = await session([
      { type: 'frame', id: 'page', name: 'Page', x: 0, y: 0, width: 200, height: 100, layout: 'none', children: [
        { type: 'rectangle', id: 'in', name: 'In', x: 10, y: 10, width: 50, height: 50 },
        { type: 'rectangle', id: 'half', name: 'Half', x: 180, y: 10, width: 50, height: 50 },
        { type: 'rectangle', id: 'out', name: 'Out', x: 300, y: 10, width: 50, height: 50 },
        { type: 'frame', id: 'box', name: 'Box', x: 0, y: 70, width: 20, height: 20, children: [{ type: 'rectangle', id: 'deep', width: 5, height: 5 }] },
      ] },
    ]);
    const r = await run(`Get("page", (n, c) => { Print(c.depth, n.name, c.bounds.x, c.bounds.width, c.problems ?? "-"); if (n.name === "Box") c.skipChildren() })
Print(Get(n => n.type === "rectangle" ? n.id : undefined).join(","))
Print(Get("page", {depth: 0}).children)`);
    expect(r.ok, r.text).toBe(true);
    expect(r.text).toContain('0 Page 0 200 -');
    expect(r.text).toContain('1 In 10 50 -');
    expect(r.text).toContain('1 Half 180 50 partially clipped');
    expect(r.text).toContain('1 Out 300 50 fully clipped');
    expect(r.text).not.toContain('undefined deep');
    expect(r.text).toContain('in,half,out,deep');
    expect(r.text).toMatch(/\n\.\.\.$/);
  });

  it('finds empty space beside the canvas content and beside a node', async () => {
    const { run } = await session([
      { type: 'frame', id: 'a', x: 0, y: 0, width: 100, height: 100 },
      { type: 'frame', id: 'b', x: 200, y: 0, width: 100, height: 100 },
    ]);
    const r = await run(`Print(FindEmptySpace({width: 50, height: 50, padding: 20}))
Print(FindEmptySpace({width: 50, height: 50, padding: 20, nodeId: "a"}))
Print(FindEmptySpace({width: 50, height: 50, padding: 20, direction: "bottom"}))`);
    expect(r.text).toContain('{"x":320,"y":0}  \n{"x":120,"y":0}  \n{"x":0,"y":120}');
  });

  it('reports collapsed sizes and fill_container without a layout', async () => {
    const { run } = await session();
    const r = await run(`f = Insert(document, {type: "frame", name: "Empty", fill: "#eeeeee"})
Insert(document, {type: "frame", name: "Wide", width: "fill_container", height: 10})
g = Insert(document, {type: "frame", name: "Loop"})
Insert(g, {type: "rectangle", name: "Bar", width: "fill_container", height: 4, fill: "#000000"})`);
    expect(r.ok).toBe(true);
    expect(r.text).toContain('"Empty"');
    expect(r.text).toMatch(/"Empty" \(\w+\) is fit_content in width but has no children/);
    expect(r.text).toMatch(/"Wide" \(\w+\) has width fill_container, but it sits directly on the canvas/);
    expect(r.text).toMatch(/"Loop" \(\w+\) is fit_content in width while its children fill_container/);
  });

  it('moves and deletes, refusing cycles', async () => {
    const { doc, run } = await session([
      { type: 'frame', id: 'p', x: 0, y: 0, children: [{ type: 'frame', id: 'c', children: [{ type: 'rectangle', id: 'r', width: 4, height: 4 }] }] },
    ]);
    expect((await run('Move("p", "c")')).text).toContain('is inside');
    const r = await run('Move("r", "p", 0)\nDelete("c")');
    expect(r.ok, r.text).toBe(true);
    expect((doc.get('p') as { children: { id: string }[] }).children.map((c) => c.id)).toEqual(['r']);
  });

  it('attaches screenshots and writes image exports', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nib-export-'));
    const { run } = await session([{ type: 'frame', id: 'box', x: 0, y: 0, width: 40, height: 30, fill: '#ff0000' }]);
    const r = await run(`TakeScreenshot(["box"])
Export(["box"], "png", ${JSON.stringify(dir)}, {scale: 1})`);
    expect(r.ok, r.text).toBe(true);
    expect(r.images).toHaveLength(1);
    expect(r.images[0].mimeType).toBe('image/png');
    expect(await readdir(dir)).toEqual(['box.png']);
    expect(r.text).toContain(join(dir, 'box.png'));
  });

  it('stops endless loops', async () => {
    const doc = new PenDoc({ version: '2.20', children: [] } as unknown as PenDocument);
    const s = await ExecSession.open(doc, { renderer, images: noImages, baseDir: tmpdir(), timeoutMs: 200 });
    const r = await s.execute({ input: 'while (true) {}' });
    expect(r.ok).toBe(false);
    expect(r.text).toContain('ran longer than');
  });
});

describe('applyEdits', () => {
  it('needs each find to match once unless all is set', () => {
    expect(applyEdits('a b a', [{ find: 'b', replace: 'c' }])).toBe('a c a');
    expect(applyEdits('a b a', [{ find: 'a', replace: 'x' }])).toMatchObject({ error: expect.stringContaining('2 times') });
    expect(applyEdits('a b a', [{ find: 'a', replace: 'x', all: true }])).toBe('x b x');
    expect(applyEdits('a $b', [{ find: '$b', replace: '$&$1' }])).toBe('a $&$1');
  });
});

describe('checks', () => {
  it('reports references to variables that do not exist, but not text that starts with $', async () => {
    const doc = new PenDoc({ version: '2.20', variables: { bg: { type: 'color', value: '#ffffff' } }, children: [] } as unknown as PenDocument);
    const s = await ExecSession.open(doc, { renderer, images: noImages, baseDir: tmpdir() });
    const r = await s.execute({ input: 'Insert(document, {type: "frame", name: "Card", width: 10, height: 10, fill: "$bg", stroke: "$border", children: [{type: "text", content: "$48.2K", fill: "$bg"}]})' });
    expect(r.text).toMatch(/"\$border" \(stroke of "Card" \(\w+\)\) is not a variable/);
    expect(r.text).not.toContain('"$bg"');
    expect(r.text).not.toContain('48.2K');
  });
});

describe('reports', () => {
  it('names unnamed instances after their component', async () => {
    const doc = new PenDoc({ version: '2.20', children: [{ type: 'frame', id: 'btn', name: 'Button', reusable: true, x: 0, y: 0, width: 10, height: 10 }] } as unknown as PenDocument);
    const s = await ExecSession.open(doc, { renderer, images: noImages, baseDir: tmpdir() });
    const r = await s.execute({ input: 'Insert(document, {type: "ref", ref: "btn", x: 50})' });
    expect(r.text).toMatch(/"Button \(instance\)": "\w+"/);
  });
});

describe('export paths', () => {
  it('can be redirected, so test runs never write outside their folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nib-redirect-'));
    const doc = new PenDoc({ version: '2.20', children: [{ type: 'frame', id: 'box', x: 0, y: 0, width: 4, height: 4, fill: '#000000' }] } as unknown as PenDocument);
    const s = await ExecSession.open(doc, { renderer, images: noImages, baseDir: tmpdir(), exportPath: (p) => join(dir, p.replace(/^\/+/, '')) });
    const r = await s.execute({ input: 'Export(["box"], "png", "/nowhere/real", {scale: 1})' });
    expect(r.ok, r.text).toBe(true);
    expect(await readdir(join(dir, 'nowhere', 'real'))).toEqual(['box.png']);
  });
});

describe('pen.dev compatibility', () => {
  const nested = () => new PenDoc({ version: '2.20', children: [
    { type: 'frame', id: 'btn', name: 'Button', reusable: true, x: 0, y: 0, children: [{ type: 'icon', id: 'ic', icon: 'plus', width: 16, height: 16 }, { type: 'text', id: 'lb', content: 'Add', fill: '#000000' }] },
    { type: 'frame', id: 'bar', name: 'Bar', reusable: true, x: 0, y: 100, children: [{ type: 'ref', id: 'b1', ref: 'btn' }] },
    { type: 'frame', id: 'page', name: 'Page', x: 0, y: 200, children: [{ type: 'ref', id: 'barI', ref: 'bar' }] },
  ] } as unknown as PenDocument);

  it('accepts descendants nested inside an override of a nested instance', async () => {
    const doc = nested();
    const s = await ExecSession.open(doc, { renderer, images: noImages, baseDir: tmpdir() });
    const r = await s.execute({ input: 'i = Insert("page", {type: "ref", ref: "bar", descendants: {b1: {opacity: 0.5, descendants: {ic: {icon: "x"}}}}})' });
    expect(r.ok, r.text).toBe(true);
    const id = /"(\w+)" \(= i\)/.exec(r.text)![1];
    expect((doc.get(id) as unknown as { descendants: unknown }).descendants).toEqual({ b1: { opacity: 0.5 }, 'b1/ic': { icon: 'x' } });
  });

  it('accepts Copy descendants keyed by a path into an instance inside the copy', async () => {
    const doc = nested();
    const s = await ExecSession.open(doc, { renderer, images: noImages, baseDir: tmpdir() });
    const r = await s.execute({ input: 'c = Copy("page", document, {y: 400, descendants: {"barI/b1": {opacity: 0.5}, "barI/b1/lb": {content: "New"}}})' });
    expect(r.ok, r.text).toBe(true);
    const copy = doc.get(/"(\w+)" \(= c\)/.exec(r.text)![1]) as unknown as { children: { descendants: unknown }[] };
    expect(copy.children[0].descendants).toEqual({ b1: { opacity: 0.5 }, 'b1/lb': { content: 'New' } });
  });
});
