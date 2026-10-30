import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { PenDoc } from '@nib/core';
import type { Exporter, ExportFormat } from '@nib/exec';
import type { CodeMap } from './code.ts';
import { exportHtml, exportReact } from './html.ts';
import { writePdf } from './pdf.ts';

/** pdf: one page per node, rendered at `scale` (default 2) and sized in points equal to its px size. */
const pdf: Exporter = async (scenes, outputPath, options, ctx) => {
  const pages = [];
  for (const s of scenes) {
    const image = await ctx.renderer.renderPixels(s.root, s.target, ctx.images, { scale: options.scale ?? 2 });
    const scale = options.scale ?? 2;
    pages.push({ width: image.width / scale, height: image.height / scale, image });
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, writePdf(pages, scenes.length === 1 && typeof scenes[0].target.name === 'string' ? scenes[0].target.name : undefined));
  return [outputPath];
};

const html = (tailwind: boolean): Exporter => async (scenes, outputPath, options, ctx) => {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, await exportHtml(scenes, outputPath, options, ctx, tailwind));
  return [outputPath];
};

/** The code maps of the libraries a document imports: `<library>.code.json` beside each `.lib.pen`. */
async function codeMaps(doc: PenDoc, baseDir: string): Promise<Map<string, CodeMap>> {
  const out = new Map<string, CodeMap>();
  for (const [alias, rel] of Object.entries(doc.data.imports ?? {})) {
    const file = resolve(baseDir, rel).replace(/(\.lib)?\.pen$/, '.code.json');
    try {
      out.set(alias, JSON.parse(await readFile(file, 'utf8')) as CodeMap);
    } catch {
      // A library without code: its instances are written as plain elements.
    }
  }
  return out;
}

const react: Exporter = async (scenes, outputPath, options, ctx) => {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, await exportReact(scenes, outputPath, options, ctx, await codeMaps(ctx.doc, ctx.baseDir)));
  return [outputPath];
};

export const EXPORTERS: Partial<Record<ExportFormat, Exporter>> = {
  pdf,
  'react-tailwind': react,
  'html-css': html(false),
  'html-tailwind': html(true),
};
