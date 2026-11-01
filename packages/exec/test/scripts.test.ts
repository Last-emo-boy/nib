import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildScene, PenDoc } from '@nib/core';
import type { PenDocument } from '@nib/format';
import { createNodeRenderer } from '@nib/render/node';
import type { Renderer } from '@nib/render';
import { ExecSession, ScriptRunner, scriptInputs } from '../src/index.ts';

let runner: ScriptRunner, renderer: Renderer;
beforeAll(async () => { runner = await ScriptRunner.create(); renderer = await createNodeRenderer(); });
const BARS = readFileSync(new URL('../scripts/bar-chart.js', import.meta.url), 'utf8');

describe('scripts', () => {
  it('reads the controls a script declares', () => {
    expect(scriptInputs(BARS)).toEqual([
      { name: 'values', kind: 'text', default: '12, 19, 7, 24, 15, 30', label: 'Values' },
      { name: 'color', kind: 'color', default: '#2F6FEB', label: 'Bars' },
      { name: 'gap', kind: 'number', default: 12, min: 0, max: 60, label: 'Gap' },
      { name: 'radius', kind: 'number', default: 6, min: 0, max: 30, label: 'Corner radius' },
      { name: 'labels', kind: 'boolean', default: true, label: 'Show the values' },
    ]);
  });

  it('runs a script for its inputs and size, with defaults for the rest', () => {
    const r = runner.run(BARS, { values: '1 2', labels: false }, { width: 100, height: 50 }, 'x');
    expect(r.error).toBeUndefined();
    expect(r.nodes.map((n) => [n.type, (n as { x: number }).x, (n as { height: number }).height])).toEqual([['rectangle', 0, 25], ['rectangle', 56, 50]]);
    expect(r.nodes.map((n) => n.id)).toEqual(['s1', 's2']);
  });

  it('draws the same each time from the same node, differently from another', () => {
    const src = 'function render() { return [{ type: "rectangle", x: Math.random() * 100, y: 0, width: 1, height: 1 }]; }';
    const x = (seed: string) => (runner.run(src, {}, { width: 1, height: 1 }, seed).nodes[0] as { x: number }).x;
    expect(x('a')).toBe(x('a'));
    expect(x('a')).not.toBe(x('b'));
  });

  it('stops scripts that run too long, make too much or return what is not a layer', () => {
    expect(runner.run('function render() { for (;;) {} }', {}, { width: 1, height: 1 }, 'x').error).toMatch(/longer than 2 s/);
    const many = runner.run('function render() { return Array.from({ length: 1500 }, () => ({ type: "rectangle", width: 1, height: 1 })); }', {}, { width: 1, height: 1 }, 'x');
    expect(many.nodes).toHaveLength(1000);
    expect(many.error).toMatch(/more than 1000 layers/);
    const bad = runner.run('function render() { return [{ type: "rectangle", width: 1, height: 1, fill: 5 }, { type: "nonsense" }, 3]; }', {}, { width: 1, height: 1 }, 'x');
    expect(bad.nodes).toHaveLength(0);
    expect(bad.error).toBeTruthy();
    expect(runner.run('const x = 1;', {}, { width: 1, height: 1 }, 'x').error).toMatch(/defines render/);
    expect(runner.run('function render() { throw new Error("no data"); }', {}, { width: 1, height: 1 }, 'x').error).toMatch(/no data/);
    // Nothing but its inputs: no host, no file system.
    expect(runner.run('function render() { return [{ type: "text", content: typeof require + typeof process + typeof fetch }]; }', {}, { width: 1, height: 1 }, 'x').nodes[0]).toMatchObject({ content: 'undefinedundefinedundefined' });
  });

  it('draws a script node with what its script makes, and says when it fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nib-scripts-'));
    await writeFile(join(dir, 'broken.js'), 'function render() { return nope; }');
    const doc = new PenDoc({ version: '2.20', children: [] } as unknown as PenDocument);
    const s = await ExecSession.open(doc, { renderer, images: { load: async () => undefined }, baseDir: dir });
    const r = await s.execute({ input: 'chart = Insert(document, {type: "script", name: "Chart", x: 0, y: 0, width: 300, height: 160, scriptUri: Script("bar-chart"), inputs: {values: "3, 6, 9", color: "#FF0000"}})\nbroken = Insert(document, {type: "script", x: 400, y: 0, width: 100, height: 100, scriptUri: "broken.js"})\nTakeScreenshot([chart])' });
    expect(r.ok, r.text).toBe(true);
    expect(r.text).toMatch(/the script of .*broken\.js.*nope/);
    const chart = doc.data.children[0];
    const scene = buildScene(doc, chart)!;
    expect(scene.children!.filter((c) => c.type === 'rectangle').map((c) => c.fill)).toEqual(['#FF0000', '#FF0000', '#FF0000']);
    // The layers are the scene's only: the document keeps the script node as it was.
    expect((chart as { children?: unknown }).children).toBeUndefined();
    const px = await renderer.renderPixels(scene, scene, { load: async () => undefined });
    const at = (x: number, y: number) => [...px.rgba.slice((y * px.width + x) * 4, (y * px.width + x) * 4 + 3)];
    expect(at(250, 150)).toEqual([255, 0, 0]);
    expect((await s.execute({ input: 'Script("bad", "function render() { return [{ type: \\"rectangle\\", fill: 1 }]; }")' })).text).toMatch(/Script: rectangle/);
  });
});
