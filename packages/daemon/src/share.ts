import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { basename, dirname, extname, join, normalize, sep } from 'node:path';
import { buildScene, isSlide, readingOrder, type SceneNode } from '@nib/core';
import type { Exporter } from '@nib/exec';
import type { ImageLoader, Renderer } from '@nib/render';
import type { DocumentHost } from './host.ts';
import { VIEWER_HTML } from './share-viewer.ts';

/**
 * Sharing a design: a read-only snapshot in its own folder (a PNG of each top-level frame, share.json, and a
 * viewer page), reachable at /share/<id>/ on this computer, and, when switched on, on the local network
 * through a server that serves nothing but these folders. The folder works on any static host as it is.
 * Each design keeps its id, so sharing it again updates the same link.
 */

export interface ShareLink { x: number; y: number; width: number; height: number; to: string; transition: string; label?: string }
export interface SharedFrame { id: string; name: string; file: string; width: number; height: number; links: ShareLink[] }
export interface ShareManifest { name: string; created: string; frames: SharedFrame[] }

const ID = /^[A-Za-z0-9_-]{16,}$/;

/** The id a design is shared under (made the first time). */
async function idFor(dir: string, path: string): Promise<string> {
  const indexFile = join(dir, 'index.json');
  const index = JSON.parse(await readFile(indexFile, 'utf8').catch(() => '{}')) as Record<string, string>;
  if (index[path] && ID.test(index[path])) return index[path];
  index[path] = randomBytes(16).toString('base64url');
  await mkdir(dir, { recursive: true });
  await writeFile(indexFile, JSON.stringify(index, null, 2));
  return index[path];
}

/** The id a design was shared under, if it was. */
export async function sharedId(dir: string, path: string): Promise<string | undefined> {
  const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8').catch(() => '{}')) as Record<string, string>;
  return index[path];
}

/** Prototype links inside a frame, as boxes relative to it. */
function linksIn(root: SceneNode, box: (n: SceneNode) => { x: number; y: number; width: number; height: number }): ShareLink[] {
  const out: ShareLink[] = [];
  const walk = (n: SceneNode, ox: number, oy: number, top: boolean) => {
    const b = box(n);
    const x = top ? 0 : ox + b.x, y = top ? 0 : oy + b.y;
    const m = (n as { metadata?: { type?: string; to?: unknown; transition?: unknown } }).metadata;
    if (!top && m?.type === 'nib-link' && typeof m.to === 'string') {
      out.push({ x, y, width: b.width, height: b.height, to: m.to, transition: typeof m.transition === 'string' ? m.transition : 'instant', ...(typeof n.name === 'string' ? { label: n.name } : {}) });
    }
    for (const c of n.children ?? []) walk(c, x, y, false);
  };
  walk(root, 0, 0, true);
  return out;
}

/** A design's pages: its top-level frames (components left out) in reading order, laid out. */
export async function pagesOf(host: DocumentHost, renderer: Renderer, images: (file: string) => ImageLoader, path: string): Promise<{ node: SceneNode; box: { x: number; y: number; width: number; height: number }; links: ShareLink[] }[]> {
  const open = await host.open(path);
  const doc = open.session.doc;
  const loader = images(open.path);
  const shown: { node: SceneNode; box: { x: number; y: number; width: number; height: number }; links: ShareLink[] }[] = [];
  for (const n of doc.data.children) {
    if (!isSlide(doc, n) || n.enabled === false) continue;
    const scene = buildScene(doc, n);
    if (!scene) continue;
    const prepared = await renderer.prepare(scene, loader);
    try {
      const b = prepared.layout.box(scene);
      shown.push({ node: scene, box: { x: b.x, y: b.y, width: b.width, height: b.height }, links: linksIn(scene, (s) => prepared.layout.box(s)) });
    } finally {
      prepared.dispose();
    }
  }
  const order = readingOrder(shown.map((s) => ({ id: s.node.id, box: s.box })));
  return order.map((id) => shown.find((x) => x.node.id === id)!);
}

