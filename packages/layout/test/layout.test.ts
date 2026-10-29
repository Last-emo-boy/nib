import { describe, expect, it } from 'vitest';
import type { SceneNode } from '@nib/core';
import { buildScene, PenDoc } from '@nib/core';
import { parsePen } from '@nib/format';
import { layoutScene, type TextMeasurer } from '../src/index.ts';
import { corpusFiles, readCorpus } from '../../format/test/corpus.ts';

/** Monospace stand-in: every character 10 wide, lines 20 tall; wraps at spaces. */
const mono: TextMeasurer = {
  measure(node, maxWidth) {
    const words = String(node.content ?? '').split(' ');
    const lines: string[] = [];
    for (const w of words) {
      const last = lines.at(-1);
      if (last !== undefined && maxWidth !== undefined && (last.length + 1 + w.length) * 10 > maxWidth) lines.push(w);
      else lines[Math.max(0, lines.length - 1)] = last === undefined ? w : `${last} ${w}`;
    }
    return { width: Math.max(...lines.map((l) => l.length * 10)), height: lines.length * 20 };
  },
};

let n = 0;
const node = (type: string, props: Record<string, unknown> = {}, children?: SceneNode[]): SceneNode =>
  ({ id: `n${n++}`, type, ...props, ...(children ? { children } : {}) }) as SceneNode;
const rect = (w: unknown, h: unknown, extra = {}) => node('rectangle', { width: w, height: h, ...extra });
const text = (content: string, extra = {}) => node('text', { content, ...extra });

function boxes(root: SceneNode) {
  const r = layoutScene(root, mono);
  return (x: SceneNode) => r.box(x);
}

describe('flex layout', () => {
  it('fits a horizontal frame to children, padding and gap', () => {
    const a = rect(30, 10), b = rect(20, 40);
    const f = node('frame', { x: 5, y: 7, padding: [4, 8], gap: 6 }, [a, b]);
    const box = boxes(f);
    expect(box(f)).toEqual({ x: 5, y: 7, width: 8 + 30 + 6 + 20 + 8, height: 4 + 40 + 4 });
    expect(box(a)).toEqual({ x: 8, y: 4, width: 30, height: 10 });
    expect(box(b)).toEqual({ x: 44, y: 4, width: 20, height: 40 });
  });

  it('splits free main-axis space among fill children and stretches cross-axis fill', () => {
    const a = rect('fill_container', 'fill_container'), b = rect(40, 30), c = rect('fill_container', 10);
    const f = node('frame', { width: 200, gap: 10 }, [a, b, c]);
    const box = boxes(f);
    expect(box(f).height).toBe(30);
    expect(box(a)).toEqual({ x: 0, y: 0, width: 70, height: 30 });
    expect(box(b).x).toBe(80);
    expect(box(c)).toEqual({ x: 130, y: 0, width: 70, height: 10 });
  });

  it('wraps fixed-width text at the width the parent gives it', () => {
    const t = text('aaa bbb ccc', { textGrowth: 'fixed-width', width: 'fill_container' });
    const col = node('frame', { layout: 'vertical', width: 90, padding: 10 }, [t]);
    const box = boxes(col);
    expect(box(t)).toEqual({ x: 10, y: 10, width: 70, height: 40 });
    expect(box(col).height).toBe(60);
  });

  it('collapses a fit parent whose only child fills it', () => {
    const t = text('hello world', { textGrowth: 'fixed-width', width: 'fill_container' });
    const bad = node('frame', { layout: 'vertical' }, [t]);
    expect(boxes(bad)(bad).width).toBe(0);
  });

  it('ignores width on auto text', () => {
    const t = text('abc', { width: 500 });
    const f = node('frame', {}, [t]);
    expect(boxes(f)(t)).toEqual({ x: 0, y: 0, width: 30, height: 20 });
  });

  it.each([
    ['start', [0, 30]], ['center', [35, 65]], ['end', [70, 100]],
    ['space_between', [0, 100]], ['space_around', [17.5, 82.5]],
  ])('justifyContent %s', (justifyContent, xs) => {
    const a = rect(20, 10), b = rect(20, 10);
    const f = node('frame', { width: 120, gap: 10, justifyContent }, [a, b]);
    const box = boxes(f);
    expect([box(a).x, box(b).x]).toEqual(xs);
  });

  it('aligns on the cross axis', () => {
    const a = rect(10, 10), b = rect(10, 30);
    const f = node('frame', { alignItems: 'center' }, [a, b]);
    expect(boxes(f)(a).y).toBe(10);
    const g = node('frame', { layout: 'vertical', width: 50, alignItems: 'end' }, [rect(10, 10)]);
    expect(boxes(g)(g.children![0]).x).toBe(40);
  });

  it('keeps absolute children out of the flow, at x/y from the frame corner', () => {
    const a = rect(30, 10), abs = rect(5, 5, { layoutPosition: 'absolute', x: 100, y: 3 });
    const f = node('frame', { padding: 10 }, [a, abs]);
    const box = boxes(f);
    expect(box(f)).toEqual({ x: 0, y: 0, width: 50, height: 30 });
    expect(box(abs)).toEqual({ x: 100, y: 3, width: 5, height: 5 });
  });

  it('sizes a layout none frame to the extent of its children', () => {
    const a = rect(10, 10, { x: 40, y: 5 }), b = rect(20, 20, { x: 0, y: 30 });
    const f = node('frame', { layout: 'none' }, [a, b]);
    expect(boxes(f)(f)).toMatchObject({ width: 50, height: 50 });
  });

  it('uses fallbacks for empty fit frames and unparented fills', () => {
    const empty = node('frame', { width: 'fit_content(100)', height: 'fit_content(40)' });
    expect(boxes(empty)(empty)).toMatchObject({ width: 100, height: 40 });
    const lone = rect('fill_container(25)', 'fill_container');
    expect(boxes(lone)(lone)).toMatchObject({ width: 25, height: 0 });
  });

  it('nests rows of filling cards in a fixed column', () => {
    const cards = [0, 1, 2].map(() => node('frame', { width: 'fill_container', layout: 'vertical', padding: 5 }, [text('x y', { textGrowth: 'fixed-width', width: 'fill_container' })]));
    const row = node('frame', { width: 'fill_container', gap: 10 }, cards);
    const col = node('frame', { layout: 'vertical', width: 300, padding: 20 }, [row]);
    const box = boxes(col);
    expect(cards.map((c) => box(c).x)).toEqual([0, 90, 180]);
    expect(box(cards[0])).toMatchObject({ width: 80, height: 30 });
    expect(box(col).height).toBe(70);
  });
});

describe.skipIf(corpusFiles.length === 0)('corpus', () => {
  it.each(corpusFiles)('%s lays out every top-level node', (file) => {
    const d = new PenDoc(parsePen(readCorpus(file)));
    let count = 0;
    for (const top of d.data.children) {
      const scene = buildScene(d, top);
      if (!scene) continue;
      const r = layoutScene(scene, mono);
      count += r.size;
      expect(Number.isFinite(r.box(scene).width) && Number.isFinite(r.box(scene).height)).toBe(true);
    }
    expect(count).toBeGreaterThan(0);
  });
});
