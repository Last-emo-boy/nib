import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import { applyOp, childrenOf, DocEditor, PenDoc, type Op } from '@nib/core';
import { parsePen, serializePen, type Node, type PenDocument } from '@nib/format';
import { ExecSession, type ExecuteRequest, type ExecuteResult, type Exporter, type ExportFormat } from '@nib/exec';
import type { ImageLoader, Renderer } from '@nib/render';

/** Version written into new documents: the newest seen in files pen.dev saved. */
export const NEW_DOCUMENT_VERSION = '2.20';

/** Who made a change: a person in an editor, or an agent through MCP. */
export type Source = { kind: 'user'; client?: string } | { kind: 'agent'; name: string };

export type DocEvent =
  | { t: 'ops'; path: string; version: number; ops: Op[]; source: Source; label: string }
  | { t: 'reload'; path: string; version: number; data: PenDocument }
  | { t: 'history'; path: string; undo: string[]; redo: string[] };

export type Listener = (event: DocEvent) => void;

interface Entry { ops: Op[]; undo: Op[]; source: Source; label: string }

export interface OpenDocument {
  path: string;
  session: ExecSession;
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
      const doc = await this.load(path, text, notes);
      const session = await ExecSession.open(doc, {
        renderer: this.opts.renderer,
        images: this.opts.images(path),
        baseDir: dirname(path),
        exporters: this.opts.exporters,
        timeoutMs: this.opts.timeoutMs,
      });
      open = { path, session, text, mtimeMs, queue: Promise.resolve(), version: 0, undo: [], redo: [], listeners: new Set(), pending: [] };
      this.docs.set(path, open);
      if (this.opts.watch !== false) this.watchFile(open);
    }
    this.active = path;
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
  async edit(path: string, ops: Op[], source: Source, label: string): Promise<number> {
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
      await this.record(open, { ops: tx.ops, undo: tx.undo, source, label });
      return open.version;
    });
  }

  /** Undo the latest change to the document, whoever made it. */
  undo(path: string): Promise<boolean> {
    return this.step(path, 'undo');
  }

  redo(path: string): Promise<boolean> {
    return this.step(path, 'redo');
  }

  subscribe(path: string, listener: Listener): () => void {
    const open = this.require(path);
    open.listeners.add(listener);
    return () => open.listeners.delete(listener);
  }

  snapshot(path: string): { version: number; data: PenDocument; undo: string[]; redo: string[] } {
    const open = this.require(path);
    return { version: open.version, data: open.session.doc.data, ...labels(open) };
  }

  /** Markdown summary of the open documents for `get_app_state`. */
  async appState(filePath?: string, editorUrl?: string): Promise<string> {
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
    if (editorUrl) out.push(`The user can watch and edit these documents live in the nib editor: ${editorUrl}`);
    out.push('Read the design guide with read_skill() before your first execute call.');
    if (notes.length) out.push('', ...notes.map((n) => `Note: ${n}`));
    return out.join('\n');
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
      const ops = dir === 'undo' ? entry.undo : entry.ops;
      for (const op of ops) applyOp(open.session.doc, op);
      (dir === 'undo' ? open.redo : open.undo).push(entry);
      open.session.invalidate();
      open.version++;
      await this.save(open);
      this.emit(open, { t: 'ops', path: open.path, version: open.version, ops, source: entry.source, label: `${dir === 'undo' ? 'Undo' : 'Redo'} ${entry.label}` });
      this.emit(open, { t: 'history', path: open.path, ...labels(open) });
      return true;
    });
  }

  private async record(open: OpenDocument, entry: Entry): Promise<void> {
    open.undo.push(entry);
    if (open.undo.length > HISTORY_LIMIT) open.undo.shift();
    open.redo = [];
    open.version++;
    // Saved before anyone hears of it: a change an editor shows is on disk. Nothing else can change the
    // document meanwhile, since changes run one at a time.
    await this.save(open);
    this.emit(open, { t: 'ops', path: open.path, version: open.version, ops: entry.ops, source: entry.source, label: entry.label });
    this.emit(open, { t: 'history', path: open.path, ...labels(open) });
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
      doc = await this.load(open.path, text, notes);
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
    this.emit(open, { t: 'reload', path: open.path, version: open.version, data: doc.data });
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

  private async load(path: string, text: string, notes: string[], seen = new Set<string>()): Promise<PenDoc> {
    seen.add(path);
    const doc = new PenDoc(parsePen(text));
    for (const [alias, rel] of Object.entries(doc.data.imports ?? {})) {
      const file = resolvePath(dirname(path), rel);
      if (seen.has(file)) { notes.push(`import "${alias}" (${rel}) imports this document again; skipped.`); continue; }
      try {
        doc.imports.set(alias, await this.load(file, await readFile(file, 'utf8'), notes, seen));
      } catch (e) {
        notes.push(`import "${alias}" (${rel}) could not be read: ${(e as Error).message}`);
      }
    }
    return doc;
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
  if (doc.imports.size) lines.push(`Imports: ${[...doc.imports.keys()].map((a) => `\`${a}\``).join(', ')} (address their nodes and variables as alias:id)`);
  return lines.join('\n');
}
