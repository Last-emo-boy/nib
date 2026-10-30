import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePen, type PenDocument } from '@nib/format';

export const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

export interface Template {
  id: string;
  /** card, slides, infographic, comparison, tutorial, carousel, app, web. */
  scene: string;
  frames: number;
  width: number;
  height: number;
  styleGuide?: string;
  title: { en: string; zh: string };
  summary: { en: string; zh: string };
  tags: string[];
  /** Where it came from, for attribution. */
  source: string;
}

let catalogue: Promise<Template[]> | undefined;

/** Every template source folder under templates/ has a catalog.json and one .pen per template. */
export function templates(): Promise<Template[]> {
  return (catalogue ??= (async () => {
    const out: Template[] = [];
    for (const source of await readdir(TEMPLATE_DIR, { withFileTypes: true })) {
      if (!source.isDirectory()) continue;
      const list = JSON.parse(await readFile(join(TEMPLATE_DIR, source.name, 'catalog.json'), 'utf8')) as Omit<Template, 'source'>[];
      out.push(...list.map((t) => ({ ...t, source: source.name })));
    }
    return out;
  })());
}

export async function templateFile(id: string): Promise<string | undefined> {
  const t = (await templates()).find((x) => x.id === id);
  return t ? join(TEMPLATE_DIR, t.source, `${t.id}.pen`) : undefined;
}

export async function templateDocument(id: string): Promise<PenDocument | undefined> {
  const file = await templateFile(id);
  return file ? parsePen(await readFile(file, 'utf8')) : undefined;
}
