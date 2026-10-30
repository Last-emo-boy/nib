import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, join, normalize, relative, resolve as resolvePath } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Op } from '@nib/core';
import type { FallbackFamilies, FontLoader, IconSource, ImageLoader, Renderer } from '@nib/render';
import type { DocEvent, DocumentHost, OpenDocument, Source } from './host.ts';
import { DRAFTS_DIR, drafts, newDraft, nodePreview, recents, thumbnail } from './library.ts';
import { aliasFor, documentFromLibrary, installLibrary, libraries, libraryFile } from './libraries.ts';
import { templateDocument, templateFile, templates } from './templates.ts';
import type { BrowserService } from './browser/service.ts';
import type { AgentService } from './agent/service.ts';

export const DAEMON_VERSION = '0.1.0';
export const DEFAULT_PORT = 7451;

export interface DaemonOptions {
  host: DocumentHost;
  /** Renders dashboard thumbnails. */
  renderer: Renderer;
  /** The `browser` tool; without it the endpoint answers that no browser is available. */
  browser?: BrowserService;
  /** nib's own agent; without it the agent endpoints answer that there is none. */
  agent?: AgentService;
  fonts: FontLoader;
  icons: IconSource;
  images: (penFile: string) => ImageLoader;
  fallbacks: FallbackFamilies;
  port?: number;
  /** Built editor (apps/editor/dist); without it only the API is served. */
  editorDir?: string;
  /** Extra origins allowed to call the API, e.g. the editor's dev server. */
  devOrigins?: string[];
  token?: string;
  /** Called on every request and connection change, for idle shutdown. */
  onActivity?: (clients: number) => void;
}

