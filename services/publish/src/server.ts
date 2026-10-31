import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { apiIdentity, AuthError, ssoIdentity, type Identity } from './auth.ts';
import type { Siteflow, SiteFile } from './siteflow.ts';
import { Sites, type Site } from './store.ts';

/**
 * nib-publish: nib's door to w33d. A person signed in to w33d in nib publishes the pages nib made as a site,
 * public or for w33d users only:
 *
 * - /api/…  (Sluice route auth=bearer) publish, list, change and take down one's own sites;
 * - /s/<slug>/…  (auth=public) public sites;
 * - /p/<slug>/…  (auth=sso) every site, for signed-in w33d users: private sites live only here.
 *
 * Files are kept by Siteflow; this service decides who may see them and serves them from there.
 */

export interface Config {
  /** Gateway key Sluice signs identities with (X-Auth-Sig). */
  gatewayKey: string;
  /** Keystone client id nib signs in as: the audience of the tokens accepted. */
  audience: string;
  /** Public address of this service, for the links it hands out. */
  publicBase: string;
  siteflow: Siteflow;
  sites: Sites;
  /** Largest upload, in bytes of JSON. */
  maxBody?: number;
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const RESERVED = new Set(['api', 'admin', 'assets', 'static', 'www']);
const MAX_FILES = 2000;

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(text);
}

async function readJson(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new HttpError(413, `the site is larger than ${Math.round(limit / 1e6)} MB`);
    chunks.push(c as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'the body must be a JSON object');
  }
}

/** What the owner sees of a site. */
const view = (s: Site, base: string) => ({
  slug: s.slug, name: s.name, visibility: s.visibility, version: s.version, files: s.files, bytes: s.bytes, created: s.created, updated: s.updated,
  url: s.visibility === 'public' ? `${base}/s/${s.slug}/` : `${base}/p/${s.slug}/`,
  privateUrl: `${base}/p/${s.slug}/`,
});

/** Files of a site from an upload: relative paths, an index.html, within the limits. */
function filesOf(v: unknown): SiteFile[] {
  if (!Array.isArray(v) || !v.length) throw new HttpError(400, 'files are required');
  if (v.length > MAX_FILES) throw new HttpError(413, `at most ${MAX_FILES} files`);
  const out: SiteFile[] = [];
  const seen = new Set<string>();
  for (const f of v) {
    const path = typeof f?.path === 'string' ? f.path.replace(/^\/+/, '') : '';
    if (!path || path.split('/').some((p: string) => !p || p === '.' || p === '..') || /[\\\0]/.test(path) || path.length > 300) throw new HttpError(400, `bad file path ${JSON.stringify(f?.path)}`);
    if (typeof f.contentBase64 !== 'string') throw new HttpError(400, `${path}: contentBase64 is required`);
    if (seen.has(path)) throw new HttpError(400, `${path} appears twice`);
    seen.add(path);
    out.push({ path, contentBase64: f.contentBase64 });
  }
  if (!seen.has('index.html')) throw new HttpError(400, 'a site needs an index.html');
  return out;
}

