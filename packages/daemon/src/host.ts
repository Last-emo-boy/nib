import { watch, type FSWatcher } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import { applyOp, childrenOf, DocEditor, PenDoc, type Op } from '@nib/core';
import { parsePen, serializePen, type Node, type PenDocument, type Variable } from '@nib/format';
import { importTree, loadPen, syncImports, type ImportTree } from './imports.ts';
import { noteOpened } from './library.ts';
import { ExecSession, partsOf, type ExecuteRequest, type ExecuteResult, type Exporter, type ExportFormat, type PictureRequest, type Problem, type ReviewItem } from '@nib/exec';
import type { Pictures } from './pictures.ts';
import type { ImageLoader, Renderer } from '@nib/render';

/** Version written into new documents: the newest seen in files pen.dev saved. */
export const NEW_DOCUMENT_VERSION = '2.20';

/** Who made a change: a person in an editor, or an agent through MCP. */
export type Source = { kind: 'user'; client?: string } | { kind: 'agent'; name: string };

export type DocEvent =
  | { t: 'ops'; path: string; version: number; ops: Op[]; source: Source; label: string }
  | { t: 'reload'; path: string; version: number; data: PenDocument; imports: ImportTree }
  | { t: 'history'; path: string; undo: string[]; redo: string[] }
  /** An image the document uses changed without its url changing (a browser node's page snapshot). */
  | { t: 'asset'; path: string; url: string }
  /** The file was renamed: editors follow it to `to`. */
  | { t: 'moved'; path: string; to: string }
  /** The file was deleted (moved to nib's trash): editors leave it. */
  | { t: 'deleted'; path: string };

export type Listener = (event: DocEvent) => void;

/** An undo step; `merge` lets the next change with the same key (a drag in progress) join it. */
interface Entry { ops: Op[]; undo: Op[]; source: Source; label: string; merge?: string }

export interface OpenDocument {
  path: string;
  session: ExecSession;
  images: ImageLoader;
  /** File text as last read or written by us. */
  text: string;
  mtimeMs: number;
  /** Changes run one at a time per document. */
  queue: Promise<unknown>;
  version: number;
  undo: Entry[];
  redo: Entry[];
  listeners: Set<Listener>;
  watcher?: FSWatcher;
  /** Notes from reloads nobody asked for (file watch), for the next agent call. */
  pending: string[];
}

export interface HostOptions {
  renderer: Renderer;
  images: (penFile: string) => ImageLoader;
  exporters?: Partial<Record<ExportFormat, Exporter>>;
  timeoutMs?: number;
  /** Watch open files and reload them when they change on disk. Default true. */
  watch?: boolean;
  /** Where Generate gets pictures (absent: it fails, saying so). */
  pictures?: Pictures;
}

const HISTORY_LIMIT = 200;
const LIST_LIMIT = 60;

/**
 * The .pen documents in use. Each is read on first use, changed one transaction at a time by editors
 * (`edit`) and agents (`execute`), saved after every change, and reloaded when it changes on disk.
 * Every change goes out to subscribers as the ops that make it, and into one undo history.
 */
export class DocumentHost {
  private docs = new Map<string, OpenDocument>();
  private opts: HostOptions;
  /** The document used last. */
  active: string | undefined;

  constructor(opts: HostOptions) {
    this.opts = opts;
  }

  list(): OpenDocument[] {
    return [...this.docs.values()];
  }

