import { newQuickJSWASMModuleFromVariant, type QuickJSRuntime, type QuickJSSyncVariant } from 'quickjs-emscripten-core';
import variantExport from '@jitl/quickjs-wasmfile-release-sync';
import { validateNode, type Node } from '@nib/format';

const variant = variantExport as unknown as QuickJSSyncVariant;

/**
 * Script nodes: a layer whose content a JavaScript file makes. The file defines `render(input, size)`, which
 * returns layers (.pen nodes, positioned in the script node's box); `input` holds the node's inputs, `size` its
 * width and height. Controls are declared with comments, one per line:
 *
 *   // @input count 12 1..40 Bars       a number, with a range and a label
 *   // @input color #2F6FEB Bar color   a color
 *   // @input rounded true              a switch
 *   // @input title "Sales" Title       text
 *
 * Scripts run in a QuickJS sandbox of their own, with no access to anything but their inputs: at most 2
 * seconds and 1000 layers, and Math.random seeded from the node, so a script draws the same each time.
 */

export interface ScriptInput { name: string; kind: 'number' | 'color' | 'boolean' | 'text'; default: number | boolean | string; min?: number; max?: number; label: string }
export interface ScriptResult { nodes: Node[]; error?: string }

/** nib's own scripts, to copy next to a document (a file: URL, read from Node). */
export const SCRIPT_GALLERY = new URL('../scripts/', import.meta.url);

const MAX_NODES = 1000;
const TIME_MS = 2000;

/** The controls a script declares. */
export function scriptInputs(source: string): ScriptInput[] {
  const out: ScriptInput[] = [];
  for (const m of source.matchAll(/^[ \t]*\/\/\s*@input\s+([A-Za-z_$][\w$]*)\s+(.*)$/gm)) {
    const name = m[1];
    let rest = m[2].trim();
    let value: number | boolean | string;
    let kind: ScriptInput['kind'];
    const quoted = /^"((?:[^"\\]|\\.)*)"\s*/.exec(rest);
    if (quoted) { value = JSON.parse(`"${quoted[1]}"`) as string; kind = 'text'; rest = rest.slice(quoted[0].length); }
    else {
      const word = rest.split(/\s+/)[0] ?? '';
      rest = rest.slice(word.length).trim();
      if (/^#[0-9a-f]{3,8}$/i.test(word)) { value = word.toUpperCase(); kind = 'color'; }
      else if (word === 'true' || word === 'false') { value = word === 'true'; kind = 'boolean'; }
      else if (word !== '' && Number.isFinite(Number(word))) { value = Number(word); kind = 'number'; }
      else { value = word; kind = 'text'; }
    }
    const range = kind === 'number' ? /^(-?[\d.]+)\.\.(-?[\d.]+)\s*/.exec(rest) : null;
    if (range) rest = rest.slice(range[0].length);
    out.push({ name, kind, default: value, ...(range ? { min: Number(range[1]), max: Number(range[2]) } : {}), label: rest.trim() || name });
  }
  return out;
}

/** A small deterministic generator for Math.random, seeded by text (mulberry32). */
const RANDOM = `(() => {
  let h = 1779033703 ^ __seed.length;
  for (let i = 0; i < __seed.length; i++) { h = Math.imul(h ^ __seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let s = h >>> 0;
  Math.random = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
})();`;

export class ScriptRunner {
  private runtime: QuickJSRuntime;

  private constructor(runtime: QuickJSRuntime) {
    this.runtime = runtime;
    runtime.setMemoryLimit(64 * 1024 * 1024);
    runtime.setMaxStackSize(1024 * 1024);
  }

  static async create(): Promise<ScriptRunner> {
    return new ScriptRunner((await newQuickJSWASMModuleFromVariant(variant)).newRuntime());
  }

  /** The layers `source` makes for `input` in a box of `size`; `seed` seeds Math.random. */
  run(source: string, input: Record<string, unknown>, size: { width: number; height: number }, seed: string): ScriptResult {
    // Inputs the node does not set take the script's defaults.
    const values: Record<string, unknown> = {};
    for (const i of scriptInputs(source)) values[i.name] = i.default;
    Object.assign(values, input);
    const vm = this.runtime.newContext();
    const deadline = Date.now() + TIME_MS;
    this.runtime.setInterruptHandler(() => Date.now() > deadline);
    try {
      const setup = vm.evalCode(`const __seed = ${JSON.stringify(seed)}; ${RANDOM} globalThis.input = ${JSON.stringify(values)}; globalThis.size = ${JSON.stringify(size)}; globalThis.console = { log() {}, warn() {}, error() {} };`, 'nib.js');
      if (setup.error) { setup.error.dispose(); return { nodes: [], error: 'the script could not be set up' }; }
      setup.value.dispose();
      const r = vm.evalCode(`${source}\n;JSON.stringify((() => { if (typeof render !== 'function') throw new Error('a script defines render(input, size), which returns layers'); return render(input, size); })() ?? [])`, 'script.js');
      if (r.error) {
        const e = vm.dump(r.error) as { message?: string; lineNumber?: number } | string;
        r.error.dispose();
        if (Date.now() > deadline) return { nodes: [], error: `the script ran longer than ${TIME_MS / 1000} s and was stopped` };
        const message = typeof e === 'string' ? e : e.message ?? String(e);
        return { nodes: [], error: typeof e === 'object' && e.lineNumber ? `${message} (line ${e.lineNumber})` : message };
      }
      const raw = JSON.parse(vm.getString(r.value)) as unknown;
      r.value.dispose();
      return checked(Array.isArray(raw) ? raw : [raw]);
    } catch (e) {
      return { nodes: [], error: (e as Error).message };
    } finally {
      this.runtime.removeInterruptHandler();
      vm.dispose();
    }
  }
}

/** The layers a script returned, valid ones only and at most 1000 in all, with what was left out. */
function checked(list: unknown[]): ScriptResult {
  const nodes: Node[] = [];
  let count = 0, n = 0;
  const problems: string[] = [];
  const count1 = (x: unknown): number => 1 + ((x as { children?: unknown[] })?.children ?? []).reduce<number>((s, c) => s + count1(c), 0);
  const ids = (x: Record<string, unknown>) => {
    if (typeof x.id !== 'string' || !x.id) x.id = `s${++n}`;
    for (const c of (x.children as Record<string, unknown>[] | undefined) ?? []) if (c && typeof c === 'object') ids(c);
  };
  for (const x of list) {
    if (!x || typeof x !== 'object') { problems.push('a returned value is not a layer object'); continue; }
    const size = count1(x);
    if (count + size > MAX_NODES) { problems.push(`more than ${MAX_NODES} layers: the rest are left out`); break; }
    ids(x as Record<string, unknown>);
    const issues = validateNode(x).filter((i) => i.level === 'error');
    if (issues.length) { problems.push(`${(x as { type?: unknown }).type ?? 'a layer'}: ${issues[0].message}`); continue; }
    nodes.push(x as Node);
    count += size;
  }
  return { nodes, ...(problems.length ? { error: problems.slice(0, 3).join('; ') } : {}) };
}
