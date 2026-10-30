import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePen, serializePen, type PenDocument } from '@nib/format';
import { brandedLibrary, type Brand, type BrandRecipe } from './brand.ts';
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
  /** Which variables follow a brand, for libraries made from a brand. */
  brand?: BrandRecipe;
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
  // How its components are written in code, for React export (also added to copies made before there was one).
  const code = join(dirname(dest), `${id}.code.json`);
  if (!(await stat(code).catch(() => undefined))) await copyFile(join(LIBRARY_DIR, `${id}.code.json`), code).catch(() => {});
  return `./${relative(dirname(docPath), dest)}`;
}

/**
 * A copy of bundled library `id` in a brand's color, font and radius, written next to a document as
 * `libraries/<name>.lib.pen` (a new name if that is taken) with the base library's code map and license.
 * Returns its path relative to the document.
 */
export async function brandLibrary(id: string, brand: Brand, name: string, docPath: string): Promise<string> {
  const lib = (await libraries()).find((l) => l.id === id);
  if (!lib?.brand) throw new Error(`no library "${id}" that takes a brand`);
  const base = parsePen(await readFile(join(LIBRARY_DIR, `${id}.lib.pen`), 'utf8'));
  const out = brandedLibrary(base, lib.brand, brand);
  const dir = join(dirname(docPath), 'libraries');
  await mkdir(dir, { recursive: true });
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'brand';
  let file = slug;
  for (let i = 2; await stat(join(dir, `${file}.lib.pen`)).catch(() => undefined); i++) file = `${slug}-${i}`;
  await writeFile(join(dir, `${file}.lib.pen`), serializePen(out));
  await copyFile(join(LIBRARY_DIR, `${id}.code.json`), join(dir, `${file}.code.json`)).catch(() => {});
  await copyFile(join(LIBRARY_DIR, `${id}-LICENSE.txt`), join(dir, `${file}-LICENSE.txt`)).catch(() => {});
  return `./${relative(dirname(docPath), join(dir, `${file}.lib.pen`))}`;
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
  // The library's page color: libraries name it differently (background, Ant Design's bg-layout, Material's surface).
  const vars = (await libraryFile(id).then((f) => (f ? readFile(f, 'utf8') : '{}')).then((t) => (JSON.parse(t) as PenDocument).variables, () => undefined)) ?? {};
  const page = ['background', 'bg-layout', 'surface'].find((v) => v in vars) ?? 'background';
  return {
    version: NEW_DOCUMENT_VERSION,
    imports: { [id]: rel },
    ...(Object.keys(themes).length ? { themes } : {}),
    children: [
      { type: 'frame', id: 'screen', name: 'Screen', x: 0, y: 0, width: 1440, height: 900, fill: `$${id}:${page}`, layout: 'vertical', clip: true, children: [] },
    ],
  } as unknown as PenDocument;
}
