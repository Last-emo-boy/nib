import { describe, expect, it } from 'vitest';
import { buildScene, PenDoc } from '@nib/core';
import type { PenDocument } from '@nib/format';
import { loadCanvasKit, nearestWeightsForTest, parseColor, parseSvgIcon, Renderer, type FontLoader, type IconSource, type ImageLoader } from './helpers.ts';

describe('colors', () => {
  it('parses short and long hex with alpha', () => {
    expect(parseColor('#f00')).toEqual([1, 0, 0, 1]);
    expect(parseColor('#00ff0080')?.[3]).toBeCloseTo(128 / 255);
    expect(parseColor('$var')).toBeUndefined();
    expect(parseColor('#12345')).toBeUndefined();
  });
});

describe('icons', () => {
  it('turns svg shapes into path data with stroke settings', () => {
    const g = parseSvgIcon('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/><rect x="2" y="3" width="4" height="4" rx="1"/></svg>')!;
    expect(g.viewBox).toEqual([0, 0, 24, 24]);
    expect(g.shapes.map((s) => [s.stroke, s.fill])).toEqual([[true, false], [true, false], [true, false]]);
    expect(g.shapes[0].d).toMatch(/^M2 12A10 10/);
    expect(g.linecap).toBe('round');
  });
});

describe('font weights', () => {
  it('follows CSS fallback order', () => {
    expect(nearestWeightsForTest(400).slice(0, 3)).toEqual([400, 500, 300]);
    expect(nearestWeightsForTest(700).slice(0, 3)).toEqual([700, 800, 900]);
    expect(nearestWeightsForTest(300).slice(0, 3)).toEqual([300, 200, 100]);
  });
});

/** No fonts, icons or images: enough to check geometry and paint without network access. */
const none: FontLoader & IconSource & ImageLoader = { load: async () => undefined };

async function render(children: unknown[], scale = 1) {
  const ck = await loadCanvasKit();
  const doc = new PenDoc({ version: '2.20', children } as PenDocument);
  const r = new Renderer({ ck, fonts: none, icons: none });
  const png = await r.renderPNG(buildScene(doc, doc.data.children[0])!, none, { scale });
  const img = ck.MakeImageFromEncoded(png)!;
  const px = img.readPixels(0, 0, { width: img.width(), height: img.height(), colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
  const at = (x: number, y: number) => [...px.slice((y * img.width() + x) * 4, (y * img.width() + x) * 4 + 4)];
  return { w: img.width(), h: img.height(), at };
}

describe('renderer', () => {
  it('lays out and paints a frame with children', async () => {
    const r = await render([{ type: 'frame', id: 'f', x: 50, y: 50, padding: 10, gap: 10, fill: '#ffffff', children: [
      { type: 'rectangle', id: 'a', width: 20, height: 20, fill: '#ff0000' },
      { type: 'rectangle', id: 'b', width: 20, height: 20, fill: '#0000ff', cornerRadius: 10 },
    ] }]);
    expect([r.w, r.h]).toEqual([70, 40]);
    expect(r.at(20, 20)).toEqual([255, 0, 0, 255]);
    expect(r.at(50, 20)).toEqual([0, 0, 255, 255]);
    expect(r.at(41, 11)).toEqual([255, 255, 255, 255]);
    expect(r.at(65, 5)).toEqual([255, 255, 255, 255]);
  });

  it('draws inner strokes inside the box and per-side widths', async () => {
    const r = await render([{ type: 'frame', id: 'f', width: 40, height: 40, fill: '#ffffff', stroke: '#000000', strokeWidth: { left: 4 } }]);
    expect(r.at(1, 20)).toEqual([0, 0, 0, 255]);
    expect(r.at(5, 20)).toEqual([255, 255, 255, 255]);
    expect(r.at(20, 0)).toEqual([255, 255, 255, 255]);
  });

  it('clips children when clip is set', async () => {
    const r = await render([{ type: 'frame', id: 'f', width: 40, height: 40, layout: 'none', clip: true, fill: '#ffffff', children: [
      { type: 'frame', id: 'g', x: 30, y: 30, layout: 'none', children: [{ type: 'rectangle', id: 'r', width: 30, height: 30, fill: '#00ff00' }] },
    ] }], 2);
    expect([r.w, r.h]).toEqual([80, 80]);
    expect(r.at(70, 70)).toEqual([0, 255, 0, 255]);
  });

  it('paints a linear gradient from bottom to top at rotation 0', async () => {
    const r = await render([{ type: 'rectangle', id: 'g', width: 10, height: 100, fill: { type: 'gradient', colors: [{ color: '#000000', position: 0 }, { color: '#ffffff', position: 1 }] } }]);
    expect(r.at(5, 99)[0]).toBeLessThan(10);
    expect(r.at(5, 0)[0]).toBeGreaterThan(245);
  });
});