export interface Daemon {
  port: number;
  token: string;
  url: string;
  /** The editor, logged in, optionally with a document open. */
  editorUrl(file?: string): string;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const MAX_BODY = 32 * 1024 * 1024;

type Json = Record<string, unknown>;

/**
 * The local server: the editor's files, a JSON API for nib-mcp, assets (fonts, icons, images) for the
 * editor's renderer, and a WebSocket that streams document changes.
 *
 * Only this machine can reach it (127.0.0.1), every API call and socket needs the token, and Host and
 * Origin are checked so that web pages cannot drive it through the user's browser.
 */
export async function startDaemon(opts: DaemonOptions): Promise<Daemon> {
  const token = opts.token ?? randomBytes(24).toString('hex');
  const host = opts.host;
  let port = opts.port ?? DEFAULT_PORT;
  const sockets = new Set<WebSocket>();
  const activity = () => opts.onActivity?.(sockets.size);

  const hostOk = (req: IncomingMessage) => {
    const h = req.headers.host ?? '';
    return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
  };
  const originOk = (req: IncomingMessage) => {
    const o = req.headers.origin;
    return o === undefined || o === `http://127.0.0.1:${port}` || o === `http://localhost:${port}` || !!opts.devOrigins?.includes(o);
  };
  const tokenOk = (given: string | undefined) => {
    if (!given) return false;
    const a = Buffer.from(given), b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const requestToken = (req: IncomingMessage, url: URL) => {
    const auth = req.headers.authorization;
    return auth?.startsWith('Bearer ') ? auth.slice(7) : url.searchParams.get('t') ?? undefined;
  };

  const server = createServer((req, res) => {
    activity();
    handle(req, res).catch((e) => {
      if (!res.headersSent) send(res, 500, { error: (e as Error).message });
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!hostOk(req)) return send(res, 421, { error: 'wrong host' });
    if (!originOk(req)) return send(res, 403, { error: 'origin not allowed' });
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (!url.pathname.startsWith('/api/')) return serveEditor(url.pathname, res);
    if (url.pathname === '/api/ping') return send(res, 200, { ok: true, version: DAEMON_VERSION, pid: process.pid });
    if (!tokenOk(requestToken(req, url))) return send(res, 401, { error: 'missing or wrong token' });
    const q = url.searchParams;
    switch (`${req.method} ${url.pathname}`) {
      case 'POST /api/state': {
        const body = await readJson(req);
        const text = await host.appState(typeof body.filePath === 'string' ? body.filePath : undefined, editorUrl);
        return send(res, 200, { text });
      }
      case 'POST /api/execute': {
        const body = await readJson(req);
        if (typeof body.filePath !== 'string') return send(res, 400, { error: 'filePath is required' });
        const r = await host.execute(body.filePath, {
          input: typeof body.input === 'string' ? body.input : undefined,
          editId: typeof body.editId === 'string' ? body.editId : undefined,
          edits: body.edits as { find: string; replace: string }[] | undefined,
        }, typeof body.agent === 'string' ? body.agent : 'agent');
        return send(res, 200, {
          ok: r.ok, text: r.text, notes: r.notes,
          images: r.images.map((i) => ({ data: Buffer.from(i.data).toString('base64'), mimeType: i.mimeType })),
        });
      }
      case 'GET /api/problems': {
        const doc = q.get('doc') ?? '';
        if (!host.list().some((d) => d.path === doc)) return send(res, 404, { error: 'document is not open' });
        return send(res, 200, { problems: await host.problems(doc) });
      }
      case 'POST /api/export': {
        const body = await readJson(req);
        if (typeof body.filePath !== 'string' || !Array.isArray(body.ids) || typeof body.format !== 'string') return send(res, 400, { error: 'filePath, ids and format are required' });
        const files = await host.exportNodes(body.filePath, body.ids as string[], body.format as never, typeof body.scale === 'number' ? body.scale : undefined, body.fragment === true);
        return send(res, 200, { files: files.map((f) => ({ name: f.name, data: Buffer.from(f.data).toString('base64') })) });
      }
      case 'POST /api/save-as': {
        const body = await readJson(req);
        if (typeof body.filePath !== 'string' || typeof body.target !== 'string') return send(res, 400, { error: 'filePath and target are required' });
        try {
          return send(res, 200, { path: await host.saveAs(body.filePath, body.target) });
        } catch (e) {
          return send(res, 409, { error: (e as Error).message });
        }
      }
      case 'POST /api/browser': {
        const body = await readJson(req);
        if (typeof body.filePath !== 'string') return send(res, 400, { error: 'filePath is required' });
        if (!opts.browser) return send(res, 200, { text: 'No browser is available in this nib.', images: [], isError: true });
        const { filePath, agent, ...args } = body;
        return send(res, 200, await opts.browser.run(filePath, args as never, typeof agent === 'string' ? agent : undefined) as unknown as Json);
      }
      case 'GET /api/agent/providers':
        return send(res, 200, { providers: opts.agent ? await opts.agent.providerInfo() : [] });
      case 'GET /api/agent/sessions':
        return send(res, 200, { sessions: opts.agent ? await opts.agent.list(q.get('doc') ?? undefined) : [] });
      case 'GET /api/agent/session': {
        const session = await opts.agent?.get(q.get('id') ?? '');
        return session ? send(res, 200, { session: session as unknown as Json }) : send(res, 404, { error: 'no such session' });
      }
      case 'POST /api/agent/send': {
        if (!opts.agent) return send(res, 404, { error: 'this nib has no agent' });
        const body = await readJson(req);
        if (typeof body.doc !== 'string' || typeof body.provider !== 'string' || typeof body.text !== 'string' || !body.text.trim()) return send(res, 400, { error: 'doc, provider and text are required' });
        const selection = Array.isArray(body.selection) ? body.selection.filter((x): x is string => typeof x === 'string').slice(0, 50) : [];
        const open = await host.open(body.doc);
        try {
          const session = await opts.agent.send({
            session: typeof body.session === 'string' ? body.session : undefined, doc: open.path, provider: body.provider,
            model: typeof body.model === 'string' ? body.model : undefined, text: body.text, selection, context: describeSelection(open, selection),
          });
          return send(res, 200, { session: session as unknown as Json });
        } catch (e) {
          return send(res, 409, { error: (e as Error).message });
        }
      }
      case 'POST /api/agent/stop': {
        const body = await readJson(req);
        if (typeof body.id === 'string') opts.agent?.stop(body.id);
        return send(res, 200, { ok: true });
      }
      case 'POST /api/agent/delete': {
        const body = await readJson(req);
        if (typeof body.id === 'string') await opts.agent?.remove(body.id);
        return send(res, 200, { ok: true });
      }
      case 'POST /api/agent/key': {
        // An API key for a provider nib calls itself; empty removes it. Never sent back.
        const body = await readJson(req);
        if (!opts.agent || typeof body.provider !== 'string' || !/^[a-z0-9-]+$/.test(body.provider)) return send(res, 400, { error: 'provider is required' });
        await opts.agent.keys.set(body.provider, typeof body.key === 'string' && body.key.trim() ? body.key.trim() : undefined);
        return send(res, 200, { ok: true });
      }
      case 'GET /api/library':
        return send(res, 200, { recents: await recents(), drafts: await drafts(), open: host.list().map((d) => d.path) });
      case 'GET /api/templates':
        return send(res, 200, { templates: await templates() });
      case 'GET /api/libraries':
        return send(res, 200, { libraries: await libraries() });
      case 'GET /api/node-preview': {
        const file = q.get('doc') ?? '';
        if (!file.endsWith('.pen')) return send(res, 400, { error: 'doc must be a .pen file' });
        const png = await nodePreview(opts.renderer, opts.images, file, q.get('id') ?? '', Math.min(800, Number(q.get('size') ?? 160)));
        return png ? sendBytes(res, png, 'image/png', 'no-cache') : send(res, 404, { error: 'nothing to show' });
      }
      case 'POST /api/library/use': {
        // A library nib ships: copied next to the document and imported under its id.
        const body = await readJson(req);
        if (typeof body.path !== 'string' || typeof body.id !== 'string') return send(res, 400, { error: 'path and id are required' });
        const open = await host.open(body.path);
        const rel = await installLibrary(body.id, open.path);
        const imports = open.session.doc.data.imports ?? {};
        const alias = imports[body.id] === rel ? body.id : aliasFor(body.id, Object.keys(imports));
        if (imports[alias] !== rel) await host.addImport(open.path, alias, rel, { kind: 'user' });
        return send(res, 200, { alias, path: rel });
      }
      case 'POST /api/library/import': {
        // Any .lib.pen (or .pen) file, imported by its path relative to the document.
        const body = await readJson(req);
        if (typeof body.path !== 'string' || typeof body.file !== 'string' || !body.file.endsWith('.pen')) return send(res, 400, { error: 'path and a .pen file are required' });
        const open = await host.open(body.path);
        const file = resolvePath(body.file);
        if (file === open.path) return send(res, 400, { error: 'a document cannot import itself' });
        const rel = relative(dirname(open.path), file);
        const imports = open.session.doc.data.imports ?? {};
        const existing = Object.entries(imports).find(([, r]) => resolvePath(dirname(open.path), r) === file)?.[0];
        const alias = existing ?? aliasFor(file, Object.keys(imports));
        if (!existing) await host.addImport(open.path, alias, rel.startsWith('.') ? rel : `./${rel}`, { kind: 'user' });
        return send(res, 200, { alias, path: rel });
      }
      case 'GET /api/thumbnail': {
        const file = q.get('path') ?? '';
        const template = q.get('template');
        const lib = q.get('library');
        if (lib) {
          const libFile = await libraryFile(lib);
          // A library shows the screen it starts designs from, or else all of it.
          const size = Number(q.get('size') ?? 480);
          const png = libFile ? (await nodePreview(opts.renderer, opts.images, libFile, 'overview', size)) ?? (await thumbnail(opts.renderer, opts.images, libFile, size)) : undefined;
          return png ? sendBytes(res, png, 'image/png') : send(res, 404, { error: 'no such library' });
        }
        if (template) {
          const png = await templateThumbnail(template, Number(q.get('size') ?? 480));
          return png ? sendBytes(res, png, 'image/png') : send(res, 404, { error: 'no such template' });
        }
        if (!file.endsWith('.pen')) return send(res, 400, { error: 'path must be a .pen file' });
        const png = await thumbnail(opts.renderer, opts.images, file, Number(q.get('size') ?? 480));
        return png ? sendBytes(res, png, 'image/png') : send(res, 404, { error: 'nothing to show' });
      }
      case 'POST /api/new': {
        const body = await readJson(req);
        let doc = typeof body.template === 'string' ? await templateDocument(body.template) : undefined;
        if (body.template && !doc) return send(res, 404, { error: 'no such template' });
        let name = typeof body.name === 'string' ? body.name : undefined;
        if (typeof body.library === 'string') {
          // Drafts share one folder, so they share its libraries/ copy.
          const lib = (await libraries()).find((l) => l.id === body.library);
          if (!lib) return send(res, 404, { error: 'no such library' });
          doc = await documentFromLibrary(lib.id, await installLibrary(lib.id, join(DRAFTS_DIR, 'draft.pen')));
          name ??= lib.name;
        }
        const path = await newDraft(doc, name);
        return send(res, 200, { path });
      }
      case 'GET /api/docs':
        return send(res, 200, { docs: host.list().map((d) => ({ path: d.path, version: d.version, active: d.path === host.active })) });
      case 'GET /api/config':
        return send(res, 200, { fallbacks: opts.fallbacks, version: DAEMON_VERSION });
      case 'GET /api/font': {
        const bytes = await opts.fonts.load({ family: q.get('family') ?? '', weight: Number(q.get('weight') ?? 400), italic: q.get('italic') === '1' });
        return bytes ? sendBytes(res, bytes, 'font/ttf') : send(res, 404, { error: 'font not found' });
      }
      case 'GET /api/icon': {
        const weight = q.get('weight');
        const g = await opts.icons.load(q.get('library') ?? 'lucide', q.get('name') ?? '', weight ? Number(weight) : undefined);
        return g ? send(res, 200, g as unknown as Json) : send(res, 404, { error: 'icon not found' });
      }
      case 'GET /api/image': {
        const doc = q.get('doc') ?? '';
        if (!host.list().some((d) => d.path === doc)) return send(res, 404, { error: 'document is not open' });
        const bytes = await opts.images(doc).load(q.get('url') ?? '');
        // Not cached: a browser node's snapshot changes under the same url.
        return bytes ? sendBytes(res, bytes, 'application/octet-stream', 'no-cache') : send(res, 404, { error: 'image not found' });
      }
      default:
        return send(res, 404, { error: 'no such endpoint' });
    }
  }

  async function templateThumbnail(id: string, size: number): Promise<Uint8Array | undefined> {
    const file = await templateFile(id);
    return file ? thumbnail(opts.renderer, opts.images, file, size) : undefined;
  }

  async function serveEditor(pathname: string, res: ServerResponse): Promise<void> {
    if (!opts.editorDir) return send(res, 404, { error: 'the editor is not built; run pnpm --filter @nib/editor build' });
    const root = resolvePath(opts.editorDir);
    let file = normalize(join(root, decodeURIComponent(pathname)));
    if (relative(root, file).startsWith('..')) return send(res, 403, { error: 'outside the editor' });
    const st = await stat(file).catch(() => undefined);
    if (!st?.isFile()) file = join(root, 'index.html');
    const body = await readFile(file).catch(() => undefined);
    if (!body) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': file.endsWith('index.html') ? 'no-cache' : 'max-age=3600' });
    res.end(body);
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname !== '/ws' || !hostOk(req) || !originOk(req) || !tokenOk(url.searchParams.get('t') ?? undefined)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => connection(ws));
  });

  /** One editor connection: documents it has open, edits it sends, changes it receives. */
  function connection(ws: WebSocket): void {
    sockets.add(ws);
    activity();
    const subscriptions = new Map<string, () => void>();
    const client = randomBytes(4).toString('hex');
    const out = (msg: Json | DocEvent) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };
    const sendDoc = (path: string) => out({ t: 'doc', path, ...host.snapshot(path) });
    ws.on('message', async (raw) => {
      activity();
      let msg: Json;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return out({ t: 'error', error: 'messages must be JSON' });
      }
      const path = typeof msg.path === 'string' ? msg.path : '';
      try {
        switch (msg.t) {
          case 'open': {
            const notes: string[] = [];
            const doc = await host.open(path, notes);
            if (!subscriptions.has(doc.path)) {
              const offDoc = host.subscribe(doc.path, out);
              const offAgent = opts.agent?.subscribe(doc.path, out);
              subscriptions.set(doc.path, () => { offDoc(); offAgent?.(); });
            }
            out({ t: 'doc', path: doc.path, notes, client, ...host.snapshot(doc.path) });
            break;
          }
          case 'edit': {
            const source: Source = { kind: 'user', client };
            try {
              const version = await host.edit(path, msg.ops as Op[], source, typeof msg.label === 'string' ? msg.label : 'Edit');
              out({ t: 'ack', seq: msg.seq, ok: true, version });
            } catch (e) {
              // The editor's copy was out of date: send it the current document.
              out({ t: 'ack', seq: msg.seq, ok: false, error: (e as Error).message });
              sendDoc(path);
            }
            break;
          }
          case 'undo':
          case 'redo':
            await host[msg.t](path);
            break;
          case 'close':
            subscriptions.get(path)?.();
            subscriptions.delete(path);
            break;
          default:
            out({ t: 'error', error: `unknown message ${JSON.stringify(msg.t)}` });
        }
      } catch (e) {
        out({ t: 'error', path, error: (e as Error).message });
      }
    });
    ws.on('close', () => {
      for (const off of subscriptions.values()) off();
      sockets.delete(ws);
      activity();
    });
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });

  const base = `http://127.0.0.1:${port}`;
  function editorUrl(file?: string): string {
    const params = new URLSearchParams({ t: token, ...(file ? { file } : {}) });
    return `${base}/#${params}`;
  }
  return {
    port,
    token,
    url: base,
    editorUrl,
    close: () => new Promise((resolve) => {
      for (const ws of sockets) ws.terminate();
      wss.close();
      server.close(() => resolve());
    }),
  };
}

