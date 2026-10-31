import { describe, expect, it } from 'vitest';
import { coverBox, cropFill, imageRect } from '../src/canvas/crop.ts';

describe('image crop', () => {
  it('places the whole image where each mode draws it', () => {
    // A 200 × 100 image in a 100 × 100 box.
    expect(imageRect({ type: 'image' }, 200, 100, 100, 100)).toEqual({ x: -50, y: 0, width: 200, height: 100 });
    expect(imageRect({ type: 'image', mode: 'contain' }, 200, 100, 100, 100)).toEqual({ x: 0, y: 25, width: 100, height: 50 });
    expect(imageRect({ type: 'image', mode: 'stretch' }, 200, 100, 100, 100)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('writes a crop that reads back as the same placement', () => {
    const r = { x: -30, y: -10, width: 240, height: 120 };
    const f = cropFill({ type: 'image', url: 'a.png', mode: 'cover' }, r, 100, 80);
    expect(f.mode).toBe('stretch');
    const back = imageRect(f, 200, 100, 100, 80);
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(back[k]).toBeCloseTo(r[k], 2);
  });

  it('keeps the image covering the node', () => {
    expect(coverBox({ x: 20, y: 0, width: 200, height: 100 }, 100, 100)).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(coverBox({ x: -150, y: 0, width: 200, height: 100 }, 100, 100)).toEqual({ x: -100, y: 0, width: 200, height: 100 });
    // Too small: scaled up until it covers.
    expect(coverBox({ x: 0, y: 0, width: 100, height: 50 }, 100, 100)).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });
});
