import { describe, expect, it } from 'vitest';
import { validateNode, type PenDocument } from '@nib/format';
import { addStroke, classifyStroke, DocEditor, flatten, PenDoc, sketchOutline, smoothStroke, type Pt } from '../src/index.ts';

// Hand-drawn strokes: a little wobble on every point.
const wobble = (pts: Pt[]) => pts.map((p, i) => ({ x: p.x + Math.sin(i * 1.7) * 1.2, y: p.y + Math.cos(i * 2.3) * 1.2 }));
const segment = (a: Pt, b: Pt, n = 12) => Array.from({ length: n }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
const rect = (x: number, y: number, w: number, h: number) => wobble([...segment({ x, y }, { x: x + w, y }), ...segment({ x: x + w, y }, { x: x + w, y: y + h }), ...segment({ x: x + w, y: y + h }, { x, y: y + h }), ...segment({ x, y: y + h }, { x, y: y + 2 })]);
const ellipse = (cx: number, cy: number, rx: number, ry: number) => wobble(Array.from({ length: 40 }, (_, i) => ({ x: cx + rx * Math.cos((i / 38) * 2 * Math.PI), y: cy + ry * Math.sin((i / 38) * 2 * Math.PI) })));
const line = (a: Pt, b: Pt) => wobble([...segment(a, b), b]);
const wave = (x: number, y: number, w: number) => Array.from({ length: 60 }, (_, i) => ({ x: x + (w * i) / 59, y: y + Math.sin(i * 0.9) * 6 }));

describe('sketch', () => {
  it('reads strokes as boxes, ellipses, lines and scribbled text', () => {
    expect(classifyStroke(rect(0, 0, 300, 200)).shape).toBe('box');
    expect(classifyStroke(ellipse(50, 50, 30, 30)).shape).toBe('ellipse');
    expect(classifyStroke(ellipse(50, 50, 80, 30)).shape).toBe('ellipse');
    expect(classifyStroke(line({ x: 0, y: 0 }, { x: 200, y: 4 })).shape).toBe('line');
    expect(classifyStroke(line({ x: 0, y: 0 }, { x: 100, y: 120 })).shape).toBe('line');
    expect(classifyStroke(wave(0, 0, 150)).shape).toBe('text');
    expect(classifyStroke([{ x: 5, y: 5 }, { x: 7, y: 6 }]).shape).toBe('mark');
  });

  it('smooths a stroke into a few curves that still pass through it', () => {
    const arc = Array.from({ length: 80 }, (_, i) => ({ x: 80 - 80 * Math.cos((i / 79) * Math.PI), y: -80 * Math.sin((i / 79) * Math.PI) }));
    const sub = smoothStroke(arc);
    expect(sub.points.length).toBeLessThan(arc.length);
    expect(sub.points[1].in && sub.points[0].out).toBeTruthy();
    const flat = flatten(sub);
    expect(flat[0].x).toBe(0);
    expect(flat[flat.length - 1].x).toBeCloseTo(160, 5);
    // The curve stays on the arc between the points kept.
    for (const p of flat) expect(Math.abs(Math.hypot(p.x - 80, p.y) - 80)).toBeLessThan(1.6);
    // A box keeps its corners: its bounds stay those of the points drawn.
    const box = smoothStroke(rect(0, 0, 300, 200));
    expect(box.points.filter((q) => !q.in && !q.out).length).toBeGreaterThanOrEqual(3);
    // A tap is a dot.
    expect(smoothStroke([{ x: 3, y: 3 }]).points).toHaveLength(2);
  });

  it('outlines a sketch: what is inside what, top to bottom, pictures crossed out', () => {
    const items = [
      classifyStroke(rect(0, 0, 400, 600)),
      classifyStroke(wave(20, 20, 160)),
      classifyStroke(rect(20, 60, 360, 200)),
      classifyStroke(line({ x: 22, y: 62 }, { x: 378, y: 258 })),
      classifyStroke(line({ x: 378, y: 62 }, { x: 22, y: 258 })),
      classifyStroke(ellipse(50, 320, 24, 24)),
      classifyStroke(rect(20, 520, 360, 56)),
      classifyStroke(wave(140, 540, 120)),
    ];
    expect(sketchOutline(items)).toBe([
      'Sketch outline (402×602; positions from its top-left corner):',
      '- box 402×602 at (0, 0)',
      '  - scribbled text 160×12 at (21, 15)',
      '  - box 362×202, crossed out (a picture) at (20, 60)',
      '  - circle 50×49 at (27, 296)',
      '  - box 362×58 at (20, 520)',
      '    - scribbled text 120×12 at (141, 535)',
    ].join('\n'));
  });

  it('collects strokes in a sketch frame that grows to hold them', () => {
    const doc = new PenDoc({ version: '2.20', children: [{ type: 'frame', id: 'far', x: 2000, y: 0, width: 100, height: 100 }] } as unknown as PenDocument);
    const ed = new DocEditor(doc);
    const draw = (pts: Pt[]) => { ed.begin(); const id = addStroke(ed, doc, smoothStroke(pts), 2); ed.commit(); return id; };
    const a = draw(line({ x: 100, y: 100 }, { x: 300, y: 100 }));
    const frame = () => doc.get(a) as unknown as { x: number; y: number; width: number; height: number; children: { x: number; y: number; width: number }[] };
    expect(frame()).toMatchObject({ name: 'Sketch', x: 76, y: 75, width: 249, height: 50, metadata: { type: 'nib-sketch' } });
    expect(frame().children[0]).toMatchObject({ type: 'path', x: 24, metadata: { type: 'nib-sketch' }, strokeLinecap: 'round' });
    // Drawn above and to the left of it, close by: the same sketch, grown, the first stroke kept in place.
    expect(draw(line({ x: 50, y: 40 }, { x: 50, y: 160 }))).toBe(a);
    expect(frame()).toMatchObject({ x: 25, y: 17 });
    expect(frame().x + frame().children[0].x).toBeCloseTo(100, 0);
    expect(frame().children).toHaveLength(2);
    // Far away: a new sketch.
    expect(draw(line({ x: 900, y: 900 }, { x: 1000, y: 900 }))).not.toBe(a);
    expect(doc.data.children).toHaveLength(3);
    // Only props .pen knows (nib's own data goes in metadata).
    for (const n of doc.data.children) expect(validateNode(n)).toEqual([]);
  });
});
