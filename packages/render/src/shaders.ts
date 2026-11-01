import type { CanvasKit, RuntimeEffect, Shader } from 'canvaskit-wasm';
import { parseColor } from './color.ts';
import type { ImageLoader } from './images.ts';

/**
 * Shader fills and effects. A shader is a GLSL ES 1.0 fragment shader (as for WebGL 1): it reads
 * `gl_FragCoord` (pixels, origin at the bottom left) and writes `gl_FragColor` (straight alpha). Comments on a
 * uniform's line give it its value:
 *
 *   uniform vec2 u_resolution;   // @resolution   the layer's size in pixels
 *   uniform float u_time;        // @time         seconds since the canvas opened (0 in exports)
 *   uniform vec2 u_mouse;        // @mouse        the pointer over the layer, in pixels (its center otherwise)
 *   uniform sampler2D u_shape;   // @sdf          the layer's outline: .r is the distance to it in pixels, negative inside
 *   uniform sampler2D u_layer;   // @source       effects only: the layer as drawn, to change
 *   uniform float u_speed;       // @input 1 0..4 Speed      a control, stored in the fill's uniforms
 *   uniform vec3 u_tint;         // @input #FF6B3D Tint
 *   uniform bool u_dots;         // @input true Dots
 *
 * Uniforms named u_resolution / iResolution, u_time / iTime and u_mouse / iMouse need no comment. A line
 * `// @margin 24` lets an effect draw that far outside the layer (a glow). nib draws shaders with Skia, so they
 * are translated to SkSL: textures are sampled with texture2D(sampler, uv), uv from 0 to 1 bottom-up.
 */

/** nib's own shaders, to copy into a document's shaders folder (a file: URL; read it from Node only). */
export const SHADER_GALLERY = new URL('../shaders/', import.meta.url);

export type UniformType = 'float' | 'vec2' | 'vec3' | 'vec4' | 'int' | 'bool' | 'sampler2D';
export type UniformRole = 'resolution' | 'time' | 'mouse' | 'sdf' | 'source' | 'input' | 'none';

export interface ShaderInput {
  kind: 'number' | 'color' | 'boolean' | 'vector';
  default: number | boolean | string | number[];
  min?: number;
  max?: number;
  label: string;
}

export interface ShaderUniform { name: string; type: UniformType; role: UniformRole; input?: ShaderInput }

export interface ParsedShader { uniforms: ShaderUniform[]; sksl: string; margin: number }

const SIZES: Record<UniformType, number> = { float: 1, vec2: 2, vec3: 3, vec4: 4, int: 1, bool: 1, sampler2D: 0 };
const BY_NAME: Record<string, UniformRole> = { u_resolution: 'resolution', iResolution: 'resolution', u_time: 'time', iTime: 'time', u_mouse: 'mouse', iMouse: 'mouse' };

/** What a `// @input …` comment says: a default, a range, a label. */
function parseInput(type: UniformType, name: string, rest: string): ShaderInput {
  const words = rest.trim().split(/\s+/).filter(Boolean);
  const label = (s: string[]) => s.join(' ') || name.replace(/^(u_|i)/, '').replace(/_/g, ' ');
  if (type === 'bool') {
    const d = words[0] === 'true' || words[0] === 'false' ? words.shift() === 'true' : false;
    return { kind: 'boolean', default: d, label: label(words) };
  }
  if ((type === 'vec3' || type === 'vec4') && words[0]?.startsWith('#')) {
    return { kind: 'color', default: words.shift()!, label: label(words) };
  }
  if (type === 'float' || type === 'int') {
    const d = words[0] !== undefined && Number.isFinite(Number(words[0])) ? Number(words.shift()) : 0;
    const range = words[0] && /^(-?[\d.]+)\.\.(-?[\d.]+)$/.exec(words[0]);
    if (range) words.shift();
    return { kind: 'number', default: d, ...(range ? { min: Number(range[1]), max: Number(range[2]) } : {}), label: label(words) };
  }
  const n = SIZES[type];
  const nums: number[] = [];
  while (nums.length < n && words[0] !== undefined && Number.isFinite(Number(words[0]))) nums.push(Number(words.shift()));
  return { kind: 'vector', default: nums.length === n ? nums : new Array(n).fill(0), label: label(words) };
}

/** `texture2D(s, uv)` → `s.eval(...)`, reading the arguments with nested parentheses. */
function replaceTexture(src: string, samplers: Set<string>): string {
  let out = '', i = 0;
  const re = /\btexture2D\s*\(/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 1, j = m.index + m[0].length, comma = -1;
    for (; j < src.length && depth; j++) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')') depth--;
      else if (src[j] === ',' && depth === 1 && comma < 0) comma = j;
    }
    const name = src.slice(m.index + m[0].length, comma).trim();
    const uv = src.slice(comma + 1, j - 1).trim();
    if (comma < 0 || !samplers.has(name)) continue;
    out += src.slice(i, m.index) + `${name}.eval(vec2((${uv}).x, 1.0 - (${uv}).y) * nib_res)`;
    i = j;
    re.lastIndex = j;
  }
  return out + src.slice(i);
}

