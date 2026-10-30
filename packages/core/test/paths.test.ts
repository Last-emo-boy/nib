import { describe, expect, it } from 'vitest';
import { formatPath, parsePath, pathBounds, pathInBox, pathNodeProps, svgToNodes, parseTransform } from '../src/index.ts';

describe('paths', () => {
  it('reads every command and writes M, L, C and Z', () => {
    expect(formatPath(parsePath('M10 10 h 20 v20 H10 z'))).toBe('M10 10L30 10L30 30L10 30Z');
    // A relative curve, a smooth one continuing it, and a quadratic one as a cubic.
    expect(formatPath(parsePath('m0 0 c10 0 20 10 20 20 s-10 20-20 20'))).toBe('M0 0C10 0 20 10 20 20C20 30 10 40 0 40');
    expect(formatPath(parsePath('M0 0Q10 10 20 0'))).toBe('M0 0C6.67 6.67 13.33 6.67 20 0');
    // Numbers that run together, and implicit linetos after a moveto.
    expect(formatPath(parsePath('M0-1.5.5.5 2 2'))).toBe('M0 -1.5L0.5 0.5L2 2');
  });

  it('keeps a closing curve on the first point instead of a duplicate point', () => {
    const [sub] = parsePath('M0 0C10 0 10 10 0 10C-10 10 -10 0 0 0Z');
    expect(sub.closed).toBe(true);
    expect(sub.points).toHaveLength(2);
    expect(sub.points[0].in).toEqual({ x: -10, y: 0 });
    expect(formatPath([sub])).toBe('M0 0C10 0 10 10 0 10C-10 10 -10 0 0 0Z');
  });

  it('turns arcs into curves through the right points', () => {
    const subs = parsePath('M0 50A50 50 0 0 1 100 50');
    const b = pathBounds(subs)!;
    expect(b.x).toBeCloseTo(0, 3);
    expect(b.width).toBeCloseTo(100, 3);
    expect(b.y).toBeCloseTo(0, 1);
    expect(b.height).toBeCloseTo(50, 1);
  });

  it('measures curves by their extremes, not their handles', () => {
    const b = pathBounds(parsePath('M0 0C0 -40 100 -40 100 0'))!;
    expect(b.y).toBeCloseTo(-30, 5);
    expect(b.height).toBeCloseTo(30, 5);
  });

  it('puts a path into a node box and back', () => {
    const props = pathNodeProps(parsePath('M110 220L150 220L130 260Z'))!;
    expect(props).toMatchObject({ x: 110, y: 220, width: 40, height: 40, geometry: 'M0 0L40 0L20 40Z', viewBox: [0, 0, 40, 40] });
    // Drawn at twice the size, a node's geometry scales with its box.
    expect(formatPath(pathInBox(props.geometry, 80, 80, props.viewBox))).toBe('M0 0L80 0L40 80Z');
    expect(formatPath(pathInBox('M10 10L20 10L20 20', 20, 20))).toBe('M0 0L20 0L20 20');
  });

  it('reads transform lists', () => {
    expect(parseTransform('translate(10 20) scale(2)')).toEqual([2, 0, 0, 2, 10, 20]);
    const r = parseTransform('rotate(90 10 10)');
    expect(r.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 1, -1, 0, 20, 0]);
  });
});

describe('svg import', () => {
  let n = 0;
  const id = () => `n${++n}`;

  it('brings in shapes with their styles, transforms and the viewBox', () => {
    const svg = `<?xml version="1.0"?><!-- a logo -->
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24">
        <title>Logo</title>
        <style>.accent { fill: #0CA678 }</style>
        <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="100%" stop-color="#000" stop-opacity=".5"/></linearGradient></defs>
        <g fill="none" stroke="currentColor" stroke-width="2" color="#111">
          <rect x="2" y="2" width="20" height="20" rx="4"/>
          <path d="M8 12h8"/>
        </g>
        <circle class="accent" cx="12" cy="12" r="3" transform="translate(1 0)"/>
        <ellipse cx="12" cy="20" rx="4" ry="2" fill="url(#g)" opacity="0.5"/>
        <text x="0" y="10">hi</text>
      </svg>`;
    const { node, skipped } = svgToNodes(svg, id);
    expect(node).toMatchObject({ type: 'frame', name: 'Logo', width: 48, height: 48, layout: 'none' });
    const [rect, line, circle, ellipse] = node.children as Record<string, any>[];
    expect(rect).toMatchObject({ type: 'path', x: 4, y: 4, width: 40, height: 40, stroke: '#111111', strokeWidth: 4, strokeAlignment: 'center' });
    expect(rect.fill).toBeUndefined();
    expect(line).toMatchObject({ x: 16, y: 24, width: 16, stroke: '#111111' });
    expect(circle).toMatchObject({ fill: '#0CA678', x: 20, y: 18, width: 12, height: 12 });
    expect(circle.stroke).toBeUndefined();
    expect(ellipse.opacity).toBe(0.5);
    expect(ellipse.fill).toMatchObject({ type: 'gradient', gradientType: 'linear', rotation: 180, colors: [{ color: '#FFFFFF', position: 0 }, { color: '#00000080', position: 1 }] });
    expect(skipped).toEqual({ text: 1 });
  });

  it('follows <use> and evenodd fills, and rejects what is not SVG', () => {
    const { node } = svgToNodes('<svg viewBox="0 0 10 10"><defs><path id="p" d="M0 0H4V4H0Z" fill-rule="evenodd"/></defs><use href="#p" x="5" y="5"/></svg>', id);
    expect((node.children as Record<string, unknown>[])[0]).toMatchObject({ x: 5, y: 5, fillRule: 'evenodd', fill: '#000000' });
    expect(() => svgToNodes('<html></html>', id)).toThrow(/not an SVG/);
  });
});
