import { describe, expect, it } from 'vitest';
import type { PenDocument } from '@nib/format';
import { serializePen } from '@nib/format';
import { applyOp, DocEditor, newId, PenDoc, reassignIds } from '../src/index.ts';

const fresh = () => new PenDoc({
  version: '2.20',
  variables: { a: { type: 'color', value: '#000000' } },
  children: [
    { type: 'frame', id: 'root', children: [{ type: 'text', id: 't1', content: 'a', fill: '#000' }] },
    { type: 'rectangle', id: 'r', width: 10, height: 10 },
  ],
} as PenDocument);

describe('DocEditor', () => {
  it('rolls a transaction back to the exact previous document', () => {
    const doc = fresh();
    const before = serializePen(doc.data);
    const ed = new DocEditor(doc);
    ed.begin();
    ed.insert(doc.get('root')!, { type: 'text', id: 'new', content: 'x' } as never);
    ed.set('t1', { content: 'changed', fontSize: 20 });
    ed.set('r', { width: undefined });
    ed.move('r', doc.get('root')!, 0);
    ed.setVariables({ b: { type: 'number', value: 3 } });
    expect(doc.get('new')).toBeDefined();
    expect(doc.locate('r')!.parent!.id).toBe('root');
    ed.rollback();
    expect(serializePen(doc.data)).toBe(before);
    expect(doc.get('new')).toBeUndefined();
    expect(doc.locate('r')!.parent).toBeNull();
  });

  it('undoes and redoes a committed transaction', () => {
    const doc = fresh();
    const before = serializePen(doc.data);
    const ed = new DocEditor(doc);
    ed.begin();
    ed.set('t1', { content: 'b' });
    ed.remove('r');
    const { ops, undo } = ed.commit();
    const after = serializePen(doc.data);
    for (const op of undo) applyOp(doc, op);
    expect(serializePen(doc.data)).toBe(before);
    for (const op of ops) applyOp(doc, op);
    expect(serializePen(doc.data)).toBe(after);
  });

  it('replays committed ops on another copy of the document', () => {
    const a = fresh(), b = fresh();
    const ed = new DocEditor(a);
    ed.begin();
    ed.insert(null, { type: 'frame', id: 'f2', children: [{ type: 'text', id: 't2', content: 'hi' }] } as never);
    ed.set('t2', { content: 'hello' });
    const { ops } = ed.commit();
    for (const op of JSON.parse(JSON.stringify(ops))) applyOp(b, op);
    expect(serializePen(b.data)).toBe(serializePen(a.data));
    expect(b.get('t2')).toMatchObject({ content: 'hello' });
  });

  it('refuses to change ids or children through set', () => {
    const ed = new DocEditor(fresh());
    expect(() => ed.set('t1', { id: 'x' })).toThrow(/cannot be set/);
  });
});

describe('ids', () => {
  it('generates unused ids and reassigns a subtree', () => {
    const doc = fresh();
    expect(newId(doc)).toMatch(/^[A-Za-z0-9]{5}$/);
    const copy = structuredClone(doc.get('root')!);
    const map = reassignIds(doc, copy);
    expect([...map.keys()]).toEqual(['root', 't1']);
    expect(doc.has(map.get('root')!)).toBe(false);
  });
});