  /** Open `filePath` (relative paths resolve against the working directory). Notes say what happened. */
  async open(filePath: string, notes: string[] = []): Promise<OpenDocument> {
    const path = resolvePath(filePath);
    if (!path.endsWith('.pen')) throw new Error(`"${filePath}" is not a .pen file`);
    let open = this.docs.get(path);
    if (open) {
      await this.sync(open, notes);
    } else {
      const { text, mtimeMs, created } = await readOrCreate(path);
      if (created) notes.push(`Created a new empty document at ${path}.`);
      const doc = await loadPen(path, text, notes);
      const images = this.opts.images(path);
      const session = await ExecSession.open(doc, {
        renderer: this.opts.renderer,
        images,
        baseDir: dirname(path),
        exporters: this.opts.exporters,
        timeoutMs: this.opts.timeoutMs,
        ...(this.opts.pictures ? { pictures: (req: PictureRequest) => this.opts.pictures!.make(req, dirname(path)) } : {}),
      });
      open = { path, session, images, text, mtimeMs, queue: Promise.resolve(), version: 0, undo: [], redo: [], listeners: new Set(), pending: [] };
      this.docs.set(path, open);
      if (this.opts.watch !== false) this.watchFile(open);
    }
    this.active = path;
    await noteOpened(path).catch(() => undefined);
    return open;
  }

  /** Pick up changes made on disk, after any change still running on the document. */
  sync(open: OpenDocument, notes: string[] = []): Promise<void> {
    return this.enqueue(open, () => this.refresh(open, notes));
  }

  async execute(filePath: string, req: ExecuteRequest, agent = 'agent'): Promise<ExecuteResult & { notes: string[] }> {
    const notes: string[] = [];
    const open = await this.open(filePath, notes);
    return this.enqueue(open, async () => {
      await this.refresh(open, notes);
      notes.push(...open.pending.splice(0));
      const result = await open.session.execute(req);
      if (result.ops.length) await this.record(open, { ops: result.ops, undo: result.undo, source: { kind: 'agent', name: agent }, label: `${agent}: execute` });
      return { ...result, notes };
    });
  }

  /** Apply ops made by an editor as one undoable change. Throws, changing nothing, when one does not apply. */
  /**
   * Apply `ops` as one change. With `merge`, a change right after another with the same key and source joins
   * its undo step (the steps of a drag undo at once).
   */
  async edit(path: string, ops: Op[], source: Source, label: string, merge?: string): Promise<number> {
    const open = this.require(path);
    return this.enqueue(open, async () => {
      const editor = new DocEditor(open.session.doc);
      editor.begin();
      try {
        for (const op of ops) editor.apply(op);
      } catch (e) {
        editor.rollback();
        throw e;
      }
      const tx = editor.commit();
      open.session.invalidate();
      await this.record(open, { ops: tx.ops, undo: tx.undo, source, label, ...(merge ? { merge } : {}) });
      return open.version;
    });
  }

  /**
   * Put the document back to `data` (a snapshot taken earlier) as one undoable change: top-level nodes
   * that differ are replaced, and variables, themes and imports set as they were.
   */
  async restore(path: string, data: PenDocument, source: Source, label: string): Promise<number> {
    const open = this.require(path);
    const now = open.session.doc.data;
    const ops: Op[] = [];
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const ids = (list: Node[]) => list.map((n) => n.id).join('|');
    if (ids(now.children) === ids(data.children)) {
      data.children.forEach((n, i) => {
        if (same(n, now.children[i])) return;
        ops.push({ op: 'remove', parent: null, index: i }, { op: 'insert', parent: null, index: i, node: structuredClone(n) });
      });
    } else {
      for (let i = now.children.length - 1; i >= 0; i--) ops.push({ op: 'remove', parent: null, index: i });
      data.children.forEach((n, i) => ops.push({ op: 'insert', parent: null, index: i, node: structuredClone(n) }));
    }
    const props: Record<string, unknown> = {};
    const unset: string[] = [];
    for (const k of ['variables', 'themes', 'imports'] as const) {
      if (same(now[k], data[k])) continue;
      if (data[k] === undefined) unset.push(k); else props[k] = structuredClone(data[k]);
    }
    if (Object.keys(props).length || unset.length) ops.push({ op: 'document', props, ...(unset.length ? { unset } : {}) });
    if (!ops.length) return open.version;
    return this.edit(path, ops, source, label);
  }

