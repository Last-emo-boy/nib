import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FontFace, FontLoader } from './fonts.ts';
import { extractFace, faceInfo, faceOffsets } from './sfnt.ts';

interface IndexedFace { file: string; offset: number; weight: number; italic: boolean; family: string }
interface FontIndex { version: 1; files: Record<string, { mtime: number; faces: IndexedFace[] }> }

/** Folders fonts are installed in, per platform. */
export function systemFontDirs(): string[] {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin': return ['/System/Library/Fonts', '/Library/Fonts', path.join(home, 'Library/Fonts'), '/System/Library/AssetsV2'];
    case 'win32': return [path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts'), path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft/Windows/Fonts')];
    default: return ['/usr/share/fonts', '/usr/local/share/fonts', path.join(home, '.fonts'), path.join(home, '.local/share/fonts')];
  }
}

const FONT_FILE = /\.(ttf|otf|ttc|otc)$/i;

/**
 * Fonts installed on this machine, found by family name. The face index is kept on disk and refreshed
 * for files whose modification time changed.
 */
export class SystemFontLoader implements FontLoader {
  private dirs: string[];
  private indexFile: string;
  private families: Promise<Map<string, IndexedFace[]>> | undefined;

  constructor(dirs = systemFontDirs(), indexFile = path.join(os.homedir(), '.cache', 'nib', 'system-fonts.json')) {
    this.dirs = dirs;
    this.indexFile = indexFile;
  }

  async load(face: FontFace): Promise<Uint8Array | undefined> {
    const faces = (await (this.families ??= this.buildIndex())).get(face.family.toLowerCase());
    if (!faces?.length) return undefined;
    const best = faces.reduce((a, b) => (score(b, face) < score(a, face) ? b : a));
    return extractFace(new Uint8Array(await fs.readFile(best.file)), best.offset);
  }

  /** The families installed, by their own names, sorted; the system's own hidden ones (".SF …") left out. */
  async list(): Promise<string[]> {
    const families = await (this.families ??= this.buildIndex());
    return [...families.values()].map((f) => f[0].family).filter((f) => !f.startsWith('.')).sort((a, b) => a.localeCompare(b));
  }

  private async buildIndex(): Promise<Map<string, IndexedFace[]>> {
    let old: FontIndex = { version: 1, files: {} };
    try {
      const parsed = JSON.parse(await fs.readFile(this.indexFile, 'utf8')) as FontIndex;
      if (parsed.version === 1) old = parsed;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err;
    }
    const next: FontIndex = { version: 1, files: {} };
    for (const file of await listFonts(this.dirs)) {
      const stat = await fs.stat(file);
      const prev = old.files[file];
      if (prev && prev.mtime === stat.mtimeMs) { next.files[file] = prev; continue; }
      next.files[file] = { mtime: stat.mtimeMs, faces: await readFaces(file) };
    }
    await fs.mkdir(path.dirname(this.indexFile), { recursive: true });
    await fs.writeFile(this.indexFile, JSON.stringify(next));
    const families = new Map<string, IndexedFace[]>();
    for (const { faces } of Object.values(next.files)) {
      for (const f of faces) {
        const key = f.family.toLowerCase();
        if (!families.has(key)) families.set(key, []);
        families.get(key)!.push({ file: f.file, offset: f.offset, weight: f.weight, italic: f.italic, family: f.family });
      }
    }
    return families;
  }
}

/** Distance from a wanted face: slant mismatches dominate, then weight. */
function score(f: IndexedFace, want: FontFace): number {
  return (f.italic === want.italic ? 0 : 10000) + Math.abs(f.weight - want.weight);
}

async function listFonts(dirs: string[]): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, depth: number) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM' || code === 'ENOTDIR') return;
      throw err;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 6) await walk(p, depth + 1);
      else if (e.isFile() && FONT_FILE.test(e.name)) out.push(p);
    }
  };
  for (const d of dirs) await walk(d, 0);
  return out;
}

