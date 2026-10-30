import { describe, expect, it } from 'vitest';
import { ellipseHandles, fromAxis, fromEnds, linearEnds, meshPoints, moveMeshPoint, offsetOn, resizeMesh } from '../src/canvas/gradient.ts';

describe('gradient handles', () => {
  it('puts a linear gradient\'s ends where the renderer draws them, and back', () => {
    // Rotation 0 runs bottom to top; 90 right to left (counter-clockwise).
    expect(linearEnds({})).toEqual({ start: { x: 0.5, y: 1 }, end: { x: 0.5, y: 0 } });
    const r = linearEnds({ rotation: 90 });
    expect(r.start.x).toBeCloseTo(1); expect(r.end.x).toBeCloseTo(0);
    const props = fromEnds({ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.6 });
    const back = linearEnds(props);
    expect(back.start.x).toBeCloseTo(0.1, 3); expect(back.start.y).toBeCloseTo(0.2, 3);
    expect(back.end.x).toBeCloseTo(0.9, 3); expect(back.end.y).toBeCloseTo(0.6, 3);
  });

  it('turns and stretches a radial gradient from its axis ends', () => {
    const f = { center: { x: 0.5, y: 0.5 }, size: { width: 1, height: 0.5 }, rotation: 0 };
    expect(ellipseHandles(f)).toEqual({ center: { x: 0.5, y: 0.5 }, a: { x: 1, y: 0.5 }, b: { x: 0.5, y: 0.75 } });
    const turned = { ...f, ...fromAxis(f, 'a', { x: 0.5, y: 0.2 }) };
    expect(turned.rotation).toBe(90);
    expect(turned.size.width).toBeCloseTo(0.6);
    const h = ellipseHandles(turned);
    expect(h.a.x).toBeCloseTo(0.5); expect(h.a.y).toBeCloseTo(0.2);
  });

  it('places stops along a line and moves mesh points', () => {
    expect(offsetOn({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.25, y: 0.7 })).toBe(0.25);
    const mesh = { type: 'mesh_gradient', columns: 2, rows: 2, colors: ['#111111', '#222222', '#333333', '#444444'] };
    expect(meshPoints(mesh)[3]).toEqual({ x: 1, y: 1 });
    const moved = moveMeshPoint(mesh, 3, { x: 0.8, y: 0.9 });
    expect(moved.points).toEqual([[0, 0], [1, 0], [0, 1], [0.8, 0.9]]);
    expect(resizeMesh(moved, 3, 2)).toMatchObject({ columns: 3, rows: 2, colors: ['#111111', '#222222', '#222222', '#333333', '#444444', '#444444'] });
  });
});
