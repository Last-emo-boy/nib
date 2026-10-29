import type { NodeType } from './types.ts';

export interface Issue {
  level: 'error' | 'warning';
  /** Node id (or `#index` when the node has no id) followed by the property, e.g. `Xk9f2.fill[1]`. */
  path: string;
  message: string;
}

type Check = (v: unknown) => string | undefined;

const isVar = (v: unknown): v is string => typeof v === 'string' && v.startsWith('$') && v.length > 1;
const COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const SIZE_RE = /^(?:fit_content|fill_container)(?:\(\s*-?\d+(?:\.\d+)?\s*\))?$/;

const num: Check = (v) => (typeof v === 'number' && Number.isFinite(v)) || isVar(v) ? undefined : 'expected a number or $variable';
const rawNum: Check = (v) => typeof v === 'number' && Number.isFinite(v) ? undefined : 'expected a number';
const bool: Check = (v) => typeof v === 'boolean' || isVar(v) ? undefined : 'expected a boolean or $variable';
const rawBool: Check = (v) => typeof v === 'boolean' ? undefined : 'expected a boolean';
const str: Check = (v) => typeof v === 'string' ? undefined : 'expected a string';
const color: Check = (v) => typeof v === 'string' && (COLOR_RE.test(v) || isVar(v)) ? undefined : 'expected a hex color (#RGB, #RRGGBB, #RRGGBBAA) or $variable';
const any: Check = () => undefined;

const oneOf = (...values: string[]): Check => (v) =>
  typeof v === 'string' && values.includes(v) ? undefined : `expected one of ${values.map((x) => JSON.stringify(x)).join(', ')}`;

const size: Check = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? undefined : 'expected a finite number';
  if (typeof v === 'string' && (SIZE_RE.test(v) || isVar(v))) return undefined;
  if (typeof v === 'string' && /%|vh|vw|calc\(/.test(v)) return 'percentage, viewport and calc() sizes are not supported; use a number, fit_content or fill_container';
  return 'expected a number, $variable, fit_content or fill_container (optionally with a "(fallback)")';
};

const tuple = (n: number, item: Check): Check => (v) => {
  if (!Array.isArray(v) || v.length !== n) return `expected an array of ${n}`;
  for (const x of v) { const e = item(x); if (e) return e; }
  return undefined;
};

const numOrTuple4: Check = (v) => Array.isArray(v) ? tuple(4, num)(v) : num(v);
const padding: Check = (v) => !Array.isArray(v) ? num(v) : v.length === 2 ? tuple(2, num)(v) : tuple(4, num)(v);

const strokeWidth: Check = (v) => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return num(v);
  for (const [k, x] of Object.entries(v)) {
    if (!['top', 'right', 'bottom', 'left'].includes(k)) return `unknown side "${k}"`;
    const e = num(x); if (e) return `${k}: ${e}`;
  }
  return undefined;
};

const record = (item: Check): Check => (v) => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'expected an object';
  for (const [k, x] of Object.entries(v)) { const e = item(x); if (e) return `${k}: ${e}`; }
  return undefined;
};

const BLEND = ['normal', 'darken', 'multiply', 'linearBurn', 'colorBurn', 'light', 'screen', 'linearDodge', 'colorDodge', 'overlay', 'softLight', 'hardLight', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];

type Shape = Record<string, Check>;

function shape(spec: Shape, label: string): Check {
  return (v) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return `expected a ${label} object`;
    for (const [k, x] of Object.entries(v)) {
      const c = spec[k];
      if (!c) return `${label} has no property "${k}"`;
      const e = c(x); if (e) return `${k}: ${e}`;
    }
    return undefined;
  };
}

const point2 = tuple(2, rawNum);
const fillBase: Shape = { type: any, enabled: bool, blendMode: oneOf(...BLEND) };
const FILL_SHAPES: Record<string, Check> = {
  color: shape({ ...fillBase, color }, 'color fill'),
  gradient: shape({
    ...fillBase,
    gradientType: oneOf('linear', 'radial', 'angular'),
    opacity: num,
    center: shape({ x: rawNum, y: rawNum }, 'center'),
    size: shape({ width: num, height: num }, 'size'),
    rotation: num,
    colors: (v) => Array.isArray(v) ? v.map(shape({ color, position: num }, 'gradient stop')).find(Boolean) : 'expected an array of stops',
  }, 'gradient fill'),
  image: shape({ ...fillBase, opacity: num, url: str, mode: oneOf('cover', 'contain', 'stretch', 'fill', 'fit'), transform: tuple(6, rawNum) }, 'image fill'),
  shader: shape({ ...fillBase, opacity: num, url: str, uniforms: record(any) }, 'shader fill'),
  mesh_gradient: shape({
    ...fillBase,
    opacity: num,
    columns: rawNum,
    rows: rawNum,
    colors: (v) => Array.isArray(v) ? v.map(color).find(Boolean) : 'expected an array of colors',
    points: (v) => Array.isArray(v)
      ? v.map((p) => Array.isArray(p) ? point2(p) : shape({ position: point2, leftHandle: point2, rightHandle: point2, topHandle: point2, bottomHandle: point2 }, 'mesh point')(p)).find(Boolean)
      : 'expected an array of points',
  }, 'mesh gradient fill'),
};

