import { newQuickJSWASMModuleFromVariant, type QuickJSContext, type QuickJSRuntime, type QuickJSSyncVariant, type QuickJSWASMModule } from 'quickjs-emscripten-core';
import variantExport from '@jitl/quickjs-wasmfile-release-sync';

// The package's types describe its CommonJS build; imported as ESM, the default export is the variant itself.
const variant = variantExport as unknown as QuickJSSyncVariant;

/** Called by the snippet's API functions; returns a JSON value or throws (the message reaches the snippet). */
export type HostCall = (name: string, args: unknown[]) => unknown;

export interface SnippetError {
  name: string;
  message: string;
  /** 1-based line in the snippet where it was thrown, when known. */
  line?: number;
  /** That line's source. */
  source?: string;
}

export type RunResult =
  | { ok: true; /** Global variables holding strings after the run, for naming returned ids. */ globals: Record<string, string> }
  | { ok: false; error: SnippetError };

export interface RunOptions {
  timeoutMs?: number;
  /** Polled while the snippet runs; returning true stops it at once (the snippet cannot catch this). */
  abort?: () => boolean;
}

const FILE = 'snippet.js';
const MEMORY_LIMIT = 512 * 1024 * 1024;
const STACK_LIMIT = 4 * 1024 * 1024;

let quickjs: Promise<QuickJSWASMModule> | undefined;

// The API as snippets see it. Arguments and results cross into the host as JSON; visitors run here.
const PRELUDE = String.raw`
(() => {
  const host = globalThis.__host;
  delete globalThis.__host;
  const call = (name, args) => {
    while (args.length && args[args.length - 1] === undefined) args.pop();
    const r = JSON.parse(host(name, JSON.stringify(args)));
    if ('e' in r) throw new Error(r.e);
    return r.v;
  };
  const isNode = (x) => x && typeof x === 'object' && typeof x.id === 'string' && typeof x.type === 'string';
  const link = (entries) => {
    for (const e of entries) {
      if (!e.c) continue;
      link(e.c);
      if (Array.isArray(e.n.children)) e.n.children = e.c.map((k) => k.n);
    }
  };
  const walk = (entries, visit, parentCtx, depth, max, out) => {
    entries.forEach((e, index) => {
      let skip = false;
      const ctx = { node: e.n, parentCtx, depth, index, bounds: e.b, problems: e.p, skipChildren() { skip = true; } };
      const r = visit(e.n, ctx);
      if (r !== undefined) out.push(r);
      if (!skip && e.c && depth < max) walk(e.c, visit, ctx, depth + 1, max, out);
    });
  };
  const show = (v) => typeof v === 'string' ? v : v === undefined ? 'undefined' : typeof v === 'function' ? String(v) : (JSON.stringify(v) ?? String(v));
  const Get = (...args) => {
    let path, visit, opts;
    for (const a of args) {
      if (typeof a === 'string') path = a;
      else if (typeof a === 'function') visit = a;
      else if (isNode(a)) throw new Error('Get: pass a node id (node.id), not the node object');
      else if (a && typeof a === 'object') opts = a;
      else if (a !== undefined && a !== null) throw new Error('Get: unexpected argument ' + show(a));
    }
    if (!visit) {
      if (path === undefined) throw new Error('Get needs a node id or a visitor: Get(id), Get(id, visit) or Get(visit)');
      return call('get', [path, opts]);
    }
    const entries = call('tree', [path === undefined ? null : path, opts]);
    link(entries);
    const out = [];
    walk(entries, visit, undefined, 0, opts && typeof opts.depth === 'number' ? opts.depth : Infinity, out);
    return out;
  };
  const Print = (...values) => { call('print', [values.map(show).join(' ')]); };
  const api = {
    document: 'document',
    Insert: (parent, data) => call('insert', [parent, data]),
    Copy: (path, parent, data) => call('copy', [path, parent, data]),
    Update: (path, data) => { call('update', [path, data]); },
    Replace: (path, data) => call('replace', [path, data]),
    Move: (path, parent, index) => { call('move', [path, parent, index]); },
    Delete: (path) => { call('delete', [path]); },
    Generate: (...args) => call('generate', args),
    SetVariables: (variables, replace) => { call('setVariables', [variables, replace]); },
    GetVariables: () => call('getVariables', []),
    Get,
    FindEmptySpace: (input) => call('findEmptySpace', [input]),
    Print,
    TakeScreenshot: (ids) => { call('takeScreenshot', [ids]); },
    Export: (ids, format, outputPath, options) => { call('export', [ids, format, outputPath, options]); },
    console: { log: Print, info: Print, warn: Print, error: Print },
  };
  for (const [k, v] of Object.entries(api)) Object.defineProperty(globalThis, k, { value: v, writable: false, configurable: false });
  const builtin = new Set(Object.getOwnPropertyNames(globalThis));
  builtin.add('__nib');
  let saved = new Map();
  const nib = {
    save() {
      saved = new Map();
      for (const k of Object.getOwnPropertyNames(globalThis)) if (!builtin.has(k)) saved.set(k, globalThis[k]);
    },
    restore() {
      for (const k of Object.getOwnPropertyNames(globalThis)) if (!builtin.has(k) && !saved.has(k)) delete globalThis[k];
      for (const [k, v] of saved) globalThis[k] = v;
    },
    strings() {
      const out = {};
      for (const k of Object.getOwnPropertyNames(globalThis)) if (!builtin.has(k) && typeof globalThis[k] === 'string') out[k] = globalThis[k];
      return JSON.stringify(out);
    },
  };
  Object.defineProperty(globalThis, '__nib', { value: nib, writable: false, configurable: false, enumerable: false });
})();
`;

