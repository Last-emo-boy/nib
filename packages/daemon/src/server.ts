import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, dirname, extname, join, normalize, relative, resolve as resolvePath } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { childrenOf, classifyStroke, flatten, isSketchStroke, pathInBox, sketchOutline, type Op } from '@nib/core';
import type { Node } from '@nib/format';
import type { FallbackFamilies, FontLoader, IconSource, ImageLoader, Renderer } from '@nib/render';
import { faceInfo, faceOffsets, type FolderFontLoader, type SystemFontLoader } from '@nib/render/node';
import type { DocEvent, DocumentHost, OpenDocument, Source } from './host.ts';
import { draftFile, draftPath, DRAFTS_DIR, drafts, newDraft, NIB_HOME, nodePreview, recents, thumbnail, trashDraft, updateRecents } from './library.ts';
import { aliasFor, brandLibrary, documentFromLibrary, installLibrary, libraries, libraryFile } from './libraries.ts';
import { brandFromPage, brandFromPalette, paletteFromPixels, paletteFromSvg, type Brand } from './brand.ts';
import { templateDocument, templateFile, templates } from './templates.ts';
import { tokensFromCss, tokensFromJson, tokensToCss, tokensToJson, tokensToTailwind } from '@nib/export';
import type { BrowserService } from './browser/service.ts';
import { buildShare, exportSite, lanAddress, serveShare, sharedId, ShareServer } from './share.ts';
import { slugFor, W33d, W33dError, type W33dConfig } from './w33d.ts';
import { planVariants, variantPrompt } from './agent/variants.ts';
import { planResponsive, responsivePrompt } from './agent/responsive.ts';
import { helperPrompt, helperTasks } from './agent/helpers.ts';
import { planStress, SCENARIOS, type Scenario } from './stress.ts';
import type { Pictures } from './pictures.ts';
import type { Exporter } from '@nib/exec';
import type { AgentService } from './agent/service.ts';

export const DAEMON_VERSION = '0.1.0';
export const DEFAULT_PORT = 7451;

