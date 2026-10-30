import { describe, expect, it } from 'vitest';
import type { PenDocument } from '@nib/format';
import { parsePen } from '@nib/format';
import { buildScene, expandTree, PenDoc, resolveVariable, type ExpandIssue, type SceneNode } from '../src/index.ts';
import { corpusFiles, readCorpus } from '../../format/test/corpus.ts';

const doc = (d: Partial<PenDocument>) => new PenDoc({ version: '2.20', children: [], ...d } as PenDocument);

const icon = { type: 'frame', id: 'ico', reusable: true, width: 16, height: 16, children: [{ type: 'rectangle', id: 'glyph', width: 16, height: 16, fill: '#000000' }] };
const button = {
  type: 'frame', id: 'btn', reusable: true, padding: 8, fill: '#111111',
  children: [
    { type: 'ref', id: 'btnIcon', ref: 'ico' },
    { type: 'text', id: 'label', content: 'OK', fill: '#ffffff' },
  ],
};

describe('instances', () => {
  it('expands a ref with root and descendant overrides', () => {
    const d = doc({ children: [icon, button, {
      type: 'ref', id: 'b1', ref: 'btn', fill: '#ff0000', x: 10, y: 20,
      descendants: { label: { content: 'Save' }, 'btnIcon/glyph': { fill: '#00ff00' } },
    }] as never });
    const issues: ExpandIssue[] = [];
    const out = expandTree(d, d.get('b1')!, { issues }) as any;
    expect(issues).toEqual([]);
    expect(out).toMatchObject({ type: 'frame', id: 'b1', fill: '#ff0000', x: 10, y: 20, padding: 8 });
    expect(out.reusable).toBeUndefined();
    expect(out.children.map((c: any) => c.id)).toEqual(['b1/btnIcon', 'b1/label']);
    expect(out.children[1].content).toBe('Save');
    expect(out.children[0].children[0]).toMatchObject({ id: 'b1/btnIcon/glyph', fill: '#00ff00' });
    expect((d.get('label') as any).content).toBe('OK');
  });

  it('lets the outer instance win over the component\'s own overrides of a nested instance', () => {
    const card = { type: 'frame', id: 'card', reusable: true, children: [{ type: 'ref', id: 'cb', ref: 'btn', descendants: { label: { content: 'Inner', fontSize: 12 } } }] };
    const d = doc({ children: [icon, button, card, { type: 'ref', id: 'c1', ref: 'card', descendants: { 'cb/label': { content: 'Outer' } } }] as never });
    const out = expandTree(d, d.get('c1')!) as any;
    expect(out.children[0].children[1]).toMatchObject({ id: 'c1/cb/label', content: 'Outer', fontSize: 12 });
  });

  it('replaces a descendant subtree when the override has a type', () => {
    const d = doc({ children: [button, icon, { type: 'ref', id: 'b1', ref: 'btn', descendants: {
      btnIcon: { type: 'frame', id: 'slot', children: [{ type: 'text', id: 'star', content: '*', fill: '#000' }] },
    } }] as never });
    const out = expandTree(d, d.get('b1')!) as any;
    expect(out.children[0]).toMatchObject({ type: 'frame', id: 'b1/slot' });
    expect(out.children[0].children[0].id).toBe('b1/star');
  });

  it('hides a descendant with enabled false and drops it from the scene', () => {
    const d = doc({ children: [icon, button, { type: 'ref', id: 'b1', ref: 'btn', descendants: { btnIcon: { enabled: false } } }] as never });
    const scene = buildScene(d, d.get('b1')!) as SceneNode;
    expect(scene.children!.map((c) => c.id)).toEqual(['b1/label']);
  });

  it('expands a reusable ref (component made from an instance)', () => {
    const danger = { type: 'ref', id: 'danger', ref: 'btn', reusable: true, fill: '#cc0000', descendants: { label: { content: 'Delete' } } };
    const d = doc({ children: [icon, button, danger, { type: 'ref', id: 'd1', ref: 'danger', descendants: { label: { fontSize: 20 } } }] as never });
    const out = expandTree(d, d.get('d1')!) as any;
    expect(out).toMatchObject({ id: 'd1', fill: '#cc0000' });
    expect(out.reusable).toBeUndefined();
    expect(out.children[1]).toMatchObject({ id: 'd1/label', content: 'Delete', fontSize: 20 });
  });

  it('reports missing components, cycles and dangling overrides', () => {
    const loop = { type: 'frame', id: 'loop', reusable: true, children: [{ type: 'ref', id: 'inner', ref: 'loop' }] };
    const d = doc({ children: [button, icon, loop, { type: 'ref', id: 'x', ref: 'nope' }, { type: 'ref', id: 'b', ref: 'btn', descendants: { ghost: { fill: '#fff' } } }] as never });
    const issues: ExpandIssue[] = [];
    for (const id of ['x', 'loop', 'b']) expandTree(d, d.get(id)!, { issues });
    expect(issues.map((i) => i.message)).toEqual([
      'component "nope" not found',
      'component "loop" contains itself',
      'override "ghost" matches no descendant of "btn"',
    ]);
  });
});

