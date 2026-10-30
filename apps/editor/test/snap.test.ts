import { describe, expect, it } from 'vitest';
import { measure, snap, snapPoint } from '../src/canvas/snap.ts';

describe('snapping', () => {
  const other = { x: 100, y: 100, width: 100, height: 50 };

  it('moves a box onto the nearest edge or centre within the threshold, and shows the line', () => {
    const r = snap({ x: 203, y: 20, width: 40, height: 40 }, [other], 5);
    expect(r).toMatchObject({ dx: -3, dy: 0 });
    expect(r.guides).toEqual([{ axis: 'x', at: 200, from: 20, to: 150 }]);
    // Centres line up too.
    expect(snap({ x: 128, y: 300, width: 40, height: 10 }, [other], 5).dx).toBe(2);
    // Beyond the threshold nothing moves.
    expect(snap({ x: 210, y: 20, width: 40, height: 40 }, [other], 5)).toMatchObject({ dx: 0, dy: 0, guides: [] });
  });

  it('snaps only the edges a resize moves', () => {
    const r = snap({ x: 0, y: 0, width: 98, height: 10 }, [other], 5, { x: ['end'], y: [] });
    expect(r.dx).toBe(2);
    expect(snap({ x: 98, y: 0, width: 10, height: 10 }, [other], 5, { x: ['end'], y: [] }).dx).toBe(0);
  });

  it('snaps a point being drawn', () => {
    expect(snapPoint({ x: 99, y: 152 }, [other], 4)).toMatchObject({ x: 100, y: 150 });
  });

  it('measures gaps beside a layer and distances inside one', () => {
    expect(measure({ x: 0, y: 110, width: 50, height: 20 }, other)).toEqual([{ x1: 50, y1: 120, x2: 100, y2: 120, value: 50 }]);
    const inside = measure({ x: 110, y: 120, width: 20, height: 10 }, other);
    expect(inside.map((m) => m.value)).toEqual([10, 70, 20, 20]);
  });
});
