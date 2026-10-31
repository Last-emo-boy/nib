import { describe, expect, it } from 'vitest';
import { PenDoc } from '@nib/core';
import type { PenDocument } from '@nib/format';
import { keyOf, overrideOf, ownerOf, resolvePart, withOverrides } from '../src/app/parts.ts';

const doc = new PenDoc({
  version: '2.20',
  children: [
    { type: 'frame', id: 'btn', reusable: true, width: 100, height: 40, children: [{ type: 'text', id: 'label', content: 'Button', fill: '#000000' }] },
    { type: 'frame', id: 'card', reusable: true, width: 200, height: 100, children: [{ type: 'ref', id: 'cta', ref: 'btn' }] },
    { type: 'ref', id: 'one', ref: 'card', x: 300, descendants: { 'cta/label': { content: 'Buy' } } },
  ],
} as unknown as PenDocument);

describe('instance parts', () => {
  it('splits a part id into its instance and override key', () => {
    expect(ownerOf('one/cta/label')).toBe('one');
    expect(keyOf('one/cta/label')).toBe('cta/label');
  });
  it('resolves a part as its instance shows it, overrides applied', () => {
    expect(resolvePart(doc, 'one/cta/label')).toMatchObject({ type: 'text', content: 'Buy', fill: '#000000' });
    expect(resolvePart(doc, 'one/cta')).toMatchObject({ type: 'frame', width: 100 });
    expect(resolvePart(doc, 'one/nothing')).toBeUndefined();
    expect(overrideOf(doc, 'one/cta/label')).toEqual({ content: 'Buy' });
  });
  it('adds, changes and drops overrides', () => {
    const d = { 'cta/label': { content: 'Buy' } };
    expect(withOverrides(d, ['cta/label'], { fill: '#FF0000' })).toEqual({ 'cta/label': { content: 'Buy', fill: '#FF0000' } });
    expect(withOverrides(d, ['cta'], { opacity: 0.5 })).toEqual({ 'cta/label': { content: 'Buy' }, cta: { opacity: 0.5 } });
    // Dropping the last property drops the entry, and with it the overrides.
    expect(withOverrides(d, ['cta/label'], { content: undefined })).toBeUndefined();
  });
});