  /**
   * Add variables (and the theme values they use) to a document as one undoable change; variables of the
   * same name are replaced.
   */
  async addVariables(path: string, variables: Record<string, Variable>, themes: Record<string, string[]> | undefined, source: Source, label: string): Promise<void> {
    const open = this.require(path);
    const data = open.session.doc.data;
    const merged = { ...(data.variables ?? {}), ...variables };
    const axes = { ...(data.themes ?? {}) };
    for (const [axis, values] of Object.entries(themes ?? {})) axes[axis] = [...new Set([...(axes[axis] ?? []), ...values])];
    await this.edit(path, [{ op: 'document', props: { variables: merged, ...(Object.keys(axes).length ? { themes: axes } : {}) } }], source, label);
  }

  /** Undo the latest change to the document, whoever made it. */
  undo(path: string): Promise<boolean> {
    return this.step(path, 'undo');
  }

  redo(path: string): Promise<boolean> {
    return this.step(path, 'redo');
  }

  /** Problems anywhere in the document (the problems panel). */
  problems(path: string): Promise<Problem[]> {
    const open = this.require(path);
    return this.enqueue(open, () => open.session.problems());
  }

  /** Top-level frame `id` against a picture of its implementation: see ExecSession.implementationFacts. */
  implementationFacts(path: string, id: string, picture: Uint8Array): ReturnType<ExecSession['implementationFacts']> {
    const open = this.require(path);
    return this.enqueue(open, () => open.session.implementationFacts(id, picture));
  }

  review(path: string, scope?: string, opts: { overflow?: boolean } = {}): Promise<ReviewItem[]> {
    const open = this.require(path);
    return this.enqueue(open, () => open.session.review(scope, opts));
  }

  /** Write a copy of the document to `target` (not overwriting a file) and return its absolute path. */
  async saveAs(path: string, target: string): Promise<string> {
    const open = this.require(path);
    const dest = resolvePath(target);
    if (!dest.endsWith('.pen')) throw new Error('the new file must end in .pen');
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, serializePen(open.session.doc.data), { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => {
      throw new Error(e.code === 'EEXIST' ? `${dest} already exists` : e.message);
    });
    return dest;
  }

  /** Rename an open document's file (in the same folder, so its relative paths still hold); returns the new path. */
  async rename(path: string, target: string): Promise<string> {
    const open = this.require(path);
    const dest = resolvePath(target);
    if (dirname(dest) !== dirname(open.path)) throw new Error('a document can only be renamed within its folder');
    if (await stat(dest).catch(() => undefined)) throw new Error(`${dest} already exists`);
    return this.enqueue(open, async () => {
      open.watcher?.close();
      await rename(open.path, dest);
      const from = open.path;
      this.docs.delete(open.path);
      if (this.active === open.path) this.active = dest;
      open.path = dest;
      this.docs.set(dest, open);
      if (this.opts.watch !== false) this.watchFile(open);
      await noteOpened(dest).catch(() => undefined);
      this.emit(open, { t: 'moved', path: from, to: dest });
      return dest;
    });
  }

  /** Stop holding a document whose file is going away: its editors are told, then it is closed. */
  async discard(path: string): Promise<void> {
    const open = this.docs.get(resolvePath(path));
    if (!open) return;
    await this.enqueue(open, async () => {
      this.emit(open, { t: 'deleted', path: open.path });
      open.watcher?.close();
      this.docs.delete(open.path);
      if (this.active === open.path) this.active = undefined;
    });
  }

