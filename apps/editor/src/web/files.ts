import { buildScene } from '@nib/core';
import { parsePen, serializePen, type PenDocument } from '@nib/format';
import { getEngine, imagesFor } from '../canvas/engine.ts';
import { store } from '../app/store.ts';
import { webDocId, webDocPath } from './mode.ts';
import { access, fileIn, getAsset, getDoc, newId, putAsset, putDoc } from './storage.ts';

/** The File System Access pickers (Chromium); other browsers open with a file input and save by downloading. */
interface Pickers {
  showOpenFilePicker?(o?: object): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?(o?: object): Promise<FileSystemFileHandle>;
  showDirectoryPicker?(o?: object): Promise<FileSystemDirectoryHandle>;
}
const pickers = window as unknown as Pickers;
export const canLinkFiles = typeof pickers.showSaveFilePicker === 'function';
const PEN = { types: [{ description: 'nib design', accept: { 'application/json': ['.pen'] } }] };

/** A new document kept in the browser; returns its path. */
export async function createWebDoc(name: string, data?: PenDocument, handle?: FileSystemFileHandle): Promise<string> {
  const id = newId();
  await putDoc({ id, name, text: serializePen(data ?? { version: '2.20', children: [] }), updated: Date.now(), ...(handle ? { handle } : {}) });
  return webDocPath(id, name);
}

/** A .pen file from disk, as a document kept in the browser (and, where the browser can, linked to the file). */
export async function openPenFile(): Promise<string | undefined> {
  let file: File, handle: FileSystemFileHandle | undefined;
  if (pickers.showOpenFilePicker) {
    try {
      [handle] = await pickers.showOpenFilePicker(PEN);
    } catch {
      return undefined; // dismissed
    }
    file = await handle.getFile();
  } else {
    const picked = await new Promise<File | undefined>((resolve) => {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.pen,application/json' });
      input.onchange = () => resolve(input.files?.[0]);
      input.click();
    });
    if (!picked) return undefined;
    file = picked;
  }
  const data = parsePen(await file.text());
  return createWebDoc(file.name.replace(/\.pen$/i, ''), data, handle);
}

export function download(name: string, data: BlobPart, type = 'application/octet-stream'): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Pick a file to keep the document in (from a click), where the browser can link files. */
export async function pickSaveFile(name: string): Promise<FileSystemFileHandle | undefined> {
  try {
    return await pickers.showSaveFilePicker?.({ suggestedName: `${name}.pen`, ...PEN });
  } catch {
    return undefined;
  }
}

/** Pick the document's folder (from a click), so its pictures and libraries show. */
export async function pickFolder(): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    return await pickers.showDirectoryPicker?.({ mode: 'readwrite' });
  } catch {
    return undefined;
  }
}

/**
 * A picture dropped or pasted into a document kept in the browser: kept with it under images/, and written
 * into its folder too when nib may. Returns its url and size.
 */
export async function addPicture(path: string, f: File): Promise<{ url: string; width: number; height: number }> {
  const id = webDocId(path);
  const bytes = new Uint8Array(await f.arrayBuffer());
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: f.type }));
  const base = (f.name || 'image.png').replace(/[^\w.-]+/g, '-').replace(/^-+/, '') || 'image.png';
  let url = `images/${base}`;
  for (let i = 2; await getAsset(id, url); i++) url = `images/${base.replace(/(\.[^.]+)?$/, `-${i}$1`)}`;
  await putAsset(id, url, bytes);
  const dir = (await getDoc(id))?.dir;
  if (dir && (await access(dir, 'readwrite', false))) {
    const h = await fileIn(dir, url, true);
    if (h) { const w = await h.createWritable(); await w.write(bytes as BlobPart); await w.close(); }
  }
  return { url, width: bitmap.width, height: bitmap.height };
}

/** Pictures of layers, drawn here (the website has no daemon to export with). */
export async function exportPictures(ids: string[], format: 'png' | 'jpeg' | 'webp', scale: number): Promise<void> {
  const { doc, conn } = store.get();
  if (!doc || !conn) return;
  const { renderer } = await getEngine();
  const images = imagesFor(conn.path);
  for (const id of ids) {
    const node = doc.get(id);
    const scene = node ? buildScene(doc, node) : undefined;
    if (!scene) continue;
    const bytes = await renderer.renderPNG(scene, images, { scale, format });
    download(`${(typeof node!.name === 'string' && node!.name) || id}.${format === 'jpeg' ? 'jpg' : format}`, bytes as BlobPart, `image/${format}`);
  }
}
