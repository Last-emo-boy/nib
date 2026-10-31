/** Layer changes that need no canvas: stacking order among siblings, and scaling a layer with everything in it. */

export type Order = 'forward' | 'backward' | 'front' | 'back';

/**
 * Siblings (bottom to top) after moving the selected ones: one step up or down past an unselected neighbour,
 * or all the way to the top or bottom, keeping their order among themselves.
 */
export function reorder(ids: string[], selected: ReadonlySet<string>, how: Order): string[] {
  if (how === 'front' || how === 'back') {
    const sel = ids.filter((id) => selected.has(id)), rest = ids.filter((id) => !selected.has(id));
    return how === 'front' ? [...rest, ...sel] : [...sel, ...rest];
  }
  const out = [...ids];
  if (how === 'forward') {
    for (let i = out.length - 2; i >= 0; i--) if (selected.has(out[i]) && !selected.has(out[i + 1])) [out[i], out[i + 1]] = [out[i + 1], out[i]];
  } else {
    for (let i = 1; i < out.length; i++) if (selected.has(out[i]) && !selected.has(out[i - 1])) [out[i], out[i - 1]] = [out[i - 1], out[i]];
  }
  return out;
}

type N = Record<string, any>;

/** Properties that are lengths: they scale with the layer. Variables and `fill_container`-style sizes stay. */
const LENGTHS = ['width', 'height', 'strokeWidth', 'cornerRadius', 'fontSize', 'letterSpacing', 'gap', 'padding'] as const;

const r2 = (v: number) => Math.round(v * 100) / 100;

function scaled(v: unknown, k: number): unknown {
  if (typeof v === 'number') return r2(v * k);
  if (Array.isArray(v)) return v.map((x) => scaled(x, k));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([key, x]) => [key, scaled(x, k)]));
  return v;
}

function scaledEffects(e: unknown, k: number): unknown {
  const one = (x: N) => {
    if (x?.type === 'shadow') return { ...x, ...(x.offset ? { offset: scaled(x.offset, k) } : {}), ...(x.blur !== undefined ? { blur: scaled(x.blur, k) } : {}), ...(x.spread !== undefined ? { spread: scaled(x.spread, k) } : {}) };
    if (x?.type === 'blur' || x?.type === 'background_blur') return x.radius !== undefined ? { ...x, radius: scaled(x.radius, k) } : x;
    return x;
  };
  return Array.isArray(e) ? e.map(one) : e && typeof e === 'object' ? one(e as N) : e;
}

/** The length properties of one node (and its instance overrides) scaled by k. */
function scaleProps(n: N, k: number, position: boolean): N {
  const out: N = {};
  for (const key of LENGTHS) if (n[key] !== undefined && typeof n[key] !== 'string') out[key] = scaled(n[key], k);
  if (position) for (const key of ['x', 'y'] as const) if (typeof n[key] === 'number') out[key] = r2(n[key] * k);
  if (n.effect !== undefined) out.effect = scaledEffects(n.effect, k);
  if (n.descendants && typeof n.descendants === 'object') {
    out.descendants = Object.fromEntries(Object.entries(n.descendants as Record<string, N>).map(([key, o]) => [key, { ...o, ...scaleProps(o, k, true) }]));
  }
  return out;
}

/**
 * The properties to set on a node and each node inside it to scale it by k, as if it were an image: sizes,
 * strokes, corners, text sizes, gaps, padding, effects, and the positions of what is inside. The node's own
 * position is left to the caller (it depends on which corner stays put).
 */
export function scaleTree(node: N, k: number): Map<string, N> {
  const out = new Map<string, N>();
  const visit = (n: N, top: boolean) => {
    const props = scaleProps(n, k, !top);
    if (Object.keys(props).length) out.set(n.id, props);
    if (Array.isArray(n.children)) for (const c of n.children) visit(c, false);
  };
  visit(node, true);
  return out;
}