  /** Export nodes and return the files' bytes, for an editor to download. */
  async exportNodes(path: string, ids: string[], format: ExportFormat, scale?: number, fragment = false): Promise<{ name: string; data: Uint8Array }[]> {
    const open = this.require(path);
    const dir = await mkdtemp(join(tmpdir(), 'nib-export-'));
    try {
      const single = format === 'pdf' || format.startsWith('html') || format === 'react-tailwind';
      const ext = format === 'pdf' ? 'pdf' : format === 'react-tailwind' ? 'tsx' : 'html';
      const target = single ? join(dir, `${basename(open.path, '.pen')}.${ext}`) : dir;
      const options = { ...(scale ? { scale } : {}), ...(fragment ? { includeHtmlScaffold: false } : {}) };
      const r = await this.enqueue(open, () => open.session.execute({ input: `Export(${JSON.stringify(ids)}, ${JSON.stringify(format)}, ${JSON.stringify(target)}, ${JSON.stringify(options)})` }));
      if (!r.ok || r.text.includes('export to')) throw new Error(r.text.split('\n').find((l) => l.includes('Error') || l.includes('failed')) ?? 'export failed');
      const files = await readdir(dir);
      return Promise.all(files.map(async (name) => ({ name, data: new Uint8Array(await readFile(join(dir, name))) })));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** The image at `url` has new bytes: renders load it again and editors are told to. */
  assetChanged(filePath: string, url: string): void {
    const open = this.docs.get(resolvePath(filePath));
    if (!open) return;
    this.opts.renderer.images(open.images).forget(url);
    this.emit(open, { t: 'asset', path: open.path, url });
  }

  subscribe(path: string, listener: Listener): () => void {
    const open = this.require(path);
    open.listeners.add(listener);
    return () => open.listeners.delete(listener);
  }

  snapshot(path: string): { version: number; data: PenDocument; imports: ImportTree; undo: string[]; redo: string[] } {
    const open = this.require(path);
    return { version: open.version, data: open.session.doc.data, imports: importTree(open.session.doc), ...labels(open) };
  }

  /** Import the document at `rel` (relative to this one) as `alias`, as one undoable change. */
  async addImport(path: string, alias: string, rel: string, source: Source): Promise<void> {
    const open = this.require(path);
    const imports = { ...(open.session.doc.data.imports ?? {}), [alias]: rel };
    await this.edit(path, [{ op: 'document', props: { imports } }], source, `Import ${alias}`);
  }

  /** Markdown summary of the open documents for `get_app_state`. */
  async appState(filePath?: string, editorUrl?: (file?: string) => string): Promise<string> {
    const notes: string[] = [];
    if (filePath) await this.open(filePath, notes);
    const docs = this.list();
    for (const d of docs) {
      await this.sync(d, notes);
      notes.push(...d.pending.splice(0));
    }
    const out = ['# nib state', ''];
    if (!docs.length) {
      out.push('No document is open. Pass `filePath` (an absolute path to a .pen file) to get_app_state or execute to open one; a missing file is created.');
    }
    for (const d of docs) out.push(describe(d, d.path === this.active), '');
    if (editorUrl && docs.length) out.push(`The user can watch and edit ${this.active ? 'this document' : 'these documents'} live in the nib editor: ${editorUrl(this.active)}`);
    out.push('Read the design guide with read_skill() before your first execute call.');
    if (notes.length) out.push('', ...notes.map((n) => `Note: ${n}`));
    return out.join('\n');
  }

  /** One document's state as get_app_state describes it (opening it if needed), for nib's own agent. */
  async describeDocument(filePath: string): Promise<string> {
    const notes: string[] = [];
    const d = await this.open(filePath, notes);
    await this.sync(d, notes);
    notes.push(...d.pending.splice(0));
    return [describe(d, true), ...notes.map((n) => `Note: ${n}`)].join('\n');
  }

  close(): void {
    for (const d of this.docs.values()) {
      d.watcher?.close();
      d.session.dispose();
    }
    this.docs.clear();
  }

  private require(path: string): OpenDocument {
    const open = this.docs.get(resolvePath(path));
    if (!open) throw new Error(`${path} is not open`);
    return open;
  }

  private enqueue<T>(open: OpenDocument, fn: () => Promise<T>): Promise<T> {
    const run = open.queue.then(fn);
    open.queue = run.catch(() => undefined);
    return run;
  }

  private step(path: string, dir: 'undo' | 'redo'): Promise<boolean> {
    const open = this.require(path);
    return this.enqueue(open, async () => {
      const from = dir === 'undo' ? open.undo : open.redo;
      const entry = from.pop();
      if (!entry) return false;
      // Copies: an insert puts its node into the document, where the ops after it (and later edits) change it
      // in place; the history and the ops sent to editors must stay as they were.
      const ops = structuredClone(dir === 'undo' ? entry.undo : entry.ops);
      for (const op of structuredClone(ops)) applyOp(open.session.doc, op);
      (dir === 'undo' ? open.redo : open.undo).push(entry);
      open.session.invalidate();
      open.version++;
      await this.save(open);
      this.emit(open, { t: 'ops', path: open.path, version: open.version, ops, source: entry.source, label: `${dir === 'undo' ? 'Undo' : 'Redo'} ${entry.label}` });
      this.emit(open, { t: 'history', path: open.path, ...labels(open) });
      await this.importsChanged(open);
      return true;
    });
  }

  private async record(open: OpenDocument, entry: Entry): Promise<void> {
    const last = open.undo[open.undo.length - 1];
    if (entry.merge && last?.merge === entry.merge && !open.redo.length && JSON.stringify(last.source) === JSON.stringify(entry.source)) {
      open.undo[open.undo.length - 1] = { ...last, ops: [...last.ops, ...entry.ops], undo: [...entry.undo, ...last.undo], label: entry.label };
    } else {
      open.undo.push(entry);
      if (open.undo.length > HISTORY_LIMIT) open.undo.shift();
    }
    open.redo = [];
    open.version++;
    // Saved before anyone hears of it: a change an editor shows is on disk. Nothing else can change the
    // document meanwhile, since changes run one at a time.
    await this.save(open);
    this.emit(open, { t: 'ops', path: open.path, version: open.version, ops: entry.ops, source: entry.source, label: entry.label });
    this.emit(open, { t: 'history', path: open.path, ...labels(open) });
    await this.importsChanged(open);
  }

  /** After a change to `imports`: load what it imports now, and send editors the document with them. */
  private async importsChanged(open: OpenDocument): Promise<void> {
    const doc = open.session.doc;
    if (!(await syncImports(doc, open.path, open.pending))) return;
    open.session.invalidate();
    this.emit(open, { t: 'reload', path: open.path, version: open.version, data: doc.data, imports: importTree(doc) });
  }

  /** Listeners serialize each event when they get it, before anything changes the document again. */
  private emit(open: OpenDocument, event: DocEvent): void {
    for (const l of open.listeners) {
      try {
        l(event);
      } catch (e) {
        process.stderr.write(`nib: listener failed: ${(e as Error).message}\n`);
      }
    }
  }

  /** Reload when the file changed on disk since we last read or wrote it. */
  private async refresh(open: OpenDocument, notes: string[]): Promise<void> {
    const st = await stat(open.path).catch(() => undefined);
    if (!st || st.mtimeMs === open.mtimeMs) return;
    const text = await readFile(open.path, 'utf8');
    open.mtimeMs = st.mtimeMs;
    if (text === open.text) return;
    let doc: PenDoc;
    try {
      doc = await loadPen(open.path, text, notes);
    } catch (e) {
      notes.push(`${basename(open.path)} changed on disk but could not be read (${(e as Error).message}); keeping the open version.`);
      return;
    }
    open.text = text;
    await open.session.reset(doc);
    open.undo = [];
    open.redo = [];
    open.version++;
    notes.push(`${basename(open.path)} changed on disk and was reloaded; ids you saved may no longer exist.`);
    this.emit(open, { t: 'reload', path: open.path, version: open.version, data: doc.data, imports: importTree(doc) });
    this.emit(open, { t: 'history', path: open.path, ...labels(open) });
  }

  private watchFile(open: OpenDocument): void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // The folder, not the file: saves (ours and other apps') replace the file, which ends a file watch.
      const name = basename(open.path);
      open.watcher = watch(dirname(open.path), (_event, file) => {
        if (file !== null && file !== name) return;
        clearTimeout(timer);
        timer = setTimeout(() => { this.sync(open, open.pending).catch(() => undefined); }, 150);
      });
      open.watcher.on('error', () => open.watcher?.close());
    } catch {
      // Not watchable (e.g. a network volume): changes are still picked up before each execute.
    }
  }