/** Write (or rewrite) the snapshot of the design at `path`; returns its id. */
export async function buildShare(host: DocumentHost, renderer: Renderer, images: (file: string) => ImageLoader, path: string, dir: string): Promise<string> {
  const open = await host.open(path);
  const id = await idFor(dir, open.path);
  const out = join(dir, id);
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, 'frames'), { recursive: true });
  const loader = images(open.path);
  const frames: SharedFrame[] = [];
  for (const [i, s] of (await pagesOf(host, renderer, images, path)).entries()) {
    const fid = s.node.id;
    const file = `frames/${String(i + 1).padStart(2, '0')}-${fid.replace(/[^\w-]/g, '_')}.png`;
    await writeFile(join(out, file), await renderer.renderPNG(s.node, loader, { scale: 2, maxSide: 4096 }));
    frames.push({ id: fid, name: typeof s.node.name === 'string' ? s.node.name : fid, file, width: s.box.width, height: s.box.height, links: s.links });
  }
  const manifest: ShareManifest = { name: basename(open.path, '.pen'), created: new Date().toISOString(), frames };
  await writeFile(join(out, 'share.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(out, 'index.html'), VIEWER_HTML);
  return id;
}

/** The design as a static website (a page per frame, in reading order) in `dir`. */
export async function exportSite(host: DocumentHost, renderer: Renderer, images: (file: string) => ImageLoader, site: Exporter, path: string, dir: string): Promise<void> {
  const open = await host.open(path);
  const pages = await pagesOf(host, renderer, images, path);
  if (!pages.length) throw new Error('the design has no top-level frames to make pages of');
  await site(pages.map((p) => ({ id: p.node.id, root: p.node, target: p.node })), dir, {}, { doc: open.session.doc, renderer, images: images(open.path), baseDir: dirname(open.path) });
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };

/**
 * Answer a request for /share/<id>/<file> from the shares folder: only files inside a share's own folder, never
 * the index of shares. True when the path was a share path (answered either way).
 */
export async function serveShare(dir: string, pathname: string, res: ServerResponse): Promise<boolean> {
  const m = /^\/share\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!m) return false;
  const [, id, rest] = m;
  if (!ID.test(id)) { res.writeHead(404).end(); return true; }
  if (rest === undefined) { res.writeHead(302, { location: `/share/${id}/` }).end(); return true; }
  const rel = normalize(decodeURIComponent(rest === '/' ? '/index.html' : rest)).replace(/^[/\\]+/, '');
  const base = join(dir, id);
  const file = join(base, rel);
  if (!file.startsWith(base + sep) || !MIME[extname(file)]) { res.writeHead(404).end(); return true; }
  const bytes = await readFile(file).catch(() => undefined);
  if (!bytes) { res.writeHead(404).end(); return true; }
  res.writeHead(200, { 'content-type': MIME[extname(file)], 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  res.end(bytes);
  return true;
}

/** This computer's address on the local network, if it has one. */
export function lanAddress(): string | undefined {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return undefined;
}

/**
 * The server that makes shares reachable from other devices: it serves the shares folder and nothing else (no
 * API, no editor), read-only. Off until switched on.
 */
export class ShareServer {
  private server: Server | undefined;
  private dir: string;
  private bind: string;
  port = 0;

  constructor(dir: string, bind = '0.0.0.0') {
    this.dir = dir;
    this.bind = bind;
  }

  get on(): boolean {
    return !!this.server;
  }

  async start(port = 0): Promise<number> {
    if (this.server) return this.port;
    const server = createServer((req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      const path = new URL(req.url ?? '/', 'http://share').pathname;
      serveShare(this.dir, path, res).then((done) => { if (!done) res.writeHead(404).end(); }, () => { if (!res.headersSent) res.writeHead(500); res.end(); });
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, this.bind, () => resolve()); });
    this.server = server;
    this.port = (server.address() as { port: number }).port;
    return this.port;
  }

  async stop(): Promise<void> {
    const s = this.server;
    this.server = undefined;
    this.port = 0;
    if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
  }
}