export function startServer(cfg: Config, port: number, host = '0.0.0.0'): Promise<Server> {
  const maxBody = cfg.maxBody ?? 60 * 1024 * 1024;
  const base = cfg.publicBase.replace(/\/+$/, '');

  async function api(req: IncomingMessage, res: ServerResponse, path: string[]): Promise<void> {
    const who: Identity = apiIdentity(req.headers, { key: cfg.gatewayKey, audience: cfg.audience });
    const method = req.method ?? 'GET';
    if (method === 'GET' && path.length === 1 && path[0] === 'me') return send(res, 200, { sub: who.sub });
    if (method === 'GET' && path.length === 1 && path[0] === 'sites') return send(res, 200, { sites: (await cfg.sites.ofOwner(who.sub)).map((s) => view(s, base)) });
    if (path[0] !== 'sites' || path.length !== 2) throw new HttpError(404, 'no such endpoint');
    const slug = path[1];
    if (!SLUG.test(slug) || RESERVED.has(slug)) throw new HttpError(400, 'a site name is 1–40 lowercase letters, digits and dashes');
    const existing = await cfg.sites.get(slug);
    if (existing && existing.owner !== who.sub) throw new HttpError(409, `"${slug}" is taken by someone else`);

    if (method === 'GET') {
      if (!existing) throw new HttpError(404, 'no such site');
      return send(res, 200, view(existing, base));
    }
    if (method === 'PUT') {
      // A new version of the site (or its first): uploaded to Siteflow under a host of its own.
      const body = await readJson(req, maxBody);
      const files = filesOf(body.files);
      const visibility = body.visibility === 'public' ? 'public' : 'private';
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : slug;
      const siteId = existing?.siteId ?? randomBytes(5).toString('hex');
      const version = (existing?.version ?? 0) + 1;
      const d = await cfg.siteflow.deploy(`nib-${siteId}`, `nib-${siteId}-v${version}`, files);
      const now = new Date().toISOString();
      const site = await cfg.sites.change((sites) => {
        const current = sites[slug];
        if (current && current.owner !== who.sub) throw new HttpError(409, `"${slug}" is taken by someone else`);
        const next: Site = {
          slug, name, owner: who.sub, ...(typeof body.ownerLabel === 'string' ? { ownerLabel: body.ownerLabel.slice(0, 200) } : current?.ownerLabel ? { ownerLabel: current.ownerLabel } : {}),
          visibility, siteId, projectId: d.projectId, host: d.previewHost, version, deploymentId: d.deploymentId,
          files: d.fileCount ?? files.length, bytes: d.totalBytes ?? 0, created: current?.created ?? now, updated: now,
        };
        sites[slug] = next;
        return next;
      });
      return send(res, existing ? 200 : 201, view(site, base));
    }
    if (method === 'PATCH') {
      if (!existing) throw new HttpError(404, 'no such site');
      const body = await readJson(req, 64 * 1024);
      if (body.visibility !== 'public' && body.visibility !== 'private') throw new HttpError(400, 'visibility is "public" or "private"');
      const site = await cfg.sites.change((sites) => {
        const s = sites[slug];
        if (!s || s.owner !== who.sub) throw new HttpError(404, 'no such site');
        s.visibility = body.visibility as Site['visibility'];
        s.updated = new Date().toISOString();
        return s;
      });
      return send(res, 200, view(site, base));
    }
    if (method === 'DELETE') {
      if (!existing) throw new HttpError(404, 'no such site');
      await cfg.sites.change((sites) => { if (sites[slug]?.owner === who.sub) delete sites[slug]; });
      // Its files stay in Siteflow (archived), but nothing serves them any more.
      await cfg.siteflow.archive(existing.projectId).catch(() => undefined);
      return send(res, 200, { removed: slug });
    }
    throw new HttpError(405, 'method not allowed');
  }

  /** A file of site `slug` from Siteflow; `requireSignIn` for the private door (/p/). */
  async function serve(req: IncomingMessage, res: ServerResponse, door: 's' | 'p', slug: string, rest: string, query: string): Promise<void> {
    if (door === 'p') ssoIdentity(req.headers, cfg.gatewayKey);
    const site = SLUG.test(slug) ? await cfg.sites.get(slug) : undefined;
    // A private site behind the public door does not exist, as far as anyone can tell.
    if (!site || (door === 's' && site.visibility !== 'public')) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end('No such site.');
      return;
    }
    const pass: Record<string, string> = {};
    for (const h of ['accept', 'accept-encoding', 'if-none-match', 'if-modified-since', 'range']) {
      const v = req.headers[h];
      if (typeof v === 'string') pass[h] = v;
    }
    const up = await cfg.siteflow.get(site.host, `/${rest}${query}`, pass);
    const headers: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(up.headers)) {
      if (v === undefined || ['set-cookie', 'connection', 'keep-alive', 'transfer-encoding', 'strict-transport-security'].includes(k)) continue;
      headers[k] = v;
    }
    // Private pages are not cached by shared caches.
    headers['cache-control'] = site.visibility === 'private' || door === 'p' ? 'private, no-cache' : (typeof up.headers['cache-control'] === 'string' ? up.headers['cache-control'] : 'no-cache');
    headers['x-content-type-options'] = 'nosniff';
    headers['referrer-policy'] = 'strict-origin-when-cross-origin';
    res.writeHead(up.statusCode ?? 502, headers);
    up.pipe(res);
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://nib-publish');
    const path = url.pathname;
    const handle = async () => {
      if (path === '/healthz') return send(res, 200, { ok: true });
      if (path.startsWith('/api/')) return api(req, res, path.slice(5).split('/').filter(Boolean).map(decodeURIComponent));
      const m = /^\/(s|p)\/([^/]+)(\/.*)?$/.exec(path);
      if (m) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method not allowed');
        // Pages refer to each other relatively, so a site's address ends with a slash.
        if (m[3] === undefined) { res.writeHead(301, { location: `/${m[1]}/${m[2]}/${url.search}` }); res.end(); return; }
        return serve(req, res, m[1] as 's' | 'p', m[2], m[3].slice(1), url.search);
      }
      if (path === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
        res.end('<!DOCTYPE html><meta charset="utf-8"><title>nib on w33d</title><body style="font:15px system-ui;margin:48px;color:#222"><h1 style="font-size:20px">nib on w33d</h1><p>Sites made with nib live here. Publish one from nib: Share → Publish to w33d.</p></body>');
        return;
      }
      throw new HttpError(404, 'not found');
    };
    handle().catch((e) => {
      const status = e instanceof HttpError || e instanceof AuthError ? e.status : 502;
      if (!res.headersSent) send(res, status, { error: (e as Error).message });
      else res.end();
    });
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}
