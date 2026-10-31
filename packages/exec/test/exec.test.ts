import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildScene, PenDoc } from '@nib/core';
import { serializePen, type PenDocument } from '@nib/format';
import { encodePng, type Renderer } from '@nib/render';
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

  it('compares a design with a picture on the canvas or in a file, and says where they differ', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nib-compare-'));
    const frame = (id: string, x: number, width: number, height: number, fill: string, children: unknown[] = []) => ({ type: 'frame', id, x, y: 0, width, height, fill, layout: 'none', children });
    const { run } = await session([
      frame('box', 0, 60, 60, '#ff0000'),
      frame('pic', 100, 60, 60, '#ff0000', [{ type: 'rectangle', id: 'spot', x: 40, y: 40, width: 20, height: 20, fill: '#ffffff' }]),
    ]);
    // A picture file: the same red, at twice the size (as screenshots are).
    const other = new PenDoc({ version: '2.20', children: [frame('big', 0, 120, 120, '#ff0000'), frame('tall', 200, 60, 120, '#ff0000')] } as unknown as PenDocument);
    await writeFile(join(dir, 'red@2x.png'), await renderer.renderPNG(buildScene(other, other.get('big')!)!, noImages));
    await writeFile(join(dir, 'tall.png'), await renderer.renderPNG(buildScene(other, other.get('tall')!)!, noImages));
    const r = await run(`Compare("box", "pic")
Compare("box", ${JSON.stringify(join(dir, 'red@2x.png'))})
Compare("box", ${JSON.stringify(join(dir, 'tall.png'))})`);
    expect(r.ok, r.text).toBe(true);
    expect(r.images).toHaveLength(3);
    const lines = r.text.split('## Comparisons\n')[1].split('\n');
    // The white corner of "pic" is a ninth of it: most of the difference is bottom-right.
    expect(lines[0]).toMatch(/^- box vs pic: 92\.6% similar, 11\.1% of pixels differ \(most in bottom-right 100%\)\.$/);
    expect(lines[1]).toMatch(/^- box vs red@2x\.png: 100% similar, 0% of pixels differ\.$/);
    expect(lines[2]).toContain('its proportions differ from the reference\'s: at the reference\'s width it is 60 px tall, the reference 120 px');
    expect(r.text).toContain('difference of box from pic');
    const bad = await run('Compare("box", "nothing")');
    expect(bad.ok).toBe(false);
    expect(bad.text).toContain('neither a node of this document nor an image file');
  });

  it('reviews a design: contrast, small text, tap targets, cut-off text, near alignment, uneven gaps', async () => {
    const rect = (id: string, x: number, y: number, width: number, height: number, fill = '#DDDDDD') => ({ type: 'rectangle', id, x, y, width, height, fill });
    const text = (id: string, x: number, y: number, content: string, extra: object = {}) => ({ type: 'text', id, x, y, content, fontSize: 14, fill: '#111111', ...extra });
    const { s } = await session([{ type: 'frame', id: 'page', name: 'Phone', x: 0, y: 0, width: 400, height: 400, fill: '#FFFFFF', layout: 'none', children: [
      text('faint', 10, 10, 'Faint', { fill: '#CCCCCC' }),
      text('ok', 10, 40, 'Fine'),
      rect('card', 200, 10, 150, 100, '#1C7ED6'),
      text('on-card', 210, 20, 'Big', { fill: '#FFFFFF', fontSize: 24, fontWeight: '700' }),
      text('tiny', 10, 70, 'Tiny', { fontSize: 9 }),
      { type: 'frame', id: 'buy', name: 'Buy button', x: 10, y: 100, width: 80, height: 20, fill: '#000000' },
      { type: 'frame', id: 'clipper', name: 'Clipper', x: 200, y: 120, width: 100, height: 40, layout: 'none', clip: true, children: [text('long', 60, 5, 'A long line of text here', { fontSize: 16 })] },
      rect('a', 10, 150, 50, 30), rect('b', 12, 200, 50, 30),
      rect('r1', 20, 300, 30, 30), rect('r2', 60, 300, 30, 30), rect('r3', 102, 300, 30, 30),
    ] }]);
    const items = await s.review();
    const by = (kind: string) => items.filter((i) => i.kind === kind).map((i) => i.id);
    expect(by('contrast')).toEqual(['faint']);
    expect(items.find((i) => i.kind === 'contrast')!.message).toMatch(/contrast with what is behind it is 1\.\d:1, and text needs 4\.5:1/);
    expect(by('small-text')).toEqual(['tiny']);
    expect(by('touch-target')).toEqual(['buy']);
    expect(items.find((i) => i.kind === 'touch-target')!.message).toContain('at least 44×44');
    expect(by('cut-off')).toEqual(['long']);
    // Only the odd one out: everything else in its column shares the left edge it misses by 2px.
    expect(by('alignment')).toEqual(['b']);
    expect(items.find((i) => i.kind === 'spacing')!.message).toBe('The row of r1, r2, r3 in "Phone" has gaps of 10, 12px: make them equal (or use a layout with a gap).');
  });

  it('reviews a frame from a snippet, after its changes', async () => {
    const { s } = await session([{ type: 'frame', id: 'card', name: 'Card', x: 0, y: 0, width: 300, height: 200, fill: '#FFFFFF', layout: 'none', children: [] }]);
    const r = await s.execute({ input: 't = Insert("card", {type: "text", x: 250, y: 20, content: "Runs past the edge", fontSize: 14, fill: "#BBBBBB"}); Review(t)' });
    expect(r.ok, r.text).toBe(true);
    const review = r.text.slice(r.text.indexOf('## Review'));
    expect(review).toContain('card "Card":');
    expect(review).toMatch(/- contrast `\w+`/);
    expect(review).toMatch(/- overflow `\w+`: "Runs past the edge" runs out of "Card"/);
    const clean = await s.execute({ input: 'Update(t, {x: 20, fill: "#111111"}); Review("card")' });
    expect(clean.text).toContain('card "Card": nothing to point out.');
  });

  it('fills a layer with a picture Generate gets, running the snippet again once it is here', async () => {
    const doc = new PenDoc({ version: '2.20', children: [{ type: 'frame', id: 'card', x: 0, y: 0, width: 300, height: 200, layout: 'none', children: [] }] } as unknown as PenDocument);
    const asked: unknown[] = [];
    const s = await ExecSession.open(doc, { renderer, images: noImages, baseDir: tmpdir(), pictures: async (req) => {
      asked.push(req);
      if (req.prompt === 'nothing') throw new Error('no stock photo matches "nothing"');
      return { url: `images/${req.kind}-${req.index}.jpg`, credit: '"Lake" by Ann, CC BY 4.0, https://example.org/lake' };
    } });
    const r = await s.execute({ input: 'n = 0; n++; photo = Insert("card", {type: "rectangle", width: 300, height: 120}); url = Generate(photo, "stock", "calm lake"); Print(url, n)' });
    expect(r.ok, r.text).toBe(true);
    // Asked once, at the layer's size; the snippet ran again from the start (n is 1, not 2).
    expect(asked).toEqual([{ kind: 'stock', prompt: 'calm lake', width: 300, height: 120, index: 0 }]);
    expect(r.text).toContain('images/stock-0.jpg 1');
    expect(r.text).toContain('Picture in');
    expect(r.text).toContain('"Lake" by Ann, CC BY 4.0');
    const photo = (doc.data.children[0] as unknown as { children: { fill?: unknown }[] }).children.at(-1)!;
    expect(photo.fill).toEqual({ type: 'image', url: 'images/stock-0.jpg', mode: 'cover' });
    const bad = await s.execute({ input: 'Generate("card", "stock", "nothing")' });
    expect(bad.ok).toBe(false);
    expect(bad.text).toContain('Generate: no stock photo matches "nothing"');
    expect((await s.execute({ input: 'Generate("card", "video", "x")' })).text).toContain('kind is "stock"');
  });

  it('inserts SVG markup as editable layers', async () => {
    const { doc, run } = await session([{ type: 'frame', id: 'page', x: 0, y: 0, width: 400, height: 400, layout: 'none', children: [] }]);
    const r = await run('logo = InsertSvg("page", \'<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="#2F6FEB"/><path d="M14 26l7 7 13-15" stroke="#fff" stroke-width="4" fill="none"/><text x="0" y="10">Hi</text></svg>\', {name: "Logo", x: 10, y: 10, width: 96, height: 96})');
    expect(r.ok, r.text).toBe(true);
    expect(r.text).toContain('left out what nib cannot draw as layers: 1 text');
    const logo = (doc.data.children[0] as { children: { name: string; width: number; children: { type: string }[] }[] }).children[0];
    expect(logo).toMatchObject({ name: 'Logo', width: 96 });
    expect(logo.children.map((c) => c.type)).toEqual(['path', 'path']);
    expect((await run('InsertSvg("page", "not svg")')).text).toContain('InsertSvg: the second argument is SVG markup');
  });

  it('vectorizes a picture and takes its plain background away', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nib-pictures-'));
    // White, with a red disc in the middle.
    const w = 120, h = 80, rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set(Math.hypot(x - 60, y - 40) < 25 ? [210, 30, 40, 255] : [255, 255, 255, 255], (y * w + x) * 4);
    const png = encodePng(renderer.ck, { width: w, height: h, rgba });
    const images = { load: async (url: string) => (url === 'pic.png' ? png : undefined) };
    const doc = new PenDoc({ version: '2.20', children: [
      { type: 'rectangle', id: 'pic', name: 'Logo', x: 0, y: 0, width: 240, height: 160, fill: { type: 'image', url: 'pic.png', mode: 'cover' } },
      { type: 'frame', id: 'card', x: 0, y: 400, width: 300, height: 200, layout: 'none', children: [{ type: 'rectangle', id: 'inner', x: 10, y: 10, width: 120, height: 80, fill: { type: 'image', url: 'pic.png' } }] },
    ] } as unknown as PenDocument);
    const s = await ExecSession.open(doc, { renderer, images, baseDir: dir });
    const r = await s.execute({ input: 'v = Vectorize("pic", {colors: 2})' });
    expect(r.ok, r.text).toBe(true);
    expect(r.text).toMatch(/Vectorized pic into 2 colors: #FF\w{4}, #D\w{5}\./);
    const vec = doc.data.children[2] as unknown as { name: string; x: number; y: number; width: number; height: number; children: { type: string; fill: string; width: number }[] };
    // Beside the picture, its size; the white covers it all, the red disc on top.
    expect([vec.name, vec.x, vec.y, vec.width, vec.height]).toEqual(['Logo · Vector', 280, 0, 240, 160]);
    // Near the picture's colors (it is drawn smoothed at the layer's size first).
    const near = (hex: string, rgb: number[]) => [1, 3, 5].every((i, k) => Math.abs(parseInt(hex.slice(i, i + 2), 16) - rgb[k]) <= 8);
    expect(vec.children.map((c) => c.type)).toEqual(['path', 'path']);
    expect(near(vec.children[0].fill, [255, 255, 255]) && near(vec.children[1].fill, [210, 30, 40])).toBe(true);
    expect(Math.abs(vec.children[1].width - 100)).toBeLessThan(4);
    // Inside a frame: in the picture's place, the picture hidden.
    expect((await s.execute({ input: 'Vectorize("inner", {colors: 2})' })).ok).toBe(true);
    const card = doc.data.children[1] as unknown as { children: { id: string; name?: string; enabled?: boolean; x?: number }[] };
    expect(card.children.map((c) => [c.name ?? c.id, c.enabled ?? true, c.x])).toEqual([['inner', false, 10], ['Picture · Vector', true, 10]]);
    const cut = await s.execute({ input: 'RemoveBackground("pic")' });
    expect(cut.ok, cut.text).toBe(true);
    expect(cut.text).toMatch(/Took 8\d% of pic's picture away as background/);
    expect((doc.get('pic') as unknown as { fill: unknown }).fill).toEqual({ type: 'image', url: 'images/pic-cutout.png', mode: 'cover' });
    expect(await readdir(join(dir, 'images'))).toEqual(['pic-cutout.png']);
    expect((await s.execute({ input: 'RemoveBackground("card")' })).text).toContain('card shows no picture');
    expect((await s.execute({ input: 'RemoveBackground("inner", {method: "model"})' })).text).toContain('pictures cannot be got here');
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

  it('overrides parts of imported components by key, name or string shorthand, and lists the parts when a key is wrong', async () => {
    const lib = new PenDoc({ version: '2.20', children: [
      { type: 'frame', id: 'label', reusable: true, children: [{ type: 'text', id: 'label-text', content: 'Label', fill: '#000000' }] },
      { type: 'frame', id: 'button', reusable: true, children: [{ type: 'icon', id: 'button-icon', library: 'lucide', icon: 'mail', width: 16, height: 16 }, { type: 'text', id: 'button-label', content: 'Button', fill: '#000000' }] },
      { type: 'frame', id: 'card', reusable: true, layout: 'vertical', children: [
        { type: 'text', id: 'card-title', content: 'Title', fill: '#000000' },
        { type: 'ref', id: 'card-label', ref: 'label' },
        { type: 'ref', id: 'card-action', ref: 'button' },
      ] },
    ] } as unknown as PenDocument);
    const { doc, run } = await session([{ type: 'frame', id: 'screen', x: 0, y: 0, width: 400, height: 300, layout: 'vertical' }], { imports: { ui: './ui.lib.pen' } });
    doc.imports.set('ui', lib);
    const r = await run(`c = Use("screen", "ui:card", {"card-title": "Sign in", "card-label/label-text": "Email", "card-action": {descendants: {"button-label": "Go", "button-icon": "log-in"}}})`);
    expect(r.ok, r.text).toBe(true);
    const inst = doc.get(createdId(r.text, 'Card (instance)') ?? (doc.get('screen') as { children: { id: string }[] }).children[0].id) as unknown as { descendants: Record<string, unknown> };
    expect(inst.descendants).toEqual({ 'card-title': { content: 'Sign in' }, 'card-label/label-text': { content: 'Email' }, 'card-action/button-label': { content: 'Go' }, 'card-action/button-icon': { icon: 'log-in' } });
    const bad = await run(`Use("screen", "ui:card", {"card-content": "x"})`);
    expect(bad.ok).toBe(false);
    expect(bad.text).toContain('component "ui:card" has no descendant "card-content"; its texts and icons are "card-title" (text "Title"), "card-label/label-text" (text "Label"), "card-action/button-icon" (icon "mail"), "card-action/button-label" (text "Button")');
  });

  it('hints that a node id used as a variable needs quotes', async () => {
    const { run } = await session([{ type: 'frame', id: 'screen', x: 0, y: 0, width: 100, height: 100 }]);
    const r = await run(`Insert(screen, {type: "rectangle", width: 10, height: 10})`);
    expect(r.text).toContain('Hint: "screen" is a node id, and ids are strings: write "screen" in quotes');
  });
});