const oneFill: Check = (v) => {
  if (typeof v === 'string') return color(v);
  if (typeof v !== 'object' || v === null) return 'expected a color, $variable or fill object';
  const t = (v as { type?: unknown }).type;
  const c = typeof t === 'string' ? FILL_SHAPES[t] : undefined;
  return c ? c(v) : `unknown fill type ${JSON.stringify(t)}`;
};
const fills: Check = (v) => Array.isArray(v) ? v.map(oneFill).map((e, i) => e && `[${i}] ${e}`).find(Boolean) : oneFill(v);

const EFFECT_SHAPES: Record<string, Check> = {
  blur: shape({ type: any, enabled: bool, radius: num }, 'blur effect'),
  background_blur: shape({ type: any, enabled: bool, radius: num }, 'background blur effect'),
  shadow: shape({
    type: any, enabled: bool, shadowType: oneOf('inner', 'outer'), offset: shape({ x: num, y: num }, 'offset'),
    blur: num, spread: num, color, blendMode: oneOf(...BLEND),
  }, 'shadow effect'),
  shader: shape({ type: any, enabled: bool, url: str, uniforms: record(any) }, 'shader effect'),
};
const oneEffect: Check = (v) => {
  const t = (v as { type?: unknown } | null)?.type;
  const c = typeof t === 'string' ? EFFECT_SHAPES[t] : undefined;
  return c ? c(v) : `unknown effect type ${JSON.stringify(t)}`;
};
const effects: Check = (v) => Array.isArray(v) ? v.map(oneEffect).map((e, i) => e && `[${i}] ${e}`).find(Boolean) : oneEffect(v);

const entity: Shape = {
  type: any, id: str, name: str, context: str, reusable: rawBool, theme: record(str), enabled: bool, opacity: num,
  flipX: bool, flipY: bool, layoutPosition: oneOf('auto', 'absolute'),
  metadata: (v) => typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string' ? undefined : 'expected an object with a string "type"',
  rotation: num, x: rawNum, y: rawNum,
};
const sizeProps: Shape = { width: size, height: size };
const strokeProps: Shape = {
  stroke: fills, strokeWidth, strokeLinecap: oneOf('butt', 'round', 'square'),
  strokeLinejoin: oneOf('miter', 'bevel', 'round'), strokeAlignment: oneOf('inner', 'center', 'outer'),
};
const graphics: Shape = { ...strokeProps, fill: fills, effect: effects };
const textStyle: Shape = {
  fontFamily: str, fontSize: num, fontWeight: str, letterSpacing: num, fontStyle: str, underline: bool, lineHeight: num,
  textAlign: oneOf('left', 'center', 'right', 'justify'), textAlignVertical: oneOf('top', 'middle', 'bottom'),
  strikethrough: bool, href: str,
};
const children: Check = (v) => Array.isArray(v) ? undefined : 'expected an array of nodes';

