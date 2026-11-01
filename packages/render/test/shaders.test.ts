import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildScene, PenDoc } from '@nib/core';
import type { PenDocument } from '@nib/format';
import { loadCanvasKit, Renderer, type FontLoader, type IconSource, type ImageLoader } from './helpers.ts';
import { parseShader } from '../src/index.ts';

const none: FontLoader & IconSource = { load: async () => undefined };

/** Shader files by url. */
const files = (map: Record<string, string>): ImageLoader => ({ load: async (url: string) => (url in map ? new TextEncoder().encode(map[url]) : undefined) });

async function render(children: unknown[], loader: ImageLoader, time = 0) {
  const ck = await loadCanvasKit();
  const doc = new PenDoc({ version: '2.20', children } as PenDocument);
  const r = new Renderer({ ck, fonts: none, icons: none });
  r.time = time;
  const scene = buildScene(doc, doc.data.children[0])!;
  const px = await r.renderPixels(scene, scene, loader);
  const at = (x: number, y: number) => [...px.rgba.slice((y * px.width + x) * 4, (y * px.width + x) * 4 + 4)];
  return { at, report: r.report(loader), animated: r.animated(scene, loader) };
}

const HALVES = `precision mediump float;
uniform vec2 u_resolution;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  gl_FragColor = uv.y < 0.5 ? vec4(1.0, 0.0, 0.0, 1.0) : vec4(0.0, 0.0, 1.0, 1.0);
}`;

