import { describe, expect, it } from 'vitest';
import { DocEditor, PenDoc } from '@nib/core';
import type { PenDocument } from '@nib/format';
import { discardVariants, keepVariant } from '../src/app/variants.ts';

const doc = () => new PenDoc({ version: '2.20', children: [
  { type: 'frame', id: 'a', name: 'Other', x: 0, y: 0, width: 10, height: 10 },
  { type: 'frame', id: 'home', name: 'Home', x: 100, y: 50, width: 400, height: 300 },
  { type: 'frame', id: 'v1', name: 'Home · Variant 1', x: 620, y: 50, width: 400, height: 300 },
  { type: 'frame', id: 'v2', name: 'Home · Variant 2', x: 1140, y: 50, width: 400, height: 300 },
] } as unknown as PenDocument);

const run = (d: PenDoc, fn: (ed: DocEditor) => void) => { const ed = new DocEditor(d); ed.begin(); fn(ed); ed.commit(); return d; };

describe('variants', () => {
  it("keeps one in the original's place: its name, position and spot in the layers", () => {
    const d = run(doc(), (ed) => keepVariant(ed, ed.doc, 'home', ['v1', 'v2'], 'v2'));
    expect(d.data.children.map((n) => [n.id, n.name, n.x, n.y])).toEqual([['a', 'Other', 0, 0], ['v2', 'Home', 100, 50]]);
  });
  it('keeps one where it is when the original is gone', () => {
    const d = doc();
    run(d, (ed) => ed.remove('home'));
    run(d, (ed) => keepVariant(ed, ed.doc, 'home', ['v1', 'v2'], 'v1'));
    expect(d.data.children.map((n) => [n.id, n.name, n.x])).toEqual([['a', 'Other', 0], ['v1', 'Home', 620]]);
  });
  it('discards all copies, keeping the original', () => {
    const d = run(doc(), (ed) => discardVariants(ed, ed.doc, ['v1', 'v2', 'gone']));
    expect(d.data.children.map((n) => n.id)).toEqual(['a', 'home']);
  });
});