export const NODE_SPECS: Record<NodeType, Shape> = {
  frame: {
    ...entity, ...sizeProps, ...graphics, cornerRadius: numOrTuple4, children,
    layout: oneOf('none', 'vertical', 'horizontal'), gap: num, layoutIncludeStroke: rawBool, padding,
    justifyContent: oneOf('start', 'center', 'end', 'space_between', 'space_around'), alignItems: oneOf('start', 'center', 'end'),
    clip: bool, placeholder: rawBool,
    slot: (v) => v === false || (Array.isArray(v) && v.every((x) => typeof x === 'string')) ? undefined : 'expected false or an array of component ids',
  },
  group: { ...entity, effect: effects, children },
  rectangle: { ...entity, ...sizeProps, ...graphics, cornerRadius: numOrTuple4 },
  ellipse: { ...entity, ...sizeProps, ...graphics, innerRadius: num, startAngle: num, sweepAngle: num },
  polygon: { ...entity, ...sizeProps, ...graphics, polygonCount: num, cornerRadius: num },
  path: { ...entity, ...sizeProps, ...graphics, fillRule: oneOf('nonzero', 'evenodd'), geometry: str, viewBox: tuple(4, rawNum) },
  text: { ...entity, ...sizeProps, ...graphics, ...textStyle, content: str, textGrowth: oneOf('auto', 'fixed-width', 'fixed-width-height') },
  note: { ...entity, ...sizeProps, ...textStyle, content: str },
  context: { ...entity, ...sizeProps, ...textStyle, content: str },
  prompt: { ...entity, ...sizeProps, ...textStyle, content: str, model: str },
  icon: { ...entity, ...sizeProps, library: str, icon: str, weight: num, fill: fills, effect: effects },
  script: { ...entity, ...sizeProps, clip: bool, scriptUri: str, inputs: record(any) },
  browser: { ...entity, ...sizeProps, ...strokeProps, effect: effects, url: str, deviceId: str, zoom: rawNum, scrollX: rawNum, scrollY: rawNum, cornerRadius: numOrTuple4 },
  ref: { ...entity, ref: str, descendants: record((v) => typeof v === 'object' && v !== null && !Array.isArray(v) ? undefined : 'expected an object') },
};

/** Properties pen.dev rejects outright, with the hint it gives. */
const REJECTED: Record<string, string> = {
  margin: 'margin is not supported; wrap the node in a frame with padding',
};

export interface ValidateOptions {
  /** Treat properties outside the schema as errors (true for `execute` input, false when loading files). */
  strict?: boolean;
  /** Validate the children too. Default true. */
  deep?: boolean;
}

/**
 * Check one node (and by default its subtree) against the schema.
 * `ref` nodes are checked only for their own instance properties; overrides of the component root are
 * accepted here and checked by the document model, which knows the component's type.
 */
export function validateNode(node: unknown, opts: ValidateOptions = {}, out: Issue[] = []): Issue[] {
  const strict = opts.strict ?? false;
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    out.push({ level: 'error', path: '', message: 'expected a node object' });
    return out;
  }
  const n = node as Record<string, unknown>;
  const where = typeof n.id === 'string' ? n.id : typeof n.name === 'string' ? `"${n.name}"` : '(new node)';
  const t = n.type;
  const spec = typeof t === 'string' ? NODE_SPECS[t as NodeType] : undefined;
  if (!spec) {
    out.push({ level: 'error', path: `${where}.type`, message: `unknown node type ${JSON.stringify(t)}${t === 'image' ? '; images are image fills on a frame or rectangle' : ''}` });
    return out;
  }
  for (const [k, v] of Object.entries(n)) {
    const check = spec[k];
    if (!check) {
      if (t === 'ref') continue;
      const hint = REJECTED[k] ?? (k === 'children' ? `only frame and group nodes can have children` : `"${k}" is not a property of ${t} nodes`);
      out.push({ level: strict || k in REJECTED || k === 'children' ? 'error' : 'warning', path: `${where}.${k}`, message: hint });
      continue;
    }
    const e = check(v);
    if (e) out.push({ level: 'error', path: `${where}.${k}`, message: e });
  }
  if (typeof n.id === 'string' && n.id.includes('/')) out.push({ level: 'error', path: `${where}.id`, message: 'ids must not contain "/"' });
  if (t === 'ref' && typeof n.ref !== 'string') out.push({ level: 'error', path: `${where}.ref`, message: 'a ref node needs the id of a reusable node in "ref"' });
  if (t === 'text') checkText(n, where, out);
  if (opts.deep !== false && Array.isArray(n.children)) for (const c of n.children) validateNode(c, opts, out);
  return out;
}

function checkText(n: Record<string, unknown>, where: string, out: Issue[]) {
  const growth = (n.textGrowth as string | undefined) ?? 'auto';
  if (n.fill === undefined) out.push({ level: 'warning', path: `${where}.fill`, message: 'text has no fill and will be invisible' });
  if (growth === 'auto' && (n.width !== undefined || n.height !== undefined)) {
    out.push({ level: 'warning', path: where, message: 'width/height are ignored while textGrowth is "auto"; set textGrowth to "fixed-width" to wrap' });
  }
  if (growth !== 'auto' && n.width === undefined) out.push({ level: 'error', path: `${where}.width`, message: `textGrowth "${growth}" needs a width` });
  if (growth === 'fixed-width-height' && n.height === undefined) out.push({ level: 'error', path: `${where}.height`, message: 'textGrowth "fixed-width-height" needs a height' });
}
