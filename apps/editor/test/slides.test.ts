import { describe, expect, it } from 'vitest';
import { moveSlide, readingOrder } from '../src/app/slides.ts';

const box = (x: number, y: number, width = 100, height = 60) => ({ x, y, width, height });

describe('slides', () => {
  it('reads rows top to bottom and left to right, uneven rows included', () => {
    const items = [
      { id: 'c', box: box(240, 4) }, { id: 'a', box: box(0, 0) }, { id: 'b', box: box(120, -10) },
      { id: 'e', box: box(120, 200) }, { id: 'd', box: box(0, 210) },
    ];
    expect(readingOrder(items)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('moves a slide by giving the slides the places in their new order', () => {
    const places = { a: { x: 0, y: 0 }, b: { x: 120, y: 0 }, c: { x: 240, y: 0 } };
    // c to the front: c takes a's place, a b's, b c's.
    expect(moveSlide(['a', 'b', 'c'], places, 2, 0)).toEqual({ c: { x: 0, y: 0 }, a: { x: 120, y: 0 }, b: { x: 240, y: 0 } });
    expect(moveSlide(['a', 'b', 'c'], places, 0, 1)).toEqual({ b: { x: 0, y: 0 }, a: { x: 120, y: 0 } });
  });
});
