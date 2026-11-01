import { createServer, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, relative } from 'node:path';
import type { FallbackFamilies, FontLoader, IconSource } from '@nib/render';
import { DAEMON_VERSION } from './server.ts';

/**
 * nib's editor as a website: the editor's own files, and the fonts and icons it draws with. Documents stay
 * in the visitor's browser (opened from their disk or kept in the browser), so this holds no one's files
 * and runs nothing of theirs; what needs the app (agents, publishing, git history, code export) says so.
 */

export interface WebHostOptions {
  port: number;
  host?: string;
  /** The built editor (apps/editor/dist). */
  editorDir: string;
  fonts: FontLoader;
  icons: IconSource;
  fallbacks: FallbackFamilies;
  /** Where to get the app, for what the website cannot do. */
  appUrl?: string;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ico': 'image/x-icon',
};

export async function startWebHost(opts: WebHostOptions): Promise<{ port: number; close(): Promise<void> }> {
  const appUrl = opts.appUrl ?? 'https://github.com/Last-emo-boy/nib/releases';
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const server = createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    const url = new URL(req.url ?? '/', 'http://localhost');
    const q = url.searchParams;
    if (req.method !== 'GET' && req.method !== 'HEAD' && !url.pathname.startsWith('/api/')) { res.writeHead(405).end(); return; }
    try {
      switch (url.pathname) {
        case '/api/config':
          return json(res, 200, { web: true, version: DAEMON_VERSION, fallbacks: opts.fallbacks, app: appUrl });
        case '/api/font': {
          const bytes = await opts.fonts.load({ family: q.get('family') ?? '', weight: Number(q.get('weight') ?? 400), italic: q.get('italic') === '1' });
          if (!bytes) return json(res, 404, { error: 'font not found' });
          res.writeHead(200, { 'content-type': 'font/ttf', 'cache-control': 'public, max-age=604800' });
          return void res.end(bytes);
        }
        case '/api/icon': {
          const weight = q.get('weight');
          const g = await opts.icons.load(q.get('library') ?? 'lucide', q.get('name') ?? '', weight ? Number(weight) : undefined);
          return g ? json(res, 200, g) : json(res, 404, { error: 'icon not found' });
        }
        case '/api/fonts':
          // A server's installed fonts are not the visitor's: only Google Fonts and the design's own.
          return json(res, 200, { project: [], installed: [] });
        case '/healthz':
          return json(res, 200, { ok: true });
      }
      if (url.pathname.startsWith('/api/') || url.pathname === '/ws') return json(res, 404, { error: `This needs the nib app (${appUrl}).`, app: appUrl });
      // The editor's files; anything else is the editor itself (it reads the document from the hash).
      let file = normalize(join(opts.editorDir, decodeURIComponent(url.pathname)));
      if (relative(opts.editorDir, file).startsWith('..') || !(await stat(file).then((s) => s.isFile(), () => false))) file = join(opts.editorDir, 'index.html');
      const body = await readFile(file);
      const hashed = /\/assets\//.test(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (e) {
      json(res, 500, { error: (e as Error).message });
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(opts.port, opts.host ?? '127.0.0.1', () => resolve()); });
  const addr = server.address();
  return { port: typeof addr === 'object' && addr ? addr.port : opts.port, close: () => new Promise((r) => server.close(() => r())) };
}