/**
 * A QuickJS context that runs `execute` snippets. Each snippet runs as the body of a function, so `const`,
 * `let` and function declarations stay local while plain assignments create globals that later snippets
 * see. A failed snippet's global assignments are undone.
 */
export class Sandbox {
  private runtime: QuickJSRuntime;
  private vm: QuickJSContext;
  private host: HostCall = () => { throw new Error('no snippet is running'); };

  private constructor(runtime: QuickJSRuntime) {
    this.runtime = runtime;
    runtime.setMemoryLimit(MEMORY_LIMIT);
    runtime.setMaxStackSize(STACK_LIMIT);
    this.vm = runtime.newContext();
    const fn = this.vm.newFunction('__host', (nameH, argsH) => {
      const name = this.vm.getString(nameH);
      const args = (JSON.parse(this.vm.getString(argsH)) as unknown[]).map((a) => (a === null ? undefined : a));
      let reply: string;
      try {
        const v = this.host(name, args);
        reply = JSON.stringify(v === undefined ? {} : { v });
      } catch (e) {
        reply = JSON.stringify({ e: e instanceof Error ? e.message : String(e) });
      }
      return this.vm.newString(reply);
    });
    this.vm.setProp(this.vm.global, '__host', fn);
    fn.dispose();
    this.eval(PRELUDE, 'nib.js');
  }

  static async create(): Promise<Sandbox> {
    quickjs ??= newQuickJSWASMModuleFromVariant(variant);
    return new Sandbox((await quickjs).newRuntime());
  }

  /** Run `code` with `host` answering its API calls. */
  run(code: string, host: HostCall, opts: RunOptions = {}): RunResult {
    const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
    let timedOut = false;
    this.host = host;
    this.eval('__nib.save()', 'nib.js');
    this.runtime.setInterruptHandler(() => {
      if (opts.abort?.()) return true;
      if (Date.now() > deadline) return (timedOut = true);
      return false;
    });
    try {
      const result = this.vm.evalCode(`(function(){${code}\n})()`, FILE);
      if (result.error) {
        const raw = this.vm.dump(result.error) as { name?: string; message?: string; stack?: string; lineNumber?: number };
        result.error.dispose();
        this.runtime.removeInterruptHandler();
        this.eval('__nib.restore()', 'nib.js');
        const error = describe(raw, code);
        if (timedOut) error.message = `the snippet ran longer than ${Math.round((opts.timeoutMs ?? 30_000) / 1000)}s and was stopped`;
        return { ok: false, error };
      }
      result.value.dispose();
      this.runtime.removeInterruptHandler();
      return { ok: true, globals: JSON.parse(this.eval('__nib.strings()', 'nib.js') as string) };
    } finally {
      this.runtime.removeInterruptHandler();
      this.host = () => { throw new Error('no snippet is running'); };
    }
  }

  /** Undo the global assignments of the last run (used when its changes are rolled back for another reason). */
  restoreGlobals(): void {
    this.eval('__nib.restore()', 'nib.js');
  }

  dispose(): void {
    this.vm.dispose();
    this.runtime.dispose();
  }

  private eval(code: string, file: string): unknown {
    const r = this.vm.evalCode(code, file);
    if (r.error) {
      const e = this.vm.dump(r.error);
      r.error.dispose();
      throw new Error(`sandbox: ${JSON.stringify(e)}`);
    }
    const v = this.vm.dump(r.value);
    r.value.dispose();
    return v;
  }
}

function describe(raw: { name?: string; message?: string; stack?: string; lineNumber?: number }, code: string): SnippetError {
  const error: SnippetError = { name: raw.name ?? 'Error', message: raw.message ?? String(raw) };
  let line = raw.lineNumber;
  if (line === undefined && raw.stack) {
    const m = new RegExp(`\\(?${FILE.replace('.', '\\.')}:(\\d+)`).exec(raw.stack);
    if (m) line = Number(m[1]);
  }
  const lines = code.split('\n');
  if (line !== undefined && line >= 1 && line <= lines.length) {
    error.line = line;
    const src = lines[line - 1].trim();
    error.source = src.length > 300 ? `${src.slice(0, 300)}…` : src;
  }
  return error;
}
