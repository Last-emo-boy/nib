import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve as resolvePath } from 'node:path';
import type { Node } from '@nib/format';
import { buildScene, childrenOf, DocEditor, type Op, type PenDoc, type SceneNode } from '@nib/core';
import { CELL_NAMES, comparePixels, decodePixels, encodePng, FontsNotLoaded, resizePixels, type FontFace, type ImageLoader, type Pixels, type Renderer } from '@nib/render';
import { PenApi, type ApiOutput, type CapturedScene, type CompareReference, type ExportFormat, type ExportOptions } from './api.ts';
import { BoundsCache, problemOf, type LayoutFn } from './bounds.ts';
import { assetIssues, layoutIssues, variableIssues, type Problem } from './checks.ts';
import { ExecError } from './errors.ts';
import { Sandbox, type SnippetError } from './sandbox.ts';

export interface ExecuteRequest {
  input?: string;
  /** Patch and rerun a failed snippet instead of sending it again. */
  editId?: string;
  edits?: { find: string; replace: string; all?: boolean }[];
}

export interface ExecuteImage {
  data: Uint8Array;
  mimeType: string;
}

export interface ExecuteResult {
  ok: boolean;
  /** Markdown report for the agent. */
  text: string;
  images: ExecuteImage[];
  /** The change, for saving, undo and other views; empty when nothing changed. */
  ops: Op[];
  undo: Op[];
}

/** Writes nodes to pdf or html (image formats are built in). Returns the files written. */
export type Exporter = (scenes: CapturedScene[], outputPath: string, options: ExportOptions, ctx: { doc: PenDoc; renderer: Renderer; images: ImageLoader; baseDir: string }) => Promise<string[]>;

export interface SessionOptions {
  renderer: Renderer;
  images: ImageLoader;
  /** Directory relative export paths start from: the .pen file's. */
  baseDir: string;
  timeoutMs?: number;
  exporters?: Partial<Record<ExportFormat, Exporter>>;
  /** Map every resolved export path, e.g. to keep a test run's files inside a scratch folder. */
  exportPath?: (path: string) => string;
}

const SCREENSHOT_SIDE = 1568;
const COMPARE_SIDE = 1600;
const MAX_FONT_RETRIES = 4;
const MIME: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

/**
 * Runs `execute` snippets against one open document. Every snippet is one transaction: it applies in
 * full or not at all, and a failed snippet can be fixed with `edits` under its `editId`.
 */
export class ExecSession {
  private current: PenDoc;
  private opts: SessionOptions;
  private sandbox: Sandbox;
  private editor: DocEditor;
  private bounds: BoundsCache;
  private failed = new Map<string, string>();

  private constructor(doc: PenDoc, sandbox: Sandbox, opts: SessionOptions) {
    this.current = doc;
    this.opts = opts;
    this.sandbox = sandbox;
    this.editor = new DocEditor(doc);
    this.bounds = new BoundsCache(doc, this.layoutFn);
  }

  get doc(): PenDoc {
    return this.current;
  }

  private layoutFn: LayoutFn = (scene) => this.opts.renderer.layoutSync(scene);

  static async open(doc: PenDoc, opts: SessionOptions): Promise<ExecSession> {
    const session = new ExecSession(doc, await Sandbox.create(), opts);
    await session.loadScenes(doc.data.children);
    return session;
  }

  /** Call when the document changed outside this session (an editor, a reload). */
  invalidate(): void {
    this.bounds.invalidate();
  }

  /** Work on `doc` from now on (the file was reloaded); global variables and pending editIds stay. */
  async reset(doc: PenDoc): Promise<void> {
    this.current = doc;
    this.editor = new DocEditor(doc);
    this.bounds = new BoundsCache(doc, this.layoutFn);
    await this.loadScenes(doc.data.children);
  }

