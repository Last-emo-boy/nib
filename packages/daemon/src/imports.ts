import { readFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { PenDoc } from '@nib/core';
import { parsePen, type PenDocument } from '@nib/format';

/** A document's imported documents as editors receive them: alias -> its data and its own imports. */
export interface ImportTree { [alias: string]: { data: PenDocument; imports: ImportTree } }

/** The `imports` each document was last loaded with, to tell when they change. */
const loadedWith = new WeakMap<PenDoc, string>();

/** Parse `text` (the file at `path`) and load the documents it imports, recursively. Problems go into `notes`. */
export async function loadPen(path: string, text: string, notes: string[], seen = new Set<string>()): Promise<PenDoc> {
  const doc = new PenDoc(parsePen(text));
  await loadImports(doc, path, notes, seen);
  return doc;
}

/** Load the documents `doc` (the file at `path`) imports, replacing any loaded before. */
async function loadImports(doc: PenDoc, path: string, notes: string[], seen = new Set<string>()): Promise<void> {
  seen = new Set(seen).add(resolvePath(path));
  doc.imports.clear();
  for (const [alias, rel] of Object.entries(doc.data.imports ?? {})) {
    const file = resolvePath(dirname(path), rel);
    if (seen.has(file)) { notes.push(`import "${alias}" (${rel}) imports this document again; skipped.`); continue; }
    try {
      doc.imports.set(alias, await loadPen(file, await readFile(file, 'utf8'), notes, seen));
    } catch (e) {
      notes.push(`import "${alias}" (${rel}) could not be read: ${(e as Error).message}`);
    }
  }
  loadedWith.set(doc, JSON.stringify(doc.data.imports ?? {}));
}

/** Reload `doc`'s imports if its `imports` changed since they were loaded; true when they did. */
export async function syncImports(doc: PenDoc, path: string, notes: string[]): Promise<boolean> {
  if (loadedWith.get(doc) === JSON.stringify(doc.data.imports ?? {})) return false;
  await loadImports(doc, path, notes);
  return true;
}

export function importTree(doc: PenDoc): ImportTree {
  const out: ImportTree = {};
  for (const [alias, d] of doc.imports) out[alias] = { data: d.data, imports: importTree(d) };
  return out;
}