export interface DaemonOptions {
  host: DocumentHost;
  /** Renders dashboard thumbnails. */
  renderer: Renderer;
  /** The `browser` tool; without it the endpoint answers that no browser is available. */
  browser?: BrowserService;
  /** Stock photos and pictures made by an image model, for layers' fills. */
  pictures?: Pictures;
  /** nib's own agent; without it the agent endpoints answer that there is none. */
  agent?: AgentService;
  fonts: FontLoader;
  /** Fonts kept beside designs (`fonts/`) and installed ones, for the font list; without them it is empty. */
  projectFonts?: FolderFontLoader;
  systemFonts?: SystemFontLoader;
  icons: IconSource;
  images: (penFile: string) => ImageLoader;
  fallbacks: FallbackFamilies;
  port?: number;
  /** Built editor (apps/editor/dist); without it only the API is served. */
  editorDir?: string;
  /** Extra origins allowed to call the API, e.g. the editor's dev server. */
  devOrigins?: string[];
  token?: string;
  /** Publishing to w33d: how to sign in and where nib-publish is (without it, the w33d endpoints answer 404). */
  w33d?: Omit<W33dConfig, 'redirectUri'>;
  /** The static-site exporter, for publishing. */
  siteExporter?: Exporter;
  /** Where shared snapshots are kept (default: shares/ in nib's home). */
  sharesDir?: string;
  /** Address the local-network share server listens on (default all interfaces; tests use 127.0.0.1). */
  shareBind?: string;
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
  const sharesDir = opts.sharesDir ?? join(NIB_HOME, 'shares');
  const lan = new ShareServer(sharesDir, opts.shareBind);
  const lanUrl = (id: string) => (lan.on ? `http://${opts.shareBind && opts.shareBind !== '0.0.0.0' ? opts.shareBind : lanAddress() ?? '127.0.0.1'}:${lan.port}/share/${id}/` : undefined);
  const activity = () => opts.onActivity?.(sockets.size);
  let w33d: W33d | undefined;
  /** What each document was published as on w33d (by path). */
  const publishedFile = join(NIB_HOME, 'w33d-sites.json');
  const published = async (): Promise<Record<string, { slug: string; visibility: 'public' | 'private'; url: string }>> => JSON.parse(await readFile(publishedFile, 'utf8').catch(() => '{}'));
  const notePublished = async (doc: string, entry: { slug: string; visibility: 'public' | 'private'; url: string } | undefined) => {
    const all = await published();
    if (entry) all[doc] = entry; else delete all[doc];
    await mkdir(NIB_HOME, { recursive: true });
    await writeFile(publishedFile, JSON.stringify(all, null, 2));
  };

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
    // The browser coming back from signing in to w33d.
    if (url.pathname === '/auth/w33d/callback' && req.method === 'GET') {
      const page = (title: string, text: string, status = 200) => {
        res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
        res.end(`<!DOCTYPE html><meta charset="utf-8"><title>${title}</title><body style="font:15px -apple-system,system-ui;margin:56px;color:#222"><h1 style="font-size:20px">${title}</h1><p>${text}</p></body>`);
      };
      const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
      if (!w33d) return page('Not available', 'This nib has no w33d sign-in.', 404);
      const code = url.searchParams.get('code'), state = url.searchParams.get('state');
      if (!code || !state) return page('Not signed in', esc(url.searchParams.get('error_description') ?? url.searchParams.get('error') ?? 'w33d sent no code.'), 400);
      try {
        const s = await w33d.finish(code, state);
        return page('Signed in to w33d', `${s.email ? `As ${esc(s.email)}. ` : ''}You can close this tab and go back to nib.`);
      } catch (e) {
        return page('Not signed in', esc((e as Error).message), 400);
      }
    }
    // Shared snapshots: read-only files whose unguessable id is the permission.
    if (url.pathname.startsWith('/share/') && req.method === 'GET' && (await serveShare(sharesDir, url.pathname, res))) return;
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
      case 'GET /api/review': {
        // A design review of the document, or of one top-level frame.
        const doc = q.get('doc') ?? '';
        if (!host.list().some((d) => d.path === doc)) return send(res, 404, { error: 'document is not open' });
        return send(res, 200, { items: (await host.review(doc, q.get('frame') ?? undefined)) as unknown as Json[] });
      }
      case 'GET /api/picture/status':
        return send(res, 200, { stock: !!opts.pictures, make: (await opts.pictures?.canMake()) ?? false });
      case 'POST /api/picture': {
        // A picture for a layer's fill, chosen in the editor: a stock photo, or one an image model makes.
        if (!opts.pictures) return send(res, 404, { error: 'this nib has no picture service' });
        const body = await readJson(req);
        if (typeof body.doc !== 'string' || typeof body.node !== 'string' || (body.kind !== 'stock' && body.kind !== 'image') || typeof body.prompt !== 'string' || !body.prompt.trim()) return send(res, 400, { error: 'doc, node, kind and prompt are required' });
        const open = await host.open(body.doc);
        const node = open.session.doc.get(body.node);
        if (!node || !['frame', 'rectangle', 'ellipse', 'polygon', 'path'].includes(node.type)) return send(res, 400, { error: 'pictures fill frames, rectangles and ellipses' });
        const b = open.session.box(body.node);
        const index = Math.min(9, Math.max(0, Math.floor(Number(body.index) || 0)));
        try {
          const r = await opts.pictures.make({ kind: body.kind, prompt: body.prompt.trim(), width: Math.max(64, Math.round(b?.width ?? 512)), height: Math.max(64, Math.round(b?.height ?? 512)), index }, dirname(open.path));
          await host.edit(open.path, [{ op: 'set', id: body.node, props: { fill: { type: 'image', url: r.url, mode: 'cover' } } }], { kind: 'user' }, body.kind === 'stock' ? 'Stock photo' : 'Generated picture');
          return send(res, 200, { url: r.url, ...(r.credit ? { credit: r.credit } : {}) });
        } catch (e) {
          return send(res, 400, { error: (e as Error).message });
        }
      }
      case 'POST /api/picture/vectorize':
      case 'POST /api/picture/cutout': {
        // A layer's picture as shapes, or without its background: the execute calls, as the person's change.
        const body = await readJson(req);
        if (typeof body.doc !== 'string' || typeof body.node !== 'string') return send(res, 400, { error: 'doc and node are required' });
        const vectorize = url.pathname === '/api/picture/vectorize';
        const options = vectorize ? { colors: Math.min(24, Math.max(2, Math.round(Number(body.colors) || 8))), detail: ['low', 'medium', 'high'].includes(body.detail as string) ? body.detail : 'medium' } : { method: body.method === 'model' ? 'model' : 'color' };
        const r = await host.execute(body.doc, { input: `${vectorize ? 'Vectorize' : 'RemoveBackground'}(${JSON.stringify(body.node)}, ${JSON.stringify(options)})` }, 'nib', { source: { kind: 'user' }, label: vectorize ? 'Vectorize' : 'Remove background' });
        if (!r.ok) return send(res, 400, { error: (/Error: [^:]+: (.*)/.exec(r.text)?.[1] ?? r.text).split('\n')[0] });
        const created = r.ops.find((o) => o.op === 'insert');
        return send(res, 200, { ...(created?.op === 'insert' ? { created: created.node.id } : {}) });
      }
      case 'POST /api/stress': {
        // Copies of a frame with long text, other scripts, the dark theme and a narrow width, reviewed for
        // what breaks (findings the original already has are left out).
        const body = await readJson(req);
        if (typeof body.doc !== 'string' || typeof body.frame !== 'string') return send(res, 400, { error: 'doc and frame are required' });
        const scenarios = (Array.isArray(body.scenarios) ? body.scenarios : SCENARIOS).filter((s): s is Scenario => SCENARIOS.includes(s as Scenario));
        const open = await host.open(body.doc);
        let plan: ReturnType<typeof planStress>;
        try {
          plan = planStress(open.session.doc, body.frame, scenarios, (id) => open.session.box(id));
        } catch (e) {
          return send(res, 400, { error: (e as Error).message });
        }
        if (plan.ops.length) await host.edit(open.path, plan.ops, { kind: 'user' }, 'Stress test');
        const known = new Set((await host.review(open.path, body.frame, { overflow: true })).map((i) => `${i.kind}|${i.id}`));
        const copies = [];
        for (const c of plan.copies) {
          const back = new Map([...c.map].map(([from, to]) => [to, from]));
          const findings = (await host.review(open.path, c.id, { overflow: true }))
            .map((i) => ({ ...i, of: back.get(i.id) ?? i.id }))
            // Gaps and edges move with the text on every copy: only what breaks is news.
            .filter((i) => i.kind !== 'alignment' && i.kind !== 'spacing' && !known.has(`${i.kind}|${i.of}`));
          copies.push({ scenario: c.scenario, label: c.label, frame: c.id, name: c.name, findings });
        }
        return send(res, 200, { copies: copies as unknown as Json[], skipped: plan.skipped as unknown as Json[] });
      }
      case 'GET /api/tokens': {
        // The document's variables as CSS variables, a Tailwind theme, or W3C design tokens JSON.
        const open = await host.open(q.get('doc') ?? '');
        const data = open.session.doc.data;
        const format = q.get('format') ?? 'css';
        const text = format === 'json' ? tokensToJson(data) : format === 'tailwind' ? tokensToTailwind(data) : tokensToCss(data);
        return send(res, 200, { text, name: format === 'json' ? 'tokens.json' : format === 'tailwind' ? 'theme.css' : 'tokens.css' });
      }
      case 'POST /api/tokens/import': {
        // CSS custom properties (:root and .dark blocks) or W3C design tokens JSON, from a file or text.
        const body = await readJson(req);
        if (typeof body.path !== 'string' || (typeof body.file !== 'string' && typeof body.text !== 'string')) return send(res, 400, { error: 'path and a file or text are required' });
        const text = typeof body.text === 'string' ? body.text : await readFile(resolvePath(body.file as string), 'utf8');
        const json = typeof body.file === 'string' ? body.file.endsWith('.json') : text.trimStart().startsWith('{');
        let tokens;
        try {
          tokens = json ? tokensFromJson(text) : tokensFromCss(text);
        } catch (e) {
          return send(res, 400, { error: `could not read the tokens: ${(e as Error).message}` });
        }
        const count = Object.keys(tokens.variables).length;
        if (!count) return send(res, 400, { error: 'no variables found (expected CSS custom properties like --primary: #000 or design tokens JSON)' });
        const open = await host.open(body.path);
        await host.addVariables(open.path, tokens.variables, tokens.themes, { kind: 'user' }, `Import ${count} variables`);
        return send(res, 200, { count, skipped: tokens.skipped });
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
        return send(res, 200, { providers: opts.agent ? await opts.agent.providerInfo(q.get('fresh') === '1') : [] });
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
            attachments: Array.isArray(body.attachments) ? (body.attachments as { name: string; type: string; data: string }[]) : undefined,
          });
          return send(res, 200, { session: session as unknown as Json });
        } catch (e) {
          return send(res, 409, { error: (e as Error).message });
        }
      }
      case 'POST /api/agent/variants': {
        // Several agents at once, each on its own copy of a top-level frame, side by side.
        if (!opts.agent) return send(res, 404, { error: 'this nib has no agent' });
        const body = await readJson(req);
        const count = Number(body.count);
        if (typeof body.doc !== 'string' || typeof body.frame !== 'string' || typeof body.provider !== 'string' || typeof body.text !== 'string' || !body.text.trim()) return send(res, 400, { error: 'doc, frame, provider and text are required' });
        if (!Number.isInteger(count) || count < 2 || count > 4) return send(res, 400, { error: 'count is 2 to 4' });
        const open = await host.open(body.doc);
        const original = open.session.doc.get(body.frame);
        let plan: ReturnType<typeof planVariants>;
        try {
          plan = planVariants(open.session.doc, body.frame, count, (id) => open.session.box(id));
        } catch (e) {
          return send(res, 400, { error: (e as Error).message });
        }
        await host.edit(open.path, plan.ops, { kind: 'user' }, `Make ${count} variants`);
        const group = randomBytes(6).toString('hex');
        const title = body.text.replace(/\s+/g, ' ').slice(0, 48);
        const sessions = [];
        for (const [index, f] of plan.frames.entries()) {
          sessions.push(await opts.agent.send({
            doc: open.path, provider: body.provider, model: typeof body.model === 'string' ? body.model : undefined,
            text: body.text, instructions: variantPrompt({ index, count, frame: f.id, name: f.name, original: String(original?.name ?? body.frame) }),
            title: `${title} · ${index + 1}/${count}`, selection: [f.id], context: describeSelection(open, [f.id]),
            variant: { group, of: body.frame, frame: f.id, index, count },
            attachments: Array.isArray(body.attachments) ? (body.attachments as { name: string; type: string; data: string }[]) : undefined,
          }));
        }
        return send(res, 200, { group, frames: plan.frames, sessions: sessions as unknown as Json[] });
      }
      case 'POST /api/agent/responsive': {
        // Tablet and phone versions of a top-level frame, each adapted by its own agent at the same time.
        if (!opts.agent) return send(res, 404, { error: 'this nib has no agent' });
        const body = await readJson(req);
        if (typeof body.doc !== 'string' || typeof body.frame !== 'string' || typeof body.provider !== 'string' || typeof body.text !== 'string' || !body.text.trim()) return send(res, 400, { error: 'doc, frame, provider and text are required' });
        const open = await host.open(body.doc);
        const original = String(open.session.doc.get(body.frame)?.name ?? body.frame);
        let plan: ReturnType<typeof planResponsive>;
        try {
          plan = planResponsive(open.session.doc, body.frame, (id) => open.session.box(id));
        } catch (e) {
          return send(res, 400, { error: (e as Error).message });
        }
        await host.edit(open.path, plan.ops, { kind: 'user' }, 'Make responsive versions');
        const sessions = [];
        for (const f of plan.frames) {
          sessions.push(await opts.agent.send({
            doc: open.path, provider: body.provider, model: typeof body.model === 'string' ? body.model : undefined,
            text: body.text, instructions: responsivePrompt({ device: f.device, frame: f.id, name: f.name, of: body.frame, original, others: plan.frames.length - 1 }),
            title: `${f.device.label} · ${original}`.slice(0, 60), selection: [f.id], context: describeSelection(open, [f.id]),
          }));
        }
        return send(res, 200, { frames: plan.frames.map((f) => ({ id: f.id, name: f.name, device: f.device.id })), sessions: sessions as unknown as Json[] });
      }
      case 'POST /api/agent/spawn': {
        // Helpers an agent starts (spawn_agents): same document, provider and model as its own session.
        if (!opts.agent) return send(res, 404, { error: 'this nib has no agent' });
        const body = await readJson(req);
        const parent = typeof body.parent === 'string' ? await opts.agent.get(body.parent) : undefined;
        if (!parent?.running) return send(res, 400, { error: 'helpers are started by a working agent of nib' });
        if (parent.parent) return send(res, 400, { error: 'a helper cannot start helpers of its own: do the work yourself' });
        const tasks = helperTasks(body.tasks);
        if (typeof tasks === 'string') return send(res, 400, { error: tasks });
        const open = await host.open(parent.doc);
        const unknown = tasks.find((t) => t.frameId && !open.session.doc.has(t.frameId));
        if (unknown) return send(res, 400, { error: `there is no layer with id ${unknown.frameId}` });
        const agents = [];
        for (const t of tasks) {
          const selection = t.frameId ? [t.frameId] : [];
          const s = await opts.agent.send({
            doc: open.path, provider: parent.provider, model: parent.model || undefined, text: t.task, instructions: helperPrompt(t, parent.title, tasks.length),
            title: (t.title ?? t.task.replace(/\s+/g, ' ')).slice(0, 60), selection, context: describeSelection(open, selection), parent: parent.id,
          });
          agents.push({ id: s.id, title: s.title });
        }
        return send(res, 200, { agents });
      }
      case 'GET /api/agent/macros':
        return send(res, 200, { macros: (opts.agent ? await opts.agent.macros() : []) as unknown as Json[] });
      case 'POST /api/agent/macros': {
        // Save a message as a command (replacing one of the same name).
        if (!opts.agent) return send(res, 404, { error: 'this nib has no agent' });
        const body = await readJson(req);
        if (typeof body.name !== 'string' || typeof body.text !== 'string') return send(res, 400, { error: 'name and text are required' });
        try {
          return send(res, 200, { macros: await opts.agent.saveMacro(body.name, body.text) as unknown as Json[] });
        } catch (e) {
          return send(res, 400, { error: (e as Error).message });
        }
      }
      case 'POST /api/agent/macros/delete': {
        if (!opts.agent) return send(res, 404, { error: 'this nib has no agent' });
        const body = await readJson(req);
        return send(res, 200, { macros: await opts.agent.deleteMacro(String(body.name ?? '')) as unknown as Json[] });
      }
      case 'POST /api/agent/wait': {
        // How the helpers a session started are doing: once none works (or after at most 50 s).
        if (!opts.agent) return send(res, 404, { error: 'this nib has no agent' });
        const body = await readJson(req);
        const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, 20) : [];
        const mine = await Promise.all(ids.map(async (id) => (await opts.agent!.get(id))?.parent === body.parent));
        if (!ids.length || mine.includes(false)) return send(res, 400, { error: 'ids must be helpers this agent started' });
        const seconds = Math.min(50, Math.max(0, Number(body.seconds ?? 45) || 0));
        return send(res, 200, { agents: await opts.agent.wait(ids, seconds * 1000) as unknown as Json[] });
      }
      case 'GET /api/agent/attachment': {
        // A file attached to a message, from the session's own folder only.
        if (!opts.agent) return send(res, 404, { error: 'this nib has no agent' });
        const dir = resolvePath(opts.agent.attachmentsDir(q.get('session') ?? ''));
        const file = resolvePath(dir, basename(q.get('file') ?? ''));
        const bytes = file.startsWith(dir + '/') ? await readFile(file).catch(() => undefined) : undefined;
        const type = /\.png$/i.test(file) ? 'image/png' : /\.jpe?g$/i.test(file) ? 'image/jpeg' : /\.gif$/i.test(file) ? 'image/gif' : /\.webp$/i.test(file) ? 'image/webp' : 'text/plain; charset=utf-8';
        return bytes ? sendBytes(res, bytes, type, 'private, max-age=3600') : send(res, 404, { error: 'no such attachment' });
      }
      case 'GET /api/agent/usage':
        return send(res, 200, opts.agent ? { usage: await opts.agent.usage() as unknown as Json, settings: await opts.agent.settings() as unknown as Json } : { usage: {}, settings: {} });
      case 'POST /api/agent/settings': {
        const body = await readJson(req);
        return send(res, 200, { settings: opts.agent ? await opts.agent.saveSettings(body as never) as unknown as Json : {} });
      }
      case 'POST /api/agent/signin': {
        // Terminal opens with the provider's sign-in command (claude, codex login); the person signs in there.
        const body = await readJson(req);
        const ok = typeof body.provider === 'string' && !!opts.agent && (await opts.agent.signIn(body.provider).catch(() => false));
        return send(res, 200, { ok });
      }
      case 'POST /api/agent/restore': {
        const body = await readJson(req);
        if (!opts.agent || typeof body.session !== 'string' || typeof body.item !== 'string') return send(res, 400, { error: 'session and item are required' });
        try {
          await opts.agent.restore(body.session, body.item);
          return send(res, 200, { ok: true });
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
      case 'POST /api/draft/rename': {
        // A draft gets a name (it stays in the drafts folder, so its images still resolve).
        const body = await readJson(req);
        const from = draftFile(body.path), to = typeof body.name === 'string' ? draftPath(body.name) : undefined;
        if (!from || !to) return send(res, 400, { error: 'path must be a draft and name a file name' });
        if (to === from) return send(res, 200, { path: to });
        if (await stat(to).catch(() => undefined)) return send(res, 409, { error: `a draft named "${basename(to, '.pen')}" already exists` });
        if (host.list().some((d) => d.path === from)) await host.rename(from, to);
        else { await rename(from, to); await updateRecents(from, to); }
        return send(res, 200, { path: to });
      }
      case 'POST /api/draft/delete': {
        // Into nib's trash (recoverable); editors that have it open leave it.
        const body = await readJson(req);
        const file = draftFile(body.path);
        if (!file || !(await stat(file).catch(() => undefined))) return send(res, 400, { error: 'path must be an existing draft' });
        await host.discard(file);
        return send(res, 200, { trashed: await trashDraft(file) });
      }
      case 'POST /api/library/convert': {
        // "Turn this file into a library": x.pen becomes x.lib.pen, in place.
        const body = await readJson(req);
        if (typeof body.path !== 'string' || !body.path.endsWith('.pen') || body.path.endsWith('.lib.pen')) return send(res, 400, { error: 'path must be a .pen file that is not a library yet' });
        const open = await host.open(body.path);
        try {
          return send(res, 200, { path: await host.rename(open.path, open.path.replace(/\.pen$/, '.lib.pen')) });
        } catch (e) {
          return send(res, 409, { error: (e as Error).message });
        }
      }
      case 'POST /api/asset': {
        // An image dropped or pasted into a design: saved in images/ beside the document (a new name if taken).
        const body = await readJson(req);
        if (typeof body.path !== 'string' || typeof body.data !== 'string') return send(res, 400, { error: 'path and data (base64) are required' });
        const open = await host.open(body.path);
        const bytes = Buffer.from(body.data, 'base64');
        const img = opts.renderer.ck.MakeImageFromEncoded(bytes);
        if (!img) return send(res, 422, { error: 'not an image nib can read (PNG, JPEG, WebP, GIF)' });
        const width = img.width(), height = img.height();
        img.delete();
        const ext = (/\.(png|jpe?g|webp|gif)$/i.exec(String(body.name ?? ''))?.[1] ?? ({ 0x89: 'png', 0xff: 'jpg', 0x52: 'webp', 0x47: 'gif' } as Record<number, string>)[bytes[0]] ?? 'png').toLowerCase();
        const stem = String(body.name ?? 'image').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image';
        const dir = join(dirname(open.path), 'images');
        await mkdir(dir, { recursive: true });
        let name = `${stem}.${ext}`;
        for (let i = 2; await stat(join(dir, name)).catch(() => undefined); i++) name = `${stem}-${i}.${ext}`;
        await writeFile(join(dir, name), bytes);
        return send(res, 200, { url: `images/${name}`, width, height });
      }
      case 'POST /api/w33d/login': {
        if (!w33d) return send(res, 404, { error: 'this nib has no w33d sign-in' });
        return send(res, 200, { url: w33d.start() });
      }
      case 'GET /api/w33d/status':
        return send(res, 200, w33d ? { available: true, ...(await w33d.status()) } : { available: false, signedIn: false });
      case 'POST /api/w33d/logout':
        await w33d?.signOut();
        return send(res, 200, { signedIn: false });
      case 'GET /api/w33d/site': {
        // What this document was published as, with its suggested name when it was not.
        const doc = resolvePath(q.get('doc') ?? '');
        const entry = (await published())[doc];
        return send(res, 200, { ...(entry ? { site: entry } : {}), suggested: slugFor(basename(doc)) });
      }
      case 'POST /api/w33d/publish': {
        // The design as a site (a page per frame), up to nib.w33d.xyz as the signed-in person.
        if (!w33d || !opts.siteExporter) return send(res, 404, { error: 'this nib cannot publish to w33d' });
        const body = await readJson(req);
        if (typeof body.path !== 'string' || typeof body.slug !== 'string') return send(res, 400, { error: 'path and slug are required' });
        const visibility = body.visibility === 'public' ? 'public' : 'private';
        const open = await host.open(body.path);
        const dir = await mkdtemp(join(tmpdir(), 'nib-site-'));
        try {
          await exportSite(host, opts.renderer, opts.images, opts.siteExporter, open.path, dir);
          const site = await w33d.publish(dir, body.slug, basename(open.path, '.pen'), visibility);
          await notePublished(open.path, { slug: site.slug, visibility: site.visibility, url: site.url });
          return send(res, 200, { site: site as unknown as Json });
        } catch (e) {
          return send(res, e instanceof W33dError ? e.status : 500, { error: (e as Error).message });
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }
      case 'POST /api/w33d/visibility':
      case 'POST /api/w33d/unpublish': {
        if (!w33d) return send(res, 404, { error: 'this nib has no w33d sign-in' });
        const body = await readJson(req);
        const doc = resolvePath(typeof body.path === 'string' ? body.path : '');
        const entry = (await published())[doc];
        if (!entry) return send(res, 404, { error: 'this design is not published' });
        try {
          if (url.pathname.endsWith('/unpublish')) {
            await w33d.unpublish(entry.slug);
            await notePublished(doc, undefined);
            return send(res, 200, {});
          }
          const site = await w33d.setVisibility(entry.slug, body.visibility === 'public' ? 'public' : 'private');
          await notePublished(doc, { slug: site.slug, visibility: site.visibility, url: site.url });
          return send(res, 200, { site: site as unknown as Json });
        } catch (e) {
          return send(res, e instanceof W33dError ? e.status : 500, { error: (e as Error).message });
        }
      }
      case 'POST /api/share': {
        // Snapshot the design for viewing (again, under the same link when it was shared before).
        const body = await readJson(req);
        if (typeof body.path !== 'string') return send(res, 400, { error: 'path is required' });
        const id = await buildShare(host, opts.renderer, opts.images, body.path, sharesDir);
        return send(res, 200, { id, url: `http://127.0.0.1:${port}/share/${id}/`, lanUrl: lanUrl(id), folder: join(sharesDir, id) });
      }
      case 'GET /api/share': {
        const doc = q.get('doc');
        const id = doc ? await sharedId(sharesDir, resolvePath(doc)) : undefined;
        return send(res, 200, id ? { id, url: `http://127.0.0.1:${port}/share/${id}/`, lanUrl: lanUrl(id), folder: join(sharesDir, id), lan: lan.on } : { lan: lan.on });
      }
      case 'POST /api/share/lan': {
        // The local-network server: on only when asked, serving shares and nothing else.
        const body = await readJson(req);
        if (body.on === true) await lan.start(typeof body.port === 'number' ? body.port : 0);
        else await lan.stop();
        return send(res, 200, { lan: lan.on, port: lan.port || undefined, address: lan.on ? lanAddress() : undefined });
      }
      case 'GET /api/fonts': {
        // The families a design can use: those in its fonts/ folder, and those installed on this computer.
        const doc = q.get('doc');
        const project = doc && opts.projectFonts ? await opts.projectFonts.faces(join(dirname(resolvePath(doc)), 'fonts')) : [];
        const families = new Map<string, { family: string; faces: { weight: number; italic: boolean }[] }>();
        for (const f of project) {
          const e = families.get(f.family) ?? { family: f.family, faces: [] };
          e.faces.push({ weight: f.weight, italic: f.italic });
          families.set(f.family, e);
        }
        return send(res, 200, { project: [...families.values()], installed: opts.systemFonts ? await opts.systemFonts.list() : [] });
      }
      case 'POST /api/font-file': {
        // A font file added to a design: kept in fonts/ beside it, so the design takes it along.
        const body = await readJson(req);
        if (typeof body.path !== 'string' || typeof body.data !== 'string') return send(res, 400, { error: 'path and data (base64) are required' });
        const open = await host.open(body.path);
        const bytes = new Uint8Array(Buffer.from(body.data, 'base64'));
        let families: string[];
        try {
          families = [...new Set(faceOffsets(bytes).map((o) => faceInfo(bytes, o)?.family).filter((f): f is string => !!f))];
        } catch {
          families = [];
        }
        if (!families.length) return send(res, 422, { error: 'not a font nib can read (TrueType or OpenType: .ttf, .otf, .ttc)' });
        const ext = (/\.(ttf|otf|ttc|otc)$/i.exec(String(body.name ?? ''))?.[1] ?? 'ttf').toLowerCase();
        const stem = String(body.name ?? families[0]).replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'font';
        const dir = join(dirname(open.path), 'fonts');
        await mkdir(dir, { recursive: true });
        let name = `${stem}.${ext}`;
        for (let i = 2; await stat(join(dir, name)).catch(() => undefined); i++) name = `${stem}-${i}.${ext}`;
        await writeFile(join(dir, name), bytes);
        // Text in these families that was drawn with a fallback is laid out again with the new font.
        for (const f of families) opts.renderer.fonts.forget(f);
        return send(res, 200, { file: `fonts/${name}`, families });
      }
      case 'POST /api/brand/read': {
        // A brand read from a website ({url}) or a logo ({image: base64, name}).
        const body = await readJson(req);
        try {
          if (typeof body.url === 'string' && body.url.trim()) {
            if (!opts.browser) return send(res, 503, { error: 'No browser is available in this nib.' });
            const url = /^[a-z]+:\/\//i.test(body.url.trim()) ? body.url.trim() : `https://${body.url.trim()}`;
            const { sample, font } = await opts.browser.readBrand(url);
            return send(res, 200, { ...brandFromPage(sample), ...(font ? { font } : {}) } as unknown as Json);
          }
          if (typeof body.image === 'string') {
            const bytes = Buffer.from(body.image, 'base64');
            const svg = /\.svg$/i.test(String(body.name ?? '')) || bytes.subarray(0, 1024).toString('utf8').includes('<svg');
            return send(res, 200, brandFromPalette(svg ? paletteFromSvg(bytes.toString('utf8')) : imagePalette(opts.renderer, bytes)) as unknown as Json);
          }
          return send(res, 400, { error: 'url or image is required' });
        } catch (e) {
          return send(res, 422, { error: (e as Error).message });
        }
      }
      case 'POST /api/library/brand': {
        // A themed copy of a bundled library, made next to the document and imported.
        const body = await readJson(req);
        const brand = body.brand as unknown as Brand | undefined;
        if (typeof body.path !== 'string' || typeof body.base !== 'string' || typeof brand?.primary !== 'string') return send(res, 400, { error: 'path, base and brand.primary are required' });
        const open = await host.open(body.path);
        try {
          const rel = await brandLibrary(body.base, brand, typeof body.name === 'string' ? body.name : 'brand', open.path);
          const alias = aliasFor(rel, Object.keys(open.session.doc.data.imports ?? {}));
          await host.addImport(open.path, alias, rel, { kind: 'user' });
          return send(res, 200, { alias, path: rel });
        } catch (e) {
          return send(res, 422, { error: (e as Error).message });
        }
      }
      case 'GET /api/library/nearby': {
        // Libraries a document could use: .lib.pen files beside it and in its libraries/ folder, and recent ones.
        const doc = resolvePath(q.get('doc') ?? '');
        const found = new Set<string>();
        for (const dir of [dirname(doc), join(dirname(doc), 'libraries')]) {
          for (const f of await readdir(dir).catch(() => [] as string[])) if (f.endsWith('.lib.pen')) found.add(join(dir, f));
        }
        for (const r of await recents()) if (r.path.endsWith('.lib.pen')) found.add(r.path);
        found.delete(doc);
        return send(res, 200, { files: [...found].map((path) => ({ path, name: basename(path, '.lib.pen'), rel: relative(dirname(doc), path) })) });
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
        // Not kept by the browser: a design's own font files can be replaced (editors keep faces in memory anyway).
        return bytes ? sendBytes(res, bytes, 'font/ttf', 'no-cache') : send(res, 404, { error: 'font not found' });
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
              const version = await host.edit(path, msg.ops as Op[], source, typeof msg.label === 'string' ? msg.label : 'Edit', typeof msg.merge === 'string' ? msg.merge : undefined);
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
  // w33d sends the browser back here: the redirect registered for nib names this port.
  if (opts.w33d) w33d = new W33d({ ...opts.w33d, redirectUri: `${base}/auth/w33d/callback` });
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
      void lan.stop();
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
  const sketch = sketchOf(open, ids);
  return lines.length ? `Document: ${open.path}\nSelected in the editor:\n${lines.join('\n')}${sketch ? `\n\n${sketch}` : ''}` : `Document: ${open.path}\nNothing is selected in the editor.`;
}

/** The pencil strokes in the selection read as shapes, for models that cannot see the sketch. */
function sketchOf(open: OpenDocument, ids: string[]): string | undefined {
  const doc = open.session.doc;
  const strokes: Node[] = [];
  const visit = (n: Node) => { if (isSketchStroke(n)) strokes.push(n); else for (const c of childrenOf(n) ?? []) visit(c); };
  for (const id of ids) { const n = doc.get(id); if (n) visit(n); }
  // Where a layer is in the document: its box and its parents' boxes added up (sketches are not turned).
  const origin = (id: string) => {
    let x = 0, y = 0;
    for (let cur: Node | undefined = doc.get(id); cur; cur = doc.locate(cur.id)?.parent ?? undefined) {
      const b = open.session.box(cur.id);
      if (!b) return undefined;
      x += b.x; y += b.y;
    }
    return { x, y };
  };
  const items = strokes.flatMap((n) => {
    const o = origin(n.id), b = open.session.box(n.id);
    const { geometry, viewBox } = n as { geometry?: unknown; viewBox?: number[] };
    if (!o || !b || typeof geometry !== 'string') return [];
    return pathInBox(geometry, b.width, b.height, viewBox).map((sub) => classifyStroke(flatten(sub).map((p) => ({ x: p.x + o.x, y: p.y + o.y }))));
  });
  return items.length ? sketchOutline(items) : undefined;
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

/** The colors of an image (PNG, JPEG, WebP), most used first. */
function imagePalette(renderer: Renderer, bytes: Uint8Array): string[] {
  const { ck } = renderer;
  const img = ck.MakeImageFromEncoded(bytes);
  if (!img) throw new Error('could not read the image (use PNG, JPEG, WebP or SVG)');
  try {
    const width = img.width(), height = img.height();
    const rgba = img.readPixels(0, 0, { width, height, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB });
    if (!rgba) throw new Error('could not read the image\'s pixels');
    return paletteFromPixels(rgba as Uint8Array, width, height);
  } finally {
    img.delete();
  }
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