  /**
   * Problems anywhere in the document, for the editor's problems panel: the checks agents get after each
   * snippet, plus nodes that a clipping parent hides completely.
   */
  async problems(): Promise<Problem[]> {
    const doc = this.current;
    const scenes = await this.loadScenes(doc.data.children);
    const ids = new Set(doc.ids());
    const out: Problem[] = [...variableIssues(doc, ids)];
    try {
      out.push(...layoutIssues(doc, this.bounds, ids));
      for (const id of ids) {
        const at = doc.locate(id);
        if (!at?.parent || at.parent.type !== 'frame' || (at.parent as { clip?: unknown }).clip !== true) continue;
        const box = this.bounds.box(id), parent = this.bounds.box(at.parent.id);
        if (box && parent && problemOf(box, parent) === 'fully clipped') {
          out.push({ id, message: `${at.node.name ? `"${at.node.name}"` : id} is outside its parent, which clips it, so it is never visible.` });
        }
      }
    } catch (e) {
      if (!(e instanceof FontsNotLoaded)) throw e;
    }
    out.push(...assetIssues(this.opts.renderer, scenes, ids, this.opts.renderer.report(this.opts.images).missingImages));
    return out;
  }

  /** Layout box of a document node, relative to its parent; undefined when hidden or its fonts are not loaded. */
  box(id: string): { x: number; y: number; width: number; height: number } | undefined {
    try {
      return this.bounds.box(id);
    } catch (e) {
      if (e instanceof FontsNotLoaded) return undefined;
      throw e;
    }
  }

  dispose(): void {
    this.sandbox.dispose();
  }

  async execute(req: ExecuteRequest): Promise<ExecuteResult> {
    let code: string;
    let editId: string | undefined;
    if (req.editId !== undefined) {
      const stored = this.failed.get(req.editId);
      if (stored === undefined) return failure(`Unknown editId "${req.editId}": it was never issued, or its snippet already ran. Send the snippet in \`input\` instead.`);
      if (req.input !== undefined) return failure('Send either `input` or `editId` with `edits`, not both.');
      const patched = applyEdits(stored, req.edits ?? []);
      if (typeof patched !== 'string') return failure(`${patched.error}\nNothing ran. The snippet under editId "${req.editId}" is unchanged; fix the edits and try again.`);
      code = patched;
      editId = req.editId;
    } else {
      if (typeof req.input !== 'string' || !req.input.trim()) return failure('Nothing to run: pass the snippet in `input`.');
      code = req.input;
    }

    for (let attempt = 0; ; attempt++) {
      const run = this.attempt(code);
      if (run.kind === 'fonts' && attempt < MAX_FONT_RETRIES) {
        await this.opts.renderer.fonts.ensure(run.faces);
        continue;
      }
      if (run.kind !== 'ok') {
        const error: SnippetError = run.kind === 'fonts' ? { name: 'Error', message: `fonts could not be loaded: ${run.faces.map((f) => f.family).join(', ')}` } : run.error;
        editId ??= newEditId(this.failed);
        this.failed.set(editId, code);
        return { ...failureReport(error, editId, run.kind === 'error' ? run.out : undefined, this.hint(error)), ops: [], undo: [] };
      }
      if (editId) this.failed.delete(editId);
      return this.finish(run.out, run.globals, run.ops, run.undo);
    }
  }

