import { describe, expect, it } from 'vitest';
import { comparePixels } from '../src/compare.ts';

const solid = (w: number, h: number, rgba: [number, number, number, number]) => ({ width: w, height: h, rgba: Uint8Array.from({ length: w * h * 4 }, (_, i) => rgba[i % 4]) });

describe('picture comparison', () => {
  it('scores identical pictures as the same, and transparent as white', () => {
    expect(comparePixels(solid(4, 4, [10, 20, 30, 255]), solid(4, 4, [10, 20, 30, 255]))).toMatchObject({ similarity: 1, changed: 0 });
    expect(comparePixels(solid(2, 2, [0, 0, 0, 0]), solid(2, 2, [255, 255, 255, 255])).similarity).toBe(1);
  });
  it('measures how much and where pictures differ', () => {
    const a = solid(2, 1, [255, 255, 255, 255]);
    const b = { width: 2, height: 1, rgba: Uint8Array.from([0, 0, 0, 255, 255, 255, 255, 255]) };
    const c = comparePixels(a, b);
    expect(c.changed).toBe(0.5);
    expect(c.similarity).toBeCloseTo(0.5);
    // The differing pixel is drawn red, the other gray.
    expect(c.diff.rgba[0]).toBeGreaterThan(c.diff.rgba[1]);
    expect(c.diff.rgba[4]).toBe(c.diff.rgba[5]);
    expect(() => comparePixels(a, solid(1, 1, [0, 0, 0, 255]))).toThrow('same size');
  });
  it('says where pictures differ, by ninths', () => {
    // 3×3 pixels, only the bottom-right one differs.
    const a = solid(3, 3, [255, 255, 255, 255]);
    const b = solid(3, 3, [255, 255, 255, 255]);
    b.rgba.set([0, 0, 0, 255], 8 * 4);
    expect(comparePixels(a, b).cells).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1]);
  });
});