describe('shaders', () => {
  it('reads uniforms and their roles from the comments', () => {
    const s = parseShader(`uniform float u_time;
uniform vec3 tint; // @input #FF8000 Warm tint
uniform float speed; // @input 1.5 0..4
uniform bool dots; // @input true
uniform sampler2D shape; // @sdf
// @margin 12
void main() { gl_FragColor = vec4(tint, dots ? 1.0 : 0.5); }`);
    expect(s.uniforms.map((u) => [u.name, u.type, u.role])).toEqual([['u_time', 'float', 'time'], ['tint', 'vec3', 'input'], ['speed', 'float', 'input'], ['dots', 'bool', 'input'], ['shape', 'sampler2D', 'sdf']]);
    expect(s.uniforms[1].input).toEqual({ kind: 'color', default: '#FF8000', label: 'Warm tint' });
    expect(s.uniforms[2].input).toEqual({ kind: 'number', default: 1.5, min: 0, max: 4, label: 'speed' });
    expect(s.uniforms[3].input).toEqual({ kind: 'boolean', default: true, label: 'dots' });
    expect(s.margin).toBe(12);
    expect(s.sksl).toContain('uniform shader shape;');
    expect(s.sksl).toContain('(dots > 0.5)');
    expect(() => parseShader('uniform mat3 m;\nvoid main() {}')).toThrow('not mat3');
    expect(() => parseShader('vec4 f() { return vec4(1.0); }')).toThrow('needs void main()');
  });

  it('fills a layer, with y up as in WebGL', async () => {
    const r = await render([{ type: 'rectangle', id: 'a', x: 0, y: 0, width: 40, height: 40, fill: { type: 'shader', url: 'halves.frag' } }], files({ 'halves.frag': HALVES }));
    // The bottom half is red, the top blue.
    expect(r.at(20, 35)).toEqual([255, 0, 0, 255]);
    expect(r.at(20, 5)).toEqual([0, 0, 255, 255]);
    expect(r.report.brokenShaders).toEqual([]);
    expect(r.animated).toEqual({ time: false, mouse: false });
  });

  it('takes inputs from the fill, defaults otherwise, and time', async () => {
    const src = `uniform vec3 tint; // @input #00FF00
uniform float u_time;
void main() { gl_FragColor = vec4(tint * min(1.0, u_time), 1.0); }`;
    const fill = (uniforms?: object) => [{ type: 'rectangle', id: 'a', x: 0, y: 0, width: 10, height: 10, fill: { type: 'shader', url: 's.frag', ...(uniforms ? { uniforms } : {}) } }];
    const loader = files({ 's.frag': src });
    expect((await render(fill(), loader, 1)).at(5, 5)).toEqual([0, 255, 0, 255]);
    expect((await render(fill({ tint: '#FF0000' }), loader, 1)).at(5, 5)).toEqual([255, 0, 0, 255]);
    const still = await render(fill(), loader, 0);
    expect(still.at(5, 5)).toEqual([0, 0, 0, 255]);
    expect(still.animated.time).toBe(true);
  });

  it('gives the outline as a distance field', async () => {
    const src = `uniform sampler2D shape; // @sdf
uniform vec2 u_resolution;
void main() {
  float d = texture2D(shape, gl_FragCoord.xy / u_resolution).r;
  gl_FragColor = d < 0.0 ? vec4(1.0, 1.0, 1.0, 1.0) : vec4(0.0, 0.0, 0.0, 1.0);
}`;
    const r = await render([{ type: 'ellipse', id: 'e', x: 0, y: 0, width: 40, height: 40, fill: { type: 'shader', url: 'sdf.frag' } }], files({ 'sdf.frag': src }));
    expect(r.at(20, 20)).toEqual([255, 255, 255, 255]);
    // Inside the bounding box but outside the circle the shader says outside; the ellipse clips it anyway.
    expect(r.at(2, 2)[3]).toBe(0);
  });

  it('changes a layer as drawn with an effect reading @source', async () => {
    const invert = `uniform sampler2D layer; // @source
uniform vec2 u_resolution;
void main() {
  vec4 c = texture2D(layer, gl_FragCoord.xy / u_resolution);
  gl_FragColor = vec4(1.0 - c.rgb, c.a);
}`;
    const r = await render([{ type: 'frame', id: 'f', x: 0, y: 0, width: 40, height: 20, layout: 'none', fill: '#00FF00', effect: { type: 'shader', url: 'invert.frag' }, children: [
      { type: 'rectangle', id: 'r', x: 20, y: 0, width: 20, height: 20, fill: '#0000FF' },
    ] }], files({ 'invert.frag': invert }));
    expect(r.at(5, 10)).toEqual([255, 0, 255, 255]);
    expect(r.at(30, 10)).toEqual([255, 255, 0, 255]);
  });

  it('keeps the layer in place when an effect draws outside it', async () => {
    const pass = `// @margin 10
uniform sampler2D layer; // @source
uniform vec2 u_resolution;
void main() { gl_FragColor = texture2D(layer, gl_FragCoord.xy / u_resolution); }`;
    const r = await render([{ type: 'frame', id: 'page', x: 0, y: 0, width: 60, height: 60, layout: 'none', fill: '#FFFFFF', children: [
      { type: 'rectangle', id: 'a', x: 20, y: 20, width: 20, height: 20, fill: '#FF0000', effect: { type: 'shader', url: 'pass.frag' } },
    ] }], files({ 'pass.frag': pass }));
    expect(r.at(21, 21)).toEqual([255, 0, 0, 255]);
    expect(r.at(39, 39)).toEqual([255, 0, 0, 255]);
    expect(r.at(42, 30)).toEqual([255, 255, 255, 255]);
    expect(r.at(18, 30)).toEqual([255, 255, 255, 255]);
  });

  it('reports shaders that do not compile, and draws nothing for them', async () => {
    const r = await render([{ type: 'rectangle', id: 'a', x: 0, y: 0, width: 10, height: 10, fill: [{ type: 'color', color: '#FFFFFF' }, { type: 'shader', url: 'bad.frag' }] }], files({ 'bad.frag': 'void main() { gl_FragColor = vec4(oops); }' }));
    expect(r.at(5, 5)).toEqual([255, 255, 255, 255]);
    expect(r.report.brokenShaders[0][0]).toBe('bad.frag');
    expect(r.report.brokenShaders[0][1]).toMatch(/oops/);
  });

  it('compiles every shader of the gallery, and each draws something', async () => {
    const dir = join(import.meta.dirname, '..', 'shaders');
    const names = readdirSync(dir).filter((f) => f.endsWith('.frag'));
    expect(names.length).toBeGreaterThanOrEqual(10);
    const map = Object.fromEntries(names.map((n) => [n, readFileSync(join(dir, n), 'utf8')]));
    for (const n of names) {
      const effect = /@source/.test(map[n]);
      const node = effect
        ? { type: 'frame', id: 'f', x: 0, y: 0, width: 60, height: 40, layout: 'none', fill: '#3355FF', effect: { type: 'shader', url: n }, children: [{ type: 'rectangle', id: 'r', x: 10, y: 10, width: 20, height: 20, fill: '#FFFFFF' }] }
        : { type: 'rectangle', id: 'a', x: 0, y: 0, width: 60, height: 40, fill: { type: 'shader', url: n } };
      const r = await render([node], files(map), 1.5);
      expect(r.report.brokenShaders, n).toEqual([]);
      expect(r.at(30, 20)[3], n).toBeGreaterThan(0);
    }
  });
});