  /** A likely fix for a common mistake, such as using a node id as a variable name. */
  private hint(error: SnippetError): string | undefined {
    const name = error.name === 'ReferenceError' ? /'([^']+)' is not defined/.exec(error.message)?.[1] : undefined;
    if (name && this.doc.get(name)) return `"${name}" is a node id, and ids are strings: write "${name}" in quotes (or keep it in a global from an earlier call: ${name}Id = "${name}").`;
    return undefined;
  }

  private attempt(code: string):
    | { kind: 'ok'; out: ApiOutput; globals: Record<string, string>; ops: Op[]; undo: Op[] }
    | { kind: 'fonts'; faces: FontFace[] }
    | { kind: 'error'; error: SnippetError; out: ApiOutput } {
    this.editor.begin();
    this.bounds.invalidate();
    const api = new PenApi(this.doc, this.editor, this.bounds);
    let fonts: FontFace[] | undefined;
    let internal: unknown;
    const host = (name: string, args: unknown[]) => {
      const fn = (api as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
      if (typeof fn !== 'function' || name.startsWith('_')) throw new Error(`unknown API function ${name}`);
      const savepoint = this.editor.savepoint();
      try {
        return fn.apply(api, args);
      } catch (e) {
        // A failed call leaves nothing behind, even when the snippet catches the error and goes on.
        this.editor.rollbackTo(savepoint);
        this.bounds.invalidate();
        if (e instanceof FontsNotLoaded) { fonts = e.faces; throw e; }
        if (!(e instanceof ExecError)) internal ??= e;
        throw e;
      }
    };
    const result = this.sandbox.run(code, host, { timeoutMs: this.opts.timeoutMs, abort: () => fonts !== undefined });
    if (fonts || internal || !result.ok) {
      this.editor.rollback();
      this.bounds.invalidate();
      if (result.ok) this.sandbox.restoreGlobals();
      if (fonts) return { kind: 'fonts', faces: fonts };
      if (internal) {
        const e = internal instanceof Error ? internal : new Error(String(internal));
        const err = result.ok ? { name: 'InternalError', message: '' } : result.error;
        return { kind: 'error', error: { ...err, name: 'InternalError', message: `nib failed while running this snippet: ${e.message}` }, out: api.out };
      }
      return { kind: 'error', error: (result as { error: SnippetError }).error, out: api.out };
    }
    const { ops, undo } = this.editor.commit();
    this.bounds.invalidate();
    return { kind: 'ok', out: api.out, globals: result.globals, ops, undo };
  }

  /** After a successful run: load what the changed nodes need, check them, render screenshots and exports. */
  private async finish(out: ApiOutput, globals: Record<string, string>, ops: Op[], undo: Op[]): Promise<ExecuteResult> {
    const touched = touchedIds(this.doc, ops);
    const tops = new Set<Node>();
    for (const id of touched) { const top = this.doc.topLevel(id); if (top) tops.add(top); }
    const scenes = await this.loadScenes([...tops]);
    const issues = [...out.warnings, ...variableIssues(this.doc, touched).map((p) => p.message)];
    try {
      issues.push(...layoutIssues(this.doc, this.bounds, touched).map((p) => p.message));
    } catch (e) {
      if (!(e instanceof FontsNotLoaded)) throw e;
    }
    issues.push(...assetIssues(this.opts.renderer, scenes, touched, this.opts.renderer.report(this.opts.images).missingImages).map((p) => p.message));

    const images: ExecuteImage[] = [];
    const shots: string[] = [];
    const exported: string[] = [];
    const compared: string[] = [];
    for (const c of out.captures) {
      if (c.kind === 'compare') {
        try {
          const r = await this.compare(c.scene, c.reference);
          images.push({ data: r.png, mimeType: 'image/png' });
          shots.push(`difference of ${c.scene.id} from ${r.name}`);
          compared.push(r.text);
        } catch (e) {
          issues.push(`Compare(${c.scene.id}) failed: ${(e as Error).message}`);
        }
      } else if (c.kind === 'screenshot') {
        for (const s of c.scenes) {
          try {
            images.push({ data: await this.raster(s, { maxSide: SCREENSHOT_SIDE, scale: 2 }), mimeType: 'image/png' });
            shots.push(s.id);
          } catch (e) {
            issues.push(`screenshot of ${s.id} failed: ${(e as Error).message}`);
          }
        }
      } else {
        try {
          exported.push(...(await this.export(c.scenes, c.format, c.outputPath, c.options)));
        } catch (e) {
          issues.push(`export to ${c.outputPath} failed: ${(e as Error).message}`);
        }
      }
    }

    const sections = ['OK'];
    if (out.created.length) {
      const byValue = new Map<string, string[]>();
      for (const [k, v] of Object.entries(globals)) (byValue.get(v) ?? byValue.set(v, []).get(v)!).push(k);
      const lines = out.created.map((c) => `${JSON.stringify(c.name)}: ${JSON.stringify(c.id)}${byValue.has(c.id) ? ` (= ${byValue.get(c.id)!.join(', ')})` : ''}`);
      sections.push(`## Created nodes\nIds are strings: quote them in code. \`(= name)\` marks an id that a global variable also holds, usable in later calls.\n\`\`\`\n${lines.join('\n')}\n\`\`\``);
    }
    if (out.prints.length) sections.push(`## Print output\n${out.prints.join('  \n')}`);
    if (exported.length) sections.push(`## Exported\n${exported.join('\n')}`);
    if (compared.length) sections.push(`## Comparisons\n${compared.join('\n')}`);
    if (issues.length) sections.push(`## Issues\n${issues.map((i) => `- ${i}`).join('\n')}\n\nFix these in your next call.`);
    if (shots.length) sections.push(`## Screenshots\nAttached, in order: ${shots.join(', ')}. Check each against the request, and look for collapsed, overflowing, clipped or overlapping elements.`);
    return { ok: true, text: sections.join('\n\n'), images, ops, undo };
  }

  /** Build the scenes of `nodes` and load their fonts, icons and images. */
  private async loadScenes(nodes: Node[]): Promise<SceneNode[]> {
    const scenes = nodes.map((n) => buildScene(this.doc, n)).filter((s): s is SceneNode => !!s);
    const { renderer } = this.opts;
    const assets = scenes.map((s) => renderer.assets(s));
    await renderer.load({
      faces: assets.flatMap((a) => a.faces),
      urls: new Set(assets.flatMap((a) => [...a.urls])),
      icons: assets.flatMap((a) => a.icons),
    }, this.opts.images);
    return scenes;
  }

  /**
   * How close a design looks to its reference: both at the reference's size (at most 1600 px on its longer
   * side), over white, pixel by pixel. The difference image shows the design in gray and what differs in red.
   */
  private async compare(scene: CapturedScene, reference: CompareReference): Promise<{ png: Uint8Array; text: string; name: string }> {
    const { renderer, images } = this.opts;
    const ck = renderer.ck;
    let ref: Pixels, name: string;
    if ('file' in reference) {
      const path = resolvePath(this.opts.baseDir, reference.file);
      ref = decodePixels(ck, new Uint8Array(await readFile(path)));
      name = basename(path);
    } else {
      ref = await renderer.renderPixels(reference.scene.root, reference.scene.target, images, { scale: 1 });
      name = reference.scene.id;
    }
    const k = Math.min(1, COMPARE_SIDE / Math.max(ref.width, ref.height));
    if (k < 1) ref = resizePixels(ck, ref, Math.max(1, Math.round(ref.width * k)), Math.max(1, Math.round(ref.height * k)));
    const natural = await renderer.renderPixels(scene.root, scene.target, images, { scale: 1 });
    const scale = ref.width / Math.max(1, natural.width);
    let design = Math.abs(scale - 1) < 1e-6 ? natural : await renderer.renderPixels(scene.root, scene.target, images, { scale });
    const notes: string[] = [];
    if (Math.abs(design.height - ref.height) > 2) notes.push(`its proportions differ from the reference's: at the reference's width it is ${design.height} px tall, the reference ${ref.height} px (the design is ${natural.width}×${natural.height}).`);
    if (design.width !== ref.width || design.height !== ref.height) design = resizePixels(ck, design, ref.width, ref.height);
    const c = comparePixels(design, ref);
    const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
    const worst = c.cells.map((v, i) => [v, i] as const).filter(([v]) => v > 0.05).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([v, i]) => `${CELL_NAMES[i]} ${pct(v)}`);
    const text = `- ${scene.id} vs ${name}: ${pct(c.similarity)} similar, ${pct(c.changed)} of pixels differ${worst.length ? ` (most in ${worst.join(', ')})` : ''}${notes.length ? `; ${notes.join(' ')}` : '.'}`;
    return { png: encodePng(ck, c.diff), text, name };
  }

  private raster(s: CapturedScene, opts: { scale: number; maxSide?: number; format?: 'png' | 'jpeg' | 'webp'; quality?: number }): Promise<Uint8Array> {
    return this.opts.renderer.renderNode(s.root, s.target, this.opts.images, opts);
  }

  private async export(scenes: CapturedScene[], format: ExportFormat, outputPath: string, options: ExportOptions): Promise<string[]> {
    const resolved = resolvePath(this.opts.baseDir, outputPath);
    const target = this.opts.exportPath ? this.opts.exportPath(resolved) : resolved;
    if (format === 'png' || format === 'jpeg' || format === 'webp') {
      await mkdir(target, { recursive: true });
      const files: string[] = [];
      for (const s of scenes) {
        const file = join(target, `${s.id.replaceAll('/', '_')}.${format === 'jpeg' ? 'jpg' : format}`);
        await writeFile(file, await this.raster(s, { scale: options.scale ?? 2, format, quality: options.quality }));
        files.push(file);
      }
      return files;
    }
    const exporter = this.opts.exporters?.[format];
    if (!exporter) throw new Error(`${format} export is not available`);
    return exporter(scenes, target, options, { doc: this.doc, renderer: this.opts.renderer, images: this.opts.images, baseDir: this.opts.baseDir });
  }
}

