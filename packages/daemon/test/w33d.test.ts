import { createHmac } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serializePen, type PenDocument } from '@nib/format';
import { EXPORTERS } from '@nib/export';
import { createNodeRenderer, PackageIconSource } from '@nib/render/node';
import { DocumentHost, startDaemon, type Daemon } from '../src/index.ts';
import { startServer } from '../../../services/publish/src/server.ts';
import { Siteflow } from '../../../services/publish/src/siteflow.ts';
import { Sites } from '../../../services/publish/src/store.ts';

/**
 * Publishing to w33d end to end on this machine: nib's daemon signs in against a stand-in for Keystone, then
 * publishes through a stand-in for Sluice (which signs identities as the real one does) to the real
 * nib-publish, which keeps the files in a stand-in for Siteflow.
 */

const KEY = 'gateway-key';
const listen = (s: Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as { port: number }).port)));
const jwt = (c: Record<string, unknown>) => `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(c)).toString('base64url')}.sig`;
const sign = (sub: string) => createHmac('sha256', KEY).update(`${sub}\n\n${Math.floor(Date.now() / 60000)}`).digest('hex');
const none = { load: async () => undefined };

let daemon: Daemon, servers: Server[] = [], gatewayPort = 0, dir = '';
const nonces = new Map<string, string>();
const files = new Map<string, Map<string, Buffer>>();

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nib-w33d-'));
  // Keystone's token endpoint: a token issued to nib for usr_t, and the id token with the email and nonce.
  const keystone = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const form = new URLSearchParams(Buffer.concat(chunks).toString());
    if (req.url !== '/token' || form.get('client_id') !== 'nib-desktop' || !form.get('code_verifier')) { res.writeHead(400).end('{"error":"invalid_request"}'); return; }
    const exp = Math.floor(Date.now() / 1000) + 3600;
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      access_token: jwt({ sub: 'usr_t', aud: 'nib-desktop', exp, scope: 'openid email profile' }),
      id_token: jwt({ sub: 'usr_t', aud: 'nib-desktop', exp, email: 'tester@w33d.xyz', nonce: nonces.get(form.get('code')!) }), token_type: 'Bearer', expires_in: 3600,
    }));
  });
  // Siteflow: files by host.
  const siteflow = createServer(async (req, res) => {
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const b = JSON.parse(Buffer.concat(chunks).toString());
      const host = `${b.requestedHostPrefix}.w33d.xyz`;
      files.set(host, new Map(b.files.map((f: { path: string; contentBase64: string }) => [f.path, Buffer.from(f.contentBase64, 'base64')])));
      res.writeHead(201).end(JSON.stringify({ deploymentId: 'd1', projectId: `p-${b.projectSlug}`, previewHost: host, fileCount: b.files.length, totalBytes: 1 }));
      return;
    }
    if (req.method === 'DELETE') { res.writeHead(200).end('{}'); return; }
    const path = (req.url ?? '/').replace(/^\//, '') || 'index.html';
    const f = files.get(String(req.headers.host))?.get(path);
    if (!f) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': path.endsWith('.html') ? 'text/html' : 'application/octet-stream' }).end(f);
  });
  const sfPort = await listen(siteflow);
  const publish = await startServer({ gatewayKey: KEY, audience: 'nib-desktop', publicBase: 'https://nib.w33d.xyz', siteflow: new Siteflow(`http://127.0.0.1:${sfPort}`, 'root', 'test'), sites: new Sites(join(dir, 'sites.json')) }, 0, '127.0.0.1');
  const publishPort = (publish.address() as { port: number }).port;
  // Sluice: /api/ takes the bearer token's subject, /p/ a signed-in viewer, /s/ anyone; it signs what it vouches for.
  const gateway = createServer((req, res) => {
    const headers: Record<string, string> = { 'content-type': String(req.headers['content-type'] ?? '') };
    const path = req.url ?? '/';
    const sub = path.startsWith('/api/') ? JSON.parse(Buffer.from(String(req.headers.authorization ?? '').split('.')[1] ?? '', 'base64url').toString() || '{}').sub : path.startsWith('/p/') ? String(req.headers['x-test-viewer'] ?? '') : '';
    if (path.startsWith('/api/')) headers.authorization = String(req.headers.authorization ?? '');
    if (sub) Object.assign(headers, { 'x-auth-subject': sub, 'x-auth-sig': sign(sub) });
    const up = request({ host: '127.0.0.1', port: publishPort, method: req.method, path, headers }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
    req.pipe(up);
  });
  gatewayPort = await listen(gateway);
  const kPort = await listen(keystone);
  servers = [keystone, siteflow, publish, gateway];
  const renderer = await createNodeRenderer();
  const host = new DocumentHost({ renderer, images: () => none });
  const memory = { value: undefined as string | undefined };
  daemon = await startDaemon({
    host, renderer, fonts: none, icons: new PackageIconSource(), images: () => none, fallbacks: renderer.fallbacks, port: 0,
    w33d: { issuer: `http://127.0.0.1:${kPort}`, clientId: 'nib-desktop', publishBase: `http://127.0.0.1:${gatewayPort}`, userAgent: 'nib/test', store: { get: async () => memory.value, set: async (v) => { memory.value = v; } } },
    siteExporter: EXPORTERS.site,
  });
});
afterAll(async () => { await daemon.close(); for (const s of servers) s.close(); });