/** Read a GLSL fragment shader's uniforms and translate it to SkSL. Throws with what is wrong. */
export function parseShader(glsl: string): ParsedShader {
  const uniforms: ShaderUniform[] = [];
  let margin = 0;
  const marginMatch = /\/\/\s*@margin\s+(\d+(?:\.\d+)?)/.exec(glsl);
  if (marginMatch) margin = Math.min(400, Number(marginMatch[1]));
  // Declarations nib makes itself go; uniforms are declared again in SkSL's own words.
  let body = glsl
    .replace(/#ifdef\s+GL_ES[\s\S]*?#endif/g, '')
    .replace(/^\s*#version.*$/gm, '')
    .replace(/^\s*precision\s+\w+\s+\w+\s*;/gm, '')
    .replace(/^\s*uniform\s+(\w+)\s+(\w+)\s*;[ \t]*(\/\/[^\n]*)?$/gm, (_all, type: string, name: string, comment?: string) => {
      if (!(type in SIZES)) throw new Error(`uniform ${name}: nib's shaders take float, int, bool, vec2, vec3, vec4 and sampler2D uniforms, not ${type}`);
      const t = type as UniformType;
      const tag = comment && /@(\w+)\s*(.*)$/.exec(comment);
      let role: UniformRole = tag ? (tag[1] as UniformRole) : BY_NAME[name] ?? 'none';
      if (!['resolution', 'time', 'mouse', 'sdf', 'source', 'input', 'none'].includes(role)) role = 'none';
      if ((role === 'sdf' || role === 'source') && t !== 'sampler2D') throw new Error(`uniform ${name}: @${role} is a sampler2D`);
      uniforms.push({ name, type: t, role, ...(role === 'input' ? { input: parseInput(t, name, tag ? tag[2] : '') } : {}) });
      return '';
    });
  if (!/\bvoid\s+main\s*\(\s*(void)?\s*\)/.test(body)) throw new Error('a shader needs void main() { … gl_FragColor = …; }');
  const samplers = new Set(uniforms.filter((u) => u.type === 'sampler2D').map((u) => u.name));
  body = replaceTexture(body, samplers)
    .replace(/\bvoid\s+main\s*\(\s*(void)?\s*\)/, 'void nib_main(vec4 nib_fragCoord, inout vec4 nib_fragColor)')
    .replace(/\bgl_FragCoord\b/g, 'nib_fragCoord')
    .replace(/\bgl_FragColor\b/g, 'nib_fragColor');
  // iResolution in shadertoy is a vec3.
  // Uniforms reach Skia as floats: ints and bools are declared as floats and read back as what they were.
  const decl = uniforms.map((u) => (u.type === 'sampler2D' ? `uniform shader ${u.name};` : `uniform ${u.type === 'bool' || u.type === 'int' ? 'float' : u.type} ${u.name};`)).join('\n');
  for (const u of uniforms) {
    if (u.type === 'bool') body = body.replace(new RegExp(`\\b${u.name}\\b`, 'g'), `(${u.name} > 0.5)`);
    if (u.type === 'int') body = body.replace(new RegExp(`\\b${u.name}\\b`, 'g'), `int(${u.name})`);
  }
  const sksl = `uniform float2 nib_res;\n${decl}\n${body}\nhalf4 main(float2 nib_p) {\n  vec4 nib_c = vec4(0.0);\n  nib_main(vec4(nib_p.x, nib_res.y - nib_p.y, 0.0, 1.0), nib_c);\n  nib_c = clamp(nib_c, 0.0, 1.0);\n  return half4(nib_c.rgb * nib_c.a, nib_c.a);\n}\n`;
  return { uniforms, sksl, margin };
}

/** The signed distance to a rounded rectangle or an ellipse filling the box, in .r (pixels, negative inside). */
const SDF_SKSL = `uniform float2 size; uniform float4 radii; uniform float ellipse;
half4 main(float2 p) {
  float2 c = p - size * 0.5;
  float d;
  if (ellipse > 0.5) {
    float2 r = size * 0.5;
    float k = length(c / r);
    d = (k - 1.0) * min(r.x, r.y);
  } else {
    float r = c.x < 0.0 ? (c.y < 0.0 ? radii.x : radii.w) : (c.y < 0.0 ? radii.y : radii.z);
    float2 q = abs(c) - size * 0.5 + r;
    d = min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
  }
  return half4(d, 0.0, 0.0, 1.0);
}`;

export interface CompiledShader { effect: RuntimeEffect; parsed: ParsedShader }

/** Shaders by url (relative to a document), loaded with its ImageLoader, translated and compiled once. */
export class ShaderStore {
  private ck: CanvasKit;
  private loader: ImageLoader;
  private loading = new Map<string, Promise<void>>();
  private ready = new Map<string, CompiledShader>();
  private failed = new Map<string, string>();
  private sdf: RuntimeEffect | null | undefined;

  constructor(ck: CanvasKit, loader: ImageLoader) {
    this.ck = ck;
    this.loader = loader;
  }

  async ensure(urls: Iterable<string>): Promise<void> {
    const work: Promise<void>[] = [];
    for (const url of urls) {
      let p = this.loading.get(url);
      if (!p) {
        p = this.loader.load(url).then(
          (bytes) => {
            if (!bytes) { this.failed.set(url, 'not found'); return; }
            try {
              const parsed = parseShader(new TextDecoder().decode(bytes));
              let error = '';
              const effect = this.ck.RuntimeEffect.Make(parsed.sksl, (e) => { error = e; });
              if (!effect) throw new Error(error.trim() || 'it does not compile');
              this.ready.set(url, { effect, parsed });
            } catch (e) {
              this.failed.set(url, (e as Error).message);
            }
          },
          (e: Error) => { this.failed.set(url, e.message); },
        );
        this.loading.set(url, p);
      }
      work.push(p);
    }
    await Promise.all(work);
  }

  get(url: string): CompiledShader | undefined {
    return this.ready.get(url);
  }

  /** Drop `url` so the next `ensure` loads it again (the file changed). */
  forget(url: string): void {
    this.ready.get(url)?.effect.delete();
    this.ready.delete(url);
    this.loading.delete(url);
    this.failed.delete(url);
  }

  failures(): [string, string][] {
    return [...this.failed];
  }

  /** The outline's distance field for @sdf uniforms. */
  sdfShader(width: number, height: number, radii: [number, number, number, number], ellipse: boolean): Shader | undefined {
    if (this.sdf === undefined) this.sdf = this.ck.RuntimeEffect.Make(SDF_SKSL);
    return this.sdf?.makeShader([width, height, ...radii, ellipse ? 1 : 0]);
  }
}

/** What a shader is drawn with besides its inputs: the layer's size, the time, the pointer, its outline, its content. */
export interface ShaderFrame {
  width: number;
  height: number;
  time: number;
  /** The pointer in the layer's own pixels, y down; undefined: not over it. */
  mouse?: { x: number; y: number };
  sdf: () => Shader | undefined;
  source?: () => Shader | undefined;
}

/** The value of an input as floats: a stored uniform, else its default. */
function inputFloats(u: ShaderUniform, stored: unknown): number[] {
  const n = SIZES[u.type];
  const v = stored ?? u.input?.default;
  if (u.type === 'bool') return [v === true || v === 1 ? 1 : 0];
  if (typeof v === 'number') return [v];
  if (typeof v === 'string') {
    const c = parseColor(v);
    return c ? (n === 3 ? [c[0], c[1], c[2]] : [...c]) : new Array(n).fill(0);
  }
  if (Array.isArray(v)) return Array.from({ length: n }, (_, i) => Number(v[i]) || 0);
  return new Array(n).fill(0);
}

/** A Skia shader for a compiled shader in `frame`, with `values` for its inputs. The caller deletes it. */
export function makeShader(ck: CanvasKit, compiled: CompiledShader, values: Record<string, unknown> | undefined, frame: ShaderFrame): Shader | undefined {
  const { effect, parsed } = compiled;
  const byName = new Map(parsed.uniforms.map((u) => [u.name, u]));
  const floats: number[] = [];
  for (let i = 0; i < effect.getUniformCount(); i++) {
    const name = effect.getUniformName(i);
    const info = effect.getUniform(i);
    const count = info.columns * info.rows;
    let v: number[];
    if (name === 'nib_res') v = [frame.width, frame.height];
    else {
      const u = byName.get(name);
      const mouse = frame.mouse ? [frame.mouse.x, frame.height - frame.mouse.y] : [frame.width / 2, frame.height / 2];
      switch (u?.role) {
        case 'resolution': v = [frame.width, frame.height, 1]; break;
        case 'time': v = [frame.time]; break;
        case 'mouse': v = [...mouse, 0, 0]; break;
        case 'input': v = inputFloats(u, values?.[name]); break;
        default: v = u ? inputFloats(u, values?.[name]) : [];
      }
    }
    for (let k = 0; k < count; k++) floats.push(v[k] ?? 0);
  }
  // Samplers nib has nothing for read as transparent.
  const children = parsed.uniforms.filter((x) => x.type === 'sampler2D').map((u) => (u.role === 'sdf' ? frame.sdf() : u.role === 'source' ? frame.source?.() : undefined) ?? ck.Shader.MakeColor(ck.TRANSPARENT, ck.ColorSpace.SRGB));
  try {
    return children.length ? effect.makeShaderWithChildren(floats, children) : effect.makeShader(floats);
  } finally {
    for (const c of children) c.delete();
  }
}
