import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PenDocument } from '@nib/format';
import { NEW_DOCUMENT_VERSION } from './host.ts';

/** Design systems nib ships: one `<id>.lib.pen` each, described in catalog.json. */
export const LIBRARY_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'libraries');

export interface Library {
  id: string;
  name: string;
  summary: { en: string; zh: string };
  /** The design system it follows, its license, and where it comes from. */
  basedOn: string;
  license: string;
  homepage: string;
  components: number;
  /** Theme axes and their values, e.g. { Mode: ['Light', 'Dark'] }. */
  themes: Record<string, string[]>;
}

let catalogue: Promise<Library[]> | undefined;

export function libraries(): Promise<Library[]> {
  return (catalogue ??= readFile(join(LIBRARY_DIR, 'catalog.json'), 'utf8').then((t) => JSON.parse(t) as Library[], () => []));
}

export async function libraryFile(id: string): Promise<string | undefined> {
  return (await libraries()).some((l) => l.id === id) ? join(LIBRARY_DIR, `${id}.lib.pen`) : undefined;
}

/**
 * Put a bundled library next to a document, in `libraries/<id>.lib.pen` (kept if already there, so a
 * document keeps the version it was designed with), and return its path relative to the document.
 */
export async function installLibrary(id: string, docPath: string): Promise<string> {
  const src = await libraryFile(id);
  if (!src) throw new Error(`no library "${id}"`);
  const dest = join(dirname(docPath), 'libraries', `${id}.lib.pen`);
  if (!(await stat(dest).catch(() => undefined))) {
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest);
  }
  return `./${relative(dirname(docPath), dest)}`;
}

/** The alias a library file is imported under: its name without `.lib.pen`, made safe for `alias:id`. */
export function aliasFor(file: string, taken: Iterable<string>): string {
  const base = basename(file).replace(/\.lib\.pen$|\.pen$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'lib';
  const used = new Set(taken);
  let alias = base;
  for (let i = 2; used.has(alias); i++) alias = `${base}-${i}`;
  return alias;
}

/** A new document that imports library `id` and starts with an empty screen in the library's colors. */
export async function documentFromLibrary(id: string, rel: string): Promise<PenDocument> {
  const lib = (await libraries()).find((l) => l.id === id);
  const themes = lib?.themes ?? {};
  return {
    version: NEW_DOCUMENT_VERSION,
    imports: { [id]: rel },
    ...(Object.keys(themes).length ? { themes } : {}),
    children: [
      { type: 'frame', id: 'screen', name: 'Screen', x: 0, y: 0, width: 1440, height: 900, fill: `$${id}:background`, layout: 'vertical', clip: true, children: [] },
    ],
  } as unknown as PenDocument;
}