const api = async (path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${daemon.port}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${daemon.token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, json: await r.json() };
};
const view = (path: string, viewer?: string) => fetch(`http://127.0.0.1:${gatewayPort}${path}`, { headers: viewer ? { 'x-test-viewer': viewer } : {} });

describe('publishing to w33d', () => {
  it('signs in with PKCE, publishes the design as a private site, makes it public, takes it down', async () => {
    expect((await api('/api/w33d/status')).json).toMatchObject({ available: true, signedIn: false });
    // Without signing in, publishing is refused; the rest of nib does not care.
    const path = join(dir, 'Quill Deck.pen');
    await writeFile(path, serializePen({ version: '2.20', children: [
      { type: 'frame', id: 'home', name: 'Home', x: 0, y: 0, width: 400, height: 300, layout: 'vertical', children: [
        { type: 'text', id: 't', content: 'Quill' },
        { type: 'frame', id: 'go', name: 'Pricing link', padding: 8, metadata: { type: 'nib-link', to: 'pricing' }, children: [{ type: 'text', id: 'g', content: 'See pricing' }] },
      ] },
      { type: 'frame', id: 'pricing', name: 'Pricing', x: 500, y: 0, width: 400, height: 300, children: [{ type: 'text', id: 'p', content: 'Free, Pro, Team' }] },
    ] } as unknown as PenDocument));
    expect((await api('/api/w33d/publish', { path, slug: 'quill', visibility: 'private' })).status).toBe(401);

    const { url } = (await api('/api/w33d/login', {})).json as { url: string };
    const q = new URL(url).searchParams;
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('redirect_uri')).toBe(`http://127.0.0.1:${daemon.port}/auth/w33d/callback`);
    nonces.set('the-code', q.get('nonce')!);
    // The browser comes back with the code (a callback for a sign-in nib never started is refused).
    expect((await fetch(`http://127.0.0.1:${daemon.port}/auth/w33d/callback?code=x&state=forged`)).status).toBe(400);
    const back = await fetch(`http://127.0.0.1:${daemon.port}/auth/w33d/callback?code=the-code&state=${q.get('state')}`);
    expect(await back.text()).toContain('As tester@w33d.xyz');
    expect((await api('/api/w33d/status')).json).toMatchObject({ signedIn: true, email: 'tester@w33d.xyz' });
    expect((await api(`/api/w33d/site?doc=${encodeURIComponent(path)}`)).json).toEqual({ suggested: 'quill-deck' });

    const pub = await api('/api/w33d/publish', { path, slug: 'quill', visibility: 'private' });
    expect(pub.json.site).toMatchObject({ slug: 'quill', visibility: 'private', url: 'https://nib.w33d.xyz/p/quill/' });
    // Private: only signed-in viewers, and not behind the public door.
    expect((await view('/s/quill/')).status).toBe(404);
    expect((await view('/p/quill/')).status).toBe(401);
    const home = await (await view('/p/quill/', 'usr_viewer')).text();
    expect(home).toContain('Quill');
    expect(home).toMatch(/href="pricing.html"/);
    expect(await (await view('/p/quill/pricing.html', 'usr_viewer')).text()).toContain('Free, Pro, Team');

    expect((await api('/api/w33d/visibility', { path, visibility: 'public' })).json.site).toMatchObject({ visibility: 'public', url: 'https://nib.w33d.xyz/s/quill/' });
    expect(await (await view('/s/quill/')).text()).toContain('Quill');
    expect((await api(`/api/w33d/site?doc=${encodeURIComponent(path)}`)).json.site).toMatchObject({ slug: 'quill', visibility: 'public' });

    expect((await api('/api/w33d/unpublish', { path })).status).toBe(200);
    expect((await view('/s/quill/')).status).toBe(404);
    expect((await api('/api/w33d/logout', {})).json).toEqual({ signedIn: false });
  });
});
