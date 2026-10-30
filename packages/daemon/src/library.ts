import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import { buildScene, PenDoc, type SceneNode } from '@nib/core';
import { parsePen, serializePen, type PenDocument } from '@nib/format';
import type { ImageLoader, Renderer } from '@nib/render';
import { INFO_FILE } from './info.ts';
import { NEW_DOCUMENT_VERSION } from './host.ts';

/** nib's own files: recents list, drafts, thumbnail cache. Next to the daemon info file. */
export const NIB_HOME = dirname(INFO_FILE);
export const DRAFTS_DIR = join(NIB_HOME, 'drafts');
const RECENTS_FILE = join(NIB_HOME, 'recents.json');
const THUMBS_DIR = join(NIB_HOME, 'thumbnails');
const RECENTS_LIMIT = 40;

export interface FileEntry {
  path: string;
  name: string;
  /** Folder name, for display. */
  folder: string;
  modified: number;
  opened?: number;
  draft: boolean;
}

/** Remember that a document was opened (by an editor or an agent). */
export async function noteOpened(path: string): Promise<void> {
  const list = await readRecents();
  const next = [{ path, opened: Date.now() }, ...list.filter((r) => r.path !== path)].slice(0, RECENTS_LIMIT);
  await mkdir(NIB_HOME, { recursive: true });
  await writeFile(RECENTS_FILE, JSON.stringify(next, null, 2));
}

async function readRecents(): Promise<{ path: string; opened: number }[]> {
  try {
    const v = JSON.parse(await readFile(RECENTS_FILE, 'utf8'));
    return Array.isArray(v) ? v.filter((r) => typeof r?.path === 'string') : [];
  } catch {
    return [];
  }
}

async function entry(path: string, opened?: number): Promise<FileEntry | undefined> {
  const st = await stat(path).catch(() => undefined);
  if (!st?.isFile()) return undefined;
  return { path, name: basename(path), folder: basename(dirname(path)), modified: st.mtimeMs, opened, draft: dirname(path) === DRAFTS_DIR };
}

/** Recently opened documents that still exist, newest first. */
export async function recents(): Promise<FileEntry[]> {
  const list = await readRecents();
  return (await Promise.all(list.map((r) => entry(r.path, r.opened)))).filter((e): e is FileEntry => !!e);
}

/** Untitled documents made from the dashboard, newest first. */
export async function drafts(): Promise<FileEntry[]> {
  const names = await readdir(DRAFTS_DIR).catch(() => [] as string[]);
  const list = (await Promise.all(names.filter((n) => n.endsWith('.pen')).map((n) => entry(join(DRAFTS_DIR, n))))).filter((e): e is FileEntry => !!e);
  return list.sort((a, b) => b.modified - a.modified);
}

/** A new draft (from a template's document, or empty), named Untitled, Untitled 2, ... */
export async function newDraft(data?: PenDocument, name = 'Untitled'): Promise<string> {
  await mkdir(DRAFTS_DIR, { recursive: true });
  const base = name.replace(/[/\\:]/g, '-').trim() || 'Untitled';
  for (let i = 1; ; i++) {
    const path = join(DRAFTS_DIR, `${base}${i > 1 ? ` ${i}` : ''}.pen`);
    try {
      await writeFile(path, serializePen(data ?? ({ version: NEW_DOCUMENT_VERSION, children: [] } as PenDocument)), { flag: 'wx' });
      return path;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
}

/**
 * A PNG overview of a document's canvas, at most `size` px on its longer side. Cached on disk by path and
 * modification time, so the dashboard only renders files that changed.
 */
export async function thumbnail(renderer: Renderer, images: (file: string) => ImageLoader, file: string, size = 480): Promise<Uint8Array | undefined> {
  const path = resolvePath(file);
  const st = await stat(path).catch(() => undefined);
  if (!st) return undefined;
  const key = createHash('sha1').update(`${path}|${st.mtimeMs}|${size}`).digest('hex');
  const cached = join(THUMBS_DIR, `${key}.png`);
  const hit = await readFile(cached).catch(() => undefined);
  if (hit) return new Uint8Array(hit);
  const doc = new PenDoc(parsePen(await readFile(path, 'utf8')));
  const loader = images(path);
  const parts: { scene: SceneNode; x: number; y: number; w: number; h: number }[] = [];
  for (const n of doc.data.children) {
    const scene = buildScene(doc, n);
    if (!scene) continue;
    const prepared = await renderer.prepare(scene, loader);
    const b = prepared.layout.box(scene);
    prepared.dispose();
    if (b.width > 0 && b.height > 0) parts.push({ scene, x: b.x, y: b.y, w: b.width, h: b.height });
  }
  if (!parts.length) return undefined;
  const x0 = Math.min(...parts.map((p) => p.x)), y0 = Math.min(...parts.map((p) => p.y));
  const x1 = Math.max(...parts.map((p) => p.x + p.w)), y1 = Math.max(...parts.map((p) => p.y + p.h));
  const root: SceneNode = {
    id: 'thumbnail', type: 'frame', layout: 'none', x: 0, y: 0, width: x1 - x0, height: y1 - y0,
    children: parts.map((p) => ({ ...p.scene, x: p.x - x0, y: p.y - y0 })),
  };
  const png = await renderer.renderNode(root, root, loader, { scale: Math.min(1, size / Math.max(x1 - x0, y1 - y0)) });
  await mkdir(THUMBS_DIR, { recursive: true });
  await writeFile(cached, png);
  return png;
}
