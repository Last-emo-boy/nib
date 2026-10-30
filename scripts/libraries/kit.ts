// Helpers for writing nib's design-system libraries as .pen documents.
import type { CodeMap, ComponentCode } from '@nib/export';
import type { Node, PenDocument, Variable } from '@nib/format';

export type N = Record<string, unknown>;

/** CSS oklch(L C h [/ a]) (L as 0..1 or %, a as 0..1 or %) to #RRGGBB or #RRGGBBAA. */
export function oklch(css: string): string {
  const m = /oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/.exec(css);
  if (!m) throw new Error(`not an oklch() color: ${css}`);
  const L = m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
  const C = parseFloat(m[2]), h = (parseFloat(m[3]) * Math.PI) / 180;
  const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, mm = m_ ** 3, s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
  const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  const hex = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${lin.map((x) => hex(gamma(x))).join('')}${alpha < 1 ? hex(alpha) : ''}`;
}

/** Mix two #RRGGBB(AA) colors in sRGB: `t` of `b` over `a` (good enough for hover and soft tints). */
export function mix(a: string, b: string, t: number): string {
  const p = (c: string) => [1, 3, 5, 7].map((i) => (c.length > i ? parseInt(c.slice(i, i + 2), 16) : 255));
  const x = p(a), y = p(b);
  const out = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  const h = (v: number) => v.toString(16).padStart(2, '0').toUpperCase();
  return `#${h(out[0])}${h(out[1])}${h(out[2])}${out[3] < 255 ? h(out[3]) : ''}`;
}

/** A color with alpha `a` (0..1). */
export const alpha = (c: string, a: number) => `${c.slice(0, 7)}${Math.round(a * 255).toString(16).padStart(2, '0').toUpperCase()}`;

/** Light/Dark color variables from two maps of name -> color. */
export function themedColors(light: Record<string, string>, dark: Record<string, string>): Record<string, Variable> {
  const out: Record<string, Variable> = {};
  for (const name of Object.keys(light)) {
    out[name] = { type: 'color', value: [{ value: light[name], theme: { Mode: 'Light' } }, { value: dark[name] ?? light[name], theme: { Mode: 'Dark' } }] };
  }
  return out;
}

/**
 * Node builders. Ids are given by the caller where overrides need them (`id`), and filled in later for the
 * rest from the enclosing component's id, so a library keeps the same ids each time it is built.
 */
export const frame = (props: N, ...children: N[]): N => ({ type: 'frame', ...props, ...(children.length ? { children } : {}) });
export const row = (props: N, ...children: N[]): N => frame({ layout: 'horizontal', ...props }, ...children);
export const col = (props: N, ...children: N[]): N => frame({ layout: 'vertical', ...props }, ...children);
/** A text node; one given a width wraps to it (an auto-sized text would ignore the width). */
export const text = (content: string, props: N = {}): N => ({ type: 'text', content, ...(props.width !== undefined ? { textGrowth: 'fixed-width' } : {}), ...props });
export const icon = (name: string, props: N = {}): N => ({ type: 'icon', library: 'lucide', icon: name, width: 16, height: 16, ...props });
export const rect = (props: N): N => ({ type: 'rectangle', ...props });
export const ellipse = (props: N): N => ({ type: 'ellipse', ...props });
export const ref = (component: string, props: N = {}, descendants?: Record<string, N>): N => ({ type: 'ref', ref: component, ...props, ...(descendants ? { descendants } : {}) });

/** Interaction states a component can be drawn in. */
export type State = 'hover' | 'pressed' | 'focus' | 'disabled' | 'invalid';
const STATE_NAMES: Record<State, string> = { hover: 'Hover', pressed: 'Pressed', focus: 'Focus', disabled: 'Disabled', invalid: 'Invalid' };
/**
 * How a state looks: props on the component's root, overrides of its parts, and the attribute its code gets
 * (default `disabled` for the disabled state).
 */
export interface Look { props?: N; parts?: Record<string, N>; code?: string }

/** A library being written: its components (by id), the boards that show them, its variables and themes. */
export class Library {
  readonly components = new Map<string, N>();
  /** State components and the component each is a state of. */
  private stateOf = new Map<string, { base: string; state: State; code?: string }>();
  /** How components are written in code (see @nib/export's CodeMap). */
  readonly code: Record<string, ComponentCode> = {};
  readonly boards: N[] = [];
  readonly variables: Record<string, Variable> = {};
  private used = new Set<string>();

  readonly id: string;
  readonly themes: Record<string, string[]>;

  constructor(id: string, themes: Record<string, string[]>) {
    this.id = id;
    this.themes = themes;
  }

  /** A reusable component: `name` like "Button / Outline" groups it under Button. */
  component(id: string, name: string, node: N): string {
    if (this.components.has(id)) throw new Error(`component ${id} defined twice`);
    const c = { ...node, id, name, reusable: true };
    this.components.set(id, c);
    return id;
  }