/** The selected nodes, as the agent is told about them: id, type, name and box. */
function describeSelection(open: OpenDocument, ids: string[]): string | undefined {
  const lines = ids.flatMap((id) => {
    const n = open.session.doc.get(id);
    if (!n) return [];
    const b = open.session.box(id);
    const size = b ? ` ${Math.round(b.width)}×${Math.round(b.height)} at (${Math.round(b.x)}, ${Math.round(b.y)})` : '';
    const text = n.type === 'text' && typeof n.content === 'string' ? ` "${n.content.slice(0, 80)}"` : '';
    return [`- \`${id}\` ${n.type}${n.name ? ` "${n.name}"` : ''}${n.type === 'ref' ? ` (instance of ${n.ref})` : ''}${text}${size}`];
  });
  return lines.length ? `Document: ${open.path}\nSelected in the editor:\n${lines.join('\n')}` : `Document: ${open.path}\nNothing is selected in the editor.`;
}

function send(res: ServerResponse, status: number, body: Json): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(text);
}

function sendBytes(res: ServerResponse, bytes: Uint8Array, type: string, cache = 'max-age=86400'): void {
  res.writeHead(200, { 'content-type': type, 'cache-control': cache });
  res.end(bytes);
}

async function readJson(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('request too large');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  const v = text ? JSON.parse(text) : {};
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('expected a JSON object');
  return v as Json;
}
