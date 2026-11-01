import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { serializePen } from '@nib/format';
import { readFig } from './file.ts';
import { figToPen } from './convert.ts';

export { readFig, type FigFile } from './file.ts';
export { figToPen, type FigImport } from './convert.ts';

/**
 * A Figma file as a new .pen document in `dir`, named `name` (name 2, name 3… when taken), its pictures in
 * images/ beside it. Says what did not carry over.
 */
export async function importFigma(bytes: Uint8Array, dir: string, name: string): Promise<{ path: string; notes: string[]; layers: number }> {
  const r = figToPen(readFig(bytes));
  await mkdir(dir, { recursive: true });
  for (const [file, data] of r.images) {
    const at = join(dir, file);
    // Named after their content, so a picture already there is this one.
    if (await stat(at).then(() => true, () => false)) continue;
    await mkdir(dirname(at), { recursive: true });
    await writeFile(at, data);
  }
  const base = name.replace(/[/\\:]/g, '-').trim() || 'Figma import';
  for (let i = 1; ; i++) {
    const path = join(dir, `${base}${i > 1 ? ` ${i}` : ''}.pen`);
    try {
      await writeFile(path, serializePen(r.doc), { flag: 'wx' });
      return { path, notes: r.notes, layers: r.layers };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
}