  /** Write atomically: a temporary file in the same folder, renamed over the original. */
  private async save(open: OpenDocument): Promise<void> {
    const text = serializePen(open.session.doc.data);
    if (text === open.text) return;
    const tmp = join(dirname(open.path), `.${basename(open.path)}.${process.pid}.tmp`);
    await writeFile(tmp, text);
    await rename(tmp, open.path);
    open.text = text;
    open.mtimeMs = (await stat(open.path)).mtimeMs;
  }
}

const labels = (open: OpenDocument) => ({ undo: open.undo.map((e) => e.label), redo: open.redo.map((e) => e.label) });

async function readOrCreate(path: string): Promise<{ text: string; mtimeMs: number; created: boolean }> {
  try {
    const [text, st] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    return { text, mtimeMs: st.mtimeMs, created: false };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    const text = serializePen({ version: NEW_DOCUMENT_VERSION, children: [] } as PenDocument);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, { flag: 'wx' });
    return { text, mtimeMs: (await stat(path)).mtimeMs, created: true };
  }
}

function describe(d: OpenDocument, active: boolean): string {
  const doc = d.session.doc;
  const top = doc.data.children;
  const lines = [`## ${d.path}${active ? ' (active)' : ''}`, '', `Top-level nodes (${top.length}):`];
  for (const n of top.slice(0, LIST_LIMIT)) {
    const b = d.session.box(n.id);
    const size = b ? ` ${Math.round(b.width)}×${Math.round(b.height)} at (${Math.round(b.x)}, ${Math.round(b.y)})` : n.enabled === false ? ' hidden' : '';
    lines.push(`- \`${n.id}\` ${n.type}${n.name ? ` "${n.name}"` : ''}${size}${n.reusable ? ' · component' : ''}`);
  }
  if (top.length > LIST_LIMIT) lines.push(`- … ${top.length - LIST_LIMIT} more; list them with Get(n => ...)`);
  const comps: Node[] = [];
  const visit = (n: Node) => { if (n.reusable) comps.push(n); childrenOf(n)?.forEach(visit); };
  top.forEach(visit);
  lines.push('', comps.length ? `Components (${comps.length}):` : 'Components: none');
  for (const c of comps.slice(0, LIST_LIMIT)) lines.push(`- \`${c.id}\`${c.name ? ` "${c.name}"` : ''} (${c.type})`);
  if (comps.length > LIST_LIMIT) lines.push(`- … ${comps.length - LIST_LIMIT} more`);
  const vars = Object.keys(doc.data.variables ?? {});
  lines.push('', vars.length ? `Variables: ${vars.length}${doc.data.themes ? `; themes: ${Object.entries(doc.data.themes).map(([a, v]) => `${a} = ${v.join(' | ')}`).join(', ')}` : ''} (read them with GetVariables())` : 'Variables: none');
  // A design system's components and variables are what agents build with, so list them all.
  for (const [alias, lib] of doc.imports) {
    const libComps: Node[] = [];
    const visitLib = (n: Node) => { if (n.reusable) libComps.push(n); childrenOf(n)?.forEach(visitLib); };
    lib.data.children.forEach(visitLib);
    const libVars = Object.keys(lib.data.variables ?? {});
    lines.push('', `Library \`${alias}\` (${doc.data.imports?.[alias] ?? ''}): add its components with \`Use(parent, "${alias}:id", {part: "text or icon name"}, {props})\` and use its variables as \`"$${alias}:name"\`. Each component lists its texts and icons, by the keys overrides use.`);
    lines.push(`Components (${libComps.length}):`);
    for (const c of libComps) {
      const parts = partsOf(doc, `${alias}:${c.id}`, 5).map((p) => `${p.key}${p.kind === 'icon' ? ' (icon)' : ''}`);
      lines.push(`- \`${alias}:${c.id}\`${c.name ? ` ${c.name}` : ''}${parts.length ? `: ${parts.join(', ')}` : ''}`);
    }
    if (libVars.length) lines.push(`Variables (${libVars.length}): ${libVars.join(', ')}`);
  }
  return lines.join('\n');
}