  /**
   * Component `id` in other states, each a component of its own that is an instance of it ("Button / Default /
   * Hover", id `button-hover`), so it follows changes to the base and keeps its part names. Returns their ids.
   */
  states(id: string, looks: Partial<Record<State, Look>>): string[] {
    const base = this.components.get(id);
    if (!base) throw new Error(`states of unknown component ${id}`);
    return (Object.entries(looks) as [State, Look][]).map(([state, look]) => {
      const sid = this.component(`${id}-${state}`, `${base.name} / ${STATE_NAMES[state]}`, ref(id, look.props ?? {}, look.parts));
      this.stateOf.set(sid, { base: id, state, code: look.code ?? (state === 'disabled' ? 'disabled' : undefined) });
      return sid;
    });
  }

  /** The states made for component `id`, in the order they were given. */
  statesOf(id: string): string[] {
    return [...this.stateOf].filter(([, s]) => s.base === id).map(([sid]) => sid);
  }

  /** How component `id` is written in code; `imports` maps the template's names to modules. */
  codeFor(id: string, template: string, imports: Record<string, string>): void {
    if (!this.components.has(id)) throw new Error(`code for unknown component ${id}`);
    this.code[id] = { template, imports };
  }

  /** The library's code map, its tokens being the color variables. */
  codeMap(meta: Omit<CodeMap, 'components' | 'tokens'>): CodeMap {
    // A state is written as its component (hover, pressed and focus live in the component's styles); disabled and
    // invalid get their attribute when the template's outer element is the control itself.
    for (const [sid, { base, code }] of this.stateOf) {
      const c = this.code[base];
      if (!c || this.code[sid]) continue;
      const control = /^<(?!label\b|div\b|span\b)[\w.-]+[^>]*?\{class/.test(c.template);
      this.code[sid] = code && control ? { ...c, template: c.template.replace('{class', ` ${code}{class`) } : c;
    }
    const tokens = Object.entries(this.variables).filter(([, v]) => v.type === 'color').map(([k]) => k);
    return { ...meta, tokens, components: this.code };
  }

  /** A top-level board: a titled frame showing components (by id) and examples. */
  board(id: string, name: string, props: N, ...children: N[]): N {
    const b = frame({ id, name, layout: 'vertical', gap: 32, padding: 48, fill: '$background', ...props }, ...children);
    this.boards.push(b);
    return b;
  }

  /** Note the ids given by the caller, which must be unique. */
  private reserve(node: N): void {
    if (typeof node.id === 'string') {
      if (this.used.has(node.id)) throw new Error(`id ${node.id} used twice`);
      this.used.add(node.id);
    }
    for (const c of (node.children as N[] | undefined) ?? []) this.reserve(c);
  }

  /** Nodes without an id are numbered after the nearest component or board above them. */
  private assign(node: N, base: string, counter: { n: number }): void {
    if (typeof node.id !== 'string') {
      let id: string;
      do id = `${base}-${++counter.n}`; while (this.used.has(id));
      node.id = id;
      this.used.add(id);
    }
    const own = node.reusable ? { n: 0 } : counter;
    const nextBase = node.reusable ? (node.id as string) : base;
    for (const c of (node.children as N[] | undefined) ?? []) this.assign(c, nextBase, own);
  }

  /** The .pen document: its boards (all at 0,0 until arranged), components placed where boards ask for them. */
  document(): PenDocument {
    const place = (n: N): N => {
      if (n.type === 'ref' && typeof n.ref === 'string' && (n as { place?: boolean }).place) {
        const c = this.components.get(n.ref);
        if (!c) throw new Error(`no component ${n.ref}`);
        return c;
      }
      return n.children ? { ...n, children: (n.children as N[]).map(place) } : n;
    };
    const boards = this.boards.map(place);
    // Components not placed on a board would be lost: fail early.
    const placed = new Set<string>();
    const visit = (n: N) => { if (n.reusable) placed.add(n.id as string); (n.children as N[] | undefined)?.forEach(visit); };
    boards.forEach(visit);
    const missing = [...this.components.keys()].filter((k) => !placed.has(k));
    if (missing.length) throw new Error(`components not on any board: ${missing.join(', ')}`);
    this.used.clear();
    boards.forEach((b) => this.reserve(b));
    for (const b of boards) { this.assign(b, b.id as string, { n: 0 }); b.x = 0; b.y = 0; }
    return { version: '2.20', themes: this.themes, variables: this.variables, children: boards as unknown as Node[] } as PenDocument;
  }
}

/** Put a component on a board at this spot (it is defined once, wherever a board shows it first). */
export const show = (component: string): N => ({ type: 'ref', ref: component, place: true });