describe('variables', () => {
  const d = doc({
    themes: { mode: ['light', 'dark'], density: ['regular', 'compact'] },
    variables: {
      bg: { type: 'color', value: [{ value: '#ffffff', theme: { mode: 'light' } }, { value: '#000000', theme: { mode: 'dark' } }] },
      surface: { type: 'color', value: '$bg' },
      gap: { type: 'number', value: [{ value: 16 }, { value: 8, theme: { density: 'compact' } }] },
    },
    children: [{ type: 'frame', id: 'root', theme: { mode: 'dark' }, fill: '$surface', gap: '$gap', children: [
      { type: 'text', id: 'price', content: '$48.2K', fill: '$bg' },
      { type: 'frame', id: 'light', theme: { mode: 'light', density: 'compact' }, fill: '$bg', gap: '$gap' },
    ] }] as never,
  });

  it('picks the last matching themed value and follows aliases', () => {
    expect(resolveVariable(d, 'surface', { mode: 'dark', density: 'regular' })).toBe('#000000');
    expect(resolveVariable(d, 'gap', { mode: 'light', density: 'compact' })).toBe(8);
  });

  it('resolves through inherited themes and keeps literal dollar text', () => {
    const s = buildScene(d, d.get('root')!) as SceneNode;
    expect(s).toMatchObject({ fill: '#000000', gap: 16 });
    expect(s.children![0]).toMatchObject({ content: '$48.2K', fill: '#000000' });
    expect(s.children![1]).toMatchObject({ fill: '#ffffff', gap: 8 });
    expect(buildScene(d, d.get('light')!)).toMatchObject({ fill: '#ffffff' });
  });
});

describe.skipIf(corpusFiles.length === 0)('corpus', () => {
  it.each(corpusFiles)('%s expands every instance and override', (file) => {
    const d = new PenDoc(parsePen(readCorpus(file)));
    const issues: ExpandIssue[] = [];
    for (const n of d.data.children) buildScene(d, n, { issues });
    expect(issues).toEqual([]);
  });
});

describe('imported libraries', () => {
  it('expands a library component with its own nested components, variables and theme axes', () => {
    const lib = doc({
      themes: { Mode: ['Light', 'Dark'] },
      variables: {
        primary: { type: 'color', value: [{ value: '#111111', theme: { Mode: 'Light' } }, { value: '#EEEEEE', theme: { Mode: 'Dark' } }] },
        'button-fill': { type: 'color', value: '$primary' },
      },
      children: [
        { ...icon, fill: '$primary' },
        { ...button, fill: '$button-fill', children: [{ type: 'ref', id: 'btnIcon', ref: 'ico' }, { type: 'text', id: 'label', content: '$9.99', fill: '$primary' }] },
      ] as never,
    });
    const app = doc({
      imports: { ui: './ui.lib.pen' },
      children: [
        { type: 'frame', id: 'light', children: [{ type: 'ref', id: 'b1', ref: 'ui:btn' }] },
        { type: 'frame', id: 'dark', theme: { Mode: 'Dark' }, children: [{ type: 'ref', id: 'b2', ref: 'ui:btn' }] },
      ] as never,
    });
    app.imports.set('ui', lib);
    const light = buildScene(app, app.get('light')!)!.children![0];
    expect(light.fill).toBe('#111111');
    expect(light.children![0].id).toBe('b1/btnIcon');
    expect(light.children![0].fill).toBe('#111111');
    // Text that only looks like a variable stays as it is.
    expect(light.children![1].content).toBe('$9.99');
    const dark = buildScene(app, app.get('dark')!)!.children![0];
    expect(dark.fill).toBe('#EEEEEE');
  });
});
