import { applyOp, DocEditor, PenDoc, type Op } from '@nib/core';
import { parsePen, serializePen } from '@nib/format';
import type { ConnectionEvent, DocConnection, Source } from '../app/connection.ts';
import { store } from '../app/store.ts';
import { webDocId } from './mode.ts';
import { access, fileIn, getDoc, putDoc, type WebDoc } from './storage.ts';

interface Entry { ops: Op[]; undo: Op[]; label: string; merge?: string }
const HISTORY_LIMIT = 200;

/**
 * A document kept in the browser (nib's website): edits apply here, undo and redo work as the daemon's do,
 * and each change is saved to the browser and, when the person allowed it, to the file it came from.
 */
export class LocalConnection implements DocConnection {
  readonly path: string;
  doc: PenDoc | undefined;
  version = 0;
  readonly client = `web-${Math.random().toString(36).slice(2, 8)}`;
  private id: string;
  private record: WebDoc | undefined;
  private listeners = new Set<(e: ConnectionEvent) => void>();
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private saving: ReturnType<typeof setTimeout> | undefined;

  constructor(path: string) {
    this.path = path;
    this.id = webDocId(path);
    void this.load();
  }

  on(listener: (e: ConnectionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: ConnectionEvent): void {
    for (const l of this.listeners) l(e);
  }

  private async load(): Promise<void> {
    this.emit({ t: 'status', status: 'connecting' });
    const rec = await getDoc(this.id);
    if (!rec) { this.emit({ t: 'status', status: 'closed', error: 'This document is not in this browser.' }); return; }
    this.record = rec;
    let text = rec.text;
    // The file it came from, when nib may read it and it changed since (edited elsewhere).
    if (rec.handle && (await access(rec.handle, 'read', false))) {
      try {
        const file = await rec.handle.getFile();
        if (file.lastModified > rec.updated) text = await file.text();
      } catch { /* moved or deleted: keep the browser's copy */ }
    }
    this.doc = new PenDoc(parsePen(text));
    await this.loadImports();
    this.emit({ t: 'status', status: 'open' });
    this.emit({ t: 'doc', doc: this.doc, version: this.version });
    this.emit({ t: 'history', undo: [], redo: [] });
    store.set({ webSave: { where: rec.handle && (await access(rec.handle, 'readwrite', false)) ? 'disk' : 'browser', ...(rec.handle ? { file: rec.handle.name } : {}) } });
  }

  /** Libraries the document imports, read from its folder when the person allowed nib to see it. */
  private async loadImports(): Promise<void> {
    const dir = this.record?.dir;
    if (!this.doc || !dir || !(await access(dir, 'read', false))) return;
    const read = async (doc: PenDoc, depth: number) => {
      for (const [alias, rel] of Object.entries(doc.data.imports ?? {})) {
        const h = await fileIn(dir, rel);
        if (!h || depth > 4) continue;
        try {
          const sub = new PenDoc(parsePen(await (await h.getFile()).text()));
          await read(sub, depth + 1);
          doc.imports.set(alias, sub);
        } catch { /* not a .pen nib can read: its components stay missing */ }
      }
    };
    await read(this.doc, 0);
  }

  edit(ops: Op[], label: string, merge?: string): Promise<void> {
    if (!ops.length || !this.doc) return Promise.resolve();
    const editor = new DocEditor(this.doc);
    editor.begin();
    try {
      // Copies: an inserted node goes into the document, where later edits change it in place.
      for (const op of structuredClone(ops)) editor.apply(op);
    } catch (e) {
      editor.rollback();
      return Promise.reject(e);
    }
    const tx = editor.commit();
    const entry: Entry = { ops: structuredClone(ops), undo: structuredClone(tx.undo), label, ...(merge ? { merge } : {}) };
    const last = this.undoStack.at(-1);
    if (merge && last?.merge === merge && !this.redoStack.length) this.undoStack[this.undoStack.length - 1] = { ...last, ops: [...last.ops, ...entry.ops], undo: [...entry.undo, ...last.undo], label };
    else {
      this.undoStack.push(entry);
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    }
    this.redoStack = [];
    this.changed(structuredClone(ops), label);
    return Promise.resolve();
  }

  undo(): void { this.step('undo'); }
  redo(): void { this.step('redo'); }

  private step(dir: 'undo' | 'redo'): void {
    if (!this.doc) return;
    const entry = (dir === 'undo' ? this.undoStack : this.redoStack).pop();
    if (!entry) return;
    const ops = structuredClone(dir === 'undo' ? entry.undo : entry.ops);
    for (const op of structuredClone(ops)) applyOp(this.doc, op);
    (dir === 'undo' ? this.redoStack : this.undoStack).push(entry);
    this.changed(ops, `${dir === 'undo' ? 'Undo' : 'Redo'} ${entry.label}`);
  }

  private changed(ops: Op[], label: string): void {
    this.version++;
    const source: Source = { kind: 'user', client: this.client };
    this.emit({ t: 'change', change: { version: this.version, ops, source, label, at: Date.now(), mine: true } });
    this.emit({ t: 'history', undo: this.undoStack.map((e) => e.label), redo: this.redoStack.map((e) => e.label) });
    clearTimeout(this.saving);
    this.saving = setTimeout(() => void this.save(), 300);
  }

  /** To the browser always; to the file too when nib may write it (asking only from a click: `ask`). */
  async save(ask = false): Promise<void> {
    if (!this.doc || !this.record) return;
    clearTimeout(this.saving);
    const text = serializePen(this.doc.data);
    this.record = { ...this.record, text, updated: Date.now() };
    await putDoc(this.record);
    const h = this.record.handle;
    if (!h) { store.set({ webSave: { where: 'browser' } }); return; }
    if (!(await access(h, 'readwrite', ask))) { store.set({ webSave: { where: 'browser', file: h.name } }); return; }
    try {
      const w = await h.createWritable();
      await w.write(text);
      await w.close();
      store.set({ webSave: { where: 'disk', file: h.name } });
    } catch (e) {
      store.set({ webSave: { where: 'browser', file: h.name, error: (e as Error).message } });
    }
  }

  /** Link the document to a file (from a click): the file chosen, written now and after each change. */
  async linkFile(handle: FileSystemFileHandle): Promise<void> {
    if (!this.record) return;
    this.record = { ...this.record, handle };
    await putDoc(this.record);
    await this.save(true);
  }

  /** Let nib see the document's folder (from a click): its pictures and libraries. */
  async linkFolder(dir: FileSystemDirectoryHandle): Promise<void> {
    if (!this.record) return;
    this.record = { ...this.record, dir };
    await putDoc(this.record);
    await this.loadImports();
    if (this.doc) this.emit({ t: 'doc', doc: this.doc, version: this.version });
  }

  /** The document as it is now, as a .pen file's text. */
  text(): string {
    return this.doc ? serializePen(this.doc.data) : '';
  }

  get name(): string { return this.record?.name ?? 'Untitled'; }
  get folder(): FileSystemDirectoryHandle | undefined { return this.record?.dir; }

  close(): void {
    if (this.saving) void this.save();
    this.listeners.clear();
  }
}
