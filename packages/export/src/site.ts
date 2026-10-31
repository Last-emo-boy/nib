import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { SceneNode } from '@nib/core';
import type { Exporter } from '@nib/exec';
import { exportHtml } from './html.ts';

/**
 * A static website from frames: one HTML page per frame (the first is index.html), prototype links between
 * them as real links, and every local file the pages use (images, fonts) copied into assets/, so the folder
 * can be served by any static host as it is.
 */

/** File names for pages: index.html first, then the frame's name as a slug, kept unique. */
export function pageFiles(names: string[]): string[] {
  const taken = new Set<string>();
  return names.map((name, i) => {
    if (i === 0) { taken.add('index'); return 'index.html'; }
    const base = name.normalize('NFKD').toLowerCase().replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || `page-${i + 1}`;
    let slug = base;
    for (let k = 2; taken.has(slug); k++) slug = `${base}-${k}`;
    taken.add(slug);
    return `${slug}.html`;
  });
}

const linkOf = (n: SceneNode): { to: string } | undefined => {
  const m = (n as { metadata?: { type?: string; to?: unknown } }).metadata;
  return m?.type === 'nib-link' && typeof m.to === 'string' ? { to: m.to } : undefined;
};

/** site: `outputPath` is a folder; the scenes are the pages, in order. */
export const site: Exporter = async (scenes, outputPath, options, ctx) => {
  await mkdir(join(outputPath, 'assets'), { recursive: true });
  const files = pageFiles(scenes.map((s) => (typeof s.target.name === 'string' ? s.target.name : s.target.id)));
  const pageOf = new Map(scenes.map((s, i) => [s.target.id, files[i]]));
  // Each local file once, under a name of its own.
  const copies = new Map<string, string>();
  const used = new Set<string>();
  const asset = (file: string) => {
    let name = copies.get(file);
    if (!name) {
      const ext = extname(file), stem = basename(file, ext).replace(/[^\w.-]+/g, '-') || 'file';
      name = `${stem}${ext}`;
      for (let k = 2; used.has(name); k++) name = `${stem}-${k}${ext}`;
      used.add(name);
      copies.set(file, name);
    }
    return `assets/${name}`;
  };
  const written: string[] = [];
  for (const [i, s] of scenes.entries()) {
    const link = (n: SceneNode) => {
      const l = linkOf(n);
      if (!l || n.id === s.target.id) return undefined;
      if (l.to === 'next') return files[i + 1];
      if (l.to === 'previous') return files[i - 1];
      return pageOf.get(l.to);
    };
    const file = join(outputPath, files[i]);
    await writeFile(file, await exportHtml([s], file, options, { ...ctx, link, asset }, false));
    written.push(file);
  }
  for (const [from, name] of copies) {
    await copyFile(from, join(outputPath, 'assets', name)).catch(() => undefined);
    written.push(join(outputPath, 'assets', name));
  }
  return written;
};
