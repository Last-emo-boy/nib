import { execFileSync } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { diffDocs, type DocDiff } from '@nib/core';
import { comparePixels, cropPixels, decodePixels, encodePng, type Renderer } from '@nib/render';
import type { DocumentHost } from './host.ts';

/**
 * A design's history in git: the commits that changed a .pen file, the file as it was at one of them, and
 * pictures of what changed between two versions (each changed frame before, after, and the difference).
 */

export interface Commit { hash: string; short: string; date: string; author: string; subject: string }

/** Commits that changed `path`, newest first (none when it is not in a git repository). */
export function commitsOf(path: string, limit = 50): Commit[] {
  try {
    const out = execFileSync('git', ['-C', dirname(path), 'log', `-n${limit}`, '--format=%H%x09%h%x09%cI%x09%an%x09%s', '--', basename(path)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').filter(Boolean).map((l) => { const [hash, short, date, author, ...s] = l.split('\t'); return { hash, short, date, author, subject: s.join('\t') }; });
  } catch {
    return [];
  }
}

/** The file's text at `ref`, or undefined when git does not have it there. */
export function textAt(path: string, ref: string): string | undefined {
  try {
    return execFileSync('git', ['-C', dirname(path), 'show', `${ref}:./${basename(path)}`], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return undefined;
  }
}

/** A version of `path` from git written beside it (so its images resolve), to open; remove it when done. */
export async function versionFile(path: string, ref: string): Promise<string | undefined> {
  const text = textAt(path, ref);
  if (text === undefined) return undefined;
  const tmp = join(dirname(path), `.${basename(path, '.pen')}.${ref.replace(/[^\w.-]+/g, '_')}.nib-diff.pen`);
  await writeFile(tmp, text);
  return tmp;
}

export interface FramePictures { before?: Uint8Array; after?: Uint8Array; diff?: Uint8Array; similarity?: number }

/** Pictures of each frame that changed between the documents at `before` and `after` (both opened in `host`). */
export async function framePictures(host: DocumentHost, renderer: Renderer, before: string, after: string, d: DocDiff, scale = 1): Promise<Map<string, FramePictures>> {
  const out = new Map<string, FramePictures>();
  const shot = async (path: string, id: string) => (await host.exportNodes(path, [id], 'png', scale).catch(() => []))[0]?.data;
  for (const f of d.frames.filter((x) => x.kind !== 'moved')) {
    const p: FramePictures = {};
    if (f.kind !== 'added') p.before = await shot(before, f.id);
    if (f.kind !== 'removed') p.after = await shot(after, f.id);
    if (p.before && p.after) {
      const a = decodePixels(renderer.ck, p.before), b = decodePixels(renderer.ck, p.after);
      const w = Math.max(a.width, b.width), h = Math.max(a.height, b.height);
      const c = comparePixels(cropPixels(a, w, h), cropPixels(b, w, h));
      p.diff = encodePng(renderer.ck, c.diff);
      p.similarity = c.similarity;
    }
    out.set(f.id, p);
  }
  return out;
}

/** Diff the document at git `ref` with it now (or at `to`), with pictures of the changed frames. */
export async function diffWithHistory(host: DocumentHost, renderer: Renderer, path: string, ref: string, to?: string): Promise<{ diff: DocDiff; pictures: Map<string, FramePictures> } | undefined> {
  const before = await versionFile(path, ref);
  if (!before) return undefined;
  const after = to ? await versionFile(path, to) : path;
  try {
    if (!after) return undefined;
    const [a, b] = [await host.open(before), await host.open(after)];
    const d = diffDocs(a.session.doc.data, b.session.doc.data);
    return { diff: d, pictures: await framePictures(host, renderer, before, after, d) };
  } finally {
    for (const f of [before, ...(to && after ? [after] : [])]) {
      await host.discard(f).catch(() => undefined);
      await rm(f, { force: true });
    }
  }
}
