import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Exporter, ExportFormat } from '@nib/exec';
import { exportHtml } from './html.ts';
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

export const EXPORTERS: Partial<Record<ExportFormat, Exporter>> = {
  pdf,
  'html-css': html(false),
  'html-tailwind': html(true),
};
