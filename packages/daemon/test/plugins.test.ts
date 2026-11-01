import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parsePen, serializePen, type PenDocument } from '@nib/format';
import { createNodeRenderer } from '@nib/render/node';
import { DocumentHost, listPlugins, pluginInfo, pluginSnippet, runPlugin, USER_PLUGINS } from '../src/index.ts';

let host: DocumentHost;
let dir: string;
let file: string;
const none = { load: async () => undefined };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nib-plugins-'));
  file = join(dir, 'design.pen');
  await writeFile(file, serializePen({ version: '2.20', children: [{ type: 'frame', id: 'page', name: 'Page', x: 3, y: 5, width: 601, height: 397, layout: 'none', fill: '#FFFFFF', children: [
    { type: 'rectangle', id: 'b', x: 219, y: 13, width: 99, height: 61, fill: '#000000' },
    { type: 'rectangle', id: 'a', x: 11, y: 14, width: 101, height: 59, fill: '#00000080', stroke: '#000000' },
    { type: 'text', id: 't', x: 300, y: 200, content: '#000000', fill: '#000000' },
  ] }] } as unknown as PenDocument));
  await mkdir(join(dir, 'plugins'));
  await writeFile(join(dir, 'plugins', 'broken.js'), '// @name Broken\n// on purpose\nUpdate("a", {name: "half done"})\nthrow new Error("third line")\n');
  await mkdir(USER_PLUGINS, { recursive: true });
  await writeFile(join(USER_PLUGINS, 'hello_world.js'), '// @input who "you" Who\nPrint(`hello ${input.who}, ${selection.length} selected`)\n');
  host = new DocumentHost({ renderer: await createNodeRenderer(), images: () => none, watch: false, recents: false });
  await host.open(file);
});
afterAll(() => host.close());

const doc = async () => parsePen(await readFile(file, 'utf8')).children[0] as unknown as { x: number; y: number; width: number; children: Record<string, any>[] };

describe('plugins', () => {
  it('read their name, description and inputs from their header', () => {
    const p = pluginInfo('// @name Tidy\n// @description Tidies up.\n// @input step 8 1..64 Step\n// @input on true Also inside\nPrint(1)', '/x/tidy.js', 'user');
    expect(p).toMatchObject({ id: 'user/tidy', name: 'Tidy', description: 'Tidies up.', source: 'user' });
    expect(p.inputs.map((i) => [i.name, i.kind, i.default])).toEqual([['step', 'number', 8], ['on', 'boolean', true]]);
    expect(pluginInfo('Print(1)', '/x/clean_up-gaps.js', 'nib').name).toBe('clean up gaps');
  });

  it('get their selection and inputs on their own first line, numbers kept in range', () => {
    const info = pluginInfo('// @input step 8 1..64 Step\n// @input on true On\n// @input label "x" Label', 'p.js', 'user');
    const s = pluginSnippet('// first\nPrint(input)', info, ['a'], { step: 500, on: 'false', label: 7 });
    expect(s.split('\n')).toHaveLength(2);
    expect(s.split('\n')[0]).toMatch(/^const selection = \["a"\], input = \{"step":64,"on":false,"label":"7"\}; \/\/ first$/);
    expect(pluginSnippet('x', info, [], {})).toContain('{"step":8,"on":true,"label":"x"}');
  });

  it('come from nib, the person\'s folder and the folder beside the design', async () => {
    const ids = (await listPlugins(file)).map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['nib/number-layers', 'nib/replace-color', 'nib/snap-to-grid', 'user/hello_world', 'project/broken']));
    expect((await listPlugins()).some((p) => p.source === 'project')).toBe(false);
  });

  it('run as one change named after them', async () => {
    const r = await runPlugin(host, file, 'nib/number-layers', ['b', 'a'], { name: 'Card' });
    expect(r.ok).toBe(true);
    expect(r.output).toEqual(['Named 2 layers Card 1–2.']);
    expect((await doc()).children.map((c) => c.name)).toEqual(['Card 2', 'Card 1', undefined]);
    expect(host.snapshot(file).undo.at(-1)).toBe('Number layers');
    expect((await runPlugin(host, file, 'user/hello_world', ['a'], {})).output).toEqual(['hello you, 1 selected']);
  });

  it('snap to a grid and replace a color as nib\'s own do', async () => {
    await runPlugin(host, file, 'nib/snap-to-grid', ['page'], { step: 8 });
    const snapped = await doc();
    expect([snapped.x, snapped.y, snapped.width]).toEqual([0, 8, 600]);
    expect(snapped.children.map((c) => [c.x, c.y])).toEqual([[216, 16], [8, 16], [304, 200]]);
    const r = await runPlugin(host, file, 'nib/replace-color', [], { from: '#000000', to: '#1A73E8' });
    expect(r.output).toEqual(['Changed #000000 to #1A73E8 on 3 layers.']);
    const [b, a, t] = (await doc()).children;
    expect([b.fill, a.fill, a.stroke, t.fill, t.content]).toEqual(['#1A73E8', '#1A73E880', '#1A73E8', '#1A73E8', '#000000']);
  });

  it('change nothing when they fail, and say which of their lines did', async () => {
    const before = await readFile(file, 'utf8');
    const r = await runPlugin(host, file, 'project/broken', [], {});
    expect(r.ok).toBe(false);
    expect(r.text).toContain('third line');
    expect(r.text).toMatch(/line 4/);
    expect(await readFile(file, 'utf8')).toBe(before);
    await expect(runPlugin(host, file, 'nib/nope', [], {})).rejects.toThrow(/no plugin/);
  });
});
