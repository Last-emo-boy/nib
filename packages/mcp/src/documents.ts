import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve as resolvePath, basename } from 'node:path';
import { PenDoc } from '@nib/core';
import { parsePen, serializePen, type PenDocument } from '@nib/format';
import { ExecSession, type Exporter, type ExecuteRequest, type ExecuteResult } from '@nib/exec';
import type { ExportFormat } from '@nib/exec';
import type { ImageLoader, Renderer } from '@nib/render';

/** Version written into new documents: the newest seen in files pen.dev saved. */
export const NEW_DOCUMENT_VERSION = '2.20';

export interface OpenDocument {
  path: string;
  session: ExecSession;
  /** File text as last read or written by us. */
  text: string;
  mtimeMs: number;
  /** Executes run one at a time per document. */
  queue: Promise<unknown>;
}

export interface HostOptions {
  renderer: Renderer;
  images: (penFile: string) => ImageLoader;
  exporters?: Partial<Record<ExportFormat, Exporter>>;
  timeoutMs?: number;
}

/**
 * The .pen files agents work on. Each file is read on first use, saved after every snippet that changed it,
 * and reloaded when it changed on disk in between.
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
      open = { path, session, text, mtimeMs, queue: Promise.resolve() };
      this.docs.set(path, open);
    }
    this.active = path;
    return open;
  }

  /** Pick up changes made on disk, after any snippet still running on the document. */
  sync(open: OpenDocument, notes: string[] = []): Promise<void> {
    const run = open.queue.then(() => this.refresh(open, notes));
    open.queue = run.catch(() => undefined);
    return run;
  }

  async execute(filePath: string, req: ExecuteRequest): Promise<ExecuteResult & { notes: string[] }> {
    const notes: string[] = [];
    const open = await this.open(filePath, notes);
    const run = open.queue.then(async () => {
      await this.refresh(open, notes);
      const result = await open.session.execute(req);
      if (result.ops.length) await this.save(open);
      return { ...result, notes };
    });
    open.queue = run.catch(() => undefined);
    return run;
  }

  /** Reload when the file changed on disk since we last read or wrote it. */
  private async refresh(open: OpenDocument, notes: string[]): Promise<void> {
    const st = await stat(open.path).catch(() => undefined);
    if (!st || st.mtimeMs === open.mtimeMs) return;
    const text = await readFile(open.path, 'utf8');
    open.mtimeMs = st.mtimeMs;
    if (text === open.text) return;
    open.text = text;
    await open.session.reset(await this.load(open.path, text, notes));
    notes.push(`${basename(open.path)} changed on disk and was reloaded; ids you saved may no longer exist.`);
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
    const tmp = join(dirname(open.path), `.${basename(open.path)}.${process.pid}.tmp`);
    await writeFile(tmp, text);
    await rename(tmp, open.path);
    open.text = text;
    open.mtimeMs = (await stat(open.path)).mtimeMs;
  }
}

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