/** Faces of a font file, reading only its headers and name tables. */
async function readFaces(file: string): Promise<IndexedFace[]> {
  const fh = await fs.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const readAt = async (pos: number, len: number) => {
      const buf = new Uint8Array(Math.max(0, Math.min(len, size - pos)));
      await fh.read(buf, 0, buf.length, pos);
      return buf;
    };
    const head = await readAt(0, 12 + 4 * 256);
    const out: IndexedFace[] = [];
    for (const offset of faceOffsets(head)) {
      const info = faceInfo(await nameTablesOf(readAt, offset), 0);
      if (info) out.push({ file, offset, weight: info.weight, italic: info.italic, family: info.family });
    }
    return out;
  } catch (err) {
    if (err instanceof RangeError) return [];
    throw err;
  } finally {
    await fh.close();
  }
}

/** A small standalone font holding only the face's name and OS/2 tables, enough for `faceInfo`. */
async function nameTablesOf(readAt: (pos: number, len: number) => Promise<Uint8Array>, offset: number): Promise<Uint8Array> {
  const header = await readAt(offset, 12);
  const count = new DataView(header.buffer).getUint16(4);
  const dir = await readAt(offset + 12, count * 16);
  const v = new DataView(dir.buffer);
  const wanted: { tag: Uint8Array; data: Uint8Array }[] = [];
  for (let i = 0; i < count; i++) {
    const t = String.fromCharCode(...dir.subarray(i * 16, i * 16 + 4));
    if (t === 'name' || t === 'OS/2') wanted.push({ tag: dir.subarray(i * 16, i * 16 + 4), data: await readAt(v.getUint32(i * 16 + 8), v.getUint32(i * 16 + 12)) });
  }
  const size = 12 + wanted.length * 16 + wanted.reduce((s, w) => s + w.data.length, 0);
  const out = new Uint8Array(size);
  const ov = new DataView(out.buffer);
  out.set(header.subarray(0, 4), 0);
  ov.setUint16(4, wanted.length);
  let at = 12 + wanted.length * 16;
  wanted.forEach((w, i) => {
    out.set(w.tag, 12 + i * 16);
    ov.setUint32(12 + i * 16 + 8, at);
    ov.setUint32(12 + i * 16 + 12, w.data.length);
    out.set(w.data, at);
    at += w.data.length;
  });
  return out;
}

/** A face of a font file in a folder. */
export interface FolderFace { family: string; weight: number; italic: boolean; file: string }

/**
 * Fonts kept in folders that come and go (each open design's `fonts/` folder). Each folder is read again when
 * it changes; folders that do not exist hold no fonts.
 */
export class FolderFontLoader implements FontLoader {
  private dirs: () => string[];
  private cache = new Map<string, { mtime: number; faces: Promise<IndexedFace[]> }>();

  constructor(dirs: () => string[]) {
    this.dirs = dirs;
  }

  async load(face: FontFace): Promise<Uint8Array | undefined> {
    const want = face.family.toLowerCase();
    const faces = (await this.all()).filter((f) => f.family.toLowerCase() === want);
    if (!faces.length) return undefined;
    const best = faces.reduce((a, b) => (score(b, face) < score(a, face) ? b : a));
    return extractFace(new Uint8Array(await fs.readFile(best.file)), best.offset);
  }

  /** The faces in `dir` (default: every folder). */
  async faces(dir?: string): Promise<FolderFace[]> {
    return (await this.all(dir ? [dir] : undefined)).map(({ family, weight, italic, file }) => ({ family, weight, italic, file }));
  }

  private async all(dirs = this.dirs()): Promise<IndexedFace[]> {
    const out: IndexedFace[] = [];
    for (const dir of new Set(dirs)) {
      const stat = await fs.stat(dir).catch(() => undefined);
      if (!stat?.isDirectory()) { this.cache.delete(dir); continue; }
      let entry = this.cache.get(dir);
      if (!entry || entry.mtime !== stat.mtimeMs) {
        entry = { mtime: stat.mtimeMs, faces: listFonts([dir]).then(async (files) => (await Promise.all(files.map(readFaces))).flat()) };
        this.cache.set(dir, entry);
      }
      out.push(...(await entry.faces));
    }
    return out;
  }
}

/** Tries each loader in turn. */
export class FallbackFontLoader implements FontLoader {
  private loaders: FontLoader[];
  constructor(...loaders: FontLoader[]) { this.loaders = loaders; }
  async load(face: FontFace): Promise<Uint8Array | undefined> {
    for (const l of this.loaders) {
      const bytes = await l.load(face);
      if (bytes) return bytes;
    }
    return undefined;
  }
}
