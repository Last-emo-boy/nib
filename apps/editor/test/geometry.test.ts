import { describe, expect, it } from 'vitest';
import { reorder, scaleTree } from '../src/app/geometry.ts';
import { angleOf, apply, boundsOf, flip, invert, mul, placement, quad } from '../src/canvas/affine.ts';

describe('stacking order', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('moves the selection one step past an unselected neighbour, as a block', () => {
    expect(reorder(ids, new Set(['b']), 'forward')).toEqual(['a', 'c', 'b', 'd']);
    expect(reorder(ids, new Set(['a', 'b']), 'forward')).toEqual(['c', 'a', 'b', 'd']);
    expect(reorder(ids, new Set(['d']), 'forward')).toEqual(ids);
    expect(reorder(ids, new Set(['c']), 'backward')).toEqual(['a', 'c', 'b', 'd']);
    expect(reorder(ids, new Set(['a']), 'backward')).toEqual(ids);
  });
  it('moves it to the top or bottom, keeping its own order', () => {
    expect(reorder(ids, new Set(['a', 'c']), 'front')).toEqual(['b', 'd', 'a', 'c']);
    expect(reorder(ids, new Set(['b', 'd']), 'back')).toEqual(['b', 'd', 'a', 'c']);
  });
});

describe('scaling a layer with its contents', () => {
  it('scales lengths, effects, children and their positions, but not the node position or variables', () => {
    const frame = {
      id: 'f', type: 'frame', x: 10, y: 20, width: 100, height: 50, cornerRadius: [4, 4, 0, 0], padding: [8, 12], gap: '$space',
      effect: [{ type: 'shadow', offset: { x: 0, y: 2 }, blur: 6, color: '#0003' }, { type: 'blur', radius: 4 }],
      children: [
        { id: 't', type: 'text', x: 5, y: 5, fontSize: 16, letterSpacing: 0.5, lineHeight: 1.5, content: 'Hi' },
        { id: 'r', type: 'rectangle', x: 0, y: 30, width: 'fill_container', height: 10, strokeWidth: { top: 1, bottom: 2 } },
      ],
    };
    const t = scaleTree(frame, 2);
    expect(t.get('f')).toEqual({ width: 200, height: 100, cornerRadius: [8, 8, 0, 0], padding: [16, 24], effect: [{ type: 'shadow', offset: { x: 0, y: 4 }, blur: 12, color: '#0003' }, { type: 'blur', radius: 8 }] });
    expect(t.get('t')).toEqual({ x: 10, y: 10, fontSize: 32, letterSpacing: 1 });
    expect(t.get('r')).toEqual({ x: 0, y: 60, height: 20, strokeWidth: { top: 2, bottom: 4 } });
  });
});

describe('placement transforms', () => {
  it('turns counter-clockwise around the top-left corner, as the renderer draws', () => {
    const m = placement(10, 20, 90);
    // The right side of a turned box points up the screen.
    const p = apply(m, 100, 0);
    expect(p.x).toBeCloseTo(10); expect(p.y).toBeCloseTo(-80);
    expect(angleOf(m)).toBeCloseTo(90);
    const back = apply(invert(m), p.x, p.y);
    expect(back.x).toBeCloseTo(100); expect(back.y).toBeCloseTo(0);
  });
  it('mirrors contents in place and bounds turned boxes', () => {
    const m = mul(placement(0, 0, 0), flip(100, 50, true, false));
    expect(apply(m, 0, 0)).toEqual({ x: 100, y: 0 });
    const b = boundsOf(quad(placement(0, 0, 45), 100, 100));
    expect(b.width).toBeCloseTo(141.42, 1);
  });
});
