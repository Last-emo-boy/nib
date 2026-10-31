import { describe, expect, it } from 'vitest';
import { pathBounds } from '@nib/core';
import { loopArea, removeBackground, traceImage, traceMask, type Pixels } from '../src/index.ts';

/** A picture drawn by a function of each pixel: [r, g, b, a]. */
function picture(w: number, h: number, at: (x: number, y: number) => number[]): Pixels {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set(at(x, y), (y * w + x) * 4);
  return { width: w, height: h, rgba };
}

describe('vectorize', () => {
  it('traces a region with its hole, the hole running the other way', () => {
    // A 6×6 square with a 2×2 hole.
    const w = 8, mask = new Uint8Array(w * w);
    for (let y = 1; y < 7; y++) for (let x = 1; x < 7; x++) mask[y * w + x] = x >= 3 && x < 5 && y >= 3 && y < 5 ? 0 : 1;
    const loops = traceMask(mask, w, w);
    expect(loops.map((l) => loopArea(l)).sort((a, b) => a - b)).toEqual([-4, 36]);
    expect(loops.find((l) => loopArea(l) > 0)).toEqual([{ x: 1, y: 1 }, { x: 7, y: 1 }, { x: 7, y: 7 }, { x: 1, y: 7 }]);
  });

  it('keeps regions that touch at a corner apart', () => {
    const mask = new Uint8Array([1, 0, 0, 1]);
    expect(traceMask(mask, 2, 2).map(loopArea)).toEqual([1, 1]);
  });

  it('turns a picture into layers of flat color, the largest color first, each covering the ones on top', () => {
    // White background, a red disc, a blue square.
    const p = picture(100, 80, (x, y) => (Math.hypot(x - 30, y - 40) < 20 ? [220, 30, 40, 255] : x >= 60 && x < 90 && y >= 20 && y < 50 ? [20, 60, 200, 255] : [255, 255, 255, 255]));
    const layers = traceImage(p, 200, 160, { colors: 3 });
    expect(layers.map((l) => l.color)).toEqual(['#FFFFFF', '#DC1E28', '#143CC8']);
    // The first covers the whole picture, at the box's size.
    expect(pathBounds(layers[0].subs)).toEqual({ x: 0, y: 0, width: 200, height: 160 });
    // The square keeps its corners; the disc is smooth.
    const square = layers.find((l) => l.color === '#143CC8')!.subs[0];
    expect(square.points.every((q) => !q.in && !q.out)).toBe(true);
    expect(pathBounds([square])).toEqual({ x: 120, y: 40, width: 60, height: 60 });
    const disc = layers.find((l) => l.color === '#DC1E28')!;
    const round = disc.subs.reduce((a, b) => (b.points.length > a.points.length ? b : a));
    expect(round.points.some((q) => q.in || q.out)).toBe(true);
    const b = pathBounds(disc.subs)!;
    // The disc's layer also covers the square drawn after it.
    expect(disc.subs).toHaveLength(2);
    expect(Math.abs(b.x - 20)).toBeLessThan(3);
  });

  it('leaves transparent parts out and specks off', () => {
    const p = picture(40, 40, (x, y) => (x < 20 ? [0, 0, 0, 255] : x === 30 && y === 30 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
    const layers = traceImage(p, 40, 40, { colors: 2 });
    expect(layers.map((l) => l.color)).toEqual(['#000000']);
    expect(pathBounds(layers[0].subs)).toEqual({ x: 0, y: 0, width: 20, height: 40 });
  });
});

describe('remove background', () => {
  it('takes away a plain background from the edges in, and keeps what is inside', () => {
    // A dark subject on light gray, with a light gray spot inside it that is not background.
    const p = picture(60, 60, (x, y) => {
      if (x >= 28 && x < 32 && y >= 28 && y < 32) return [235, 235, 235, 255];
      if (x >= 15 && x < 45 && y >= 15 && y < 45) return [30, 40, 50, 255];
      return [235 + (x % 3), 235, 236, 255];
    });
    const { pixels, removed } = removeBackground(p);
    const alpha = (x: number, y: number) => pixels.rgba[(y * 60 + x) * 4 + 3];
    expect(alpha(2, 2)).toBe(0);
    expect(alpha(20, 20)).toBe(255);
    expect(alpha(29, 29)).toBe(255);
    expect(removed).toBeCloseTo(1 - 900 / 3600, 2);
  });

  it('says when there is no plain background', () => {
    const noisy = picture(30, 30, (x, y) => [(x * 37) % 256, (y * 91) % 256, ((x + y) * 53) % 256, 255]);
    expect(() => removeBackground(noisy)).toThrow('no plain background');
  });
});
