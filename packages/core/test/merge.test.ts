import { describe, expect, it } from 'vitest';
import type { PenDocument } from '@nib/format';
import { mergeDocs } from '../src/index.ts';

const base = (): PenDocument => ({ version: '2.20', variables: { brand: { type: 'color', value: '#111111' } }, themes: { Mode: ['Light', 'Dark'] }, children: [
  { type: 'frame', id: 'home', name: 'Home', x: 0, y: 0, width: 300, height: 200, children: [
    { type: 'text', id: 'title', content: 'Hello', fontSize: 20 },
    { type: 'rectangle', id: 'a', width: 10, height: 10 },
    { type: 'rectangle', id: 'b', width: 20, height: 20 },
  ] },
  { type: 'frame', id: 'about', name: 'About', x: 400, y: 0, width: 300, height: 200 },
] } as unknown as PenDocument);
const edit = (f: (d: any) => void) => { const d = base() as any; f(d); return d as PenDocument; };
const home = (d: PenDocument) => (d.children[0] as unknown as { children: { id: string; content?: string; fontSize?: number; width?: number }[] }).children;

describe('merge', () => {
  it('takes what each side changed, property by property', () => {
    const ours = edit((d) => { d.children[0].children[0].content = 'Hi'; d.variables.brand.value = '#222222'; });
    const theirs = edit((d) => { d.children[0].children[0].fontSize = 24; d.children[1].x = 500; d.themes.Language = ['en', 'zh']; d.variables.accent = { type: 'color', value: '#FF0000' }; });
    const r = mergeDocs(base(), ours, theirs);
    expect(r.conflicts).toEqual([]);
    expect(home(r.doc)[0]).toMatchObject({ content: 'Hi', fontSize: 24 });
    expect((r.doc.children[1] as { x: number }).x).toBe(500);
    expect(r.doc.variables).toEqual({ brand: { type: 'color', value: '#222222' }, accent: { type: 'color', value: '#FF0000' } });
    expect(r.doc.themes).toEqual({ Mode: ['Light', 'Dark'], Language: ['en', 'zh'] });
  });

  it('adds, deletes and moves layers from their side, keeping our order', () => {
    const ours = edit((d) => { d.children[0].children.push({ type: 'text', id: 'ours', content: 'O' }); });
    const theirs = edit((d) => {
      d.children[0].children.splice(1, 1);
      d.children[0].children.splice(1, 0, { type: 'text', id: 'theirs', content: 'T' });
      d.children[1].children = [d.children[0].children.pop()];
      d.children.push({ type: 'frame', id: 'new', name: 'New', x: 0, y: 400, width: 10, height: 10, children: [{ type: 'text', id: 'inside', content: 'x' }] });
    });
    const r = mergeDocs(base(), ours, theirs);
    expect(r.conflicts).toEqual([]);
    expect(home(r.doc).map((c) => c.id)).toEqual(['title', 'theirs', 'ours']);
    expect((r.doc.children[1] as unknown as { children: { id: string }[] }).children.map((c) => c.id)).toEqual(['b']);
    expect(r.doc.children.map((c) => c.id)).toEqual(['home', 'about', 'new']);
    expect((r.doc.children[2] as unknown as { children: { id: string }[] }).children.map((c) => c.id)).toEqual(['inside']);
  });

  it('takes their new order of children when ours kept it', () => {
    const theirs = edit((d) => { d.children[0].children.reverse(); });
    expect(home(mergeDocs(base(), base(), theirs).doc).map((c) => c.id)).toEqual(['b', 'a', 'title']);
  });

  it('keeps ours and says so where both sides changed the same thing', () => {
    const ours = edit((d) => { d.children[0].children[0].content = 'Ours'; d.children[0].children[1].width = 99; });
    const theirs = edit((d) => { d.children[0].children[0].content = 'Theirs'; d.children[0].children.splice(1, 1); });
    const r = mergeDocs(base(), ours, theirs);
    expect(home(r.doc)[0].content).toBe('Ours');
    expect(home(r.doc).map((c) => c.id)).toEqual(['title', 'a', 'b']);
    expect(r.conflicts).toEqual(['a: they deleted it, we changed it; kept', '"title".content: changed on both sides; ours kept'.replace('"title"', 'title')]);
  });
});