function failure(text: string): ExecuteResult {
  return { ok: false, text, images: [], ops: [], undo: [] };
}

function failureReport(error: SnippetError, editId: string, out: ApiOutput | undefined, hint?: string): { ok: false; text: string; images: ExecuteImage[] } {
  const where = error.line !== undefined ? `\n  at line ${error.line}: \`${error.source}\`` : '';
  const parts = [
    '### Execution failed; nothing was changed',
    `\`\`\`\n${error.name}: ${error.message}${where}\n\`\`\``,
    ...(hint ? [`Hint: ${hint}`] : []),
  ];
  if (out?.prints.length) parts.push(`## Print output before the error\n${out.prints.join('  \n')}`);
  parts.push(
    'Every change this snippet made was rolled back, and the global variables it assigned were discarded.\n' +
    `Fix it by calling \`execute\` again with \`editId\`: "${editId}" and \`edits\` (find/replace patches to this snippet) instead of resending the whole snippet.`,
  );
  return { ok: false, text: parts.join('\n\n'), images: [] };
}

/** Apply find/replace patches in order; each `find` must match exactly once unless `all` is set. */
export function applyEdits(code: string, edits: unknown): string | { error: string } {
  if (!Array.isArray(edits) || !edits.length) return { error: '`edits` must be a non-empty array of {find, replace}.' };
  let out = code;
  for (const [i, e] of edits.entries()) {
    const { find, replace, all } = (e ?? {}) as { find?: unknown; replace?: unknown; all?: unknown };
    if (typeof find !== 'string' || !find || typeof replace !== 'string') return { error: `edits[${i}]: needs a non-empty "find" string and a "replace" string.` };
    const count = out.split(find).length - 1;
    if (count === 0) return { error: `edits[${i}]: "find" text does not occur in the snippet (as patched by the edits before it).` };
    if (count > 1 && all !== true) return { error: `edits[${i}]: "find" text occurs ${count} times; make it longer so it matches once, or set "all": true.` };
    out = all === true ? out.split(find).join(replace) : out.replace(find, () => replace);
  }
  return out;
}

function newEditId(taken: Map<string, string>): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (;;) {
    let id = '';
    for (let i = 0; i < 5; i++) id += chars[Math.floor(Math.random() * chars.length)];
    if (!taken.has(id)) return id;
  }
}

/** Ids of the nodes a change touched: set nodes, inserted subtrees, and parents that gained or lost children. */
function touchedIds(doc: PenDoc, ops: Op[]): Set<string> {
  const ids = new Set<string>();
  const subtree = (n: Node) => { ids.add(n.id); childrenOf(n)?.forEach(subtree); };
  for (const op of ops) {
    if (op.op === 'set') ids.add(op.id);
    else if (op.op === 'insert') { subtree(op.node); if (op.parent) ids.add(op.parent); }
    else if (op.op === 'remove' && op.parent) ids.add(op.parent);
  }
  for (const id of ids) if (!doc.has(id)) ids.delete(id);
  return ids;
}
