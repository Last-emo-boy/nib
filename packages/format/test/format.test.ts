import { describe, expect, it } from 'vitest';
import { parsePen, serializePen, stripComments, validateNode } from '../src/index.ts';
import { corpusFiles, readCorpus } from './corpus.ts';

describe('parse/serialize', () => {
  it('accepts comments', () => {
    const doc = parsePen('{\n  // note\n  "version": "2.21", /* x */ "children": [{"type":"text","id":"a","content":"// not a comment"}]\n}');
    expect(doc.version).toBe('2.21');
    expect((doc.children[0] as { content: string }).content).toBe('// not a comment');
  });

  it('keeps escaped quotes inside strings', () => {
    expect(stripComments('{"a":"x\\"//y"}')).toBe('{"a":"x\\"//y"}');
  });

  it('rejects non-documents', () => {
    expect(() => parsePen('[]')).toThrow(/not a .pen document/);
  });
});

describe('validate', () => {
  it('flags unsupported properties and values', () => {
    const issues = validateNode({ type: 'frame', width: '100%', margin: 4, children: [{ type: 'text', content: 'x', padding: 3 }] }, { strict: true });
    expect(issues.map((i) => i.message)).toEqual([
      expect.stringMatching(/percentage/),
      expect.stringMatching(/margin/),
      expect.stringMatching(/"padding" is not a property of text/),
      expect.stringMatching(/no fill/),
    ]);
  });

  it('accepts sizing keywords with fallbacks and variables', () => {
    expect(validateNode({ type: 'frame', id: 'f', width: 'fit_content(120)', height: '$h', gap: '$gap' })).toEqual([]);
  });

  it('requires a width for wrapping text', () => {
    const issues = validateNode({ type: 'text', id: 't', textGrowth: 'fixed-width', fill: '#000' });
    expect(issues).toEqual([expect.objectContaining({ level: 'error', path: 't.width' })]);
  });

  it('explains that images are fills', () => {
    expect(validateNode({ type: 'image' })[0].message).toMatch(/image fills/);
  });
});

describe.skipIf(corpusFiles.length === 0)('corpus', () => {
  it.each(corpusFiles)('%s round-trips byte for byte and validates', (file) => {
    const text = readCorpus(file);
    const doc = parsePen(text);
    expect(serializePen(doc)).toBe(text);
    const issues = doc.children.flatMap((n) => validateNode(n));
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});
