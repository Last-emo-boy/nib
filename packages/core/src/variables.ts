import type { PenDocument, Theme, Variable, VariableValue } from '@nib/format';

/** Active value of every theme axis, e.g. `{ mode: 'dark' }`. */
export type ThemeContext = Readonly<Record<string, string>>;

export interface VariableSource {
  variable(name: string): Variable | undefined;
}

/** Each axis starts at its first listed value. */
export function defaultTheme(doc: PenDocument): ThemeContext {
  const ctx: Record<string, string> = {};
  for (const [axis, values] of Object.entries(doc.themes ?? {})) if (values.length) ctx[axis] = values[0];
  return ctx;
}

/** A node's `theme` overrides axes for itself and its subtree. */
export function withTheme(ctx: ThemeContext, theme: Theme | undefined): ThemeContext {
  return theme && Object.keys(theme).length ? { ...ctx, ...theme } : ctx;
}

const MAX_ALIAS_DEPTH = 32;
/** Keys that hold identity or structure, never a variable reference. */
const NOT_RESOLVED = new Set(['id', 'name', 'children', 'context', 'metadata', 'ref', 'descendants']);

/** Value of `name` (without `$`) under `ctx`. Among themed entries the last matching one wins. */
export function resolveVariable(src: VariableSource, name: string, ctx: ThemeContext): VariableValue | undefined {
  let current = name;
  for (let depth = 0; depth < MAX_ALIAS_DEPTH; depth++) {
    const v = src.variable(current);
    if (!v) return undefined;
    const value = pickThemed(v.value, ctx);
    if (typeof value === 'string' && value.startsWith('$') && src.variable(value.slice(1))) {
      current = value.slice(1);
      continue;
    }
    return value;
  }
  return undefined;
}

function pickThemed(value: Variable['value'], ctx: ThemeContext): VariableValue | undefined {
  if (!Array.isArray(value)) return value;
  let picked: VariableValue | undefined;
  for (const entry of value) {
    const theme = entry.theme ?? {};
    if (Object.entries(theme).every(([axis, v]) => ctx[axis] === v)) picked = entry.value;
  }
  return picked;
}

/**
 * Replace every `$name` string inside `value` that names a defined variable.
 * Strings that only look like references (a text reading "$48.2K") are left alone.
 */
export function resolveDeep<T>(src: VariableSource, value: T, ctx: ThemeContext): T {
  if (typeof value === 'string') {
    if (value.length > 1 && value.startsWith('$')) {
      const resolved = resolveVariable(src, value.slice(1), ctx);
      if (resolved !== undefined) return resolved as T;
    }
    return value;
  }
  if (Array.isArray(value)) {
    let out: unknown[] | undefined;
    value.forEach((item, i) => {
      const r = resolveDeep(src, item, ctx);
      if (r !== item) (out ??= value.slice())[i] = r;
    });
    return (out ?? value) as T;
  }
  if (typeof value === 'object' && value !== null) {
    let out: Record<string, unknown> | undefined;
    for (const [k, item] of Object.entries(value)) {
      if (NOT_RESOLVED.has(k)) continue;
      const r = resolveDeep(src, item, ctx);
      if (r !== item) (out ??= { ...(value as Record<string, unknown>) })[k] = r;
    }
    return (out ?? value) as T;
  }
  return value;
}
